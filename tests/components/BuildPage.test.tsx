import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { BuildPage } from '../../src/pages/BuildPage';
import { useCourseStore } from '../../src/store/courseStore';
import { useApiStore } from '../../src/store/apiStore';
import { useUiStore } from '../../src/store/uiStore';
import { useTemplateStore } from '../../src/store/templateStore';
import type { Syllabus, GeneratedChapter, ResearchDossier } from '../../src/types/course';

// Network/streaming + any backend the page can fire on mount: stub so tests
// never touch the network.
vi.mock('../../src/services/claude/streaming', () => ({
  streamMessage: vi.fn(() => new Promise(() => {})),
  streamWithRetry: vi.fn(() => new Promise(() => {})),
}));

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

function makeSyllabus(numChapters: number): Syllabus {
  return {
    courseTitle: 'Intro to Statistics',
    courseOverview: 'A first course in stats.',
    chapters: Array.from({ length: numChapters }, (_, i) => ({
      number: i + 1,
      title: `Topic ${i + 1}`,
      narrative: 'Narrative.',
      keyConcepts: ['mean'],
      widgets: [],
      scienceAnnotations: [],
      spacingConnections: [],
    })),
  };
}

function makeChapter(overrides: Partial<GeneratedChapter> & { number: number; title: string }): GeneratedChapter {
  return {
    htmlContent: '<html>chapter content</html>',
    ...overrides,
  };
}

function makeDossier(chapterNumber: number): ResearchDossier {
  return {
    chapterNumber,
    sources: [
      { title: 'Smith 2020', authors: 'Smith', year: '2020', summary: 'A paper.', relevance: 'Foundational.', isVerified: true },
    ],
    synthesisNotes: 'Synthesis.',
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <BuildPage />
    </MemoryRouter>,
  );
}

describe('<BuildPage />', () => {
  beforeEach(() => {
    navigateMock.mockClear();
    useCourseStore.getState().reset();
    useUiStore.setState({
      error: null,
      isGenerating: false,
      activeTab: 'chapter',
      batchGenerating: false,
      batchCurrentChapter: null,
      batchPhase: null,
      batchMaterial: null,
    });
    useApiStore.setState({
      claudeApiKey: 'sk-x',
      geminiApiKey: '',
      advancedMode: false,
    });
    useTemplateStore.setState({ templates: [], activeTemplateId: null });
    // jsdom/happy-dom stubs for the download path.
    if (!('createObjectURL' in URL)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (URL as any).createObjectURL = vi.fn(() => 'blob:mock');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (URL as any).revokeObjectURL = vi.fn();
    }
  });

  it('shows an empty state with a Back to Syllabus button when no syllabus is in the store', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByText(/no syllabus available/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /back to syllabus/i }));
    expect(navigateMock).toHaveBeenCalledWith('/syllabus');
  });

  it('renders the Build header, progress, and Go to Export button once a syllabus is loaded', () => {
    useCourseStore.setState({ syllabus: makeSyllabus(3) });
    renderPage();

    expect(screen.getByRole('heading', { name: /^build$/i })).toBeInTheDocument();
    expect(screen.getByText(/0\/3 classes/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /go to export/i })).toBeDisabled();
  });

  it('enables Go to Export and navigates to /export once at least one chapter exists', async () => {
    const user = userEvent.setup();
    useCourseStore.setState({
      syllabus: makeSyllabus(2),
      chapters: [makeChapter({ number: 1, title: 'Topic 1' })],
    });
    renderPage();

    const exportBtn = screen.getByRole('button', { name: /go to export/i });
    expect(exportBtn).toBeEnabled();
    await user.click(exportBtn);

    expect(navigateMock).toHaveBeenCalledWith('/export');
    expect(useCourseStore.getState().completedStages).toContain('build');
    expect(useCourseStore.getState().currentStage).toBe('export');
  });

  it('shows "Generate All Classes" when no chapters exist, "Generate Remaining" once some exist', () => {
    useCourseStore.setState({ syllabus: makeSyllabus(3) });
    const { unmount } = renderPage();
    expect(screen.getByRole('button', { name: /generate all classes/i })).toBeInTheDocument();

    unmount();
    useCourseStore.setState({
      syllabus: makeSyllabus(3),
      chapters: [makeChapter({ number: 1, title: 'Topic 1' })],
    });
    renderPage();
    expect(screen.getByRole('button', { name: /generate remaining classes/i })).toBeInTheDocument();
  });

  it('shows the "Generate This Class" call-to-action when chapter has research but no content yet', async () => {
    const user = userEvent.setup();
    // Chapter 1 already generated (blocks the auto-gen effect, which only
    // targets chapter 1). Chapter 2 has research but no content — that's
    // the state we want to land on.
    useCourseStore.setState({
      syllabus: makeSyllabus(2),
      researchDossiers: [makeDossier(2)],
      chapters: [makeChapter({ number: 1, title: 'Topic 1' })],
    });
    renderPage();

    // Click the sidebar entry for chapter 2 to switch to it.
    const sidebarRow = screen.getByText(/2\. topic 2/i);
    await user.click(sidebarRow);

    expect(screen.getByText(/class 2: topic 2/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate this class/i })).toBeInTheDocument();
  });

  it('warns the user when the chapter has no research, offering both "Go to Research" and "Generate Anyway"', async () => {
    const user = userEvent.setup();
    useCourseStore.setState({
      syllabus: makeSyllabus(2),
      researchDossiers: [],
      chapters: [],
    });
    renderPage();

    expect(screen.getByText(/no research has been conducted/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /go to research/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate anyway/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /go to research/i }));
    expect(navigateMock).toHaveBeenCalledWith('/research');
  });

  it('shows the default tab set (Reading / Practice Quiz / In-Class Quiz / Discussion) for a generated chapter', () => {
    useCourseStore.setState({
      syllabus: makeSyllabus(1),
      chapters: [makeChapter({ number: 1, title: 'Topic 1' })],
    });
    renderPage();

    expect(screen.getByRole('button', { name: /^reading$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^practice quiz$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^in-class quiz$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^discussion$/i })).toBeInTheDocument();
    // Advanced tabs hidden by default.
    expect(screen.queryByRole('button', { name: /^weekly challenge$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^audiobook$/i })).not.toBeInTheDocument();
  });

  it('reveals the advanced tabs (Weekly Challenge / Activities / Audiobook / Slides) when advancedMode is on', () => {
    useCourseStore.setState({
      syllabus: makeSyllabus(1),
      chapters: [makeChapter({ number: 1, title: 'Topic 1' })],
    });
    useApiStore.setState({ advancedMode: true });
    renderPage();

    expect(screen.getByRole('button', { name: /^weekly challenge$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^activities$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^audiobook$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^slides$/i })).toBeInTheDocument();
    // Infographic still hidden without Gemini key.
    expect(screen.queryByRole('button', { name: /^infographic$/i })).not.toBeInTheDocument();
  });

  it('adds the Infographic tab only when both advancedMode and a Gemini key are configured', () => {
    useCourseStore.setState({
      syllabus: makeSyllabus(1),
      chapters: [makeChapter({ number: 1, title: 'Topic 1' })],
    });
    useApiStore.setState({ advancedMode: true, geminiApiKey: 'gemini-key' });
    renderPage();

    expect(screen.getByRole('button', { name: /^infographic$/i })).toBeInTheDocument();
  });

  it('prepends the Canvas Module tab when a Canvas template is active', () => {
    useCourseStore.setState({
      syllabus: makeSyllabus(1),
      chapters: [makeChapter({ number: 1, title: 'Topic 1' })],
      setup: { ...useCourseStore.getState().setup, templateId: 'tpl-1' },
    });
    useTemplateStore.setState({
      templates: [
        {
          id: 'tpl-1',
          parserVersion: 3,
          name: 'Stats Template',
          uploadedAt: new Date().toISOString(),
          fileSizeBytes: 1234,
          modules: [],
          images: [],
          ltiResources: [],
          courseSettings: {},
          totalFiles: 5,
        },
      ],
      activeTemplateId: 'tpl-1',
    });
    renderPage();

    expect(screen.getByRole('button', { name: /^canvas module$/i })).toBeInTheDocument();
  });

  it('renders the chapter sidebar with one entry per chapter in the syllabus', () => {
    useCourseStore.setState({ syllabus: makeSyllabus(4) });
    renderPage();

    // ChapterSidebar renders each chapter as "N. Title" in a single text
    // node, so we match the full string.
    expect(screen.getByText(/1\. topic 1/i)).toBeInTheDocument();
    expect(screen.getByText(/4\. topic 4/i)).toBeInTheDocument();
  });

  it('shows the ResearchPanel header for a chapter with a research dossier', () => {
    useCourseStore.setState({
      syllabus: makeSyllabus(1),
      researchDossiers: [makeDossier(1)],
      chapters: [makeChapter({ number: 1, title: 'Topic 1' })],
    });
    renderPage();

    // The panel is collapsed by default — only the header row is in the DOM.
    expect(screen.getByText(/research — 1 source/i)).toBeInTheDocument();
  });

  it('renders a UI error banner from useUiStore.error', () => {
    useCourseStore.setState({
      syllabus: makeSyllabus(2),
      chapters: [makeChapter({ number: 1, title: 'Topic 1' })],
    });
    useUiStore.setState({ error: 'Generation failed for chapter 1.' });
    renderPage();

    expect(screen.getByText(/generation failed for chapter 1/i)).toBeInTheDocument();
  });
});
