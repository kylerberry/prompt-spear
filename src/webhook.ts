/**
 * Webhook adapter — POSTs attack prompts to a plain JSON endpoint using a
 * caller-supplied body template. The template is a JSON string containing
 * {{prompt}} which is substituted with the attack text before each request.
 *
 * Response text is extracted by trying common field names in priority order,
 * then falling back to the first string value in the object.
 */
import { EndpointError, backoffDelay, classifyStatus } from './endpoint.js';
import type { EndpointConfig } from './endpoint.js';

export interface WebhookConfig extends EndpointConfig {
  /** JSON body template with {{prompt}} placeholder. */
  bodyTemplate: string;
}

const PROMPT_PLACEHOLDER = /\{\{prompt\}\}/g;

const RESPONSE_FIELD_PRIORITY = [
  'response', 'output', 'text', 'message', 'content', 'reply', 'answer', 'result',
];

function extractResponseText(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new EndpointError('malformed-response', 'Response was not a JSON object');
  }
  const obj = raw as Record<string, unknown>;
  for (const field of RESPONSE_FIELD_PRIORITY) {
    if (typeof obj[field] === 'string') return obj[field] as string;
  }
  const firstString = Object.entries(obj).find(([, v]) => typeof v === 'string');
  if (firstString) return firstString[1] as string;
  throw new EndpointError(
    'malformed-response',
    `No string field found in response. Got keys: ${Object.keys(obj).join(', ') || '(none)'}`,
  );
}

async function attemptWebhookCall(config: WebhookConfig, prompt: string): Promise<string> {
  const body = config.bodyTemplate.replace(PROMPT_PLACEHOLDER, prompt);

  const headers = new Headers(config.headers);
  headers.set('content-type', 'application/json');
  if (config.apiKey) headers.set('authorization', `Bearer ${config.apiKey}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 60_000);

  let response: Response;
  try {
    response = await fetch(config.url, {
      method: 'POST',
      headers,
      body,
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
    throw new EndpointError(
      classifyStatus(response.status),
      `Endpoint returned HTTP ${response.status}`,
      response.status,
    );
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new EndpointError('malformed-response', 'Response body was not valid JSON');
  }

  return extractResponseText(raw);
}

export async function callWebhook(config: WebhookConfig, prompt: string): Promise<string> {
  const maxRetries = config.maxRetries ?? 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await attemptWebhookCall(config, prompt);
    } catch (err) {
      const isRateLimit = err instanceof EndpointError && err.kind === 'rate-limit';
      if (!isRateLimit || attempt >= maxRetries) throw err;
      const delayMs = backoffDelay(attempt);
      config.onRetry?.(attempt + 1, maxRetries, delayMs);
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new EndpointError('rate-limit', 'Exceeded max retries');
}
