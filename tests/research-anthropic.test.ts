import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { StreamCallbacks, StreamOptions } from '../src/services/llm/types';

// The Anthropic research backend talks to Claude via streamWithRetry; the
// LLM-driven flow is fully orchestrated through the callbacks (onThinking,
// onText, onWebSearch, onWebSearchResults). Mock the facade so we can drive
// those callbacks deterministically.
const { mockStreamWithRetry } = vi.hoisted(() => ({
  mockStreamWithRetry: vi.fn<(opts: StreamOptions, cbs: StreamCallbacks) => Promise<string>>(),
}));

vi.mock('../src/services/llm', () => ({
  streamMessage: mockStreamWithRetry,
  streamWithRetry: mockStreamWithRetry,
  sendMessage: vi.fn(),
}));

import { researchAnthropic } from '../src/services/research/anthropic';
import type { RunResearchOptions, ResearchProgress } from '../src/services/research/types';

const baseOptions: RunResearchOptions = {
  chapterNumber: 7,
  chapterTitle: 'Hypothesis Testing',
  chapterNarrative: 'When to reject the null and why we sometimes shouldn’t.',
  keyConcepts: ['p-value', 'type I error', 'effect size'],
  llmApiKey: 'sk-llm',
  claudeApiKey: 'sk-anthropic-claude',
};

const validDossierResponse = JSON.stringify({
  sources: [
    {
      title: 'Statistical Significance',
      authors: '',
      year: '',
      url: 'https://example.edu/sig',
      summary: 'A primer.',
      relevance: 'Core.',
      isVerified: true,
    },
  ],
  synthesisNotes: 'Synthesized view.',
});

describe('researchAnthropic', () => {
  beforeEach(() => {
    mockStreamWithRetry.mockReset();
  });

  it('calls streamWithRetry with the Claude key, web_search tool, and forced anthropic provider', async () => {
    mockStreamWithRetry.mockResolvedValueOnce(validDossierResponse);

    await researchAnthropic(baseOptions, () => {});

    expect(mockStreamWithRetry).toHaveBeenCalledTimes(1);
    const opts = mockStreamWithRetry.mock.calls[0][0];
    expect(opts.apiKey).toBe('sk-anthropic-claude');
    expect(opts.provider).toBe('anthropic'); // forced even if the active store provider differs
    expect(opts.tools).toEqual([{ type: 'web_search_20250305', name: 'web_search' }]);
    expect(opts.system).toMatch(/research/i);
    expect(opts.messages[0].content).toContain('Hypothesis Testing');
  });

  it('emits progress phases as callbacks fire (thinking → searching → compiling)', async () => {
    mockStreamWithRetry.mockImplementationOnce(async (_opts, cbs) => {
      cbs.onThinking?.('planning research');
      cbs.onWebSearch?.('hypothesis testing primer');
      cbs.onWebSearchResults?.([
        { title: 'Source A', url: 'https://example.edu/a' },
      ]);
      cbs.onText?.('Synthesis text streamed in chunks.');
      return validDossierResponse;
    });

    const updates: ResearchProgress[] = [];
    await researchAnthropic(baseOptions, (u) => updates.push(u));

    const phases = updates.map((u) => u.phase).filter(Boolean);
    expect(phases).toContain('thinking');
    expect(phases).toContain('searching');
    expect(phases).toContain('compiling');
    const order = ['thinking', 'searching', 'compiling'];
    const indices = order.map((p) => phases.indexOf(p));
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  it('forwards search queries via appendQueries', async () => {
    mockStreamWithRetry.mockImplementationOnce(async (_opts, cbs) => {
      cbs.onWebSearch?.('q1');
      cbs.onWebSearch?.('q2');
      return validDossierResponse;
    });

    const updates: ResearchProgress[] = [];
    await researchAnthropic(baseOptions, (u) => updates.push(u));

    const queries = updates.flatMap((u) => u.appendQueries ?? []);
    expect(queries).toEqual(['q1', 'q2']);
  });

  it('appends streamed text via appendSynthesisText', async () => {
    mockStreamWithRetry.mockImplementationOnce(async (_opts, cbs) => {
      cbs.onText?.('chunk one ');
      cbs.onText?.('chunk two');
      return validDossierResponse;
    });

    const updates: ResearchProgress[] = [];
    await researchAnthropic(baseOptions, (u) => updates.push(u));

    const synthesized = updates
      .map((u) => u.appendSynthesisText)
      .filter(Boolean)
      .join('');
    expect(synthesized).toBe('chunk one chunk two');
  });

  it('dedupes web search results by URL when the model emits the same source twice', async () => {
    mockStreamWithRetry.mockImplementationOnce(async (_opts, cbs) => {
      cbs.onWebSearchResults?.([
        { title: 'A', url: 'https://example.edu/a' },
        { title: 'B', url: 'https://example.edu/b' },
      ]);
      cbs.onWebSearchResults?.([
        { title: 'A again', url: 'https://example.edu/a' }, // duplicate URL
        { title: 'C', url: 'https://example.edu/c' },
      ]);
      return validDossierResponse;
    });

    const result = await researchAnthropic(baseOptions, () => {});

    // Three unique URLs across two callback batches.
    const urls = result.webResults.map((r) => r.url).sort();
    expect(urls).toEqual([
      'https://example.edu/a',
      'https://example.edu/b',
      'https://example.edu/c',
    ]);
  });

  it('sets setLatestSource to the most recent fresh hit each batch', async () => {
    mockStreamWithRetry.mockImplementationOnce(async (_opts, cbs) => {
      cbs.onWebSearchResults?.([
        { title: 'A', url: 'https://example.edu/a' },
        { title: 'B', url: 'https://example.edu/b' },
      ]);
      return validDossierResponse;
    });

    const updates: ResearchProgress[] = [];
    await researchAnthropic(baseOptions, (u) => updates.push(u));

    const withLatest = updates.find((u) => u.setLatestSource !== undefined);
    expect(withLatest?.setLatestSource?.url).toBe('https://example.edu/b');
  });

  it('parses the final response into a Research dossier', async () => {
    mockStreamWithRetry.mockResolvedValueOnce(validDossierResponse);

    const result = await researchAnthropic(baseOptions, () => {});

    expect(result.dossier.chapterNumber).toBe(7);
    expect(result.dossier.sources).toHaveLength(1);
    expect(result.dossier.sources[0].title).toBe('Statistical Significance');
    expect(result.dossier.synthesisNotes).toContain('Synthesized view');
  });

  it('falls back to a dossier built from collected web results when the model output is malformed', async () => {
    mockStreamWithRetry.mockImplementationOnce(async (_opts, cbs) => {
      cbs.onWebSearchResults?.([
        { title: 'Fallback Source', url: 'https://example.edu/fallback' },
      ]);
      return 'not even close to JSON';
    });

    const result = await researchAnthropic(baseOptions, () => {});

    expect(result.dossier.chapterNumber).toBe(7);
    expect(result.dossier.sources).toHaveLength(1);
    expect(result.dossier.sources[0].url).toBe('https://example.edu/fallback');
    expect(result.dossier.sources[0].isVerified).toBe(true);
    // synthesisNotes falls back to the (first 500 chars of) raw text
    expect(result.dossier.synthesisNotes).toContain('not even close to JSON');
  });

  it('returns rawText + webResults alongside the dossier', async () => {
    mockStreamWithRetry.mockImplementationOnce(async (_opts, cbs) => {
      cbs.onWebSearchResults?.([
        { title: 'A', url: 'https://example.edu/a' },
      ]);
      return validDossierResponse;
    });

    const result = await researchAnthropic(baseOptions, () => {});

    expect(result.rawText).toBe(validDossierResponse);
    expect(result.webResults).toEqual([
      { title: 'A', url: 'https://example.edu/a' },
    ]);
  });
});
