/**
 * KILL ALL EMAIL - Termination Policy
 * "I have detailed files on human anatomy... and your inbox rules."
 *
 * Pure functions: the user's rules and knobs decide what happens to an email,
 * whichever classifier (or rule) said what the email is.
 */

import { CategoryDecision, EmailFate, EmailMessage, ProcessingConfig, SmartKnobs } from './types';
import { Classification } from './classify/types';
import { ageInDays } from './classify/categories';

export interface RuleHit {
  classification: Classification;
  // Blocked/trusted domains are the user's explicit orders and skip the safety checks
  explicit: boolean;
}

export interface PolicyContext {
  knobs: SmartKnobs;
  escalationThreshold: number;
  // True when no stronger model is left to escalate to
  finalTier: boolean;
}

// Rule-based classification for emails that need no model at all
export function applyRules(
  email: EmailMessage,
  processing: ProcessingConfig,
  knobs: SmartKnobs
): RuleHit | null {
  const subject = email.subject.toLowerCase();
  const from = email.from[0]?.address.toLowerCase() || '';
  const age = ageInDays(email.date);
  const hit = (category: EmailFate, confidence: number, reasoning: string, explicit = false): RuleHit => ({
    classification: { emailId: email.id, category, confidence, reasoning, source: 'rules' },
    explicit,
  });

  const blocked = processing.blockedDomains.find((d) => from.includes(d.toLowerCase()));
  if (blocked) return hit(EmailFate.TERMINATE, 1.0, `Sender domain is blocked: ${blocked}`, true);

  const trusted = processing.trustedDomains.find((d) => from.includes(d.toLowerCase()));
  if (trusted) return hit(EmailFate.KEEP_IMPORTANT, 1.0, `Sender domain is trusted: ${trusted}`, true);

  const receipt = knobs.receiptKeywords.find((k) => subject.includes(k.toLowerCase()));
  if (receipt) return hit(EmailFate.ARCHIVE_RECEIPTS, 0.85, `Receipt keyword detected: ${receipt}`);

  if (age > processing.ageThresholds.promotional) {
    const promo = knobs.promotionalPatterns.find((p) => subject.includes(p.toLowerCase()));
    if (promo) return hit(EmailFate.TERMINATE, 0.9, `Old promotional email (${age} days): ${promo}`);
  }

  return null;
}

// Turn a classification into a fate, applying every safety knob
export function decideFate(
  email: EmailMessage,
  classification: Classification,
  ctx: PolicyContext
): EmailFate {
  const { knobs } = ctx;
  const { category, confidence } = classification;
  const text = `${email.subject} ${email.snippet}`.toLowerCase();
  const senders = email.from.map((f) => f.address.toLowerCase());

  if (
    category === EmailFate.TERMINATE &&
    knobs.importantSenders.some((s) => senders.some((addr) => addr.includes(s.toLowerCase())))
  ) {
    return EmailFate.KEEP_IMPORTANT;
  }

  if (knobs.humanReviewPatterns.some((p) => text.includes(p.toLowerCase()))) {
    return EmailFate.HUMAN_REVIEW;
  }

  if (!ctx.finalTier && confidence < ctx.escalationThreshold) {
    return EmailFate.ESCALATE;
  }

  if (category === EmailFate.TERMINATE) {
    const tooRecent = knobs.escalateOnRecent && ageInDays(email.date) < knobs.recentThresholdDays;
    const hasAttachments = knobs.escalateOnAttachments && email.attachments.length > 0;
    if (tooRecent || hasAttachments) {
      // A second opinion if one is available; otherwise hold off instead of deleting now
      return ctx.finalTier ? EmailFate.TERMINATE_DELAYED : EmailFate.ESCALATE;
    }
    if (confidence < knobs.deleteConfidenceThreshold) {
      return EmailFate.TERMINATE_DELAYED;
    }
  }

  return category;
}

export function toDecision(
  classification: Classification,
  fate: EmailFate,
  escalatedFrom?: EmailFate
): CategoryDecision {
  return {
    emailId: classification.emailId,
    fate,
    confidence: classification.confidence,
    reasoning: classification.reasoning,
    modelUsed: classification.source,
    escalatedFrom,
    timestamp: new Date(),
  };
}
