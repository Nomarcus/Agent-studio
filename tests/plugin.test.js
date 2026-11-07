import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import JSZip from "jszip";
import { parseOpenApi, parseAndList, listOperations, namespaceFromName } from "../src/openapi.js";
import {
  buildApiPlugin,
  createJiraCloudActions,
  JIRA_CLOUD_OPENAPI_YAML,
} from "../src/plugin.js";
import { createFromTemplate, TEMPLATE_LIST } from "../src/templates.js";
import { compileSkillMarkdown, parseSkillMarkdown, deriveAgentSkills } from "../src/skillmd.js";
import { buildPackageFiles, buildZip, importPackageZip, applyImportedToProject } from "../src/package.js";
import { collectFieldErrors, createValidators, validateGenerated } from "../src/validate.js";
import { createEmptyProject, normalizeProject, compileInstructions } from "../src/model.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const daSchema = JSON.parse(readFileSync(join(root, "schemas/declarative-agent-v1.9.json"), "utf8"));
const teamsSchema = JSON.parse(readFileSync(join(root, "schemas/MicrosoftTeams.v1.29.schema.json"), "utf8"));
const pluginSchema = JSON.parse(readFileSync(join(root, "schemas/plugin-v2.4.json"), "utf8"));
const sampleYaml = readFileSync(join(root, "samples/jira-cloud.openapi.yaml"), "utf8");

async function validators() {
  return createValidators(Ajv, daSchema, teamsSchema, pluginSchema, addFormats);
}

test("bundled Jira sample parses as OpenAPI 3 with the three support operations", () => {
  assert.equal(sampleYaml, JIRA_CLOUD_OPENAPI_YAML);
  const parsed = parseAndList(sampleYaml);
  assert.equal(parsed.ok, true, parsed.error);
  assert.match(parsed.spec.openapi, /^3\./);
  const ids = parsed.operations.map((op) => op.operationId);
  assert.deepEqual(ids, ["searchIssues", "getIssue", "addComment"]);
  assert.equal(parsed.operations[0].method, "GET");
  assert.equal(parsed.operations[1].method, "GET");
  assert.equal(parsed.operations[2].method, "POST");
});

test("OpenAPI JSON and YAML both list the same operations", () => {
  const yamlParsed = parseOpenApi(sampleYaml);
  const jsonText = JSON.stringify(yamlParsed.spec);
  const jsonParsed = parseAndList(jsonText);
  assert.equal(jsonParsed.ok, true, jsonParsed.error);
  assert.deepEqual(
    jsonParsed.operations.map((op) => op.operationId),
    listOperations(yamlParsed.spec).map((op) => op.operationId)
  );
});

test("invalid YAML and swagger 2 documents are rejected", () => {
  const bad = parseOpenApi(":::\nnot: [yaml");
  assert.equal(bad.ok, false);
  const swagger = parseOpenApi(JSON.stringify({ swagger: "2.0", info: { title: "Old", version: "1" }, paths: {} }));
  assert.equal(swagger.ok, false);
  assert.match(swagger.error, /OpenAPI 3/);
});

test("generated Jira plugin validates against official schema v2.4", async () => {
  const p = createFromTemplate("customer-service");
  const built = buildApiPlugin(p);
  assert.equal(built.ok, true, built.error);
  assert.equal(built.plugin.schema_version, "v2.4");
  assert.equal(built.plugin.namespace, "jira");
  assert.equal(built.plugin.runtimes[0].type, "OpenApi");
  assert.equal(built.plugin.runtimes[0].auth.type, "ApiKeyPluginVault");
  assert.equal(built.plugin.runtimes[0].auth.reference_id, "jira-api-key");
  assert.deepEqual(
    built.plugin.functions.map((f) => f.name),
    ["searchIssues", "getIssue", "addComment"]
  );
  const search = built.plugin.functions.find((f) => f.name === "searchIssues");
  assert.equal(search.capabilities.response_semantics.data_path, "$.issues");
  assert.equal(search.capabilities.response_semantics.properties.title, "$.key");
  assert.equal(search.capabilities.response_semantics.static_template.type, "AdaptiveCard");
  const comment = built.plugin.functions.find((f) => f.name === "addComment");
  assert.equal(comment.capabilities.confirmation.type, "AdaptiveCard");
  assert.ok(comment.capabilities.security_info.data_handling.includes("ResourceStateUpdate"));

  const v = await validators();
  assert.equal(v.plugin(built.plugin), true, JSON.stringify(v.plugin.errors));
  const result = validateGenerated(p, v);
  assert.equal(result.schemaErrors.length, 0, JSON.stringify(result.schemaErrors));
  assert.ok(result.warnings.some((w) => w.code === "PLUGIN_AUTH_PLACEHOLDER"));
});

test("OAuth and API key auth require a vault reference id; None does not", () => {
  const p = createFromTemplate("customer-service");
  p.actions.authType = "None";
  p.actions.authReferenceId = "";
  let errors = collectFieldErrors(p).errors;
  assert.ok(!errors.some((e) => e.code === "PLUGIN_AUTH_REF"));
  const built = buildApiPlugin(p);
  assert.equal(built.plugin.runtimes[0].auth.type, "None");
  assert.equal(built.plugin.runtimes[0].auth.reference_id, undefined);

  p.actions.authType = "OAuthPluginVault";
  p.actions.authReferenceId = "";
  errors = collectFieldErrors(p).errors;
  assert.ok(errors.some((e) => e.code === "PLUGIN_AUTH_REF"));

  p.actions.authType = "OAuthPluginVault";
  p.actions.authReferenceId = "oauth-ref-1";
  errors = collectFieldErrors(p).errors;
  assert.ok(!errors.some((e) => e.code === "PLUGIN_AUTH_REF"));
  assert.equal(buildApiPlugin(p).plugin.runtimes[0].auth.reference_id, "oauth-ref-1");
});

test("enabling a plugin without a spec or selected operations fails validation", () => {
  const p = createEmptyProject({ name: "X", description: "A valid description for tests." });
  p.instructionsMode = "raw";
  p.instructionsRaw = "You are a careful helper for an integration team.";
  p.actions.enabled = true;
  p.actions.specText = "";
  let errors = collectFieldErrors(p).errors;
  assert.ok(errors.some((e) => e.code === "OPENAPI_REQUIRED"));

  p.actions.specText = sampleYaml;
  p.actions.selectedOps = [];
  errors = collectFieldErrors(p).errors;
  assert.ok(errors.some((e) => e.code === "OPENAPI_SELECT"));
});

test("every template skill ships a real SKILL.md with when, steps, output and example", () => {
  for (const meta of TEMPLATE_LIST) {
    const p = createFromTemplate(meta.id);
    const agentSkills = deriveAgentSkills(p);
    assert.ok(agentSkills.length >= 1, `${meta.id} missing agentSkills`);
    assert.equal(agentSkills.length, p.skills.length, `${meta.id} skill count mismatch`);
    for (const skill of agentSkills) {
      const md = compileSkillMarkdown(skill);
      assert.match(md, /^---\nname:/);
      assert.match(md, /## When to use/);
      assert.match(md, /## Steps/);
      assert.match(md, /## Output format/);
      assert.match(md, /## Example/);
      assert.ok((skill.example || "").length > 40, `${meta.id} / ${skill.name} example too thin`);
    }
  }
  const cs = createFromTemplate("customer-service");
  const analyze = deriveAgentSkills(cs).find((s) => s.folder === "skills/analyze-jira-ticket");
  assert.ok(analyze);
  assert.match(analyze.example, /INT-1842/);
});

test("zip roundtrip restores Jira plugin and SKILL.md sections", async () => {
  const original = createFromTemplate("customer-service");
  original.app.websiteUrl = "https://integrations.example.org";
  original.app.privacyUrl = "https://integrations.example.org/privacy";
  original.app.termsOfUseUrl = "https://integrations.example.org/terms";
  const { bytes, files } = await buildZip(original, {}, JSZip);
  assert.ok(files["plugin.json"]);
  assert.ok(files["openapi.yaml"]);
  assert.match(files["skills/analyze-jira-ticket/SKILL.md"], /INT-1842/);
  const imported = await importPackageZip(bytes, JSZip);
  assert.equal(imported.plugin.schema_version, "v2.4");
  assert.match(imported.openapiText, /searchIssues/);
  const restored = normalizeProject(applyImportedToProject(createEmptyProject(), imported));
  assert.equal(restored.actions.enabled, true);
  assert.equal(restored.actions.namespace, "jira");
  assert.ok(restored.actions.selectedOps.includes("searchIssues"));
  assert.equal(restored.actions.authType, "ApiKeyPluginVault");
  const skill = deriveAgentSkills(restored).find((s) => s.folder === "skills/analyze-jira-ticket");
  assert.ok(skill);
  assert.match(skill.example, /INT-1842/);
  // Round 4: structured cookbook is restored, not collapsed to raw text.
  assert.equal(restored.instructionsMode, "structured");
  assert.equal(restored.skills.length, original.skills.length);
  assert.equal(compileInstructions(restored), compileInstructions(original));
});

test("SKILL.md compile/parse keeps structured sections", () => {
  const md = compileSkillMarkdown({
    folder: "skills/demo",
    name: "Demo skill",
    description: "A short description",
    when: "When the user asks for a demo.",
    how: "1. Do the thing.",
    output: "## Result",
    example: "User: demo\nAssistant: ## Result",
    body: "",
  });
  const parsed = parseSkillMarkdown("skills/demo", md);
  assert.equal(parsed.name, "Demo skill");
  assert.match(parsed.when, /demo/);
  assert.match(parsed.how, /Do the thing/);
  assert.equal(parsed.output, "## Result");
  assert.match(parsed.example, /User: demo/);
});

test("namespaceFromName strips punctuation and accents", () => {
  assert.equal(namespaceFromName("Kundtjänst-agent!"), "Kundtjanst-agent");
  assert.match(namespaceFromName("Jira Cloud"), /^[A-Za-z0-9-]+$/);
});

test("createJiraCloudActions can be attached to a blank project and export", async () => {
  const p = createFromTemplate("blank");
  p.actions = createJiraCloudActions();
  const v = await validators();
  const result = validateGenerated(p, v);
  assert.equal(result.fieldErrors.length, 0, JSON.stringify(result.fieldErrors));
  assert.equal(result.schemaErrors.length, 0, JSON.stringify(result.schemaErrors));
  const { files } = buildPackageFiles(p);
  const plugin = JSON.parse(files["plugin.json"]);
  assert.equal(v.plugin(plugin), true, JSON.stringify(v.plugin.errors));
});
