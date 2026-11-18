import { describe, expect, it } from 'vitest';
import { completeLLM, LLMError, validateCallBody, type LLMConfig } from '../server/llm';
import type { LLMCallBody } from '../shared/types';

const scoped: LLMCallBody = {
  provider: 'openai',
  request: { kind: 'scoped', commandId: 'shorten', instruction: 'Shorter', selection: ' Long text here. ', contextBefore: 'A', contextAfter: 'B', variant: 0 },
};

function config(fetchImpl: typeof fetch, envApiKey?: string): LLMConfig {
  return { envApiKey, baseUrl: 'https://llm.example/v1', defaultModel: 'gpt-test', mockLatencyMs: 0, timeoutMs: 200, fetchImpl };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function expectLLMError(p: Promise<unknown>, code: string, status: number) {
  await expect(p).rejects.toBeInstanceOf(LLMError);
  await p.catch((e: LLMError) => {
    expect(e.body.code).toBe(code);
    expect(e.status).toBe(status);
  });
}

describe('validateCallBody', () => {
  it('accepts valid bodies and rejects malformed ones', () => {
    expect(validateCallBody({ provider: 'mock', request: scoped.request }).provider).toBe('mock');
    expect(() => validateCallBody(null)).toThrow(LLMError);
    expect(() => validateCallBody({ provider: 'x', request: scoped.request })).toThrow(/provider/);
    expect(() => validateCallBody({ provider: 'mock', request: { kind: 'scoped', selection: '   ', instruction: '', commandId: 'a', contextBefore: '', contextAfter: '' } })).toThrow(/empty/);
    expect(() => validateCallBody({ provider: 'mock', request: { kind: 'chat', document: '', messages: [] } })).toThrow(/messages/);
    expect(() => validateCallBody({ provider: 'mock', request: { kind: 'chat', document: '', messages: [{ role: 'system', content: 'x' }] } })).toThrow(/role/);
  });
});

describe('completeLLM', () => {
  it('mock provider needs no key and is labelled', async () => {
    const r = await completeLLM({ ...scoped, provider: 'mock' }, undefined, config(fetch));
    expect(r.provider).toBe('mock');
    expect(r.model).toBe('mock-deterministic');
    expect(r.text.startsWith(' ') && r.text.endsWith(' ')).toBe(true);
  });

  it('requires a key for the OpenAI provider', async () => {
    await expectLLMError(completeLLM(scoped, undefined, config(fetch)), 'no_key', 400);
  });

  it('prefers the UI key, sends the DirectGPT-style prompt, cleans the reply', async () => {
    let seen: { url: string; auth: string; body: { model: string; messages: Array<{ content: string }> } } | null = null;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, auth: (init.headers as Record<string, string>).Authorization, body: JSON.parse(String(init.body)) };
      return jsonResponse(200, { choices: [{ message: { content: '<blank>: Short text.' } }] });
    }) as unknown as typeof fetch;
    const r = await completeLLM({ ...scoped, model: 'gpt-x' }, 'sk-ui', config(fake, 'sk-env'));
    expect(r).toMatchObject({ text: ' Short text. ', provider: 'openai', model: 'gpt-x' });
    expect(seen!.url).toBe('https://llm.example/v1/chat/completions');
    expect(seen!.auth).toBe('Bearer sk-ui');
    expect(seen!.body.messages[1].content).toContain('Rewrite <blank>. Follow INSTRUCTION');
  });

  it('falls back to the server key', async () => {
    let auth = '';
    const fake = (async (_url: string, init: RequestInit) => {
      auth = (init.headers as Record<string, string>).Authorization;
      return jsonResponse(200, { choices: [{ message: { content: 'ok' } }] });
    }) as unknown as typeof fetch;
    await completeLLM(scoped, undefined, config(fake, 'sk-env'));
    expect(auth).toBe('Bearer sk-env');
  });

  it('maps a bad key to a friendly auth error', async () => {
    const fake = (async () => jsonResponse(401, { error: { message: 'Incorrect API key provided' } })) as unknown as typeof fetch;
    await expectLLMError(completeLLM(scoped, 'sk-bad', config(fake)), 'auth', 401);
  });

  it('maps rate limits, provider errors, empty answers, network failures and timeouts', async () => {
    await expectLLMError(completeLLM(scoped, 'k', config((async () => jsonResponse(429, {})) as unknown as typeof fetch)), 'rate_limit', 429);
    await expectLLMError(completeLLM(scoped, 'k', config((async () => jsonResponse(500, {})) as unknown as typeof fetch)), 'provider_error', 502);
    await expectLLMError(completeLLM(scoped, 'k', config((async () => jsonResponse(200, { choices: [] })) as unknown as typeof fetch)), 'provider_error', 502);
    await expectLLMError(completeLLM(scoped, 'k', config((async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch)), 'network', 502);
    const hang = ((_u: string, init: RequestInit) => new Promise((_res, rej) => {
      init.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })) as unknown as typeof fetch;
    await expectLLMError(completeLLM(scoped, 'k', config(hang)), 'timeout', 504);
  });
});
