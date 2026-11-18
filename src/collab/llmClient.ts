/** Browser side of the LLM gateway: always goes through the local server. */
import type { LLMCallBody, LLMErrorBody, LLMResponse, LLMResult, ServerConfig } from '../../shared/types';

export class LLMClientError extends Error {
  constructor(message: string, public code: LLMErrorBody['code'] | 'server_unreachable') {
    super(message);
  }
}

export async function callLLM(body: LLMCallBody, apiKey: string): Promise<LLMResult> {
  let response: Response;
  try {
    response = await fetch('/api/llm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(body.provider === 'openai' && apiKey.trim() ? { 'X-OpenAI-Key': apiKey.trim() } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new LLMClientError('Cannot reach the Collaborative DirectGPT server. Is it running?', 'server_unreachable');
  }
  let payload: LLMResponse | null = null;
  try {
    payload = (await response.json()) as LLMResponse;
  } catch {
    payload = null;
  }
  if (!payload) {
    throw new LLMClientError(`The server answered with status ${response.status}.`, 'provider_error');
  }
  if (!payload.ok) {
    throw new LLMClientError(payload.error ?? `The server answered with status ${response.status}.`, payload.code ?? 'provider_error');
  }
  if (typeof payload.text !== 'string') {
    throw new LLMClientError('The server returned an invalid answer.', 'provider_error');
  }
  const { ok: _ok, ...result } = payload;
  void _ok;
  return result as LLMResult;
}

export async function fetchServerConfig(): Promise<ServerConfig | null> {
  try {
    const r = await fetch('/api/config');
    if (!r.ok) return null;
    return (await r.json()) as ServerConfig;
  } catch {
    return null;
  }
}
