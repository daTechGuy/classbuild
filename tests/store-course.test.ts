import { describe, it, expect, beforeEach } from 'vitest';
import { useCourseStore } from '../src/store/courseStore';
import type { Syllabus, GeneratedChapter, ResearchDossier, CurriculumMap } from '../src/types/course';

function s(): ReturnType<typeof useCourseStore.getState> {
  return useCourseStore.getState();
}

function makeSyllabus(): Syllabus {
  return {
    courseTitle: 'X',
    courseOverview: 'o',
    chapters: [
      { number: 1, title: 'A', narrative: '', keyConcepts: [], widgets: [], scienceAnnotations: [], spacingConnections: [] },
    ],
  };
}

function makeChapter(num: number, overrides: Partial<GeneratedChapter> = {}): GeneratedChapter {
  return { number: num, title: `Ch ${num}`, htmlContent: `<html>${num}</html>`, ...overrides };
}

function makeDossier(num: number): ResearchDossier {
  return {
    chapterNumber: num,
    sources: [{ title: 't', authors: 'a', year: '2024', summary: '', relevance: '', isVerified: true }],
    synthesisNotes: '',
  };
}

describe('useCourseStore', () => {
  beforeEach(() => {
    s().reset();
  });

  it('reset() restores all fields to defaults', () => {
    s().setStage('build');
    s().setSyllabus(makeSyllabus());
    s().addChapter(makeChapter(1));
    s().setOutlineFields({ courseTitle: 'x' } as never);

    s().reset();

    const st = s();
    expect(st.currentStage).toBe('landing');
    expect(st.syllabus).toBeNull();
    expect(st.chapters).toEqual([]);
    expect(st.completedStages).toEqual([]);
    expect(st.outlineFields).toBeNull();
    expect(st.setup.topic).toBe('');
    expect(st.setup.numChapters).toBe(12);
  });

  it('setStage updates the current stage', () => {
    s().setStage('research');
    expect(s().currentStage).toBe('research');
  });

  it('completeStage appends a new stage and is a no-op when the stage is already complete', () => {
    s().completeStage('syllabus');
    s().completeStage('research');
    s().completeStage('syllabus'); // duplicate — should not append.
    expect(s().completedStages).toEqual(['syllabus', 'research']);
  });

  it('updateSetup shallow-merges patches into setup', () => {
    s().updateSetup({ topic: 'Stats', numChapters: 8 });
    expect(s().setup.topic).toBe('Stats');
    expect(s().setup.numChapters).toBe(8);
    // Other defaults are preserved.
    expect(s().setup.themeId).toBe('midnight');
  });

  it('setSyllabus stores the syllabus AND clears any existing curriculumMap (it gets re-built later)', () => {
    s().setCurriculumMap({ objectives: [], chapterMap: {} } as unknown as CurriculumMap);
    expect(s().curriculumMap).not.toBeNull();

    s().setSyllabus(makeSyllabus());
    expect(s().syllabus?.courseTitle).toBe('X');
    expect(s().curriculumMap).toBeNull();
  });

  it('setCurriculumMap and clearCurriculumMap are symmetric', () => {
    const map = { objectives: [{ id: 'o1', text: 't', bloomLevel: 'Apply' }], chapterMap: {} } as unknown as CurriculumMap;
    s().setCurriculumMap(map);
    expect(s().curriculumMap).toBe(map);
    s().clearCurriculumMap();
    expect(s().curriculumMap).toBeNull();
  });

  it('addSyllabusMessage appends to the conversation and clearSyllabusConversation empties it', () => {
    s().addSyllabusMessage('user', 'add a chapter on Bayes');
    s().addSyllabusMessage('assistant', 'sure');
    expect(s().syllabusConversation).toEqual([
      { role: 'user', content: 'add a chapter on Bayes' },
      { role: 'assistant', content: 'sure' },
    ]);
    s().clearSyllabusConversation();
    expect(s().syllabusConversation).toEqual([]);
  });

  it('addResearchDossier appends to the dossier list', () => {
    s().addResearchDossier(makeDossier(1));
    s().addResearchDossier(makeDossier(2));
    expect(s().researchDossiers.map(d => d.chapterNumber)).toEqual([1, 2]);
  });

  it('addChapter replaces any prior chapter with the same number', () => {
    s().addChapter(makeChapter(1, { title: 'Original' }));
    s().addChapter(makeChapter(2));
    s().addChapter(makeChapter(1, { title: 'Replaced' }));

    const ch1 = s().chapters.find(c => c.number === 1);
    expect(s().chapters).toHaveLength(2);
    expect(ch1?.title).toBe('Replaced');
  });

  it('updateChapter shallow-merges patches into the matching chapter only', () => {
    s().addChapter(makeChapter(1, { practiceQuizData: 'Q1' }));
    s().addChapter(makeChapter(2));

    s().updateChapter(1, { audioTranscript: 'transcript text' });

    const ch1 = s().chapters.find(c => c.number === 1);
    const ch2 = s().chapters.find(c => c.number === 2);
    expect(ch1?.audioTranscript).toBe('transcript text');
    // Existing fields preserved.
    expect(ch1?.practiceQuizData).toBe('Q1');
    // Other chapters untouched.
    expect(ch2?.audioTranscript).toBeUndefined();
  });

  it('updateChapter is a no-op when no chapter matches the number', () => {
    s().addChapter(makeChapter(1));
    s().updateChapter(99, { audioTranscript: 'orphan' });
    expect(s().chapters.find(c => c.number === 99)).toBeUndefined();
    expect(s().chapters.find(c => c.number === 1)?.audioTranscript).toBeUndefined();
  });

  it('setOutlineFields and setOutlineRawText round-trip values, including null', () => {
    s().setOutlineFields({ courseTitle: 'X' } as never);
    s().setOutlineRawText('raw docx text');
    expect(s().outlineFields).toEqual({ courseTitle: 'X' });
    expect(s().outlineRawText).toBe('raw docx text');

    s().setOutlineFields(null);
    s().setOutlineRawText(null);
    expect(s().outlineFields).toBeNull();
    expect(s().outlineRawText).toBeNull();
  });

  it('resetDownstream clears workflow state but preserves setup and outline (setup is the user input)', () => {
    s().updateSetup({ topic: 'Bayesian Stats' });
    s().setOutlineFields({ courseTitle: 'X' } as never);
    s().setStage('build');
    s().completeStage('syllabus');
    s().setSyllabus(makeSyllabus());
    s().addResearchDossier(makeDossier(1));
    s().addChapter(makeChapter(1));
    s().setCurriculumMap({ objectives: [], chapterMap: {} } as unknown as CurriculumMap);

    s().resetDownstream();

    const st = s();
    expect(st.syllabus).toBeNull();
    expect(st.researchDossiers).toEqual([]);
    expect(st.chapters).toEqual([]);
    expect(st.curriculumMap).toBeNull();
    expect(st.completedStages).toEqual([]);
    // currentStage isn't reset by resetDownstream — only reset() does that.
    expect(st.currentStage).toBe('build');
    // User input survives.
    expect(st.setup.topic).toBe('Bayesian Stats');
    expect(st.outlineFields).toEqual({ courseTitle: 'X' });
  });
});
