/**
 * `canvas-agent vault-gc [--course <id>] [--apply] [--verbose]` —
 * prune orphan vault rows left behind by the pre-fix anonymizer.
 *
 * Background: before the user_id-vs-id fix, recordUser keyed every row by
 * `user.id ?? user.user_id`. For a discussion entry / submission /
 * submission_comment, `id` is the row's own primary key (entry id, not user
 * id), so each such object minted a phantom vault row keyed by entry id but
 * containing the real student's name, email, etc. Old vaults can have many
 * orphans per real student.
 *
 * Cleanup rule: within a single course, group rows by name + sortable_name
 * (case-insensitive). For each group with more than one row, keep the
 * "winner" (smallest numeric key — most likely the real Canvas user id —
 * with role-tagged rows preferred as tiebreak) and delete the rest.
 * Singletons stay untouched: they may belong to past students who left the
 * course, and we have no signal to distinguish them from orphans without
 * touching the Canvas API.
 *
 * Default mode is dry-run; pass --apply to actually remove rows.
 */

import "dotenv/config";
import {
  listCoursesForCurrentHost,
  loadCourseVault,
  removeUsers,
  type UserRecord,
} from "./vault.js";

interface Args {
  courseId: string | null;
  apply: boolean;
  verbose: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { courseId: null, apply: false, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--course" || arg === "-c") {
      out.courseId = argv[++i] ?? null;
    } else if (arg === "--apply") {
      out.apply = true;
    } else if (arg === "--verbose" || arg === "-v") {
      out.verbose = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: canvas-agent vault-gc [--course <id>] [--apply] [--verbose]\n" +
          "  Default: dry-run report. Pass --apply to actually delete orphans.\n" +
          "  --course <id>: scope to a single course (default: every course in\n" +
          "    the current host's vault).\n" +
          "  --verbose: list each student's pruned ids."
      );
      process.exit(0);
    }
  }
  return out;
}

/**
 * Build a comparable display-name for grouping. Real-student rows (populated
 * from /enrollments) have `name` + `sortable_name`. Orphan rows from buggy
 * discussion-entry processing only have `user_name` (Canvas's name field on
 * an entry). We fall through every name-shaped field so a real row and its
 * orphans land in the same bucket.
 */
function nameKey(record: UserRecord): string | null {
  const candidates = [
    record.name,
    record.sortable_name,
    record.user_name,
    record.display_name,
    record.short_name,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) {
      return c.trim().toLowerCase();
    }
  }
  return null;
}

interface OrphanReport {
  /** The vault key we're keeping (most likely the real Canvas user id). */
  winnerId: string;
  winnerName: string;
  orphanIds: string[];
}

function analyzeCourse(courseId: string): OrphanReport[] {
  const vault = loadCourseVault(courseId);
  const groups = new Map<string, Array<{ id: string; record: UserRecord }>>();
  for (const [id, record] of vault.byUserId.entries()) {
    const key = nameKey(record);
    if (!key) continue;
    const bucket = groups.get(key) ?? [];
    bucket.push({ id, record });
    groups.set(key, bucket);
  }

  const reports: OrphanReport[] = [];
  for (const bucket of groups.values()) {
    if (bucket.length < 2) continue;
    // Winner = smallest numeric key. Numeric ids parse cleanly; anything
    // non-numeric sorts last via Number(NaN) → fall back to string compare.
    bucket.sort((a, b) => {
      const an = Number(a.id);
      const bn = Number(b.id);
      if (!Number.isNaN(an) && !Number.isNaN(bn) && an !== bn) return an - bn;
      // Tiebreak: prefer rows with role tagged (likely populated via
      // /enrollments, the canonical source of truth).
      const ar = a.record.role && a.record.role !== "unknown" ? 0 : 1;
      const br = b.record.role && b.record.role !== "unknown" ? 0 : 1;
      if (ar !== br) return ar - br;
      return a.id.localeCompare(b.id);
    });
    const [winner, ...rest] = bucket;
    reports.push({
      winnerId: winner.id,
      winnerName: winner.record.name ?? winner.record.sortable_name ?? "(no name)",
      orphanIds: rest.map((r) => r.id),
    });
  }
  return reports;
}

function pluralize(n: number, singular: string, plural?: string): string {
  return `${n} ${n === 1 ? singular : plural ?? singular + "s"}`;
}

export async function runVaultGc(): Promise<void> {
  const { courseId, apply, verbose } = parseArgs(process.argv.slice(3));

  const courseIds = courseId
    ? [courseId]
    : listCoursesForCurrentHost();

  if (courseIds.length === 0) {
    console.error("No courses found in the current host's vault.");
    process.exit(1);
  }

  let totalOrphans = 0;
  let totalCoursesWithOrphans = 0;
  let totalRemoved = 0;

  for (const cid of courseIds) {
    const reports = analyzeCourse(cid);
    const orphansInCourse = reports.reduce((s, r) => s + r.orphanIds.length, 0);
    if (orphansInCourse === 0) continue;

    totalCoursesWithOrphans++;
    totalOrphans += orphansInCourse;

    console.log(
      `Course ${cid}: ${pluralize(orphansInCourse, "orphan row")} ` +
        `across ${pluralize(reports.length, "student")}.`
    );

    if (verbose) {
      for (const r of reports) {
        console.log(
          `  ${r.winnerName}  keep=${r.winnerId}  prune=[${r.orphanIds.join(", ")}]`
        );
      }
    }

    if (apply) {
      const all = reports.flatMap((r) => r.orphanIds);
      const removed = removeUsers(cid, all);
      totalRemoved += removed;
      console.log(`  Removed ${removed} rows.`);
    }
  }

  console.log("");
  if (totalOrphans === 0) {
    console.log("No orphan rows found. Vault is clean.");
    return;
  }

  if (apply) {
    console.log(
      `Done. Pruned ${totalRemoved} of ${totalOrphans} orphan rows ` +
        `across ${totalCoursesWithOrphans} courses.`
    );
    console.log(
      "Tip: re-run list_students on each course to re-anchor any students " +
        "whose canonical vault row was missing — the next API call will repopulate it."
    );
  } else {
    console.log(
      `Found ${totalOrphans} orphan rows across ${totalCoursesWithOrphans} courses. ` +
        `Re-run with --apply to remove them.`
    );
  }
}
