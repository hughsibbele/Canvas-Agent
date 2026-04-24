/**
 * Local vault storing the mapping between Canvas users and opaque tokens.
 *
 * Real names, emails, and login IDs never leave the teacher's machine. The
 * anonymizer mints tokens of the form `Student_<hex>` here and swaps them in
 * before responses reach Claude. Writes go through atomic rename so concurrent
 * MCP sessions can't corrupt a vault file.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.join(os.homedir(), ".canvas-agent");
const VAULT_ROOT = path.join(ROOT, "vault");
const SALT_PATH = path.join(ROOT, "salt");
const GLOBAL_COURSE = "_global";

export interface UserRecord {
  token: string;
  name?: string;
  sortable_name?: string;
  short_name?: string;
  display_name?: string;
  user_name?: string;
  email?: string;
  login_id?: string;
  sis_user_id?: string;
  sis_login_id?: string;
  integration_id?: string;
  avatar_url?: string;
  pronouns?: string;
  bio?: string;
  primary_email?: string;
}

export interface CourseVault {
  byUserId: Map<string, UserRecord>;
  byToken: Map<string, UserRecord & { user_id: string }>;
}

const TOKEN_FIELDS: (keyof UserRecord)[] = [
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
];

let cachedSalt: Buffer | null = null;
let cachedHostname: string | null = null;
const courseCache = new Map<string, CourseVault>();

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true, mode: 0o700 });
}

export function getOrCreateSalt(): Buffer {
  if (cachedSalt) return cachedSalt;
  ensureDir(ROOT);
  try {
    const raw = fs.readFileSync(SALT_PATH);
    if (raw.length >= 32) {
      cachedSalt = raw;
      return cachedSalt;
    }
  } catch {
    // not present — fall through to generate
  }
  const salt = crypto.randomBytes(32);
  fs.writeFileSync(SALT_PATH, salt, { mode: 0o600 });
  try {
    fs.chmodSync(SALT_PATH, 0o600);
  } catch {
    // best-effort on non-POSIX
  }
  cachedSalt = salt;
  return salt;
}

export function hostname(): string {
  if (cachedHostname) return cachedHostname;
  const url = process.env.CANVAS_API_URL ?? "";
  try {
    cachedHostname = new URL(url).host || "unknown";
  } catch {
    cachedHostname = "unknown";
  }
  return cachedHostname;
}

function courseDir(): string {
  const dir = path.join(VAULT_ROOT, hostname());
  ensureDir(dir);
  return dir;
}

function courseFile(courseId: string): string {
  return path.join(courseDir(), `${courseId}.json`);
}

function deriveToken(courseId: string, userId: string): string {
  const mac = crypto.createHmac("sha256", getOrCreateSalt());
  mac.update(`${hostname()}\0${courseId}\0${userId}`);
  return `Student_${mac.digest("hex").slice(0, 6)}`;
}

function readCourseFile(courseId: string): Record<string, UserRecord> {
  const file = courseFile(courseId);
  try {
    const raw = fs.readFileSync(file, "utf8");
    return JSON.parse(raw) as Record<string, UserRecord>;
  } catch {
    return {};
  }
}

function writeCourseFile(courseId: string, data: Record<string, UserRecord>) {
  const file = courseFile(courseId);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(tmp, 0o600);
  } catch {
    // best-effort
  }
  fs.renameSync(tmp, file);
}

export function loadCourseVault(courseId: string): CourseVault {
  const cached = courseCache.get(courseId);
  if (cached) return cached;
  const rows = readCourseFile(courseId);
  const vault: CourseVault = { byUserId: new Map(), byToken: new Map() };
  for (const [userId, record] of Object.entries(rows)) {
    vault.byUserId.set(userId, record);
    if (record.token) {
      vault.byToken.set(record.token, { ...record, user_id: userId });
    }
  }
  courseCache.set(courseId, vault);
  return vault;
}

export function recordUser(
  courseId: string,
  user: Record<string, unknown>
): string | null {
  const rawId = user.id ?? user.user_id;
  if (rawId == null) return null;
  const userId = String(rawId);
  const vault = loadCourseVault(courseId);
  const existing = vault.byUserId.get(userId);

  const record: UserRecord = { ...(existing ?? { token: "" }) };
  for (const field of TOKEN_FIELDS) {
    const value = user[field];
    if (typeof value === "string" && value.length > 0) {
      record[field] = value as never;
    }
  }
  if (!record.token) {
    record.token = deriveToken(courseId, userId);
  }

  // Nothing actually changed → skip the write.
  const unchanged =
    existing &&
    TOKEN_FIELDS.every((f) => existing[f] === record[f]) &&
    existing.token === record.token;
  if (unchanged) return record.token;

  vault.byUserId.set(userId, record);
  vault.byToken.set(record.token, { ...record, user_id: userId });

  const rows = readCourseFile(courseId);
  rows[userId] = record;
  writeCourseFile(courseId, rows);
  return record.token;
}

export function lookupByToken(
  courseId: string,
  token: string
): (UserRecord & { user_id: string }) | null {
  const vault = loadCourseVault(courseId);
  return vault.byToken.get(token) ?? null;
}

export function lookupByUserId(
  courseId: string,
  userId: string | number
): UserRecord | null {
  const vault = loadCourseVault(courseId);
  return vault.byUserId.get(String(userId)) ?? null;
}

function listHostDirs(): string[] {
  try {
    return fs
      .readdirSync(VAULT_ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

function listCourseIdsForHost(host: string): string[] {
  try {
    return fs
      .readdirSync(path.join(VAULT_ROOT, host))
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -".json".length));
  } catch {
    return [];
  }
}

function readCourseFileAt(host: string, courseId: string): Record<string, UserRecord> {
  try {
    const raw = fs.readFileSync(
      path.join(VAULT_ROOT, host, `${courseId}.json`),
      "utf8"
    );
    return JSON.parse(raw) as Record<string, UserRecord>;
  } catch {
    return {};
  }
}

export function lookupByTokenGlobal(
  token: string
): Array<{ host: string; courseId: string; record: UserRecord & { user_id: string } }> {
  const hits: Array<{ host: string; courseId: string; record: UserRecord & { user_id: string } }> = [];
  for (const host of listHostDirs()) {
    for (const courseId of listCourseIdsForHost(host)) {
      const rows = readCourseFileAt(host, courseId);
      for (const [userId, record] of Object.entries(rows)) {
        if (record.token === token) {
          hits.push({ host, courseId, record: { ...record, user_id: userId } });
        }
      }
    }
  }
  return hits;
}

export function listAllVaultEntries(): Array<{
  host: string;
  courseId: string;
  record: UserRecord & { user_id: string };
}> {
  const out: Array<{ host: string; courseId: string; record: UserRecord & { user_id: string } }> = [];
  for (const host of listHostDirs()) {
    for (const courseId of listCourseIdsForHost(host)) {
      const rows = readCourseFileAt(host, courseId);
      for (const [userId, record] of Object.entries(rows)) {
        out.push({ host, courseId, record: { ...record, user_id: userId } });
      }
    }
  }
  return out;
}

export function lookupByUserIdGlobal(
  userId: string | number
): { courseId: string; record: UserRecord } | null {
  const key = String(userId);
  const host = hostname();
  for (const courseId of listCourseIdsForHost(host)) {
    const vault = loadCourseVault(courseId);
    const rec = vault.byUserId.get(key);
    if (rec) return { courseId, record: rec };
  }
  return null;
}

export function globalCourseId(): string {
  return GLOBAL_COURSE;
}
