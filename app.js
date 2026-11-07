import Ajv, { addFormats } from "./vendor/ajv.esm.js";
import JSZip from "./vendor/jszip.esm.js";
import daSchema from "./schemas/declarative-agent-v1.9.js";
import teamsSchema from "./schemas/MicrosoftTeams.v1.29.schema.js";
import pluginSchema from "./schemas/plugin-v2.4.js";
import { STR } from "./src/i18n.js";
import { LIMITS, generateGuid, slugify, countChars, initialsFromName } from "./src/util.js";
import { compileInstructions, normalizeProject } from "./src/model.js";
import { TEMPLATE_LIST, createFromTemplate } from "./src/templates.js";
import {
  buildDeclarativeAgent,
  buildTeamsManifest,
  buildZip,
  buildPackageFiles,
  customIconBytes,
  importPackageZip,
  applyImportedToProject,
} from "./src/package.js";
import { buildApiPlugin, createJiraCloudActions, emptyActionMeta } from "./src/plugin.js";
import { parseAndList, namespaceFromName } from "./src/openapi.js";
import { collectFieldErrors, createValidators, validateGenerated } from "./src/validate.js";
import { lintInstructions, suggestedTestPrompts } from "./src/lint.js";
import { generateIcons, generateIconsViaCanvas, bytesToDataUrl } from "./src/icons.js";
import { compileSkillMarkdown, deriveAgentSkills, normalizeSkill, skillFolderFor } from "./src/skillmd.js";
import { renderMarkdown } from "./src/markdown.js";
import {
  loadStore,
  upsertProject,
  deleteProject,
  loadSettings,
  saveSettings,
  exportProjectJson,
  importProjectJson,
  loadHistory,
  pushHistory,
  undoHistory,
  redoHistory,
  canUndo,
  canRedo,
  exportAllProjectsJson,
  exportTeamLibrary,
  parseStudioJson,
  mergeLibraryAgents,
} from "./src/store.js";
import { isAllowedEmbeddedName } from "./src/util.js";

const STEPS = ["stepIdentity", "stepSkills", "stepCapabilities", "stepStarters", "stepPackage"];
const state = {
  lang: "sv",
  theme: "dark",
  step: 0,
  project: null,
  store: { projects: [], activeId: null },
  validators: null,
  saveLabel: "saved",
  previewKind: "declarativeAgent.json",
  history: { stack: [], index: -1, projectId: null },
  showPublisher: false,
  quickStart: null,
  applyingHistory: false,
  openSkill: 0,
  sideTplOpen: false,
  mdPreview: {},
  previewPrompt: "",
  lastAgentId: null,
};

let saveTimer = 0;

const $ = (id) => document.getElementById(id);
const tt = (key) => {
  const table = STR[state.lang] || STR.sv;
  return table[key] ?? STR.sv[key] ?? key;
};
const capName = (name) => (STR[state.lang].capNames || {})[name] || name;
const capHelp = (name) => (STR[state.lang].capHelp || {})[name] || "";

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setPath(obj, path, value) {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (cur[key] == null || typeof cur[key] !== "object") cur[key] = {};
    cur = cur[key];
  }
  cur[parts[parts.length - 1]] = value;
}

let savePending = false;
function persistSoon() {
  state.saveLabel = "saving";
  const pill = document.querySelector(".save-pill");
  if (pill) {
    pill.textContent = tt("saving");
    pill.classList.add("busy");
  }
  clearTimeout(saveTimer);
  savePending = true;
  saveTimer = setTimeout(doSave, 280);
}

/** Save now (structural edits: add/remove/move) so each gets its own undo step. */
function persistNow() {
  clearTimeout(saveTimer);
  doSave();
}

/** If typing is still debounced, commit it first so it stays a separate undo step. */
function flushSave() {
  if (savePending) persistNow();
}

function doSave() {
  savePending = false;
  if (state.project) {
    state.project.updatedAt = new Date().toISOString();
    if (!state.applyingHistory) {
      state.history = pushHistory(state.history, state.project);
    }
    state.store = upsertProject(state.store, state.project);
  }
  saveSettings({ lang: state.lang, theme: state.theme, lastAgentId: state.lastAgentId });
  state.saveLabel = "saved";
  const p = document.querySelector(".save-pill");
  if (p) {
    p.textContent = tt("save");
    p.classList.remove("busy");
  }
  const undoBtn = document.querySelector('[data-action="undo"]');
  const redoBtn = document.querySelector('[data-action="redo"]');
  if (undoBtn) undoBtn.disabled = !canUndo(state.history);
  if (redoBtn) redoBtn.disabled = !canRedo(state.history);
}

function selectProject(id) {
  const found = state.store.projects.find((p) => p.id === id);
  state.project = found ? normalizeProject(found) : null;
  state.store.activeId = id;
  state.step = 0;
  state.openSkill = 0;
  state.quickStart = null;
  if (state.project) {
    state.lastAgentId = state.project.id;
    state.previewPrompt = "";
    state.history = pushHistory({ stack: [], index: -1, projectId: null }, state.project);
  }
  render();
}

function useTemplate(id, { quick = null } = {}) {
  const hadDraft = !!(state.project && state.store.projects.some((p) => p.id === state.project.id));
  const project = createFromTemplate(id);
  state.project = project;
  state.store = upsertProject(state.store, project);
  state.history = pushHistory({ stack: [], index: -1, projectId: null }, project);
  state.step = 0;
  state.openSkill = 0;
  state.quickStart = quick;
  state.showPublisher = false;
  state.lastAgentId = project.id;
  state.previewPrompt = "";
  render();
  window.scrollTo(0, 0);
  if (hadDraft && !quick) toast(tt("toastNewDraft"));
}

let toastTimer = 0;
function toast(text, kind = "ok") {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  el.className = `toast show ${kind}`;
  el.textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 4200);
}

function msg(item) {
  if (!item) return "";
  return state.lang === "en" ? item.en || item.message : item.sv || item.message;
}

function currentIcons() {
  if (!state.project) return null;
  let generated;
  try {
    generated = generateIconsViaCanvas(state.project);
  } catch {
    generated = generateIcons(state.project);
  }
  const custom = customIconBytes(state.project);
  return { color: custom.color || generated.color, outline: custom.outline || generated.outline };
}

function render() {
  fieldSeq = 0;
  document.documentElement.lang = state.lang === "en" ? "en" : "sv";
  document.documentElement.dataset.theme = state.theme;
  document.title = `${state.project?.name || tt("appName")} · Agent Studio`;
  $("app").innerHTML = `
    ${renderTop()}
    <div class="layout ${state.project ? "" : "welcome-mode"}">
      <aside class="sidebar" aria-label="${esc(tt("drafts"))}">${renderSidebar()}</aside>
      <main class="main" id="main">${renderMain()}</main>
      <aside class="aside" id="aside" aria-label="${esc(tt("validation"))}">${renderAside()}</aside>
    </div>
  `;
  refreshDynamic();
  autosizeAll();
}

function autosize(el) {
  if (!el || el.classList.contains("code") || el.offsetParent === null) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight + 2, 520)}px`;
}
function autosizeAll() {
  document.querySelectorAll("main textarea").forEach(autosize);
}

function renderTop() {
  return `
    <a class="skip-link" href="#main">${esc(tt("skipToContent"))}</a>
    <header class="topbar">
      <div class="topbar-row">
        <div class="brand">
          <button class="logo" data-action="go-home" aria-label="${esc(tt("goHome"))}" title="${esc(tt("goHome"))}" type="button">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 6c2.4-.9 4.3-.4 8 1.4C15.7 5.6 17.6 5.1 20 6v12.2c-2.4-.8-4.4-.3-8 1.5-3.6-1.8-5.6-2.3-8-1.5V6z" stroke="#E8B86D" stroke-width="1.7" stroke-linejoin="round"/>
              <path d="M12 7.4v12.3" stroke="#E8B86D" stroke-width="1.7"/>
            </svg>
          </button>
          <div>
            <h1>${esc(tt("appName"))}</h1>
            <p>${esc(tt("tagline"))}</p>
          </div>
        </div>
        <span class="save-pill ${state.saveLabel === "saving" ? "busy" : ""}">${esc(tt(state.saveLabel === "saving" ? "saving" : "save"))}</span>
      </div>
      <div class="topbar-actions">
        ${state.project ? `<button class="btn" data-action="undo" ${canUndo(state.history) ? "" : "disabled"} title="${esc(tt("undoTitle"))}" aria-label="${esc(tt("undoTitle"))}">${esc(tt("undo"))}</button>
        <button class="btn" data-action="redo" ${canRedo(state.history) ? "" : "disabled"} title="${esc(tt("redoTitle"))}" aria-label="${esc(tt("redoTitle"))}">${esc(tt("redo"))}</button>` : ""}
        <button class="btn" type="button" data-action="toggle-lang" aria-label="${state.lang === "sv" ? "EN" : "SV"} — ${esc(tt("langTitle"))}" title="${esc(tt("langTitle"))}">${state.lang === "sv" ? "EN" : "SV"}</button>
        <button class="btn" type="button" data-action="toggle-theme" aria-label="${esc(tt(state.theme === "dark" ? "themeLight" : "themeDark"))} — ${esc(tt("themeTitle"))}" title="${esc(tt("themeTitle"))}">${esc(tt(state.theme === "dark" ? "themeLight" : "themeDark"))}</button>
        <button class="btn hide-sm" type="button" data-action="backup-all" title="${esc(tt("backupTitle"))}" aria-label="${esc(tt("shareBackup"))} — ${esc(tt("backupTitle"))}">${esc(tt("shareBackup"))}</button>
        <button class="btn primary" data-action="new-blank">${esc(tt("newAgent"))}</button>
      </div>
    </header>
  `;
}

function renderSidebar() {
  const tpls = TEMPLATE_LIST.map((tpl) => {
    const active = state.project?.templateId === tpl.id && !state.store.projects.some((p) => p.id === state.project?.id && p !== state.project);
    const selected = state.project?.templateId === tpl.id;
    return `
      <button class="tpl-card ${selected ? "active" : ""}" data-action="use-template" data-id="${esc(tpl.id)}">
        <span class="tpl-ico">${tpl.icon}</span>
        <span>
          <strong>${esc(tpl.name[state.lang])}</strong>
          <span>${esc(tpl.blurb[state.lang])}</span>
        </span>
      </button>
    `;
  }).join("");
  const drafts = state.store.projects.length
    ? state.store.projects
        .map((p) => `
          <button class="draft-card ${p.id === state.project?.id ? "active" : ""}" data-action="open-draft" data-id="${esc(p.id)}">
            <span class="tpl-ico">${esc((p.icons?.initials || "A").slice(0, 2))}</span>
            <span>
              <strong>${esc(p.name)}</strong>
              <span>${esc(p.description || "").slice(0, 80)}</span>
            </span>
          </button>`)
        .join("")
    : `<p class="hint" style="padding:0 8px">${esc(tt("noDrafts"))}</p>`;
  return `
    <div class="side-block">
      <div class="section-label">${esc(tt("drafts"))}</div>
      ${drafts}
    </div>
    <details class="side-block side-templates" data-side="templates" ${state.sideTplOpen ? "open" : ""}>
      <summary class="section-label">${esc(tt("newFromTemplate"))}</summary>
      ${tpls}
    </details>
  `;
}

function renderMain() {
  if (!state.project) return renderWelcome();
  if (state.quickStart) {
    const qs = state.quickStart;
    return `
      <section class="card">
        <p class="eyebrow">${esc(tt("quickStart"))}</p>
        <h2 class="page">${esc(tt("quickStartTitle"))}</h2>
        <p class="lede">${esc(tt("quickStartBlurb"))}</p>
        ${field(tt("quickName"), textInput("name", state.project.name))}
        ${field(tt("quickSite"), textInput("app.websiteUrl", qs.site || state.project.app.websiteUrl))}
        ${field(tt("quickConnector"), `<input type="text" data-quick="connector" value="${esc(qs.connector || "")}" placeholder="jiraTickets" />`)}
        <div class="btn-row" style="margin-top:12px">
          <button class="btn gold" data-action="quick-finish">${esc(tt("quickExport"))}</button>
          <button class="btn" data-action="quick-cancel">${esc(tt("back"))}</button>
        </div>
      </section>
    `;
  }
  const p = state.project;
  const stepper = STEPS.map((key, i) => `
    <button type="button" class="step ${i === state.step ? "current" : ""} ${i < state.step ? "done" : ""}" data-action="goto-step" data-step="${i}" ${i === state.step ? 'aria-current="step"' : ""}>
      <span class="n" aria-hidden="true">${i + 1}</span>${esc(tt(key))}
    </button>`).join("");
  return `
    ${stepper ? `<nav class="stepper">${stepper}</nav>` : ""}
    ${[renderIdentity, renderSkills, renderCapabilities, renderStarters, renderPackage][state.step](p)}
    <div class="nav-row">
      <button class="btn" data-action="prev-step" ${state.step === 0 ? "disabled" : ""}>${esc(tt("back"))}</button>
      ${state.step === STEPS.length - 1 ? "" : `<button class="btn primary" data-action="next-step">${esc(tt("next"))}</button>`}
    </div>
  `;
}

let fieldSeq = 0;
function field(label, inner, hint, extra = "") {
  const id = `fld-${++fieldSeq}`;
  const hintId = hint ? `${id}-hint` : "";
  const labeled = String(inner).replace(
    /<(input|textarea|select)\b(?![^>]*\bid=)/,
    `<$1 id="${id}"${hintId ? ` aria-describedby="${hintId}"` : ""}`
  );
  return `<div class="field"><div class="field-top"><label for="${id}">${esc(label)}</label>${extra}</div>${hint ? ` <span class="hint" id="${hintId}">${esc(hint)}</span>` : ""}${labeled}</div>`;
}
function mdToggle(path) {
  const on = !!state.mdPreview[path];
  return `<span class="md-switch" role="group" aria-label="${esc(tt("mdToggleAria"))}">
    <button type="button" class="btn sm ${on ? "" : "is-on"}" data-action="md-mode" data-path="${esc(path)}" data-mode="edit" aria-pressed="${on ? "false" : "true"}">${esc(tt("mdEdit"))}</button>
    <button type="button" class="btn sm ${on ? "is-on" : ""}" data-action="md-mode" data-path="${esc(path)}" data-mode="preview" aria-pressed="${on ? "true" : "false"}">${esc(tt("mdPreview"))}</button>
  </span>`;
}
function mdArea(path, value, cls = "", placeholder = "") {
  const on = !!state.mdPreview[path];
  const ph = placeholder ? ` placeholder="${esc(placeholder)}"` : "";
  return `<textarea class="${cls}${on ? " is-hidden" : ""}" data-field="${esc(path)}"${ph}>${esc(value || "")}</textarea>
    <div class="md-preview${on ? "" : " is-hidden"}" data-md-for="${esc(path)}">${renderMarkdown(value || "")}</div>`;
}
function getPath(obj, path) {
  return String(path || "").split(".").reduce((cur, key) => (cur == null ? undefined : cur[key]), obj);
}
function textInput(path, value, extra = "") {
  return `<input type="text" data-field="${esc(path)}" value="${esc(value || "")}" ${extra} />`;
}
function area(path, value, cls = "") {
  return `<textarea class="${cls}" data-field="${esc(path)}">${esc(value || "")}</textarea>`;
}

let welcomeIconCache = { key: "", url: "" };
function welcomeShowcase() {
  const id = state.lastAgentId;
  const fromStore = id && state.store.projects.find((p) => p.id === id);
  const latest = state.store.projects.slice().sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0];
  const raw = fromStore || latest;
  if (raw) {
    try { return normalizeProject(raw); } catch { return raw; }
  }
  return createFromTemplate("customer-service");
}
function showcaseIconUrl(project) {
  const key = `${project.id || project.templateId}:${project.icons?.colorBg || ""}:${project.icons?.initials || ""}:${project.name || ""}`;
  if (welcomeIconCache.key === key) return welcomeIconCache.url;
  try {
    const icons = (() => { try { return generateIconsViaCanvas(project); } catch { return generateIcons(project); } })();
    welcomeIconCache = { key, url: bytesToDataUrl(icons.color) };
  } catch {
    welcomeIconCache = { key, url: "" };
  }
  return welcomeIconCache.url;
}
function renderWelcome() {
  const showcase = welcomeShowcase();
  const welcomeIcon = showcaseIconUrl(showcase);
  const mockChips = ((showcase.conversationStarters || []).filter((s) => (s.title || s.text || "").trim()).slice(0, 3));
  const chipFallback = (showcase.skills || []).map((s) => s.name).filter(Boolean).slice(0, 3);
  const chips = mockChips.length ? mockChips.map((s) => s.title || s.text) : chipFallback;
  const mockSub = (showcase.description || "").replace(/\s+/g, " ").trim();
  const mockSubShort = mockSub.length > 96 ? `${mockSub.slice(0, 93)}…` : mockSub;
  const skillN = (showcase.skills || []).length;
  const zipName = `${slugify(showcase.name || "agent")}-copilot-agent.zip`;
  const feature = (icon, key) => `
    <article class="feature">
      <span class="feature-ico" aria-hidden="true">${icon}</span>
      <h3>${esc(tt(`${key}Title`))}</h3>
      <p>${esc(tt(`${key}Text`))}</p>
    </article>`;
  const ico = {
    skills: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M5 4h11l3 3v13H5z"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>',
    plugin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0z"/><path d="M12 17v4"/></svg>',
    pack: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 7l9-4 9 4-9 4z"/><path d="M3 7v10l9 4 9-4V7M12 11v10"/></svg>',
    offline: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
  };
  const drafts = state.store.projects.slice(0, 3);
  const continueRow = drafts.length ? `
    <section class="continue">
      <h2 class="section-title">${esc(tt("continueTitle"))}</h2>
      <div class="continue-grid">
        ${drafts.map((d) => `
          <button class="draft-card" data-action="open-draft" data-id="${esc(d.id)}">
            <span class="tpl-ico">${esc((d.icons?.initials || "A").slice(0, 2))}</span>
            <span><strong>${esc(d.name)}</strong><span>${esc(tt("edited"))} ${esc(String(d.updatedAt || "").slice(0, 10))}</span></span>
          </button>`).join("")}
      </div>
    </section>` : "";
  return `
    <section class="landing-hero">
      <div class="landing-copy">
        <p class="eyebrow">${esc(tt("heroEyebrow"))}</p>
        <h2 class="display">${esc(tt("heroTitle"))}</h2>
        <p class="lede big">${esc(tt("heroBlurb"))}</p>
        <div class="btn-row">
          <button class="btn gold lg" data-action="quick-start">${esc(tt("quickStartGo"))} →</button>
          <button class="btn lg" data-action="scroll-templates">${esc(tt("browseTemplates"))}</button>
          <button class="btn ghost lg" data-action="import-zip">${esc(tt("importZip"))}</button>
        </div>
        <ul class="trust">
          <li>${esc(tt("trust1"))}</li>
          <li>${esc(tt("trust2"))}</li>
          <li>${esc(tt("trust3"))}</li>
        </ul>
      </div>
      <div class="landing-visual" aria-hidden="true">
        <div class="mock-card">
          <div class="mock-head">
            ${welcomeIcon ? `<img src="${welcomeIcon}" alt="" width="44" height="44" />` : ""}
            <div><strong>${esc(showcase.name)}</strong><span>${esc(mockSubShort || tt("mockSub"))}</span></div>
          </div>
          <div class="mock-chips">
            ${(chips.length ? chips : [tt("mockChip1"), tt("mockChip2"), tt("mockChip3")]).map((c) => `<span>${esc(c)}</span>`).join("")}
          </div>
          <div class="mock-compose">${esc(tt("previewCompose"))}</div>
        </div>
        <div class="mock-pack">
          <div class="mock-pack-title">${esc(zipName)}</div>
          <ul>
            <li><b>manifest.json</b><em>1.29</em></li>
            <li><b>declarativeAgent.json</b><em>v1.9</em></li>
            <li><b>plugin.json</b><em>v2.4</em></li>
            <li><b>skills/…/SKILL.md</b><em>× ${skillN}</em></li>
            <li><b>color.png · outline.png</b><em>192 · 32</em></li>
          </ul>
          <div class="mock-ok">✓ ${esc(tt("mockValid"))}</div>
        </div>
      </div>
    </section>
    <section class="features">
      ${feature(ico.skills, "feat1")}
      ${feature(ico.plugin, "feat2")}
      ${feature(ico.pack, "feat3")}
      ${feature(ico.offline, "feat4")}
    </section>
    <section class="how-strip">
      <h2 class="section-title">${esc(tt("howItWorks"))}</h2>
      <ol>
        <li><span>1</span><div><strong>${esc(tt("how1Title"))}</strong><p>${esc(tt("how1"))}</p></div></li>
        <li><span>2</span><div><strong>${esc(tt("how2Title"))}</strong><p>${esc(tt("how2"))}</p></div></li>
        <li><span>3</span><div><strong>${esc(tt("how3Title"))}</strong><p>${esc(tt("how3"))}</p></div></li>
      </ol>
    </section>
    ${continueRow}
    <section class="team-library" id="team-library">
      <h2 class="section-title">${esc(tt("teamLibrary"))}</h2>
      <p class="lede">${esc(tt("teamLibraryLede"))}</p>
      <div class="btn-row">
        <button class="btn gold" type="button" data-action="export-library">${esc(tt("exportLibrary"))}</button>
        <button class="btn" type="button" data-action="import-library">${esc(tt("importLibrary"))}</button>
      </div>
    </section>
    <section id="welcome-templates">
      <h2 class="section-title">${esc(tt("templatesTitle"))}</h2>
      <p class="lede">${esc(tt("templatesLede").replace("{n}", String(TEMPLATE_LIST.length)))}</p>
      <div class="welcome-grid">
        ${TEMPLATE_LIST.map((tpl) => `
          <button class="tpl-tile" data-action="use-template" data-id="${esc(tpl.id)}" style="--tpl:${esc(tpl.accent)}">
            <span class="tpl-ico">${tpl.icon}</span>
            <strong>${esc(tpl.name[state.lang])}</strong>
            <span class="tpl-blurb">${esc(tpl.blurb[state.lang])}</span>
            <span class="tpl-tag">${esc(tpl.audience[state.lang])}</span>
          </button>`).join("")}
      </div>
    </section>
    <footer class="landing-foot">
      <span>${esc(tt("footer"))}</span>
      <div class="btn-row">
        <button class="btn ghost" type="button" data-action="export-library">${esc(tt("exportLibrary"))}</button>
        <button class="btn ghost" type="button" data-action="import-library">${esc(tt("importLibrary"))}</button>
        <button class="btn ghost" type="button" data-action="import-json">${esc(tt("importProject"))}</button>
      </div>
    </footer>
  `;
}

function renderCopilotPreview(p) {
  const icons = currentIcons();
  const colorUrl = icons ? bytesToDataUrl(icons.color) : "";
  const starters = (p.conversationStarters || []).filter((s) => (s.text || "").trim());
  return `
    <section class="copilot-preview" aria-label="${esc(tt("previewAria"))}">
      <div class="preview-badge">${esc(tt("previewBadge"))}</div>
      <div class="section-label">${esc(tt("previewTitle"))}</div>
      <div class="preview-chrome">
        <div class="preview-header">
          <img class="preview-icon" alt="${esc(tt("colorIcon"))}" src="${colorUrl}" width="40" height="40" />
          <div>
            <strong>${esc(p.name || tt("newAgent"))}</strong>
            <p>${esc(p.description || "")}</p>
          </div>
        </div>
        ${starters.length ? `<div class="preview-starters" role="group" aria-label="${esc(tt("previewStarters"))}">${starters.map((s) => `<button type="button" class="preview-chip${state.previewPrompt === s.text ? " active" : ""}" data-action="preview-prompt" data-text="${esc(s.text)}" title="${esc(s.text)}">${esc(s.title || s.text)}</button>`).join("")}</div>` : ""}
        <div class="preview-compose">${esc(state.previewPrompt || tt("previewCompose"))}</div>
      </div>
      <p class="hint">${esc(tt("previewHint"))}</p>
    </section>`;
}

function renderApiPlugin(p) {
  const a = p.actions || {};
  const parsed = a.specText ? parseAndList(a.specText) : { ok: true, error: "", operations: [], spec: null };
  const selected = new Set(a.selectedOps || []);
  const ops = parsed.ok ? parsed.operations : [];
  const meta = a.operationMeta || {};
  const opRows = ops.map((op) => {
    const m = { ...emptyActionMeta(), ...(meta[op.operationId] || {}) };
    const on = selected.has(op.operationId);
    return `
      <div class="op-row ${on ? "on" : ""}">
        <label class="switch">
          <input type="checkbox" data-op-select="${esc(op.operationId)}" ${on ? "checked" : ""}/>
          <span>
            <code>${esc(op.method)}</code> ${esc(op.path)}
            <strong> ${esc(op.operationId)}</strong>
            <span class="hint">${esc(op.summary)}</span>
          </span>
        </label>
        ${on ? `
          ${field(tt("apiFnDesc"), area(`actions.operationMeta.${op.operationId}.description`, m.description || op.description))}
          <details class="sub"><summary>${esc(tt("apiOpMore"))}</summary>
          <div class="grid-2">
            ${field(tt("apiDataPath"), textInput(`actions.operationMeta.${op.operationId}.dataPath`, m.dataPath || "$"))}
            ${field(tt("apiTitlePath"), textInput(`actions.operationMeta.${op.operationId}.titlePath`, m.titlePath || ""))}
            ${field(tt("apiSubtitlePath"), textInput(`actions.operationMeta.${op.operationId}.subtitlePath`, m.subtitlePath || ""))}
            ${field(tt("apiUrlPath"), textInput(`actions.operationMeta.${op.operationId}.urlPath`, m.urlPath || ""))}
          </div>
          <label class="switch"><input type="checkbox" data-bool="actions.operationMeta.${op.operationId}.includeCard" ${m.includeCard !== false ? "checked" : ""}/> ${esc(tt("apiIncludeCard"))}</label>
          <div style="height:6px"></div>
          <label class="switch"><input type="checkbox" data-bool="actions.operationMeta.${op.operationId}.confirm" ${m.confirm ? "checked" : ""}/> ${esc(tt("apiConfirm"))}</label>
          </details>
        ` : ""}
      </div>`;
  }).join("");
  const authExtra = (a.authType === "OAuthPluginVault" || a.authType === "ApiKeyPluginVault")
    ? field(tt("apiAuthRef"), textInput("actions.authReferenceId", a.authReferenceId || ""))
    : "";
  return `
    <p class="hint" style="margin-top:10px">${esc(tt("apiPluginHint"))}</p>
    <div class="btn-row" style="margin:10px 0">
      <button class="btn gold" data-action="load-jira" type="button">${esc(tt("apiLoadJira"))}</button>
      <button class="btn" data-action="upload-openapi" type="button">${esc(tt("apiUpload"))}</button>
    </div>
    <details class="sub" ${a.specText ? "" : "open"}>
      <summary>${esc(tt("apiPaste"))}${ops.length ? ` · ${ops.length} ${esc(tt("apiFoundOps"))}` : ""}</summary>
      ${field(tt("apiPaste"), `<textarea class="code" data-field="actions.specText">${esc(a.specText || "")}</textarea>`)}
    </details>
    ${!parsed.ok && a.specText ? `<div class="issue error">${esc(parsed.error)}</div>` : ""}
    ${parsed.ok && ops.length ? `<p class="hint">${ops.length} ${esc(tt("apiFoundOps"))}${a.specSource === "jira" ? ` · ${esc(tt("apiJiraBadge"))}` : ""}.</p>` : ""}
    <div class="grid-2">
      ${field(tt("actionId"), textInput("actions.id", a.id))}
      ${field(tt("actionName"), textInput("actions.nameForHuman", a.nameForHuman))}
      ${field(tt("apiNamespace"), textInput("actions.namespace", a.namespace))}
      ${field(tt("apiSpecUrl"), textInput("actions.specUrl", a.specUrl || "openapi.yaml"))}
    </div>
    ${field(tt("description"), area("actions.descriptionForHuman", a.descriptionForHuman))}
    ${field(tt("apiModelDesc"), area("actions.descriptionForModel", a.descriptionForModel))}
    ${field(tt("apiAuth"), `
      <select data-field="actions.authType">
        <option value="None" ${a.authType === "None" ? "selected" : ""}>${esc(tt("apiAuthNone"))}</option>
        <option value="OAuthPluginVault" ${a.authType === "OAuthPluginVault" ? "selected" : ""}>${esc(tt("apiAuthOAuth"))}</option>
        <option value="ApiKeyPluginVault" ${a.authType === "ApiKeyPluginVault" ? "selected" : ""}>${esc(tt("apiAuthApiKey"))}</option>
      </select>`)}
    ${authExtra}
    <p class="hint">${esc(tt("apiAuthHint"))}</p>
    <h4 style="margin:14px 0 8px">${esc(tt("apiOps"))}</h4>
    ${opRows || `<p class="hint">${esc(tt("apiNoOps"))}</p>`}
  `;
}

function renderIdentity(p) {
  const icons = currentIcons();
  const colorUrl = icons ? bytesToDataUrl(icons.color) : "";
  const outlineUrl = icons ? bytesToDataUrl(icons.outline) : "";
  const scaffold = p.templateId === "blank" ? `<p class="hint scaffold-note">${esc(tt("scaffoldNote"))}</p>` : "";
  return `
    <h2 class="page">${esc(p.name || tt("newAgent"))}</h2>
    <p class="lede">${esc(tt("identityLede"))}</p>
    ${scaffold}
    <section class="card">
      ${field(tt("name"), textInput("name", p.name) + `<div class="counter" id="count-name">${countChars(p.name)} / ${LIMITS.DA_NAME} ${tt("chars")}</div>`)}
      ${field(tt("description"), area("description", p.description) + `<div class="counter" id="count-desc">${countChars(p.description)} / ${LIMITS.DA_DESCRIPTION} ${tt("chars")}</div>`)}
      <div class="grid-2">
        ${field(tt("shortName"), textInput("app.shortName", p.app.shortName))}
        ${field(tt("shortDescription"), textInput("app.shortDescription", p.app.shortDescription))}
      </div>
      <div class="grid-2">
        ${field(tt("websiteUrl"), textInput("app.websiteUrl", p.app.websiteUrl))}
        ${field(tt("developerName"), textInput("app.developerName", p.app.developerName))}
      </div>
    </section>
    <section class="card">
      <h3>${esc(tt("colorIcon"))} / ${esc(tt("outlineIcon"))}</h3>
      <div class="grid-2">
        ${field(tt("initials"), textInput("icons.initials", p.icons.initials, 'maxlength="2"'))}
        ${field(tt("accent"), `<input type="text" data-field="app.accentColor" value="${esc(p.app.accentColor)}" /> <input type="color" data-field="icons.colorBg" value="${esc(p.icons.colorBg || p.app.accentColor)}" aria-label="${esc(tt("accent"))}" style="height:42px;padding:4px;margin-top:8px" />`)}
      </div>
      ${p.icons.customColor || p.icons.customOutline ? `<div class="issue info">${esc(tt("customIconNote"))} <button class="btn sm" data-action="clear-custom-icon" type="button">${esc(tt("customIconClear"))}</button></div>` : ""}
      <div class="icon-preview">
        <figure><img id="icon-color" class="icon192" alt="${esc(tt("colorIcon"))}" src="${colorUrl}" /><figcaption class="hint">${esc(tt("colorIcon"))}</figcaption></figure>
        <figure><img id="icon-outline" class="icon32" alt="${esc(tt("outlineIcon"))}" src="${outlineUrl}" /><figcaption class="hint">${esc(tt("outlineIcon"))}</figcaption></figure>
      </div>
    </section>
    <section class="card">
      <button class="btn" data-action="toggle-publisher" type="button">${esc(tt(state.showPublisher ? "hidePublisher" : "openPublisher"))}</button>
      ${state.showPublisher ? `
        <div style="margin-top:14px">
          <h3>${esc(tt("advanced"))}</h3>
          <div class="grid-2">
            ${field(tt("privacyUrl"), textInput("app.privacyUrl", p.app.privacyUrl))}
            ${field(tt("termsUrl"), textInput("app.termsOfUseUrl", p.app.termsOfUseUrl))}
          </div>
          <div class="grid-2">
            ${field(tt("version"), textInput("app.version", p.app.version))}
            ${field(tt("appId"), textInput("app.id", p.app.id) + `<div style="margin-top:8px"><button class="btn" data-action="regen-guid" type="button">${esc(tt("regenerateId"))}</button></div>`)}
          </div>
        </div>` : `<p class="hint" style="margin-top:8px">${esc(tt("privacyUrl"))} / ${esc(tt("termsUrl"))} / GUID</p>`}
    </section>
  `;
}

function skillMdFor(p, i) {
  const s = p.skills?.[i];
  if (!s || s.skillMd === false || !(s.name || "").trim()) return null;
  const derived = deriveAgentSkills({ skills: p.skills.slice(0, i + 1) });
  return derived[derived.length - 1] || null;
}

let skillLibrary = null;
function getSkillLibrary() {
  if (skillLibrary) return skillLibrary;
  skillLibrary = TEMPLATE_LIST.filter((t) => t.id !== "blank").map((t) => ({
    tpl: t,
    skills: createFromTemplate(t.id).skills || [],
  }));
  return skillLibrary;
}

function stepCount(how) {
  return String(how || "").split(/\n/).filter((l) => /^\s*(\d+[.)]|[-*])\s+/.test(l)).length;
}

function renderSkillCard(p, s, i) {
  const open = state.openSkill === i;
  const md = skillMdFor(p, i);
  const steps = stepCount(s.how);
  const whenShort = (s.when || "").replace(/\s+/g, " ").trim();
  const last = (p.skills || []).length - 1;
  return `
    <details class="skill-card" data-skill-index="${i}" ${open ? "open" : ""}>
      <summary>
        <span class="skill-num">${i + 1}</span>
        <span class="skill-sum">
          <strong data-skill-title="${i}">${esc((s.name || "").trim() || tt("untitledSkill"))}</strong>
          <span data-skill-sub="${i}">${esc(whenShort.length > 110 ? `${whenShort.slice(0, 107)}…` : whenShort || tt("skillWhenEmpty"))}</span>
        </span>
        <span class="chips">
          ${steps ? `<span class="chip">${steps} ${esc(tt("stepsShort"))}</span>` : ""}
          ${md ? `<span class="chip gold">SKILL.md</span>` : `<span class="chip muted">${esc(tt("instructionsOnly"))}</span>`}
        </span>
        <span class="chev" aria-hidden="true"></span>
      </summary>
      <div class="skill-body">
        ${field(tt("skillName"), textInput(`skills.${i}.name`, s.name, `placeholder="${esc(tt("skillNamePh"))}"`))}
        <div class="grid-2">
          ${field(tt("skillWhen"), mdArea(`skills.${i}.when`, s.when, "", tt("skillWhenPh")), tt("skillWhenHint"), mdToggle(`skills.${i}.when`))}
          ${field(tt("skillOutput"), mdArea(`skills.${i}.output`, s.output, "", tt("skillOutputPh")), tt("skillOutputHint"), mdToggle(`skills.${i}.output`))}
        </div>
        ${field(tt("skillHow"), mdArea(`skills.${i}.how`, s.how, "tall", tt("skillHowPh")), tt("skillHowHint"), mdToggle(`skills.${i}.how`))}
        <details class="sub">
          <summary>${esc(tt("skillMoreTitle"))}</summary>
          ${field(tt("skillExample"), mdArea(`skills.${i}.example`, s.example, "tall", tt("skillExamplePh")), tt("skillExampleHint"), mdToggle(`skills.${i}.example`))}
          <div class="grid-2">
            ${field(tt("skillFolder"), textInput(`skills.${i}.folder`, s.folder || "", `placeholder="${esc(skillFolderFor({ ...s, folder: "" }))}"`))}
            ${field(tt("skillDesc"), textInput(`skills.${i}.description`, s.description || "", `placeholder="${esc(tt("skillDescPh"))}"`))}
          </div>
          ${md ? `<div class="field"><label>${esc(tt("skillMdPreview"))} · <code>${esc(md.folder)}/SKILL.md</code></label><pre class="json small" data-skill-md="${i}">${esc(compileSkillMarkdown(md))}</pre></div>` : ""}
        </details>
        <div class="skill-foot">
          <label class="switch"><input type="checkbox" data-bool="skills.${i}.skillMd" ${s.skillMd !== false ? "checked" : ""}/> ${esc(tt("skillMdToggle"))}</label>
          <span class="spacer"></span>
          <button class="btn sm" data-action="move-skill" data-index="${i}" data-dir="-1" ${i === 0 ? "disabled" : ""} aria-label="${esc(tt("moveUp"))}" title="${esc(tt("moveUp"))}">↑</button>
          <button class="btn sm" data-action="move-skill" data-index="${i}" data-dir="1" ${i === last ? "disabled" : ""} aria-label="${esc(tt("moveDown"))}" title="${esc(tt("moveDown"))}">↓</button>
          <button class="btn sm danger" data-action="remove-skill" data-index="${i}">${esc(tt("removeSkill"))}</button>
        </div>
      </div>
    </details>`;
}

function renderSkills(p) {
  const compiled = compileInstructions(p);
  const n = compiled.length;
  const cls = n > LIMITS.DA_INSTRUCTIONS ? "hot" : n > LIMITS.DA_INSTRUCTIONS - 400 ? "warn" : "";
  const pct = Math.min(100, Math.round((n / LIMITS.DA_INSTRUCTIONS) * 100));
  const raw = p.instructionsMode === "raw";
  const mdCount = deriveAgentSkills(p).length;
  const lib = getSkillLibrary();
  const libSelect = `
    <select class="lib-select" data-library aria-label="${esc(tt("libraryPick"))}">
      <option value="">${esc(tt("libraryPick"))}</option>
      ${lib.map((g, gi) => `<optgroup label="${esc(g.tpl.name[state.lang])}">${g.skills.map((sk, si) => `<option value="${gi}:${si}">${esc(sk.name)}</option>`).join("")}</optgroup>`).join("")}
    </select>`;
  const skillCards = (p.skills || []).map((s, i) => renderSkillCard(p, s, i)).join("");
  return `
    <h2 class="page">${esc(tt("stepSkills"))}</h2>
    <p class="lede">${esc(tt("skillsLede"))}</p>
    <section class="card chef">
      <div class="card-head"><span class="badge-ico" aria-hidden="true">👩‍🍳</span><div><h3>${esc(tt("chefTitle"))}</h3><p class="hint">${esc(tt("chefHint"))}</p></div></div>
      ${raw ? `
        <div class="issue info">${esc(tt("rawActive"))}</div>
        ${field(tt("rawLabel"), area("instructionsRaw", p.instructionsRaw, "tall code-ish"))}
        <button class="btn" data-action="mode-structured">${esc(tt("structuredMode"))}</button>
      ` : `
        ${field(tt("role"), `<textarea class="tall" data-field="role" placeholder="${esc(tt("rolePh"))}">${esc(p.role || "")}</textarea>`, tt("roleFieldHint"))}
        <div class="grid-2">
          ${field(tt("style"), area("style", p.style))}
          ${field(tt("guardrails"), area("guardrails", p.guardrails))}
        </div>
      `}
    </section>
    <div class="skills-head">
      <h3>${esc(tt("skills"))} <span class="count">${(p.skills || []).length}</span></h3>
      <div class="btn-row">
        ${libSelect}
        <button class="btn gold" data-action="add-skill">+ ${esc(tt("addSkill"))}</button>
      </div>
    </div>
    ${skillCards || `<div class="empty">${esc(tt("noSkills"))}</div>`}
    <section class="card result-card">
      <div class="result-row">
        <div>
          <strong>${esc(tt("resultTitle"))}</strong>
          <p class="hint">${esc(tt("resultHint").replace("{n}", String(mdCount)))}</p>
        </div>
        <div class="meter ${cls}" aria-hidden="true"><span style="width:${pct}%"></span></div>
        <div class="counter ${cls}" id="count-instr">${n} / ${LIMITS.DA_INSTRUCTIONS} ${tt("chars")}</div>
      </div>
      <details class="sub">
        <summary>${esc(tt("compiledPreview"))}</summary>
        <pre class="json" id="compiled-preview">${esc(compiled)}</pre>
        ${raw ? "" : `<button class="btn" data-action="mode-raw">${esc(tt("rawMode"))}</button>`}
      </details>
    </section>
  `;
}

function linesOf(arr) {
  return (arr || []).join("\n");
}

function renderCapabilities(p) {
  const c = p.capabilities;
  const cards = Object.keys(c).map((name) => {
    const cap = c[name];
    let extra = "";
    if (cap.enabled && name === "WebSearch") extra = field(tt("webSearchSites"), `<textarea data-list="capabilities.WebSearch.sites">${esc(linesOf(cap.sites))}</textarea>`);
    if (cap.enabled && name === "OneDriveAndSharePoint") extra = field(tt("sharePointUrls"), `<textarea data-list="capabilities.OneDriveAndSharePoint.urls">${esc(linesOf(cap.urls))}</textarea>`);
    if (cap.enabled && name === "GraphConnectors") extra = field(tt("connectorIds"), `<textarea data-list="capabilities.GraphConnectors.connectionIds">${esc(linesOf(cap.connectionIds))}</textarea>`);
    if (cap.enabled && name === "TeamsMessages") extra = field(tt("teamsUrls"), `<textarea data-list="capabilities.TeamsMessages.urls">${esc(linesOf(cap.urls))}</textarea>`);
    if (cap.enabled && name === "Email") {
      extra = field(tt("emailMailbox"), textInput("capabilities.Email.sharedMailbox", cap.sharedMailbox)) +
        field(tt("emailFolders"), `<textarea data-list="capabilities.Email.folders">${esc(linesOf(cap.folders))}</textarea>`);
    }
    if (cap.enabled && name === "People") {
      extra = `<label class="switch"><input type="checkbox" data-bool="capabilities.People.includeRelatedContent" ${cap.includeRelatedContent ? "checked" : ""}/> ${esc(tt("peopleRelated"))}</label>`;
    }
    if (cap.enabled && name === "Dataverse") {
      extra = field(tt("dataverseHost"), textInput("capabilities.Dataverse.hostName", cap.hostName)) +
        field(tt("dataverseSkill"), textInput("capabilities.Dataverse.skill", cap.skill)) +
        field(tt("dataverseTables"), `<textarea data-list="capabilities.Dataverse.tables">${esc(linesOf(cap.tables))}</textarea>`);
    }
    if (cap.enabled && name === "ScenarioModels") extra = field(tt("modelIds"), `<textarea data-list="capabilities.ScenarioModels.modelIds">${esc(linesOf(cap.modelIds))}</textarea>`);
    if (cap.enabled && name === "EmbeddedKnowledge") {
      const files = p.embeddedFiles || [];
      const list = files.map((f, i) => `
        <div class="file-row">
          <span>${esc(f.file)} <span class="hint">(${Math.round((f.size || 0) / 1024)} KB)</span></span>
          <button class="btn danger" data-action="remove-embedded" data-index="${i}">${esc(tt("removeFile"))}</button>
        </div>`).join("") || `<p class="hint">${esc(tt("embeddedHint"))}</p>`;
      extra = `
        <div class="field"><label>${esc(tt("embeddedFiles"))}</label>
          ${list}
          <div class="btn-row" style="margin-top:8px">
            <button class="btn" data-action="pick-embedded" type="button">${esc(tt("embeddedPick"))}</button>
          </div>
          <p class="hint">${esc(tt("embeddedHint"))}</p>
        </div>`;
    }
    return `
      <div class="cap ${cap.enabled ? "on" : ""}">
        <div class="cap-top">
          <div>
            <h4>${esc(capName(name))}</h4>
            <div class="hint">${esc(capHelp(name))}</div>
          </div>
          <label class="switch"><input type="checkbox" data-bool="capabilities.${name}.enabled" ${cap.enabled ? "checked" : ""}/></label>
        </div>
        ${extra ? `<div style="margin-top:10px">${extra}</div>` : ""}
      </div>`;
  }).join("");
  return `
    <h2 class="page">${esc(tt("stepCapabilities"))}</h2>
    <p class="lede">${esc(tt("capabilitiesHint"))}</p>
    <div class="cap-grid">${cards}</div>
    <section class="card" style="margin-top:14px">
      <label class="switch">
        <input type="checkbox" data-bool="actions.enabled" ${p.actions.enabled ? "checked" : ""}/>
        ${esc(tt("actionsToggle"))}
      </label>
      ${p.actions.enabled ? renderApiPlugin(p) : ""}
    </section>
    ${renderAdvancedV19(p)}
  `;
}

function renderAdvancedV19(p) {
  const enabledCaps = Object.keys(p.capabilities || {}).filter((n) => p.capabilities[n]?.enabled);
  const overrides = new Set(p.userOverrideCaps || []);
  const workers = (p.workerAgents || []).map((w, i) => `
    <div class="skill">
      <div class="skill-head"><strong>${i + 1}</strong>
        <button type="button" class="btn danger" data-action="remove-worker" data-index="${i}" aria-label="${esc(tt("removeWorker"))}">×</button>
      </div>
      <div class="grid-2">
        ${field(tt("workerId"), textInput(`workerAgents.${i}.id`, w.id || ""))}
        ${field(tt("workerFile"), textInput(`workerAgents.${i}.file`, w.file || ""))}
      </div>
    </div>`).join("");
  const overrideToggles = enabledCaps.map((name) => `
    <label class="switch" style="display:flex;margin-bottom:6px">
      <input type="checkbox" data-override="${esc(name)}" ${overrides.has(name) ? "checked" : ""}/>
      ${esc(capName(name))}
    </label>`).join("") || `<p class="hint">—</p>`;
  return `
    <details class="card adv" style="margin-top:14px">
      <summary><h3>${esc(tt("advancedCaps"))}</h3><span class="hint">${esc(tt("advancedCapsHint"))}</span></summary>
      ${field(tt("sensitivityLabel"), textInput("sensitivityLabelId", p.sensitivityLabelId || "") + `<p class="hint">${esc(tt("sensitivityHint"))}</p>`)}
      <h4 style="margin:14px 0 8px">${esc(tt("userOverrides"))}</h4>
      ${overrideToggles}
      <h4 style="margin:14px 0 8px">${esc(tt("workerAgents"))}</h4>
      ${workers}
      <button class="btn" data-action="add-worker">${esc(tt("addWorker"))}</button>
      <h4 style="margin:14px 0 8px">${esc(tt("agentSkills"))}</h4>
      <p class="hint">${esc(tt("skillMdEditHere"))} <button class="btn sm" data-action="goto-step" data-step="1" type="button">${esc(tt("stepSkills"))}</button></p>
    </details>`;
}

function renderStarters(p) {
  const items = (p.conversationStarters || []).map((s, i) => `
    <div class="skill">
      <div class="skill-head">
        <strong>${i + 1}</strong>
        <button type="button" class="btn danger" data-action="remove-starter" data-index="${i}" aria-label="${esc(tt("removeStarter"))}">×</button>
      </div>
      ${field(tt("starterTitle"), textInput(`conversationStarters.${i}.title`, s.title))}
      ${field(tt("starterText"), area(`conversationStarters.${i}.text`, s.text))}
    </div>`).join("");
  return `
    <h2 class="page">${esc(tt("stepStarters"))}</h2>
    <section class="card">
      <h3>${esc(tt("starters"))}</h3>
      ${items}
      <button class="btn gold" data-action="add-starter" ${(p.conversationStarters || []).length >= LIMITS.STARTERS ? "disabled" : ""}>${esc(tt("addStarter"))}</button>
    </section>
    <section class="card">
      <h3>${esc(tt("editorialAnswers"))}</h3>
      ${(p.editorialAnswers || []).map((a, i) => `
        <div class="skill">
          <div class="skill-head"><strong>${i + 1}</strong>
            <button type="button" class="btn danger" data-action="remove-answer" data-index="${i}" aria-label="${esc(tt("removeAnswer"))}">×</button>
          </div>
          ${field(tt("answerQ"), textInput(`editorialAnswers.${i}.question`, a.question || ""))}
          ${field(tt("answerA"), area(`editorialAnswers.${i}.answer`, a.answer || ""))}
        </div>`).join("")}
      <button class="btn gold" data-action="add-answer">${esc(tt("addAnswer"))}</button>
    </section>
    <section class="card">
      ${field(tt("disclaimer"), area("disclaimer", p.disclaimer) + `<div class="counter">${countChars(p.disclaimer)} / ${LIMITS.DISCLAIMER}</div>`)}
      <h3>${esc(tt("behavior"))}</h3>
      <label class="switch"><input type="checkbox" data-bool="behavior.discourageModelKnowledge" ${p.behavior.discourageModelKnowledge ? "checked" : ""}/> ${esc(tt("discourageKnowledge"))}</label>
      <div style="height:8px"></div>
      <label class="switch"><input type="checkbox" data-bool="behavior.disableSuggestions" ${p.behavior.disableSuggestions ? "checked" : ""}/> ${esc(tt("disableSuggestions"))}</label>
      <div style="margin-top:12px">
        ${field(tt("responseMode"), `
          <select data-field="behavior.defaultResponseMode">
            <option ${p.behavior.defaultResponseMode === "Auto" ? "selected" : ""}>Auto</option>
            <option ${p.behavior.defaultResponseMode === "Quick response" ? "selected" : ""}>Quick response</option>
            <option ${p.behavior.defaultResponseMode === "Think deeper" ? "selected" : ""}>Think deeper</option>
          </select>`)}
      </div>
    </section>
  `;
}

function packageFileList(p) {
  try {
    const icons = currentIcons();
    return buildPackageFiles(p, icons || {}).files;
  } catch {
    return {};
  }
}

function fmtSize(n) {
  return n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`;
}

function renderPackage(p) {
  const result = validateNow();
  const files = packageFileList(p);
  const names = Object.keys(files).sort((a, b) => {
    const rank = (n) => (n === "manifest.json" ? 0 : n === "declarativeAgent.json" ? 1 : n === "instruction.txt" ? 2 : n === "plugin.json" ? 3 : n.startsWith("skills/") ? 5 : n.endsWith(".png") ? 6 : 4);
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  if (!names.includes(state.previewKind)) state.previewKind = "declarativeAgent.json";
  const sel = state.previewKind;
  const content = files[sel];
  const isText = typeof content === "string";
  const size = (v) => (typeof v === "string" ? new TextEncoder().encode(v).length : v?.length || 0);
  const errors = [...result.fieldErrors, ...result.schemaErrors];
  const a = p.actions || {};
  const urlsReal = !/example\.com/i.test(`${p.app.websiteUrl} ${p.app.privacyUrl} ${p.app.termsOfUseUrl}`);
  const authOk = !a.enabled || a.authType === "None" || ((a.authReferenceId || "").trim() && a.authReferenceId.trim() !== "jira-api-key");
  const hostOk = !a.enabled || !/\{yourDomain\}|yourDomain/.test(a.specText || "") || a.specSource !== "jira";
  const check = (ok, key, optional = false) => `<li class="${ok ? "ok" : optional ? "todo" : "todo"}"><span class="tick" aria-hidden="true">${ok ? "✓" : "○"}</span>${esc(tt(key))}</li>`;
  const zipName = `${slugify(p.name)}-copilot-agent.zip`;
  return `
    <h2 class="page">${esc(tt("stepPackage"))}</h2>
    <p class="lede">${esc(tt("packageLede"))}</p>
    <section class="card export-hero ${result.ok ? "is-ok" : "is-bad"}">
      <div class="export-status">
        <span class="status-dot" aria-hidden="true">${result.ok ? "✓" : "!"}</span>
        <div>
          <strong>${esc(result.ok ? tt("ready") : tt("notReady"))}</strong>
          <p class="hint">${result.ok ? esc(tt("readyHint").replace("{n}", String(names.length))) : errors.slice(0, 3).map((e) => esc(msg(e))).join("<br>")}</p>
        </div>
      </div>
      <div class="export-cta">
        <button class="btn gold lg" data-action="export-zip" ${result.ok ? "" : "disabled"}>${esc(tt("exportZip"))}</button>
        <code>${esc(zipName)}</code>
      </div>
    </section>
    <div class="pkg-grid">
      <section class="card">
        <h3>${esc(tt("publishTitle"))}</h3>
        <ul class="checklist">
          ${check(urlsReal, "check1")}
          ${a.enabled ? check(authOk, "check2") : ""}
          ${a.enabled && a.specSource === "jira" ? check(hostOk, "check3") : ""}
          ${check(result.ok, "check4")}
        </ul>
        <h4 class="mini">${esc(tt("afterExport"))}</h4>
        <ol class="how-list">
          <li>${esc(tt("publish3"))}</li>
          <li>${esc(tt("publish4"))}</li>
          <li>${esc(tt("publish5"))}</li>
        </ol>
      </section>
      <section class="card">
        <h3>${esc(tt("moreActions"))}</h3>
        <div class="btn-col">
          <button type="button" class="btn" data-action="export-json">${esc(tt("exportProject"))}</button>
          <button type="button" class="btn" data-action="export-library">${esc(tt("exportLibrary"))}</button>
          <button type="button" class="btn" data-action="print-spec">${esc(tt("printSpec"))}</button>
          <button type="button" class="btn" data-action="import-zip">${esc(tt("importZip"))}</button>
          <button type="button" class="btn" data-action="import-json">${esc(tt("importProject"))}</button>
          <button type="button" class="btn" data-action="import-library">${esc(tt("importLibrary"))}</button>
          <button type="button" class="btn" data-action="backup-all">${esc(tt("shareBackup"))}</button>
          ${state.store.projects.length ? `<button class="btn danger" data-action="delete-draft">${esc(tt("deleteDraft"))}</button>` : ""}
        </div>
      </section>
    </div>
    <section class="card">
      <h3>${esc(tt("zipContents"))} <span class="count">${names.length}</span></h3>
      <div class="file-browser">
        <ul class="file-list" aria-label="${esc(tt("zipContents"))}">
          ${names.map((n) => `<li><button type="button" class="file-btn ${n === sel ? "active" : ""}" data-action="preview-file" data-file="${esc(n)}" aria-current="${n === sel ? "true" : "false"}"><span>${esc(n)}</span><em>${fmtSize(size(files[n]))}</em></button></li>`).join("")}
        </ul>
        <div class="file-view">
          <div class="file-view-head"><code>${esc(sel)}</code>${isText ? `<button class="btn sm" data-action="copy-json">${esc(tt("copy"))}</button>` : ""}</div>
          ${isText ? `<pre class="json" id="json-preview">${esc(content)}</pre>` : content ? `<div class="png-view"><img alt="${esc(sel)}" src="${bytesToDataUrl(content)}" /></div>` : ""}
        </div>
      </div>
    </section>
  `;
}

function validateNow() {
  if (!state.project) return { ok: false, fieldErrors: [], warnings: [], schemaErrors: [], da: {}, manifest: {} };
  if (state.validators) return validateGenerated(state.project, state.validators);
  const field = collectFieldErrors(state.project);
  return {
    ok: field.errors.length === 0,
    fieldErrors: field.errors,
    warnings: field.warnings,
    schemaErrors: [],
    da: buildDeclarativeAgent(state.project),
    manifest: buildTeamsManifest(state.project),
    instructions: field.instructions,
    instructionsLength: field.instructionsLength,
  };
}

function renderAside() {
  if (!state.project) return `<p class="hint">${esc(tt("emptyHint"))}</p>`;
  const result = validateNow();
  const lint = lintInstructions(state.project);
  const tests = suggestedTestPrompts(state.project, state.lang);
  const errors = [...result.fieldErrors, ...result.schemaErrors];
  const errorHtml = errors.length
    ? `<div class="issue-label">${esc(tt("errors"))}</div>` + errors.map((e) => `<div class="issue error">${esc(msg(e))}</div>`).join("")
    : `<div class="issue ok">${esc(tt("ready"))}</div>`;
  const warnHtml = result.warnings.length
    ? `<div class="issue-label">${esc(tt("warnings"))}</div>` + result.warnings.map((e) => `<div class="issue warn">${esc(msg(e))}</div>`).join("")
    : "";
  const lintHtml = lint.issues.map((i) => `
    <div class="issue ${i.level === "error" ? "error" : i.level === "warn" ? "warn" : "info"}">
      <b>${esc(msg(i))}</b>
      ${esc(state.lang === "en" ? i.fixEn : i.fixSv)}
    </div>`).join("");
  const suggestHtml = lint.suggestions.map((s) => `<div class="issue info">${esc(msg(s))}</div>`).join("");
  return `
    ${renderCopilotPreview(state.project)}
    <div class="section-label">${esc(tt("validation"))}</div>
    ${errorHtml}${warnHtml}
    <div class="section-label">${esc(tt("quality"))}</div>
    <div class="score">
      <div class="score-ring" style="--p:${lint.score}"><span>${lint.score}</span></div>
      <div>
        <strong>${esc(tt("score"))}</strong>
        <div class="hint">${lint.length} / ${LIMITS.DA_INSTRUCTIONS} ${esc(tt("chars"))}</div>
      </div>
    </div>
    ${lintHtml}${suggestHtml}
    <div class="section-label">${esc(tt("tests"))}</div>
    ${tests.map((q) => `<button type="button" class="test-q" data-action="copy-prompt" data-text="${esc(q)}">${esc(q)}</button>`).join("")}
    <p class="hint" style="margin-top:18px">${esc(tt("footer"))}</p>
  `;
}

function refreshDynamic() {
  if (!state.project) return;
  const compiled = compileInstructions(state.project);
  const counter = $("count-instr");
  if (counter) {
    counter.textContent = `${compiled.length} / ${LIMITS.DA_INSTRUCTIONS} ${tt("chars")}`;
    counter.classList.toggle("hot", compiled.length > LIMITS.DA_INSTRUCTIONS);
    counter.classList.toggle("warn", compiled.length > LIMITS.DA_INSTRUCTIONS - 400 && compiled.length <= LIMITS.DA_INSTRUCTIONS);
  }
  const preview = $("compiled-preview");
  if (preview) preview.textContent = compiled;
  document.querySelectorAll("[data-skill-title]").forEach((node) => {
    const s = state.project.skills?.[Number(node.dataset.skillTitle)];
    if (s) node.textContent = (s.name || "").trim() || tt("untitledSkill");
  });
  document.querySelectorAll("[data-skill-sub]").forEach((node) => {
    const s = state.project.skills?.[Number(node.dataset.skillSub)];
    if (!s) return;
    const w = (s.when || "").replace(/\s+/g, " ").trim();
    node.textContent = w.length > 110 ? `${w.slice(0, 107)}…` : w || tt("skillWhenEmpty");
  });
  document.querySelectorAll("[data-skill-md]").forEach((node) => {
    const md = skillMdFor(state.project, Number(node.dataset.skillMd));
    if (md) node.textContent = compileSkillMarkdown(md);
  });
  document.querySelectorAll("[data-md-for]").forEach((node) => {
    node.innerHTML = renderMarkdown(getPath(state.project, node.dataset.mdFor) || "");
  });
  const meter = document.querySelector(".result-card .meter span");
  if (meter) meter.style.width = `${Math.min(100, Math.round((compiled.length / LIMITS.DA_INSTRUCTIONS) * 100))}%`;
  const activeDraft = document.querySelector(".sidebar .draft-card.active strong");
  if (activeDraft) activeDraft.textContent = state.project.name;
  const activeIco = document.querySelector(".sidebar .draft-card.active .tpl-ico");
  if (activeIco) activeIco.textContent = (state.project.icons?.initials || "A").slice(0, 2);
  const nameC = $("count-name");
  if (nameC) nameC.textContent = `${countChars(state.project.name)} / ${LIMITS.DA_NAME} ${tt("chars")}`;
  const descC = $("count-desc");
  if (descC) descC.textContent = `${countChars(state.project.description)} / ${LIMITS.DA_DESCRIPTION} ${tt("chars")}`;
  const aside = $("aside");
  if (aside) aside.innerHTML = renderAside();
  updateIconPreview();
}

function updateIconPreview() {
  const color = $("icon-color");
  const outline = $("icon-outline");
  if (!color || !state.project) return;
  const icons = currentIcons();
  color.src = bytesToDataUrl(icons.color);
  if (outline) outline.src = bytesToDataUrl(icons.outline);
}

function downloadBytes(filename, bytes, mime) {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function downloadText(filename, text, mime) {
  downloadBytes(filename, new TextEncoder().encode(text), mime);
}

async function exportZip() {
  const result = validateNow();
  if (!result.ok) return;
  const icons = currentIcons();
  const { bytes } = await buildZip(state.project, icons, JSZip);
  downloadBytes(`${slugify(state.project.name)}-copilot-agent.zip`, bytes, "application/zip");
  toast(tt("toastExported"));
}

function exportJson() {
  downloadText(`${slugify(state.project.name)}.agent-studio.json`, exportProjectJson(state.project), "application/json");
}

function printSpec() {
  const p = state.project;
  const compiled = compileInstructions(p);
  const lint = lintInstructions(p);
  const caps = Object.entries(p.capabilities).filter(([, v]) => v.enabled).map(([k]) => capName(k));
  $("print-root").innerHTML = `
    <h1>${esc(p.name)}</h1>
    <p>${esc(p.description)}</p>
    <p><b>${esc(tt("qualityScore"))}:</b> ${lint.score}/100</p>
    <h2>${esc(tt("role"))}</h2>
    <p>${esc(p.role)}</p>
    <h2>${esc(tt("skills"))}</h2>
    <table>
      <tr><th>${esc(tt("skillName"))}</th><th>${esc(tt("skillWhen"))}</th><th>${esc(tt("skillOutput"))}</th></tr>
      ${(p.skills || []).map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.when)}</td><td>${esc(s.output)}</td></tr>`).join("")}
    </table>
    <h2>${esc(tt("stepCapabilities"))}</h2>
    <p>${esc(caps.join(", ") || "—")}</p>
    <h2>${esc(tt("starters"))}</h2>
    <ul>${(p.conversationStarters || []).map((s) => `<li><b>${esc(s.title)}</b> — ${esc(s.text)}</li>`).join("")}</ul>
    <h2>${esc(tt("compiledPreview"))}</h2>
    <pre>${esc(compiled)}</pre>
    <h2>${esc(tt("developer"))}</h2>
    <p>${esc(p.app.developerName)} · ${esc(p.app.websiteUrl)} · v${esc(p.app.version)} · ${esc(p.app.id)}</p>
  `;
  window.print();
}

function onAction(action, el) {
  if (action !== "undo" && action !== "redo") flushSave();
  if (action === "toggle-lang") {
    state.lang = state.lang === "sv" ? "en" : "sv";
    persistSoon();
    render();
    return;
  }
  if (action === "toggle-theme") {
    state.theme = state.theme === "dark" ? "light" : "dark";
    persistSoon();
    render();
    return;
  }
  if (action === "new-blank") return useTemplate("blank");
  if (action === "use-template") return useTemplate(el.dataset.id);
  if (action === "open-draft") return selectProject(el.dataset.id);
  if (action === "goto-step") {
    state.step = Number(el.dataset.step);
    render();
    window.scrollTo(0, 0);
    return;
  }
  if (action === "next-step") {
    state.step = Math.min(STEPS.length - 1, state.step + 1);
    render();
    window.scrollTo(0, 0);
    return;
  }
  if (action === "prev-step") {
    state.step = Math.max(0, state.step - 1);
    render();
    window.scrollTo(0, 0);
    return;
  }
  if (action === "regen-guid" && state.project) {
    state.project.app.id = generateGuid();
    persistNow();
    render();
    return;
  }
  if (action === "add-skill" && state.project) {
    state.project.skills.push(normalizeSkill({ id: generateGuid(), name: "" }));
    state.openSkill = state.project.skills.length - 1;
    persistNow();
    render();
    focusSkill(state.openSkill);
    return;
  }
  if (action === "remove-skill" && state.project) {
    const i = Number(el.dataset.index);
    const name = state.project.skills[i]?.name || tt("untitledSkill");
    state.project.skills.splice(i, 1);
    state.openSkill = -1;
    persistNow();
    render();
    toast(`${tt("skillRemoved")}: ${name} · ${tt("undoHint")}`);
    return;
  }
  if (action === "move-skill" && state.project) {
    const i = Number(el.dataset.index);
    const j = i + Number(el.dataset.dir);
    const list = state.project.skills;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    state.openSkill = j;
    persistNow();
    render();
    return;
  }
  if (action === "scroll-templates") {
    document.getElementById("welcome-templates")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (action === "add-starter" && state.project) {
    state.project.conversationStarters.push({ title: "", text: "" });
    persistNow();
    render();
    return;
  }
  if (action === "remove-starter" && state.project) {
    state.project.conversationStarters.splice(Number(el.dataset.index), 1);
    persistNow();
    render();
    return;
  }
  if (action === "mode-raw" && state.project) {
    state.project.instructionsRaw = compileInstructions(state.project);
    state.project.instructionsMode = "raw";
    persistNow();
    render();
    return;
  }
  if (action === "mode-structured" && state.project) {
    state.project.instructionsMode = "structured";
    persistNow();
    render();
    return;
  }
  if (action === "export-zip") return exportZip();
  if (action === "export-json") return exportJson();
  if (action === "import-zip") return $("file-zip").click();
  if (action === "import-json") return $("file-json").click();
  if (action === "print-spec") return printSpec();
  if (action === "clear-custom-icon" && state.project) {
    delete state.project.icons.customColor;
    delete state.project.icons.customOutline;
    persistNow();
    render();
    return;
  }
  if (action === "preview-file") {
    state.previewKind = el.dataset.file;
    render();
    return;
  }
  if (action === "load-jira" && state.project) {
    const jira = createJiraCloudActions();
    state.project.actions = { ...state.project.actions, ...jira, enabled: true };
    persistNow();
    render();
    return;
  }
  if (action === "upload-openapi") {
    $("file-openapi").click();
    return;
  }
  if (action === "copy-json") {
    const pre = $("json-preview");
    if (pre) navigator.clipboard.writeText(pre.textContent || "");
    el.textContent = tt("copied");
    setTimeout(() => (el.textContent = tt("copy")), 1200);
    return;
  }
  if (action === "delete-draft" && state.project) {
    if (!confirm(state.lang === "en" ? "Delete this draft?" : "Ta bort utkastet?")) return;
    const id = state.project.id;
    state.store = deleteProject(state.store, id);
    const active = state.store.projects.find((p) => p.id === state.store.activeId);
    state.project = active ? normalizeProject(active) : null;
    state.quickStart = null;
    render();
    return;
  }
  if (action === "go-home") {
    if (state.project?.id) state.lastAgentId = state.project.id;
    state.project = null;
    state.store.activeId = null;
    state.quickStart = null;
    state.previewPrompt = "";
    render();
    return;
  }
  if (action === "preview-prompt") {
    state.previewPrompt = el.dataset.text || "";
    const compose = document.querySelector(".preview-compose");
    if (compose) compose.textContent = state.previewPrompt || tt("previewCompose");
    document.querySelectorAll(".preview-chip").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.text === state.previewPrompt);
    });
    return;
  }
  if (action === "copy-prompt") {
    const value = el.dataset.text || "";
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(value);
    toast(tt("toastCopiedPrompt"));
    return;
  }
  if (action === "md-mode") {
    const path = el.dataset.path;
    if (!path) return;
    if (el.dataset.mode === "preview") state.mdPreview[path] = true;
    else delete state.mdPreview[path];
    render();
    return;
  }
  if (action === "export-library") {
    const projects = state.store.projects || [];
    if (!projects.length) {
      toast(tt("toastLibraryEmpty"), "error");
      return;
    }
    downloadText(`agent-studio-library-${new Date().toISOString().slice(0, 10)}.json`, exportTeamLibrary(projects), "application/json");
    toast(tt("toastLibraryExported").replace("{n}", String(projects.length)));
    return;
  }
  if (action === "import-library") return $("file-json").click();
  if (action === "toggle-publisher") {
    state.showPublisher = !state.showPublisher;
    render();
    return;
  }
  if (action === "undo") return doUndo();
  if (action === "redo") return doRedo();
  if (action === "quick-start") {
    useTemplate("customer-service", { quick: { site: "", connector: "jiraTickets" } });
    return;
  }
  if (action === "quick-cancel") {
    state.quickStart = null;
    render();
    return;
  }
  if (action === "quick-finish" && state.project) {
    const site = (state.project.app.websiteUrl || "").trim().replace(/\/$/, "");
    if (site && /^https?:\/\//i.test(site)) {
      if (/example\.com/i.test(state.project.app.privacyUrl)) state.project.app.privacyUrl = `${site}/privacy`;
      if (/example\.com/i.test(state.project.app.termsOfUseUrl)) state.project.app.termsOfUseUrl = `${site}/terms`;
    }
    const connector = (state.quickStart?.connector || "").trim();
    if (connector) {
      state.project.capabilities.GraphConnectors.enabled = true;
      state.project.capabilities.GraphConnectors.connectionIds = [connector];
    }
    if (!state.project.app.shortName) state.project.app.shortName = state.project.name.slice(0, LIMITS.APP_SHORT_NAME);
    state.quickStart = null;
    state.step = STEPS.length - 1;
    persistSoon();
    render();
    return;
  }
  if (action === "backup-all") {
    downloadText(`agent-studio-backup-${new Date().toISOString().slice(0, 10)}.json`, exportAllProjectsJson(state.store), "application/json");
    return;
  }
  if (action === "pick-embedded") {
    $("file-embedded").click();
    return;
  }
  if (action === "remove-embedded" && state.project) {
    state.project.embeddedFiles.splice(Number(el.dataset.index), 1);
    if (!state.project.embeddedFiles.length) {
      /* keep capability on so user can re-add */
    } else {
      state.project.capabilities.EmbeddedKnowledge.files = state.project.embeddedFiles.map((f) => f.file);
    }
    persistNow();
    render();
    return;
  }
  if (action === "add-worker" && state.project) {
    if (!state.project.workerAgents) state.project.workerAgents = [];
    state.project.workerAgents.push({ id: "", file: "" });
    persistNow();
    render();
    return;
  }
  if (action === "remove-worker" && state.project) {
    state.project.workerAgents.splice(Number(el.dataset.index), 1);
    persistNow();
    render();
    return;
  }
  if (action === "add-answer" && state.project) {
    if (!state.project.editorialAnswers) state.project.editorialAnswers = [];
    state.project.editorialAnswers.push({ question: "", answer: "" });
    persistNow();
    render();
    return;
  }
  if (action === "remove-answer" && state.project) {
    state.project.editorialAnswers.splice(Number(el.dataset.index), 1);
    persistNow();
    render();
    return;
  }
}

function doUndo() {
  flushSave();
  const { history, project } = undoHistory(state.history);
  if (!project) return;
  state.applyingHistory = true;
  state.history = history;
  state.project = project;
  state.store = upsertProject(state.store, project);
  state.applyingHistory = false;
  render();
}

function doRedo() {
  const { history, project } = redoHistory(state.history);
  if (!project) return;
  state.applyingHistory = true;
  state.history = history;
  state.project = project;
  state.store = upsertProject(state.store, project);
  state.applyingHistory = false;
  render();
}

function onFieldInput(el) {
  if (!state.project) return;
  if (el.dataset.field) {
    let value = el.value;
    if (el.dataset.field === "name") {
      // Keep auto-generated icon initials in sync with the name until the user sets their own.
      const auto = initialsFromName(state.project.name || "");
      if (!state.project.icons.initials || state.project.icons.initials === auto) {
        state.project.icons.initials = initialsFromName(value || "");
        const ini = document.querySelector('input[data-field="icons.initials"]');
        if (ini) ini.value = state.project.icons.initials;
      }
    }
    setPath(state.project, el.dataset.field, value);
    if (el.dataset.field === "app.accentColor") {
      state.project.icons.colorBg = value;
    }
    if (el.dataset.field === "icons.colorBg") {
      if (/^#[0-9a-fA-F]{6}$/.test(value)) state.project.app.accentColor = value;
    }
    if (el.dataset.field === "name" && !(state.project.app.shortName || "").trim()) {
      state.project.app.shortName = value.slice(0, LIMITS.APP_SHORT_NAME);
    }
  }
  if (el.dataset.bool != null) {
    setPath(state.project, el.dataset.bool, el.checked);
    // toggling a capability should re-render extra fields
    if (el.dataset.bool.startsWith("capabilities.") || el.dataset.bool === "actions.enabled" || /^skills\.\d+\.skillMd$/.test(el.dataset.bool)) {
      persistSoon();
      render();
      return;
    }
  }
  if (el.dataset.list) {
    const lines = el.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    setPath(state.project, el.dataset.list, lines);
  }
  if (el.dataset.override != null) {
    const name = el.dataset.override;
    const set = new Set(state.project.userOverrideCaps || []);
    if (el.checked) set.add(name);
    else set.delete(name);
    state.project.userOverrideCaps = [...set];
  }
  if (el.dataset.opSelect && state.project.actions) {
    const id = el.dataset.opSelect;
    const set = new Set(state.project.actions.selectedOps || []);
    if (el.checked) set.add(id);
    else set.delete(id);
    state.project.actions.selectedOps = [...set];
    if (!state.project.actions.operationMeta) state.project.actions.operationMeta = {};
    if (el.checked && !state.project.actions.operationMeta[id]) {
      state.project.actions.operationMeta[id] = emptyActionMeta();
    }
    persistSoon();
    render();
    return;
  }
  if (el.dataset.quick === "connector" && state.quickStart) {
    state.quickStart.connector = el.value;
  }
  if (el.dataset.field === "app.websiteUrl") {
    const site = el.value.trim().replace(/\/$/, "");
    if (site && /^https?:\/\//i.test(site)) {
      if (!state.project.app.privacyUrl || /example\.com/i.test(state.project.app.privacyUrl)) {
        state.project.app.privacyUrl = `${site}/privacy`;
      }
      if (!state.project.app.termsOfUseUrl || /example\.com/i.test(state.project.app.termsOfUseUrl)) {
        state.project.app.termsOfUseUrl = `${site}/terms`;
      }
    }
  }
  persistSoon();
  refreshDynamic();
}

async function onZipFile(file) {
  let imported;
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    imported = await importPackageZip(buf, JSZip);
    if (!imported?.da || !Object.keys(imported.da).length) throw new Error("no declarativeAgent.json");
  } catch (err) {
    console.warn("Import failed", err);
    toast(tt("toastImportFailed"), "error");
    return;
  }
  const project = normalizeProject(applyImportedToProject(createFromTemplate("blank"), imported));
  project.templateId = "imported";
  state.project = project;
  state.lastAgentId = project.id;
  state.store = upsertProject(state.store, project);
  state.history = pushHistory({ stack: [], index: -1, projectId: null }, project);
  state.step = 0;
  state.openSkill = 0;
  render();
  toast(tt(project.instructionsMode === "raw" ? "toastImportedRaw" : "toastImported"));
}

async function onJsonFile(file) {
  let parsed;
  try {
    parsed = parseStudioJson(await file.text());
  } catch (err) {
    console.warn("Import failed", err);
    toast(tt("toastImportFailed"), "error");
    return;
  }
  if (parsed.kind === "library") {
    const agents = parsed.agents.map((a) => normalizeProject(a));
    const { store, added, updated } = mergeLibraryAgents(state.store, agents);
    state.store = store;
    const active = store.projects.find((p) => p.id === store.activeId);
    state.project = active ? normalizeProject(active) : null;
    if (state.project) {
      state.lastAgentId = state.project.id;
      state.history = pushHistory({ stack: [], index: -1, projectId: null }, state.project);
      state.step = 0;
    }
    render();
    toast(tt("toastLibraryImported").replace("{added}", String(added)).replace("{updated}", String(updated)));
    return;
  }
  let project = normalizeProject(parsed.agents[0]);
  if (!project.id) project.id = generateGuid();
  state.project = project;
  state.lastAgentId = project.id;
  state.store = upsertProject(state.store, project);
  state.history = pushHistory({ stack: [], index: -1, projectId: null }, project);
  state.step = 0;
  state.openSkill = 0;
  render();
  toast(tt("toastImported"));
}

function bind() {
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    e.preventDefault();
    onAction(el.dataset.action, el);
  });
  document.addEventListener("input", (e) => {
    const el = e.target;
    if (el.tagName === "TEXTAREA") autosize(el);
    if (el.dataset.field || el.dataset.bool != null || el.dataset.list || el.dataset.override != null || el.dataset.quick || el.dataset.opSelect) onFieldInput(el);
  });
  document.addEventListener(
    "toggle",
    (e) => {
      const el = e.target;
      if (el.open) el.querySelectorAll("textarea").forEach(autosize);
      if (el.matches?.("details.skill-card")) {
        const i = Number(el.dataset.skillIndex);
        if (el.open) {
          state.openSkill = i;
          document.querySelectorAll("details.skill-card[open]").forEach((d) => {
            if (d !== el) d.open = false;
          });
        } else if (state.openSkill === i) state.openSkill = -1;
      }
      if (el.matches?.('details[data-side="templates"]')) state.sideTplOpen = el.open;
    },
    true
  );
  document.addEventListener("change", (e) => {
    const el = e.target;
    if (el.dataset.library != null && el.value && state.project) {
      const [gi, si] = el.value.split(":").map(Number);
      const src = getSkillLibrary()[gi]?.skills?.[si];
      if (src) {
        const copy = normalizeSkill(JSON.parse(JSON.stringify(src)));
        flushSave();
        state.project.skills.push(copy);
        state.openSkill = state.project.skills.length - 1;
        persistNow();
        render();
        toast(`${tt("skillAdded")}: ${copy.name}`);
        focusSkill(state.openSkill);
      }
      return;
    }
    if (el.dataset.field === "actions.authType" || el.dataset.field === "actions.specText") {
      onFieldInput(el);
      render();
      return;
    }
    if (el.dataset.field || el.dataset.bool != null || el.dataset.list || el.dataset.override != null || el.dataset.opSelect) onFieldInput(el);
  });
  document.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    if (e.key.toLowerCase() === "z" && !e.shiftKey) {
      e.preventDefault();
      doUndo();
    } else if ((e.key.toLowerCase() === "z" && e.shiftKey) || e.key.toLowerCase() === "y") {
      e.preventDefault();
      doRedo();
    }
  });
  $("file-zip").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) await onZipFile(file);
  });
  $("file-json").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) await onJsonFile(file);
  });
  $("file-embedded").addEventListener("change", async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    if (files.length) await onEmbeddedFiles(files);
  });
  $("file-openapi").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) await onOpenApiFile(file);
  });
}

function focusSkill(i) {
  requestAnimationFrame(() => {
    const card = document.querySelector(`details.skill-card[data-skill-index="${i}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.querySelector('input[type="text"]')?.focus({ preventScroll: true });
  });
}

async function onEmbeddedFiles(fileList) {
  if (!state.project) return;
  if (!state.project.embeddedFiles) state.project.embeddedFiles = [];
  const remaining = LIMITS.EMBEDDED_FILES - state.project.embeddedFiles.length;
  const slice = fileList.slice(0, Math.max(0, remaining));
  for (const file of slice) {
    if (!isAllowedEmbeddedName(file.name)) {
      toast(state.lang === "en"
        ? `Skipped ${file.name}: allowed types are doc, docx, ppt, pptx, xls, xlsx, txt, pdf.`
        : `Hoppade över ${file.name}: tillåtna typer är doc, docx, ppt, pptx, xls, xlsx, txt, pdf.`, "error");
      continue;
    }
    if (file.size > LIMITS.EMBEDDED_MAX_BYTES) {
      toast(state.lang === "en" ? `${file.name} is larger than 1 MB.` : `${file.name} är större än 1 MB.`, "error");
      continue;
    }
    const buf = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
    const contentBase64 = btoa(binary);
    const safeName = file.name.replace(/[\\/]+/g, "_");
    state.project.embeddedFiles.push({ file: safeName, contentBase64, size: file.size, mime: file.type || "" });
  }
  state.project.capabilities.EmbeddedKnowledge.enabled = true;
  state.project.capabilities.EmbeddedKnowledge.files = state.project.embeddedFiles.map((f) => f.file);
  persistSoon();
  render();
}


async function onOpenApiFile(file) {
  if (!state.project) return;
  const text = await file.text();
  const parsed = parseAndList(text);
  if (!parsed.ok) {
    toast(parsed.error, "error");
    return;
  }
  state.project.actions.enabled = true;
  state.project.actions.specText = text;
  state.project.actions.specSource = "upload";
  state.project.actions.selectedOps = parsed.operations.map((op) => op.operationId);
  if (!state.project.actions.operationMeta) state.project.actions.operationMeta = {};
  if (!(state.project.actions.nameForHuman || "").trim() && parsed.spec.info?.title) {
    state.project.actions.nameForHuman = String(parsed.spec.info.title).slice(0, 20);
  }
  if (!(state.project.actions.namespace || "").trim()) {
    state.project.actions.namespace = namespaceFromName(parsed.spec.info?.title || state.project.name);
  }
  if (!(state.project.actions.descriptionForHuman || "").trim() && parsed.spec.info?.description) {
    state.project.actions.descriptionForHuman = String(parsed.spec.info.description).replace(/\s+/g, " ").trim().slice(0, 100);
  }
  persistSoon();
  render();
}

async function main() {
  const settings = loadSettings();
  state.lang = settings.lang === "en" ? "en" : "sv";
  state.theme = settings.theme === "light" ? "light" : "dark";
  state.lastAgentId = settings.lastAgentId || null;
  state.store = loadStore();
  state.history = loadHistory();
  if (state.store.activeId) {
    const active = state.store.projects.find((p) => p.id === state.store.activeId);
    state.project = active ? normalizeProject(active) : null;
    if (state.project && (!state.history.stack.length || state.history.projectId !== state.project.id)) {
      state.history = pushHistory({ stack: [], index: -1, projectId: null }, state.project);
    }
  }
  bind();
  render();
  try {
    state.validators = await createValidators(Ajv, daSchema, teamsSchema, pluginSchema, addFormats);
    refreshDynamic();
  } catch (err) {
    console.error("Schema validators failed to load", err);
  }
}

main();
