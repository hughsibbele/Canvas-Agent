#!/usr/bin/env node
// Assertion harness for the v2 three-MCP refactor.
//
// Phase 1: boots the all-bin (`dist/cli.js`) and asserts the v1 surface
// is preserved (133 tools), every name in the ADMIN/EXTRAS manifests is registered,
// no name appears in two buckets, and core (defined as anything not in admin/extras)
// totals 79. Reports per-bucket token estimates as a context-budget tripwire.
//
// Phase 2 (current): additionally boots dist/servers/{core,admin,extras}.js and
// asserts each one exposes exactly its bucket. The ADMIN/EXTRAS lists below are the
// single source of truth — keep in sync with V2_BUILD_PLAN.md routing tables.
//
// Run via `npm test`.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

// ── Routing manifest (source of truth for ADMIN/EXTRAS) ─────────────────────
// Anything not in either list is core.
// Total expected: 18 admin + 36 extras + 79 core = 133.

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

// ── Boot the v1 all-bin and list its tools ──────────────────────────────────

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

// ── Assertions ──────────────────────────────────────────────────────────────

const errors = [];
const assert = (cond, msg) => { if (!cond) errors.push(msg); };

const allBinPath = resolve(REPO_ROOT, "dist/cli.js");
const tools = await listToolsFrom(allBinPath);
const names = tools.map(t => t.name);
const nameSet = new Set(names);
const adminSet = new Set(ADMIN);
const extrasSet = new Set(EXTRAS);

// Manifest internal consistency
assert(ADMIN.length === 18, `admin manifest: expected 18, got ${ADMIN.length}`);
assert(EXTRAS.length === 36, `extras manifest: expected 36, got ${EXTRAS.length}`);
assert(new Set(ADMIN).size === ADMIN.length, "admin manifest contains duplicates");
assert(new Set(EXTRAS).size === EXTRAS.length, "extras manifest contains duplicates");
const overlap = ADMIN.filter(n => extrasSet.has(n));
assert(overlap.length === 0, `tools in both admin and extras: ${overlap.join(", ")}`);

// Live surface
assert(tools.length === 133, `all-bin tool count: expected 133, got ${tools.length}`);
const dupes = names.filter((n, i) => names.indexOf(n) !== i);
assert(dupes.length === 0, `duplicate tool names in all-bin: ${dupes.join(", ")}`);

// Manifest matches reality
const missingAdmin = ADMIN.filter(n => !nameSet.has(n));
const missingExtras = EXTRAS.filter(n => !nameSet.has(n));
assert(missingAdmin.length === 0,
  `admin manifest names not registered: ${missingAdmin.join(", ")}`);
assert(missingExtras.length === 0,
  `extras manifest names not registered: ${missingExtras.join(", ")}`);

// Core size by subtraction
const coreCount = tools.length - ADMIN.length - EXTRAS.length;
assert(coreCount === 79, `core count by subtraction: expected 79, got ${coreCount}`);

// ── Phase 2: each split server exposes exactly its bucket ───────────────────

const expectedCoreNames = new Set(names.filter(n => !adminSet.has(n) && !extrasSet.has(n)));
const splitServers = [
  { label: "core",   path: "dist/servers/core.js",   expectedSize: 79, expectedNames: expectedCoreNames },
  { label: "admin",  path: "dist/servers/admin.js",  expectedSize: 18, expectedNames: adminSet },
  { label: "extras", path: "dist/servers/extras.js", expectedSize: 36, expectedNames: extrasSet },
];

const splitTools = {};
for (const s of splitServers) {
  const ts = await listToolsFrom(resolve(REPO_ROOT, s.path));
  splitTools[s.label] = ts;
  const got = ts.map(t => t.name);
  const gotSet = new Set(got);

  assert(ts.length === s.expectedSize,
    `${s.label} server tool count: expected ${s.expectedSize}, got ${ts.length}`);

  const dupes = got.filter((n, i) => got.indexOf(n) !== i);
  assert(dupes.length === 0, `${s.label} server has duplicates: ${dupes.join(", ")}`);

  const missing = [...s.expectedNames].filter(n => !gotSet.has(n));
  const extra = got.filter(n => !s.expectedNames.has(n));
  assert(missing.length === 0, `${s.label} server missing expected tools: ${missing.join(", ")}`);
  assert(extra.length === 0, `${s.label} server has unexpected tools: ${extra.join(", ")}`);
}

// Cross-server collision check: every tool name appears in exactly one split server
const allSplitNames = [
  ...splitTools.core.map(t => t.name),
  ...splitTools.admin.map(t => t.name),
  ...splitTools.extras.map(t => t.name),
];
const crossDupes = allSplitNames.filter((n, i) => allSplitNames.indexOf(n) !== i);
assert(crossDupes.length === 0,
  `tool name appears in more than one split server: ${[...new Set(crossDupes)].join(", ")}`);

// Sanity: union of split servers equals the all-bin
const allSplitSet = new Set(allSplitNames);
const allBinSet = new Set(names);
const inAllNotSplit = [...allBinSet].filter(n => !allSplitSet.has(n));
const inSplitNotAll = [...allSplitSet].filter(n => !allBinSet.has(n));
assert(inAllNotSplit.length === 0, `in all-bin but missing from split servers: ${inAllNotSplit.join(", ")}`);
assert(inSplitNotAll.length === 0, `in split servers but missing from all-bin: ${inSplitNotAll.join(", ")}`);

// ── Report ──────────────────────────────────────────────────────────────────

console.log(`\nv1 all-bin tool surface: ${tools.length}`);
console.log(`  core:   ${coreCount}`);
console.log(`  admin:  ${ADMIN.length}`);
console.log(`  extras: ${EXTRAS.length}`);

const CHARS_PER_TOKEN = 3.5;
const renderTool = (t) => JSON.stringify({
  name: t.name,
  description: t.description ?? "",
  input_schema: t.inputSchema ?? {},
});
const bucketTokens = (filterFn) =>
  Math.round(
    tools.filter(filterFn).reduce((s, t) => s + renderTool(t).length, 0) /
      CHARS_PER_TOKEN
  );
const totalTok = bucketTokens(() => true);
const coreTok = bucketTokens(t => !adminSet.has(t.name) && !extrasSet.has(t.name));
const adminTok = bucketTokens(t => adminSet.has(t.name));
const extrasTok = bucketTokens(t => extrasSet.has(t.name));
console.log(`\nestimated tokens (chars / ${CHARS_PER_TOKEN}):`);
console.log(`  total:  ~${totalTok.toLocaleString()}`);
console.log(`  core:   ~${coreTok.toLocaleString()}  (${Math.round((coreTok/totalTok)*100)}% of v1)`);
console.log(`  admin:  ~${adminTok.toLocaleString()}`);
console.log(`  extras: ~${extrasTok.toLocaleString()}`);

if (errors.length) {
  console.error(`\n❌ ${errors.length} assertion failure(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log("\n✅ all assertions passed");
