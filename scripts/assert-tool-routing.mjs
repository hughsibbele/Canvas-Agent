#!/usr/bin/env node
// Assertion harness for the v2 three-MCP architecture (post-Phase 3).
//
// Boots the three split servers and asserts each exposes exactly its bucket:
//   - core   = 79 Canvas tools + describe_canvas_mcps (80 total)
//   - admin  = 18 tools per ADMIN manifest below
//   - extras = 36 tools per EXTRAS manifest below
// Asserts no tool name collides across servers, and that the canvas-agent
// bin (dist/cli.js) starts the same surface as servers/core.js.
//
// The ADMIN/EXTRAS lists are the single source of truth — keep in sync with
// V2_BUILD_PLAN.md routing tables.
//
// Run via `npm test`.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

// ── Routing manifest (source of truth for ADMIN/EXTRAS) ─────────────────────

const ADMIN = [
  // courses.ts (9)
  "list_term_courses", "create_course", "update_course_settings", "conclude_course",
  "delete_course", "reset_course_content", "copy_course_content", "list_course_tabs",
  "update_course_navigation",
  // enrollments.ts (9)
  "crosslist_section", "decrosslist_section", "create_section", "update_section",
  "delete_section", "enroll_user", "update_enrollment_state", "delete_enrollment",
  "move_student_to_section",
];

const EXTRAS = [
  // outcomes.ts (5, whole)
  "list_outcomes", "list_outcome_groups", "get_outcome", "list_outcome_results",
  "get_outcome_rollups",
  // groups.ts (7, whole)
  "list_groups", "list_group_categories", "create_group", "create_group_set",
  "add_user_to_group", "remove_user_from_group", "auto_distribute_unassigned",
  // pages.ts (7, whole)
  "list_pages", "get_page", "create_page", "update_page", "delete_page",
  "get_front_page", "list_page_revisions",
  // files.ts (7, whole)
  "list_course_files", "list_folders", "create_folder", "get_file", "update_file",
  "delete_file", "get_file_quota",
  // quizzes.ts (3, whole — list_new_quizzes relocated to new-quizzes.ts)
  "list_quizzes", "get_quiz", "update_quiz",
  // splits
  "send_message", "create_announcement",
  "get_late_policy", "set_late_policy", "get_grading_standards",
  "get_student_messaging_data",
  "update_quiz_dates",
];

const CORE_EXPECTED_SIZE = 80;   // 79 Canvas tools + describe_canvas_mcps
const ADMIN_EXPECTED_SIZE = 18;
const EXTRAS_EXPECTED_SIZE = 36;
const TOTAL_EXPECTED = CORE_EXPECTED_SIZE + ADMIN_EXPECTED_SIZE + EXTRAS_EXPECTED_SIZE;

// ── Helpers ──────────────────────────────────────────────────────────────────

async function listToolsFrom(scriptPath) {
  const transport = new StdioClientTransport({
    command: "node",
    args: [scriptPath],
    env: { ...process.env },
    cwd: REPO_ROOT,
  });
  const client = new Client(
    { name: "assert-tool-routing", version: "1.0" },
    { capabilities: {} }
  );
  await client.connect(transport);
  const { tools } = await client.listTools();
  await client.close();
  return tools;
}

const errors = [];
const assert = (cond, msg) => { if (!cond) errors.push(msg); };

// ── Manifest internal consistency ────────────────────────────────────────────

const adminSet = new Set(ADMIN);
const extrasSet = new Set(EXTRAS);

assert(ADMIN.length === ADMIN_EXPECTED_SIZE,
  `admin manifest: expected ${ADMIN_EXPECTED_SIZE}, got ${ADMIN.length}`);
assert(EXTRAS.length === EXTRAS_EXPECTED_SIZE,
  `extras manifest: expected ${EXTRAS_EXPECTED_SIZE}, got ${EXTRAS.length}`);
assert(adminSet.size === ADMIN.length, "admin manifest contains duplicates");
assert(extrasSet.size === EXTRAS.length, "extras manifest contains duplicates");
const overlap = ADMIN.filter(n => extrasSet.has(n));
assert(overlap.length === 0, `tools in both admin and extras: ${overlap.join(", ")}`);

// ── Boot each split server and verify its surface ───────────────────────────

const adminTools = await listToolsFrom(resolve(REPO_ROOT, "dist/servers/admin.js"));
const extrasTools = await listToolsFrom(resolve(REPO_ROOT, "dist/servers/extras.js"));
const coreTools = await listToolsFrom(resolve(REPO_ROOT, "dist/servers/core.js"));

function checkServer(label, tools, expectedSize, expectedNames) {
  const names = tools.map(t => t.name);
  const nameSet = new Set(names);

  assert(tools.length === expectedSize,
    `${label} server tool count: expected ${expectedSize}, got ${tools.length}`);

  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  assert(dupes.length === 0, `${label} server has duplicates: ${[...new Set(dupes)].join(", ")}`);

  if (expectedNames) {
    const missing = [...expectedNames].filter(n => !nameSet.has(n));
    const extra = names.filter(n => !expectedNames.has(n));
    assert(missing.length === 0,
      `${label} server missing expected tools: ${missing.join(", ")}`);
    assert(extra.length === 0,
      `${label} server has unexpected tools: ${extra.join(", ")}`);
  }
}

checkServer("admin", adminTools, ADMIN_EXPECTED_SIZE, adminSet);
checkServer("extras", extrasTools, EXTRAS_EXPECTED_SIZE, extrasSet);
// Core has no fixed name manifest (it's "everything else"). Just verify size,
// require that it includes describe_canvas_mcps, and verify it doesn't overlap
// admin/extras.
checkServer("core", coreTools, CORE_EXPECTED_SIZE);
const coreNames = new Set(coreTools.map(t => t.name));
assert(coreNames.has("describe_canvas_mcps"),
  "core server is missing describe_canvas_mcps");
const coreInAdmin = [...coreNames].filter(n => adminSet.has(n));
const coreInExtras = [...coreNames].filter(n => extrasSet.has(n));
assert(coreInAdmin.length === 0, `core server has admin-bucket tools: ${coreInAdmin.join(", ")}`);
assert(coreInExtras.length === 0, `core server has extras-bucket tools: ${coreInExtras.join(", ")}`);

// ── Cross-server collision check ────────────────────────────────────────────

const allSplitNames = [
  ...coreTools.map(t => t.name),
  ...adminTools.map(t => t.name),
  ...extrasTools.map(t => t.name),
];
const crossDupes = allSplitNames.filter((n, i) => allSplitNames.indexOf(n) !== i);
assert(crossDupes.length === 0,
  `tool name appears in more than one split server: ${[...new Set(crossDupes)].join(", ")}`);
assert(allSplitNames.length === TOTAL_EXPECTED,
  `total tool count: expected ${TOTAL_EXPECTED}, got ${allSplitNames.length}`);

// ── canvas-agent bin (dist/cli.js) must equal the core server ───────────────

const cliTools = await listToolsFrom(resolve(REPO_ROOT, "dist/cli.js"));
const cliNames = new Set(cliTools.map(t => t.name));
assert(cliTools.length === CORE_EXPECTED_SIZE,
  `canvas-agent bin tool count: expected ${CORE_EXPECTED_SIZE}, got ${cliTools.length}`);
const cliMinusCore = [...cliNames].filter(n => !coreNames.has(n));
const coreMinusCli = [...coreNames].filter(n => !cliNames.has(n));
assert(cliMinusCore.length === 0, `canvas-agent bin has tools not in core: ${cliMinusCore.join(", ")}`);
assert(coreMinusCli.length === 0, `core server has tools not in canvas-agent bin: ${coreMinusCli.join(", ")}`);

// ── Report ──────────────────────────────────────────────────────────────────

console.log(`\nv2 surface (three MCPs): ${TOTAL_EXPECTED} tools`);
console.log(`  core (canvas-agent):           ${coreTools.length}`);
console.log(`  admin (canvas-agent-admin):    ${adminTools.length}`);
console.log(`  extras (canvas-agent-extras):  ${extrasTools.length}`);

const CHARS_PER_TOKEN = 3.5;
const renderTool = (t) => JSON.stringify({
  name: t.name,
  description: t.description ?? "",
  input_schema: t.inputSchema ?? {},
});
const tokens = (ts) => Math.round(
  ts.reduce((s, t) => s + renderTool(t).length, 0) / CHARS_PER_TOKEN
);
const coreTok = tokens(coreTools);
const adminTok = tokens(adminTools);
const extrasTok = tokens(extrasTools);
const totalTok = coreTok + adminTok + extrasTok;
console.log(`\nestimated tokens (chars / ${CHARS_PER_TOKEN}):`);
console.log(`  core:   ~${coreTok.toLocaleString()}  (${Math.round((coreTok/totalTok)*100)}% of total)`);
console.log(`  admin:  ~${adminTok.toLocaleString()}`);
console.log(`  extras: ~${extrasTok.toLocaleString()}`);
console.log(`  total:  ~${totalTok.toLocaleString()}`);

if (errors.length) {
  console.error(`\n❌ ${errors.length} assertion failure(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log("\n✅ all assertions passed");
