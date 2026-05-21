import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExportPage } from '../../src/pages/ExportPage';
import { useCourseStore } from '../../src/store/courseStore';
import { useUiStore } from '../../src/store/uiStore';
import type { Syllabus, GeneratedChapter, CurriculumMap } from '../../src/types/course';

// Keep these heavy modules out of the test path — they're only exercised on
// click handlers and we're testing render behavior.
vi.mock('../../src/services/claude/streaming', () => ({
  streamMessage: vi.fn(),
}));

function makeSyllabus(numChapters: number): Syllabus {
  return {
    courseTitle: 'Intro to Statistics',
    courseOverview: 'A first course in stats.',
    chapters: Array.from({ length: numChapters }, (_, i) => ({
      number: i + 1,
      title: `Chapter ${i + 1}`,
      narrative: 'Narrative text.',
      keyConcepts: ['concept'],
      widgets: [],
      scienceAnnotations: [],
      spacingConnections: [],
    })),
  };
}

function makeChapter(overrides: Partial<GeneratedChapter> & { number: number; title: string }): GeneratedChapter {
  return {
    htmlContent: '<html><body>chapter</body></html>',
    ...overrides,
  };
}

describe('<ExportPage />', () => {
  beforeEach(() => {
    useCourseStore.getState().reset();
    useUiStore.setState({ error: null, isGenerating: false });
    // jsdom/happy-dom don't implement URL.createObjectURL; download handlers
    // would blow up the suite if any test wires a click on them.
    if (!('createObjectURL' in URL)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (URL as any).createObjectURL = vi.fn(() => 'blob:mock');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (URL as any).revokeObjectURL = vi.fn();
    }
  });

  it('shows an empty state when no syllabus is loaded', () => {
    render(<ExportPage />);
    expect(screen.getByText(/no course data available/i)).toBeInTheDocument();
  });

  it('renders the course title in the header once a syllabus is loaded', () => {
    useCourseStore.setState({ syllabus: makeSyllabus(3) });
    render(<ExportPage />);

    expect(screen.getByRole('heading', { name: /export course/i })).toBeInTheDocument();
    expect(screen.getByText('Intro to Statistics')).toBeInTheDocument();
  });

  it('shows the three header actions: Publish, Download All, Export for Canvas', () => {
    useCourseStore.setState({ syllabus: makeSyllabus(3) });
    render(<ExportPage />);

    expect(screen.getByRole('button', { name: /publish course/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download.*classes.*zip/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /export for canvas/i })).toBeInTheDocument();
  });

  it('disables Publish / Download All / Export when no chapters are generated', () => {
    useCourseStore.setState({ syllabus: makeSyllabus(3), chapters: [] });
    render(<ExportPage />);

    expect(screen.getByRole('button', { name: /publish course/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /download.*classes.*zip/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /export for canvas/i })).toBeDisabled();
  });

  it('shows "Download N of M Classes" while not all chapters are ready', () => {
    useCourseStore.setState({
      syllabus: makeSyllabus(5),
      chapters: [makeChapter({ number: 1, title: 'Chapter 1' }), makeChapter({ number: 2, title: 'Chapter 2' })],
    });
    render(<ExportPage />);

    expect(screen.getByRole('button', { name: /download 2 of 5 classes/i })).toBeInTheDocument();
  });

  it('shows "Download All (ZIP)" once every chapter is generated', () => {
    useCourseStore.setState({
      syllabus: makeSyllabus(2),
      chapters: [
        makeChapter({ number: 1, title: 'Chapter 1' }),
        makeChapter({ number: 2, title: 'Chapter 2' }),
      ],
    });
    render(<ExportPage />);

    expect(screen.getByRole('button', { name: /download all \(zip\)/i })).toBeInTheDocument();
  });

  it('renders a UI error banner when ui.error is set', () => {
    useCourseStore.setState({ syllabus: makeSyllabus(2) });
    useUiStore.setState({ error: 'Boom — something went wrong.' });
    render(<ExportPage />);

    expect(screen.getByText('Boom — something went wrong.')).toBeInTheDocument();
  });

  it('shows a "Generate Class" button for chapters that have not been generated yet', () => {
    useCourseStore.setState({
      syllabus: makeSyllabus(3),
      chapters: [makeChapter({ number: 1, title: 'Chapter 1' })],
    });
    render(<ExportPage />);

    // Chapters 2 and 3 are not generated → 2 Generate Class buttons.
    expect(screen.getAllByRole('button', { name: /generate class/i })).toHaveLength(2);
  });

  it('disables the Generate Class buttons while ui.isGenerating is true', () => {
    useCourseStore.setState({
      syllabus: makeSyllabus(2),
      chapters: [],
    });
    useUiStore.setState({ isGenerating: true });
    render(<ExportPage />);

    for (const btn of screen.getAllByRole('button', { name: /generate class/i })) {
      expect(btn).toBeDisabled();
    }
  });

  it('only shows the Reading row for a chapter that has no extras (just HTML)', () => {
    useCourseStore.setState({
      syllabus: makeSyllabus(1),
      chapters: [makeChapter({ number: 1, title: 'Chapter 1' })],
    });
    render(<ExportPage />);

    expect(screen.getByRole('button', { name: /reading \(\.html\)/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /practice quiz/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /slides/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /audiobook/i })).not.toBeInTheDocument();
  });

  it('shows the practice-quiz download row when practiceQuizData is present', () => {
    useCourseStore.setState({
      syllabus: makeSyllabus(1),
      chapters: [
        makeChapter({
          number: 1,
          title: 'Chapter 1',
          practiceQuizData: 'Q1: ...',
        }),
      ],
    });
    render(<ExportPage />);

    expect(screen.getByRole('button', { name: /^practice quiz$/i })).toBeInTheDocument();
  });

  it('shows both Weekly Challenge HTML and SCORM rows when challenge data is present', () => {
    useCourseStore.setState({
      syllabus: makeSyllabus(1),
      chapters: [
        makeChapter({
          number: 1,
          title: 'Chapter 1',
          weeklyChallengeData: { questions: [] } as unknown as GeneratedChapter['weeklyChallengeData'],
        }),
      ],
    });
    render(<ExportPage />);

    expect(screen.getByRole('button', { name: /weekly challenge \(\.html\)/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /weekly challenge scorm/i })).toBeInTheDocument();
  });

  it('shows Teaching Resources row when discussions OR activities are present', () => {
    useCourseStore.setState({
      syllabus: makeSyllabus(1),
      chapters: [
        makeChapter({
          number: 1,
          title: 'Chapter 1',
          discussionData: [{ prompt: 'p', hook: 'h' }],
        }),
      ],
    });
    render(<ExportPage />);

    expect(screen.getByRole('button', { name: /teaching resources/i })).toBeInTheDocument();
  });

  it('marks a chapter "Ready" when it has all 8 artifact types', () => {
    useCourseStore.setState({
      syllabus: makeSyllabus(1),
      chapters: [
        makeChapter({
          number: 1,
          title: 'Chapter 1',
          practiceQuizData: 'Q',
          inClassQuizData: [
            { question: 'q', correctAnswer: 'a', correctFeedback: 'f', distractors: [] },
          ],
          weeklyChallengeData: { questions: [] } as unknown as GeneratedChapter['weeklyChallengeData'],
          slidesJson: [{ title: 't', body: 'b' }] as unknown as GeneratedChapter['slidesJson'],
          audioUrl: 'blob:audio',
          discussionData: [{ prompt: 'p', hook: 'h' }],
          infographicDataUri: 'data:image/jpeg;base64,xxx',
        }),
      ],
    });
    render(<ExportPage />);

    expect(screen.getByText(/^ready$/i)).toBeInTheDocument();
    expect(screen.getByText(/all files ready/i)).toBeInTheDocument();
  });

  it('shows the Curriculum Alignment Matrix card only when curriculumMap is set', () => {
    useCourseStore.setState({ syllabus: makeSyllabus(2) });
    const { rerender } = render(<ExportPage />);
    expect(screen.queryByText(/curriculum alignment matrix/i)).not.toBeInTheDocument();

    useCourseStore.setState({
      curriculumMap: {
        objectives: [
          { id: 'o1', text: 'Define mean', bloomLevel: 'Remember' },
          { id: 'o2', text: 'Compute variance', bloomLevel: 'Apply' },
        ],
        chapterMap: {},
      } as unknown as CurriculumMap,
    });
    rerender(<ExportPage />);

    expect(screen.getByText(/curriculum alignment matrix/i)).toBeInTheDocument();
    expect(screen.getByText(/2 learning objectives/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download csv/i })).toBeInTheDocument();
  });

  it('lets a user click the Reading row without crashing (smoke check on the download handler)', async () => {
    const user = userEvent.setup();
    useCourseStore.setState({
      syllabus: makeSyllabus(1),
      chapters: [makeChapter({ number: 1, title: 'Chapter 1' })],
    });
    render(<ExportPage />);

    await user.click(screen.getByRole('button', { name: /reading \(\.html\)/i }));
    // No assertion needed — we're verifying the click doesn't throw.
  });
});
