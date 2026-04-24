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
| MCP server | `src/index.ts` | Registers 15 tool modules with the MCP SDK |
| Canvas API client | `src/canvas-client.ts` | Thin fetch wrapper with automatic pagination and rate-limit backoff |
| Tool modules | `src/tools/*.ts` | One file per Canvas domain — each exports a `register*Tools(server)` function |
| Anonymizer / vault | `src/anonymizer.ts`, `src/vault.ts` | Token-swap student PII at the MCP boundary; map lives in `~/.canvas-agent/vault/` |
| CLI entry point | `src/cli.ts` | `npx canvas-agent` starts the server; `npx canvas-agent setup` runs the wizard; `npx canvas-agent reveal <token>` decodes tokens |
| Setup wizard | `src/setup.ts` | Interactive CLI that validates credentials, detects Claude Code / Desktop / Gemini CLI, and registers the MCP server |
| Landing site | `docs/` | Static GitHub Pages site with the end-user setup guide |

### Tool modules

| Module | File | Covers |
|---|---|---|
| Courses | `courses.ts` | List courses, grading periods, grading standards, late policy, sections, assignment groups |
| Assignments | `assignments.ts` | CRUD assignments, batch update dates |
| Submissions | `submissions.ts` | List/download submissions, submission summaries, missing submissions |
| Grading | `grading.ts` | Grade submissions, bulk grade, grade with rubric, post/hide grades |
| Rubrics | `rubrics.ts` | CRUD rubrics, associate/remove from assignments, view assessments |
| Modules | `modules.ts` | CRUD modules and module items, publish modules |
| Pages | `pages.ts` | CRUD pages, front page, page revisions |
| Discussions | `discussions.ts` | CRUD discussions, download entries |
| Quizzes | `quizzes.ts` | Classic Quizzes — CRUD, update dates, quiz reports |
| New Quizzes | `new-quizzes.ts` | New Quizzes — CRUD, quiz items, accommodations |
| Calendar | `calendar.ts` | CRUD calendar events |
| Files | `files.ts` | List/get/update/delete files, folders, quota |
| Enrollments | `enrollments.ts` | List students, user profiles, student enrollments |
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

## Privacy — student name anonymization

By default, Canvas-Agent swaps student names, emails, and login IDs for opaque tokens (`Student_<6 hex>`) before Canvas responses reach Claude, so PII never enters the model context. The mapping lives only on the teacher's machine at `~/.canvas-agent/vault/<canvas-host>/<course_id>.json` (chmod 600).

On the write path — comments, announcements, messages, page/assignment/discussion bodies — tokens are rehydrated to real names before hitting Canvas, so comments and emails still go out correctly addressed.

To look up the real student behind a token:

```bash
canvas-agent reveal Student_a4f2c1              # scan all courses
canvas-agent reveal Student_a4f2c1 --course 42  # single course
```

Opt out by setting `CANVAS_AGENT_ANONYMIZE=0` in your environment before launching the server.

**Known v1 gaps:**

- Free-text fields (discussion post bodies, submission prose, uploaded-file contents, arbitrary HTML in pages) are not scanned. If a student name appears inside a discussion post, it passes through unchanged.
- `search_term` queries hit Canvas's real-name index. If Claude sends a token, Canvas finds nothing — reveal offline and search by `user_id` instead.
- `download_discussion_entries` writes entry bodies to disk verbatim. Those files stay on your local machine, but still contain the real names.
- Account-level endpoints (`/accounts/*`, `/conversations` lists) are not tokenized — they don't carry student PII in v1.

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
