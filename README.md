# Canvas Agent

MCP server that connects AI assistants — Google's Gemini CLI, Claude Code, and Claude Desktop — to [Instructure Canvas LMS](https://www.instructure.com/canvas). Teachers and administrators can manage courses, assignments, grades, and more through natural language.

> **Looking to install Canvas Agent?** Follow the setup guide at **[hughsibbele.github.io/Canvas-Agent](https://hughsibbele.github.io/Canvas-Agent)** — no technical background required.

---

## Architecture

Canvas Agent ships as **three [MCP](https://modelcontextprotocol.io/) servers from one npm package**, split by intent. The setup wizard registers all three by default; users who want to save context can drop admin or extras from their MCP config.

```
AI client (Claude Code / Claude Desktop / Gemini CLI)
  ├─ spawns canvas-agent          (core, 80 tools — daily teaching/grading)
  ├─ spawns canvas-agent-admin    (18 tools — course/section/enrollment lifecycle)
  └─ spawns canvas-agent-extras   (36 tools — outcomes, groups, pages, files, messaging, …)
        └─ MCP stdio transport
             └─ Canvas REST API (bearer token auth)
```

The three bins share a single import graph and a single per-course vault, so anonymization tokens stay consistent across servers. Core also includes a `describe_canvas_mcps` tool so the AI can tell the user which other bin to mount when a needed tool isn't loaded.

| Component | Path | Role |
|---|---|---|
| Core MCP entry point | `src/servers/core.ts` | The 79 daily teaching/grading tools + the `describe_canvas_mcps` meta tool |
| Admin MCP entry point | `src/servers/admin.ts` | The 18 course/section/enrollment lifecycle tools |
| Extras MCP entry point | `src/servers/extras.ts` | The 36 outcomes/groups/pages/files/messaging/late-policy/classic-quizzes tools |
| CLI dispatcher | `src/cli.ts` | `npx canvas-agent` starts the core server; `setup`/`reveal`/`vault-gc` subcommands stay on the same bin. The two extra bins (`canvas-agent-admin`, `canvas-agent-extras`) point directly at their server files. |
| Canvas API client | `src/canvas-client.ts` | Thin fetch wrapper with automatic pagination (`canvasAll` for flat array endpoints, `canvasAllWrapped` for `{key: [...], linked: {…}}` shapes) and rate-limit backoff. Pipes every response through anonymizer → name-detector → sandbox before returning. |
| Tool modules | `src/tools/*.ts` | One file per Canvas domain. Mixed-bucket files export per-bucket registrars (e.g. `registerCoursesCore` + `registerCoursesAdmin`); single-bucket files export one (e.g. `registerAssignmentsCore`). |
| Privacy pipeline | `src/anonymizer.ts`, `src/name-detector.ts`, `src/sandbox.ts`, `src/vault.ts` | Three-stage redaction at the MCP boundary: token-swap structured PII fields, redact student names inside free text, wrap untrusted content with prompt-injection delimiters. Per-course vault tracks role (student/teacher/unknown); teachers are exempt. Map lives in `~/.canvas-agent/vault/`. |
| Setup wizard | `src/setup.ts` | Interactive CLI that validates credentials, detects Claude Code / Desktop / Gemini CLI, and registers all three v2 bins. |
| Tool-routing assertion harness | `scripts/assert-tool-routing.mjs` | Boots all three split servers via the MCP SDK and asserts each exposes exactly its bucket (80 / 18 / 36) with no cross-server name collisions. Run via `npm test`. |
| Landing site | `docs/` | Static GitHub Pages site with the end-user setup guide |

### Tool modules

| Module | File | v2 bin(s) | Covers |
|---|---|---|---|
| Courses | `courses.ts` | core + admin | core: list courses, terms, assignment groups, modules, grading periods. admin: create/update/delete/conclude/reset/copy course, navigation tabs. |
| Assignments | `assignments.ts` | core | CRUD assignments, batch update dates |
| Submissions | `submissions.ts` | core | List/download submissions, download discussion entries |
| Grading | `grading.ts` | core + extras | core: grade/bulk-grade/post/hide, missing & gradeable students. extras: late policy, grading standards. |
| Rubrics | `rubrics.ts` | core | CRUD rubrics, copy across assignments/courses, associate with display toggles, link to outcomes, view/edit/delete assessments |
| Outcomes | `outcomes.ts` | extras | List outcomes/groups, outcome results, mastery rollups |
| Modules | `modules.ts` | core | CRUD modules and module items, publish modules |
| Pages | `pages.ts` | extras | CRUD pages, front page, page revisions |
| Discussions | `discussions.ts` | core | CRUD discussions and batch updates (download entries lives in submissions.ts) |
| Quizzes (Classic) | `quizzes.ts` | extras | List/get/update Classic Quizzes |
| New Quizzes | `new-quizzes.ts` | core | List/CRUD New Quizzes, quiz items, accommodations, generate quiz reports |
| Calendar | `calendar.ts` | core | CRUD calendar events |
| Files | `files.ts` | extras | List/get/update/delete files, folders, quota |
| Enrollments | `enrollments.ts` | core + admin | core: list students/sections/users, get profile. admin: crosslist, create/update/delete sections, enroll/drop users, move student. |
| Communication | `communication.ts` | core + extras | core: post submission comment. extras: send_message, create_announcement. |
| Groups | `groups.ts` | extras | Group sets, groups, membership, auto-distribute |
| Analytics | `analytics.ts` | core + extras | core: course/student activity, assignment analytics, student summaries. extras: messaging data. |
| Scheduling | `scheduling.ts` | core + extras | core: assignment dates, batch updates, overrides, schedule overview. extras: classic-quiz dates. |
| Meta | `meta.ts` | core | `describe_canvas_mcps` — explains the three-MCP architecture to the AI |

## Migrating from v1.x

v2 splits the v1 single-MCP surface into core / admin / extras. If your existing config has just `canvas-agent`, you'll keep working but lose access to anything that moved out of core. Add the relevant bin to your MCP config:

```json
{
  "mcpServers": {
    "canvas-agent":         { "command": "npx", "args": ["-y", "canvas-agent"] },
    "canvas-agent-admin":   { "command": "npx", "args": ["-y", "canvas-agent-admin"] },
    "canvas-agent-extras":  { "command": "npx", "args": ["-y", "canvas-agent-extras"] }
  }
}
```

The setup wizard (`npx canvas-agent setup`) registers all three by default — running it again is the simplest upgrade path.

### Tool → bin lookup (alphabetical)

If you used a tool in v1, this table tells you which v2 bin it lives in. Tools not listed here are in `canvas-agent` (core).

| Tool | v2 bin |
|---|---|
| `add_user_to_group` | `canvas-agent-extras` |
| `auto_distribute_unassigned` | `canvas-agent-extras` |
| `conclude_course` | `canvas-agent-admin` |
| `copy_course_content` | `canvas-agent-admin` |
| `create_announcement` | `canvas-agent-extras` |
| `create_course` | `canvas-agent-admin` |
| `create_folder` | `canvas-agent-extras` |
| `create_group` | `canvas-agent-extras` |
| `create_group_set` | `canvas-agent-extras` |
| `create_page` | `canvas-agent-extras` |
| `create_section` | `canvas-agent-admin` |
| `crosslist_section` | `canvas-agent-admin` |
| `decrosslist_section` | `canvas-agent-admin` |
| `delete_course` | `canvas-agent-admin` |
| `delete_enrollment` | `canvas-agent-admin` |
| `delete_file` | `canvas-agent-extras` |
| `delete_page` | `canvas-agent-extras` |
| `delete_section` | `canvas-agent-admin` |
| `enroll_user` | `canvas-agent-admin` |
| `get_file` | `canvas-agent-extras` |
| `get_file_quota` | `canvas-agent-extras` |
| `get_front_page` | `canvas-agent-extras` |
| `get_grading_standards` | `canvas-agent-extras` |
| `get_late_policy` | `canvas-agent-extras` |
| `get_outcome` | `canvas-agent-extras` |
| `get_outcome_rollups` | `canvas-agent-extras` |
| `get_page` | `canvas-agent-extras` |
| `get_quiz` | `canvas-agent-extras` |
| `get_student_messaging_data` | `canvas-agent-extras` |
| `list_course_files` | `canvas-agent-extras` |
| `list_course_tabs` | `canvas-agent-admin` |
| `list_folders` | `canvas-agent-extras` |
| `list_group_categories` | `canvas-agent-extras` |
| `list_groups` | `canvas-agent-extras` |
| `list_outcome_groups` | `canvas-agent-extras` |
| `list_outcome_results` | `canvas-agent-extras` |
| `list_outcomes` | `canvas-agent-extras` |
| `list_page_revisions` | `canvas-agent-extras` |
| `list_pages` | `canvas-agent-extras` |
| `list_quizzes` | `canvas-agent-extras` |
| `list_term_courses` | `canvas-agent-admin` |
| `move_student_to_section` | `canvas-agent-admin` |
| `remove_user_from_group` | `canvas-agent-extras` |
| `reset_course_content` | `canvas-agent-admin` |
| `send_message` | `canvas-agent-extras` |
| `set_late_policy` | `canvas-agent-extras` |
| `update_course_navigation` | `canvas-agent-admin` |
| `update_course_settings` | `canvas-agent-admin` |
| `update_enrollment_state` | `canvas-agent-admin` |
| `update_file` | `canvas-agent-extras` |
| `update_page` | `canvas-agent-extras` |
| `update_quiz` | `canvas-agent-extras` |
| `update_quiz_dates` | `canvas-agent-extras` |
| `update_section` | `canvas-agent-admin` |

The vault, anonymizer, and reveal CLI are unchanged — no data migration. You can also ask the AI "describe canvas-agent's MCPs" and it will surface the same info via the `describe_canvas_mcps` tool in core.

## Development

```bash
git clone https://github.com/hughsibbele/Canvas-Agent.git
cd Canvas-Agent
npm install
cp .env.example .env     # add your CANVAS_API_URL and CANVAS_API_TOKEN
npm run build
node dist/cli.js                 # start the core MCP server (default canvas-agent bin)
node dist/servers/admin.js       # start admin server directly
node dist/servers/extras.js      # start extras server directly
node dist/cli.js setup           # run the setup wizard
npm test                         # boot all three servers and assert routing
```

`npm run dev` starts `tsc --watch` for iterating on tool modules.

### Adding a tool

1. Decide which bucket it belongs to (core / admin / extras) — see V2_BUILD_PLAN.md for the rationale on existing tools.
2. Add the `server.tool(...)` registration to the appropriate `register*Core` / `register*Admin` / `register*Extras` function in `src/tools/<domain>.ts`. Create a new domain file + registrar if needed; export from the file and import/call in the matching `src/servers/<bucket>.ts`.
3. Update the routing manifest in `scripts/assert-tool-routing.mjs` if the tool lands in admin or extras.
4. `npm test` to verify.
5. Rebuild (`npm run build`) and restart your MCP client to pick up the new tool.

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
