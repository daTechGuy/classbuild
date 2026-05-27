import { describe, it, expect } from 'vitest';
import {
  buildSyllabusPrompt,
  parseSyllabusResponse,
  parsePartialChapters,
} from '../src/prompts/syllabus';
import type { CourseSetup } from '../src/types/course';

function baseSetup(overrides: Partial<CourseSetup> = {}): CourseSetup {
  return {
    topic: 'Introductory Statistics',
    educationLevel: 'advanced-undergrad',
    priorKnowledge: 'some',
    cohortSize: 60,
    teachingEnvironment: 'lecture hall',
    numChapters: 12,
    chapterLength: 'standard',
    widgetsPerChapter: 2,
    themeId: 'midnight',
    voiceId: 'Kore',
    ...overrides,
  };
}

describe('buildSyllabusPrompt', () => {
  it('returns both a system prompt and a user message', () => {
    const { systemPrompt, userMessage } = buildSyllabusPrompt(baseSetup());
    expect(systemPrompt).toMatch(/CanvasClassBuild/);
    expect(userMessage).toMatch(/Introductory Statistics/);
  });

  it('encodes the chapter-length preset as word count + read time in the user message', () => {
    const standard = buildSyllabusPrompt(baseSetup({ chapterLength: 'standard' })).userMessage;
    const concise = buildSyllabusPrompt(baseSetup({ chapterLength: 'concise' })).userMessage;
    const deep = buildSyllabusPrompt(baseSetup({ chapterLength: 'deep' })).userMessage;

    expect(standard).toMatch(/4,000 words/);
    expect(standard).toMatch(/~20 min/);
    expect(concise).toMatch(/2,000 words/);
    expect(concise).toMatch(/~10 min/);
    expect(deep).toMatch(/6,000 words/);
    expect(deep).toMatch(/~30 min/);
  });

  it('includes Canvas template guidance in the system prompt when a templateId is set', () => {
    const withTemplate = buildSyllabusPrompt(baseSetup({ templateId: 'tpl-1' })).systemPrompt;
    const withoutTemplate = buildSyllabusPrompt(baseSetup()).systemPrompt;

    expect(withTemplate).toMatch(/Canvas Template Mode/);
    expect(withTemplate).toMatch(/Module N:/);
    expect(withoutTemplate).not.toMatch(/Canvas Template Mode/);
  });

  it('routes through the refinement branch when feedback is provided', () => {
    const { userMessage } = buildSyllabusPrompt(baseSetup(), 'Add more case studies.');
    expect(userMessage).toMatch(/Add more case studies/);
    expect(userMessage).toMatch(/REFINEMENT RULES/);
  });

  it('describes the cohort using the right size bucket', () => {
    expect(buildSyllabusPrompt(baseSetup({ cohortSize: 15 })).userMessage).toMatch(/small seminar/);
    expect(buildSyllabusPrompt(baseSetup({ cohortSize: 60 })).userMessage).toMatch(/medium class/);
    expect(buildSyllabusPrompt(baseSetup({ cohortSize: 250 })).userMessage).toMatch(/large lecture/);
  });

  it('only emits optional fields when they are present in setup', () => {
    const minimal = buildSyllabusPrompt(baseSetup()).userMessage;
    expect(minimal).not.toMatch(/Required topics/);
    expect(minimal).not.toMatch(/Exclude/);

    const populated = buildSyllabusPrompt(
      baseSetup({ specificTopics: 'Bayes', avoidTopics: 'p-hacking', textbookReference: 'OpenIntro' }),
    ).userMessage;
    expect(populated).toMatch(/Required topics.*Bayes/);
    expect(populated).toMatch(/Exclude.*p-hacking/);
    expect(populated).toMatch(/Reference text.*OpenIntro/);
  });

  it('reflects the prior-knowledge level in plain-English wording', () => {
    expect(buildSyllabusPrompt(baseSetup({ priorKnowledge: 'none' })).userMessage)
      .toMatch(/Complete beginners/);
    expect(buildSyllabusPrompt(baseSetup({ priorKnowledge: 'significant' })).userMessage)
      .toMatch(/Significant background/);
  });
});

describe('parseSyllabusResponse', () => {
  const minimalResponse = JSON.stringify({
    courseTitle: 'Statistics — A First Course',
    courseOverview: 'Overview text.',
    chapters: [
      {
        number: 1,
        title: 'The Replication Crisis',
        narrative: 'Narrative.',
        keyConcepts: ['p-values', 'replication'],
        widgets: [{ title: 'w', description: 'd', concept: 'c', rationale: 'r' }],
        scienceAnnotations: [
          { principle: 'retrieval practice', description: 'predict before reveal', relatedChapters: [3, 5] },
        ],
        spacingConnections: [],
      },
    ],
  });

  it('parses a clean JSON response into a Syllabus', () => {
    const syll = parseSyllabusResponse(minimalResponse);
    expect(syll?.courseTitle).toBe('Statistics — A First Course');
    expect(syll?.chapters).toHaveLength(1);
    expect(syll?.chapters[0].title).toBe('The Replication Crisis');
  });

  it('strips ```json fenced wrappers', () => {
    const fenced = '```json\n' + minimalResponse + '\n```';
    expect(parseSyllabusResponse(fenced)?.courseTitle).toBe('Statistics — A First Course');
  });

  it('strips prose around the JSON object', () => {
    const wrapped = 'Sure! Here it is:\n' + minimalResponse + '\nThat should work.';
    expect(parseSyllabusResponse(wrapped)?.courseTitle).toBe('Statistics — A First Course');
  });

  it('normalizes free-form principle names to the canonical key set', () => {
    const text = JSON.stringify({
      courseTitle: 'X',
      courseOverview: '',
      chapters: [
        {
          number: 1,
          title: 'C1',
          narrative: '',
          keyConcepts: [],
          widgets: [],
          scienceAnnotations: [
            { principle: 'distributed practice', description: '', relatedChapters: [] },
            { principle: 'Interleaving', description: '', relatedChapters: [] },
            { principle: 'Testing Effect', description: '', relatedChapters: [] },
            { principle: 'concrete examples', description: '', relatedChapters: [] },
            { principle: 'visual coding', description: '', relatedChapters: [] },
            { principle: 'gibberish', description: '', relatedChapters: [] },
          ],
          spacingConnections: [],
        },
      ],
    });
    const syll = parseSyllabusResponse(text);
    const principles = syll?.chapters[0].scienceAnnotations.map(a => a.principle);
    expect(principles).toEqual([
      'spacing',       // "distributed practice"
      'interleaving',
      'retrieval',     // "Testing Effect"
      'examples',
      'dual-coding',   // "visual coding"
      'spacing',       // fallback for unknown
    ]);
  });

  it('fills in defaults for missing fields rather than throwing', () => {
    // Minimal-valid: courseTitle missing, chapters array missing → defaults.
    const text = '{}';
    const syll = parseSyllabusResponse(text);
    expect(syll?.courseTitle).toBe('Untitled Course');
    expect(syll?.courseOverview).toBe('');
    expect(syll?.chapters).toEqual([]);
  });

  it('numbers chapters by their array index when number is missing', () => {
    const text = JSON.stringify({
      courseTitle: 'X',
      courseOverview: '',
      chapters: [{ title: 'A' }, { title: 'B' }],
    });
    const syll = parseSyllabusResponse(text);
    expect(syll?.chapters.map(c => c.number)).toEqual([1, 2]);
  });

  it('returns null when the JSON is completely unparseable', () => {
    expect(parseSyllabusResponse('not json')).toBeNull();
  });
});

describe('parsePartialChapters', () => {
  it('extracts only the courseTitle when only that has streamed in', () => {
    const partial = '{"courseTitle": "Stats 101", "courseOver';
    const out = parsePartialChapters(partial);
    expect(out.title).toBe('Stats 101');
    expect(out.chapters).toEqual([]);
  });

  it('extracts courseOverview with embedded newlines and escaped quotes', () => {
    const partial = '{"courseOverview": "Line one.\\nLine two with a \\"quote\\" inside."';
    const out = parsePartialChapters(partial);
    expect(out.overview).toBe('Line one.\nLine two with a "quote" inside.');
  });

  it('extracts complete chapter objects while skipping the open trailing one', () => {
    const partial = `{
      "courseTitle": "X",
      "chapters": [
        {"number": 1, "title": "Ch1", "narrative": "n1", "keyConcepts": ["a"], "widgets": [], "scienceAnnotations": [], "spacingConnections": []},
        {"number": 2, "title": "Ch2", "narrative": "n2",`;
    const out = parsePartialChapters(partial);
    expect(out.chapters).toHaveLength(1);
    expect(out.chapters[0].title).toBe('Ch1');
  });

  it('returns empty chapter list when "chapters" key has not appeared yet', () => {
    expect(parsePartialChapters('{"courseTitle": "X"').chapters).toEqual([]);
  });

  it('synthesizes a chapter number when the streamed object omits it', () => {
    const partial = '{"chapters": [{"title": "A", "narrative": "", "keyConcepts": [], "widgets": [], "scienceAnnotations": [], "spacingConnections": []}]}';
    const out = parsePartialChapters(partial);
    expect(out.chapters[0].number).toBe(1);
    expect(out.chapters[0].title).toBe('A');
  });
});
