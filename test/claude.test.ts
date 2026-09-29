import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClaudeDecisions } from '../src/classify';
import { EmailFate } from '../src/types';
import { makeEmail } from './helpers';

test('matches decisions to emails by id', () => {
  const batch = [makeEmail({ id: 'a' }), makeEmail({ id: 'b' })];
  const text = JSON.stringify({
    decisions: [
      { id: 'b', category: 'KEEP_ACTION', confidence: 0.9, reasoning: 'asks a question' },
      { id: 'a', category: 'TERMINATE', confidence: 0.95, reasoning: 'spam' },
    ],
  });

  const result = parseClaudeDecisions(text, batch, 'claude-haiku-4-5');
  assert.deepEqual(result.failed, []);
  assert.deepEqual(
    result.classifications.map((c) => [c.emailId, c.category]),
    [
      ['a', EmailFate.TERMINATE],
      ['b', EmailFate.KEEP_ACTION],
    ]
  );
  assert.equal(result.classifications[0].source, 'claude-haiku-4-5');
});

test('missing and invalid decisions count as failures', () => {
  const batch = [makeEmail({ id: 'a' }), makeEmail({ id: 'b' }), makeEmail({ id: 'c' })];
  const text = JSON.stringify({
    decisions: [
      { id: 'a', category: 'HUMAN_REVIEW', confidence: 0.5, reasoning: '' },
      { id: 'b', category: 'ARCHIVE_WORK', confidence: 1.4, reasoning: '' },
    ],
  });

  const result = parseClaudeDecisions(text, batch, 'm');
  assert.deepEqual(
    result.failed.map((f) => f.emailId),
    ['a', 'c']
  );
  assert.equal(result.classifications[0].confidence, 1);
});
