import { clip, LIMITS, hasNonWhitespace, initialsFromName } from "./util.js";
import { bytesToDataUrl } from "./icons.js";
import { compileInstructions, syncDerivedFields } from "./model.js";
import { buildApiPlugin } from "./plugin.js";
import { compileSkillMarkdown, parseSkillMarkdown, deriveAgentSkills, parseCompiledInstructions } from "./skillmd.js";

const DA_SCHEMA_URL = "https://developer.microsoft.com/json-schemas/copilot/declarative-agent/v1.9/schema.json";
const TEAMS_SCHEMA_URL = "https://developer.microsoft.com/json-schemas/teams/v1.29/MicrosoftTeams.schema.json";

function cleanList(values) {
  return (values || []).map((v) => String(v || "").trim()).filter(Boolean);
}

export function buildCapabilities(project) {
  const caps = [];
  const c = project.capabilities || {};

  if (c.WebSearch?.enabled) {
    const cap = { name: "WebSearch" };
    const sites = cleanList(c.WebSearch.sites).slice(0, LIMITS.WEBSEARCH_SITES);
    if (sites.length) cap.sites = sites.map((url) => ({ url }));
    caps.push(cap);
  }
  if (c.OneDriveAndSharePoint?.enabled) {
    const cap = { name: "OneDriveAndSharePoint" };
    const urls = cleanList(c.OneDriveAndSharePoint.urls);
    if (urls.length) cap.items_by_url = urls.map((url) => ({ url }));
    caps.push(cap);
  }
  if (c.GraphConnectors?.enabled) {
    const cap = { name: "GraphConnectors" };
    const ids = cleanList(c.GraphConnectors.connectionIds);
    if (ids.length) cap.connections = ids.map((connection_id) => ({ connection_id }));
    caps.push(cap);
  }
  if (c.CodeInterpreter?.enabled) caps.push({ name: "CodeInterpreter" });
  if (c.GraphicArt?.enabled) caps.push({ name: "GraphicArt" });
  if (c.Email?.enabled) {
    const cap = { name: "Email" };
    if ((c.Email.sharedMailbox || "").trim()) cap.shared_mailbox = c.Email.sharedMailbox.trim();
    const folders = cleanList(c.Email.folders);
    if (folders.length) cap.folders = folders.map((folder_id) => ({ folder_id }));
    const groups = cleanList(c.Email.groupMailboxes).slice(0, 25);
    if (groups.length) cap.group_mailboxes = groups;
    caps.push(cap);
  }
  if (c.EmailActions?.enabled) caps.push({ name: "EmailActions" });
  if (c.People?.enabled) {
    const cap = { name: "People" };
    if (c.People.includeRelatedContent) cap.include_related_content = true;
    caps.push(cap);
  }
  if (c.TeamsMessages?.enabled) {
    const cap = { name: "TeamsMessages" };
    const urls = cleanList(c.TeamsMessages.urls).slice(0, LIMITS.TEAMS_URLS);
    if (urls.length) cap.urls = urls.map((url) => ({ url }));
    caps.push(cap);
  }
  if (c.Meetings?.enabled) caps.push({ name: "Meetings" });
  if (c.MeetingActions?.enabled) caps.push({ name: "MeetingActions" });
  if (c.Dataverse?.enabled) {
    const cap = { name: "Dataverse" };
    const host = (c.Dataverse.hostName || "").trim();
    const skill = (c.Dataverse.skill || "").trim();
    const tables = cleanList(c.Dataverse.tables);
    if (host || skill || tables.length) {
      const source = {};
      if (host) source.host_name = host;
      if (skill) source.skill = skill;
      if (tables.length) source.tables = tables.map((table_name) => ({ table_name }));
      cap.knowledge_sources = [source];
    }
    caps.push(cap);
  }
  if (c.Fabric?.enabled) caps.push({ name: "Fabric" });
  if (c.ScenarioModels?.enabled) {
    const cap = { name: "ScenarioModels" };
    const ids = cleanList(c.ScenarioModels.modelIds);
    if (ids.length) cap.models = ids.map((id) => ({ id }));
    caps.push(cap);
  }
  if (c.EmbeddedKnowledge?.enabled) {
    const fromCap = (c.EmbeddedKnowledge.files || []).map((f) => (typeof f === "string" ? f : f?.file || f?.name));
    const fromEmbedded = (project.embeddedFiles || []).map((f) => f?.file || f?.name).filter(Boolean);
    const files = cleanList([...fromEmbedded, ...fromCap]);
    // de-dupe preserving order
    const seen = new Set();
    const unique = [];
    for (const file of files) {
      if (seen.has(file)) continue;
      seen.add(file);
      unique.push(file);
    }
    if (unique.length) {
      caps.push({
        name: "EmbeddedKnowledge",
        files: unique.slice(0, LIMITS.EMBEDDED_FILES).map((file) => ({ file })),
      });
    }
  }
  return caps;
}

export function buildConversationStarters(project) {
  const starters = (project.conversationStarters || [])
    .map((s) => ({
      title: (s.title || "").trim(),
      text: (s.text || "").trim(),
    }))
    .filter((s) => hasNonWhitespace(s.text))
    .slice(0, LIMITS.STARTERS)
    .map((s) => {
      const item = { text: clip(s.text, 4000) };
      if (hasNonWhitespace(s.title)) item.title = clip(s.title, 4000);
      return item;
    });
  return starters;
}

export function buildDeclarativeAgent(project) {
  const p = syncDerivedFields(project);
  const instructions = compileInstructions(p);
  const da = {
    $schema: DA_SCHEMA_URL,
    version: "v1.9",
    id: p.id,
    name: clip((p.name || "").trim(), LIMITS.DA_NAME),
    description: clip((p.description || "").trim(), LIMITS.DA_DESCRIPTION),
  };
  if (hasNonWhitespace(instructions)) {
    da.instructions = clip(instructions, LIMITS.DA_INSTRUCTIONS);
  }
  const starters = buildConversationStarters(p);
  if (starters.length) da.conversation_starters = starters;
  const caps = buildCapabilities(p);
  if (caps.length) da.capabilities = caps;
  if (p.actions?.enabled) {
    da.actions = [
      {
        id: (p.actions.id || "apiPlugin").trim() || "apiPlugin",
        file: "plugin.json",
      },
    ];
  }
  if (hasNonWhitespace(p.disclaimer)) {
    da.disclaimer = { text: clip(p.disclaimer.trim(), LIMITS.DISCLAIMER) };
  }
  const behavior = p.behavior || {};
  const overrides = {};
  if (behavior.discourageModelKnowledge) {
    overrides.special_instructions = { discourage_model_knowledge: true };
  }
  if (behavior.disableSuggestions) {
    overrides.suggestions = { disabled: true };
  }
  if (behavior.defaultResponseMode && behavior.defaultResponseMode !== "Auto") {
    overrides.default_response_mode = behavior.defaultResponseMode;
  }
  if (Object.keys(overrides).length) da.behavior_overrides = overrides;

  const sensId = (p.sensitivityLabelId || "").trim();
  if (sensId) da.sensitivity_label = { id: sensId };

  const workers = (p.workerAgents || [])
    .map((w) => {
      const id = (w?.id || "").trim();
      const file = (w?.file || "").trim();
      if (id) return { id };
      if (file) return { file };
      return null;
    })
    .filter(Boolean);
  if (workers.length) da.worker_agents = workers;

  const overrideCaps = (p.userOverrideCaps || []).map((n) => String(n || "").trim()).filter(Boolean);
  if (overrideCaps.length) {
    da.user_overrides = overrideCaps.map((name) => ({
      path: `$.capabilities[?(@.name == '${name}')]`,
      allowed_actions: ["remove"],
    }));
  }

  const answers = (p.editorialAnswers || [])
    .map((a) => ({
      question: (a.question || "").trim(),
      answer: (a.answer || "").trim(),
    }))
    .filter((a) => a.question && a.answer)
    .slice(0, 300);
  if (answers.length) da.editorial_answers = { answers };

  const skills = deriveAgentSkills(p)
    .map((s) => {
      const folder = (s.folder || "").trim().replace(/^\/+/, "").replace(/\\/g, "/");
      if (!folder || folder.includes("..")) return null;
      return { folder: folder.startsWith("./") ? folder : `./${folder}` };
    })
    .filter(Boolean)
    .slice(0, LIMITS.AGENT_SKILLS);
  if (skills.length) da.agent_skills = skills;

  return da;
}

export function buildTeamsManifest(project) {
  const p = syncDerivedFields(project);
  const shortName = clip((p.app.shortName || p.name || "Agent").trim(), LIMITS.APP_SHORT_NAME);
  const fullName = clip((p.name || shortName).trim(), LIMITS.APP_FULL_NAME);
  const shortDesc = clip((p.app.shortDescription || p.description || "Declarative agent").trim(), LIMITS.APP_SHORT_DESC);
  const fullDesc = clip((p.description || shortDesc).trim(), LIMITS.APP_FULL_DESC);
  return {
    $schema: TEAMS_SCHEMA_URL,
    manifestVersion: "1.29",
    version: p.app.version || "1.0.0",
    id: p.app.id,
    developer: {
      name: clip((p.app.developerName || "Developer").trim(), LIMITS.DEVELOPER_NAME),
      websiteUrl: (p.app.websiteUrl || "").trim(),
      privacyUrl: (p.app.privacyUrl || "").trim(),
      termsOfUseUrl: (p.app.termsOfUseUrl || "").trim(),
    },
    name: {
      short: shortName,
      full: fullName,
    },
    description: {
      short: shortDesc,
      full: fullDesc,
    },
    icons: {
      color: "color.png",
      outline: "outline.png",
    },
    accentColor: p.app.accentColor || "#1F4E79",
    copilotAgents: {
      declarativeAgents: [
        {
          id: "declarativeAgent",
          file: "declarativeAgent.json",
        },
      ],
    },
  };
}

export function buildPluginStub(project) {
  return buildApiPlugin(project);
}

export function buildInstructionFile(project) {
  return compileInstructions(project);
}

/**
 * Build the file map for a sideloadable app package.
 * iconPngs: { color: Uint8Array, outline: Uint8Array }
 */
export function buildPackageFiles(project, iconPngs = {}) {
  const da = buildDeclarativeAgent(project);
  const manifest = buildTeamsManifest(project);
  const instructions = buildInstructionFile(project);
  const files = {
    "manifest.json": JSON.stringify(manifest, null, 2),
    "declarativeAgent.json": JSON.stringify(da, null, 2),
    "instruction.txt": instructions || "",
  };
  if (project.actions?.enabled) {
    const built = buildApiPlugin(project);
    if (built.ok && built.plugin) {
      files["plugin.json"] = JSON.stringify(built.plugin, null, 2);
      const specName = (project.actions.specUrl || "openapi.yaml").trim() || "openapi.yaml";
      files[specName] = built.openapiText || stringifyMinimalYaml(built.openapi);
    }
  }
  const custom = customIconBytes(project);
  const color = iconPngs.color || custom.color;
  const outline = iconPngs.outline || custom.outline;
  if (color) files["color.png"] = color;
  if (outline) files["outline.png"] = outline;

  for (const emb of project.embeddedFiles || []) {
    const name = (emb?.file || "").trim().replace(/^\/+/, "");
    if (!name || name.includes("..") || name.includes("\\") || name.includes("/")) continue;
    if (emb.contentBase64) {
      try {
        files[name] = base64ToBytes(emb.contentBase64);
      } catch {
        /* skip corrupt */
      }
    }
  }

  for (const skill of deriveAgentSkills(project)) {
    const folder = (skill.folder || "").trim().replace(/^\.\//, "").replace(/^\/+/, "").replace(/\\/g, "/");
    if (!folder || folder.includes("..")) continue;
    files[`${folder}/SKILL.md`] = compileSkillMarkdown({ ...skill, folder });
  }

  return { files, da, manifest, instructions };
}

export function base64ToBytes(b64) {
  const cleaned = String(b64).replace(/^data:[^;]+;base64,/, "");
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(cleaned, "base64"));
  const bin = atob(cleaned);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function yamlEscape(s) {
  const t = String(s).replace(/"/g, '\\"');
  if (/[:#\n&*!%>@`'"{}\[\],]|^\s|\s$/.test(t)) return `"${t}"`;
  return t;
}

export async function buildZip(project, iconPngs, JSZipImpl) {
  const JSZip = JSZipImpl || (await loadJSZip());
  const { files, da, manifest, instructions } = buildPackageFiles(project, iconPngs);
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content);
  }
  const bytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  return { bytes, files, da, manifest, instructions };
}

async function loadJSZip() {
  const mod = await import("../vendor/jszip.esm.js");
  return mod.default || mod.JSZip;
}

export async function importPackageZip(bytes, JSZipImpl) {
  const JSZip = JSZipImpl || (await loadJSZip());
  const zip = await JSZip.loadAsync(bytes);
  const readText = async (name) => {
    const file = zip.file(name) || zip.file(new RegExp(`(^|/)${name.replace(".", "\\.")}$`))?.[0];
    if (!file) return null;
    return file.async("string");
  };
  const readBytes = async (name) => {
    const file = zip.file(name);
    return file ? file.async("uint8array") : null;
  };

  let manifestRaw = await readText("manifest.json");
  if (!manifestRaw) {
    const candidates = Object.keys(zip.files).filter((n) => n.endsWith("manifest.json") && !zip.files[n].dir);
    if (candidates[0]) manifestRaw = await zip.file(candidates[0]).async("string");
  }
  if (!manifestRaw) {
    throw new Error("ZIP saknar manifest.json");
  }
  const manifest = JSON.parse(manifestRaw);
  const daRef = manifest?.copilotAgents?.declarativeAgents?.[0]?.file || "declarativeAgent.json";
  const daPath = normalizeZipPath(daRef);
  const daRaw = await readText(daPath);
  if (!daRaw) throw new Error(`ZIP saknar ${daPath}`);
  let da = JSON.parse(daRaw);

  if (typeof da.instructions === "string") {
    const fileRef = da.instructions.match(/^\$\[file\(['"](.+?)['"]\)\]$/);
    if (fileRef) {
      const instr = await readText(fileRef[1]);
      if (instr != null) da = { ...da, instructions: instr };
    }
  }
  const instructionFile = (await readText("instruction.txt")) || da.instructions || "";
  const color = (await readBytes(manifest?.icons?.color || "color.png")) || null;
  const outline = (await readBytes(manifest?.icons?.outline || "outline.png")) || null;

  let plugin = null;
  const pluginRaw = await readText("plugin.json");
  if (pluginRaw) {
    try { plugin = JSON.parse(pluginRaw); } catch { plugin = null; }
  }
  const pluginSpecUrl = plugin?.runtimes?.[0]?.spec?.url || "openapi.yaml";
  const openapiText = (await readText(normalizeZipPath(pluginSpecUrl))) || (await readText("openapi.yaml")) || (await readText("openapi.json")) || "";

  const skillFiles = {};
  for (const name of Object.keys(zip.files)) {
    if (zip.files[name].dir) continue;
    const norm = name.replace(/^\.\//, "");
    if (norm.endsWith("/SKILL.md") || norm === "SKILL.md") {
      skillFiles[norm] = await zip.file(name).async("string");
    }
  }

  return { manifest, da, instructionFile, icons: { color, outline }, rawFiles: Object.keys(zip.files), plugin, openapiText, skillFiles };
}

function normalizeZipPath(p) {
  return String(p || "").replace(/^\.\//, "").replace(/\\/g, "/");
}

/** Icons that came with an imported package (kept so re-export does not replace a real logo). */
export function customIconBytes(project) {
  const out = {};
  try {
    if (project?.icons?.customColor) out.color = base64ToBytes(project.icons.customColor);
    if (project?.icons?.customOutline) out.outline = base64ToBytes(project.icons.customOutline);
  } catch {
    /* ignore corrupt data */
  }
  return out;
}

export function applyImportedToProject(baseProject, { manifest, da, instructionFile, plugin, openapiText, skillFiles, icons } = {}) {
  const p = syncDerivedFields(baseProject);
  p.name = da.name || manifest?.name?.full || manifest?.name?.short || p.name;
  p.icons.initials = initialsFromName(p.name);
  p.testPrompts = [];
  if (icons?.color?.length) p.icons.customColor = bytesToDataUrl(icons.color);
  if (icons?.outline?.length) p.icons.customOutline = bytesToDataUrl(icons.outline);
  p.description = da.description || manifest?.description?.full || p.description;
  const rawInstructions = instructionFile || da.instructions || "";
  p.instructionsRaw = rawInstructions;
  p.role = "";
  p.style = "";
  p.skills = [];
  p.guardrails = "";
  p.instructionsMode = "raw";
  // If the text was generated by Agent Studio, restore the structured cookbook.
  const parsed = parseCompiledInstructions(rawInstructions);
  if (parsed) {
    const candidate = { ...p, instructionsMode: "structured", role: parsed.role, style: parsed.style, skills: parsed.skills, guardrails: parsed.guardrails };
    if (compileInstructions(candidate) === rawInstructions.replace(/\r\n/g, "\n").trim()) {
      Object.assign(p, { instructionsMode: "structured", role: parsed.role, style: parsed.style, skills: parsed.skills, guardrails: parsed.guardrails });
    }
  }
  if (da.id) p.id = da.id;
  if (manifest?.id) p.app.id = manifest.id;
  if (manifest?.version) p.app.version = manifest.version;
  if (manifest?.name?.short) p.app.shortName = manifest.name.short;
  if (manifest?.description?.short) p.app.shortDescription = manifest.description.short;
  if (manifest?.accentColor) {
    p.app.accentColor = manifest.accentColor;
    p.icons.colorBg = manifest.accentColor;
  }
  if (manifest?.developer) {
    p.app.developerName = manifest.developer.name || p.app.developerName;
    p.app.websiteUrl = manifest.developer.websiteUrl || p.app.websiteUrl;
    p.app.privacyUrl = manifest.developer.privacyUrl || p.app.privacyUrl;
    p.app.termsOfUseUrl = manifest.developer.termsOfUseUrl || p.app.termsOfUseUrl;
  }
  p.conversationStarters = (da.conversation_starters || []).map((s) => ({
    title: s.title || "",
    text: s.text || "",
  }));
  p.disclaimer = da.disclaimer?.text || "";
  if (da.behavior_overrides) {
    p.behavior.discourageModelKnowledge = !!da.behavior_overrides.special_instructions?.discourage_model_knowledge;
    p.behavior.disableSuggestions = !!da.behavior_overrides.suggestions?.disabled;
    p.behavior.defaultResponseMode = da.behavior_overrides.default_response_mode || "Auto";
  }
  // reset then apply capabilities
  for (const name of Object.keys(p.capabilities)) p.capabilities[name].enabled = false;
  for (const cap of da.capabilities || []) {
    if (!cap?.name || !p.capabilities[cap.name]) continue;
    const slot = p.capabilities[cap.name];
    slot.enabled = true;
    if (cap.name === "WebSearch") slot.sites = (cap.sites || []).map((s) => s.url).filter(Boolean);
    if (cap.name === "OneDriveAndSharePoint") slot.urls = (cap.items_by_url || []).map((s) => s.url).filter(Boolean);
    if (cap.name === "GraphConnectors") slot.connectionIds = (cap.connections || []).map((s) => s.connection_id).filter(Boolean);
    if (cap.name === "Email") {
      slot.sharedMailbox = cap.shared_mailbox || "";
      slot.folders = (cap.folders || []).map((f) => f.folder_id).filter(Boolean);
      slot.groupMailboxes = cap.group_mailboxes || [];
    }
    if (cap.name === "People") slot.includeRelatedContent = !!cap.include_related_content;
    if (cap.name === "TeamsMessages") slot.urls = (cap.urls || []).map((s) => s.url).filter(Boolean);
    if (cap.name === "Dataverse") {
      const src = cap.knowledge_sources?.[0] || {};
      slot.hostName = src.host_name || "";
      slot.skill = src.skill || "";
      slot.tables = (src.tables || []).map((t) => t.table_name).filter(Boolean);
    }
    if (cap.name === "ScenarioModels") slot.modelIds = (cap.models || []).map((m) => m.id).filter(Boolean);
    if (cap.name === "EmbeddedKnowledge") slot.files = (cap.files || []).map((f) => f.file).filter(Boolean);
  }
  if (Array.isArray(da.actions) && da.actions.length) {
    p.actions.enabled = true;
    p.actions.id = da.actions[0].id || p.actions.id;
    if (plugin) {
      p.actions.nameForHuman = plugin.name_for_human || p.actions.nameForHuman;
      p.actions.descriptionForHuman = plugin.description_for_human || "";
      p.actions.descriptionForModel = plugin.description_for_model || "";
      p.actions.namespace = plugin.namespace || p.actions.namespace;
      p.actions.specUrl = plugin.runtimes?.[0]?.spec?.url || "openapi.yaml";
      const auth = plugin.runtimes?.[0]?.auth || {};
      p.actions.authType = auth.type || "None";
      p.actions.authReferenceId = auth.reference_id || "";
      p.actions.selectedOps = (plugin.functions || []).map((f) => f.name).filter(Boolean);
      p.actions.operationMeta = {};
      for (const fn of plugin.functions || []) {
        const sem = fn.capabilities?.response_semantics || {};
        const props = sem.properties || {};
        p.actions.operationMeta[fn.name] = {
          description: fn.description || "",
          dataPath: sem.data_path || "$",
          titlePath: props.title || "",
          subtitlePath: props.subtitle || "",
          urlPath: props.url || "",
          includeCard: !!sem.static_template,
          confirm: (fn.capabilities?.confirmation?.type || "None") === "AdaptiveCard",
          confirmationTitle: fn.capabilities?.confirmation?.title || "",
          confirmationBody: fn.capabilities?.confirmation?.body || "",
          dataHandling: fn.capabilities?.security_info?.data_handling || [],
        };
      }
    }
    if (openapiText) {
      p.actions.specText = openapiText;
      p.actions.specSource = p.actions.specSource || "import";
    }
  } else {
    p.actions.enabled = false;
  }
  p.sensitivityLabelId = da.sensitivity_label?.id || "";
  p.workerAgents = (da.worker_agents || []).map((w) => ({ id: w.id || "", file: w.file || "" }));
  p.userOverrideCaps = (da.user_overrides || [])
    .map((u) => {
      const m = String(u.path || "").match(/@\.name\s*==\s*'([^']+)'/);
      return m ? m[1] : null;
    })
    .filter(Boolean);
  if (da.editorial_answers?.answers) {
    p.editorialAnswers = da.editorial_answers.answers.map((a) => ({
      question: a.question || "",
      answer: a.answer || "",
    }));
  } else {
    p.editorialAnswers = [];
  }
  p.agentSkills = (da.agent_skills || []).map((s) => {
    const folder = (s.folder || "").replace(/^\.\//, "");
    const raw = (skillFiles && (skillFiles[`${folder}/SKILL.md`] || skillFiles[`./${folder}/SKILL.md`])) || "";
    return parseSkillMarkdown(folder, raw);
  });
  if (p.capabilities.EmbeddedKnowledge?.files?.length) {
    p.embeddedFiles = p.capabilities.EmbeddedKnowledge.files.map((f) =>
      typeof f === "string" ? { file: f, contentBase64: "", size: 0 } : { file: f.file || f, contentBase64: "", size: 0 }
    );
  }
  return p;
}

function stringifyMinimalYaml(obj) {
  // Small, readable YAML for the placeholder OpenAPI file — no extra dependency.
  return jsonToYaml(obj, 0);
}

function jsonToYaml(value, indent) {
  const pad = "  ".repeat(indent);
  if (value == null) return "null";
  if (typeof value === "string") return YAMLString(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return value
      .map((item) => {
        if (item && typeof item === "object") {
          const inner = jsonToYaml(item, indent + 1);
          const lines = inner.split("\n");
          return `${pad}- ${lines[0]}\n${lines.slice(1).map((l) => (l.startsWith("  ") ? l : `${pad}  ${l}`)).join("\n")}`.replace(/\n$/, "");
        }
        return `${pad}- ${jsonToYaml(item, 0)}`;
      })
      .join("\n");
  }
  const keys = Object.keys(value);
  if (!keys.length) return "{}";
  return keys
    .map((k) => {
      const v = value[k];
      const key = needsQuotes(k) ? YAMLString(k) : k;
      if (v && typeof v === "object") {
        const nested = jsonToYaml(v, indent + 1);
        if (Array.isArray(v)) {
          if (!v.length) return `${pad}${key}: []`;
          return `${pad}${key}:\n${nested}`;
        }
        if (!Object.keys(v).length) return `${pad}${key}: {}`;
        return `${pad}${key}:\n${nested}`;
      }
      return `${pad}${key}: ${jsonToYaml(v, 0)}`;
    })
    .join("\n");
}

function YAMLString(s) {
  if (s === "" || /[:#\n&*!%>@`'"{}[\],]|^\s|\s$/.test(s) || /^(true|false|null|yes|no|[0-9].*)$/i.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}

function needsQuotes(k) {
  return !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k);
}

export const SCHEMA_URLS = { DA_SCHEMA_URL, TEAMS_SCHEMA_URL };
