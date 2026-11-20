import { describe, expect, it } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { completeLLM, LLMError } from '../server/llm';

describe('LLM gateway timeout', () => {
  it('also times out when the provider sends headers and then stalls the body', async () => {
    const stall = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{"choices": [');
      // never ends
    });
    await new Promise<void>((resolve) => stall.listen(0, '127.0.0.1', resolve));
    const stallPort = (stall.address() as AddressInfo).port;
    try {
      const started = Date.now();
      const p = completeLLM(
        { provider: 'openai', request: { kind: 'chat', document: 'Doc.', messages: [{ role: 'user', content: 'Hi' }] } },
        'sk-test',
        { baseUrl: `http://127.0.0.1:${stallPort}/v1`, defaultModel: 'gpt-test', mockLatencyMs: 0, timeoutMs: 300 },
      );
      await expect(p).rejects.toBeInstanceOf(LLMError);
      await p.catch((e: LLMError) => expect(e.body.code).toBe('timeout'));
      expect(Date.now() - started).toBeLessThan(3000);
    } finally {
      stall.closeAllConnections();
      await new Promise<void>((resolve) => stall.close(() => resolve()));
    }
  });
});
