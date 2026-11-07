import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import JSZip from "jszip";
import { createFromTemplate, TEMPLATE_LIST } from "../src/templates.js";
import { compileInstructions } from "../src/model.js";
import {
  buildDeclarativeAgent,
  buildTeamsManifest,
  buildPackageFiles,
  buildZip,
  importPackageZip,
  applyImportedToProject,
} from "../src/package.js";
import { collectFieldErrors, createValidators, validateGenerated } from "../src/validate.js";
import { lintInstructions } from "../src/lint.js";
import { generateIcons } from "../src/icons.js";
import { createEmptyProject } from "../src/model.js";
import { LIMITS } from "../src/util.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const daSchema = JSON.parse(readFileSync(join(root, "schemas/declarative-agent-v1.9.json"), "utf8"));
const teamsSchema = JSON.parse(readFileSync(join(root, "schemas/MicrosoftTeams.v1.29.schema.json"), "utf8"));
const pluginSchema = JSON.parse(readFileSync(join(root, "schemas/plugin-v2.4.json"), "utf8"));

async function validators() {
  return createValidators(Ajv, daSchema, teamsSchema, pluginSchema, addFormats);
}

test("every template compiles to schema-valid manifests", async () => {
  const v = await validators();
  for (const meta of TEMPLATE_LIST) {
    const project = createFromTemplate(meta.id);
    const instructions = compileInstructions(project);
    assert.ok(instructions.length > 80, `${meta.id} instructions too short`);
    assert.ok(instructions.length <= LIMITS.DA_INSTRUCTIONS, `${meta.id} instructions over limit: ${instructions.length}`);
    const result = validateGenerated(project, v);
    assert.equal(result.fieldErrors.length, 0, `${meta.id} field errors: ${JSON.stringify(result.fieldErrors)}`);
    assert.equal(result.schemaErrors.length, 0, `${meta.id} schema errors: ${JSON.stringify(result.schemaErrors)}`);
    assert.equal(result.da.version, "v1.9");
    assert.equal(result.manifest.manifestVersion, "1.29");
    assert.ok(result.manifest.copilotAgents.declarativeAgents[0].file === "declarativeAgent.json");
    assert.ok((result.da.conversation_starters || []).length <= 12);
    const names = (result.da.capabilities || []).map((c) => c.name);
    assert.equal(new Set(names).size, names.length, `${meta.id} duplicate capabilities`);
  }
});

test("customer service agent has the four cookbook skills", () => {
  const p = createFromTemplate("customer-service");
  const names = p.skills.map((s) => s.name);
  assert.deepEqual(names, [
    "Analyze Jira ticket",
    "Find documentation",
    "Create documentation",
    "Write customer reply",
  ]);
  const text = compileInstructions(p);
  assert.match(text, /You are a Customer Service Agent/);
  assert.match(text, /## Skill: Analyze Jira ticket/);
  assert.match(text, /Output format:/);
  assert.ok(p.capabilities.GraphConnectors.enabled);
  assert.deepEqual(p.capabilities.GraphConnectors.connectionIds, ["jiraTickets"]);
});

test("invalid name and over-long instructions are rejected", () => {
  const p = createFromTemplate("blank");
  p.name = "";
  p.instructionsMode = "raw";
  p.instructionsRaw = "x".repeat(8001);
  const errors = collectFieldErrors(p).errors;
  assert.ok(errors.some((e) => e.code === "NAME_REQUIRED"));
  assert.ok(errors.some((e) => e.code === "INSTR_TOO_LONG"));
});

test("too many conversation starters and web search sites fail", () => {
  const p = createFromTemplate("blank");
  p.conversationStarters = Array.from({ length: 13 }, (_, i) => ({ title: `T${i}`, text: `Ask ${i}` }));
  p.capabilities.WebSearch.enabled = true;
  p.capabilities.WebSearch.sites = [
    "https://a.com/one/two",
    "https://b.com/one/two",
    "https://c.com/one/two",
    "https://d.com/one/two",
    "https://e.com/one/two",
  ];
  const errors = collectFieldErrors(p).errors;
  assert.ok(errors.some((e) => e.code === "STARTERS_MAX"));
  assert.ok(errors.some((e) => e.code === "WEBSEARCH_MAX"));
});

test("web search URL with three path segments or a query is invalid", () => {
  const p = createFromTemplate("blank");
  p.capabilities.WebSearch.enabled = true;
  p.capabilities.WebSearch.sites = ["https://contoso.com/projects/mark-8/beta-program"];
  let errors = collectFieldErrors(p).errors;
  assert.ok(errors.some((e) => e.code === "WEBSEARCH_PATH"));
  p.capabilities.WebSearch.sites = ["https://contoso.com/search?q=1"];
  errors = collectFieldErrors(p).errors;
  assert.ok(errors.some((e) => e.code === "WEBSEARCH_PATH"));
  p.capabilities.WebSearch.sites = ["https://contoso.com/projects/mark-8"];
  errors = collectFieldErrors(p).errors;
  assert.ok(!errors.some((e) => e.code === "WEBSEARCH_PATH"));
});

test("lint catches missing role, missing output, contradiction and empty text", () => {
  const empty = createEmptyProject({ name: "X", description: "A valid description for tests." });
  empty.role = "";
  empty.skills = [];
  empty.guardrails = "";
  empty.style = "";
  const emptyLint = lintInstructions(empty);
  assert.ok(emptyLint.issues.some((i) => i.code === "EMPTY" || i.code === "MISSING_ROLE"));

  const vague = createEmptyProject({ name: "X", description: "A valid description for tests." });
  vague.instructionsMode = "raw";
  vague.instructionsRaw = "You are an assistant.";
  const vagueLint = lintInstructions(vague);
  assert.ok(vagueLint.issues.some((i) => i.code === "TOO_VAGUE" || i.code === "NO_SKILLS"));

  const contra = createEmptyProject({ name: "X", description: "A valid description for tests." });
  contra.instructionsMode = "raw";
  contra.instructionsRaw =
    "You are a careful analyst for an integration team. Always answer in Swedish. Always answer in English. Write a structured output format.";
  const cLint = lintInstructions(contra);
  assert.ok(cLint.issues.some((i) => i.code === "CONTRADICTION"));

  const good = createFromTemplate("customer-service");
  const goodLint = lintInstructions(good);
  assert.ok(goodLint.score >= 70, `expected high score, got ${goodLint.score}: ${JSON.stringify(goodLint.issues)}`);
  assert.ok(!goodLint.issues.some((i) => i.level === "error"));
});

test("unknown extra property is rejected by the official DA schema", async () => {
  const v = await validators();
  const da = buildDeclarativeAgent(createFromTemplate("blank"));
  da.notARealField = true;
  const ok = v.da(da);
  assert.equal(ok, false);
});

test("zip roundtrip preserves name, instructions, capabilities and starters", async () => {
  const original = createFromTemplate("customer-service");
  original.app.websiteUrl = "https://integrations.example.org";
  original.app.privacyUrl = "https://integrations.example.org/privacy";
  original.app.termsOfUseUrl = "https://integrations.example.org/terms";
  const icons = generateIcons(original);
  assert.ok(icons.color.length > 50);
  assert.ok(icons.outline.length > 50);
  // PNG signature
  assert.deepEqual([...icons.color.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.deepEqual([...icons.outline.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

  const { bytes, da, manifest } = await buildZip(original, icons, JSZip);
  assert.ok(bytes.length > 200);
  const imported = await importPackageZip(bytes, JSZip);
  assert.equal(imported.manifest.name.full, manifest.name.full);
  assert.equal(imported.da.name, da.name);
  assert.equal(imported.da.instructions, da.instructions);
  assert.deepEqual(
    (imported.da.capabilities || []).map((c) => c.name),
    (da.capabilities || []).map((c) => c.name)
  );
  assert.equal(imported.da.conversation_starters.length, da.conversation_starters.length);
  assert.ok(imported.icons.color);
  assert.ok(imported.icons.outline);

  const restored = applyImportedToProject(createEmptyProject(), imported);
  assert.equal(restored.name, original.name);
  // Round 4: Agent Studio output is parsed back into the structured cookbook.
  assert.equal(restored.instructionsMode, "structured");
  assert.match(restored.instructionsRaw, /Analyze Jira ticket/);
  assert.equal(restored.skills[0].name, "Analyze Jira ticket");
  assert.equal(restored.capabilities.GraphConnectors.enabled, true);
  assert.deepEqual(restored.capabilities.GraphConnectors.connectionIds, ["jiraTickets"]);
  assert.equal(restored.app.websiteUrl, "https://integrations.example.org");
});

test("zip with API plugin includes plugin.json v2.4 and openapi.yaml", async () => {
  const p = createFromTemplate("customer-service");
  const icons = generateIcons(p);
  const { files } = buildPackageFiles(p, icons);
  assert.ok(files["plugin.json"]);
  assert.ok(files["openapi.yaml"]);
  const plugin = JSON.parse(files["plugin.json"]);
  assert.equal(plugin.schema_version, "v2.4");
  assert.equal(plugin.namespace, "jira");
  assert.ok(plugin.functions.some((f) => f.name === "searchIssues"));
  assert.ok(plugin.functions.some((f) => f.name === "getIssue"));
  assert.ok(plugin.functions.some((f) => f.name === "addComment"));
  assert.equal(plugin.runtimes[0].auth.type, "ApiKeyPluginVault");
  assert.equal(plugin.runtimes[0].auth.reference_id, "jira-api-key");
  const da = JSON.parse(files["declarativeAgent.json"]);
  assert.equal(da.actions[0].file, "plugin.json");
  assert.match(files["openapi.yaml"], /operationId: searchIssues/);
  assert.match(files["skills/analyze-jira-ticket/SKILL.md"], /When to use/);
});

test("PNG color is 192px class and outline is generated independently", () => {
  const p = createFromTemplate("xml-analyst");
  const icons = generateIcons(p);
  // IHDR width/height are bytes 16-23 of the PNG (after 8 sig + 4 len + 4 type)
  const colorW = (icons.color[16] << 24) | (icons.color[17] << 16) | (icons.color[18] << 8) | icons.color[19];
  const colorH = (icons.color[20] << 24) | (icons.color[21] << 16) | (icons.color[22] << 8) | icons.color[23];
  const outW = (icons.outline[16] << 24) | (icons.outline[17] << 16) | (icons.outline[18] << 8) | icons.outline[19];
  const outH = (icons.outline[20] << 24) | (icons.outline[21] << 16) | (icons.outline[22] << 8) | icons.outline[23];
  assert.equal(colorW, 192);
  assert.equal(colorH, 192);
  assert.equal(outW, 32);
  assert.equal(outH, 32);
});
