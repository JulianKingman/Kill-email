import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SystemOneClassifier } from '../src/classify';
import { EmailFate, SystemOneConfig } from '../src/types';
import { makeEmail } from './helpers';

const CONFIG: SystemOneConfig = {
  baseUrl: 'http://localhost:8000/',
  apiKey: 'secret',
  concurrency: 2,
  timeoutMs: 1000,
};

// Shaped like laya-serve's /v1/systemone response
function layaResponse(choice: string, extra: Record<string, unknown> = {}) {
  return {
    model: 'laya-rl-agent',
    answers: {
      fate: {
        type: 'choice',
        choice,
        probabilities: { [choice]: 0.82, KEEP_ACTION: 0.1, ARCHIVE_WORK: 0.08 },
        confidence: 0.6,
        answer_confidence: 0.82,
        action: { act_probability: 0.9 },
        ...extra,
      },
    },
    usage: { input_tokens: 120, output_tokens: 0 },
  };
}

type Call = { url: string; init: RequestInit };

function fakeFetch(responses: Array<() => Response>) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('unexpected request');
    return next();
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const noSleep = async () => {};

test('sends one choice question with Bearer auth to /v1/systemone', async () => {
  const { fn, calls } = fakeFetch([json(layaResponse('ARCHIVE_RECEIPTS'))]);
  const classifier = new SystemOneClassifier({ ...CONFIG, model: 'english' }, fn, noSleep);

  await classifier.classify([makeEmail({ subject: 'Order shipped', body: 'Your order is on its way' })]);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://localhost:8000/v1/systemone');
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, 'Bearer secret');
  const body = JSON.parse(calls[0].init.body as string);
  assert.equal(body.model, 'english');
  assert.equal(body.state.subject, 'Order shipped');
  assert.equal(body.state.body, 'Your order is on its way');
  assert.equal(body.questions.fate.type, 'choice');
  assert.ok(EmailFate.TERMINATE in body.questions.fate.criteria);
  assert.ok(!(EmailFate.HUMAN_REVIEW in body.questions.fate.criteria));
});

test('uses the calibrated confidence and summarizes probabilities', async () => {
  const { fn } = fakeFetch([json(layaResponse('ARCHIVE_RECEIPTS'))]);
  const result = await new SystemOneClassifier(CONFIG, fn, noSleep).classify([makeEmail()]);

  assert.deepEqual(result.failed, []);
  const [c] = result.classifications;
  assert.equal(c.category, EmailFate.ARCHIVE_RECEIPTS);
  assert.equal(c.confidence, 0.82);
  assert.equal(c.source, 'system-one');
  assert.equal(c.reasoning, 'ARCHIVE_RECEIPTS 82%, KEEP_ACTION 10%, ARCHIVE_WORK 8%');
});

test('falls back to confidence when answer_confidence is absent', async () => {
  const { fn } = fakeFetch([json(layaResponse('TERMINATE', { answer_confidence: undefined }))]);
  const result = await new SystemOneClassifier(CONFIG, fn, noSleep).classify([makeEmail()]);
  assert.equal(result.classifications[0].confidence, 0.6);
});

test('retries when the server is busy', async () => {
  const { fn, calls } = fakeFetch([
    json({ detail: 'server busy' }, 503, { 'retry-after': '1' }),
    json(layaResponse('KEEP_ACTION')),
  ]);
  const result = await new SystemOneClassifier(CONFIG, fn, noSleep).classify([makeEmail()]);
  assert.equal(calls.length, 2);
  assert.equal(result.classifications[0].category, EmailFate.KEEP_ACTION);
});

test('reports failures instead of dropping emails', async () => {
  const { fn } = fakeFetch([
    json({ detail: 'unauthorized' }, 401),
    json(layaResponse('NOT_A_CATEGORY')),
  ]);
  const classifier = new SystemOneClassifier({ ...CONFIG, concurrency: 1 }, fn, noSleep);
  const result = await classifier.classify([makeEmail({ id: 'a' }), makeEmail({ id: 'b' })]);

  assert.equal(result.classifications.length, 0);
  assert.deepEqual(
    result.failed.map((f) => f.emailId),
    ['a', 'b']
  );
  assert.match(result.failed[0].error, /HTTP 401/);
  assert.match(result.failed[1].error, /unknown category/);
});
