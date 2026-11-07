import { generateGuid } from "./util.js";

const KEY = "agent-studio.v1";
const SETTINGS_KEY = "agent-studio.settings.v1";

export function loadStore() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { projects: [], activeId: null };
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.projects)) return { projects: [], activeId: null };
    return data;
  } catch {
    return { projects: [], activeId: null };
  }
}

export function saveStore(store) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* ignore missing or blocked storage */
  }
}

export function upsertProject(store, project) {
  const next = { ...store, projects: store.projects.slice() };
  const idx = next.projects.findIndex((p) => p.id === project.id);
  if (idx >= 0) next.projects[idx] = project;
  else next.projects.unshift(project);
  next.activeId = project.id;
  saveStore(next);
  return next;
}

export function deleteProject(store, id) {
  const next = {
    ...store,
    projects: store.projects.filter((p) => p.id !== id),
  };
  if (next.activeId === id) next.activeId = next.projects[0]?.id || null;
  saveStore(next);
  return next;
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { lang: "sv", theme: "dark" };
    return { lang: "sv", theme: "dark", ...JSON.parse(raw) };
  } catch {
    return { lang: "sv", theme: "dark" };
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function exportProjectJson(project) {
  return JSON.stringify({ type: "agent-studio-project", version: 1, project }, null, 2);
}

export function importProjectJson(text) {
  const data = JSON.parse(text);
  if (data?.type === "agent-studio-project" && data.project) return data.project;
  if (data?.name && data?.description) return data;
  throw new Error("Filen ser inte ut som ett Agent Studio-projekt.");
}

export function storageAvailable() {
  try {
    const k = "__as_test__";
    localStorage.setItem(k, "1");
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

const HISTORY_KEY = "agent-studio.history.v1";
const HISTORY_LIMIT = 40;

export function loadHistory() {
  try {
    if (typeof localStorage === "undefined") return { stack: [], index: -1, projectId: null };
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return { stack: [], index: -1, projectId: null };
    const data = JSON.parse(raw);
    if (!Array.isArray(data.stack)) return { stack: [], index: -1, projectId: null };
    return data;
  } catch {
    return { stack: [], index: -1, projectId: null };
  }
}

export function saveHistory(history) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    /* ignore */
  }
}

export function pushHistory(history, project) {
  if (!project?.id) return history;
  const snap = JSON.stringify(project);
  let stack = history.stack.slice();
  let index = history.index;
  if (history.projectId && history.projectId !== project.id) {
    stack = [];
    index = -1;
  }
  if (index >= 0 && stack[index] === snap) return { ...history, projectId: project.id };
  stack = stack.slice(0, index + 1);
  stack.push(snap);
  if (stack.length > HISTORY_LIMIT) {
    const drop = stack.length - HISTORY_LIMIT;
    stack = stack.slice(drop);
  }
  index = stack.length - 1;
  const next = { stack, index, projectId: project.id };
  saveHistory(next);
  return next;
}

export function undoHistory(history) {
  if (!history.stack.length || history.index <= 0) return { history, project: null };
  const index = history.index - 1;
  const next = { ...history, index };
  saveHistory(next);
  return { history: next, project: JSON.parse(history.stack[index]) };
}

export function redoHistory(history) {
  if (!history.stack.length || history.index >= history.stack.length - 1) return { history, project: null };
  const index = history.index + 1;
  const next = { ...history, index };
  saveHistory(next);
  return { history: next, project: JSON.parse(history.stack[index]) };
}

export function canUndo(history) {
  return history.stack.length > 0 && history.index > 0;
}

export function canRedo(history) {
  return history.stack.length > 0 && history.index < history.stack.length - 1;
}

export function exportAllProjectsJson(store) {
  return JSON.stringify({ type: "agent-studio-backup", version: 1, exportedAt: new Date().toISOString(), store }, null, 2);
}

export function importBackupJson(text) {
  const data = JSON.parse(text);
  if (data?.type === "agent-studio-backup" && data.store?.projects) return data.store;
  if (data?.type === "agent-studio-project" && data.project) {
    return { projects: [data.project], activeId: data.project.id };
  }
  throw new Error("Filen ser inte ut som en Agent Studio-backup.");
}

export const LIBRARY_TYPE = "agent-studio-library";

export function exportTeamLibrary(projects, { name = "Team library" } = {}) {
  return JSON.stringify({
    type: LIBRARY_TYPE,
    version: 1,
    name,
    exportedAt: new Date().toISOString(),
    agents: Array.isArray(projects) ? projects : [],
  }, null, 2);
}

/** Parse a project file, a team library, or a full backup into a list of agents. */
export function parseStudioJson(text) {
  const data = JSON.parse(text);
  if (data?.type === LIBRARY_TYPE && Array.isArray(data.agents)) {
    return { kind: "library", name: data.name || "Team library", agents: data.agents };
  }
  if (data?.type === "agent-studio-backup" && data.store?.projects) {
    return { kind: "library", name: "Backup", agents: data.store.projects };
  }
  if (data?.type === "agent-studio-project" && data.project) {
    return { kind: "project", name: data.project.name || "Agent", agents: [data.project] };
  }
  if (data?.name && data?.description) {
    return { kind: "project", name: data.name, agents: [data] };
  }
  throw new Error("Filen ser inte ut som ett Agent Studio-projekt eller teambibliotek.");
}

export function mergeLibraryAgents(store, agents) {
  const next = { ...store, projects: store.projects.slice() };
  let added = 0;
  let updated = 0;
  let lastId = next.activeId;
  for (const raw of agents || []) {
    if (!raw || typeof raw !== "object") continue;
    const project = { ...raw, id: raw.id || generateGuid() };
    const idx = next.projects.findIndex((p) => p.id === project.id);
    if (idx >= 0) {
      next.projects[idx] = project;
      updated += 1;
    } else {
      next.projects.unshift(project);
      added += 1;
    }
    lastId = project.id;
  }
  if (lastId) next.activeId = lastId;
  saveStore(next);
  return { store: next, added, updated };
}
