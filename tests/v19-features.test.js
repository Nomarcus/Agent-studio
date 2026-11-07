import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import JSZip from "jszip";
import { createFromTemplate } from "../src/templates.js";
import { createEmptyProject, normalizeProject } from "../src/model.js";
import {
  buildDeclarativeAgent,
  buildPackageFiles,
  buildZip,
} from "../src/package.js";
import { collectFieldErrors, createValidators, validateGenerated } from "../src/validate.js";
import { LIMITS } from "../src/util.js";
import { pushHistory, undoHistory, canUndo } from "../src/store.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const daSchema = JSON.parse(readFileSync(join(root, "schemas/declarative-agent-v1.9.json"), "utf8"));
const teamsSchema = JSON.parse(readFileSync(join(root, "schemas/MicrosoftTeams.v1.29.schema.json"), "utf8"));
const pluginSchema = JSON.parse(readFileSync(join(root, "schemas/plugin-v2.4.json"), "utf8"));

async function validators() {
  return createValidators(Ajv, daSchema, teamsSchema, pluginSchema, addFormats);
}

test("v1.9 advanced fields validate against official schema", async () => {
  const p = createFromTemplate("customer-service");
  p.sensitivityLabelId = "11111111-1111-1111-1111-111111111111";
  p.workerAgents = [{ id: "P_2c27ae89-1f78-4ef7-824c-7d83f77eda28" }];
  p.userOverrideCaps = ["WebSearch", "OneDriveAndSharePoint"];
  p.capabilities.WebSearch.enabled = true;
  p.capabilities.OneDriveAndSharePoint.enabled = true;
  p.editorialAnswers = [
    { question: "Vad är returpolicyn?", answer: "30 dagar med kvitto." },
  ];
  p.agentSkills = [
    { folder: "skills/jira-lookup", name: "Jira lookup", description: "Find tickets", body: "Search Jira." },
  ];
  const v = await validators();
  const result = validateGenerated(p, v);
  assert.equal(result.fieldErrors.length, 0, JSON.stringify(result.fieldErrors));
  assert.equal(result.schemaErrors.length, 0, JSON.stringify(result.schemaErrors));
  assert.equal(result.da.sensitivity_label.id, p.sensitivityLabelId);
  assert.equal(result.da.worker_agents[0].id, p.workerAgents[0].id);
  assert.equal(result.da.user_overrides.length, 2);
  assert.equal(result.da.editorial_answers.answers.length, 1);
  assert.ok(result.da.agent_skills.some((s) => s.folder === "./skills/jira-lookup"));
  const { files } = buildPackageFiles(p);
  assert.match(files["skills/jira-lookup/SKILL.md"], /Jira lookup/);
});

test("embedded knowledge files are packed into the zip", async () => {
  const p = createFromTemplate("blank");
  p.capabilities.EmbeddedKnowledge.enabled = true;
  const text = "Runbook: restart the adapter and check the queue.";
  p.embeddedFiles = [
    {
      file: "runbook.txt",
      contentBase64: Buffer.from(text, "utf8").toString("base64"),
      size: text.length,
    },
  ];
  p.sensitivityLabelId = "22222222-2222-2222-2222-222222222222";
  const v = await validators();
  const result = validateGenerated(p, v);
  assert.equal(result.ok, true, JSON.stringify([...result.fieldErrors, ...result.schemaErrors]));
  assert.deepEqual(result.da.capabilities.find((c) => c.name === "EmbeddedKnowledge").files, [
    { file: "runbook.txt" },
  ]);
  const { bytes } = await buildZip(p, {}, JSZip);
  const zip = await JSZip.loadAsync(bytes);
  const packed = await zip.file("runbook.txt").async("string");
  assert.equal(packed, text);
});

test("invalid sensitivity label and oversized embedded file fail validation", () => {
  const p = createEmptyProject();
  p.name = "X";
  p.description = "Y";
  p.instructionsMode = "raw";
  p.instructionsRaw = "You are a helpful agent.";
  p.sensitivityLabelId = "not-a-guid";
  p.capabilities.EmbeddedKnowledge.enabled = true;
  p.embeddedFiles = [{ file: "notes.exe", contentBase64: "QQ==", size: 2 }];
  const errors = collectFieldErrors(p).errors;
  assert.ok(errors.some((e) => e.code === "SENS_LABEL"));
  assert.ok(errors.some((e) => e.code === "EMBED_TYPE"));
});

test("normalizeProject fills missing v1.9 arrays", () => {
  const n = normalizeProject({ name: "A", description: "B", id: "x" });
  assert.ok(Array.isArray(n.workerAgents));
  assert.ok(Array.isArray(n.embeddedFiles));
  assert.equal(n.sensitivityLabelId, "");
});

test("history undo returns previous snapshot", () => {
  // store helpers touch localStorage; stub a minimal in-memory path via direct stack ops
  const a = createEmptyProject({ name: "One" });
  const b = { ...a, name: "Two" };
  let history = { stack: [], index: -1, projectId: null };
  // Avoid localStorage by monkeypatching would be heavy; instead unit-test push shape offline:
  const snapA = JSON.stringify(a);
  const snapB = JSON.stringify(b);
  history = { stack: [snapA, snapB], index: 1, projectId: a.id };
  assert.equal(canUndo(history), true);
  const { history: h2, project } = undoHistory(history);
  // undoHistory writes localStorage — in Node it may throw or no-op depending on env
  assert.equal(project.name, "One");
  assert.equal(h2.index, 0);
});

test("incident template display name matches sidebar", () => {
  const p = createFromTemplate("incident-analyst");
  assert.match(p.name, /incidentanalytiker/i);
  assert.ok(p.name.includes("Ärende") || p.name.toLowerCase().includes("incident"));
});
