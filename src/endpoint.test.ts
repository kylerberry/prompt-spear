import { afterEach, describe, expect, it, vi } from 'vitest';
import { EndpointError, callEndpoint, type EndpointConfig } from './endpoint.js';

const baseConfig: EndpointConfig = {
  url: 'https://api.example.com/v1/chat/completions',
  apiKey: 'secret-key',
};

function okResponse(content: string): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('callEndpoint', () => {
  it('parses the assistant response text from a successful response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('hello world'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callEndpoint(baseConfig, 'attack prompt');

    expect(result).toBe('hello world');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('sends an OpenAI-compatible request body with the prompt as a user message', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('ok'));
    vi.stubGlobal('fetch', fetchMock);

    await callEndpoint(baseConfig, 'attack prompt');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(baseConfig.url);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.messages).toEqual([{ role: 'user', content: 'attack prompt' }]);
  });

  it('passes the API key via the Authorization header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('ok'));
    vi.stubGlobal('fetch', fetchMock);

    await callEndpoint(baseConfig, 'attack prompt');

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe('Bearer secret-key');
  });

  it('injects an optional system prompt as the first message', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('ok'));
    vi.stubGlobal('fetch', fetchMock);

    await callEndpoint(
      { ...baseConfig, systemPrompt: 'You are a helpful assistant.' },
      'attack prompt',
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.messages).toEqual([
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'attack prompt' },
    ]);
  });

  it('merges custom headers onto the request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('ok'));
    vi.stubGlobal('fetch', fetchMock);

    await callEndpoint(
      { ...baseConfig, headers: { 'X-Org-Id': 'org-123' } },
      'attack prompt',
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('x-org-id')).toBe('org-123');
    expect(headers.get('authorization')).toBe('Bearer secret-key');
  });

  it('throws a typed auth error on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 401 })));

    await expect(callEndpoint(baseConfig, 'p')).rejects.toMatchObject({
      name: 'EndpointError',
      kind: 'auth',
    });
  });

  it('throws a typed rate-limit error on 429', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('slow', { status: 429 })));

    await expect(callEndpoint(baseConfig, 'p')).rejects.toMatchObject({
      kind: 'rate-limit',
    });
  });

  it('throws a typed server error on 5xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 503 })));

    await expect(callEndpoint(baseConfig, 'p')).rejects.toMatchObject({
      kind: 'server',
    });
  });

  it('throws a typed error for a non-2xx status not otherwise classified', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad', { status: 400 })));

    await expect(callEndpoint(baseConfig, 'p')).rejects.toBeInstanceOf(EndpointError);
  });

  it('throws a typed error when the response body is malformed JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );

    await expect(callEndpoint(baseConfig, 'p')).rejects.toMatchObject({
      kind: 'malformed-response',
    });
  });

  it('throws a typed error when the response shape is unexpected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ unexpected: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await expect(callEndpoint(baseConfig, 'p')).rejects.toMatchObject({
      kind: 'malformed-response',
    });
  });

  it('throws a typed network error when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('connection refused')));

    await expect(callEndpoint(baseConfig, 'p')).rejects.toMatchObject({
      kind: 'network',
    });
  });

  it('never includes the API key in the error message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 401 })));

    const err = await callEndpoint(baseConfig, 'p').catch((e: unknown) => e as Error);
    expect(err.message).not.toContain('secret-key');
  });

  it('retries on 429 up to maxRetries times then succeeds', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('slow down', { status: 429 }))
      .mockResolvedValueOnce(new Response('slow down', { status: 429 }))
      .mockResolvedValue(okResponse('ok'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callEndpoint({ ...baseConfig, maxRetries: 3 }, 'p');

    expect(result).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('throws rate-limit after exhausting all retries', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('slow down', { status: 429 })));

    await expect(callEndpoint({ ...baseConfig, maxRetries: 2 }, 'p')).rejects.toMatchObject({
      kind: 'rate-limit',
    });
  });

  it('calls onRetry with attempt number and delay before each retry', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('slow down', { status: 429 }))
      .mockResolvedValue(okResponse('ok'));
    vi.stubGlobal('fetch', fetchMock);

    const onRetry = vi.fn();
    await callEndpoint({ ...baseConfig, maxRetries: 2, onRetry }, 'p');

    expect(onRetry).toHaveBeenCalledOnce();
    expect(onRetry).toHaveBeenCalledWith(1, 2, expect.any(Number));
  });

  it('does not retry on non-429 errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('nope', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(callEndpoint({ ...baseConfig, maxRetries: 3 }, 'p')).rejects.toMatchObject({
      kind: 'server',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
