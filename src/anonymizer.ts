/**
 * Swap student PII for opaque tokens before Canvas responses reach Claude,
 * and swap them back before text heads out to Canvas.
 *
 * v1 scope: structured user-shaped objects only. Free-text bodies
 * (discussion posts, page HTML, submission prose) pass through unchanged.
 */

import {
  globalCourseId,
  lookupByTokenGlobal,
  lookupByUserIdGlobal,
  lookupByToken,
  recordUser,
} from "./vault.js";

const ENABLED = process.env.CANVAS_AGENT_ANONYMIZE !== "0";

const USER_FIELDS = new Set([
  "name",
  "sortable_name",
  "short_name",
  "display_name",
  "user_name",
  "email",
  "primary_email",
  "login_id",
  "sis_user_id",
  "sis_login_id",
  "integration_id",
  "avatar_url",
  "pronouns",
  "bio",
]);

const ID_HINTS = new Set([
  "email",
  "primary_email",
  "sortable_name",
  "avatar_url",
  "login_id",
  "short_name",
  "pronouns",
  "bio",
]);

const USER_ID_HINTS = new Set(["name", "email", "sortable_name", "user_name"]);

// Nested keys whose value is a user-shaped object. Anything under these
// gets tokenized even if the nested object alone wouldn't match looksLikeUser
// (e.g. `edited_by: {id, display_name}` in page revisions).
const NESTED_USER_KEYS = new Set([
  "user",
  "author",
  "assessor",
  "edited_by",
  "changed_by",
  "submitted_by",
  "graded_by",
  "grader",
  "enrolled_by",
]);

// Flattened id+name sibling pairs: e.g. submission_comments have
// `author_id` + `author_name` with no nested user object.
const SIBLING_USER_PREFIXES = ["author", "assessor", "grader", "editor"];

const TOKEN_RE = /Student_[0-9a-f]{6}/g;

export function isAnonymizationEnabled(): boolean {
  return ENABLED;
}

export function extractCourseIdFromPath(path: string): string | null {
  const match = path.match(/^\/?courses\/(\d+)/);
  return match ? match[1] : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasAny(obj: Record<string, unknown>, hints: Set<string>): boolean {
  for (const key of hints) {
    if (obj[key] !== undefined && obj[key] !== null) return true;
  }
  return false;
}

/** Is this object shaped like a Canvas user row? */
function looksLikeUser(obj: Record<string, unknown>): boolean {
  if ("id" in obj && hasAny(obj, ID_HINTS)) return true;
  if ("user_id" in obj && hasAny(obj, USER_ID_HINTS)) return true;
  return false;
}

function resolveCourseId(
  pathCourseId: string | null,
  user: Record<string, unknown>
): string {
  if (pathCourseId) return pathCourseId;
  const rawId = user.id ?? user.user_id;
  if (rawId != null) {
    const hit = lookupByUserIdGlobal(rawId as string | number);
    if (hit) return hit.courseId;
  }
  return globalCourseId();
}

function hasAnyUserField(obj: Record<string, unknown>): boolean {
  for (const field of USER_FIELDS) {
    const v = obj[field];
    if (typeof v === "string" && v.length > 0) return true;
  }
  return false;
}

function tokenizeUser(
  user: Record<string, unknown>,
  pathCourseId: string | null
): Record<string, unknown> {
  // Skip minting if there's nothing identifying to rewrite — avoids
  // vault rows that are just {token} with no name (e.g. bare `grader_id`).
  if (!hasAnyUserField(user)) {
    return walkObject(user, pathCourseId);
  }
  const courseId = resolveCourseId(pathCourseId, user);
  const token = recordUser(courseId, user);
  if (!token) {
    return walkObject(user, pathCourseId);
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(user)) {
    if (USER_FIELDS.has(key) && typeof value === "string") {
      out[key] = token;
    } else {
      out[key] = walkValue(value, pathCourseId);
    }
  }
  return out;
}

function walkValue(value: unknown, courseId: string | null): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => walkValue(v, courseId));
  }
  if (isPlainObject(value)) {
    return walkObject(value, courseId);
  }
  return value;
}

function tokenizeSiblingPairs(
  obj: Record<string, unknown>,
  courseId: string | null
): Record<string, unknown> {
  let out: Record<string, unknown> | null = null;
  for (const prefix of SIBLING_USER_PREFIXES) {
    const idVal = obj[`${prefix}_id`];
    if (idVal == null) continue;
    const synthetic: Record<string, unknown> = { id: idVal };
    let hasField = false;
    for (const field of USER_FIELDS) {
      const k = `${prefix}_${field}`;
      const v = obj[k];
      if (typeof v === "string" && v.length > 0) {
        synthetic[field] = v;
        hasField = true;
      }
    }
    // Bare <prefix>_id with no name fields (e.g. grader_id on a submission
    // when no grader_name is included) — nothing to tokenize, skip.
    if (!hasField) continue;
    const resolved = resolveCourseId(courseId, synthetic);
    const token = recordUser(resolved, synthetic);
    if (!token) continue;
    if (!out) out = { ...obj };
    for (const field of USER_FIELDS) {
      const k = `${prefix}_${field}`;
      if (typeof out[k] === "string") out[k] = token;
    }
  }
  return out ?? obj;
}

function walkObject(
  obj: Record<string, unknown>,
  courseId: string | null
): Record<string, unknown> {
  if (looksLikeUser(obj)) {
    return tokenizeUser(obj, courseId);
  }
  const base = tokenizeSiblingPairs(obj, courseId);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(base)) {
    if (NESTED_USER_KEYS.has(key) && isPlainObject(value)) {
      out[key] = tokenizeUser(value, courseId);
    } else {
      out[key] = walkValue(value, courseId);
    }
  }
  return out;
}

export function anonymizeResponse(
  data: unknown,
  courseId: string | null
): unknown {
  if (!ENABLED) return data;
  return walkValue(data, courseId);
}

/** Replace every Student_xxxxxx token in `text` with the vault row's name. */
export function rehydrateText(
  text: string | undefined,
  courseId: string | null
): string | undefined {
  if (text == null) return text;
  if (!ENABLED) return text;
  if (!TOKEN_RE.test(text)) return text;
  TOKEN_RE.lastIndex = 0;
  return text.replace(TOKEN_RE, (token) => {
    if (courseId) {
      const hit = lookupByToken(courseId, token);
      if (hit?.name) return hit.name;
      if (hit?.sortable_name) return hit.sortable_name;
    }
    const global = lookupByTokenGlobal(token);
    if (global.length > 0) {
      const rec = global[0].record;
      return rec.name ?? rec.sortable_name ?? token;
    }
    return token;
  });
}
