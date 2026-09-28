import { EmailMessage, SmartKnobs } from '../src/types';
import { DEFAULT_SMART_KNOBS } from '../src/config/defaults';

const DAY = 24 * 60 * 60 * 1000;

export function makeEmail(overrides: Partial<EmailMessage> & { ageDays?: number } = {}): EmailMessage {
  const { ageDays = 60, ...rest } = overrides;
  return {
    id: '1',
    uid: 1,
    messageId: '<1@example.com>',
    from: [{ address: 'sender@example.com' }],
    to: [{ address: 'me@example.com' }],
    subject: 'Hello',
    date: new Date(Date.now() - ageDays * DAY),
    snippet: 'Just saying hi',
    attachments: [],
    labels: [],
    flags: [],
    size: 1000,
    isRead: true,
    isStarred: false,
    ...rest,
  };
}

export function makeKnobs(overrides: Partial<SmartKnobs> = {}): SmartKnobs {
  return { ...DEFAULT_SMART_KNOBS, humanReviewPatterns: ['subpoena'], ...overrides };
}
