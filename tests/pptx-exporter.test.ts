import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { generatePptx } from '../src/services/export/pptxExporter';
import type { SlideData } from '../src/types/course';

function makeSlide(overrides: Partial<SlideData> & { title: string }): SlideData {
  return {
    bullets: [],
    speakerNotes: '',
    ...overrides,
  };
}

async function loadPptx(blob: Blob): Promise<JSZip> {
  const buf = await blob.arrayBuffer();
  return JSZip.loadAsync(buf);
}

describe('generatePptx', () => {
  it('produces a non-empty .pptx blob (valid OOXML zip)', async () => {
    const blob = await generatePptx(
      [makeSlide({ title: 'Hello', layout: 'title', bodyText: 'Sub' })],
      'Stats',
      'Ch 1',
    );
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);

    const zip = await loadPptx(blob);
    // OOXML packages have a `[Content_Types].xml` at the root.
    expect(zip.file('[Content_Types].xml')).not.toBeNull();
  });

  it('writes one slide file per SlideData entry', async () => {
    const blob = await generatePptx(
      [
        makeSlide({ title: 'Title', layout: 'title' }),
        makeSlide({ title: 'Body', layout: 'content', bullets: ['a', 'b'] }),
        makeSlide({ title: 'Outro', layout: 'big-idea', bodyText: 'A thought' }),
      ],
      'Stats',
      'Ch 1',
    );
    const zip = await loadPptx(blob);
    const slideXmls = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    expect(slideXmls).toHaveLength(3);
  });

  it('exercises every layout branch without throwing', async () => {
    // One slide per layout — verifies each builder runs to completion.
    const slides: SlideData[] = [
      makeSlide({ title: 'Title slide', layout: 'title', bodyText: 'hook' }),
      makeSlide({ title: 'Section', layout: 'section', bodyText: 'sub' }),
      makeSlide({ title: 'Content', layout: 'content', bullets: ['x', 'y'] }),
      makeSlide({ title: 'Big', layout: 'big-idea', bodyText: 'BIG' }),
      makeSlide({ title: '— Einstein', layout: 'quote', bodyText: 'Imagination > knowledge.' }),
      makeSlide({ title: 'Two-col', layout: 'two-column', bullets: ['L1'], bodyText: JSON.stringify(['R1', 'R2']) }),
      // No layout = default to 'content'.
      makeSlide({ title: 'Default', bullets: ['d1'] }),
    ];
    const blob = await generatePptx(slides, 'Course', 'Chapter');
    const zip = await loadPptx(blob);
    const slideXmls = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    expect(slideXmls).toHaveLength(slides.length);
  });

  it('attaches the speaker-notes text to the slide that supplied them', async () => {
    const blob = await generatePptx(
      [
        makeSlide({ title: 'With notes', layout: 'content', speakerNotes: 'Say this aloud.' }),
        makeSlide({ title: 'Without notes', layout: 'content' }),
      ],
      'Course',
      'Ch',
    );
    const zip = await loadPptx(blob);
    // pptxgenjs writes a notesSlide XML for every slide (it's part of the
    // OOXML spec), but the speaker text only appears in slides that opted in.
    const notes1 = await zip.file('ppt/notesSlides/notesSlide1.xml')?.async('string') ?? '';
    const notes2 = await zip.file('ppt/notesSlides/notesSlide2.xml')?.async('string') ?? '';
    expect(notes1).toContain('Say this aloud.');
    expect(notes2).not.toContain('Say this aloud.');
  });

  it('parses two-column bodyText as a JSON array of right-column bullets when valid', async () => {
    const blob = await generatePptx(
      [makeSlide({ title: 'Compare', layout: 'two-column', bullets: ['L1', 'L2'], bodyText: '["R1","R2","R3"]' })],
      'Course',
      'Ch',
    );
    const zip = await loadPptx(blob);
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    // Three right-column items show up as text runs.
    expect(slideXml).toContain('R1');
    expect(slideXml).toContain('R2');
    expect(slideXml).toContain('R3');
    expect(slideXml).toContain('L1');
  });

  it('falls back to using bodyText as a single right-column bullet when it is not JSON', async () => {
    const blob = await generatePptx(
      [makeSlide({ title: 'Compare', layout: 'two-column', bullets: ['L1'], bodyText: 'plain right column' })],
      'Course',
      'Ch',
    );
    const zip = await loadPptx(blob);
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(slideXml).toContain('plain right column');
  });

  it('writes the course title and chapter title into the .pptx metadata', async () => {
    const blob = await generatePptx(
      [makeSlide({ title: 'A', layout: 'content' })],
      'Stats 101',
      'The Replication Crisis',
    );
    const zip = await loadPptx(blob);
    const coreXml = await zip.file('docProps/core.xml')!.async('string');
    expect(coreXml).toContain('The Replication Crisis');
    expect(coreXml).toContain('Stats 101');
  });

  it('honors a custom themeId without throwing (themes resolve to a registered palette)', async () => {
    const blob = await generatePptx(
      [makeSlide({ title: 'Themed', layout: 'content' })],
      'Course',
      'Ch',
      'midnight',
    );
    expect(blob.size).toBeGreaterThan(0);
  });
});
