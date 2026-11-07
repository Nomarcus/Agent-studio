import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { createFromTemplate, TEMPLATE_LIST } from "../src/templates.js";
import { compileInstructions } from "../src/model.js";
import { deriveAgentSkills } from "../src/skillmd.js";
import { buildPackageFiles } from "../src/package.js";
import { createValidators, validateGenerated } from "../src/validate.js";
import { renderMarkdown } from "../src/markdown.js";
import {
  exportTeamLibrary,
  parseStudioJson,
  mergeLibraryAgents,
  exportProjectJson,
  exportAllProjectsJson,
  LIBRARY_TYPE,
} from "../src/store.js";
import { STR } from "../src/i18n.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = (f) => JSON.parse(readFileSync(join(root, f), "utf8"));
const NEW_IDS = [
  "proposal-writer",
  "onboarding-buddy",
  "release-notes",
  "test-case-writer",
  "mapping-spec",
  "rca-5whys",
];

test("catalog includes the six new high-value templates", () => {
  const ids = TEMPLATE_LIST.map((t) => t.id);
  assert.equal(ids.length, 14);
  for (const id of NEW_IDS) assert.ok(ids.includes(id), id);
  assert.equal(ids.at(-1), "blank");
});

test("new templates have real skills, SKILL.md files and schema-valid packages", async () => {
  const v = await createValidators(Ajv, load("schemas/declarative-agent-v1.9.json"), load("schemas/MicrosoftTeams.v1.29.schema.json"), load("schemas/plugin-v2.4.json"), addFormats);
  const expected = {
    "proposal-writer": ["Scope the request", "Draft the proposal structure", "Write the commercial text", "List assumptions and exclusions"],
    "onboarding-buddy": ["Plan the first weeks", "Explain how we work", "Find the right person or doc", "Answer a newcomer question"],
    "release-notes": ["Collect the changes", "Write user-facing notes", "Write technical notes", "Draft the announcement"],
    "test-case-writer": ["Extract testable requirements", "Write happy-path cases", "Write negative and boundary cases", "Build a coverage matrix"],
    "mapping-spec": ["Inventory the source", "Propose the mapping table", "Document transforms and codes", "List open questions and risks"],
    "rca-5whys": ["State the problem", "Walk the five whys", "Challenge a weak link", "Write the RCA summary"],
  };
  for (const id of NEW_IDS) {
    const p = createFromTemplate(id);
    assert.deepEqual(p.skills.map((s) => s.name), expected[id], id);
    assert.ok(compileInstructions(p).length > 200, id);
    const derived = deriveAgentSkills(p);
    assert.equal(derived.length, p.skills.length, id);
    const { files, da } = buildPackageFiles(p);
    assert.equal((da.agent_skills || []).length, p.skills.length, id);
    for (const skill of derived) {
      const path = `${skill.folder.replace(/^\.\//, "")}/SKILL.md`;
      assert.ok(files[path], `${id} missing ${path}`);
      assert.match(files[path], /^---\nname: /);
      assert.match(files[path], /## Steps/);
    }
    const result = validateGenerated(p, v);
    assert.equal(result.ok, true, `${id}: ${JSON.stringify([...result.fieldErrors, ...result.schemaErrors])}`);
  }
});

test("markdown preview escapes HTML and renders headings, lists and emphasis", () => {
  const html = renderMarkdown("# Title\n\n1. First\n2. Second\n\n- bullet\n\nUse **bold** and `code` and <script>alert(1)</script>");
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<ol><li>First<\/li><li>Second<\/li><\/ol>/);
  assert.match(html, /<ul><li>bullet<\/li><\/ul>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
  assert.ok(!html.includes("<script>"));
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("team library exports several agents and merge updates matching ids", () => {
  const a = createFromTemplate("proposal-writer");
  const b = createFromTemplate("rca-5whys");
  const json = exportTeamLibrary([a, b], { name: "Integration pack" });
  const parsed = parseStudioJson(json);
  assert.equal(parsed.kind, "library");
  assert.equal(parsed.name, "Integration pack");
  assert.equal(parsed.agents.length, 2);
  assert.equal(JSON.parse(json).type, LIBRARY_TYPE);

  const first = mergeLibraryAgents({ projects: [], activeId: null }, parsed.agents);
  assert.equal(first.added, 2);
  assert.equal(first.updated, 0);
  assert.equal(first.store.projects.length, 2);

  const renamed = { ...a, name: "Offertskrivaren v2" };
  const second = mergeLibraryAgents(first.store, [renamed]);
  assert.equal(second.added, 0);
  assert.equal(second.updated, 1);
  assert.equal(second.store.projects.find((p) => p.id === a.id).name, "Offertskrivaren v2");
  assert.equal(second.store.projects.length, 2);
});

test("parseStudioJson accepts a single project and a backup as a library", () => {
  const p = createFromTemplate("onboarding-buddy");
  const single = parseStudioJson(exportProjectJson(p));
  assert.equal(single.kind, "project");
  assert.equal(single.agents[0].name, p.name);

  const backup = parseStudioJson(exportAllProjectsJson({ projects: [p], activeId: p.id }));
  assert.equal(backup.kind, "library");
  assert.equal(backup.agents.length, 1);
  assert.throws(() => parseStudioJson("{}"), /teambibliotek|projekt/i);
});

test("English step label for conversation starters is Prompts", () => {
  assert.equal(STR.en.stepStarters, "Prompts");
  assert.equal(STR.sv.stepStarters, "Startfrågor");
  assert.match(STR.en.templatesLede, /\{n\} ready cookbooks/);
  assert.match(STR.sv.templatesLede, /\{n\} färdiga kokböcker/);
});
