import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRules, decideFate, PolicyContext } from '../src/policy';
import { Classification } from '../src/classify';
import { DEFAULT_PROCESSING_CONFIG } from '../src/config/defaults';
import { EmailFate } from '../src/types';
import { makeEmail, makeKnobs } from './helpers';

function classify(category: EmailFate, confidence: number): Classification {
  return { emailId: '1', category, confidence, reasoning: '', source: 'test' };
}

function ctx(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return { knobs: makeKnobs(), escalationThreshold: 0.7, finalTier: false, ...overrides };
}

test('confident archive decisions pass through', () => {
  const fate = decideFate(makeEmail(), classify(EmailFate.ARCHIVE_WORK, 0.9), ctx());
  assert.equal(fate, EmailFate.ARCHIVE_WORK);
});

test('low confidence escalates when a stronger model is available', () => {
  const fate = decideFate(makeEmail(), classify(EmailFate.ARCHIVE_WORK, 0.5), ctx());
  assert.equal(fate, EmailFate.ESCALATE);
});

test('the final tier never escalates', () => {
  const fate = decideFate(makeEmail(), classify(EmailFate.ARCHIVE_WORK, 0.5), ctx({ finalTier: true }));
  assert.equal(fate, EmailFate.ARCHIVE_WORK);
});

test('recent emails are not deleted outright', () => {
  const email = makeEmail({ ageDays: 1 });
  assert.equal(decideFate(email, classify(EmailFate.TERMINATE, 0.99), ctx()), EmailFate.ESCALATE);
  assert.equal(
    decideFate(email, classify(EmailFate.TERMINATE, 0.99), ctx({ finalTier: true })),
    EmailFate.TERMINATE_DELAYED
  );
});

test('emails with attachments are not deleted outright', () => {
  const email = makeEmail({ attachments: [{ filename: 'a.pdf', contentType: 'application/pdf', size: 10 }] });
  assert.equal(
    decideFate(email, classify(EmailFate.TERMINATE, 0.99), ctx({ finalTier: true })),
    EmailFate.TERMINATE_DELAYED
  );
});

test('deletion below the delete-confidence threshold is delayed', () => {
  const fate = decideFate(makeEmail(), classify(EmailFate.TERMINATE, 0.8), ctx());
  assert.equal(fate, EmailFate.TERMINATE_DELAYED);
});

test('confident deletion of old mail goes ahead', () => {
  const fate = decideFate(makeEmail(), classify(EmailFate.TERMINATE, 0.95), ctx());
  assert.equal(fate, EmailFate.TERMINATE);
});

test('review patterns always go to a human', () => {
  const email = makeEmail({ subject: 'Subpoena enclosed' });
  const fate = decideFate(email, classify(EmailFate.ARCHIVE_LEGAL, 0.99), ctx({ finalTier: true }));
  assert.equal(fate, EmailFate.HUMAN_REVIEW);
});

test('important senders are never deleted', () => {
  const email = makeEmail({ from: [{ address: 'boss@work.com' }] });
  const fate = decideFate(
    email,
    classify(EmailFate.TERMINATE, 0.99),
    ctx({ knobs: makeKnobs({ importantSenders: ['work.com'] }) })
  );
  assert.equal(fate, EmailFate.KEEP_IMPORTANT);
});

test('blocked and trusted domains are explicit rules', () => {
  const processing = {
    ...DEFAULT_PROCESSING_CONFIG,
    blockedDomains: ['spam.biz'],
    trustedDomains: ['family.org'],
  };
  const blocked = applyRules(makeEmail({ from: [{ address: 'x@spam.biz' }] }), processing, makeKnobs());
  assert.equal(blocked?.classification.category, EmailFate.TERMINATE);
  assert.equal(blocked?.explicit, true);

  const trusted = applyRules(makeEmail({ from: [{ address: 'mom@family.org' }] }), processing, makeKnobs());
  assert.equal(trusted?.classification.category, EmailFate.KEEP_IMPORTANT);
});

test('receipt keywords and old promotions are caught by rules', () => {
  const receipt = applyRules(makeEmail({ subject: 'Your invoice #12' }), DEFAULT_PROCESSING_CONFIG, makeKnobs());
  assert.equal(receipt?.classification.category, EmailFate.ARCHIVE_RECEIPTS);
  assert.equal(receipt?.explicit, false);

  const promo = applyRules(makeEmail({ subject: '50% off, sale ends today' }), DEFAULT_PROCESSING_CONFIG, makeKnobs());
  assert.equal(promo?.classification.category, EmailFate.TERMINATE);

  assert.equal(applyRules(makeEmail(), DEFAULT_PROCESSING_CONFIG, makeKnobs()), null);
});
