/**
 * KILL ALL EMAIL - LLM Categorization Engine
 * "Analyzing target... determining fate..."
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  EmailMessage,
  EmailFate,
  CategoryDecision,
  LLMConfig,
  SmartKnobs,
  ProcessingConfig,
} from '../types';

export interface CategorizationResult {
  decisions: CategoryDecision[];
  escalated: EmailMessage[];
  errors: { emailId: string; error: string }[];
}

export class EmailCategorizer {
  private client: Anthropic;
  private config: LLMConfig;
  private knobs: SmartKnobs;
  private processingConfig: ProcessingConfig;

  constructor(
    config: LLMConfig,
    knobs: SmartKnobs,
    processingConfig: ProcessingConfig
  ) {
    this.config = config;
    this.knobs = knobs;
    this.processingConfig = processingConfig;
    this.client = new Anthropic({ apiKey: config.apiKey });
  }

  // Categorize a batch of emails using the fast model
  async categorizeBatch(
    emails: EmailMessage[],
    useSmart: boolean = false
  ): Promise<CategorizationResult> {
    const results: CategorizationResult = {
      decisions: [],
      escalated: [],
      errors: [],
    };

    const model = useSmart ? this.config.smartModel : this.config.fastModel;
    const batchSize = useSmart ? this.knobs.smartBatchSize : this.knobs.fastBatchSize;

    // Process in batches
    for (let i = 0; i < emails.length; i += batchSize) {
      const batch = emails.slice(i, i + batchSize);

      try {
        const batchResults = await this.processBatch(batch, model, useSmart);

        for (const result of batchResults) {
          if (result.fate === EmailFate.ESCALATE && !useSmart) {
            // Find the original email and mark for escalation
            const email = emails.find(e => e.id === result.emailId);
            if (email) {
              results.escalated.push(email);
            }
          } else {
            results.decisions.push(result);
          }
        }
      } catch (err) {
        // Log errors for this batch
        for (const email of batch) {
          results.errors.push({
            emailId: email.id,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }
    }

    return results;
  }

  // Process a single batch through the LLM
  private async processBatch(
    emails: EmailMessage[],
    model: string,
    isEscalated: boolean
  ): Promise<CategoryDecision[]> {
    const emailSummaries = emails.map((email, idx) => this.formatEmailForLLM(email, idx));

    const prompt = this.buildPrompt(emailSummaries, isEscalated);

    const response = await this.client.messages.create({
      model,
      max_tokens: 4096,
      temperature: this.config.temperature,
      system: this.getSystemPrompt(isEscalated),
      messages: [{ role: 'user', content: prompt }],
    });

    // Parse the response
    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type');
    }

    return this.parseResponse(content.text, emails, isEscalated);
  }

  // Format a single email for the LLM
  private formatEmailForLLM(email: EmailMessage, index: number): string {
    const fromStr = email.from.map(f => f.address).join(', ');
    const ageInDays = Math.floor(
      (Date.now() - email.date.getTime()) / (1000 * 60 * 60 * 24)
    );

    return `
[EMAIL ${index + 1}]
ID: ${email.id}
From: ${fromStr}
Subject: ${email.subject}
Date: ${email.date.toISOString()} (${ageInDays} days ago)
Has Attachments: ${email.attachments.length > 0 ? 'Yes' : 'No'}
Is Read: ${email.isRead ? 'Yes' : 'No'}
Preview: ${email.snippet.substring(0, 300)}
---`;
  }

  // Build the categorization prompt
  private buildPrompt(emailSummaries: string[], isEscalated: boolean): string {
    const aggressivenessNote =
      this.processingConfig.aggressiveness >= 8
        ? 'Be aggressive - lean towards termination for old/promotional content.'
        : this.processingConfig.aggressiveness <= 3
          ? 'Be conservative - only terminate obvious spam/junk.'
          : 'Use balanced judgment.';

    const escalatedNote = isEscalated
      ? `
These emails were flagged as uncertain by the fast model.
Please analyze more carefully and provide definitive categorization.
Only use HUMAN_REVIEW if absolutely necessary.`
      : '';

    return `
Analyze the following emails and categorize each one.
${aggressivenessNote}
${escalatedNote}

Age thresholds for reference:
- Promotional content older than ${this.processingConfig.ageThresholds.promotional} days → TERMINATE
- Newsletters older than ${this.processingConfig.ageThresholds.newsletters} days → ARCHIVE_NEWSLETTERS
- Receipts should be kept for at least ${this.processingConfig.ageThresholds.receipts} days

${emailSummaries.join('\n')}

For each email, respond in this exact JSON format:
{
  "decisions": [
    {
      "id": "email_id",
      "fate": "CATEGORY",
      "confidence": 0.0-1.0,
      "reasoning": "Brief explanation"
    }
  ]
}

Valid categories:
- TERMINATE: Delete immediately (spam, expired offers, junk)
- TERMINATE_DELAYED: Delete after review period
- ARCHIVE_RECEIPTS: Purchase confirmations, invoices
- ARCHIVE_PERSONAL: Personal correspondence worth keeping
- ARCHIVE_WORK: Professional/work emails
- ARCHIVE_LEGAL: Legal, tax, financial documents
- ARCHIVE_TRAVEL: Travel confirmations, itineraries
- ARCHIVE_NEWSLETTERS: Newsletters to keep
- KEEP_ACTION: Needs response or action
- KEEP_REFERENCE: Reference material, keep in inbox
- KEEP_IMPORTANT: Important, do not touch
- ESCALATE: Uncertain, needs smarter model (only for fast model)
- HUMAN_REVIEW: Truly ambiguous, needs human decision
`;
  }

  // System prompt for the LLM
  private getSystemPrompt(isEscalated: boolean): string {
    const basePrompt = `You are an AI email categorization system called "KILL ALL EMAIL".
Your job is to analyze emails and categorize them for organization or deletion.

Key principles:
1. Protect important emails (legal, financial, personal correspondence)
2. Identify and mark deletable content (spam, old promos, expired offers)
3. Organize emails into appropriate archive categories
4. When uncertain, escalate rather than delete
5. Always provide reasoning for decisions

Patterns that suggest TERMINATE:
- Promotional emails with expired offers
- Old newsletters not opened
- Automated notifications that are outdated
- Unsubscribe confirmation emails
- Social media notifications

Patterns that suggest KEEP/ARCHIVE:
- Receipts and invoices (keep for tax purposes)
- Personal letters from real people
- Legal documents or notices
- Financial statements
- Travel confirmations (even past trips may be needed)
- Work-related correspondence

Be precise with confidence scores:
- 0.9-1.0: Absolutely certain
- 0.7-0.9: Fairly confident
- 0.5-0.7: Uncertain, consider escalation
- Below 0.5: Should definitely escalate or flag for human review`;

    if (isEscalated) {
      return (
        basePrompt +
        `

ESCALATED MODE: These emails were uncertain for the fast model.
Analyze more carefully. You are the last AI checkpoint before human review.
Only use HUMAN_REVIEW for truly ambiguous cases where deletion would be risky.`
      );
    }

    return basePrompt;
  }

  // Parse the LLM response
  private parseResponse(
    response: string,
    emails: EmailMessage[],
    isEscalated: boolean
  ): CategoryDecision[] {
    // Extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*"decisions"[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Could not parse LLM response as JSON');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const decisions: CategoryDecision[] = [];

    for (const decision of parsed.decisions) {
      const email = emails.find((e) => e.id === decision.id);
      if (!email) continue;

      let fate = decision.fate as EmailFate;
      let confidence = decision.confidence;

      // Apply escalation logic
      if (!isEscalated && confidence < this.config.escalationThreshold) {
        fate = EmailFate.ESCALATE;
      }

      // Apply knob-based adjustments
      fate = this.applyKnobAdjustments(email, fate, confidence);

      decisions.push({
        emailId: email.id,
        fate,
        confidence,
        reasoning: decision.reasoning,
        modelUsed: isEscalated ? 'smart' : 'fast',
        timestamp: new Date(),
        escalatedFrom: isEscalated ? EmailFate.ESCALATE : undefined,
      });
    }

    return decisions;
  }

  // Apply smart knob adjustments to decisions
  private applyKnobAdjustments(
    email: EmailMessage,
    fate: EmailFate,
    confidence: number
  ): EmailFate {
    const ageInDays = Math.floor(
      (Date.now() - email.date.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Check if email is too recent for termination
    if (
      fate === EmailFate.TERMINATE &&
      this.knobs.escalateOnRecent &&
      ageInDays < this.knobs.recentThresholdDays
    ) {
      return EmailFate.ESCALATE;
    }

    // Check if email has attachments and should escalate
    if (
      fate === EmailFate.TERMINATE &&
      this.knobs.escalateOnAttachments &&
      email.attachments.length > 0
    ) {
      return EmailFate.ESCALATE;
    }

    // Check delete confidence threshold
    if (
      fate === EmailFate.TERMINATE &&
      confidence < this.knobs.deleteConfidenceThreshold
    ) {
      return EmailFate.TERMINATE_DELAYED;
    }

    // Check for human review patterns
    const subjectLower = email.subject.toLowerCase();
    const snippetLower = email.snippet.toLowerCase();
    const combinedText = subjectLower + ' ' + snippetLower;

    for (const pattern of this.knobs.humanReviewPatterns) {
      if (combinedText.includes(pattern.toLowerCase())) {
        return EmailFate.HUMAN_REVIEW;
      }
    }

    // Check for important senders
    const senderAddresses = email.from.map((f) => f.address.toLowerCase());
    for (const important of this.knobs.importantSenders) {
      if (senderAddresses.some((s) => s.includes(important.toLowerCase()))) {
        if (fate === EmailFate.TERMINATE) {
          return EmailFate.KEEP_IMPORTANT;
        }
      }
    }

    return fate;
  }

  // Quick pre-filter using rules (no LLM needed)
  preFilterEmails(emails: EmailMessage[]): {
    obvious: CategoryDecision[];
    needsLLM: EmailMessage[];
  } {
    const obvious: CategoryDecision[] = [];
    const needsLLM: EmailMessage[] = [];

    for (const email of emails) {
      const quickDecision = this.quickCategorize(email);
      if (quickDecision) {
        obvious.push(quickDecision);
      } else {
        needsLLM.push(email);
      }
    }

    return { obvious, needsLLM };
  }

  // Quick rule-based categorization
  private quickCategorize(email: EmailMessage): CategoryDecision | null {
    const subjectLower = email.subject.toLowerCase();
    const fromAddress = email.from[0]?.address.toLowerCase() || '';
    const ageInDays = Math.floor(
      (Date.now() - email.date.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Check blocked domains
    for (const domain of this.processingConfig.blockedDomains) {
      if (fromAddress.includes(domain.toLowerCase())) {
        return {
          emailId: email.id,
          fate: EmailFate.TERMINATE,
          confidence: 1.0,
          reasoning: `Sender domain is blocked: ${domain}`,
          modelUsed: 'fast',
          timestamp: new Date(),
        };
      }
    }

    // Check trusted domains
    for (const domain of this.processingConfig.trustedDomains) {
      if (fromAddress.includes(domain.toLowerCase())) {
        return {
          emailId: email.id,
          fate: EmailFate.KEEP_IMPORTANT,
          confidence: 1.0,
          reasoning: `Sender domain is trusted: ${domain}`,
          modelUsed: 'fast',
          timestamp: new Date(),
        };
      }
    }

    // Quick receipt detection
    for (const keyword of this.knobs.receiptKeywords) {
      if (subjectLower.includes(keyword.toLowerCase())) {
        return {
          emailId: email.id,
          fate: EmailFate.ARCHIVE_RECEIPTS,
          confidence: 0.85,
          reasoning: `Receipt keyword detected: ${keyword}`,
          modelUsed: 'fast',
          timestamp: new Date(),
        };
      }
    }

    // Quick promotional detection for old emails
    if (ageInDays > this.processingConfig.ageThresholds.promotional) {
      for (const pattern of this.knobs.promotionalPatterns) {
        if (subjectLower.includes(pattern.toLowerCase())) {
          return {
            emailId: email.id,
            fate: EmailFate.TERMINATE,
            confidence: 0.9,
            reasoning: `Old promotional email (${ageInDays} days): ${pattern}`,
            modelUsed: 'fast',
            timestamp: new Date(),
          };
        }
      }
    }

    return null; // Needs LLM analysis
  }

  // Categorize emails requiring human review (asks questions)
  async generateHumanReviewQuestions(
    email: EmailMessage
  ): Promise<{ questions: string[]; context: string }> {
    const prompt = `
Analyze this email and generate 2-3 focused questions to help a human decide what to do with it.

Email:
From: ${email.from.map((f) => f.address).join(', ')}
Subject: ${email.subject}
Date: ${email.date.toISOString()}
Preview: ${email.snippet}

Generate questions that would help determine:
1. Whether this email should be kept or deleted
2. If kept, how it should be categorized

Respond in JSON format:
{
  "questions": ["question1", "question2", "question3"],
  "context": "Brief context about why this email is ambiguous"
}
`;

    const response = await this.client.messages.create({
      model: this.config.fastModel,
      max_tokens: 500,
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type');
    }

    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        questions: [
          'Should this email be kept?',
          'Is this email important for future reference?',
        ],
        context: 'Unable to generate specific questions',
      };
    }

    return JSON.parse(jsonMatch[0]);
  }
}
