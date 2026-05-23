/**
 * Webhook adapter — sends attack prompts to a plain JSON HTTP endpoint
 * (non-OpenAI). The request and response field names are caller-configured.
 *
 * Uses the same EndpointError / retry infrastructure as the OpenAI adapter.
 */
import { z } from 'zod';
import { EndpointError, backoffDelay } from './endpoint.js';
import type { EndpointConfig } from './endpoint.js';

/** Extra config specific to plain webhook endpoints. */
export interface WebhookConfig extends EndpointConfig {
  /** Body field that receives the attack prompt. e.g. "message", "input" */
  promptField: string;
  /** Top-level response field that contains the reply text. e.g. "response", "output" */
  responseField: string;
}

/** Single POST attempt — no retry logic. */
async function attemptWebhookCall(
  config: WebhookConfig,
  prompt: string,
): Promise<string> {
  const headers = new Headers(config.headers);
  headers.set('content-type', 'application/json');
  if (config.apiKey) {
    headers.set('authorization', `Bearer ${config.apiKey}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    config.timeoutMs ?? 60_000,
  );

  let response: Response;
  try {
    response = await fetch(config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ [config.promptField]: prompt }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new EndpointError('timeout', 'Request to endpoint timed out');
    }
    const detail = err instanceof Error ? err.message : 'unknown error';
    throw new EndpointError('network', `Network request failed: ${detail}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const kind =
      response.status === 401 || response.status === 403
        ? 'auth'
        : response.status === 429
          ? 'rate-limit'
          : response.status >= 500
            ? 'server'
            : 'http';
    throw new EndpointError(kind, `Endpoint returned HTTP ${response.status}`, response.status);
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new EndpointError('malformed-response', 'Response body was not valid JSON');
  }

  const schema = z.object({ [config.responseField]: z.string() });
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new EndpointError(
      'malformed-response',
      `Response did not contain a string field "${config.responseField}". ` +
        `Got keys: ${Object.keys(raw as object).join(', ') || '(none)'}`,
    );
  }

  return (parsed.data as Record<string, string>)[config.responseField]!;
}

/**
 * POST `prompt` to a plain JSON webhook and return the reply text.
 * Retries on 429 with exponential backoff (same policy as the OpenAI adapter).
 */
export async function callWebhook(
  config: WebhookConfig,
  prompt: string,
): Promise<string> {
  const maxRetries = config.maxRetries ?? 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await attemptWebhookCall(config, prompt);
    } catch (err) {
      const isRateLimit = err instanceof EndpointError && err.kind === 'rate-limit';
      const hasRetries = attempt < maxRetries;
      if (!isRateLimit || !hasRetries) throw err;

      const delayMs = backoffDelay(attempt);
      config.onRetry?.(attempt + 1, maxRetries, delayMs);
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new EndpointError('rate-limit', 'Exceeded max retries');
}
