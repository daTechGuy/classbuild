import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { InClassQuizQuestion } from '../src/types/course';

// Hoisted mock for streamMessage so each test can program the next response.
const { mockStreamMessage } = vi.hoisted(() => ({ mockStreamMessage: vi.fn() }));
vi.mock('../src/services/claude/streaming', () => ({
  streamMessage: mockStreamMessage,
}));

import { balancePracticeQuiz, balanceInClassQuiz } from '../src/services/quiz/answerBalancer';

function buildPracticeMarkdown(questions: Array<{ id: number; correctLong: boolean }>): string {
  return questions
    .map(({ id, correctLong }) => {
      // When correctLong is true, option `a` is clearly the longest.
      // When false, the distractors are longer so audit won't flag this row.
      const correct = correctLong
        ? 'The correct answer involves a multi-step argument about why this option is the best fit.'
        : 'Yes.';
      const distractor = correctLong
        ? 'No'
        : 'A long-winded distractor that the audit will consider as the maximum length option';
      return `${id}. **Q${id}?**

  a. ${correct}
  b. ${distractor} (b)
  c. ${distractor} (c)
  d. ${distractor} (d)

Answer: a`;
    })
    .join('\n---\n');
}

function makeInClassQuestion(correctLong: boolean): InClassQuizQuestion {
  return {
    question: 'What is X?',
    correctAnswer: correctLong
      ? 'The correct answer involves a multi-step argument about why this option fits best.'
      : 'Short correct.',
    correctFeedback: 'Yes!',
    distractors: [
      { text: 'Short A', feedback: 'no' },
      { text: 'Short B', feedback: 'no' },
      { text: 'Short C', feedback: 'no' },
    ],
  };
}

describe('balancePracticeQuiz', () => {
  beforeEach(() => {
    mockStreamMessage.mockReset();
  });

  it('returns the markdown unchanged when there are 4 or fewer questions (audit skipped)', async () => {
    const md = buildPracticeMarkdown([
      { id: 1, correctLong: true },
      { id: 2, correctLong: true },
      { id: 3, correctLong: true },
      { id: 4, correctLong: true },
    ]);
    const out = await balancePracticeQuiz(md, 'sk-test');
    expect(out).toBe(md);
    expect(mockStreamMessage).not.toHaveBeenCalled();
  });

  it('returns the markdown unchanged when the correct answer is never the longest (no flags)', async () => {
    const md = buildPracticeMarkdown([
      { id: 1, correctLong: false },
      { id: 2, correctLong: false },
      { id: 3, correctLong: false },
      { id: 4, correctLong: false },
      { id: 5, correctLong: false },
      { id: 6, correctLong: false },
    ]);
    const out = await balancePracticeQuiz(md, 'sk-test');
    expect(out).toBe(md);
    expect(mockStreamMessage).not.toHaveBeenCalled();
  });

  it('calls Claude to rewrite distractors when the correct answer is longest in too many questions', async () => {
    const md = buildPracticeMarkdown([
      { id: 1, correctLong: true },
      { id: 2, correctLong: true },
      { id: 3, correctLong: true },
      { id: 4, correctLong: true },
      { id: 5, correctLong: true },
      { id: 6, correctLong: true },
      { id: 7, correctLong: true },
      { id: 8, correctLong: true },
    ]);
    // Return a JSON array that replaces one distractor on each rewritten question.
    mockStreamMessage.mockResolvedValueOnce(
      JSON.stringify([
        { id: 1, distractors: ['Short A elaborated with a plausible-sounding mechanism', 'Short B', 'Short C'] },
      ]),
    );

    const out = await balancePracticeQuiz(md, 'sk-test');

    expect(mockStreamMessage).toHaveBeenCalledTimes(1);
    // The rewrite is randomly sampled; we can't assert which question got
    // rewritten, but the response we stubbed targets question 1's distractor.
    expect(out).toContain('Short A elaborated with a plausible-sounding mechanism');
  });

  it('falls back to the original markdown when the LLM call throws', async () => {
    const md = buildPracticeMarkdown([
      { id: 1, correctLong: true },
      { id: 2, correctLong: true },
      { id: 3, correctLong: true },
      { id: 4, correctLong: true },
      { id: 5, correctLong: true },
      { id: 6, correctLong: true },
      { id: 7, correctLong: true },
      { id: 8, correctLong: true },
    ]);
    mockStreamMessage.mockRejectedValueOnce(new Error('boom'));

    const out = await balancePracticeQuiz(md, 'sk-test');
    expect(out).toBe(md);
  });

  it('returns the original markdown when input is so unparseable no questions extract (audit excess = 0)', async () => {
    const out = await balancePracticeQuiz('completely freeform text with no question structure', 'sk-test');
    expect(out).toBe('completely freeform text with no question structure');
    expect(mockStreamMessage).not.toHaveBeenCalled();
  });
});

describe('balanceInClassQuiz', () => {
  beforeEach(() => {
    mockStreamMessage.mockReset();
  });

  it('returns the input quiz unchanged when ≤ 4 questions', async () => {
    const quiz = [makeInClassQuestion(true), makeInClassQuestion(true)];
    const out = await balanceInClassQuiz(quiz, 'sk-test');
    expect(out).toBe(quiz);
    expect(mockStreamMessage).not.toHaveBeenCalled();
  });

  it('rewrites distractor text on flagged questions while preserving feedback fields', async () => {
    const quiz = Array.from({ length: 8 }, () => makeInClassQuestion(true));
    // Return rewrites for index 0 — replace the first distractor.
    mockStreamMessage.mockResolvedValueOnce(
      JSON.stringify([
        { id: 0, distractors: ['Elaborated A with realistic detail', 'Short B', 'Short C'] },
      ]),
    );

    const out = await balanceInClassQuiz(quiz, 'sk-test');

    // Find the question whose first distractor was changed; verify feedback
    // came through untouched.
    const changed = out.find(q => q.distractors[0].text === 'Elaborated A with realistic detail');
    expect(changed).toBeDefined();
    expect(changed!.distractors[0].feedback).toBe('no');
    expect(changed!.correctAnswer).toMatch(/multi-step argument/);
    expect(changed!.correctFeedback).toBe('Yes!');
  });

  it('returns the input quiz unchanged when the LLM call throws', async () => {
    const quiz = Array.from({ length: 8 }, () => makeInClassQuestion(true));
    mockStreamMessage.mockRejectedValueOnce(new Error('rate limited'));

    const out = await balanceInClassQuiz(quiz, 'sk-test');
    expect(out).toBe(quiz);
  });

  it('handles fenced JSON in the LLM response', async () => {
    const quiz = Array.from({ length: 8 }, () => makeInClassQuestion(true));
    mockStreamMessage.mockResolvedValueOnce(
      "Sure, here it is:\n```json\n" +
        JSON.stringify([{ id: 0, distractors: ['Fenced A', 'Short B', 'Short C'] }]) +
        '\n```',
    );

    const out = await balanceInClassQuiz(quiz, 'sk-test');
    const changed = out.find(q => q.distractors[0].text === 'Fenced A');
    expect(changed).toBeDefined();
  });
});
