import { describe, it, expect } from 'vitest';
import {
  buildLearningObjectivesPrompt,
  buildLearningObjectivesUserPrompt,
  parseCurriculumMapResponse,
} from '../src/prompts/learningObjectives';
import type { Syllabus } from '../src/types/course';

function makeSyllabus(overrides: Partial<Syllabus> = {}): Syllabus {
  return {
    courseTitle: 'Intro to Statistics',
    courseOverview: 'A foundational course.',
    chapters: [
      {
        number: 1,
        title: 'The Replication Crisis',
        narrative: 'Why methodology matters.',
        keyConcepts: ['p-values', 'replication'],
        widgets: [],
        scienceAnnotations: [],
        spacingConnections: [],
      },
      {
        number: 2,
        title: 'Sampling Distributions',
        narrative: 'How estimates vary.',
        keyConcepts: ['CLT', 'sampling error'],
        widgets: [],
        scienceAnnotations: [],
        spacingConnections: [],
      },
    ],
    ...overrides,
  };
}

describe('buildLearningObjectivesPrompt', () => {
  it('returns a non-empty system prompt that anchors on Blooms taxonomy and constructive alignment', () => {
    const prompt = buildLearningObjectivesPrompt();
    expect(prompt).toMatch(/Bloom/i);
    expect(prompt).toMatch(/constructive alignment/i);
    expect(prompt).toMatch(/JSON/);
  });

  it('specifies the I → D → M progression in the rules', () => {
    expect(buildLearningObjectivesPrompt()).toMatch(/Introduced.*Developed.*Mastered/);
  });
});

describe('buildLearningObjectivesUserPrompt', () => {
  it('includes the course title, overview, and every chapter summary', () => {
    const out = buildLearningObjectivesUserPrompt(makeSyllabus());
    expect(out).toMatch(/Intro to Statistics/);
    expect(out).toMatch(/A foundational course\./);
    expect(out).toMatch(/Chapter 1: The Replication Crisis/);
    expect(out).toMatch(/Chapter 2: Sampling Distributions/);
    expect(out).toMatch(/Key Concepts: p-values, replication/);
  });

  it('truncates the course overview past 500 characters', () => {
    const longOverview = 'x'.repeat(600);
    const out = buildLearningObjectivesUserPrompt(makeSyllabus({ courseOverview: longOverview }));
    // The truncated body ends with '...'; the full original isn't present.
    expect(out).toMatch(/x{500}\.\.\./);
    expect(out).not.toMatch(/x{600}/);
  });

  it('truncates a chapter narrative past 300 characters', () => {
    const long = 'n'.repeat(500);
    const syll = makeSyllabus();
    syll.chapters[0].narrative = long;
    const out = buildLearningObjectivesUserPrompt(syll);
    expect(out).toMatch(/n{300}\.\.\./);
    expect(out).not.toMatch(/n{500}/);
  });
});

describe('parseCurriculumMapResponse', () => {
  const happyResponse = JSON.stringify({
    objectives: [
      {
        id: 1,
        text: 'Analyze the relationship between X and Y',
        bloomLevel: 'analyze',
        alignments: { '1': 'introduced', '3': 'developed', '8': 'mastered' },
      },
      {
        id: 2,
        text: 'Apply a hypothesis test',
        bloomLevel: 'apply',
        alignments: { '2': 'introduced', '5': 'developed' },
      },
    ],
  });

  it('parses a clean JSON response into a CurriculumMap with normalized alignments', () => {
    const out = parseCurriculumMapResponse(happyResponse);
    expect(out).not.toBeNull();
    expect(out!.objectives).toHaveLength(2);
    expect(out!.objectives[0].alignments).toEqual({ 1: 'introduced', 3: 'developed', 8: 'mastered' });
    expect(out!.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('unwraps a ```json fenced response', () => {
    const fenced = '```json\n' + happyResponse + '\n```';
    expect(parseCurriculumMapResponse(fenced)?.objectives).toHaveLength(2);
  });

  it('strips prose around the JSON payload', () => {
    const wrapped = 'Sure, here it is:\n' + happyResponse + '\nLet me know!';
    expect(parseCurriculumMapResponse(wrapped)?.objectives).toHaveLength(2);
  });

  it('tolerates trailing commas in the JSON', () => {
    const trailing = '{"objectives": [{"id": 1, "text": "x", "bloomLevel": "apply", "alignments": {"1": "introduced",},},],}';
    expect(parseCurriculumMapResponse(trailing)?.objectives).toHaveLength(1);
  });

  it('lowercases bloomLevel and alignment levels before validating', () => {
    const text = JSON.stringify({
      objectives: [
        {
          id: 1,
          text: 'Evaluate study quality',
          bloomLevel: 'EVALUATE',
          alignments: { '1': 'INTRODUCED', '3': 'Mastered' },
        },
      ],
    });
    const out = parseCurriculumMapResponse(text);
    expect(out?.objectives[0].bloomLevel).toBe('evaluate');
    expect(out?.objectives[0].alignments).toEqual({ 1: 'introduced', 3: 'mastered' });
  });

  it('drops objectives whose bloomLevel is not in the canonical set', () => {
    const text = JSON.stringify({
      objectives: [
        { id: 1, text: 'a', bloomLevel: 'analyze', alignments: { '1': 'introduced' } },
        { id: 2, text: 'b', bloomLevel: 'sing', alignments: { '1': 'introduced' } },
      ],
    });
    const out = parseCurriculumMapResponse(text);
    expect(out?.objectives.map(o => o.text)).toEqual(['a']);
  });

  it('drops alignment entries with non-numeric chapter keys or unknown levels', () => {
    const text = JSON.stringify({
      objectives: [
        {
          id: 1,
          text: 'a',
          bloomLevel: 'apply',
          alignments: {
            '1': 'introduced',
            two: 'developed', // non-numeric key — drop
            '3': 'frobnicated', // unknown level — drop
          },
        },
      ],
    });
    const out = parseCurriculumMapResponse(text);
    expect(out?.objectives[0].alignments).toEqual({ 1: 'introduced' });
  });

  it('skips objectives whose alignments end up empty after filtering', () => {
    const text = JSON.stringify({
      objectives: [
        { id: 1, text: 'a', bloomLevel: 'apply', alignments: { x: 'introduced' } },
      ],
    });
    expect(parseCurriculumMapResponse(text)).toBeNull();
  });

  it('skips objectives missing required fields (text / bloomLevel / alignments)', () => {
    const text = JSON.stringify({
      objectives: [
        { id: 1, bloomLevel: 'apply', alignments: { '1': 'introduced' } }, // no text
        { id: 2, text: 'b', alignments: { '1': 'introduced' } }, // no bloomLevel
        { id: 3, text: 'c', bloomLevel: 'apply' }, // no alignments
        { id: 4, text: 'ok', bloomLevel: 'apply', alignments: { '1': 'introduced' } },
      ],
    });
    const out = parseCurriculumMapResponse(text);
    expect(out?.objectives.map(o => o.text)).toEqual(['ok']);
  });

  it('synthesizes ids when missing (1-based, in arrival order)', () => {
    const text = JSON.stringify({
      objectives: [
        { text: 'a', bloomLevel: 'apply', alignments: { '1': 'introduced' } },
        { text: 'b', bloomLevel: 'apply', alignments: { '1': 'introduced' } },
      ],
    });
    const out = parseCurriculumMapResponse(text);
    expect(out?.objectives.map(o => o.id)).toEqual([1, 2]);
  });

  it('returns null when no JSON object can be found', () => {
    expect(parseCurriculumMapResponse('plain prose, no json')).toBeNull();
  });

  it('returns null when objectives is missing or not an array', () => {
    expect(parseCurriculumMapResponse('{}')).toBeNull();
    expect(parseCurriculumMapResponse('{"objectives": "not an array"}')).toBeNull();
  });

  it('returns null when JSON is unparseable', () => {
    expect(parseCurriculumMapResponse('{unclosed')).toBeNull();
  });
});
