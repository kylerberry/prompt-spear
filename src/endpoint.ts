/**
 * Endpoint adapter — the only module that performs I/O against the target LLM.
 *
 * Sends a single probe's attack prompt to an OpenAI-compatible
 * `POST /chat/completions` endpoint and returns the assistant response text.
 * All failures surface as a typed {@link EndpointError}.
 */
import { z } from 'zod';

/** Configuration describing the target endpoint. */
export interface EndpointConfig {
  /** OpenAI-compatible chat completions URL. */
  url: string;
  /** API key sent as `Authorization: Bearer <key>`. */
  apiKey: string;
  /** Optional model identifier sent in the request body. */
  model?: string;
  /** Optional system prompt injected as the first message. */
  systemPrompt?: string;
  /** Optional custom headers merged on top of the defaults. */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds. Default: 60000. */
  timeoutMs?: number;
}

/** Classification of an endpoint failure. */
export type EndpointErrorKind =
  | 'auth'
  | 'rate-limit'
  | 'server'
  | 'http'
  | 'malformed-response'
  | 'network'
  | 'timeout';

/** Typed error raised for every endpoint failure. Never contains the API key. */
export class EndpointError extends Error {
  override readonly name = 'EndpointError';
  readonly kind: EndpointErrorKind;
  readonly status?: number;

  constructor(kind: EndpointErrorKind, message: string, status?: number) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

const DEFAULT_TIMEOUT_MS = 60_000;

/** Minimal OpenAI-compatible chat completion response shape. */
const chatCompletionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string(),
        }),
      }),
    )
    .min(1),
});

function classifyStatus(status: number): EndpointErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate-limit';
  if (status >= 500) return 'server';
  return 'http';
}

/**
 * Sends `prompt` as a user message to the configured endpoint and returns the
 * assistant's response text.
 *
 * @throws {EndpointError} on auth, rate-limit, server, network, timeout, or
 *   malformed-response failures.
 */
export async function callEndpoint(
  config: EndpointConfig,
  prompt: string,
): Promise<string> {
  const messages: { role: 'system' | 'user'; content: string }[] = [];
  if (config.systemPrompt) {
    messages.push({ role: 'system', content: config.systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const body: Record<string, unknown> = { messages };
  if (config.model) body.model = config.model;

  const headers = new Headers(config.headers);
  headers.set('content-type', 'application/json');
  headers.set('authorization', `Bearer ${config.apiKey}`);

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  let response: Response;
  try {
    response = await fetch(config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new EndpointError('timeout', 'Request to endpoint timed out');
    }
    const detail = err instanceof Error ? err.message : 'unknown error';
    throw new EndpointError('network', `Network request to endpoint failed: ${detail}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const kind = classifyStatus(response.status);
    throw new EndpointError(
      kind,
      `Endpoint returned HTTP ${response.status}`,
      response.status,
    );
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new EndpointError(
      'malformed-response',
      'Endpoint response body was not valid JSON',
    );
  }

  const parsed = chatCompletionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new EndpointError(
      'malformed-response',
      'Endpoint response did not match the expected chat completion shape',
    );
  }

  return parsed.data.choices[0]!.message.content;
}
