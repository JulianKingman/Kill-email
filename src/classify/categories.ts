/**
 * KILL ALL EMAIL - Content Categories
 * The labels a classifier may choose from. TERMINATE_DELAYED, ESCALATE and
 * HUMAN_REVIEW are not here: they are policy outcomes, not things an email "is".
 */

import { EmailFate } from '../types';

export const CONTENT_CATEGORIES: Partial<Record<EmailFate, string>> = {
  [EmailFate.TERMINATE]: 'spam, junk, expired promotions, stale automated notifications',
  [EmailFate.ARCHIVE_RECEIPTS]: 'purchase confirmations, invoices, receipts',
  [EmailFate.ARCHIVE_PERSONAL]: 'personal correspondence from real people worth keeping',
  [EmailFate.ARCHIVE_WORK]: 'professional or work-related correspondence',
  [EmailFate.ARCHIVE_LEGAL]: 'legal, tax or financial documents and statements',
  [EmailFate.ARCHIVE_TRAVEL]: 'travel bookings, confirmations and itineraries',
  [EmailFate.ARCHIVE_NEWSLETTERS]: 'newsletters worth keeping',
  [EmailFate.KEEP_ACTION]: 'needs a reply or some action from the recipient',
  [EmailFate.KEEP_REFERENCE]: 'reference material to keep in the inbox',
  [EmailFate.KEEP_IMPORTANT]: 'important, must not be touched',
};

export const CATEGORY_IDS = Object.keys(CONTENT_CATEGORIES) as EmailFate[];

export function isContentCategory(value: unknown): value is EmailFate {
  return typeof value === 'string' && (CATEGORY_IDS as string[]).includes(value);
}

export function ageInDays(date: Date, now: number = Date.now()): number {
  return Math.floor((now - date.getTime()) / (1000 * 60 * 60 * 24));
}
