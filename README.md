# Canvas Agent

MCP server that connects AI assistants — Google's Gemini CLI, Claude Code, and Claude Desktop — to [Instructure Canvas LMS](https://www.instructure.com/canvas). Teachers and administrators can manage courses, assignments, grades, and more through natural language.

> **Looking to install Canvas Agent?** Follow the setup guide at **[hughsibbele.github.io/Canvas-Agent](https://hughsibbele.github.io/Canvas-Agent)** — no technical background required.

---

## Architecture

Canvas Agent is a [Model Context Protocol](https://modelcontextprotocol.io/) server that the AI client launches as a subprocess and communicates with over stdio.

```
AI client (Claude Code / Claude Desktop / Gemini CLI)
  └─ spawns canvas-agent via npx
       └─ MCP stdio transport
            └─ Canvas REST API (bearer token auth)
```

| Component | Path | Role |
|---|---|---|
| MCP server | `src/index.ts` | Registers 18 tool modules with the MCP SDK |
| Canvas API client | `src/canvas-client.ts` | Thin fetch wrapper with automatic pagination (`canvasAll` for flat array endpoints, `canvasAllWrapped` for `{key: [...], linked: {…}}` shapes) and rate-limit backoff. Pipes every response through anonymizer → name-detector → sandbox before returning. |
| Tool modules | `src/tools/*.ts` | One file per Canvas domain — each exports a `register*Tools(server)` function |
| Privacy pipeline | `src/anonymizer.ts`, `src/name-detector.ts`, `src/sandbox.ts`, `src/vault.ts` | Three-stage redaction at the MCP boundary: token-swap structured PII fields, redact student names inside free text, wrap untrusted content with prompt-injection delimiters. Per-course vault tracks role (student/teacher/unknown); teachers are exempt. Map lives in `~/.canvas-agent/vault/`. |
| CLI entry point | `src/cli.ts` | `npx canvas-agent` starts the server; `setup` runs the wizard; `reveal <token>` decodes tokens; `vault-gc` prunes orphan vault rows. |
| Setup wizard | `src/setup.ts` | Interactive CLI that validates credentials, detects Claude Code / Desktop / Gemini CLI, and registers the MCP server |
| Landing site | `docs/` | Static GitHub Pages site with the end-user setup guide |

### Tool modules

| Module | File | Covers |
|---|---|---|
| Courses | `courses.ts` | List courses, grading periods, grading standards, late policy, sections, assignment groups |
| Assignments | `assignments.ts` | CRUD assignments, batch update dates |
| Submissions | `submissions.ts` | List/download submissions, submission summaries, missing submissions |
| Grading | `grading.ts` | Grade submissions, bulk grade, grade with rubric, post/hide grades |
| Rubrics | `rubrics.ts` | CRUD rubrics, copy rubrics across assignments/courses, associate/remove on assignments with display toggles (hide_points / hide_score_total / hide_outcome_results), link criteria to learning outcomes, view/edit/delete rubric assessments |
| Outcomes | `outcomes.ts` | List learning outcomes and outcome groups in a course, get outcome details, list per-assessment outcome results, get mastery rollups (per-student or class-wide aggregate) |
| Modules | `modules.ts` | CRUD modules and module items, publish modules |
| Pages | `pages.ts` | CRUD pages, front page, page revisions |
| Discussions | `discussions.ts` | CRUD discussions, download entries |
| Quizzes | `quizzes.ts` | Classic Quizzes — CRUD, update dates, quiz reports |
| New Quizzes | `new-quizzes.ts` | New Quizzes — CRUD, quiz items, accommodations |
| Calendar | `calendar.ts` | CRUD calendar events |
| Files | `files.ts` | List/get/update/delete files, folders, quota |
| Enrollments | `enrollments.ts` | List students, user profiles, student enrollments |
| Communication | `communication.ts` | Inbox messages, announcements, submission comments |
| Groups | `groups.ts` | Group sets, groups, membership, auto-distribute |
| Analytics | `analytics.ts` | Course activity/assignment analytics, student summaries/activity/messaging |
| Scheduling | `scheduling.ts` | Course schedule overview |

## Development

```bash
git clone https://github.com/hughsibbele/Canvas-Agent.git
cd Canvas-Agent
npm install
cp .env.example .env     # add your CANVAS_API_URL and CANVAS_API_TOKEN
npm run build
node dist/cli.js         # start MCP server
node dist/cli.js setup   # run setup wizard
```

`npm run dev` starts `tsc --watch` for iterating on tool modules.

### Adding a tool

1. Create `src/tools/<domain>.ts` exporting a `register<Domain>Tools(server: McpServer)` function.
2. Import and call it in `src/index.ts`.
3. Rebuild (`npm run build`) and restart Claude to pick up the new tools.

Each tool module follows the same pattern — define Zod input schemas and register them with `server.tool()`. Look at any existing module for the template.

## Privacy & safety pipeline

Every Canvas response flows through a three-stage redaction pipeline in `canvas-client.ts` before it reaches the AI assistant:

1. **Structured PII anonymizer** (`src/anonymizer.ts`). Walks the response and swaps student names, emails, login IDs, SIS ids, etc. for opaque tokens (`Student_<6 hex>`) on every user-shaped object. Records each user in a per-course vault keyed by Canvas user_id, with a derived role tag.
2. **Free-text name detector** (`src/name-detector.ts`). Scans free-text fields (discussion bodies, submission prose, comments, descriptions, filenames) for any known student's full name or sortable form (`"Jane Doe"` / `"Doe, Jane"`) and replaces matches with the student's existing token. Uses Unicode-aware boundaries so names with apostrophes (`O'Brien`) and hyphens (`Smith-Jones`) match correctly. Per-course regex is cached and invalidated when the vault changes.
3. **Prompt-injection sandbox** (`src/sandbox.ts`). Wraps the same set of free-text fields with per-process nonce delimiters (`<untrusted-canvas-content-NONCE>…</untrusted-canvas-content-NONCE>`) so a downstream LLM treats student-authored content as data, not instructions. The nonce is process-random — a student can't guess it to forge a closing tag and "break out" of the sandbox.

On the write path, `rehydrateText` swaps tokens back to real names and strips any sandbox markers the LLM may have echoed back, so comments and announcements go out correctly addressed and don't leak protection markers into Canvas.

### Roles — teachers stay readable

The vault tags each user as `student`, `teacher`, or `unknown`. Roles are derived from enrollment context (`enrollments[].type`, `grader_*` / `assessor` / `edited_by` / `graded_by` field positions) and merged monotonically (`teacher > student > unknown`, never downgrades). **Known teachers skip tokenization entirely** — their real names pass through to the AI. This keeps workflows like "did I grade this?" working and avoids treating staff as the subject of privacy protection.

### CLI tools

```bash
canvas-agent reveal Student_a4f2c1              # decode a token (any course)
canvas-agent reveal Student_a4f2c1 --course 42  # single course
canvas-agent reveal --all --course 42           # dump every entry for a course

canvas-agent vault-gc                           # dry-run report of orphan vault rows
canvas-agent vault-gc --apply                   # actually prune them
canvas-agent vault-gc --course 42 --verbose     # scope + show student-by-student detail
```

`vault-gc` cleans up orphan rows that accumulated under the pre-1.5.0 `id`-vs-`user_id` bug, where each discussion entry / submission / comment minted a phantom vault row keyed by entry id instead of user id. Default mode is dry-run.

The whole pipeline can be disabled with `CANVAS_AGENT_ANONYMIZE=0` (turns off both anonymization and free-text name detection) or `CANVAS_AGENT_SANDBOX=0` (turns off only the prompt-injection wrapper).

### Limits worth knowing

- `search_term` queries hit Canvas's real-name index. If the AI sends a token, Canvas finds nothing — reveal offline and search by `user_id` instead.
- `download_submissions` writes submission attachments (Word docs, PDFs, etc.) as raw bytes to disk by design. Those files contain real student names and submission content; they stay on your local machine but aren't redacted.
- The free-text name detector matches only the full name and sortable form. First-name-only and last-name-only references go through unchanged (deliberate — too many false positives on common English words).
- Account-level endpoints (`/accounts/*`, top-level `/conversations` lists) carry no per-course context, so the per-course vault doesn't apply to them.

## Canvas API gotchas

A few things worth knowing when adding or updating tools:

- **Grading periods** scope grades and submissions to a single semester/term. Pass `grading_period_id` to `/courses/{id}/enrollments` (returns per-period `current_score`/`current_grade`) and to `/courses/{id}/students/submissions` (returns only that period's submissions). Without it you get cumulative data, which is wrong for year-long courses where the gradebook resets each semester.
- **`/courses/{id}/grading_periods` returns a wrapped response** — `{"grading_periods": [...], "meta": {...}}` — so the `canvasAll` pagination helper won't flatten it. Use `canvas` and unwrap manually (see `list_grading_periods` in `tools/courses.ts`).
- **Analytics endpoints don't support `grading_period_id`** — `get_student_summaries`, `get_course_assignment_analytics`, and `get_student_assignment_data` always return lifetime totals. For semester-scoped data, fetch submissions directly with `grading_period_id`.

## Links

- **npm**: [canvas-agent](https://www.npmjs.com/package/canvas-agent)
- **Setup guide**: [hughsibbele.github.io/Canvas-Agent](https://hughsibbele.github.io/Canvas-Agent)
- **Canvas API docs**: [canvas.instructure.com/doc/api](https://canvas.instructure.com/doc/api/)

## License

MIT
