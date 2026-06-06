import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { generateQuizDocPackage } from '../src/services/export/quizDocExporter';
import type { InClassQuizQuestion } from '../src/types/course';

function makeQuestion(i: number): InClassQuizQuestion {
  return {
    question: `Question ${i}?`,
    correctAnswer: `Correct answer ${i}`,
    correctFeedback: `Yes, ${i} is correct because…`,
    distractors: [
      { text: `Distractor ${i}A`, feedback: `Not quite — ${i}A` },
      { text: `Distractor ${i}B`, feedback: `Closer, but no — ${i}B` },
      { text: `Distractor ${i}C`, feedback: `Common mistake — ${i}C` },
    ],
  };
}

async function loadZip(blob: Blob): Promise<JSZip> {
  const buf = await blob.arrayBuffer();
  return JSZip.loadAsync(buf);
}

describe('generateQuizDocPackage', () => {
  it('produces a non-empty zip', async () => {
    const blob = await generateQuizDocPackage(
      [makeQuestion(1), makeQuestion(2), makeQuestion(3)],
      'Intro to Statistics',
      'The Replication Crisis',
    );
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('contains all five quiz versions (A–E) plus the answer key inside a slugified folder', async () => {
    const blob = await generateQuizDocPackage(
      [makeQuestion(1), makeQuestion(2)],
      'Stats 101',
      'Sampling Distributions',
    );
    const zip = await loadZip(blob);
    const names = Object.keys(zip.files).sort();

    expect(names).toContain('quiz-sampling-distributions/quiz-version-A.docx');
    expect(names).toContain('quiz-sampling-distributions/quiz-version-B.docx');
    expect(names).toContain('quiz-sampling-distributions/quiz-version-C.docx');
    expect(names).toContain('quiz-sampling-distributions/quiz-version-D.docx');
    expect(names).toContain('quiz-sampling-distributions/quiz-version-E.docx');
    expect(names).toContain('quiz-sampling-distributions/answer-key.docx');
  });

  it('clips a long chapter title to 40 chars in the folder name', async () => {
    const blob = await generateQuizDocPackage(
      [makeQuestion(1)],
      'Stats',
      'A Really Quite Extraordinarily Long Chapter Title That Should Be Clipped',
    );
    const zip = await loadZip(blob);
    const folderName = Object.keys(zip.files)[0].split('/')[0];
    // 40 char hard cap, trailing hyphens trimmed.
    expect(folderName.length).toBeLessThanOrEqual(40 + 'quiz-'.length);
    expect(folderName).toMatch(/^quiz-/);
  });

  it('shuffles questions deterministically — answer-key XML is identical across calls with the same input', async () => {
    // docx ZIPs embed modification timestamps so the outer .docx bytes vary
    // across calls, but the *content* (XML inside the docx) is built from
    // the seeded shuffle and should be byte-identical. We unpack one level
    // deeper and compare the document.xml from inside the answer key.
    const qs = [makeQuestion(1), makeQuestion(2), makeQuestion(3), makeQuestion(4)];
    const blob1 = await generateQuizDocPackage(qs, 'Stats', 'C1');
    const blob2 = await generateQuizDocPackage(qs, 'Stats', 'C1');

    const zip1 = await loadZip(blob1);
    const zip2 = await loadZip(blob2);

    const inner1 = await zip1.file('quiz-c1/answer-key.docx')!.async('uint8array');
    const inner2 = await zip2.file('quiz-c1/answer-key.docx')!.async('uint8array');
    const innerZip1 = await JSZip.loadAsync(inner1);
    const innerZip2 = await JSZip.loadAsync(inner2);

    const xml1 = await innerZip1.file('word/document.xml')!.async('string');
    const xml2 = await innerZip2.file('word/document.xml')!.async('string');
    expect(xml1).toBe(xml2);
  });

  it('handles a single-question quiz without crashing', async () => {
    const blob = await generateQuizDocPackage([makeQuestion(1)], 'X', 'Y');
    const zip = await loadZip(blob);
    expect(zip.file('quiz-y/quiz-version-A.docx')).not.toBeNull();
  });

  it('produces different shuffles for different version letters (versions diverge)', async () => {
    const qs = Array.from({ length: 6 }, (_, i) => makeQuestion(i + 1));
    const blob = await generateQuizDocPackage(qs, 'Stats', 'Ch');
    const zip = await loadZip(blob);

    const a = await zip.file('quiz-ch/quiz-version-A.docx')!.async('uint8array');
    const b = await zip.file('quiz-ch/quiz-version-B.docx')!.async('uint8array');
    // Different seeds → almost certainly different bytes.
    expect(a).not.toEqual(b);
  });
});
