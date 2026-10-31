import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../server/config.js';
import { generateDraft } from '../server/worker.js';
const originalConfig = { ...config }, originalFetch = globalThis.fetch;
const answer = { reply: 'Returns are accepted within 7 days of delivery for unopened, unused products.', policy_ids: ['returns'], needs_human_review: false, reason_code: 'policy_answer' };
beforeEach(() => { config.llmKey = 'unit-test-key'; config.llmBaseUrl = 'https://openrouter.ai/api/v1'; config.llmModel = 'test/primary:free'; config.llmFallbackModels = ['test/fallback:free']; });
afterEach(() => { Object.assign(config,originalConfig); globalThis.fetch = originalFetch; });
test('provider capacity failures fall back under one timeout and record the served model', async () => {
  const calls: { model: string; signal: unknown }[] = [];
  globalThis.fetch = (async (_url,options) => {
    const body = JSON.parse(options!.body as string);
    calls.push({ model: body.model, signal: options?.signal });
    assert.equal(body.reasoning.enabled,false);
    if (calls.length === 1) return new Response('{}',{ status: 429 });
    return Response.json({ model: 'test/actual-served-model', choices: [{ message: { content: JSON.stringify(answer) } }] });
  }) as typeof fetch;
  const output = await generateDraft([{ sender: 'customer',text: 'Returns?' }]);
  assert.deepEqual(calls.map(call => call.model),['test/primary:free','test/fallback:free']);
  assert.equal(calls[0].signal,calls[1].signal);
  assert.equal(output.model,'test/actual-served-model');
});
test('invalid credentials stop without trying another model', async () => {
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response('{}',{ status: 401 }); }) as typeof fetch;
  await assert.rejects(generateDraft([]),{ code: 'provider_http_401' });
  assert.equal(calls,1);
});
test('a free primary cannot silently fall back to a paid model', async () => {
  config.llmFallbackModels = ['test/paid'];
  let called = false;
  globalThis.fetch = (async () => { called = true; return new Response('{}'); }) as typeof fetch;
  await assert.rejects(generateDraft([]),{ code: 'non_free_fallback_not_allowed' });
  assert.equal(called,false);
});
