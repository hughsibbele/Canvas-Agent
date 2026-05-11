# Canvas-Agent v2 — Three-MCP Split

## Context

`canvas-agent` v1 ships 133 tools as a single MCP server. That's a large surface — for comparison, the official GitHub MCP exposes ~30 tools and Slack's exposes ~10. With ~300 tokens of system-prompt overhead per tool, v1 burns roughly 40K tokens of context on every conversation that mounts it, which costs:

- **Working space.** ~20% of a 200K context window before the user types anything.
- **Tool selection accuracy.** Past ~30–50 tools, models pick wrong tools more often, especially among closely-named variants (`get_enrollment` / `list_enrollments` / `update_enrollment` / ...).
- **Time-to-first-token on cache misses.** Bigger system prompt = slower cold start.

v2 splits the surface into three MCPs by intent, not by Canvas resource shape:

- **`canvas-agent`** (core) — 79 tools. The daily teaching/grading workbench.
- **`canvas-agent-admin`** — 18 tools. Course/section/enrollment lifecycle. Loaded for setup episodes.
- **`canvas-agent-extras`** — 36 tools. Outcomes, groups, pages, files, classic quizzes, late policy, messaging, announcements. Loaded for specific projects.

Core's context tax drops ~40% (40K → ~24K). Admin and Extras get loaded only when the user is doing that kind of work.

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
    cli.ts                       ← legacy entry; v2 replaces with servers/core.ts
  package.json:
    "bin": {
      "canvas-agent":         "dist/servers/core.js",
      "canvas-agent-admin":   "dist/servers/admin.js",
      "canvas-agent-extras":  "dist/servers/extras.js"
    }
```

### Why one package and not three

The vault at `~/.canvas-agent/vault/<host>/<course_id>.json` is shared, stateful, and security-sensitive (chmod 600, HMAC-keyed `Student_<hex>` tokens). Three separate npm packages each importing a `@canvas-agent/core` dependency would risk version skew where the admin MCP's anonymizer reads the vault differently from the core MCP's. Single package, single import graph, single source of truth.

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

### Phase 1 — non-breaking restructure (no published change)

Goal: split each `register*Tools(server)` into the per-MCP variants without changing user-visible behavior.

1. For each mixed file (`courses.ts`, `enrollments.ts`, `communication.ts`, `grading.ts`, `analytics.ts`, `scheduling.ts`), extract two registration functions per the routing table.
2. Relocate `list_new_quizzes` from `quizzes.ts` to `new-quizzes.ts`.
3. Update the existing single `cli.ts` entry point to call all three sets so v1 behavior is preserved.
4. Run the existing test suite. No behavior change expected.

**Exit criterion:** the v1 single bin still exposes all 133 tools, but internally they're partitioned. PR reviewers can verify the routing table matches code.

### Phase 2 — three entry points (still single-MCP behavior)

1. Create `src/servers/core.ts`, `src/servers/admin.ts`, `src/servers/extras.ts`.
2. Each server file imports only the registrars matching its bucket.
3. Add the three bins to `package.json`. Keep the legacy `canvas-agent` bin pointing at `cli.ts` (which still loads everything).
4. Manually verify each new server starts and exposes the right tool count.

**Exit criterion:** all four bins work; `cli.ts` (v1 behavior) and `core.ts` (v2 behavior) coexist.

### Phase 3 — flip the default

1. Repoint the `canvas-agent` bin from `dist/cli.js` to `dist/servers/core.js`.
2. Delete `cli.ts` (or keep as a hidden `canvas-agent-all` bin during the deprecation window — see "Open questions").
3. Bump to `2.0.0`. Update README + CLAUDE.md to document the three-MCP architecture.
4. Tag, publish.

**Exit criterion:** `npm install canvas-agent@2` gets the 79-tool core; admin and extras are explicit opt-ins.

## Migration & semver

This is a **breaking change** for any user who relies on a tool that v2 routes out of core. Bump to `2.0.0`.

Migration guide for existing users:

1. Upgrade: `npm install canvas-agent@latest` (or `npx -y canvas-agent@latest` for ephemeral runs).
2. If you use any tool from the admin or extras list, add the corresponding MCP server to your config (see Packaging section above).
3. The vault, anonymizer, and reveal CLI are unchanged — no data migration.

Tools moved out of the default bin are exhaustively listed in the inventory tables above; this is the migration table.

## Open questions

- **Keep a `canvas-agent-all` bin during the v2 transition?** Could ship as a hidden bin pointing at the old `cli.ts` for a release or two, easing migration for users who don't want to think about which MCP a tool belongs to. Trade-off: undermines the "load only what you need" pitch and adds maintenance.
- **Rubric authoring move (future work).** `rubrics.ts` (13 tools) is the next-largest cluster after the v2 split. If the Super Grader workflow tool builds rubric authoring inside Canvas-Agent, this stays in core. If rubrics live in markdown/spreadsheet world, the create/associate/update tools (~6 tools) become extras candidates. Defer until Super Grader's design lands.
- **Help text for the three-MCP picture.** Each MCP could expose a `describe_canvas_mcps` no-op tool that returns "you also have admin and extras available, here's what they do." Useful for discoverability; costs one tool slot per MCP. Not in v2 scope.
- **Tool-name collisions across MCPs?** Currently none: every tool name is unique across all 133. If a future tool adds (say) `delete_assignment_admin`, the suffix convention should match the MCP it ships in.

## Out of scope

- Renaming or refactoring the shared infrastructure (canvas-client, vault, anonymizer). The v2 split is purely a registration-time partition.
- Changing tool signatures, descriptions, or behavior. Same surface, different containers.
- New tools.
- `canvas-cli` (the standalone Gemini CLI). Independent surface; not affected.
