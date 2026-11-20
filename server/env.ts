/** Parsing of numeric environment variables (a typo must not silently break the server). */

export interface NumberEnvOptions {
  min: number;
  max: number;
}

/**
 * Number from an environment variable, or `fallback` when it is unset. An
 * invalid or out-of-range value also gives `fallback`, plus a warning to print:
 * for example LLM_TIMEOUT_MS=60s would otherwise become NaN, which Node treats
 * as a 1 ms timer, and every OpenAI request would time out at once.
 */
export function numberFromEnv(
  name: string,
  raw: string | undefined,
  fallback: number,
  { min, max }: NumberEnvOptions,
): { value: number; warning: string | null } {
  if (raw === undefined || raw.trim() === '') return { value: fallback, warning: null };
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
    return { value: fallback, warning: `${name}="${raw}" is not a whole number between ${min} and ${max}; using ${fallback}.` };
  }
  return { value, warning: null };
}
