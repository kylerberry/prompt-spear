import { afterEach, describe, expect, it, vi } from 'vitest';
import { callWebhook, type WebhookConfig } from './webhook.js';
import { EndpointError } from './endpoint.js';

const baseConfig: WebhookConfig = {
  url: 'https://example.com/api/chat',
  apiKey: 'secret-key',
  bodyTemplate: '{"message":"{{prompt}}","sessionId":"abc"}',
};

function okResponse(body: object): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponse(status: number): Response {
  return new Response('error', { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('callWebhook', () => {
  it('substitutes {{prompt}} into the body template', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ response: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    await callWebhook(baseConfig, 'hello world');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.message).toBe('hello world');
    expect(body.sessionId).toBe('abc');
  });

  it('JSON-escapes special characters in the prompt', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ response: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    await callWebhook(baseConfig, 'say "hello" and \\escape');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.message).toBe('say "hello" and \\escape');
  });

  it('auto-detects response text from a priority field name', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ response: 'the reply' })));
    expect(await callWebhook(baseConfig, 'prompt')).toBe('the reply');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ output: 'the reply' })));
    expect(await callWebhook(baseConfig, 'prompt')).toBe('the reply');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ text: 'the reply' })));
    expect(await callWebhook(baseConfig, 'prompt')).toBe('the reply');
  });

  it('falls back to the first string value when no priority field matches', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ custom_field: 'reply', count: 1 })));
    expect(await callWebhook(baseConfig, 'prompt')).toBe('reply');
  });

  it('throws malformed-response when no string field exists', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ code: 200 })));
    await expect(callWebhook(baseConfig, 'prompt')).rejects.toMatchObject({
      kind: 'malformed-response',
    });
  });

  it('sets the Authorization header from apiKey', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ response: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    await callWebhook(baseConfig, 'prompt');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers as HeadersInit);
    expect(headers.get('authorization')).toBe('Bearer secret-key');
  });

  it('omits Authorization header when apiKey is empty', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ response: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    await callWebhook({ ...baseConfig, apiKey: '' }, 'prompt');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers as HeadersInit);
    expect(headers.get('authorization')).toBeNull();
  });

  it('throws auth error on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(401)));
    await expect(callWebhook(baseConfig, 'prompt')).rejects.toMatchObject({ kind: 'auth', status: 401 });
  });

  it('throws auth error on 403', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(403)));
    await expect(callWebhook(baseConfig, 'prompt')).rejects.toMatchObject({ kind: 'auth', status: 403 });
  });

  it('throws rate-limit error on 429', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(429)));
    await expect(callWebhook(baseConfig, 'prompt')).rejects.toMatchObject({ kind: 'rate-limit' });
  });

  it('throws server error on 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(500)));
    await expect(callWebhook(baseConfig, 'prompt')).rejects.toMatchObject({ kind: 'server' });
  });

  it('throws network error on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));
    await expect(callWebhook(baseConfig, 'prompt')).rejects.toMatchObject({ kind: 'network' });
  });

  it('retries on 429 up to maxRetries times', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(errorResponse(429))
      .mockResolvedValueOnce(errorResponse(429))
      .mockResolvedValue(okResponse({ response: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callWebhook({ ...baseConfig, maxRetries: 3 }, 'prompt');

    expect(result).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('calls onRetry before each retry delay', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(errorResponse(429))
      .mockResolvedValue(okResponse({ response: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    const onRetry = vi.fn();
    await callWebhook({ ...baseConfig, maxRetries: 2, onRetry }, 'prompt');

    expect(onRetry).toHaveBeenCalledOnce();
    expect(onRetry).toHaveBeenCalledWith(1, 2, expect.any(Number));
  });

  it('throws after exhausting all retries', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(429)));
    await expect(callWebhook({ ...baseConfig, maxRetries: 2 }, 'prompt')).rejects.toMatchObject({
      kind: 'rate-limit',
    });
  });
});
