import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { streamMessageOllama } from '../src/services/llm/ollama';
import type { StreamCallbacks, StreamOptions } from '../src/services/llm/types';

interface MockFetchCall {
  url: string;
  method: string;
  authorization: string | null;
  body: unknown;
}

function makeNdjsonResponse(chunks: string[], status = 200): Response {
  // Each entry in `chunks` is a raw byte segment as it would arrive over the
  // wire — typically one or more NDJSON lines plus a trailing newline, but
  // we deliberately split a few tests mid-line to exercise the buffer code.
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { 'Content-Type': 'application/x-ndjson' },
  });
}

function installMockFetch(handler: (call: MockFetchCall) => Response): {
  calls: MockFetchCall[];
  restore: () => void;
} {
  const calls: MockFetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headers = new Headers(init?.headers ?? {});
    const call: MockFetchCall = {
      url,
      method: init?.method ?? 'GET',
      authorization: headers.get('authorization'),
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    };
    calls.push(call);
    return handler(call);
  }) as typeof globalThis.fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function baseOptions(overrides: Partial<StreamOptions> = {}): StreamOptions {
  return {
    apiKey: 'ollama-key',
    model: 'gpt-oss:120b-cloud',
    messages: [{ role: 'user', content: 'Hello' }],
    ...overrides,
  };
}

describe('streamMessageOllama', () => {
  let restoreFetch: (() => void) | null = null;

  beforeEach(() => {
    restoreFetch = null;
  });

  afterEach(() => {
    restoreFetch?.();
  });

  it('throws and calls onError when model is missing', async () => {
    const onError = vi.fn();
    await expect(
      streamMessageOllama({ ...baseOptions(), model: undefined } as StreamOptions, { onError } as StreamCallbacks),
    ).rejects.toThrow(/requires a model name/i);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toMatch(/requires a model name/i);
  });

  it('throws and calls onError when apiKey is missing', async () => {
    const onError = vi.fn();
    await expect(
      streamMessageOllama({ ...baseOptions(), apiKey: '' }, { onError } as StreamCallbacks),
    ).rejects.toThrow(/api key is missing/i);
    expect(onError).toHaveBeenCalled();
  });

  it('POSTs to /api/ollama-proxy with bearer auth, the model, and flattened messages', async () => {
    const { calls, restore } = installMockFetch(() =>
      makeNdjsonResponse([
        JSON.stringify({ message: { role: 'assistant', content: 'Hi.' }, done: true }) + '\n',
      ]),
    );
    restoreFetch = restore;

    await streamMessageOllama(baseOptions({ system: 'be brief' }), {});

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/ollama-proxy');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].authorization).toBe('Bearer ollama-key');
    // System prompt is prepended as the first message.
    const body = calls[0].body as { model: string; messages: Array<{ role: string; content: string }>; stream: boolean };
    expect(body.model).toBe('gpt-oss:120b-cloud');
    expect(body.stream).toBe(true);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'be brief' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'Hello' });
  });

  it('flattens Anthropic-style content-block arrays into plain text', async () => {
    const { calls, restore } = installMockFetch(() =>
      makeNdjsonResponse([
        JSON.stringify({ message: { role: 'assistant', content: 'ok' }, done: true }) + '\n',
      ]),
    );
    restoreFetch = restore;

    await streamMessageOllama(
      baseOptions({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Line 1' },
              { type: 'text', text: 'Line 2' },
              { type: 'tool_use', id: 'x', name: 'y', input: {} },
            ],
          },
        ] as StreamOptions['messages'],
      }),
      {},
    );

    const body = calls[0].body as { messages: Array<{ content: string }> };
    expect(body.messages[0].content).toBe('Line 1\nLine 2');
  });

  it('streams content deltas to onText and accumulates the full response', async () => {
    const { restore } = installMockFetch(() =>
      makeNdjsonResponse([
        JSON.stringify({ message: { role: 'assistant', content: 'Hello' } }) + '\n',
        JSON.stringify({ message: { role: 'assistant', content: ' world' } }) + '\n',
        JSON.stringify({ done: true }) + '\n',
      ]),
    );
    restoreFetch = restore;

    const onText = vi.fn();
    const onDone = vi.fn();
    const full = await streamMessageOllama(baseOptions(), { onText, onDone });

    expect(onText.mock.calls.map(c => c[0])).toEqual(['Hello', ' world']);
    expect(full).toBe('Hello world');
    expect(onDone).toHaveBeenCalledWith('Hello world');
  });

  it('routes thinking deltas to onThinking and does not append them to onText / full text', async () => {
    const { restore } = installMockFetch(() =>
      makeNdjsonResponse([
        JSON.stringify({ message: { thinking: 'Planning the answer...' } }) + '\n',
        JSON.stringify({ message: { content: 'Final answer.' }, done: true }) + '\n',
      ]),
    );
    restoreFetch = restore;

    const onText = vi.fn();
    const onThinking = vi.fn();
    const full = await streamMessageOllama(baseOptions(), { onText, onThinking });

    expect(onThinking).toHaveBeenCalledWith('Planning the answer...');
    expect(onText).toHaveBeenCalledWith('Final answer.');
    expect(full).toBe('Final answer.');
  });

  it('survives a chunk that splits an NDJSON line across two TCP frames', async () => {
    const fullLine = JSON.stringify({ message: { content: 'spanned' }, done: true }) + '\n';
    const cut = Math.floor(fullLine.length / 2);
    const { restore } = installMockFetch(() =>
      makeNdjsonResponse([fullLine.slice(0, cut), fullLine.slice(cut)]),
    );
    restoreFetch = restore;

    const onText = vi.fn();
    const full = await streamMessageOllama(baseOptions(), { onText });

    expect(onText).toHaveBeenCalledWith('spanned');
    expect(full).toBe('spanned');
  });

  it('skips malformed NDJSON lines without aborting the stream', async () => {
    const { restore } = installMockFetch(() =>
      makeNdjsonResponse([
        'this is not valid json\n',
        JSON.stringify({ message: { content: 'survived' }, done: true }) + '\n',
      ]),
    );
    restoreFetch = restore;

    const onText = vi.fn();
    const full = await streamMessageOllama(baseOptions(), { onText });

    expect(full).toBe('survived');
    expect(onText).toHaveBeenCalledWith('survived');
  });

  it('throws "Ollama Cloud {status}" and calls onError when the response is not ok', async () => {
    const { restore } = installMockFetch(() => new Response('rate-limit detail', { status: 429 }));
    restoreFetch = restore;

    const onError = vi.fn();
    await expect(streamMessageOllama(baseOptions(), { onError })).rejects.toThrow(/Ollama Cloud 429.*rate-limit detail/);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('does not call onText / onDone when the response is empty (no content chunks)', async () => {
    const { restore } = installMockFetch(() =>
      makeNdjsonResponse([JSON.stringify({ done: true }) + '\n']),
    );
    restoreFetch = restore;

    const onText = vi.fn();
    const onDone = vi.fn();
    const full = await streamMessageOllama(baseOptions(), { onText, onDone });

    expect(onText).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith('');
    expect(full).toBe('');
  });
});
