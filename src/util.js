/** Shared helpers — no DOM, safe in Node and the browser. */

export function generateGuid() {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isGuid(value) {
  return typeof value === "string" && /^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/.test(value);
}

export function isSemver(value) {
  return typeof value === "string" && /^([0-9]|[1-9][0-9]*)\.([0-9]|[1-9][0-9]*)\.([0-9]|[1-9][0-9]*)$/.test(value);
}

export function isHexColor(value) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function isHttpUrl(value) {
  return typeof value === "string" && /^https?:\/\/.+/i.test(value.trim()) && value.trim().length <= 2048;
}

export function clip(value, max) {
  const s = value == null ? "" : String(value);
  return s.length <= max ? s : s.slice(0, max);
}

export function hasNonWhitespace(value) {
  return typeof value === "string" && /\S/.test(value);
}

export function initialsFromName(name, fallback = "AS") {
  const words = String(name || "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean);
  if (!words.length) return fallback;
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export function slugify(name) {
  return String(name || "agent")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "agent";
}

export function nowIso() {
  return new Date().toISOString();
}

export function countChars(value) {
  return value == null ? 0 : String(value).length;
}

/** Localization-key or plain string without stray [[ ]]. */
export function hasIllegalLocalizationMarkers(value) {
  if (typeof value !== "string") return false;
  const isKey = /^\[\[[a-zA-Z_][a-zA-Z0-9_]*\]\]$/;
  if (isKey.test(value)) return false;
  return value.includes("[[") || value.includes("]]");
}

export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export const LIMITS = {
  DA_NAME: 100,
  DA_DESCRIPTION: 1000,
  DA_INSTRUCTIONS: 8000,
  STARTERS: 12,
  STARTER_TITLE: 100,
  STARTER_TEXT: 500,
  DISCLAIMER: 500,
  ACTIONS: 10,
  AGENT_SKILLS: 8,
  WEBSEARCH_SITES: 4,
  TEAMS_URLS: 5,
  MEETINGS: 5,
  EMBEDDED_FILES: 10,
  EMBEDDED_MAX_BYTES: 1048576,
  DEVELOPER_NAME: 32,
  APP_SHORT_NAME: 30,
  APP_FULL_NAME: 100,
  APP_SHORT_DESC: 80,
  APP_FULL_DESC: 4000,
  URL: 2048,
};

export const CAPABILITY_META = [
  { name: "WebSearch", kind: "sites", sitesMax: 4 },
  { name: "OneDriveAndSharePoint", kind: "urls" },
  { name: "GraphConnectors", kind: "connections" },
  { name: "CodeInterpreter", kind: "flag" },
  { name: "GraphicArt", kind: "flag" },
  { name: "Email", kind: "email" },
  { name: "EmailActions", kind: "flag" },
  { name: "People", kind: "people" },
  { name: "TeamsMessages", kind: "urls", urlsMax: 5 },
  { name: "Meetings", kind: "flag" },
  { name: "MeetingActions", kind: "flag" },
  { name: "Dataverse", kind: "dataverse" },
  { name: "Fabric", kind: "flag" },
  { name: "ScenarioModels", kind: "models" },
  { name: "EmbeddedKnowledge", kind: "files" },
];

export const CAPABILITY_NAMES = CAPABILITY_META.map((c) => c.name);

export const EMBEDDED_EXTENSIONS = [".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".txt", ".pdf"];

export function isAllowedEmbeddedName(name) {
  const n = String(name || "").trim().toLowerCase();
  if (!n || n.includes("/") || n.includes("\\") || n.includes("..")) return false;
  return EMBEDDED_EXTENSIONS.some((ext) => n.endsWith(ext));
}
