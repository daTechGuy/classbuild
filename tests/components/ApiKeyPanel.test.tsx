import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiKeyPanel } from '../../src/components/setup/ApiKeyPanel';
import { useApiStore } from '../../src/store/apiStore';

// ── Fetch mock helper ─────────────────────────────────────────────

interface MockFetchCall {
  url: string;
  method: string;
  authorization: string | null;
  body: unknown;
}

function installMockFetch(handler: (call: MockFetchCall) => unknown = () => ({ ok: true })): {
  calls: MockFetchCall[];
  restore: () => void;
} {
  const calls: MockFetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers ?? {});
    let body: unknown;
    if (init?.body && typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const call: MockFetchCall = { url, method, authorization: headers.get('authorization'), body };
    calls.push(call);
    const result = handler(call);
    if (result instanceof Response) return result;
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

// ── Default store reset ───────────────────────────────────────────

function resetApiStore() {
  useApiStore.setState({
    provider: 'anthropic',
    researchBackend: 'anthropic',
    advancedMode: false,
    claudeApiKey: '',
    geminiApiKey: '',
    ollamaApiKey: '',
    ollamaModel: 'gpt-oss:120b-cloud',
    tavilyApiKey: '',
    claudeKeyValid: null,
    geminiKeyValid: null,
    ollamaKeyValid: null,
    tavilyKeyValid: null,
    isValidatingClaude: false,
    isValidatingGemini: false,
    isValidatingOllama: false,
    isValidatingTavily: false,
  });
}

describe('<ApiKeyPanel /> — toggles', () => {
  let fetchMock: ReturnType<typeof installMockFetch>;

  beforeEach(() => {
    resetApiStore();
    fetchMock = installMockFetch();
  });

  afterEach(() => {
    fetchMock.restore();
  });

  it('clicking the "Ollama Cloud" segment updates apiStore.provider', async () => {
    const user = userEvent.setup();
    render(<ApiKeyPanel />);

    expect(useApiStore.getState().provider).toBe('anthropic');
    await user.click(screen.getByRole('button', { name: /ollama cloud/i }));
    expect(useApiStore.getState().provider).toBe('ollama');
  });

  it('hint text under the provider toggle reflects the selection', async () => {
    const user = userEvent.setup();
    render(<ApiKeyPanel />);

    // Use distinctive sub-strings that only appear in the hint paragraph,
    // not in any ProviderCard tagline that might match more loosely.
    expect(screen.getByText(/Claude writes syllabus and chapter content/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /ollama cloud/i }));
    expect(
      screen.getByText(/research stage uses whichever backend you pick below/i),
    ).toBeInTheDocument();
  });

  it('clicking each research backend segment updates apiStore.researchBackend', async () => {
    const user = userEvent.setup();
    render(<ApiKeyPanel />);

    expect(useApiStore.getState().researchBackend).toBe('anthropic');

    await user.click(screen.getByRole('button', { name: /^tavily$/i }));
    expect(useApiStore.getState().researchBackend).toBe('tavily');

    await user.click(screen.getByRole('button', { name: /^wikipedia$/i }));
    expect(useApiStore.getState().researchBackend).toBe('wikipedia');

    await user.click(screen.getByRole('button', { name: /claude web search/i }));
    expect(useApiStore.getState().researchBackend).toBe('anthropic');
  });

  it('research-hint text changes with the selected backend', async () => {
    const user = userEvent.setup();
    render(<ApiKeyPanel />);

    // Match on the trailing portion of each hint — unique to the
    // research-backend hint paragraph (not also present in provider cards).
    expect(screen.getByText(/Requires the Claude key/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^tavily$/i }));
    expect(screen.getByText(/Requires the Tavily key/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^wikipedia$/i }));
    expect(screen.getByText(/No extra key needed/i)).toBeInTheDocument();
  });
});

describe('<ApiKeyPanel /> — Ollama model input', () => {
  let fetchMock: ReturnType<typeof installMockFetch>;

  beforeEach(() => {
    resetApiStore();
    fetchMock = installMockFetch();
  });

  afterEach(() => {
    fetchMock.restore();
  });

  it('hides the Ollama model input when provider !== "ollama"', () => {
    useApiStore.setState({ ollamaApiKey: 'present' });
    render(<ApiKeyPanel />);
    expect(screen.queryByLabelText(/ollama model/i)).not.toBeInTheDocument();
  });

  it('hides the Ollama model input when provider="ollama" but no key is set', () => {
    useApiStore.setState({ provider: 'ollama', ollamaApiKey: '' });
    render(<ApiKeyPanel />);
    expect(screen.queryByLabelText(/ollama model/i)).not.toBeInTheDocument();
  });

  it('shows the Ollama model input when provider="ollama" AND key is present', () => {
    useApiStore.setState({ provider: 'ollama', ollamaApiKey: 'ollama-key' });
    render(<ApiKeyPanel />);
    const input = screen.getByLabelText(/ollama model/i) as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe('gpt-oss:120b-cloud');
  });

  it('editing the model input writes through to apiStore', async () => {
    const user = userEvent.setup();
    useApiStore.setState({ provider: 'ollama', ollamaApiKey: 'ollama-key' });
    render(<ApiKeyPanel />);

    const input = screen.getByLabelText(/ollama model/i) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, 'qwen3-coder:480b-cloud');

    expect(useApiStore.getState().ollamaModel).toBe('qwen3-coder:480b-cloud');
  });
});

describe('<ApiKeyPanel /> — auto-validation on mount', () => {
  let fetchMock: ReturnType<typeof installMockFetch>;

  afterEach(() => {
    fetchMock?.restore();
  });

  it('validates a stored Ollama key by POSTing /api/ollama-proxy with bearer auth', async () => {
    resetApiStore();
    useApiStore.setState({ ollamaApiKey: 'ollama-key-xyz' });
    fetchMock = installMockFetch();

    render(<ApiKeyPanel />);

    await waitFor(() => {
      expect(fetchMock.calls.some((c) => c.url === '/api/ollama-proxy')).toBe(true);
    });

    const ollamaCall = fetchMock.calls.find((c) => c.url === '/api/ollama-proxy')!;
    expect(ollamaCall.method).toBe('POST');
    expect(ollamaCall.authorization).toBe('Bearer ollama-key-xyz');
    expect(ollamaCall.body).toMatchObject({ stream: false });

    await waitFor(() => {
      expect(useApiStore.getState().ollamaKeyValid).toBe(true);
    });
  });

  it('validates a stored Tavily key against api.tavily.com/search', async () => {
    resetApiStore();
    useApiStore.setState({ tavilyApiKey: 'tvly-xyz' });
    fetchMock = installMockFetch();

    render(<ApiKeyPanel />);

    await waitFor(() => {
      expect(
        fetchMock.calls.some((c) => c.url === 'https://api.tavily.com/search'),
      ).toBe(true);
    });

    const tavilyCall = fetchMock.calls.find(
      (c) => c.url === 'https://api.tavily.com/search',
    )!;
    expect(tavilyCall.authorization).toBe('Bearer tvly-xyz');

    await waitFor(() => {
      expect(useApiStore.getState().tavilyKeyValid).toBe(true);
    });
  });

  it('validates a stored Gemini key against googleapis.com/.../models', async () => {
    resetApiStore();
    useApiStore.setState({ geminiApiKey: 'AIzaTEST' });
    fetchMock = installMockFetch();

    render(<ApiKeyPanel />);

    await waitFor(() => {
      expect(
        fetchMock.calls.some((c) =>
          c.url.startsWith(
            'https://generativelanguage.googleapis.com/v1beta/models',
          ),
        ),
      ).toBe(true);
    });

    const geminiCall = fetchMock.calls.find((c) =>
      c.url.startsWith('https://generativelanguage.googleapis.com/'),
    )!;
    expect(geminiCall.url).toContain('key=AIzaTEST');

    await waitFor(() => {
      expect(useApiStore.getState().geminiKeyValid).toBe(true);
    });
  });

  it('sets keyValid=false when the validation endpoint returns non-2xx', async () => {
    resetApiStore();
    useApiStore.setState({ tavilyApiKey: 'tvly-bad' });
    fetchMock = installMockFetch(
      () => new Response('forbidden', { status: 401 }),
    );

    render(<ApiKeyPanel />);

    await waitFor(() => {
      expect(useApiStore.getState().tavilyKeyValid).toBe(false);
    });
  });

  it('skips validation when a stored key already has a recorded validation result', async () => {
    resetApiStore();
    useApiStore.setState({ tavilyApiKey: 'tvly-xyz', tavilyKeyValid: true });
    fetchMock = installMockFetch();

    render(<ApiKeyPanel />);

    // Give the mount effect a chance to fire.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(
      fetchMock.calls.some((c) => c.url === 'https://api.tavily.com/search'),
    ).toBe(false);
  });

  it('does not validate keys that are blank', async () => {
    resetApiStore(); // all keys empty
    fetchMock = installMockFetch();

    render(<ApiKeyPanel />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    // No validation endpoints called — only Claude's would route through
    // the SDK, but it short-circuits on empty input too.
    expect(fetchMock.calls).toHaveLength(0);
  });
});
