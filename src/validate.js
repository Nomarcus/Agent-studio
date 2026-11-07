import { LIMITS, hasNonWhitespace, isGuid, isSemver, isHexColor, isHttpUrl, hasIllegalLocalizationMarkers, CAPABILITY_NAMES, isAllowedEmbeddedName } from "./util.js";
import { compileInstructions } from "./model.js";
import { buildDeclarativeAgent, buildTeamsManifest, buildCapabilities, buildConversationStarters } from "./package.js";
import { buildApiPlugin, AUTH_TYPES } from "./plugin.js";
import { parseAndList, namespaceFromName } from "./openapi.js";
import { deriveAgentSkills } from "./skillmd.js";

export function collectFieldErrors(project) {
  const errors = [];
  const warn = [];

  if (!hasNonWhitespace(project.name)) errors.push(err("name", "NAME_REQUIRED", "Ange ett namn.", "Enter a name."));
  else if (project.name.trim().length > LIMITS.DA_NAME) errors.push(err("name", "NAME_TOO_LONG", `Namnet får vara högst ${LIMITS.DA_NAME} tecken.`, `Name must be at most ${LIMITS.DA_NAME} characters.`));
  if (hasIllegalLocalizationMarkers(project.name)) errors.push(err("name", "NAME_MARKERS", "Namnet får inte innehålla [[ eller ]].", "Name cannot contain [[ or ]]."));

  if (!hasNonWhitespace(project.description)) errors.push(err("description", "DESC_REQUIRED", "Ange en beskrivning.", "Enter a description."));
  else if (project.description.trim().length > LIMITS.DA_DESCRIPTION) errors.push(err("description", "DESC_TOO_LONG", `Beskrivningen får vara högst ${LIMITS.DA_DESCRIPTION} tecken.`, `Description must be at most ${LIMITS.DA_DESCRIPTION} characters.`));

  const instructions = compileInstructions(project);
  if (!hasNonWhitespace(instructions)) errors.push(err("instructions", "INSTR_REQUIRED", "Skriv instruktioner (en roll och minst en skill).", "Write instructions (a role and at least one skill)."));
  else if (instructions.length > LIMITS.DA_INSTRUCTIONS) {
    errors.push(err("instructions", "INSTR_TOO_LONG", `Instruktionerna är ${instructions.length} tecken. Gränsen är ${LIMITS.DA_INSTRUCTIONS}.`, `Instructions are ${instructions.length} characters. The limit is ${LIMITS.DA_INSTRUCTIONS}.`));
  }

  const starters = project.conversationStarters || [];
  if (starters.length > LIMITS.STARTERS) {
    errors.push(err("conversationStarters", "STARTERS_MAX", `Högst ${LIMITS.STARTERS} startfrågor.`, `At most ${LIMITS.STARTERS} conversation starters.`));
  }
  starters.forEach((s, i) => {
    if ((s.title || s.text) && !hasNonWhitespace(s.text)) {
      errors.push(err(`conversationStarters.${i}.text`, "STARTER_TEXT", `Startfråga ${i + 1} saknar text.`, `Conversation starter ${i + 1} is missing text.`));
    }
  });

  if (hasNonWhitespace(project.disclaimer) && project.disclaimer.trim().length > LIMITS.DISCLAIMER) {
    errors.push(err("disclaimer", "DISCLAIMER_TOO_LONG", `Ansvarsfriskrivningen får vara högst ${LIMITS.DISCLAIMER} tecken.`, `Disclaimer must be at most ${LIMITS.DISCLAIMER} characters.`));
  }

  const app = project.app || {};
  if (!isGuid(app.id)) errors.push(err("app.id", "APP_ID", "App-id måste vara ett GUID.", "App id must be a GUID."));
  if (!isSemver(app.version || "")) errors.push(err("app.version", "APP_VERSION", "Version måste vara semver, till exempel 1.0.0.", "Version must be semver, for example 1.0.0."));
  if (!hasNonWhitespace(app.developerName)) errors.push(err("app.developerName", "DEV_NAME", "Ange utvecklarens namn.", "Enter the developer name."));
  else if (app.developerName.trim().length > LIMITS.DEVELOPER_NAME) {
    errors.push(err("app.developerName", "DEV_NAME_LEN", `Utvecklarnamn får vara högst ${LIMITS.DEVELOPER_NAME} tecken.`, `Developer name must be at most ${LIMITS.DEVELOPER_NAME} characters.`));
  }
  for (const [field, labelSv, labelEn] of [
    ["websiteUrl", "webbplats", "website"],
    ["privacyUrl", "integritetspolicy", "privacy policy"],
    ["termsOfUseUrl", "användarvillkor", "terms of use"],
  ]) {
    if (!isHttpUrl(app[field] || "")) {
      errors.push(err(`app.${field}`, "URL_INVALID", `Ange en giltig http(s)-adress för ${labelSv}.`, `Enter a valid http(s) URL for the ${labelEn}.`));
    }
  }
  if (!isHexColor(app.accentColor || "")) {
    errors.push(err("app.accentColor", "ACCENT", "Accentfärgen måste vara #RRGGBB.", "Accent color must be #RRGGBB."));
  }
  if ((app.shortName || "").length > LIMITS.APP_SHORT_NAME) {
    errors.push(err("app.shortName", "SHORT_NAME", `Kortnamn får vara högst ${LIMITS.APP_SHORT_NAME} tecken.`, `Short name must be at most ${LIMITS.APP_SHORT_NAME} characters.`));
  }
  if ((app.shortDescription || "").length > LIMITS.APP_SHORT_DESC) {
    errors.push(err("app.shortDescription", "SHORT_DESC", `Kort beskrivning får vara högst ${LIMITS.APP_SHORT_DESC} tecken.`, `Short description must be at most ${LIMITS.APP_SHORT_DESC} characters.`));
  }
  if (/example\.com/i.test(`${app.websiteUrl} ${app.privacyUrl} ${app.termsOfUseUrl}`)) {
    warn.push(err("app.websiteUrl", "EXAMPLE_URL", "Byt ut example.com mot er riktiga webbplats innan ni sideloadar i produktion.", "Replace example.com with your real website before sideloading in production."));
  }

  const cap = project.capabilities || {};
  const sites = (cap.WebSearch?.sites || []).map((s) => String(s || "").trim()).filter(Boolean);
  if (cap.WebSearch?.enabled && sites.length > LIMITS.WEBSEARCH_SITES) {
    errors.push(err("capabilities.WebSearch.sites", "WEBSEARCH_MAX", `Webbsökning får ha högst ${LIMITS.WEBSEARCH_SITES} sajter.`, `Web search may list at most ${LIMITS.WEBSEARCH_SITES} sites.`));
  }
  if (cap.WebSearch?.enabled) {
    for (const url of sites) {
      if (!isHttpUrl(url)) errors.push(err("capabilities.WebSearch.sites", "WEBSEARCH_URL", `Ogiltig sajt-URL: ${url}`, `Invalid site URL: ${url}`));
      else if (!isValidWebSearchUrl(url)) {
        errors.push(err("capabilities.WebSearch.sites", "WEBSEARCH_PATH", `Webbsökning tillåter högst två sökvägssegment och inga frågeparametrar: ${url}`, `Web search allows at most two path segments and no query parameters: ${url}`));
      }
    }
  }
  const teamUrls = (cap.TeamsMessages?.urls || []).map((s) => String(s || "").trim()).filter(Boolean);
  if (cap.TeamsMessages?.enabled && teamUrls.length > LIMITS.TEAMS_URLS) {
    errors.push(err("capabilities.TeamsMessages.urls", "TEAMS_MAX", `Teams-meddelanden får ha högst ${LIMITS.TEAMS_URLS} URL:er.`, `Teams messages may list at most ${LIMITS.TEAMS_URLS} URLs.`));
  }

  const enabledCaps = CAPABILITY_NAMES.filter((n) => cap[n]?.enabled);
  const seen = new Set();
  for (const name of enabledCaps) {
    if (seen.has(name)) errors.push(err("capabilities", "CAP_DUP", `Förmågan ${name} är duplicerad.`, `Capability ${name} is duplicated.`));
    seen.add(name);
  }

  if (project.actions?.enabled) {
    const a = project.actions;
    if (!hasNonWhitespace(a.id)) {
      errors.push(err("actions.id", "ACTION_ID", "Ange ett id för API-pluginet.", "Enter an id for the API plugin."));
    }
    if (!hasNonWhitespace(a.specText)) {
      errors.push(err("actions.specText", "OPENAPI_REQUIRED", "Klistra in eller ladda upp en OpenAPI 3-specifikation, eller använd Jira Cloud-exemplet.", "Paste or upload an OpenAPI 3 specification, or use the Jira Cloud sample."));
    } else {
      const parsed = parseAndList(a.specText);
      if (!parsed.ok) {
        errors.push(err("actions.specText", "OPENAPI_PARSE", `OpenAPI kunde inte läsas: ${parsed.error}`, `OpenAPI could not be parsed: ${parsed.error}`));
      } else if (!parsed.operations.length) {
        errors.push(err("actions.specText", "OPENAPI_OPS", "OpenAPI-dokumentet innehåller inga operationer.", "The OpenAPI document contains no operations."));
      } else {
        const selected = (a.selectedOps || []).filter(Boolean);
        if (!selected.length) {
          errors.push(err("actions.selectedOps", "OPENAPI_SELECT", "Välj minst en API-operation till pluginet.", "Select at least one API operation for the plugin."));
        } else {
          const ids = new Set(parsed.operations.map((op) => op.operationId));
          for (const id of selected) {
            if (!ids.has(id)) {
              errors.push(err("actions.selectedOps", "OPENAPI_UNKNOWN_OP", `Vald operation saknas i specifikationen: ${id}`, `Selected operation is missing from the specification: ${id}`));
            }
          }
        }
      }
    }
    const ns = (a.namespace || "").trim() || namespaceFromName(a.nameForHuman || project.name);
    if (!/^[A-Za-z0-9-]+$/.test(ns)) {
      errors.push(err("actions.namespace", "PLUGIN_NAMESPACE", "Namespace får bara innehålla bokstäver, siffror och bindestreck.", "Namespace may only contain letters, numbers and hyphens."));
    }
    if (!hasNonWhitespace(a.nameForHuman) && !hasNonWhitespace(project.name)) {
      errors.push(err("actions.nameForHuman", "PLUGIN_NAME", "Ange ett visningsnamn för API-pluginet.", "Enter a display name for the API plugin."));
    } else if ((a.nameForHuman || "").trim().length > 20) {
      warn.push(err("actions.nameForHuman", "PLUGIN_NAME_LONG", "Visningsnamn längre än 20 tecken kan kapas i Copilot.", "Display names longer than 20 characters may be truncated in Copilot."));
    }
    const authType = AUTH_TYPES.includes(a.authType) ? a.authType : "None";
    if ((authType === "OAuthPluginVault" || authType === "ApiKeyPluginVault") && !hasNonWhitespace(a.authReferenceId)) {
      errors.push(err("actions.authReferenceId", "PLUGIN_AUTH_REF", "OAuth och API-nyckel kräver ett referens-id från Teams Developer Portal (inga hemligheter i manifestet).", "OAuth and API key require a reference id from Teams Developer Portal (no secrets in the manifest)."));
    }
    if (authType === "ApiKeyPluginVault" && (a.authReferenceId || "").trim() === "jira-api-key") {
      warn.push(err("actions.authReferenceId", "PLUGIN_AUTH_PLACEHOLDER", "Byt ut platshållaren jira-api-key mot referens-id:t ni får när ni registrerar Jira-token i Teams Developer Portal.", "Replace the jira-api-key placeholder with the reference id you get when you register the Jira token in Teams Developer Portal."));
    }
  }

  const sens = (project.sensitivityLabelId || "").trim();
  if (sens && !isGuid(sens)) {
    errors.push(err("sensitivityLabelId", "SENS_LABEL", "Känslighetsetikett måste vara ett GUID från Purview.", "Sensitivity label must be a Purview GUID."));
  }

  const workers = project.workerAgents || [];
  workers.forEach((w, i) => {
    const id = (w?.id || "").trim();
    const file = (w?.file || "").trim();
    if (!id && !file) {
      errors.push(err(`workerAgents.${i}`, "WORKER_EMPTY", `Arbetaragent ${i + 1} behöver ett id eller en fil.`, `Worker agent ${i + 1} needs an id or a file.`));
    }
    if (id && file) {
      errors.push(err(`workerAgents.${i}`, "WORKER_BOTH", `Arbetaragent ${i + 1}: ange antingen id eller fil, inte båda.`, `Worker agent ${i + 1}: provide either id or file, not both.`));
    }
  });

  const answers = project.editorialAnswers || [];
  if (answers.length > 300) {
    errors.push(err("editorialAnswers", "ANSWERS_MAX", "Högst 300 redaktionella svar.", "At most 300 editorial answers."));
  }
  answers.forEach((a, i) => {
    if ((a.question || a.answer) && (!hasNonWhitespace(a.question) || !hasNonWhitespace(a.answer))) {
      errors.push(err(`editorialAnswers.${i}`, "ANSWER_PAIR", `Redaktionellt svar ${i + 1} behöver både fråga och svar.`, `Editorial answer ${i + 1} needs both question and answer.`));
    }
  });

  const agentSkills = deriveAgentSkills(project);
  if (agentSkills.length > LIMITS.AGENT_SKILLS) {
    errors.push(err("agentSkills", "SKILLS_MAX", `Högst ${LIMITS.AGENT_SKILLS} skills med SKILL.md-fil.`, `At most ${LIMITS.AGENT_SKILLS} agent skill folders.`));
  }
  agentSkills.forEach((s, i) => {
    const folder = (s.folder || "").trim();
    if (!folder) {
      errors.push(err(`agentSkills.${i}.folder`, "SKILL_FOLDER", `Skill ${i + 1} saknar mapp för SKILL.md.`, `Agent skill ${i + 1} is missing a folder.`));
    } else if (folder.includes("..") || folder.startsWith("/")) {
      errors.push(err(`agentSkills.${i}.folder`, "SKILL_PATH", `Ogiltig skill-mapp: ${folder}`, `Invalid skill folder: ${folder}`));
    }
  });

  const embedded = project.embeddedFiles || [];
  if (cap.EmbeddedKnowledge?.enabled || embedded.length) {
    if (embedded.length > LIMITS.EMBEDDED_FILES) {
      errors.push(err("embeddedFiles", "EMBED_MAX", `Högst ${LIMITS.EMBEDDED_FILES} inbäddade filer.`, `At most ${LIMITS.EMBEDDED_FILES} embedded files.`));
    }
    embedded.forEach((f, i) => {
      const name = (f?.file || "").trim();
      if (!isAllowedEmbeddedName(name)) {
        errors.push(err(`embeddedFiles.${i}`, "EMBED_TYPE", `Filen ${name || "(namnlös)"} har inte en tillåten typ (doc/docx/ppt/pptx/xls/xlsx/txt/pdf).`, `File ${name || "(unnamed)"} is not an allowed type (doc/docx/ppt/pptx/xls/xlsx/txt/pdf).`));
      }
      if ((f?.size || 0) > LIMITS.EMBEDDED_MAX_BYTES) {
        errors.push(err(`embeddedFiles.${i}`, "EMBED_SIZE", `Filen ${name} är större än 1 MB.`, `File ${name} is larger than 1 MB.`));
      }
      if (cap.EmbeddedKnowledge?.enabled && !f?.contentBase64) {
        warn.push(err(`embeddedFiles.${i}`, "EMBED_EMPTY", `Filen ${name} saknar innehåll — den kommer inte med i zip-filen.`, `File ${name} has no content — it will not be included in the zip.`));
      }
    });
    if (cap.EmbeddedKnowledge?.enabled && !embedded.length && !(cap.EmbeddedKnowledge.files || []).length) {
      warn.push(err("embeddedFiles", "EMBED_NONE", "Inbäddad kunskap är på men inga filer är tillagda.", "Embedded knowledge is on but no files were added."));
    }
  }

  for (const name of project.userOverrideCaps || []) {
    if (!cap[name]?.enabled) {
      warn.push(err("userOverrideCaps", "OVERRIDE_OFF", `Användaren får stänga av ${name}, men förmågan är redan avstängd.`, `User override for ${name} but the capability is off.`));
    }
  }

  return { errors, warnings: warn, instructionsLength: instructions.length, instructions };
}

function err(path, code, sv, en) {
  return { path, code, sv, en, message: sv };
}

function isValidWebSearchUrl(url) {
  try {
    const u = new URL(url);
    if (u.search) return false;
    const parts = u.pathname.split("/").filter(Boolean);
    return parts.length <= 2;
  } catch {
    return false;
  }
}

export function formatAjvErrors(ajvErrors, lang = "sv") {
  if (!ajvErrors || !ajvErrors.length) return [];
  return ajvErrors.map((e) => {
    const path = e.instancePath || e.schemaPath || "";
    const ev = e.params ? Object.values(e.params).join(", ") : "";
    const detail = `${path} ${e.message || ""}${ev ? ` (${ev})` : ""}`.trim();
    return {
      path: e.instancePath || "",
      code: "SCHEMA",
      keyword: e.keyword,
      sv: `Schemafel: ${detail}`,
      en: `Schema error: ${detail}`,
      message: lang === "en" ? `Schema error: ${detail}` : `Schemafel: ${detail}`,
    };
  });
}

export function validateGenerated(project, validators) {
  const field = collectFieldErrors(project);
  const da = buildDeclarativeAgent(project);
  const manifest = buildTeamsManifest(project);
  const schemaErrors = [];
  if (validators?.da) {
    const ok = validators.da(da);
    if (!ok) schemaErrors.push(...formatAjvErrors(validators.da.errors));
  }
  if (validators?.teams) {
    const ok = validators.teams(manifest);
    if (!ok) schemaErrors.push(...formatAjvErrors(validators.teams.errors));
  }
  let plugin = null;
  if (project.actions?.enabled && validators?.plugin) {
    const built = buildApiPlugin(project);
    if (built.ok && built.plugin) {
      plugin = built.plugin;
      const ok = validators.plugin(plugin);
      if (!ok) schemaErrors.push(...formatAjvErrors(validators.plugin.errors));
    }
  }
  return {
    ok: field.errors.length === 0 && schemaErrors.length === 0,
    fieldErrors: field.errors,
    warnings: field.warnings,
    schemaErrors,
    da,
    manifest,
    instructions: field.instructions,
    instructionsLength: field.instructionsLength,
    capabilities: buildCapabilities(project),
    starters: buildConversationStarters(project),
    plugin,
  };
}

export async function createValidators(AjvImpl, daSchema, teamsSchema, pluginSchema, addFormats) {
  const Ajv = AjvImpl;
  const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false });
  // Official schemas use format "uri", "email" etc. Register real format validators
  // (vendored ajv-formats) so Ajv validates them instead of warning "unknown format".
  if (typeof addFormats === "function") addFormats(ajv);
  const validators = {
    ajv,
    da: ajv.compile(daSchema),
    teams: ajv.compile(teamsSchema),
  };
  if (pluginSchema) validators.plugin = ajv.compile(pluginSchema);
  return validators;
}
