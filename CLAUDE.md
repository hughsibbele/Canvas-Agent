# Canvas Agent

## Project Overview

Canvas Agent is an MCP (Model Context Protocol) server that connects Claude AI to Instructure Canvas LMS. It allows teachers and administrators to manage their Canvas courses through natural language — creating assignments, grading submissions, organizing modules, and more — just by asking Claude.

The target audience is **non-technical educators**. Many users will be setting up Claude for the first time. The project prioritizes ease of setup and clear, jargon-free communication.

### Architecture

- **MCP server** (`src/index.ts`) — Registers 18 tool modules with the MCP SDK, communicates via stdio transport
- **Canvas API client** (`src/canvas-client.ts`) — Thin wrapper with automatic pagination, rate-limit backoff, and bearer token auth. Reads `CANVAS_API_URL` and `CANVAS_API_TOKEN` from environment variables. Routes every response through the privacy pipeline (anonymizer → name detector → sandbox) before returning.
- **Tool modules** (`src/tools/*.ts`) — One file per Canvas domain (assignments, grading, modules, etc.). Each exports a `register*Tools(server)` function.
- **Privacy pipeline** — Three stages, all hooked off the chokepoint in `canvas-client.ts`:
  - `src/anonymizer.ts` — token-swaps user-shaped objects (`name`, `email`, `sortable_name`, `login_id`, sibling `grader_*`/`assessor_*`/`editor_*` pairs, nested `user`/`graded_by`/`edited_by`/`assessor`).
  - `src/name-detector.ts` — replaces known student names inside free-text fields with their tokens; uses Unicode-aware word boundaries.
  - `src/sandbox.ts` — wraps free-text fields with per-process nonce delimiters so a downstream LLM treats student-authored content as data, not instructions.
  - `src/vault.ts` — per-course token store at `~/.canvas-agent/vault/<host>/<course_id>.json` (chmod 600). Tracks role (`student`/`teacher`/`unknown`) merged monotonically (`teacher > student > unknown`). Known teachers skip tokenization. `extractUserId(user)` is the canonical "which user does this row reference?" helper — prefers `user_id` over `id` to handle Canvas's pattern of `{ id: <entry_id>, user_id: <real_user_id> }` correctly.
- **CLI entry point** (`src/cli.ts`) — Dispatcher: `npx canvas-agent` starts the MCP server; `setup` runs the setup wizard; `reveal <token>` decodes tokens; `vault-gc` prunes orphan vault rows (default dry-run, `--apply` to write).
- **Setup wizard** (`src/setup.ts`) — Interactive CLI that guides users through connecting Canvas to Claude. Validates credentials, registers the MCP server via `claude mcp add` or Claude Desktop config fallback.
- **Landing site** (`docs/`) — Static GitHub Pages site with setup guide, feature overview, and FAQ.

### Key URLs

- **npm**: https://www.npmjs.com/package/canvas-agent
- **GitHub**: https://github.com/hughsibbele/Canvas-Agent
- **Landing site**: https://hughsibbele.github.io/Canvas-Agent/
- **Canvas API docs**: https://canvas.instructure.com/doc/api/

### Development

```bash
npm install
cp .env.example .env   # add Canvas URL and API token
npm run build
node dist/cli.js       # start MCP server
node dist/cli.js setup # run setup wizard
```

### Publishing changes

After making tool changes (especially new tools or schema updates), the npm package must be republished or users running `npx canvas-agent` won't see the updates. **Remind Hugh to publish** after any session that modifies `src/tools/*.ts`:

```bash
npm version patch   # or minor/major as appropriate
npm run build
npm publish
```

Then clear the local npx cache so Claude Code picks up the new version:
```bash
rm -rf ~/.npm/_npx && /mcp to reconnect
```

## Canvas API gotchas

A few things worth knowing when adding or updating tools:

- **Grading periods scope grades and submissions to a single semester/term.** Pass `grading_period_id` to `/courses/{id}/enrollments` (returns per-period `current_score`/`current_grade` instead of lifetime) and to `/courses/{id}/students/submissions` (returns only submissions whose assignments are in that period). Without it, you get cumulative data — which is wrong for any year-long course where the second semester resets the gradebook. The `list_grading_periods` tool surfaces the available period ids.
- **The `/courses/{id}/grading_periods` endpoint returns a wrapped response** — `{"grading_periods": [...], "meta": {...}}` — so `canvasAll` won't flatten it correctly. Use `canvas` and unwrap manually (see `list_grading_periods` in `tools/courses.ts` for the pattern).
- **The Canvas analytics endpoints (`get_student_summaries`, `get_course_assignment_analytics`, `get_student_assignment_data`) do NOT support `grading_period_id`** — they always return lifetime totals. If you need semester-scoped tardiness or per-assignment data, fetch submissions directly with `grading_period_id` instead of relying on analytics.
- **Canvas convention: `id` is a row's own primary key; `<thing>_id` is a foreign key.** A discussion entry / submission / submission_comment has shape `{ id: <entry_id>, user_id: <real_user_id>, user_name: "..." }`. When you need the user this row *references*, always use `user_id` — never `id`. The `extractUserId(user)` helper in `vault.ts` enforces this. Getting it wrong mints phantom vault rows keyed by entry id.

## TODO

### Must-do
- Record a setup walkthrough video (2-3 min Loom) showing the full process from creating a Claude account to "List my Canvas courses." Link it from the landing site.
- Build Claude Code skills — guided workflows like `/build-course`, `/grade`, etc. These go in a `skills/` directory or `~/.claude/skills/`.
- Test the full setup flow on a clean machine or with a non-technical colleague to find friction points.

### Should-do
- Add a LICENSE file (package.json says MIT but no LICENSE file exists)
- Review `course-build-transcript.md` — it's in the public repo and may contain school-specific details
- Add the walkthrough video and/or screenshots to the landing site
- Write a troubleshooting section for common issues (expired tokens, wrong Canvas URL, school firewalls)

### Nice-to-have
- Add a version-check or `npx canvas-agent update` command so users know when there's a new release
- Consider a custom domain (e.g., canvasagent.com) instead of hughsibbele.github.io/Canvas-Agent
