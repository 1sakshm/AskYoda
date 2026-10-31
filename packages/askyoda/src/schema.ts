/**
 * TinyFish `output_schema` support: the allowlist validator TinyFish applies, the conversion to
 * plain JSON Schema, and a small Draft-7 validator for that subset (so the package needs no
 * runtime dependencies). Mirrors apps/api/app/patch/schema.py and the verifier's use of
 * jsonschema.Draft7Validator.
 */

import { isPlainObject, pyDumps } from "./util.js";

export const TINYFISH_SCHEMA_KEYWORDS: ReadonlySet<string> = new Set([
  "anyOf",
  "enum",
  "format",
  "items",
  "maxItems",
  "maximum",
  "minItems",
  "minimum",
  "nullable",
  "properties",
  "propertyOrdering",
  "required",
  "type",
]);
export const TINYFISH_FORMATS: ReadonlySet<string> = new Set(["date", "date-time", "duration", "time"]);
const TINYFISH_TYPES = new Set(["object", "array", "string", "number", "integer", "boolean"]);
const MAX_SCHEMA_BYTES = 65536;
const MAX_SCHEMA_DEPTH = 10;

/** Python `repr()` for JSON-ish values, used in messages that quote values. */
export function pyRepr(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
    const body = value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
    return quote + (quote === "'" ? body.replace(/'/g, "\\'") : body) + quote;
  }
  if (Array.isArray(value)) return "[" + value.map(pyRepr).join(", ") + "]";
  if (isPlainObject(value)) {
    return "{" + Object.entries(value).map(([k, v]) => `${pyRepr(k)}: ${pyRepr(v)}`).join(", ") + "}";
  }
  return String(value);
}

/** Every reason TinyFish would reject `schema`; an empty list means it is valid. */
export function tinyfishSchemaErrors(schema: unknown): string[] {
  if (!isPlainObject(schema)) return ["#: schema must be a JSON object"];
  const errors: string[] = [];
  if ("type" in schema && schema.type !== "object") errors.push('#: top-level "type" must be "object"');
  if ("anyOf" in schema) {
    errors.push('#: top-level "anyOf" is not supported; put composition inside a field');
  }
  let size: number;
  try {
    size = pyDumps(schema).length;
  } catch {
    return [...errors, "#: schema is not JSON-serializable"];
  }
  if (size > MAX_SCHEMA_BYTES) errors.push(`#: schema is ${size} bytes; the limit is ${MAX_SCHEMA_BYTES}`);
  walk(schema, "#", 1, false, errors);
  return errors;
}

function walk(node: unknown, path: string, depth: number, inAnyOf: boolean, errors: string[]): void {
  if (typeof node === "boolean") {
    errors.push(`${path}: boolean schema nodes are not supported`);
    return;
  }
  if (!isPlainObject(node)) {
    errors.push(`${path}: schema node must be an object`);
    return;
  }
  if (depth > MAX_SCHEMA_DEPTH) {
    errors.push(`${path}: nesting depth exceeds ${MAX_SCHEMA_DEPTH}`);
    return;
  }
  for (const key of Object.keys(node)) {
    if (!TINYFISH_SCHEMA_KEYWORDS.has(key)) errors.push(`${path}: keyword "${key}" is not supported`);
  }

  let nodeType: unknown = node.type;
  if (Array.isArray(nodeType)) {
    errors.push(`${path}: type arrays are not supported; use "nullable": true`);
    nodeType = undefined;
  } else if (nodeType !== undefined && nodeType !== null && !TINYFISH_TYPES.has(String(nodeType))) {
    errors.push(`${path}: unknown type "${String(nodeType)}"`);
  }

  if ("enum" in node) {
    const values = node.enum;
    if (nodeType !== "string") errors.push(`${path}: "enum" requires "type": "string"`);
    else if (!Array.isArray(values) || !values.every((v) => typeof v === "string")) {
      errors.push(`${path}: every "enum" value must be a string`);
    }
  }
  if ("format" in node) {
    if (nodeType !== "string") errors.push(`${path}: "format" requires "type": "string"`);
    else if (!TINYFISH_FORMATS.has(String(node.format))) {
      errors.push(`${path}: format "${String(node.format)}" is not supported`);
    }
  }
  for (const key of ["items", "minItems", "maxItems"]) {
    if (key in node && nodeType !== "array") errors.push(`${path}: "${key}" requires "type": "array"`);
  }
  for (const key of ["minimum", "maximum"]) {
    if (key in node && nodeType !== "number" && nodeType !== "integer") {
      errors.push(`${path}: "${key}" requires "type": "number" or "integer"`);
    }
  }

  let properties: Record<string, unknown> | null = null;
  if (node.properties !== undefined && node.properties !== null) {
    if (!isPlainObject(node.properties)) {
      errors.push(`${path}: "properties" must be an object`);
    } else {
      properties = node.properties;
      for (const [name, sub] of Object.entries(properties)) {
        walk(sub, `${path}/properties/${name}`, depth + 1, false, errors);
      }
    }
  }

  if ("required" in node) {
    const required = node.required;
    if (!Array.isArray(required) || !required.every((r) => typeof r === "string")) {
      errors.push(`${path}: "required" must be a list of field names`);
    } else if (!inAnyOf) {
      const missing = required.filter((r) => !(properties && r in properties));
      if (missing.length) errors.push(`${path}: required fields not in "properties": ${pyRepr(missing)}`);
    }
  }

  if ("propertyOrdering" in node) {
    const ordering = node.propertyOrdering;
    if (properties === null) errors.push(`${path}: "propertyOrdering" requires "properties"`);
    else if (!Array.isArray(ordering) || new Set(ordering).size !== ordering.length) {
      errors.push(`${path}: "propertyOrdering" must be a list of unique names`);
    } else {
      const unknown = ordering.filter((p) => !(String(p) in properties!));
      if (unknown.length) {
        errors.push(`${path}: "propertyOrdering" names unknown fields: ${pyRepr(unknown)}`);
      }
    }
  }

  if ("items" in node) walk(node.items, `${path}/items`, depth + 1, false, errors);
  if ("anyOf" in node && path !== "#") {
    const branches = node.anyOf;
    if (!Array.isArray(branches) || branches.length === 0) {
      errors.push(`${path}: "anyOf" must be a non-empty list`);
    } else {
      branches.forEach((branch, i) => walk(branch, `${path}/anyOf/${i}`, depth + 1, true, errors));
    }
  }
}

/** TinyFish output_schema subset -> plain JSON Schema (`nullable` -> type union). */
export function toJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toJsonSchema);
  if (!isPlainObject(schema)) return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "nullable" || key === "propertyOrdering") continue;
    if (key === "properties" && isPlainObject(value)) {
      out[key] = Object.fromEntries(Object.entries(value).map(([n, sub]) => [n, toJsonSchema(sub)]));
    } else if (key === "items" || key === "anyOf") {
      out[key] = toJsonSchema(value);
    } else {
      out[key] = value;
    }
  }
  if (schema.nullable === true) {
    if (typeof out.type === "string") out.type = [out.type, "null"];
    if (Array.isArray(out.enum)) out.enum = [...out.enum, null];
  }
  return out;
}

// --- Draft-7 validation for the subset ------------------------------------------------------

export interface SchemaError {
  path: (string | number)[];
  message: string;
}

function isType(value: unknown, type: string): boolean {
  switch (type) {
    case "null":
      return value === null;
    case "boolean":
      return typeof value === "boolean";
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "array":
      return Array.isArray(value);
    case "object":
      return isPlainObject(value);
    default:
      return true;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function validateNode(value: unknown, schema: unknown, path: (string | number)[], out: SchemaError[]): void {
  if (schema === true || schema === undefined) return;
  if (schema === false) {
    out.push({ path, message: `False schema does not allow ${pyRepr(value)}` });
    return;
  }
  if (!isPlainObject(schema)) return;
  for (const [key, rule] of Object.entries(schema)) {
    switch (key) {
      case "type": {
        const types = Array.isArray(rule) ? rule.map(String) : [String(rule)];
        if (!types.some((t) => isType(value, t))) {
          out.push({ path, message: `${pyRepr(value)} is not of type ${types.map((t) => pyRepr(t)).join(", ")}` });
        }
        break;
      }
      case "properties":
        if (isPlainObject(value) && isPlainObject(rule)) {
          for (const [name, sub] of Object.entries(rule)) {
            if (name in value) validateNode(value[name], sub, [...path, name], out);
          }
        }
        break;
      case "required":
        if (isPlainObject(value) && Array.isArray(rule)) {
          for (const name of rule) {
            if (!(String(name) in value)) out.push({ path, message: `${pyRepr(name)} is a required property` });
          }
        }
        break;
      case "items":
        if (Array.isArray(value)) value.forEach((item, i) => validateNode(item, rule, [...path, i], out));
        break;
      case "enum":
        if (Array.isArray(rule) && !rule.some((v) => deepEqual(v, value))) {
          out.push({ path, message: `${pyRepr(value)} is not one of ${pyRepr(rule)}` });
        }
        break;
      case "minItems":
        if (Array.isArray(value) && typeof rule === "number" && value.length < rule) {
          out.push({ path, message: `${pyRepr(value)} is too short` });
        }
        break;
      case "maxItems":
        if (Array.isArray(value) && typeof rule === "number" && value.length > rule) {
          out.push({ path, message: `${pyRepr(value)} is too long` });
        }
        break;
      case "minimum":
        if (typeof value === "number" && typeof rule === "number" && value < rule) {
          out.push({ path, message: `${pyRepr(value)} is less than the minimum of ${pyRepr(rule)}` });
        }
        break;
      case "maximum":
        if (typeof value === "number" && typeof rule === "number" && value > rule) {
          out.push({ path, message: `${pyRepr(value)} is greater than the maximum of ${pyRepr(rule)}` });
        }
        break;
      case "anyOf":
        if (Array.isArray(rule)) {
          const ok = rule.some((branch) => {
            const errs: SchemaError[] = [];
            validateNode(value, branch, path, errs);
            return errs.length === 0;
          });
          if (!ok) out.push({ path, message: `${pyRepr(value)} is not valid under any of the given schemas` });
        }
        break;
      default:
        break; // format and annotations are not asserted (as with Draft7Validator's defaults)
    }
  }
}

/** Errors for `value` against a plain JSON Schema, sorted by path like the Python verifier. */
export function validateJsonSchema(value: unknown, schema: unknown): SchemaError[] {
  const out: SchemaError[] = [];
  validateNode(value, schema, [], out);
  const key = (e: SchemaError) => e.path.map(String);
  return out
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const ka = key(a.e);
      const kb = key(b.e);
      for (let j = 0; j < Math.min(ka.length, kb.length); j++) {
        if (ka[j] !== kb[j]) return ka[j] < kb[j] ? -1 : 1;
      }
      return ka.length - kb.length || a.i - b.i;
    })
    .map(({ e }) => e);
}
