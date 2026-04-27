/**
 * Swap student PII for opaque tokens before Canvas responses reach Claude,
 * and swap them back before text heads out to Canvas.
 *
 * v1 scope: structured user-shaped objects only. Free-text bodies
 * (discussion posts, page HTML, submission prose) pass through unchanged.
 */

import {
  extractUserId,
  globalCourseId,
  lookupByTokenGlobal,
  lookupByUserIdGlobal,
  lookupByToken,
  loadCourseVault,
  recordUser,
  type Role,
} from "./vault.js";
import { unsandboxText } from "./sandbox.js";

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
//
// Each entry's role hint records what role the nested user almost always has
// in that context. `null` means we can't tell from the key name alone — the
// role will be left to inheritance (e.g. `user` inside an enrollment row
// inherits the role implied by the row's `type` field).
const NESTED_USER_KEYS: Record<string, Role | null> = {
  user: null,
  author: null,
  submitted_by: null,
  assessor: "teacher",
  edited_by: "teacher",
  changed_by: "teacher",
  graded_by: "teacher",
  grader: "teacher",
  enrolled_by: "teacher",
};

// Flattened id+name sibling pairs: e.g. submission_comments have
// `author_id` + `author_name` with no nested user object.
const SIBLING_USER_PREFIXES: Record<string, Role | null> = {
  author: null,
  assessor: "teacher",
  grader: "teacher",
  editor: "teacher",
};

// Canvas Enrollment.type → our coarse role.
const ENROLLMENT_TYPE_TO_ROLE: Record<string, Role> = {
  StudentEnrollment: "student",
  TeacherEnrollment: "teacher",
  TaEnrollment: "teacher",
  DesignerEnrollment: "teacher",
  // ObserverEnrollment intentionally omitted — observers (e.g. parents) are
  // neither students nor staff for our purposes; leave them unknown.
};

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
  const rawId = extractUserId(user);
  if (rawId != null) {
    const hit = lookupByUserIdGlobal(rawId);
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

/**
 * If `obj` is itself an Enrollment row (has a `type` like `StudentEnrollment`),
 * return the role that any nested `user` on that row should inherit.
 */
function enrollmentRoleFor(obj: Record<string, unknown>): Role | null {
  const t = obj.type;
  if (typeof t !== "string") return null;
  return ENROLLMENT_TYPE_TO_ROLE[t] ?? null;
}

/**
 * If `obj` is a User row that includes an `enrollments` array (Canvas returns
 * this when `include[]=enrollments` is requested on /users), derive the role
 * from the enrollment types. Multiple roles → take the highest priority
 * (teacher > student) so a TA who is also auditing a class is treated as staff.
 */
function userRoleFromOwnEnrollments(obj: Record<string, unknown>): Role | null {
  const enrollments = obj.enrollments;
  if (!Array.isArray(enrollments)) return null;
  let best: Role | null = null;
  for (const e of enrollments) {
    if (!isPlainObject(e)) continue;
    const r = enrollmentRoleFor(e);
    if (r === "teacher") return "teacher";
    if (r === "student") best = "student";
  }
  return best;
}

function tokenizeUser(
  user: Record<string, unknown>,
  pathCourseId: string | null,
  roleHint: Role | null
): Record<string, unknown> {
  // Skip minting if there's nothing identifying to rewrite — avoids
  // vault rows that are just {token} with no name (e.g. bare `grader_id`).
  if (!hasAnyUserField(user)) {
    return walkObject(user, pathCourseId, null);
  }
  const courseId = resolveCourseId(pathCourseId, user);
  const ownRole = userRoleFromOwnEnrollments(user);
  const role = ownRole ?? roleHint ?? undefined;
  const token = recordUser(courseId, user, role);
  if (!token) {
    return walkObject(user, pathCourseId, null);
  }

  // After recording, look up the merged role from the vault — that gives us
  // the strongest signal we've ever seen for this user (teacher > student >
  // unknown). A user previously tagged "teacher" stays a teacher even if
  // this particular response doesn't carry strong evidence.
  const rawId = extractUserId(user);
  const stored = rawId != null
    ? loadCourseVault(courseId).byUserId.get(String(rawId))
    : null;
  const effectiveRole = stored?.role ?? role ?? "unknown";

  // Known teachers: pass real names through. Tokenizing staff is unnecessary
  // (teachers are the principal here, not the subject of privacy protection)
  // and breaks workflows like "did I grade this submission?".
  if (effectiveRole === "teacher") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(user)) {
      out[key] = walkValue(value, pathCourseId, null);
    }
    return out;
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(user)) {
    if (USER_FIELDS.has(key) && typeof value === "string") {
      out[key] = token;
    } else {
      out[key] = walkValue(value, pathCourseId, null);
    }
  }
  return out;
}

function walkValue(
  value: unknown,
  courseId: string | null,
  roleHint: Role | null
): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => walkValue(v, courseId, roleHint));
  }
  if (isPlainObject(value)) {
    return walkObject(value, courseId, roleHint);
  }
  return value;
}

function tokenizeSiblingPairs(
  obj: Record<string, unknown>,
  courseId: string | null
): Record<string, unknown> {
  let out: Record<string, unknown> | null = null;
  for (const [prefix, prefixRole] of Object.entries(SIBLING_USER_PREFIXES)) {
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
    const token = recordUser(resolved, synthetic, prefixRole ?? undefined);
    if (!token) continue;

    // If we've ever seen this user as a teacher, leave their name in place.
    const stored = loadCourseVault(resolved).byUserId.get(String(idVal));
    if (stored?.role === "teacher") continue;

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
  courseId: string | null,
  roleHint: Role | null
): Record<string, unknown> {
  if (looksLikeUser(obj)) {
    return tokenizeUser(obj, courseId, roleHint);
  }
  // If `obj` is an Enrollment row, its nested `user` inherits role from `type`.
  const enrollmentRole = enrollmentRoleFor(obj);
  const base = tokenizeSiblingPairs(obj, courseId);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(base)) {
    const nestedRole = NESTED_USER_KEYS[key];
    if (nestedRole !== undefined && isPlainObject(value)) {
      // Hint precedence: explicit nested-key role > enrollment-row role.
      const hint = nestedRole ?? enrollmentRole;
      out[key] = tokenizeUser(value, courseId, hint);
    } else {
      // Don't propagate role hints into unrelated subtrees.
      out[key] = walkValue(value, courseId, null);
    }
  }
  return out;
}

export function anonymizeResponse(
  data: unknown,
  courseId: string | null
): unknown {
  if (!ENABLED) return data;
  return walkValue(data, courseId, null);
}

/** Replace every Student_xxxxxx token in `text` with the vault row's name. */
export function rehydrateText(
  text: string | undefined,
  courseId: string | null
): string | undefined {
  if (text == null) return text;
  // Strip any sandbox markers the LLM may have echoed back from a prior
  // response — otherwise our protection markers would leak into real Canvas
  // content (page bodies, announcements, etc.).
  text = unsandboxText(text)!;
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
