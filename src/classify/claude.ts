/**
 * KILL ALL EMAIL - Claude Classifier
 * "Analyzing target... determining fate..."
 */

import Anthropic from '@anthropic-ai/sdk';
import { EmailMessage, ProcessingConfig } from '../types';
import { Classification, Classifier, ClassifyResult } from './types';
import { CATEGORY_IDS, CONTENT_CATEGORIES, ageInDays, isContentCategory } from './categories';

export interface ClaudeClassifierOptions {
  apiKey?: string;
  model: string;
  batchSize: number;
  effort?: 'low' | 'medium' | 'high';
  // The escalation tier sees only the emails the first pass was unsure about
  escalated: boolean;
  processing: ProcessingConfig;
}

const DECISIONS_SCHEMA = {
  type: 'object',
  properties: {
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          category: { type: 'string', enum: CATEGORY_IDS },
          confidence: { type: 'number' },
          reasoning: { type: 'string' },
        },
        required: ['id', 'category', 'confidence', 'reasoning'],
        additionalProperties: false,
      },
    },
  },
  required: ['decisions'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You categorize emails for "KILL ALL EMAIL", a tool that cleans up a person's inbox.

Protect anything the person may need later: legal notices, financial and tax documents, receipts, travel records, work correspondence and letters from real people. Mark as TERMINATE only content with no lasting value, such as spam, expired promotions, stale automated notifications, unsubscribe confirmations and social media alerts.

Report confidence honestly: 0.9 or above only when you are certain, below 0.7 when the email could reasonably belong elsewhere. Low-confidence answers are sent to a stronger model or to the person, so an honest low score is safer than a confident guess.`;

// Only these models accept server-side refusal fallbacks
const FALLBACK_MODELS = /^claude-(opus-5|fable-5)/;

export class ClaudeClassifier implements Classifier {
  readonly name: string;
  private client: Anthropic;

  constructor(private options: ClaudeClassifierOptions) {
    this.name = options.model;
    this.client = new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
  }

  async classify(emails: EmailMessage[]): Promise<ClassifyResult> {
    const result: ClassifyResult = { classifications: [], failed: [] };

    for (let i = 0; i < emails.length; i += this.options.batchSize) {
      const batch = emails.slice(i, i + this.options.batchSize);
      try {
        const text = await this.request(this.buildPrompt(batch));
        const parsed = parseClaudeDecisions(text, batch, this.name);
        result.classifications.push(...parsed.classifications);
        result.failed.push(...parsed.failed);
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Unknown error';
        result.failed.push(...batch.map((email) => ({ emailId: email.id, error })));
      }
    }

    return result;
  }

  // Questions to help a person decide about an email the models could not settle
  async reviewQuestions(email: EmailMessage): Promise<string[]> {
    const text = await this.request(
      `Write 2-3 short questions that would help the recipient decide whether to keep, archive or delete this email.

From: ${email.from.map((f) => f.address).join(', ')}
Subject: ${email.subject}
Date: ${email.date.toISOString()}
Preview: ${email.snippet}`,
      {
        type: 'object',
        properties: { questions: { type: 'array', items: { type: 'string' } } },
        required: ['questions'],
        additionalProperties: false,
      }
    );
    const questions = JSON.parse(text).questions;
    return Array.isArray(questions) ? questions.filter((q) => typeof q === 'string') : [];
  }

  private async request(prompt: string, schema: Record<string, unknown> = DECISIONS_SCHEMA): Promise<string> {
    const { model, effort } = this.options;
    const useFallbacks = FALLBACK_MODELS.test(model);

    const response = await this.client.beta.messages.create({
      model,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      output_config: {
        format: { type: 'json_schema', schema },
        ...(effort ? { effort } : {}),
      },
      ...(useFallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    });

    if (response.stop_reason === 'refusal') {
      throw new Error(`Model declined: ${response.stop_details?.category ?? 'no category'}`);
    }
    if (response.stop_reason === 'max_tokens') {
      throw new Error('Response was cut off at max_tokens');
    }
    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('Response had no text block');
    }
    return textBlock.text;
  }

  private buildPrompt(emails: EmailMessage[]): string {
    const { aggressiveness, ageThresholds } = this.options.processing;
    const stance =
      aggressiveness >= 8
        ? 'Lean towards TERMINATE for old or promotional content.'
        : aggressiveness <= 3
          ? 'Only use TERMINATE for obvious spam and junk.'
          : 'Use balanced judgment.';

    const escalatedNote = this.options.escalated
      ? '\nA faster model was unsure about these emails. Look at them carefully.\n'
      : '';

    const summaries = emails.map(
      (email) => `<email id="${email.id}">
From: ${email.from.map((f) => f.address).join(', ')}
Subject: ${email.subject}
Date: ${email.date.toISOString()} (${ageInDays(email.date)} days ago)
Has attachments: ${email.attachments.length > 0 ? 'yes' : 'no'}
Read: ${email.isRead ? 'yes' : 'no'}
Preview: ${email.snippet.substring(0, 300)}
</email>`
    );

    const categories = Object.entries(CONTENT_CATEGORIES)
      .map(([id, description]) => `- ${id}: ${description}`)
      .join('\n');

    return `Categorize each email below. ${stance}
${escalatedNote}
For reference: promotions older than ${ageThresholds.promotional} days are usually TERMINATE, newsletters older than ${ageThresholds.newsletters} days are usually ARCHIVE_NEWSLETTERS, and receipts must be kept for at least ${ageThresholds.receipts} days.

Categories:
${categories}

Return one decision per email, using the email's id.

${summaries.join('\n\n')}`;
  }
}

// Match the model's decisions back to the batch; anything missing or malformed counts as failed
export function parseClaudeDecisions(
  text: string,
  batch: EmailMessage[],
  source: string
): ClassifyResult {
  const result: ClassifyResult = { classifications: [], failed: [] };
  const decisions: unknown[] = JSON.parse(text).decisions ?? [];
  const byId = new Map<string, Record<string, unknown>>();
  for (const d of decisions) {
    if (d && typeof d === 'object' && typeof (d as { id?: unknown }).id === 'string') {
      byId.set((d as { id: string }).id, d as Record<string, unknown>);
    }
  }

  for (const email of batch) {
    const d = byId.get(email.id);
    if (!d) {
      result.failed.push({ emailId: email.id, error: 'No decision returned for this email' });
    } else if (!isContentCategory(d.category) || typeof d.confidence !== 'number') {
      result.failed.push({ emailId: email.id, error: `Invalid decision: ${JSON.stringify(d)}` });
    } else {
      result.classifications.push({
        emailId: email.id,
        category: d.category,
        confidence: Math.min(1, Math.max(0, d.confidence)),
        reasoning: typeof d.reasoning === 'string' ? d.reasoning : '',
        source,
      });
    }
  }

  return result;
}
