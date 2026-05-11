# Canvas-Agent v2 — Three-MCP Split

## Context

`canvas-agent` v1 ships 133 tools as a single MCP server. That's a large surface — for comparison, the official GitHub MCP exposes ~30 tools and Slack's exposes ~10. Measured against the live v1 server (`measure-tools.mjs` in repo root), the registered-tool surface is roughly **~30K tokens** at ~220 tokens/tool average. That costs:

- **Working space.** ~15% of a 200K context window before the user types anything.
- **Tool selection accuracy.** Past ~30–50 tools, models pick wrong tools more often, especially among closely-named variants (`get_enrollment` / `list_enrollments` / `update_enrollment` / ...).
- **Time-to-first-token on cache misses.** Bigger system prompt = slower cold start.

v2 splits the surface into three MCPs by intent, not by Canvas resource shape:

- **`canvas-agent`** (core) — 79 tools, ~19K tokens. The daily teaching/grading workbench.
- **`canvas-agent-admin`** — 18 tools, ~4.3K tokens. Course/section/enrollment lifecycle. Loaded for setup episodes.
- **`canvas-agent-extras`** — 36 tools, ~6.4K tokens. Outcomes, groups, pages, files, classic quizzes, late policy, messaging, announcements. Loaded for specific projects.

Core's context tax drops ~36% (~30K → ~19K). Admin and Extras get loaded only when the user is doing that kind of work. (Token figures via `chars / 3.5` heuristic against the actual MCP `tools/list` response; ±15% vs Anthropic's tokenizer but accurate to one significant figure.)

One outlier worth knowing about: `create_quiz_item` alone is ~1,600 tokens (its inputSchema enumerates every New Quiz item type). It stays in core but is the single biggest tool by a wide margin — flagged here so future shrink work has an obvious target.

## Final tool inventory

| MCP | Tools | Files affected |
|---|---|---|
| canvas-agent (core) | 79 | 13 of 18 source files |
| canvas-agent-admin | 18 | 2 source files (partial) |
| canvas-agent-extras | 36 | 9 source files (5 whole, 4 partial) |

### Per-file routing

Files that move wholesale into one MCP:

| File | Tools | Destination |
|---|---|---|
| assignments.ts | 6 | core |
| calendar.ts | 4 | core |
| discussions.ts | 5 | core |
| modules.ts | 8 | core |
| rubrics.ts | 13 | core |
| submissions.ts | 3 | core |
| new-quizzes.ts | 10 (+1 from quizzes.ts) | core |
| outcomes.ts | 5 | extras |
| groups.ts | 7 | extras |
| pages.ts | 7 | extras |
| files.ts | 7 | extras |
| quizzes.ts | 3 (after `list_new_quizzes` relocates out) | extras |

Files that split across MCPs:

| File | Core | Admin | Extras |
|---|---|---|---|
| courses.ts | `list_courses`, `list_terms`, `list_assignment_groups`, `list_modules`, `list_grading_periods` (5) | `list_term_courses`, `create_course`, `update_course_settings`, `conclude_course`, `delete_course` ⚠️, `reset_course_content` ⚠️, `copy_course_content`, `list_course_tabs`, `update_course_navigation` (9) | — |
| enrollments.ts | `list_students`, `list_sections`, `get_student_enrollments`, `list_users_in_course`, `get_user_profile` (5) | `crosslist_section`, `decrosslist_section`, `create_section`, `update_section`, `delete_section` ⚠️, `enroll_user`, `update_enrollment_state`, `delete_enrollment` ⚠️, `move_student_to_section` (9) | — |
| communication.ts | `post_submission_comment` (1) | — | `send_message`, `create_announcement` (2) |
| grading.ts | `grade_submission`, `bulk_grade`, `submission_summary`, `list_missing_submissions`, `list_gradeable_students`, `post_grades`, `hide_grades` (7) | — | `get_late_policy`, `set_late_policy`, `get_grading_standards` (3) |
| analytics.ts | `get_course_activity`, `get_course_assignment_analytics`, `get_student_summaries`, `get_student_activity`, `get_student_assignment_data` (5) | — | `get_student_messaging_data` (1) |
| scheduling.ts | `update_assignment_dates`, `batch_update_dates`, `create_assignment_override`, `list_assignment_overrides`, `update_assignment_override`, `get_course_schedule_overview` (6) | — | `update_quiz_dates` (1) |

### Routing rationale (the four explicit calls)

- **`post_submission_comment` stays in core** even though it lives in `communication.ts`. It's a feedback comment on a graded submission, not standalone messaging — used in the same conversation as `grade_submission`.
- **`list_terms` stays in core.** Lightweight account-level read; teachers want to know what term a course is in. `list_term_courses` (admin-only API for listing every course in a term) goes to admin.
- **Classic Quizzes go to extras, New Quizzes stay in core.** Classic Quizzes is Canvas's deprecated product. If a quiz ever appears in workflow, it'll be a New Quiz.
- **`list_new_quizzes` relocates from `quizzes.ts` to `new-quizzes.ts`** as part of the refactor, so `quizzes.ts` can move wholesale to extras and the New Quiz surface is contained in one file.

## Packaging — single npm package, three bins

```
canvas-agent/                    ← single npm package, name unchanged
  src/
    shared/                      ← unchanged: canvas-client, vault, anonymizer, name-detector,
                                   prompt-injection sandbox, reveal CLI, etc.
    tools/
      analytics.ts               ← exports registerAnalyticsCore + registerAnalyticsExtras
      assignments.ts             ← exports registerAssignmentsCore (single, all-core)
      calendar.ts                ← single, all-core
      communication.ts           ← exports registerCommunicationCore + registerCommunicationExtras
      courses.ts                 ← exports registerCoursesCore + registerCoursesAdmin
      discussions.ts             ← single, all-core
      enrollments.ts             ← exports registerEnrollmentsCore + registerEnrollmentsAdmin
      files.ts                   ← single, all-extras
      grading.ts                 ← exports registerGradingCore + registerGradingExtras
      groups.ts                  ← single, all-extras
      modules.ts                 ← single, all-core
      new-quizzes.ts             ← single, all-core (gains list_new_quizzes)
      outcomes.ts                ← single, all-extras
      pages.ts                   ← single, all-extras
      quizzes.ts                 ← single, all-extras (loses list_new_quizzes)
      rubrics.ts                 ← single, all-core
      scheduling.ts              ← exports registerSchedulingCore + registerSchedulingExtras
      submissions.ts             ← single, all-core
    servers/
      core.ts                    ← imports core registrars, starts MCP server
      admin.ts                   ← imports admin registrars
      extras.ts                  ← imports extras registrars
    cli.ts                       ← becomes the canvas-agent bin's dispatcher:
                                   handles `setup`, `reveal`, `vault-gc` subcommands;
                                   delegates the no-subcommand path to servers/core.ts
  package.json:
    "bin": {
      "canvas-agent":         "dist/cli.js",            // dispatches setup/reveal/vault-gc,
                                                        // falls through to servers/core.ts
      "canvas-agent-admin":   "dist/servers/admin.js",
      "canvas-agent-extras":  "dist/servers/extras.js"
    }
```

### Why one package and not three

The vault at `~/.canvas-agent/vault/<host>/<course_id>.json` is shared, stateful, and security-sensitive (chmod 600, HMAC-keyed `Student_<hex>` tokens). Three separate npm packages each importing a `@canvas-agent/core` dependency would risk version skew where the admin MCP's anonymizer reads the vault differently from the core MCP's. Single package, single import graph, single source of truth.

### Why `cli.ts` keeps the dual role

After Phase 3, `cli.ts` carries two responsibilities: the utility-subcommand dispatcher (`setup` / `reveal` / `vault-gc`) and the no-subcommand fall-through that starts the core MCP server. The cleaner separation would be `canvas-agent` = CLI only, `canvas-agent-server` = core MCP. **Don't do it.** Every existing user has `{"command": "npx", "args": ["-y", "canvas-agent"]}` in their MCP config — the `npx canvas-agent` UX is load-bearing. The dual role in one bin is the price of preserving it.

User mounts only the bins they want:

```json
{
  "mcpServers": {
    "canvas":         { "command": "npx", "args": ["-y", "canvas-agent"] },
    "canvas-admin":   { "command": "npx", "args": ["-y", "canvas-agent-admin"] },
    "canvas-extras":  { "command": "npx", "args": ["-y", "canvas-agent-extras"] }
  }
}
```

## Refactor phases

Each phase ships as its own npm version so it can be dogfooded and reverted independently. Every phase is gated by `measure-tools.mjs` (extended into a CI-style assertion harness — see Phase 1).

### Phase 1 — non-breaking restructure → publish as `1.7.0`

Goal: split each `register*Tools(server)` into the per-MCP variants without changing user-visible behavior.

1. For each mixed file (`courses.ts`, `enrollments.ts`, `communication.ts`, `grading.ts`, `analytics.ts`, `scheduling.ts`), extract two registration functions per the routing table.
2. Relocate `list_new_quizzes` from `quizzes.ts` to `new-quizzes.ts`.
3. Update the existing `index.ts` entry point to call all three sets so v1 behavior is preserved.
4. Promote `measure-tools.mjs` into a real assertion harness (`scripts/assert-tool-routing.mjs`) that boots the all-bin and asserts: total tool count = 133 and every tool name appears in exactly one of the core/admin/extras buckets per the routing table. Wire it as `npm test`.
5. Publish as `1.7.0`. Use it personally for a few days.

**Exit criterion:** assertion script passes; the v1 bin still exposes all 133 tools; routing tables in this doc are now executable, not narrative.

### Phase 2 — three entry points (still additive) → publish as `1.8.0`

1. Create `src/servers/core.ts`, `src/servers/admin.ts`, `src/servers/extras.ts`. Each imports only the registrars matching its bucket.
2. Add the two new bins (`canvas-agent-admin`, `canvas-agent-extras`) to `package.json`. The legacy `canvas-agent` bin still points at `cli.ts` and still loads everything.
3. Extend `scripts/assert-tool-routing.mjs` to additionally boot each of the three new servers and assert: core = 79 tools, admin = 18, extras = 36, and no tool name collides across servers.
4. Publish as `1.8.0`. Optionally mount `canvas-agent-admin` and `canvas-agent-extras` in your own MCP config to dogfood the split surface.

**Exit criterion:** all four bins work; assertion script passes for all four; `cli.ts` (v1 behavior) and `servers/core.ts` (v2 behavior) coexist.

### Phase 3 — flip the default → publish as `2.0.0`

1. Refactor `cli.ts` so the no-subcommand path delegates to `servers/core.ts` instead of registering all 133 tools. The `setup`, `reveal <token>`, and `vault-gc` subcommands stay on the `canvas-agent` bin unchanged — they're shared utilities, not server-mode commands. After this step, `npx canvas-agent` starts the 79-tool core server; `npx canvas-agent setup` still runs the wizard; `npx canvas-agent reveal <token>` still decodes; `npx canvas-agent vault-gc` still prunes.
2. Add a `describe_canvas_mcps` tool to core (only). Static text response: explains the three-MCP architecture, names the other two bins, and tells the model what kind of work each one is for. Costs ~200 tokens of core surface; pays for itself the first time a user asks "do you have a tool to enroll users?" and Claude can answer "that lives in `canvas-agent-admin` — install with `npx canvas-agent-admin`."
3. Update README + CLAUDE.md to document the three-MCP architecture. Add an explicit **migration table** to the README/changelog: every tool that left core, sorted alphabetically, with the new bin to install. Don't make upgrading users cross-reference the inventory tables in this doc.
4. Update the setup wizard to register all three bins by default. New users get the architecture without thinking about it; the savings come from existing users who deliberately drop admin/extras after they realize they don't need them.
5. Bump to `2.0.0`. Tag, publish. Message the handful of known users with the migration note.

**Exit criterion:** `npm install canvas-agent@2` gets the 79-tool core MCP plus the existing utility subcommands on the same bin; admin and extras are explicit opt-ins via their own bins; assertion script passes; setup wizard installs all three for new users.

## Migration & semver

This is a **breaking change** for any user who relies on a tool that v2 routes out of core. Bump to `2.0.0`. Phases 1 and 2 are non-breaking and ship as `1.7.0` / `1.8.0` respectively, so the actual default-flip is the only release that requires user action.

Migration guide for existing users (lives in the README, not just here):

1. Upgrade: `npm install canvas-agent@latest` (or `npx -y canvas-agent@latest` for ephemeral runs).
2. If you use any tool from the admin or extras list, add the corresponding MCP server to your config (see Packaging section above).
3. The vault, anonymizer, and reveal CLI are unchanged — no data migration.

The README **must** carry an explicit alphabetical "tool → bin" lookup table (added in Phase 3 step 3) so a user looking up `enroll_user` doesn't need to read this build plan. The inventory tables in this doc are organized by source file, which is the wrong shape for migration lookup.

## Open questions

- **Rubric authoring move (future work).** `rubrics.ts` (13 tools) is the next-largest cluster after the v2 split. If the Super Grader workflow tool builds rubric authoring inside Canvas-Agent, this stays in core. If rubrics live in markdown/spreadsheet world, the create/associate/update tools (~6 tools) become extras candidates. Defer until Super Grader's design lands.
- **Shrinking `create_quiz_item`.** It's ~1,600 tokens — by far the heaviest tool, accounting for ~5% of v1's surface and ~8% of v2 core. Most of the bulk is in the `inputSchema` enumerating every New Quiz item type (multiple_choice, multiple_answers, true_false, matching, ordering, file_upload, essay, hot_spot, categorization, etc.) with per-type fields. Could be split into per-type tools (more tools, each smaller) or trimmed via a more compact schema. Out of scope for v2; flagged for a future pass.
- **Tool-name collisions across MCPs?** Currently none: every tool name is unique across all 133. The Phase 2 assertion script enforces this going forward. If a future tool adds (say) `delete_assignment_admin`, the suffix convention should match the MCP it ships in.

### Resolved (was open in earlier draft)

- ~~Keep a `canvas-agent-all` bin?~~ **No.** With a small known user base, manual outreach + a clear migration table covers it; an `-all` bin would undermine the "load only what you need" pitch and add maintenance.
- ~~Help text for the three-MCP picture?~~ **Yes — `describe_canvas_mcps` ships in core in Phase 3** (now in scope; see Phase 3 step 2).

## Out of scope

- Renaming or refactoring the shared infrastructure (canvas-client, vault, anonymizer). The v2 split is purely a registration-time partition.
- Changing tool signatures, descriptions, or behavior. Same surface, different containers.
- New tools.
- The setup wizard's auto-detection of AI clients (Gemini CLI, Claude Desktop, Claude Code). Wizard logic stays the same; it just registers the v2 `canvas-agent` bin as before, and users add the admin/extras bins by hand if they want them.
