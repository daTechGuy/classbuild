# Contributing to CanvasClassBuild

Thanks for your interest. This guide covers everything you need to make a useful PR, plus some context about how this fork relates to upstream.

## Fork vs. upstream

CanvasClassBuild is a fork of [jtangen/classbuild](https://github.com/jtangen/classbuild). Contribute here for the Canvas-specific feature surface (template upload, IMSCC export, course-outline DOCX parsing, Ollama / Tavily / Wikipedia providers, the rebrand). Contribute upstream for the original multimedia AI course generator (interactive readings, gamified quizzes, slides, audiobook narration, infographics).

If your change improves something both forks would benefit from (e.g. a fix to a prompt builder or a shared service), open it against [jtangen/classbuild](https://github.com/jtangen/classbuild) and mention us in the PR description so we can pull it in.

## Project setup

```bash
git clone https://github.com/daTechGuy/CanvasClassBuild.git
cd CanvasClassBuild
npm install
npm run dev    # http://localhost:5173
```

Common commands:

| Command | What it does |
|---|---|
| `npm run dev` | Start the Vite dev server with HMR + the Ollama proxy |
| `npm run build` | `tsc -b && vite build` — production bundle |
| `npm run lint` | ESLint over the whole tree |
| `npm test` | Run the vitest suite once (~1.2s, 82 tests, network-free) |
| `npm run test:watch` | Re-run tests on file change |
| `npm run test:coverage` | Coverage report |

The dev server proxies `/api/ollama-proxy` to `https://ollama.com/api/chat` so the Ollama provider works in development. In production (Vercel), the same path is served by `api/ollama-proxy.ts`.

## Branch + commit conventions

- Branch off `main`. Use a short, descriptive branch name — `phase4-export`, `fix-quiz-publish`, `docs-readme`.
- Keep each commit focused on one logical change. Multiple small commits per PR are fine.
- Use imperative commit subjects ("Add X", "Fix Y", "Refactor Z") — under ~70 chars.
- Include a body when the *why* isn't obvious from the diff. This codebase already has many commits whose bodies explain the trade-off considered; mirror that style.

## What every PR needs

1. **Description** — what changes, why. Reference any related issues.
2. **Test plan** — what you ran locally, what to spot-check on the dev server, what the expected outcome looks like. Mirror the PR template; the template makes this concrete.
3. **CI green** — `tsc -b`, `npm run lint`, `npm test`, and `npm run build` all run automatically on every push and PR. If CI is red, the PR isn't done. Run them locally first:

   ```bash
   npx tsc -b && npm run lint && npm test && npm run build
   ```

4. **Tests added or updated** if you changed behavior. The bar:
   - New service-layer function → at least one happy-path test + one failure-path test
   - New component → at least toggle/edit/visibility behavior; LLM/`fetch` mocked
   - Parser / exporter change → round-trip if applicable
   - Pure refactor with no behavior change → no new tests required

   See [`tests/`](tests/) for the existing patterns. `vi.mock('../src/services/llm', …)` is the standard way to drive LLM-driven paths without network calls.

5. **README + tests/-section updated** if you added a new test file (the README has a per-file rundown).

## Architecture pointers

- **Service layer** (`src/services/`) is intentionally framework-agnostic so the same functions power both the UI and the CLI. Keep new services importable from Node — avoid `window`/DOM globals unless gated by `typeof window === 'undefined'`.
- **Stores** (`src/store/`) use Zustand with IndexedDB-backed persistence. Don't touch the persisted blob layout casually — bump `parserVersion` (or analogous schema marker) so existing data auto-reparses on next load.
- **Prompts** (`src/prompts/`) are pure functions returning `{ systemPrompt, userMessage }`. Tests for them go in `src/prompts/*.test.ts` or via the service that uses them.
- **CLI** (`scripts/canvas-course.ts`) shares the service layer with the UI. New behavior added to a service should flow through to the CLI without extra wiring — but check the dev cycle in both contexts.

## Trademark / attribution

The README footer notes that CanvasClassBuild is not affiliated with Instructure, Inc., and Canvas® is their registered trademark. Don't claim the project is endorsed by Instructure, and don't use the Canvas/Instructure logos. Describing compatibility ("for Canvas LMS", "imports as a Canvas course") is fine.

## License

[MIT](LICENSE), same as upstream. By submitting a PR you agree your contribution is MIT-licensed.
