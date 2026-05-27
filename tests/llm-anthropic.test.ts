import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Claude client module so streamMessageAnthropic uses our fake
// instead of trying to instantiate the real SDK + hit the network. The
// streaming function expects the client to expose `.messages.stream()` and
// `.messages.create()`.
const { mockStream, mockCreate, mockGetClient } = vi.hoisted(() => ({
  mockStream: vi.fn(),
  mockCreate: vi.fn(),
  mockGetClient: vi.fn(),
}));

vi.mock('../src/services/claude/client', async () => {
  const actual = await vi.importActual<typeof import('../src/services/claude/client')>('../src/services/claude/client');
  return {
    ...actual,
    getClient: mockGetClient,
  };
});

import { streamMessageAnthropic, sendMessageAnthropic } from '../src/services/llm/anthropic';
import { getThinkingTokens } from '../src/services/claude/client';
import type { StreamOptions } from '../src/services/llm/types';

interface FakeStream {
  events: unknown[];
  finalMessageContent: Array<{ type: string; name?: string; input?: Record<string, unknown> }>;
  throwOnIterate?: Error;
}

function makeFakeClient(stream: FakeStream | (() => never)) {
  if (typeof stream === 'function') {
    // The thunk path lets a test make `.messages.stream(...)` throw before
    // returning a stream, exercising the outer try/catch.
    mockStream.mockImplementationOnce(stream);
  } else {
    const fakeStream = {
      [Symbol.asyncIterator]() {
        let i = 0;
        return {
          async next() {
            if (stream.throwOnIterate && i === 0) throw stream.throwOnIterate;
            if (i >= stream.events.length) return { value: undefined, done: true };
            return { value: stream.events[i++], done: false };
          },
        };
      },
      finalMessage: async () => ({ content: stream.finalMessageContent }),
    };
    mockStream.mockResolvedValueOnce(fakeStream);
  }
  mockGetClient.mockReturnValue({ messages: { stream: mockStream, create: mockCreate } });
}

function baseOptions(overrides: Partial<StreamOptions> = {}): StreamOptions {
  return {
    apiKey: 'sk-test',
    messages: [{ role: 'user', content: 'Hello' }],
    ...overrides,
  };
}

describe('streamMessageAnthropic', () => {
  beforeEach(() => {
    mockStream.mockReset();
    mockCreate.mockReset();
    mockGetClient.mockReset();
  });

  it('streams text deltas to onText and returns the concatenated full text', async () => {
    makeFakeClient({
      events: [
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' world' } },
      ],
      finalMessageContent: [],
    });

    const onText = vi.fn();
    const onDone = vi.fn();
    const full = await streamMessageAnthropic(baseOptions(), { onText, onDone });

    expect(onText.mock.calls.map(c => c[0])).toEqual(['Hello', ' world']);
    expect(full).toBe('Hello world');
    expect(onDone).toHaveBeenCalledWith('Hello world');
  });

  it('routes thinking deltas to onThinking without appending them to onText / full text', async () => {
    makeFakeClient({
      events: [
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Considering...' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Answer.' } },
      ],
      finalMessageContent: [],
    });

    const onText = vi.fn();
    const onThinking = vi.fn();
    const full = await streamMessageAnthropic(baseOptions(), { onText, onThinking });

    expect(onThinking).toHaveBeenCalledWith('Considering...');
    expect(onText).toHaveBeenCalledWith('Answer.');
    expect(full).toBe('Answer.');
  });

  it('emits onWebSearch immediately when server_tool_use has an inline query', async () => {
    makeFakeClient({
      events: [
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'server_tool_use', input: { query: 'bayes theorem' } },
        },
      ],
      finalMessageContent: [],
    });

    const onWebSearch = vi.fn();
    await streamMessageAnthropic(baseOptions(), { onWebSearch });

    expect(onWebSearch).toHaveBeenCalledWith('bayes theorem');
  });

  it('accumulates a server_tool_use query that streams in via partial_json deltas', async () => {
    makeFakeClient({
      events: [
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'server_tool_use', input: {} },
        },
        { type: 'content_block_delta', index: 0, delta: { partial_json: '{"query":' } },
        { type: 'content_block_delta', index: 0, delta: { partial_json: '"central limit theorem"}' } },
        { type: 'content_block_stop', index: 0 },
      ],
      finalMessageContent: [],
    });

    const onWebSearch = vi.fn();
    await streamMessageAnthropic(baseOptions(), { onWebSearch });

    expect(onWebSearch).toHaveBeenCalledWith('central limit theorem');
  });

  it('emits onWebSearchResults with normalized title/url/pageAge for web_search_tool_result blocks', async () => {
    makeFakeClient({
      events: [
        {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'web_search_tool_result',
            content: [
              { type: 'web_search_result', title: 'A', url: 'https://a', page_age: '2024-01-01' },
              { type: 'web_search_result', title: 'B', url: 'https://b' },
              { type: 'something_else' },
            ],
          },
        },
      ],
      finalMessageContent: [],
    });

    const onWebSearchResults = vi.fn();
    await streamMessageAnthropic(baseOptions(), { onWebSearchResults });

    expect(onWebSearchResults).toHaveBeenCalledTimes(1);
    expect(onWebSearchResults).toHaveBeenCalledWith([
      { title: 'A', url: 'https://a', pageAge: '2024-01-01' },
      { title: 'B', url: 'https://b', pageAge: undefined },
    ]);
  });

  it('skips onWebSearchResults when the result content array has no web_search_result entries', async () => {
    makeFakeClient({
      events: [
        {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'web_search_tool_result',
            content: [{ type: 'noise' }],
          },
        },
      ],
      finalMessageContent: [],
    });

    const onWebSearchResults = vi.fn();
    await streamMessageAnthropic(baseOptions(), { onWebSearchResults });

    expect(onWebSearchResults).not.toHaveBeenCalled();
  });

  it('calls onToolUse for plain tool_use blocks during streaming AND in the final message', async () => {
    makeFakeClient({
      events: [
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', name: 'my_tool', input: {} },
        },
      ],
      finalMessageContent: [
        { type: 'text' },
        { type: 'tool_use', name: 'final_tool', input: { foo: 'bar' } },
      ],
    });

    const onToolUse = vi.fn();
    await streamMessageAnthropic(baseOptions(), { onToolUse });

    expect(onToolUse).toHaveBeenCalledWith('my_tool', {});
    expect(onToolUse).toHaveBeenCalledWith('final_tool', { foo: 'bar' });
  });

  it('passes through system, thinking, and tools params to the SDK', async () => {
    makeFakeClient({ events: [], finalMessageContent: [] });

    await streamMessageAnthropic(
      baseOptions({
        system: 'be helpful',
        thinkingBudget: 'high',
        tools: [{ name: 'web_search', type: 'web_search_20250305' } as unknown as StreamOptions['tools'] extends (infer U)[] ? U : never],
        maxTokens: 4000,
      }),
      {},
    );

    expect(mockStream).toHaveBeenCalledTimes(1);
    const params = mockStream.mock.calls[0][0];
    expect(params.system).toBe('be helpful');
    expect(params.thinking).toEqual({ type: 'enabled', budget_tokens: getThinkingTokens('high') });
    expect(params.tools).toHaveLength(1);
    expect(params.stream).toBe(true);
    // Thinking inflates max_tokens by the budget so the model has headroom.
    expect(params.max_tokens).toBe(Math.max(4000, getThinkingTokens('high') + 4000));
  });

  it('calls onError and re-throws when the SDK throws', async () => {
    const sdkError = new Error('overloaded');
    makeFakeClient(() => {
      throw sdkError;
    });

    const onError = vi.fn();
    await expect(streamMessageAnthropic(baseOptions(), { onError })).rejects.toThrow('overloaded');
    expect(onError).toHaveBeenCalledWith(sdkError);
  });

  it('wraps non-Error throws into an Error before calling onError', async () => {
    makeFakeClient(() => {
      throw 'plain string thrown';
    });

    const onError = vi.fn();
    await expect(streamMessageAnthropic(baseOptions(), { onError })).rejects.toThrow(/plain string thrown/);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
  });
});

describe('sendMessageAnthropic', () => {
  beforeEach(() => {
    mockStream.mockReset();
    mockCreate.mockReset();
    mockGetClient.mockReset();
  });

  it('calls client.messages.create with default model and pass-through params', async () => {
    mockGetClient.mockReturnValue({ messages: { stream: mockStream, create: mockCreate } });
    mockCreate.mockResolvedValueOnce({ id: 'msg_1', content: [] });

    await sendMessageAnthropic({
      apiKey: 'sk-test',
      system: 'sys',
      messages: [{ role: 'user', content: 'Hi' }],
      thinkingBudget: 'medium',
      maxTokens: 8000,
      tools: [{ name: 'web_search', type: 'web_search_20250305' } as unknown as Parameters<typeof sendMessageAnthropic>[0]['tools'] extends (infer U)[] | undefined ? U : never],
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const params = mockCreate.mock.calls[0][0];
    expect(params.system).toBe('sys');
    expect(params.thinking).toEqual({ type: 'enabled', budget_tokens: getThinkingTokens('medium') });
    expect(params.tools).toHaveLength(1);
    // sendMessage does NOT set stream: true (non-streaming path).
    expect(params.stream).toBeUndefined();
  });

  it('omits optional params when not supplied', async () => {
    mockGetClient.mockReturnValue({ messages: { stream: mockStream, create: mockCreate } });
    mockCreate.mockResolvedValueOnce({ id: 'msg_2', content: [] });

    await sendMessageAnthropic({
      apiKey: 'sk-test',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    const params = mockCreate.mock.calls[0][0];
    expect(params.system).toBeUndefined();
    expect(params.thinking).toBeUndefined();
    expect(params.tools).toBeUndefined();
  });
});
