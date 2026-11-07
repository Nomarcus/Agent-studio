import { clip, hasNonWhitespace } from "./util.js";
import {
  parseAndList,
  ensureOperationIds,
  dumpOpenApiYaml,
  namespaceFromName,
  sanitizeFunctionName,
} from "./openapi.js";
import { JIRA_CLOUD_OPENAPI_YAML } from "./samples/jira-cloud.js";

export const PLUGIN_SCHEMA_URL =
  "https://developer.microsoft.com/json-schemas/copilot/plugin/v2.4/schema.json";

export const AUTH_TYPES = ["None", "OAuthPluginVault", "ApiKeyPluginVault"];

export const JIRA_OPERATION_META = {
  searchIssues: {
    description:
      "Search Jira Cloud issues with JQL. Use when the user wants matching tickets rather than one known key.",
    dataPath: "$.issues",
    titlePath: "$.key",
    subtitlePath: "$.fields.summary",
    urlPath: "$.self",
    includeCard: true,
    confirm: false,
    dataHandling: ["GetPrivateData"],
    confirmationTitle: "",
    confirmationBody: "",
  },
  getIssue: {
    description:
      "Fetch a single Jira issue by key (for example INT-1842) or numeric id, including summary, status and comments when requested.",
    dataPath: "$",
    titlePath: "$.key",
    subtitlePath: "$.fields.summary",
    urlPath: "$.self",
    includeCard: true,
    confirm: false,
    dataHandling: ["GetPrivateData"],
    confirmationTitle: "",
    confirmationBody: "",
  },
  addComment: {
    description:
      "Add a comment to a Jira issue. The body must be Atlassian Document Format. Confirm before posting and never invent facts.",
    dataPath: "$",
    titlePath: "$.id",
    subtitlePath: "$.created",
    urlPath: "$.self",
    includeCard: true,
    confirm: true,
    dataHandling: ["ResourceStateUpdate"],
    confirmationTitle: "Add Jira comment",
    confirmationBody: "Post this comment to the Jira issue?",
  },
};

export function emptyActionMeta() {
  return {
    description: "",
    dataPath: "$",
    titlePath: "",
    subtitlePath: "",
    urlPath: "",
    includeCard: true,
    confirm: false,
    dataHandling: [],
    confirmationTitle: "",
    confirmationBody: "",
  };
}

export function defaultActions() {
  return {
    enabled: false,
    id: "apiPlugin",
    nameForHuman: "",
    descriptionForHuman: "",
    descriptionForModel: "",
    namespace: "",
    specUrl: "openapi.yaml",
    specText: "",
    specSource: "",
    authType: "None",
    authReferenceId: "",
    selectedOps: [],
    operationMeta: {},
  };
}

export function mergeActions(base = {}, extra = {}) {
  return {
    ...defaultActions(),
    ...base,
    ...extra,
    operationMeta: { ...(base.operationMeta || {}), ...(extra.operationMeta || {}) },
    selectedOps: extra.selectedOps ? [...extra.selectedOps] : [...(base.selectedOps || [])],
  };
}

export function createJiraCloudActions(overrides = {}) {
  return mergeActions(
    {
      enabled: true,
      id: "jiraCloud",
      nameForHuman: "Jira Cloud",
      descriptionForHuman: "Search, read and comment on Jira Cloud issues.",
      descriptionForModel:
        "Use this plugin whenever the user mentions a Jira ticket key (for example INT-1842), asks to search Jira, or wants a comment posted on an issue. Call searchIssues for JQL lists, getIssue for a known key, and addComment only after the user confirms the wording. Do not invent issue keys, field values or comments.",
      namespace: "jira",
      specUrl: "openapi.yaml",
      specText: JIRA_CLOUD_OPENAPI_YAML,
      specSource: "jira",
      authType: "ApiKeyPluginVault",
      authReferenceId: "jira-api-key",
      selectedOps: ["searchIssues", "getIssue", "addComment"],
      operationMeta: { ...JIRA_OPERATION_META },
    },
    overrides
  );
}

export function defaultCardFor(op) {
  const titleExpr =
    op.operationId === "searchIssues" || op.operationId === "getIssue"
      ? "${if(key, key, 'Issue')}"
      : op.operationId === "addComment"
        ? "${if(id, id, 'Comment')}"
        : "${if(key, key, if(name, name, if(id, string(id), 'Result')))}";
  const subExpr =
    op.operationId === "searchIssues" || op.operationId === "getIssue"
      ? "${if(fields.summary, fields.summary, '')}"
      : op.operationId === "addComment"
        ? "${if(created, created, '')}"
        : "${if(fields.summary, fields.summary, if(summary, summary, if(message, message, '')))}";
  return {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.5",
    body: [
      { type: "TextBlock", text: titleExpr, weight: "Bolder", size: "Medium", wrap: true },
      { type: "TextBlock", text: subExpr, isSubtle: true, wrap: true },
    ],
  };
}

function metaFor(project, op) {
  const stored = project.actions?.operationMeta?.[op.operationId] || {};
  const preset = JIRA_OPERATION_META[op.operationId] || emptyActionMeta();
  return { ...emptyActionMeta(), ...preset, ...stored };
}

function buildFunction(project, op) {
  const meta = metaFor(project, op);
  const description = (meta.description || op.description || op.summary || op.operationId).trim();
  const fn = {
    name: sanitizeFunctionName(op.operationId),
    description: clip(description, 4000),
  };
  const caps = {};
  const dataPath = (meta.dataPath || "$").trim() || "$";
  const properties = {};
  if ((meta.titlePath || "").trim()) properties.title = meta.titlePath.trim();
  if ((meta.subtitlePath || "").trim()) properties.subtitle = meta.subtitlePath.trim();
  if ((meta.urlPath || "").trim()) properties.url = meta.urlPath.trim();
  const semantics = { data_path: dataPath };
  if (Object.keys(properties).length) semantics.properties = properties;
  if (meta.includeCard !== false) semantics.static_template = defaultCardFor(op);
  caps.response_semantics = semantics;
  if (meta.confirm) {
    caps.confirmation = {
      type: "AdaptiveCard",
      title: clip((meta.confirmationTitle || `Run ${op.operationId}`).trim(), 4000),
      body: clip((meta.confirmationBody || `Call ${op.operationId}?`).trim(), 4000),
    };
  } else if ((op.method || "").toUpperCase() === "GET") {
    caps.confirmation = {
      type: "None",
      isNonConsequential: true,
    };
  }
  const handling = Array.isArray(meta.dataHandling) ? meta.dataHandling.filter(Boolean) : [];
  if (handling.length) caps.security_info = { data_handling: handling };
  fn.capabilities = caps;
  return fn;
}

export function buildApiPlugin(project) {
  const a = project?.actions || {};
  const parsed = parseAndList(a.specText || "");
  if (!parsed.ok) {
    return { ok: false, error: parsed.error, plugin: null, openapi: null, openapiText: "", operations: [] };
  }
  const selected = new Set((a.selectedOps || []).map(String));
  let operations = parsed.operations;
  if (selected.size) {
    operations = operations.filter((op) => selected.has(op.operationId));
  }
  if (!operations.length) {
    return {
      ok: false,
      error: "No operations selected",
      plugin: null,
      openapi: parsed.spec,
      openapiText: "",
      operations: parsed.operations,
    };
  }
  const openapi = ensureOperationIds(parsed.spec, parsed.operations);
  const name = clip((a.nameForHuman || parsed.spec.info?.title || project.name || "API plugin").trim(), 100);
  const human = clip(
    (a.descriptionForHuman || parsed.spec.info?.description || project.description || "API plugin for this agent.").trim(),
    500
  );
  const model = clip((a.descriptionForModel || human).trim(), 4000);
  const namespace = (a.namespace || namespaceFromName(name)).trim() || "plugin";
  const functions = operations.map((op) => buildFunction(project, op));
  const authType = AUTH_TYPES.includes(a.authType) ? a.authType : "None";
  const auth = { type: authType };
  if (authType === "OAuthPluginVault" || authType === "ApiKeyPluginVault") {
    auth.reference_id = String(a.authReferenceId || "").trim();
  }
  const plugin = {
    $schema: PLUGIN_SCHEMA_URL,
    schema_version: "v2.4",
    name_for_human: name,
    namespace,
    description_for_human: clip(human, 100) || name,
    description_for_model: model,
    functions,
    runtimes: [
      {
        type: "OpenApi",
        auth,
        spec: { url: a.specUrl || "openapi.yaml" },
        run_for_functions: functions.map((f) => f.name),
      },
    ],
  };
  if (hasNonWhitespace(project.app?.privacyUrl)) {
    plugin.privacy_policy_url = project.app.privacyUrl.trim();
  }
  if (hasNonWhitespace(project.app?.termsOfUseUrl)) {
    plugin.legal_info_url = project.app.termsOfUseUrl.trim();
  }
  const openapiText = dumpOpenApiYaml(openapi);
  return { ok: true, error: null, plugin, openapi, openapiText, operations: parsed.operations, selected: operations };
}

export { JIRA_CLOUD_OPENAPI_YAML };
