import { describe, expect, it } from 'vitest';
import { numberFromEnv } from '../server/env';

describe('numberFromEnv', () => {
  const range = { min: 1000, max: 600_000 };
  it('uses the fallback when unset and the value when valid', () => {
    expect(numberFromEnv('LLM_TIMEOUT_MS', undefined, 60_000, range)).toEqual({ value: 60_000, warning: null });
    expect(numberFromEnv('LLM_TIMEOUT_MS', ' 30000 ', 60_000, range)).toEqual({ value: 30_000, warning: null });
  });
  it('falls back with a warning on typos and out-of-range values instead of producing NaN', () => {
    for (const raw of ['60s', 'abc', '-5', '1.5', '0', '99999999']) {
      const r = numberFromEnv('LLM_TIMEOUT_MS', raw, 60_000, range);
      expect(r.value).toBe(60_000);
      expect(r.warning).toContain('LLM_TIMEOUT_MS');
    }
  });
});
