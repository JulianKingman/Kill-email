/**
 * KILL ALL EMAIL - Classifier Contract
 * "Classify first. Ask questions later."
 */

import { EmailFate, EmailMessage } from '../types';

// What a classifier says an email is. Whether that gets acted on is decided by policy.ts.
export interface Classification {
  emailId: string;
  category: EmailFate;
  confidence: number; // 0-1
  reasoning: string;
  source: string;     // e.g. 'system-one', 'claude-opus-5', 'rules'
}

export interface ClassifyResult {
  classifications: Classification[];
  failed: { emailId: string; error: string }[];
}

export interface Classifier {
  readonly name: string;
  classify(emails: EmailMessage[]): Promise<ClassifyResult>;
}
