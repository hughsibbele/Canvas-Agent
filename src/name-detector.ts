/**
 * Detect student names embedded in free-text fields and replace them with the
 * student's `Student_xxxxxx` token. Closes the gap left by the structured-field
 * anonymizer: a student writing "Bob said the same thing in his post" or a
 * peer-review comment naming the reviewee gets the names redacted before the
 * text reaches Claude.
 *
 * Scope: full name and sortable-name form only ("Jane Doe" / "Doe, Jane").
 * No first-name or last-name-only matching — too many false positives on
 * common English words ("Mark", "Brown", "Will"). No nickname handling.
 *
 * Source of truth: the per-course vault. Only entries with role === "student"
 * are matched, so teacher and TA names are never replaced. The vault is
 * populated by the anonymizer as Canvas responses flow through, so coverage
 * grows naturally as the teacher uses tools like list_students,
 * list_submissions, etc.
 */

import { getVaultVersion, loadCourseVault } from "./vault.js";
import { UNTRUSTED_TEXT_FIELDS } from "./sandbox.js";

const ENABLED = process.env.CANVAS_AGENT_ANONYMIZE !== "0";

// Names shorter than this are skipped to avoid pathological matches on
// common short words (initials, "Li", "Wu", "An"). Three chars is the
// shortest tolerable cutoff for full-name matching.
const MIN_NAME_LENGTH = 3;

// What characters can sit inside a name? Unicode letters and marks (covers
// "José"), apostrophes (O'Brien), hyphens (Smith-Jones). Used to build
// custom word-boundary lookarounds — `\b` alone treats hyphen and apostrophe
// as boundaries, which would mis-match those names.
const NAME_CHAR_CLASS = "[\\p{L}\\p{M}'\\u2019\\-]";

interface CompiledPattern {
  version: number;
  regex: RegExp | null;
  // Case-folded match string → token to substitute in.
  tokenByMatch: Map<string, string>;
}

const cache = new Map<string, CompiledPattern>();

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Build (or rebuild) the name-matching pattern for a course. */
function compile(courseId: string): CompiledPattern {
  const version = getVaultVersion(courseId);
  const cached = cache.get(courseId);
  if (cached && cached.version === version) return cached;

  const vault = loadCourseVault(courseId);
  const tokenByMatch = new Map<string, string>();

  for (const record of vault.byUserId.values()) {
    if (record.role !== "student") continue;
    if (!record.token) continue;
    for (const field of ["name", "sortable_name"] as const) {
      const value = record[field];
      if (typeof value !== "string") continue;
      const trimmed = value.trim();
      if (trimmed.length < MIN_NAME_LENGTH) continue;
      const key = trimmed.toLowerCase();
      // First writer wins. If two students share a name, we can't tell them
      // apart from text alone, so we just blank the name with whichever
      // token we recorded first — known limitation, documented in the
      // file header.
      if (!tokenByMatch.has(key)) {
        tokenByMatch.set(key, record.token);
      }
    }
  }

  if (tokenByMatch.size === 0) {
    const empty: CompiledPattern = { version, regex: null, tokenByMatch };
    cache.set(courseId, empty);
    return empty;
  }

  // Length-descending alternation so "Mary Anne Smith" matches before "Mary
  // Smith" (regex alternation is leftmost-first, not longest-first).
  const patterns = [...tokenByMatch.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex);

  // Custom Unicode-aware boundaries: don't match if the surrounding char is
  // also part of a name (letter, mark, apostrophe, or hyphen). This handles
  // "Smith-Jones" not partial-matching "Smith", and "O'Brien" matching as
  // a single unit instead of breaking at the apostrophe.
  const regex = new RegExp(
    `(?<!${NAME_CHAR_CLASS})(?:${patterns.join("|")})(?!${NAME_CHAR_CLASS})`,
    "giu"
  );

  const compiled: CompiledPattern = { version, regex, tokenByMatch };
  cache.set(courseId, compiled);
  return compiled;
}

/**
 * Replace any known student names in `text` with their tokens. Returns the
 * text unchanged if nothing matched, the course has no student vault entries,
 * or detection is disabled.
 */
export function redactStudentNames(
  text: string,
  courseId: string | null
): string {
  if (!ENABLED || !courseId) return text;
  if (text.length < MIN_NAME_LENGTH) return text;
  const { regex, tokenByMatch } = compile(courseId);
  if (!regex) return text;
  return text.replace(regex, (match) => tokenByMatch.get(match.toLowerCase()) ?? match);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    Object.getPrototypeOf(v) === Object.prototype
  );
}

function walk(value: unknown, courseId: string | null): unknown {
  if (Array.isArray(value)) return value.map((v) => walk(v, courseId));
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (UNTRUSTED_TEXT_FIELDS.has(key) && typeof v === "string") {
      out[key] = redactStudentNames(v, courseId);
    } else {
      out[key] = walk(v, courseId);
    }
  }
  return out;
}

/**
 * Walk a Canvas response and replace student names inside the same set of
 * free-text fields the sandbox wraps. Runs after the structured-field
 * anonymizer (so the vault is up to date for this course) and before the
 * sandbox wrapper (so the wrapped content is already redacted).
 */
export function redactNamesInResponse(
  data: unknown,
  courseId: string | null
): unknown {
  if (!ENABLED || !courseId) return data;
  return walk(data, courseId);
}
