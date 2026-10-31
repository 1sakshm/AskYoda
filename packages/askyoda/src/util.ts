/** Small shared helpers (ports of the Python originals, kept behaviour-identical). */

export const DETAIL_MAX = 200;

/** Collapse whitespace and cut to `limit` characters with an ellipsis. */
export function cut(text: string, limit = DETAIL_MAX): string {
  const flat = text.split(/\s+/).filter(Boolean).join(" ");
  return flat.length <= limit ? flat : flat.slice(0, limit - 1) + "…";
}

/**
 * `json.dumps(value, ensure_ascii=False)` from Python: `", "` and `": "` separators. Used wherever
 * the original scans or quotes serialized results, so evidence text matches exactly.
 */
export function pyDumps(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return "[" + value.map(pyDumps).join(", ") + "]";
  if (typeof value === "object") {
    return (
      "{" +
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${JSON.stringify(k)}: ${pyDumps(v)}`)
        .join(", ") +
      "}"
    );
  }
  return JSON.stringify(String(value));
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Dot path lookup; all-digit segments index lists (`products.0.name`). */
export function getPath(obj: unknown, path: string): [boolean, unknown] {
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (Array.isArray(cur) && /^\d+$/.test(seg) && Number(seg) < cur.length) {
      cur = cur[Number(seg)];
    } else if (isPlainObject(cur) && Object.prototype.hasOwnProperty.call(cur, seg)) {
      cur = cur[seg];
    } else {
      return [false, null];
    }
  }
  return [true, cur];
}

export function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) return Object.keys(value).length === 0;
  return false;
}

/** True when every leaf of a JSON value is empty (null, "", [] or {}). */
export function allEmpty(value: unknown): boolean {
  if (isPlainObject(value)) {
    const vals = Object.values(value);
    return vals.length ? vals.every(allEmpty) : true;
  }
  if (Array.isArray(value)) return value.length ? value.every(allEmpty) : true;
  return isEmpty(value);
}

export function deepCopy<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

export const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function nowIso(): string {
  return new Date().toISOString();
}

/** Case-insensitive regex search built from a user's pattern (Python `re.search(p, s, re.I)`). */
export function searchI(pattern: string, text: string): boolean {
  return new RegExp(pattern, "i").test(text);
}
