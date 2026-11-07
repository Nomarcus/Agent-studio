/**
 * Parse OpenAPI 3.x documents (JSON or YAML) and list operations.
 * YAML is handled by vendored js-yaml (safe by default in v4).
 */
import yaml from "../vendor/js-yaml.esm.js";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];

export function parseOpenApi(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return { ok: false, error: "Empty document", spec: null };
  }
  let spec;
  try {
    if (raw.startsWith("{") || raw.startsWith("[")) {
      spec = JSON.parse(raw);
    } else {
      spec = yaml.load(raw);
    }
  } catch (err) {
    return { ok: false, error: `Could not parse OpenAPI: ${err.message || err}`, spec: null };
  }
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    return { ok: false, error: "OpenAPI document must be an object", spec: null };
  }
  const version = String(spec.openapi || spec.swagger || "");
  if (!version.startsWith("3.")) {
    return {
      ok: false,
      error: version
        ? `Unsupported OpenAPI version "${version}". Agent Studio accepts OpenAPI 3.x.`
        : "Document is missing an openapi: 3.x version field.",
      spec: null,
    };
  }
  return { ok: true, error: null, spec };
}

export function sanitizeFunctionName(id, fallback = "operation") {
  let s = String(id || fallback).replace(/[^A-Za-z0-9_-]/g, "_");
  if (!s) s = fallback;
  if (!/^[A-Za-z]/.test(s)) s = `op_${s}`;
  return s.slice(0, 64);
}

export function namespaceFromName(name) {
  const s = String(name || "plugin")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9-]+/g, "")
    .slice(0, 32);
  return s || "plugin";
}

export function listOperations(spec) {
  const ops = [];
  const paths = spec?.paths || {};
  const seen = new Map();
  for (const [path, item] of Object.entries(paths)) {
    if (!item || typeof item !== "object") continue;
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!op || typeof op !== "object") continue;
      const generated = `${method}_${String(path).replace(/[^A-Za-z0-9]/g, "_")}`;
      let operationId = sanitizeFunctionName(op.operationId || generated);
      const count = seen.get(operationId) || 0;
      seen.set(operationId, count + 1);
      if (count > 0) operationId = sanitizeFunctionName(`${operationId}_${count + 1}`);
      ops.push({
        operationId,
        originalOperationId: op.operationId || "",
        method: method.toUpperCase(),
        path,
        summary: op.summary || "",
        description: (op.description || op.summary || "").trim(),
        tags: Array.isArray(op.tags) ? op.tags : [],
      });
    }
  }
  return ops;
}

/**
 * Ensure every selected (or all) operations have a legal operationId in the
 * spec that matches the plugin function name.
 */
export function ensureOperationIds(spec, operations) {
  const next = JSON.parse(JSON.stringify(spec));
  const byKey = new Map(operations.map((op) => [`${op.method}:${op.path}`, op]));
  for (const [path, item] of Object.entries(next.paths || {})) {
    if (!item || typeof item !== "object") continue;
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!op) continue;
      const listed = byKey.get(`${method.toUpperCase()}:${path}`);
      if (listed) op.operationId = listed.operationId;
    }
  }
  return next;
}

export function dumpOpenApiYaml(spec) {
  return yaml.dump(spec, {
    noRefs: true,
    lineWidth: 100,
    quotingType: '"',
    forceQuotes: false,
  });
}

export function parseAndList(text) {
  const parsed = parseOpenApi(text);
  if (!parsed.ok) return { ...parsed, operations: [] };
  return { ...parsed, operations: listOperations(parsed.spec) };
}
