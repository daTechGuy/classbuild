<!--
  keywords: canvas lms, common cartridge, imscc export, course builder, ai course generator, instructure canvas
  fork-of: https://github.com/jtangen/classbuild
  repository: https://github.com/daTechGuy/CanvasClassBuild
-->

# CanvasClassBuild

[![CI](https://github.com/daTechGuy/CanvasClassBuild/actions/workflows/ci.yml/badge.svg)](https://github.com/daTechGuy/CanvasClassBuild/actions/workflows/ci.yml)

**An AI-assisted Canvas course builder.** Upload a Canvas course template, describe your course, get an `.imscc` ready to import.

A fork of [ClassBuild](https://github.com/jtangen/classbuild) by Jason Tangen, retargeted at instructors who need to ship Canvas-shaped courses fast: takes a Canvas course export (`.imscc`) as a structural template, generates AI content for each module that matches the template's pattern, and produces a fresh `.imscc` for re-import.

> **Compatible with Canvas LMS — not affiliated with Instructure, Inc.** Canvas® is a registered trademark of Instructure, Inc.

---

## What CanvasClassBuild adds on top of ClassBuild

| Capability | Where it lives |
|---|---|
| Upload a Canvas `.imscc` template, parse the module structure, classify modules as `verbatim` / `pattern` / `example-pattern` | [/templates](src/pages/TemplatePreviewPage.tsx) page |
| Generate per-chapter Canvas Module content (1× Module Overview, 1+ MN Instructor Notes, 1× MN Discussion) | "Canvas Module" tab on Build |
| Batch generation: "Generate All Canvas Modules" for the whole course at once | Build header |
| Export an `.imscc` that mirrors the template's structure: verbatim modules carry through untouched, pattern modules replaced by generated content, LTI links + web_resources passed through | "Export for Canvas (.imscc)" button |
| Upload a course-outline `.docx` and have an LLM extract title / description / course information / course materials → populates Canvas's Syllabus tab body at export time | Setup page |
| Pluggable LLM provider — **Anthropic (Claude)** or **Ollama Cloud** for course-content generation | Setup → Course-content provider |
| Pluggable research backend — **Claude web search**, **Tavily**, or **Wikipedia** | Setup → Research backend |
| Advanced-mode toggle — hides multimedia outputs (slides, audio, infographic, weekly challenge, activities) by default to keep the Canvas-focused happy path tight | Setup page bottom |

## Install

```bash
git clone https://github.com/daTechGuy/CanvasClassBuild.git
cd CanvasClassBuild
npm install
npm run dev
```

Open [localhost:5173](http://localhost:5173).

**Bring Your Own Key** — keys are entered through the Setup page and never leave your browser. There is no server-side component except a Vite dev proxy that exists solely to bypass Ollama Cloud's missing browser CORS headers.

## API keys

| Provider | Required when… | What it does |
|---|---|---|
| Anthropic Claude | LLM provider = Anthropic, **OR** research backend = Claude web search | Course-content generation; Claude's built-in web search for the Research stage |
| Ollama Cloud | LLM provider = Ollama Cloud | Course-content generation. Free tier doesn't include cloud models — see ollama.com/settings/keys |
| Tavily | Research backend = Tavily | Web search for the Research stage. Free tier covers ~1,000 searches/month |
| Google Gemini | Advanced mode + you want infographics or audiobook narration | TTS + image generation (optional) |

The Wikipedia research backend needs no key.

## End-to-end Canvas course flow

1. **Upload your Canvas course template.** Visit `/templates`, drop in an `.imscc` you exported from a previous Canvas course. The parser identifies which modules to keep verbatim (Instructor Information, Begin Here / Introductory) and which are placeholder patterns to be replaced (Module 1, Module 2, …).
2. **Setup.** Enter the course topic and chapter count (defaults to 16 when a template is selected). Optionally upload a course-outline `.docx`; an LLM extracts the title, description, course information, and materials so they populate the Canvas Syllabus tab at export time.
3. **Syllabus.** AI generates chapter titles in the locked `Module N: <topic>` format. Edit the topic suffix per chapter from the inline editor — the locked prefix is preserved on save.
4. **Research.** Choose a backend. Claude web search is the highest-quality but Anthropic-only; Tavily and Wikipedia work with any LLM provider. Skippable.
5. **Build.** For each chapter, click "Generate Canvas Module" (or batch with "Generate All Canvas Modules") to produce the Module Overview + Instructor Notes pages + Discussion. The locked `MN Instructor Notes:` / `MN Discussion:` prefixes are added at export time.
6. **Export.** "Export for Canvas (.imscc)" routes through a template-aware exporter. Output: a fresh `.imscc` containing your verbatim modules, your generated Module N modules, all original LTI links, all original web_resources images, and a Syllabus tab body composed from the outline DOCX. Drop it into Canvas via Settings → Import Course Content → Common Cartridge Package.

## Inherited multimedia features (advanced mode)

The upstream ClassBuild also produces:

- Interactive HTML reading with embedded widgets
- Gamified practice quiz with confidence calibration
- In-class quiz (5 shuffled versions + answer keys)
- PowerPoint slides with speaker notes
- AI-narrated audiobook (Gemini TTS)
- AI-generated infographic (Gemini)
- Weekly mastery challenge with 6 question types and SCORM 2004 wrapper
- Discussion starters and classroom activities

These are hidden behind the "Advanced mode" toggle on Setup so the Canvas-focused workflow stays tight. Flip it on and the Build page surfaces all the additional tabs.

## Tests

Vitest scaffold covering the parser + exporter critical paths. Network-free,
runs in <1s.

```bash
npm test               # run once
npm run test:watch     # re-run on file change
npm run test:coverage  # generate coverage report
```

Current coverage:
- `tests/template-parser.test.ts` — module classification (verbatim / pattern / example-pattern), prefix detection (`Module N:`, `MN Instructor Notes:`, fully-locked `Module N Overview`), `(Example to Edit)` placeholder marker, `**EDIT**` markers, example-pattern content extraction.
- `tests/imscc-exporter.test.ts` — manifest shape, course_settings extension files, reading webcontent, QTI 1.2 quiz emission (practice + in-class + weekly challenge), Canvas auto-publish sidecars, native discussion topics.
- `tests/template-imscc-exporter.test.ts` — round-trip: build template fixture → emit IMSCC → re-parse → verify verbatim modules preserved, pattern modules replaced, `web_resources/` + `lti_resource_links/` pass through. Outline-field overrides on title / syllabus body / manifest LOM.
- `tests/parse-outline-docx.test.ts` — outline-DOCX field extraction with the LLM mocked: clean JSON, code-fenced JSON, partial / empty / malformed responses, char-cap on long input, provider override forwarding.
- `tests/generate-template-chapter.test.ts` — Canvas Module generation with the LLM mocked: parse success / failure / missing-required-field, few-shot exemplar embedding, no-example case, Ollama provider plumbing, Anthropic Sonnet default.
- `tests/components/TemplatePicker.test.tsx` — empty state, listing uploaded templates, selecting a template sets `templateId` + `numChapters=16`, "No template" doesn't touch `numChapters`, active-template notice.
- `tests/components/CourseOutlineUpload.test.tsx` — empty preview, populated preview, Clear resets the store, textarea edits write through, blanking a field deletes the key.
- `tests/components/TemplateTitleEditor.test.tsx` — locked-prefix display, save reassembles `Module N: <suffix>` with prefix intact, blanking the suffix preserves just the prefix, off-pattern titles get a synthesized prefix, Reset rolls drafts back.
- `tests/research-wikipedia.test.ts` — Wikipedia backend with LLM + `fetch` both mocked: query gen → per-query API call → synthesis call ordering, URL builder + dedup, `<span class="searchmatch">` snippet stripping, per-query failure doesn't abort batch, progress phase transitions, fallback query when query-gen returns nothing parseable.
- `tests/research-tavily.test.ts` — Tavily backend with LLM + `fetch` both mocked: missing-key throw, POST body shape (`max_results`, `search_depth`, `include_answer`) + bearer auth, cross-query dedup by URL, content snippets feed into synthesis prompt, hits without a URL are dropped, per-query failure doesn't abort batch, progress phase order, `published_date` preserved as `pageAge`.

## Deploying to production

The app is a static SPA, so any static host works. The one wrinkle is **Ollama Cloud requires a serverless proxy**: ollama.com doesn't set CORS headers, so direct browser fetches are blocked. A Vercel Edge function ships with the repo at [`api/ollama-proxy.ts`](api/ollama-proxy.ts) — Vercel picks it up automatically. Other hosts:

- **Vercel** — `vercel deploy`. The Edge function and the SPA rewrite in `vercel.json` come along for free.
- **Cloudflare Pages** — port `api/ollama-proxy.ts` to a Workers function (same logic, different runtime API).
- **Static-only host** (Netlify static, GitHub Pages, S3) — Ollama selection won't work; users must pick Anthropic.

The browser always calls `/api/ollama-proxy` regardless of provider — the Vite dev server forwards in development, the Vercel function forwards in production.

## CLI

### Canvas course CLI ([`scripts/canvas-course.ts`](scripts/canvas-course.ts))

Headless equivalent of the UI's Canvas-template flow. Takes a topic + a template `.imscc` (and optionally an outline `.docx`), generates a syllabus + Canvas Module content for each chapter, and writes a fresh `.imscc` ready for Canvas import.

```bash
ANTHROPIC_API_KEY=sk-... npx tsx scripts/canvas-course.ts \
  --topic "Statistics for Data Science" \
  --template ./template.imscc \
  --outline ./outline.docx \
  --chapters 16 \
  --output ./output/stats
```

Flags:

| Flag | Default | Purpose |
|---|---|---|
| `--topic` | required | Course topic |
| `--template` | required | Path to a Canvas `.imscc` template export |
| `--outline` | — | Path to a course-outline `.docx` (populates the Canvas Syllabus tab body) |
| `--chapters` | `16` | Number of Module N modules to generate |
| `--output` | `./output` | Output directory |
| `--level` | `advanced-undergrad` | Audience |
| `--length` | `standard` | `concise` / `standard` / `comprehensive` |
| `--cohort` | `60` | Class size |
| `--notes` | — | Additional learner context |
| `--provider` | `anthropic` | LLM provider — `anthropic` or `ollama`. With `ollama`, set `OLLAMA_API_KEY`; with `anthropic`, set `ANTHROPIC_API_KEY` |
| `--ollama-model` | `gpt-oss:120b-cloud` | Ollama model used when `--provider ollama` |
| `--concurrency` | `3` | Parallel chapters during Canvas Module generation |
| `--syllabus` | — | Path to existing `syllabus.json` (skip regeneration) |
| `--skip-canvas-module` | `false` | Skip per-chapter content generation (for fast manifest-only test runs) |

Ollama example:

```bash
OLLAMA_API_KEY=... npx tsx scripts/canvas-course.ts \
  --provider ollama \
  --ollama-model gpt-oss:120b-cloud \
  --topic "Statistics for Data Science" \
  --template ./template.imscc \
  --chapters 8 \
  --output ./output/stats
```

If both `OLLAMA_API_KEY` and `ANTHROPIC_API_KEY` are set, outline-DOCX extraction always uses Claude (its instruction-following on the small JSON-extraction task is more reliable) regardless of `--provider`.

### Original ClassBuild CLI ([`scripts/generate-course.ts`](scripts/generate-course.ts))

The upstream CLI is unchanged. It does **not** know about the Canvas template export, the outline DOCX path, or the Ollama backend — use it for the multimedia (slides + audio + infographic) flow.

## Project layout (fork's additions)

```
src/
  services/
    template/
      parser.ts              # parse uploaded .imscc → Template
      generateChapter.ts     # per-chapter Canvas Module generation
      templateImsccExporter.ts  # export .imscc using uploaded template as base
      parseOutlineDocx.ts    # mammoth + LLM extraction
    research/
      anthropic.ts           # Claude web_search backend
      tavily.ts              # Tavily REST + LLM synthesis
      wikipedia.ts           # Wikipedia API + LLM synthesis
    llm/
      anthropic.ts           # Anthropic SDK streaming
      ollama.ts              # Ollama Cloud NDJSON streaming
  store/
    templateStore.ts         # uploaded templates (parsed + raw .imscc Blob)
  pages/
    TemplatePreviewPage.tsx  # /templates upload + preview
  components/
    setup/
      TemplatePicker.tsx
      CourseOutlineUpload.tsx
    syllabus/
      TemplateTitleEditor.tsx
```

## Built with

React 19 · Vite 7 · TypeScript 5.9 · Tailwind CSS 4 · Zustand · JSZip · mammoth.js · Claude (Sonnet 4.6 / Opus 4.6 / Haiku 4.5) · Ollama Cloud · Tavily · Gemini

## Credit

Built on [ClassBuild](https://github.com/jtangen/classbuild) by Jason Tangen — the foundation of this fork. The IMSCC export, Canvas template handling, course-outline DOCX parsing, multi-provider LLM/research routing, and the rebrand are added on top, but the original learning-science engine, prompt library, and content generators are all from upstream.

## License

[MIT](LICENSE) — same as upstream.
