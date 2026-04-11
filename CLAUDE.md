# Canvas Agent

## Project Overview

Canvas Agent is an MCP (Model Context Protocol) server that connects Claude AI to Instructure Canvas LMS. It allows teachers and administrators to manage their Canvas courses through natural language — creating assignments, grading submissions, organizing modules, and more — just by asking Claude.

The target audience is **non-technical educators**. Many users will be setting up Claude for the first time. The project prioritizes ease of setup and clear, jargon-free communication.

### Architecture

- **MCP server** (`src/index.ts`) — Registers 15 tool modules with the MCP SDK, communicates via stdio transport
- **Canvas API client** (`src/canvas-client.ts`) — Thin wrapper with automatic pagination, rate-limit backoff, and bearer token auth. Reads `CANVAS_API_URL` and `CANVAS_API_TOKEN` from environment variables.
- **Tool modules** (`src/tools/*.ts`) — One file per Canvas domain (assignments, grading, modules, etc.). Each exports a `register*Tools(server)` function.
- **CLI entry point** (`src/cli.ts`) — Dispatcher: `npx canvas-agent` starts the MCP server; `npx canvas-agent setup` runs the setup wizard.
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

## Canvas API gotchas

A few things worth knowing when adding or updating tools:

- **Grading periods scope grades and submissions to a single semester/term.** Pass `grading_period_id` to `/courses/{id}/enrollments` (returns per-period `current_score`/`current_grade` instead of lifetime) and to `/courses/{id}/students/submissions` (returns only submissions whose assignments are in that period). Without it, you get cumulative data — which is wrong for any year-long course where the second semester resets the gradebook. The `list_grading_periods` tool surfaces the available period ids.
- **The `/courses/{id}/grading_periods` endpoint returns a wrapped response** — `{"grading_periods": [...], "meta": {...}}` — so `canvasAll` won't flatten it correctly. Use `canvas` and unwrap manually (see `list_grading_periods` in `tools/courses.ts` for the pattern).
- **The Canvas analytics endpoints (`get_student_summaries`, `get_course_assignment_analytics`, `get_student_assignment_data`) do NOT support `grading_period_id`** — they always return lifetime totals. If you need semester-scoped tardiness or per-assignment data, fetch submissions directly with `grading_period_id` instead of relying on analytics.

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
