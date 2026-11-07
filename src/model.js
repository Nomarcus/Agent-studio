import { generateGuid, initialsFromName, clip, LIMITS, CAPABILITY_NAMES, nowIso, deepClone } from "./util.js";
import { defaultActions, mergeActions } from "./plugin.js";
import { SKILLS_INTRO, mergeAgentSkillsIntoSkills } from "./skillmd.js";

export function emptyCapabilities() {
  const caps = {};
  for (const name of CAPABILITY_NAMES) {
    caps[name] = { enabled: false };
  }
  caps.WebSearch.sites = [];
  caps.OneDriveAndSharePoint.urls = [];
  caps.GraphConnectors.connectionIds = [];
  caps.Email.sharedMailbox = "";
  caps.Email.folders = [];
  caps.Email.groupMailboxes = [];
  caps.People.includeRelatedContent = false;
  caps.TeamsMessages.urls = [];
  caps.Dataverse.hostName = "";
  caps.Dataverse.skill = "";
  caps.Dataverse.tables = [];
  caps.ScenarioModels.modelIds = [];
  caps.EmbeddedKnowledge.files = [];
  return caps;
}

export function createEmptyProject(overrides = {}) {
  const name = overrides.name || "Ny agent";
  const project = {
    schemaVersion: 1,
    id: generateGuid(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    templateId: "blank",
    name,
    description: "En deklarativ agent för Microsoft 365 Copilot.",
    app: {
      id: generateGuid(),
      version: "1.0.0",
      shortName: clip(name, LIMITS.APP_SHORT_NAME),
      shortDescription: "Deklarativ Copilot-agent.",
      accentColor: "#1F4E79",
      developerName: "Integrationslaget",
      websiteUrl: "https://example.com",
      privacyUrl: "https://example.com/privacy",
      termsOfUseUrl: "https://example.com/terms",
    },
    instructionsMode: "structured",
    role: "",
    style: "",
    skills: [],
    guardrails: "",
    instructionsRaw: "",
    conversationStarters: [],
    capabilities: emptyCapabilities(),
    actions: defaultActions(),
    disclaimer: "",
    behavior: {
      discourageModelKnowledge: false,
      disableSuggestions: false,
      defaultResponseMode: "Auto",
    },
    icons: {
      initials: initialsFromName(name),
      colorBg: "#1F4E79",
      colorFg: "#FFFFFF",
    },
    testPrompts: [],
    sensitivityLabelId: "",
    workerAgents: [],
    userOverrideCaps: [],
    editorialAnswers: [],
    agentSkills: [],
    embeddedFiles: [],
  };
  return applyOverrides(project, overrides);
}

export function applyOverrides(project, overrides) {
  if (!overrides || typeof overrides !== "object") return project;
  const next = deepClone(project);
  for (const [key, value] of Object.entries(overrides)) {
    if (key === "app" || key === "capabilities" || key === "actions" || key === "behavior" || key === "icons") {
      next[key] = { ...next[key], ...value };
      if (key === "capabilities" && value) {
        for (const [capName, capVal] of Object.entries(value)) {
          next.capabilities[capName] = { ...next.capabilities[capName], ...capVal };
        }
      }
    } else {
      next[key] = value;
    }
  }
  next.updatedAt = nowIso();
  return next;
}

export function compileInstructions(project) {
  if (project.instructionsMode === "raw") {
    return (project.instructionsRaw || "").trim();
  }
  const parts = [];
  const role = (project.role || "").trim();
  if (role) {
    if (role.startsWith("You are") || role.startsWith("Du är")) parts.push(role);
    else if (/^(en|ett)\s/i.test(role)) parts.push(`Du är ${role}`);
    else parts.push(`You are ${role}`);
  }
  const style = (project.style || "").trim();
  if (style) {
    parts.push(style);
  }
  const skills = Array.isArray(project.skills) ? project.skills.filter((s) => (s?.name || "").trim()) : [];
  if (skills.length) {
    parts.push(
      "# Skills\n" + SKILLS_INTRO
    );
    for (const skill of skills) {
      const block = [`## Skill: ${skill.name.trim()}`];
      if ((skill.when || "").trim()) block.push(`When to use: ${skill.when.trim()}`);
      if ((skill.how || "").trim()) block.push(`How to do it:\n${skill.how.trim()}`);
      if ((skill.output || "").trim()) block.push(`Output format:\n${skill.output.trim()}`);
      parts.push(block.join("\n"));
    }
  }
  const guardrails = (project.guardrails || "").trim();
  if (guardrails) {
    parts.push(`# Guardrails\n${guardrails}`);
  }
  return parts.join("\n\n").trim();
}

export function syncDerivedFields(project) {
  const next = deepClone(project);
  if (!next.app.shortName) next.app.shortName = clip(next.name, LIMITS.APP_SHORT_NAME);
  if (!next.app.shortDescription) next.app.shortDescription = clip(next.description, LIMITS.APP_SHORT_DESC);
  if (!next.icons.initials) next.icons.initials = initialsFromName(next.name);
  next.updatedAt = nowIso();
  return next;
}

export function enableCapabilities(project, names) {
  const next = deepClone(project);
  for (const name of names) {
    if (!next.capabilities[name]) next.capabilities[name] = { enabled: true };
    else next.capabilities[name].enabled = true;
  }
  return next;
}

export function normalizeProject(project) {
  if (!project || typeof project !== "object") return createEmptyProject();
  const base = createEmptyProject();
  const next = applyOverrides(base, project);
  if (!Array.isArray(next.workerAgents)) next.workerAgents = [];
  if (!Array.isArray(next.userOverrideCaps)) next.userOverrideCaps = [];
  if (!Array.isArray(next.editorialAnswers)) next.editorialAnswers = [];
  if (!Array.isArray(next.agentSkills)) next.agentSkills = [];
  if (!Array.isArray(next.embeddedFiles)) next.embeddedFiles = [];
  if (typeof next.sensitivityLabelId !== "string") next.sensitivityLabelId = "";
  next.actions = mergeActions(defaultActions(), next.actions || {});
  if (!Array.isArray(next.skills)) next.skills = [];
  // Round 4: one card per skill. Legacy agentSkills fold into skills[].
  mergeAgentSkillsIntoSkills(next);
  return next;
}
