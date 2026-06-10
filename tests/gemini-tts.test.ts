import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generatePcmAudio,
  generateAudiobook,
  GeminiTtsError,
} from '../src/services/gemini/tts';

// Gemini TTS returns 24 kHz / 16-bit / mono PCM. Test fixtures need to be
// realistic-ish so the crossfade math has room to operate (it needs at least
// fadeBytes = floor(80/1000 * 24000) * 2 = 3840 bytes per side).
const FADE_BYTES = Math.floor((80 / 1000) * 24000) * 2; // 3840

interface FetchCallRecord {
  url: string;
  body: Record<string, unknown> | undefined;
}

/**
 * Install a fetch mock that returns the next queued response per call.
 * Each entry can be a `Response`, a thrown error (use { error }), or a
 * convenience JSON payload with status.
 */
function installFetchQueue(
  entries: Array<
    | { status: number; body: unknown }
    | { status: number; text: string }
    | { throw: Error }
  >,
): { calls: FetchCallRecord[]; restore: () => void } {
  const calls: FetchCallRecord[] = [];
  const original = globalThis.fetch;
  let i = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ url, body });
    const entry = entries[i++];
    if (!entry) throw new Error(`fetch called more than expected — ${i} of ${entries.length}`);
    if ('throw' in entry) throw entry.throw;
    if ('text' in entry) {
      return new Response(entry.text, { status: entry.status });
    }
    return new Response(JSON.stringify(entry.body), {
      status: entry.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

/** Make a fake Gemini response whose inline audio is `pcm` base64-encoded. */
function ttsResponse(pcm: Uint8Array): { status: number; body: unknown } {
  // btoa in happy-dom handles binary strings.
  let bin = '';
  for (let i = 0; i < pcm.length; i++) bin += String.fromCharCode(pcm[i]);
  const b64 = (globalThis as { btoa?: (s: string) => string }).btoa
    ? (globalThis as { btoa: (s: string) => string }).btoa(bin)
    : Buffer.from(pcm).toString('base64');
  return {
    status: 200,
    body: {
      candidates: [
        { content: { parts: [{ inlineData: { data: b64, mimeType: 'audio/L16;rate=24000' } }] } },
      ],
    },
  };
}

/** Build a deterministic PCM buffer of size `bytes` (must be even). */
function makePcm(bytes: number, fill = 0x42): Uint8Array {
  const out = new Uint8Array(bytes);
  out.fill(fill);
  return out;
}

describe('generatePcmAudio — input validation', () => {
  it('throws GeminiTtsError on empty text', async () => {
    await expect(generatePcmAudio('   ', 'k')).rejects.toBeInstanceOf(GeminiTtsError);
    await expect(generatePcmAudio('   ', 'k')).rejects.toThrow(/empty text/i);
  });

  it('throws GeminiTtsError on empty apiKey', async () => {
    await expect(generatePcmAudio('hi', '   ')).rejects.toBeInstanceOf(GeminiTtsError);
    await expect(generatePcmAudio('hi', '   ')).rejects.toThrow(/api key is required/i);
  });
});

describe('generatePcmAudio — happy path', () => {
  let restoreFetch: (() => void) | null = null;

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = null;
  });

  it('POSTs to the default model endpoint with the API key in the query string', async () => {
    const { calls, restore } = installFetchQueue([ttsResponse(makePcm(8))]);
    restoreFetch = restore;

    await generatePcmAudio('Hello.', 'key-with-special&char');

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('gemini-2.5-flash-preview-tts:generateContent');
    // encodeURIComponent escapes the ampersand.
    expect(calls[0].url).toContain('key=key-with-special%26char');
  });

  it('honors a custom modelId and voiceName, defaulting voice to "Kore" otherwise', async () => {
    const { calls, restore } = installFetchQueue([ttsResponse(makePcm(8))]);
    restoreFetch = restore;

    await generatePcmAudio('Hello.', 'k', { modelId: 'gemini-2.0-tts', voiceName: 'Puck' });

    expect(calls[0].url).toContain('gemini-2.0-tts:generateContent');
    const body = calls[0].body as {
      generationConfig: {
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: string } } };
      };
    };
    expect(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Puck');
  });

  it('returns concatenated PCM with the documented 24 kHz / 16-bit / mono metadata', async () => {
    const pcm = makePcm(16, 0x7f);
    const { restore } = installFetchQueue([ttsResponse(pcm)]);
    restoreFetch = restore;

    const result = await generatePcmAudio('Hello.', 'k');

    expect(result.sampleRate).toBe(24000);
    expect(result.channels).toBe(1);
    expect(result.bitsPerSample).toBe(16);
    expect(result.pcm).toEqual(pcm);
  });

  it('calls onProgress once per chunk with 1-based current and total', async () => {
    const { restore } = installFetchQueue([ttsResponse(makePcm(8))]);
    restoreFetch = restore;

    const onProgress = vi.fn();
    await generatePcmAudio('Short.', 'k', { onProgress });

    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith(1, 1);
  });
});

describe('generatePcmAudio — chunking & per-chunk prompt shape', () => {
  let restoreFetch: (() => void) | null = null;
  afterEach(() => { restoreFetch?.(); restoreFetch = null; });

  it('splits long input across multiple generateContent calls, one per chunk', async () => {
    // Two paragraphs, each well above MAX_CHUNK_CHARS=4000, separated by a
    // paragraph break → chunkText() should split them into two chunks.
    const para = 'word '.repeat(900); // ~4500 chars
    const text = `${para}\n\n${para}`;

    const pcm = makePcm(FADE_BYTES * 4, 0x10);
    const { calls, restore } = installFetchQueue([ttsResponse(pcm), ttsResponse(pcm)]);
    restoreFetch = restore;

    await generatePcmAudio(text, 'k');

    expect(calls).toHaveLength(2);
  });

  it('embeds "passage N of M" director notes on the first and later chunks differently', async () => {
    const para = 'word '.repeat(900);
    const text = `${para}\n\n${para}`;

    const pcm = makePcm(FADE_BYTES * 4, 0x10);
    const { calls, restore } = installFetchQueue([ttsResponse(pcm), ttsResponse(pcm)]);
    restoreFetch = restore;

    await generatePcmAudio(text, 'k');

    const firstText = (calls[0].body as { contents: Array<{ parts: Array<{ text: string }> }> }).contents[0].parts[0].text;
    const secondText = (calls[1].body as { contents: Array<{ parts: Array<{ text: string }> }> }).contents[0].parts[0].text;

    expect(firstText).toContain('passage 1 of 2');
    expect(firstText).toContain('opening of a calm, sustained reading');
    expect(secondText).toContain('passage 2 of 2');
    expect(secondText).toContain('Continue seamlessly from the previous passage');
  });

  it('injects an accent directive into every chunk prompt when provided', async () => {
    const { calls, restore } = installFetchQueue([ttsResponse(makePcm(8))]);
    restoreFetch = restore;

    await generatePcmAudio('Hi.', 'k', { accent: 'British English accent from Oxford' });

    const txt = (calls[0].body as { contents: Array<{ parts: Array<{ text: string }> }> }).contents[0].parts[0].text;
    expect(txt).toContain('British English accent from Oxford');
  });

  it('omits the passage-counter directive when there is only one chunk', async () => {
    const { calls, restore } = installFetchQueue([ttsResponse(makePcm(8))]);
    restoreFetch = restore;

    await generatePcmAudio('Short single chunk.', 'k');

    const txt = (calls[0].body as { contents: Array<{ parts: Array<{ text: string }> }> }).contents[0].parts[0].text;
    expect(txt).not.toMatch(/passage \d+ of \d+/);
  });
});

describe('generatePcmAudio — retry & error handling', () => {
  let restoreFetch: (() => void) | null = null;
  let restoreSetTimeout: (() => void) | null = null;

  beforeEach(() => {
    // The retry path sleeps 500ms / 1000ms between attempts. Stub the
    // global so tests don't actually wait, but keep callbacks async-ish.
    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: () => void) => {
      Promise.resolve().then(fn);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof globalThis.setTimeout;
    restoreSetTimeout = () => { globalThis.setTimeout = originalSetTimeout; };
  });

  afterEach(() => {
    restoreFetch?.();
    restoreSetTimeout?.();
    restoreFetch = null;
    restoreSetTimeout = null;
  });

  it('retries on 5xx and succeeds on the second attempt', async () => {
    const { calls, restore } = installFetchQueue([
      { status: 503, text: 'overloaded' },
      ttsResponse(makePcm(8)),
    ]);
    restoreFetch = restore;

    const result = await generatePcmAudio('Hi.', 'k');
    expect(calls).toHaveLength(2);
    expect(result.pcm.length).toBe(8);
  });

  it('fails fast on 4xx (no retry)', async () => {
    const { calls, restore } = installFetchQueue([{ status: 401, text: 'unauthorized' }]);
    restoreFetch = restore;

    await expect(generatePcmAudio('Hi.', 'k')).rejects.toBeInstanceOf(GeminiTtsError);
    expect(calls).toHaveLength(1);
  });

  it('attaches status and detail to the thrown GeminiTtsError', async () => {
    const { restore } = installFetchQueue([{ status: 400, text: 'bad request: malformed input' }]);
    restoreFetch = restore;

    try {
      await generatePcmAudio('Hi.', 'k');
      throw new Error('expected to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(GeminiTtsError);
      const err = e as GeminiTtsError;
      expect(err.status).toBe(400);
      expect(err.detail).toContain('bad request');
      expect(err.message).toContain('Gemini TTS returned 400');
    }
  });

  it('retries on a thrown network error and gives up after MAX_ATTEMPTS=3', async () => {
    const netErr = new Error('ECONNRESET');
    const { calls, restore } = installFetchQueue([
      { throw: netErr },
      { throw: netErr },
      { throw: netErr },
    ]);
    restoreFetch = restore;

    await expect(generatePcmAudio('Hi.', 'k')).rejects.toThrow(/Network error/);
    expect(calls).toHaveLength(3);
  });

  it('retries when the response has no audio inlineData (model returned text tokens)', async () => {
    const { calls, restore } = installFetchQueue([
      { status: 200, body: { candidates: [{ content: { parts: [{ text: 'oops' }] } }] } },
      ttsResponse(makePcm(8)),
    ]);
    restoreFetch = restore;

    await generatePcmAudio('Hi.', 'k');
    expect(calls).toHaveLength(2);
  });

  it('retries when the audio payload decodes to zero bytes', async () => {
    const { calls, restore } = installFetchQueue([
      ttsResponse(new Uint8Array(0)),
      ttsResponse(makePcm(8)),
    ]);
    restoreFetch = restore;

    await generatePcmAudio('Hi.', 'k');
    expect(calls).toHaveLength(2);
  });
});

describe('generatePcmAudio — PCM joining & crossfade', () => {
  let restoreFetch: (() => void) | null = null;
  afterEach(() => { restoreFetch?.(); restoreFetch = null; });

  it('returns a single chunk untouched when there is only one chunk', async () => {
    const pcm = makePcm(8, 0xAA);
    const { restore } = installFetchQueue([ttsResponse(pcm)]);
    restoreFetch = restore;

    const result = await generatePcmAudio('Hi.', 'k');
    expect(result.pcm).toEqual(pcm);
  });

  it('joins two chunks losing exactly fadeBytes (3840) per junction in the merged length', async () => {
    // Build two chunks bigger than the fade window so a real cosine crossfade
    // runs. Each chunk is fadeBytes * 4 bytes (15360); the merged result
    // should equal sum - fadeBytes.
    const a = makePcm(FADE_BYTES * 4, 0x10);
    const b = makePcm(FADE_BYTES * 4, 0x20);

    const para = 'word '.repeat(900);
    const text = `${para}\n\n${para}`;

    const { restore } = installFetchQueue([ttsResponse(a), ttsResponse(b)]);
    restoreFetch = restore;

    const result = await generatePcmAudio(text, 'k');
    expect(result.pcm.length).toBe(a.length + b.length - FADE_BYTES);
    // First and last bytes outside the fade zone should be the original chunk
    // body (no mixing applied there).
    expect(result.pcm[0]).toBe(0x10);
    expect(result.pcm[result.pcm.length - 1]).toBe(0x20);
  });

  it('falls back to a plain concat when one chunk is shorter than the fade window', async () => {
    // Two-chunk path with one chunk too small to crossfade → behave like concat.
    const a = makePcm(FADE_BYTES * 4, 0x10);
    const b = makePcm(8, 0x20); // way smaller than fadeBytes
    const para = 'word '.repeat(900);
    const text = `${para}\n\n${para}`;

    const { restore } = installFetchQueue([ttsResponse(a), ttsResponse(b)]);
    restoreFetch = restore;

    const result = await generatePcmAudio(text, 'k');
    expect(result.pcm.length).toBe(a.length + b.length);
    expect(result.pcm.slice(0, a.length)).toEqual(a);
    expect(result.pcm.slice(a.length)).toEqual(b);
  });
});

describe('generateAudiobook', () => {
  let restoreFetch: (() => void) | null = null;
  afterEach(() => { restoreFetch?.(); restoreFetch = null; });

  it('wraps the PCM in a RIFF/WAVE container with the correct headers', async () => {
    const pcm = makePcm(40, 0x33);
    const { restore } = installFetchQueue([ttsResponse(pcm)]);
    restoreFetch = restore;

    const blob = await generateAudiobook('Hi.', 'k');
    expect(blob.type).toBe('audio/wav');
    expect(blob.size).toBe(44 + pcm.length);

    const buf = new Uint8Array(await blob.arrayBuffer());
    const ascii = (start: number, len: number) =>
      String.fromCharCode(...buf.slice(start, start + len));
    expect(ascii(0, 4)).toBe('RIFF');
    expect(ascii(8, 4)).toBe('WAVE');
    expect(ascii(12, 4)).toBe('fmt ');
    expect(ascii(36, 4)).toBe('data');

    const view = new DataView(buf.buffer);
    // Sample rate at offset 24, little-endian uint32.
    expect(view.getUint32(24, true)).toBe(24000);
    // Channels (mono = 1) at offset 22, uint16.
    expect(view.getUint16(22, true)).toBe(1);
    // Bits per sample at offset 34, uint16.
    expect(view.getUint16(34, true)).toBe(16);
    // dataSize at offset 40 equals the PCM length.
    expect(view.getUint32(40, true)).toBe(pcm.length);
  });
});

describe('GeminiTtsError', () => {
  it('preserves name, status, and detail', () => {
    const e = new GeminiTtsError('boom', 503, 'overloaded detail');
    expect(e.name).toBe('GeminiTtsError');
    expect(e.message).toBe('boom');
    expect(e.status).toBe(503);
    expect(e.detail).toBe('overloaded detail');
    expect(e).toBeInstanceOf(Error);
  });
});
