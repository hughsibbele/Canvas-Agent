/**
 * Thin wrapper around the Canvas REST API with automatic pagination.
 */

import {
  anonymizeResponse,
  extractCourseIdFromPath,
  isAnonymizationEnabled,
} from "./anonymizer.js";

const BASE_URL = process.env.CANVAS_API_URL;
const TOKEN = process.env.CANVAS_API_TOKEN;

if (!BASE_URL || !TOKEN) {
  throw new Error(
    "Missing CANVAS_API_URL or CANVAS_API_TOKEN environment variables.\n" +
      "Copy .env.example to .env and fill in your values."
  );
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

/** Parse Canvas Link header to find the "next" page URL. */
function getNextUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}

/** Retry a fetch after a delay (for rate-limit backoff). */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = 3
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, init);
    if (res.status === 429 && attempt < retries) {
      const retryAfter = res.headers.get("retry-after");
      const delay = retryAfter ? Number(retryAfter) * 1000 : 1000 * (attempt + 1);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    return res;
  }
  throw new Error("Unreachable");
}

/** Single API call — returns parsed JSON. */
export async function canvas(
  path: string,
  options?: RequestInit
): Promise<any> {
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
  const res = await fetchWithRetry(url, {
    ...options,
    headers: authHeaders(options?.headers as Record<string, string>),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Canvas API ${res.status} ${res.statusText}: ${body}`);
  }

  // Some endpoints (DELETE) return 204 with no body
  if (res.status === 204) return { success: true };
  const data = await res.json();
  if (isAnonymizationEnabled()) {
    return anonymizeResponse(data, extractCourseIdFromPath(path));
  }
  return data;
}

/**
 * Auto-paginated GET — follows Link: <...>; rel="next" headers
 * and returns all results as a flat array.
 * Canvas defaults to 10 items per page; we request 100.
 *
 * Param values may be a string or an array of strings. Arrays are emitted
 * as repeated keys, which Canvas requires for `include[]`, `state[]`, etc.
 */
export async function canvasAll(
  path: string,
  params?: Record<string, string | string[]>
): Promise<any[]> {
  const sep = path.includes("?") ? "&" : "?";
  const qs = new URLSearchParams();
  qs.append("per_page", "100");
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value)) {
        for (const v of value) qs.append(key, v);
      } else {
        qs.append(key, value);
      }
    }
  }
  let url: string | null = `${BASE_URL}${path}${sep}${qs.toString()}`;
  const results: any[] = [];
  const courseId = extractCourseIdFromPath(path);
  const anon = isAnonymizationEnabled();

  while (url) {
    const res = await fetchWithRetry(url, { headers: authHeaders() });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Canvas API ${res.status}: ${body}`);
    }
    const raw = await res.json();
    const data = anon ? anonymizeResponse(raw, courseId) : raw;
    results.push(...(Array.isArray(data) ? data : [data]));
    url = getNextUrl(res.headers.get("link"));
  }

  return results;
}

/**
 * Download a file from a Canvas-returned URL and return its bytes.
 * Submission attachments come back as full URLs (often pre-signed S3/CDN
 * links), so we centralize the fetch here to share auth, retry, and error
 * handling with the rest of the client.
 */
export async function fetchCanvasFile(url: string): Promise<Buffer> {
  const res = await fetchWithRetry(url, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`Canvas file fetch ${res.status} ${res.statusText}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Summarize an assignment/discussion/quiz to reduce token usage. */
export function summarizeItem(item: any) {
  return {
    id: item.id,
    name: item.name ?? item.title,
    due_at: item.due_at,
    unlock_at: item.unlock_at,
    lock_at: item.lock_at,
    points_possible: item.points_possible,
    submission_types: item.submission_types,
    published: item.published,
    assignment_group_id: item.assignment_group_id,
    html_url: item.html_url,
  };
}
