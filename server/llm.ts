/**
 * LLM gateway (Figure 1, step 4). The browser never calls the provider
 * directly: it posts to /api/llm and this module either runs the built-in
 * MOCK provider or forwards the request to an OpenAI-compatible
 * /chat/completions endpoint.
 *
 * API key resolution: the key typed in the UI (sent per request in the
 * X-OpenAI-Key header, never stored) wins; otherwise OPENAI_API_KEY from the
 * server environment. The base URL is only configurable server-side
 * (OPENAI_BASE_URL) so the server cannot be used as an open proxy.
 */
import type { ChatMessage, LLMCallBody, LLMErrorBody, LLMRequest, LLMResult } from '../shared/types';
import { MAX_CHAT_MESSAGES, MAX_INSTRUCTION_CHARS, MAX_TEXT_CHARS, buildChatMessages, buildScopedMessages, cleanScopedResult } from '../shared/prompts';
import { mockComplete } from '../shared/mockLLM';

export interface LLMConfig {
  envApiKey?: string;
  baseUrl: string;
  defaultModel: string;
  mockLatencyMs: number;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export class LLMError extends Error {
  constructor(public status: number, public body: LLMErrorBody) {
    super(body.error);
  }
}


export function validateCallBody(body: unknown): LLMCallBody {
  const bad = (msg: string) => new LLMError(400, { error: msg, code: 'bad_request' });
  if (!body || typeof body !== 'object') throw bad('Request body must be a JSON object.');
  const b = body as Record<string, unknown>;
  if (b.provider !== 'mock' && b.provider !== 'openai') throw bad('provider must be "mock" or "openai".');
  if (b.model !== undefined && (typeof b.model !== 'string' || b.model.length > 100)) throw bad('model must be a short string.');
  const r = b.request as Record<string, unknown> | undefined;
  if (!r || typeof r !== 'object') throw bad('request is required.');
  const str = (v: unknown, name: string, max = MAX_TEXT_CHARS) => {
    if (typeof v !== 'string') throw bad(`${name} must be a string.`);
    if (v.length > max) throw bad(`${name} is too long (at most ${max.toLocaleString('en-US')} characters).`);
    return v;
  };
  let request: LLMRequest;
  if (r.kind === 'scoped') {
    request = {
      kind: 'scoped',
      commandId: str(r.commandId, 'commandId', 100),
      instruction: str(r.instruction, 'instruction', MAX_INSTRUCTION_CHARS),
      selection: str(r.selection, 'selection'),
      contextBefore: str(r.contextBefore, 'contextBefore'),
      contextAfter: str(r.contextAfter, 'contextAfter'),
      variant: typeof r.variant === 'number' && r.variant >= 0 ? Math.floor(r.variant) : 0,
    };
    if (request.selection.trim().length === 0) throw bad('selection is empty.');
  } else if (r.kind === 'chat') {
    if (!Array.isArray(r.messages) || r.messages.length === 0 || r.messages.length > MAX_CHAT_MESSAGES) throw bad(`messages must be a non-empty array of at most ${MAX_CHAT_MESSAGES}.`);
    const messages: ChatMessage[] = r.messages.map((m: unknown) => {
      const mm = m as Record<string, unknown>;
      if (mm.role !== 'user' && mm.role !== 'assistant') throw bad('message role must be user or assistant.');
      // Assistant answers in the baseline can contain the whole document, so messages get the document limit.
      return { role: mm.role, content: str(mm.content, 'message content') };
    });
    request = { kind: 'chat', document: str(r.document, 'document'), messages };
  } else {
    throw bad('request.kind must be "scoped" or "chat".');
  }
  return { provider: b.provider, model: typeof b.model === 'string' && b.model.trim() ? b.model.trim() : undefined, request };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function completeLLM(call: LLMCallBody, uiKey: string | undefined, config: LLMConfig): Promise<LLMResult> {
  const started = Date.now();
  if (call.provider === 'mock') {
    if (config.mockLatencyMs > 0) await sleep(config.mockLatencyMs);
    let text = mockComplete(call.request);
    if (call.request.kind === 'scoped') text = cleanScopedResult(call.request.selection, text);
    return { text, provider: 'mock', model: 'mock-deterministic', latencyMs: Date.now() - started };
  }

  const apiKey = uiKey?.trim() || config.envApiKey?.trim();
  if (!apiKey) {
    throw new LLMError(400, {
      error: 'No OpenAI API key: enter one in the settings or start the server with OPENAI_API_KEY. You can also switch to the MOCK provider.',
      code: 'no_key',
    });
  }
  const model = call.model ?? config.defaultModel;
  const messages = call.request.kind === 'scoped' ? buildScopedMessages(call.request) : buildChatMessages(call.request);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const timeoutError = () =>
    new LLMError(504, { error: `The LLM provider did not answer within ${Math.round(config.timeoutMs / 1000)} s.`, code: 'timeout' });
  let response: Response;
  let payload: unknown = null;
  try {
    try {
      response = await (config.fetchImpl ?? fetch)(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages }),
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) throw timeoutError();
      throw new LLMError(502, { error: 'Could not reach the LLM provider (network error).', code: 'network' });
    }
    // The timeout also covers reading the body: a provider can send headers and then stall.
    try {
      payload = await response.json();
    } catch {
      if (controller.signal.aborted) throw timeoutError();
      payload = null;
    }
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const providerMsg = extractProviderError(payload);
    if (response.status === 401 || response.status === 403) {
      throw new LLMError(401, { error: `The API key was rejected by the provider${providerMsg ? `: ${providerMsg}` : '.'}`, code: 'auth' });
    }
    if (response.status === 429) {
      throw new LLMError(429, { error: `Rate limit or quota exceeded${providerMsg ? `: ${providerMsg}` : '.'}`, code: 'rate_limit' });
    }
    throw new LLMError(502, { error: `The LLM provider returned an error (${response.status})${providerMsg ? `: ${providerMsg}` : '.'}`, code: 'provider_error' });
  }
  const content = extractContent(payload);
  if (content === null) {
    throw new LLMError(502, { error: 'The LLM provider returned an empty answer.', code: 'provider_error' });
  }
  const text = call.request.kind === 'scoped' ? cleanScopedResult(call.request.selection, content) : content.trim();
  return { text, provider: 'openai', model, latencyMs: Date.now() - started };
}

function extractProviderError(payload: unknown): string | null {
  const err = (payload as { error?: { message?: unknown } } | null)?.error;
  return err && typeof err.message === 'string' ? err.message.slice(0, 300) : null;
}

function extractContent(payload: unknown): string | null {
  const choices = (payload as { choices?: Array<{ message?: { content?: unknown } }> } | null)?.choices;
  const content = choices?.[0]?.message?.content;
  return typeof content === 'string' && content.trim().length > 0 ? content : null;
}
