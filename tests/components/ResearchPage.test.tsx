import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ResearchPage } from '../../src/pages/ResearchPage';
import { useCourseStore } from '../../src/store/courseStore';
import { useApiStore } from '../../src/store/apiStore';
import { useUiStore } from '../../src/store/uiStore';
import type { Syllabus, ResearchDossier } from '../../src/types/course';

// runResearch is what triggers network + LLM work; we stub it so the
// auto-start effect doesn't actually run when a key is present.
vi.mock('../../src/services/research', () => ({
  runResearch: vi.fn(() => new Promise(() => {})),
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
      narrative: 'A short narrative for the chapter that introduces the topic and motivates it.',
      keyConcepts: ['concept'],
      widgets: [],
      scienceAnnotations: [],
      spacingConnections: [],
    })),
  };
}

function makeDossier(chapterNumber: number, overrides: Partial<ResearchDossier> = {}): ResearchDossier {
  return {
    chapterNumber,
    sources: [
      { title: 'Smith 2020', authors: 'Smith, A.', year: '2020', summary: 'A study.', relevance: 'Foundational.', isVerified: true },
    ],
    synthesisNotes: 'Synthesis notes for chapter.',
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ResearchPage />
    </MemoryRouter>,
  );
}

describe('<ResearchPage />', () => {
  beforeEach(() => {
    navigateMock.mockClear();
    useCourseStore.getState().reset();
    useUiStore.setState({ error: null, isGenerating: false });
    // Default test state: anthropic backend, no claude key → backend-not-ready
    // gate fires. Tests opt into the ready state by setting claudeApiKey.
    useApiStore.setState({
      claudeApiKey: '',
      ollamaApiKey: '',
      tavilyApiKey: '',
      provider: 'anthropic',
      researchBackend: 'anthropic',
    });
  });

  it('shows the no-syllabus empty state with a Back to Syllabus button', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByText(/no syllabus generated yet/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /back to syllabus/i }));
    expect(navigateMock).toHaveBeenCalledWith('/syllabus');
  });

  it('shows the anthropic backend-not-ready notice when claude key is missing', () => {
    useCourseStore.setState({ syllabus: makeSyllabus(2) });
    renderPage();

    expect(screen.getByRole('heading', { name: /research backend not configured/i })).toBeInTheDocument();
    expect(screen.getByText(/claude web-search backend needs an anthropic api key/i)).toBeInTheDocument();
  });

  it('shows the tavily backend-not-ready notice when only the tavily key is missing', () => {
    useCourseStore.setState({ syllabus: makeSyllabus(2) });
    useApiStore.setState({ researchBackend: 'tavily', claudeApiKey: 'sk-x', tavilyApiKey: '' });
    renderPage();

    expect(screen.getByText(/tavily backend needs both a tavily key and an llm key/i)).toBeInTheDocument();
  });

  it('shows the wikipedia backend-not-ready notice when llm key is missing', () => {
    useCourseStore.setState({ syllabus: makeSyllabus(2) });
    useApiStore.setState({ researchBackend: 'wikipedia', claudeApiKey: '' });
    renderPage();

    expect(screen.getByText(/wikipedia backend needs an llm key/i)).toBeInTheDocument();
  });

  it('lets the user Skip to Build from the backend-not-ready screen', async () => {
    const user = userEvent.setup();
    useCourseStore.setState({ syllabus: makeSyllabus(2) });
    renderPage();

    await user.click(screen.getByRole('button', { name: /skip to build/i }));

    expect(navigateMock).toHaveBeenCalledWith('/build');
    expect(useCourseStore.getState().completedStages).toContain('research');
    expect(useCourseStore.getState().currentStage).toBe('build');
  });

  it('renders the dossier header + chapter tabs + first chapter detail when the backend is ready', () => {
    useCourseStore.setState({ syllabus: makeSyllabus(3) });
    useApiStore.setState({ claudeApiKey: 'sk-x' });
    renderPage();

    expect(screen.getByRole('heading', { name: /research dossiers/i })).toBeInTheDocument();
    expect(screen.getByText(/0 of 3 classes researched/i)).toBeInTheDocument();
    // First chapter's detail card.
    expect(screen.getByRole('heading', { name: /class 1: topic 1/i })).toBeInTheDocument();
    // Chapter tabs — one per chapter.
    expect(screen.getByRole('button', { name: /^class 1$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^class 3$/i })).toBeInTheDocument();
  });

  it('hides the Skip Research button once at least one dossier exists', () => {
    // The auto-start effect fires research on mount whenever the backend is
    // ready and dossiers are empty, so the "no research started" state isn't
    // stable in a ready-backend test. We test the post-research state: once
    // a dossier exists, Skip Research is gone.
    useCourseStore.setState({
      syllabus: makeSyllabus(2),
      researchDossiers: [makeDossier(1)],
    });
    useApiStore.setState({ claudeApiKey: 'sk-x' });
    renderPage();

    const skipButtons = screen.queryAllByRole('button', { name: /^skip research$/i });
    expect(skipButtons).toHaveLength(0);
  });

  it('shows a completed dossier with source title and Verified badge', () => {
    useCourseStore.setState({
      syllabus: makeSyllabus(2),
      researchDossiers: [makeDossier(1)],
    });
    useApiStore.setState({ claudeApiKey: 'sk-x' });
    renderPage();

    expect(screen.getByText('Smith 2020')).toBeInTheDocument();
    expect(screen.getByText(/^verified$/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /synthesis/i })).toBeInTheDocument();
    expect(screen.getByText(/synthesis notes for chapter/i)).toBeInTheDocument();
  });

  it('shows a "Verify" badge (not "Verified") for AI-generated sources', () => {
    useCourseStore.setState({
      syllabus: makeSyllabus(1),
      researchDossiers: [
        makeDossier(1, {
          sources: [
            { title: 'Unverified Paper', authors: 'AI', year: '2026', summary: 'Made up.', relevance: 'Maybe.', isVerified: false },
          ],
        }),
      ],
    });
    useApiStore.setState({ claudeApiKey: 'sk-x' });
    renderPage();

    expect(screen.getByText(/^verify$/i)).toBeInTheDocument();
  });

  it('disables "Previous Class" on the first chapter and "Research Next Class" on the last', async () => {
    const user = userEvent.setup();
    useCourseStore.setState({ syllabus: makeSyllabus(2) });
    useApiStore.setState({ claudeApiKey: 'sk-x' });
    renderPage();

    expect(screen.getByRole('button', { name: /previous class/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /research next class/i })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: /research next class/i }));
    expect(screen.getByRole('button', { name: /previous class/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /research next class/i })).toBeDisabled();
  });

  it('shows the empty-state Start Research button for a chapter that has no dossier yet', () => {
    // 3 chapters, dossier already exists for chapter 2 → the auto-start
    // effect skips (researchDossiers.length !== 0). The page lands on
    // chapter 1, which has no dossier and isn't being researched → empty
    // state is visible.
    useCourseStore.setState({
      syllabus: makeSyllabus(3),
      researchDossiers: [makeDossier(2)],
    });
    useApiStore.setState({ claudeApiKey: 'sk-x' });
    renderPage();

    expect(screen.getByText(/no research yet for this class/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start research/i })).toBeInTheDocument();
  });

  it('Continue to Build advances to build stage and navigates', async () => {
    const user = userEvent.setup();
    useCourseStore.setState({
      syllabus: makeSyllabus(2),
      researchDossiers: [makeDossier(1)],
    });
    useApiStore.setState({ claudeApiKey: 'sk-x' });
    renderPage();

    await user.click(screen.getByRole('button', { name: /continue to build/i }));

    expect(navigateMock).toHaveBeenCalledWith('/build');
    expect(useCourseStore.getState().completedStages).toContain('research');
    expect(useCourseStore.getState().currentStage).toBe('build');
  });

  it('shows the "Research all remaining" link when more than one chapter is still unresearched', () => {
    useCourseStore.setState({ syllabus: makeSyllabus(4) });
    useApiStore.setState({ claudeApiKey: 'sk-x' });
    renderPage();

    expect(screen.getByRole('button', { name: /research all remaining/i })).toBeInTheDocument();
  });
});
