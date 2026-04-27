/**
 * `canvas-agent reveal <token> [--course <id>]` — print the real
 * student behind a Student_xxxxxx token. Never surfaces through Claude.
 */

import "dotenv/config";
import { listAllVaultEntries, lookupByTokenGlobal } from "./vault.js";

interface ParsedArgs {
  token: string | null;
  courseId: string | null;
  all: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  let token: string | null = null;
  let courseId: string | null = null;
  let all = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--course" || arg === "-c") {
      courseId = argv[++i] ?? null;
    } else if (arg === "--all" || arg === "-a") {
      all = true;
    } else if (!token) {
      token = arg;
    }
  }
  return { token, courseId, all };
}

function formatHit(
  host: string,
  courseId: string,
  record: {
    name?: string;
    email?: string;
    user_id: string;
    token?: string;
    role?: string;
  }
): string {
  const namePart = record.name ?? "(no name)";
  const trailing = [record.email].filter(Boolean).join(" ");
  const tokenPart = record.token ? ` [${record.token}]` : "";
  const rolePart = record.role && record.role !== "unknown" ? ` <${record.role}>` : "";
  return `${host} / course ${courseId} / user_id ${record.user_id}${tokenPart}${rolePart}: ${namePart}${trailing ? " " + trailing : ""}`;
}

function usage(): never {
  console.error(
    "Usage:\n" +
      "  canvas-agent reveal <Student_xxxxxx> [--course <id>]\n" +
      "  canvas-agent reveal --all [--course <id>]"
  );
  process.exit(2);
}

export async function runReveal(): Promise<void> {
  const { token, courseId, all } = parseArgs(process.argv.slice(3));

  if (all) {
    const entries = listAllVaultEntries().filter(
      (e) => !courseId || e.courseId === courseId
    );
    if (entries.length === 0) {
      const scope = courseId ? `course ${courseId}` : "any local vault";
      console.error(`No vault entries found in ${scope}.`);
      process.exit(1);
    }
    entries.sort((a, b) =>
      (a.record.sortable_name ?? a.record.name ?? "").localeCompare(
        b.record.sortable_name ?? b.record.name ?? ""
      )
    );
    for (const e of entries) {
      console.log(formatHit(e.host, e.courseId, e.record));
    }
    return;
  }

  if (!token) usage();

  if (!/^Student_[0-9a-f]{6}$/.test(token!)) {
    console.error(`Not a valid token: ${token}`);
    process.exit(2);
  }

  const hits = lookupByTokenGlobal(token!).filter(
    (h) => !courseId || h.courseId === courseId
  );

  if (hits.length === 0) {
    const scope = courseId ? `course ${courseId}` : "any local vault";
    console.error(`No match for ${token} in ${scope}.`);
    process.exit(1);
  }

  for (const { host, courseId: cid, record } of hits) {
    console.log(formatHit(host, cid, record));
  }
}
