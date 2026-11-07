import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import JSZip from "jszip";
import { createFromTemplate, TEMPLATE_LIST } from "../src/templates.js";
import { compileInstructions, normalizeProject, createEmptyProject } from "../src/model.js";
import {
  deriveAgentSkills,
  mergeAgentSkillsIntoSkills,
  parseCompiledInstructions,
  skillFolderFor,
  normalizeSkill,
} from "../src/skillmd.js";
import { buildPackageFiles, buildZip, importPackageZip, applyImportedToProject } from "../src/package.js";
import { createValidators, validateGenerated } from "../src/validate.js";
import { STR } from "../src/i18n.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = (f) => JSON.parse(readFileSync(join(root, f), "utf8"));
const daSchema = load("schemas/declarative-agent-v1.9.json");
const teamsSchema = load("schemas/MicrosoftTeams.v1.29.schema.json");
const pluginSchema = load("schemas/plugin-v2.4.json");

test("ajv-formats silences unknown-format warnings and still validates", async () => {
  const warnings = [];
  const orig = console.warn;
  console.warn = (...a) => warnings.push(a.join(" "));
  try {
    const v = await createValidators(Ajv, daSchema, teamsSchema, pluginSchema, addFormats);
    const p = createFromTemplate("customer-service");
    const r = validateGenerated(p, v);
    assert.equal(r.schemaErrors.length, 0, JSON.stringify(r.schemaErrors));
  } finally {
    console.warn = orig;
  }
  assert.deepEqual(warnings.filter((w) => /unknown format/.test(w)), []);
});

test("uri format is actually enforced once formats are registered", async () => {
  const v = await createValidators(Ajv, daSchema, teamsSchema, pluginSchema, addFormats);
  const p = createFromTemplate("blank");
  p.actions = { ...p.actions };
  const r = validateGenerated(p, v);
  assert.equal(r.ok, true, JSON.stringify([...r.fieldErrors, ...r.schemaErrors]));
  const bad = { ...r.manifest, developer: { ...r.manifest.developer, websiteUrl: "not a url" } };
  assert.equal(v.teams(bad), false);
});

test("vendored browser bundle exports Ajv and addFormats from one copy", async () => {
  const mod = await import("../vendor/ajv.esm.js");
  assert.equal(typeof mod.default, "function");
  assert.equal(typeof mod.addFormats, "function");
  const ajv = new mod.default({ strict: false });
  mod.addFormats(ajv);
  const validate = ajv.compile({ type: "string", format: "uri" });
  assert.equal(validate("https://example.org"), true);
  assert.equal(validate("nope"), false);
});

test("one skill card generates both instructions text and SKILL.md", () => {
  const p = createFromTemplate("blank");
  p.skills = [
    normalizeSkill({ id: "", name: "Triage Jira ticket", when: "A colleague pastes a ticket.", how: "1. Restate.\n2. Classify.", output: "## Summary\n## Next step", example: "User: INT-1\nAssistant: ## Summary" }),
  ];
  const text = compileInstructions(p);
  assert.match(text, /## Skill: Triage Jira ticket/);
  assert.match(text, /When to use: A colleague pastes a ticket\./);
  const { files, da } = buildPackageFiles(p);
  assert.equal(da.agent_skills[0].folder, "./skills/triage-jira-ticket");
  const md = files["skills/triage-jira-ticket/SKILL.md"];
  assert.match(md, /^---\nname: Triage Jira ticket/);
  assert.match(md, /## Steps\n\n1\. Restate\./);
  assert.match(md, /## Example\n\nUser: INT-1/);
});

test("skill with skillMd off stays in instructions but gets no SKILL.md", () => {
  const p = createFromTemplate("customer-service");
  p.skills[0].skillMd = false;
  const { files, da } = buildPackageFiles(p);
  assert.match(compileInstructions(p), /## Skill: Analyze Jira ticket/);
  assert.equal(files["skills/analyze-jira-ticket/SKILL.md"], undefined);
  assert.equal(da.agent_skills.length, p.skills.length - 1);
});

test("GUID skill ids fall back to a slug folder and duplicates get a suffix", () => {
  assert.equal(skillFolderFor({ id: "6f1c2a3b-1111-2222-3333-444455556666", name: "Skriv kundsvar" }), "skills/skriv-kundsvar");
  const p = createEmptyProject();
  p.skills = [normalizeSkill({ name: "Same" }), normalizeSkill({ name: "Same" })];
  const folders = deriveAgentSkills(p).map((s) => s.folder);
  assert.deepEqual(folders, ["skills/same", "skills/same-2"]);
});

test("legacy agentSkills (round 3 drafts) merge into skill cards", () => {
  const legacy = createFromTemplate("customer-service");
  legacy.agentSkills = [
    { folder: "skills/analyze-jira-ticket", name: "Analyze Jira ticket", description: "d", when: "", how: "", output: "", example: "LEGACY EXAMPLE INT-9", body: "" },
    { folder: "skills/extra", name: "Extra skill", description: "Only in SKILL.md", when: "", how: "Do it.", output: "", example: "", body: "" },
  ];
  legacy.skills[0].example = "";
  const p = normalizeProject(legacy);
  assert.deepEqual(p.agentSkills, []);
  assert.equal(p.skills[0].example, "LEGACY EXAMPLE INT-9");
  const extra = p.skills.find((s) => s.name === "Extra skill");
  assert.ok(extra);
  assert.equal(extra.folder, "skills/extra");
  assert.equal(extra.how, "Do it.");
});

test("parseCompiledInstructions round-trips every template", () => {
  for (const meta of TEMPLATE_LIST) {
    const p = createFromTemplate(meta.id);
    const text = compileInstructions(p);
    const parsed = parseCompiledInstructions(text);
    assert.ok(parsed, meta.id);
    const again = compileInstructions({ ...p, ...parsed, instructionsMode: "structured" });
    assert.equal(again, text, meta.id);
  }
  assert.equal(parseCompiledInstructions("Just a paragraph of hand-written text."), null);
});

test("hand-written instructions import as raw text, SKILL.md becomes cards", async () => {
  const src = createFromTemplate("xml-analyst");
  src.instructionsMode = "raw";
  src.instructionsRaw = "Du är en noggrann XML-analytiker. Svara på svenska.";
  const { bytes } = await buildZip(src, {}, JSZip);
  const imported = await importPackageZip(bytes, JSZip);
  const p = normalizeProject(applyImportedToProject(createEmptyProject(), imported));
  assert.equal(p.instructionsMode, "raw");
  assert.equal(compileInstructions(p), src.instructionsRaw);
  assert.equal(p.skills.length, src.skills.length);
  assert.equal(deriveAgentSkills(p).length, src.skills.length);
});

test("Swedish and English string tables have the same keys", () => {
  const sv = Object.keys(STR.sv).sort();
  const en = Object.keys(STR.en).sort();
  assert.deepEqual(sv.filter((k) => !en.includes(k)), []);
  assert.deepEqual(en.filter((k) => !sv.includes(k)), []);
});

test("Swedish copy has no known round-3 typos", () => {
  const blob = JSON.stringify(STR.sv) + JSON.stringify(TEMPLATE_LIST.map((t) => [t.name.sv, t.blurb.sv]));
  const all = blob + TEMPLATE_LIST.map((t) => JSON.stringify(createFromTemplate(t.id))).join("");
  for (const bad of ["integrationincidenser", "kundupdate", "diff:a", "Teamlead", "Scenario-modeller", "Användaröverskridning"]) {
    assert.ok(!all.includes(bad), `found "${bad}"`);
  }
});

test("import keeps the package's own icons, initials and accent", async () => {
  const src = createFromTemplate("monthly-report");
  const fakePng = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
  const { bytes } = await buildZip(src, { color: fakePng, outline: fakePng }, JSZip);
  const imported = await importPackageZip(bytes, JSZip);
  const p = normalizeProject(applyImportedToProject(createFromTemplate("blank"), imported));
  assert.notEqual(p.icons.initials, "NA");
  assert.equal(p.icons.colorBg, src.app.accentColor);
  assert.deepEqual(p.testPrompts, []);
  const { files } = buildPackageFiles(p);
  assert.deepEqual([...files["color.png"]], [...fakePng]);
  assert.deepEqual([...files["outline.png"]], [...fakePng]);
});

test("Swedish role starting with 'en' compiles to 'Du är en …'", () => {
  const p = createFromTemplate("blank");
  p.role = "en noggrann XML-analytiker för integrationsteamet.";
  assert.match(compileInstructions(p), /^Du är en noggrann XML-analytiker/);
  const parsed = parseCompiledInstructions(compileInstructions(p));
  assert.equal(compileInstructions({ ...p, ...parsed }), compileInstructions(p));
});

test("bundled example zip imports and validates against the official schemas", async () => {
  const bytes = readFileSync(join(root, "examples/kundtjanstagent-copilot-agent.zip"));
  const imported = await importPackageZip(bytes, JSZip);
  const p = normalizeProject(applyImportedToProject(createEmptyProject(), imported));
  const v = await createValidators(Ajv, daSchema, teamsSchema, pluginSchema, addFormats);
  const r = validateGenerated(p, v);
  assert.equal(r.ok, true, JSON.stringify([...r.fieldErrors, ...r.schemaErrors]));
  assert.equal(p.skills.length, 4);
  assert.ok(imported.skillFiles["skills/analyze-jira-ticket/SKILL.md"]);
});
