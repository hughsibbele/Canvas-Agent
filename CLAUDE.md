# Canvas Agent

## Project Overview

Canvas Agent is an MCP (Model Context Protocol) server that connects Claude AI to Instructure Canvas LMS. It allows teachers and administrators to manage their Canvas courses through natural language — creating assignments, grading submissions, organizing modules, and more — just by asking Claude.

The target audience is **non-technical educators**. Many users will be setting up Claude for the first time. The project prioritizes ease of setup and clear, jargon-free communication.

### Architecture

As of v2, Canvas Agent ships **three MCP servers from one npm package**, split by intent:
- `canvas-agent` (core, 80 tools) — daily teaching/grading workbench. The default bin.
- `canvas-agent-admin` (18 tools) — course/section/enrollment lifecycle. Mounted for setup work.
- `canvas-agent-extras` (36 tools) — outcomes, groups, pages, files, classic quizzes, late policy, messaging, announcements.

The split is registration-time only — all three share the same import graph, vault, anonymizer, etc. Routing rationale and inventory live in `V2_BUILD_PLAN.md`.

- **Server entry points** (`src/servers/{core,admin,extras}.ts`) — Each imports only the registrars matching its bucket and starts an MCP stdio server. `cli.ts` no-subcommand path delegates to `servers/core.ts`.
- **CLI dispatcher** (`src/cli.ts`) — `npx canvas-agent` starts the core server; `setup`/`reveal`/`vault-gc` subcommands stay on the same bin (shared utilities, not server-mode commands). The `canvas-agent-admin` and `canvas-agent-extras` bins point directly at their server files. **Don't try to "clean up" cli.ts's dual role** — preserving the `npx canvas-agent` UX is load-bearing.
- **Canvas API client** (`src/canvas-client.ts`) — Thin wrapper with automatic pagination, rate-limit backoff, and bearer token auth. Reads `CANVAS_API_URL` and `CANVAS_API_TOKEN` from environment variables. Routes every response through the privacy pipeline (anonymizer → name detector → sandbox) before returning. Two paginators: `canvasAll(path, params)` for endpoints that return a flat JSON array, and `canvasAllWrapped(path, arrayKey, params)` for endpoints that wrap their array under a key (`{outcome_results: [...], linked: {…}}`, `{rollups: [...], meta: {…}}`) — concatenates the array across pages and merges sibling metadata deduped by id.
- **Tool modules** (`src/tools/*.ts`) — One file per Canvas domain. Mixed-bucket files export per-bucket registrars (e.g. `registerCoursesCore` + `registerCoursesAdmin`); single-bucket files export one (e.g. `registerAssignmentsCore`, `registerOutcomesExtras`). The meta tool `describe_canvas_mcps` lives in `src/tools/meta.ts` and is core-only — it's how the AI discovers admin/extras when a user asks for a tool that isn't loaded.
- **Privacy pipeline** — Three stages, all hooked off the chokepoint in `canvas-client.ts`:
  - `src/anonymizer.ts` — token-swaps user-shaped objects (`name`, `email`, `sortable_name`, `login_id`, sibling `grader_*`/`assessor_*`/`editor_*` pairs, nested `user`/`graded_by`/`edited_by`/`assessor`).
  - `src/name-detector.ts` — replaces known student names inside free-text fields with their tokens; uses Unicode-aware word boundaries.
  - `src/sandbox.ts` — wraps free-text fields with per-process nonce delimiters so a downstream LLM treats student-authored content as data, not instructions.
  - `src/vault.ts` — per-course token store at `~/.canvas-agent/vault/<host>/<course_id>.json` (chmod 600). Tracks role (`student`/`teacher`/`unknown`) merged monotonically (`teacher > student > unknown`). Known teachers skip tokenization. `extractUserId(user)` is the canonical "which user does this row reference?" helper — prefers `user_id` over `id` to handle Canvas's pattern of `{ id: <entry_id>, user_id: <real_user_id> }` correctly.
- **Setup wizard** (`src/setup.ts`) — Interactive CLI that guides users through connecting Canvas to Claude. Validates credentials, registers all three v2 bins (`canvas-agent`, `canvas-agent-admin`, `canvas-agent-extras`) into Claude Code / Claude Desktop / Antigravity CLI. The `BINS` constant + `mcpServerEntry()` helper at the top of the file are the seam — adding/removing bins is one place.
- **Tool-routing assertion harness** (`scripts/assert-tool-routing.mjs`) — Boots all three split servers via the MCP SDK and asserts each exposes exactly its bucket (80 / 18 / 36) with no cross-server name collisions; also verifies the `canvas-agent` bin equals the core server. Run via `npm test`. The ADMIN/EXTRAS lists in this script are the executable contract for routing — keep in sync with V2_BUILD_PLAN.md.
- **Landing site** (`docs/`) — Static GitHub Pages site with setup guide, feature overview, and FAQ.

### Key URLs

- **npm**: https://www.npmjs.com/package/canvas-agent
- **GitHub**: https://github.com/hughsibbele/Canvas-Agent
- **Landing site**: https://hughsibbele.github.io/Canvas-Agent/
- **Canvas API docs**: https://canvas.instructure.com/doc/api/

### Development

```bash
npm install
cp .env.example .env             # add Canvas URL and API token
npm run build
node dist/cli.js                 # start the core MCP server (canvas-agent bin)
node dist/servers/admin.js       # start admin server directly
node dist/servers/extras.js      # start extras server directly
node dist/cli.js setup           # run setup wizard
npm test                         # boot all three servers, assert routing
```

`npm test` is the gate for any tool change — it boots all three split servers and asserts each exposes exactly its bucket. If you move a tool between buckets, update the routing manifest in `scripts/assert-tool-routing.mjs`.

### Publishing changes

After making tool changes (especially new tools or schema updates), the npm package must be republished or users running `npx canvas-agent` won't see the updates. **Remind Hugh to publish** after any session that modifies `src/tools/*.ts`:

```bash
npm version patch   # or minor/major as appropriate
npm run build
npm publish
```

Then get the local machine onto the new version. **`npx` prefers a `canvas-agent` binary already on `PATH` over fetching from the registry**, so if the package is installed globally, publishing and clearing the npx cache do nothing — the MCP servers keep running the old global copy, with no visible cause. Check for a global install first:

```bash
which -a canvas-agent          # a hit means npx is resolving to it, not the registry
npm ls -g --depth=0 canvas-agent
```

If there is one, upgrading it is the whole job:
```bash
npm install -g canvas-agent@latest
```

If there is *no* global install, npx resolves from the registry and its cache needs clearing instead:
```bash
rm -rf ~/.npm/_npx
```

Either way, finish by asking Hugh to run `/mcp` to reconnect — the running server processes hold the old code until then, and Claude can't trigger the reconnect itself.

To confirm which version is actually being served, don't trust the registry — inspect the copy that resolves:
```bash
node -p "require('$(npm root -g)/canvas-agent/package.json').version"
```
On Hugh's Mac that path is `/opt/homebrew/lib/node_modules/canvas-agent`; the global install is the one that matters there.

## Canvas API gotchas

A few things worth knowing when adding or updating tools:

- **Grading periods scope grades and submissions to a single semester/term.** Pass `grading_period_id` to `/courses/{id}/enrollments` (returns per-period `current_score`/`current_grade` instead of lifetime) and to `/courses/{id}/students/submissions` (returns only submissions whose assignments are in that period). Without it, you get cumulative data — which is wrong for any year-long course where the second semester resets the gradebook. The `list_grading_periods` tool surfaces the available period ids.
- **Wrapped responses** — Some endpoints return `{key: [...], linked: {...}, meta: {...}}` instead of a flat array. `canvasAll` won't paginate them correctly. Two patterns: for single-page lookups use `canvas()` and unwrap manually (see `list_grading_periods` in `tools/courses.ts`); for paginated wrapped responses use `canvasAllWrapped(path, arrayKey, params)` (see `list_outcome_results` and `get_outcome_rollups` in `tools/outcomes.ts`).
- **The Canvas analytics endpoints (`get_student_summaries`, `get_course_assignment_analytics`, `get_student_assignment_data`) do NOT support `grading_period_id`** — they always return lifetime totals. If you need semester-scoped tardiness or per-assignment data, fetch submissions directly with `grading_period_id` instead of relying on analytics.
- **Canvas convention: `id` is a row's own primary key; `<thing>_id` is a foreign key.** A discussion entry / submission / submission_comment has shape `{ id: <entry_id>, user_id: <real_user_id>, user_name: "..." }`. When you need the user this row *references*, always use `user_id` — never `id`. The `extractUserId(user)` helper in `vault.ts` enforces this. Getting it wrong mints phantom vault rows keyed by entry id.
- **Read-then-write must strip sandbox markers.** Free-text fields (`description`, `body`, `message`, `comment`, etc.) come back wrapped with `<untrusted-canvas-content-NONCE>...</untrusted-canvas-content-NONCE>` from the privacy pipeline. If a tool fetches one of those fields and writes it back to Canvas (e.g. `update_rubric` re-sending fetched criteria, `copy_rubric` cloning a source), it must call `unsandboxText` from `sandbox.ts` first — otherwise Canvas stores the literal marker text and every subsequent read wraps it again, double-wrapping until the Canvas UI shows the markers as raw content. See the `cleanDescription` helper in `tools/rubrics.ts` for the pattern (`unsandboxText(value).trim()`).
- **Canvas's PUT replaces fields wholesale on rubrics.** Omitting `rubric[title]` resets the title to a Canvas default; omitting `rubric[criteria]` wipes them. Partial-update tools must always fetch the current state and default any unspecified fields from it (see `update_rubric`).
- **Rubrics fork on update once they're in use.** When a rubric has graded assessments or other "in use" markers, Canvas marks it `read_only: true`. A subsequent PUT doesn't update in place — it creates a new rubric with a fresh ID. The new ID appears in `list_rubrics` but `get_rubric` 404s on it (and so does `delete_rubric`'s safety-check fetch). Phantoms are harmless cruft; the user can clear them via the Canvas UI. Don't spend cycles trying to manage them.
- **An assignment's base due date is not independently settable once it has overrides.** Canvas pins `due_at` to `max(override due dates)` and recomputes it on every write. The first `create_assignment_override` leaves the base alone; the *second* back-fills it, and the value is the latest override time — not the first one created, and not section-dependent (verified 2026-08-10 on a Monday assignment where B block 9:00 is later than A block 8:15, which is the case that distinguishes the two). Neither `update_assignment_dates(due_at: "")` nor `update_assignment(due_at: "")` can clear it; both report success and Canvas reverts. Consequence: every fully-overridden assignment shows an "Everyone else" row mirroring its last section. That's cosmetic and unavoidable — don't build cleanup logic for it. Do make sure *every* section gets an override, since a section left on the base date silently inherits another section's time.
- **`batch_update_dates` creates missing section overrides; `create_assignment_override` is the one-at-a-time path.** The bulk tool used to only edit overrides that already existed, and calling it with `section_dates` on an assignment with none produced a bare `PUT {assignment: {}}` → Canvas `400 "assignment is missing"`, which reads as an override problem but is really an empty payload. It now creates absent overrides and skips no-op entries with an explanatory message. Keep that behavior: per-section scheduling across a course is otherwise 2 calls × N assignments.
- **`skip_updating_points_possible` doesn't work.** Canvas documents this PUT parameter for `/courses/:id/rubrics/:id` but live testing showed both placements broken: nested under `rubric[]` is silently ignored and the total still updates; at the body root Canvas returns 500 when criteria are also being updated. Removed from the tool surface; revisit if Canvas fixes the API.

## TODO

### Must-do
- Record a setup walkthrough video (2-3 min Loom) showing the full process from creating a Claude account to "List my Canvas courses." Link it from the landing site.
- Build Claude Code skills — guided workflows like `/build-course`, `/grade`, etc. These go in a `skills/` directory or `~/.claude/skills/`.
- Test the full setup flow on a clean machine or with a non-technical colleague to find friction points.

### Should-do
- Review `course-build-transcript.md` — it's in the public repo and may contain school-specific details
- Add the walkthrough video and/or screenshots to the landing site
- Write a troubleshooting section for common issues (expired tokens, wrong Canvas URL, school firewalls)

### Nice-to-have
- Add a version-check or `npx canvas-agent update` command so users know when there's a new release
- Consider a custom domain (e.g., canvasagent.com) instead of hughsibbele.github.io/Canvas-Agent
