/**
 * KILL ALL EMAIL - System One Classifier
 * "No small talk. Just the verdict."
 *
 * Talks to any server that speaks the /v1/systemone decision API: TypeSafe's
 * hosted Jev, or Laya running locally via `laya-serve` (which implements the
 * same wire protocol). These models never generate text: one forward pass
 * returns a category with calibrated probabilities.
 */

import { EmailMessage, SystemOneConfig } from '../types';
import { Classification, Classifier, ClassifyResult } from './types';
import { CONTENT_CATEGORIES, ageInDays, isContentCategory } from './categories';

const QUESTION_ID = 'fate';
const BODY_CHARS = 4000;
const MAX_ATTEMPTS = 3;

type FetchFn = typeof fetch;

interface ChoiceAnswer {
  type: 'choice';
  choice: string;
  probabilities?: Record<string, number>;
  confidence?: number;
  answer_confidence?: number; // calibrated; Laya reports it, Jev may not
}

export class SystemOneError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export class SystemOneClassifier implements Classifier {
  readonly name = 'system-one';

  constructor(
    private config: SystemOneConfig,
    private fetchFn: FetchFn = fetch,
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
  ) {}

  async classify(emails: EmailMessage[]): Promise<ClassifyResult> {
    const result: ClassifyResult = { classifications: [], failed: [] };
    const queue = [...emails];
    const workers = Array.from(
      { length: Math.max(1, Math.min(this.config.concurrency, queue.length)) },
      async () => {
        for (let email = queue.shift(); email; email = queue.shift()) {
          try {
            result.classifications.push(await this.classifyOne(email));
          } catch (err) {
            result.failed.push({
              emailId: email.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    );
    await Promise.all(workers);
    return result;
  }

  buildRequest(email: EmailMessage): Record<string, unknown> {
    const body = (email.body || email.snippet || '').substring(0, BODY_CHARS);
    return {
      state: {
        from: email.from.map((f) => f.address).join(', '),
        subject: email.subject,
        age_days: ageInDays(email.date),
        has_attachments: email.attachments.length > 0,
        is_read: email.isRead,
        body,
      },
      questions: {
        [QUESTION_ID]: {
          type: 'choice',
          instructions:
            'Which category best describes the email with this `subject` and `body` from the recipient\'s point of view?',
          criteria: CONTENT_CATEGORIES,
        },
      },
      ...(this.config.model ? { model: this.config.model } : {}),
    };
  }

  parseResponse(emailId: string, payload: unknown): Classification {
    const answer = (payload as { answers?: Record<string, ChoiceAnswer> })?.answers?.[QUESTION_ID];
    if (!answer || answer.type !== 'choice') {
      throw new SystemOneError(`response has no choice answer for "${QUESTION_ID}"`);
    }
    if (!isContentCategory(answer.choice)) {
      throw new SystemOneError(`unknown category "${answer.choice}"`);
    }
    const confidence = answer.answer_confidence ?? answer.confidence;
    if (typeof confidence !== 'number') {
      throw new SystemOneError('response has no confidence');
    }

    return {
      emailId,
      category: answer.choice,
      confidence,
      reasoning: describeProbabilities(answer.probabilities),
      source: this.name,
    };
  }

  private async classifyOne(email: EmailMessage): Promise<Classification> {
    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/v1/systemone`;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.config.apiKey) {
      headers.authorization = `Bearer ${this.config.apiKey}`;
    }
    const body = JSON.stringify(this.buildRequest(email));

    for (let attempt = 1; ; attempt++) {
      const response = await this.fetchFn(url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });

      // 503 is Laya's "busy, retry"; 429 is a rate limit. Both are worth a short wait.
      if ((response.status === 503 || response.status === 429) && attempt < MAX_ATTEMPTS) {
        const retryAfter = Number(response.headers.get('retry-after'));
        await this.sleep((Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : attempt) * 1000);
        continue;
      }
      if (!response.ok) {
        throw new SystemOneError(`HTTP ${response.status} from ${url}`, response.status);
      }
      return this.parseResponse(email.id, await response.json());
    }
  }
}

// The model writes no explanation, so show the top of the distribution instead
function describeProbabilities(probabilities?: Record<string, number>): string {
  if (!probabilities) return 'No probabilities returned';
  return Object.entries(probabilities)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([category, p]) => `${category} ${(p * 100).toFixed(0)}%`)
    .join(', ');
}
