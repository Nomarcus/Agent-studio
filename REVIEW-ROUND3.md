# Agent Studio — Review Round 3

Independent product-owner review after reading README, PROGRESS, REVIEW-ROUND2,
source, official [plugin manifest schema v2.4](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/plugin-manifest-2.4)
(`https://developer.microsoft.com/json-schemas/copilot/plugin/v2.4/schema.json`),
and driving the live app with Playwright (system Chrome).

Tests before this round’s new cases: **16/16 passing**.
Tests after: **27/27 passing**.

---

## P0 — Must fix for someone who would buy or demo this

### 1. API plugin was a stub, not a plugin
`buildPluginStub()` wrote schema **v2.3** with one fake `exampleOperation` and a
placeholder `/example` OpenAPI. A buyer opening Kundtjänstagent and expecting Jira
tools would export something Copilot cannot call.

**Need:** upload or paste OpenAPI 3 (YAML/JSON), pick operations, emit a valid
v2.4 plugin manifest with auth and response semantics, plus a real Jira sample
for the Customer Service Agent.

**Fixed:** `src/openapi.js` + `src/plugin.js` + vendored js-yaml and official
plugin schema v2.4. UI on Förmågor: paste/upload, Jira sample button, operation
picker, JSONPath citation mapping, Adaptive Card toggle, confirmation toggle.
Auth: `None` | `OAuthPluginVault` | `ApiKeyPluginVault` with required
`reference_id` (schema `allOf`). Customer Service Agent ships
`samples/jira-cloud.openapi.yaml` (`searchIssues`, `getIssue`, `addComment`).
Generated `plugin.json` validates with Ajv against the official schema.

### 2. agent_skills were empty stubs
Templates packed `SKILL.md` files that said “Describe how the agent should use
this skill.” Microsoft’s `agent_skills` folders are meant to be real recipes.

**Fixed:** every template skill now writes a structured SKILL.md (when to use,
steps, output format, example). Customer Service examples use INT-1842-style
material. The Instructions step has a full editor; zip import parses the
sections back.

### 3. No “how will this look in Copilot?”
Identity and package steps showed forms and JSON. A stakeholder could not
picture the agent chrome (name, icon, description, starters).

**Fixed:** aside preview pane labelled **Förhandsgranskning — inte live**, with
icon, name, description, starter chips (disabled) and a fake compose box.
Copy states it is a sketch, not a tenant connection.

---

## P1 — UX, mobile, accessibility, Swedish

### 4. Mobile topbar wrapped awkwardly
At 390px the brand, “Säkerhetskopiera alla utkast” and six other buttons fought
for one row.

**Fixed:** topbar stacks (brand + save pill, then actions). Backup label shortened
to “Säkerhetskopiera”. Mobile buttons have a larger tap target.

### 5. Accessibility gaps
Labels were visual-only (`<label>` next to an unassociated input). No skip link,
weak `:focus-visible`, faint text close to 4.5:1, icon `alt=""`, language/theme
buttons without accessible names.

**Fixed:** `for`/`id` on fields, skip link to `#main`, gold focus ring,
`--faint` contrast bump, icon alts, `aria-label`/`title` on topbar controls,
`aria-current="step"` on the wizard.

### 6. Swedish copy still talked about a stub
“Inkludera en API-plugin-stubbe” and README limitations described a placeholder.
Publisher field reused the label “Namn” (same as the agent name).

**Fixed:** “Koppla ett API-plugin (OpenAPI)”, package help mentions `plugin.json`,
publisher label is “Utgivarnamn”, plugin auth copy explains vault reference ids
(no secrets in the manifest).

---

## P2 — Schema / correctness notes (verified)

### 7. Official plugin schema v2.4
Required root: `schema_version` (const `v2.4`), `name_for_human`, `namespace`
(`^[A-Za-z0-9-]+$`), `description_for_human`. Runtime requires `type`, `auth`,
`spec`. Auth `OAuthPluginVault` / `ApiKeyPluginVault` require `reference_id`.
`$schema` is allowed by `propertyNames`. Unrecognized properties are rejected.

Generated Jira plugin passes Ajv. Tests cover YAML + JSON parse, swagger 2
rejection, missing spec/operations, auth rules, Adaptive Card + confirmation
on `addComment`, and zip roundtrip of `plugin.json` / `openapi.yaml` / SKILL.md.

### 8. Jira sample is a focused subset, not the full Cloud API
Three operations against `https://{yourDomain}.atlassian.net`, Basic auth
described as a vault-mapped API token, ADF comment body documented. Authors
must replace `yourDomain` and `jira-api-key` — the latter is a **warning**,
not an export blocker, so demos still produce a schema-valid zip.

### 9. Import fidelity
Zip import now restores plugin metadata (namespace, selected operations, auth,
response semantics) and structured SKILL.md sections. Cookbook `skills[]` still
collapse to raw instructions (same as round 2).

---

## What already works well (keep)

- Offline, no account, autosave, undo, bilingual SV/EN, dark/light.
- Cookbook templates mapped to real integration work.
- Schema validation of DA v1.9 + Teams 1.29, now also plugin v2.4.
- Quick start, publish checklist, single-file `dist/agent-studio.html`.

---

## Remaining weaknesses

- Cannot sideload into a real Microsoft 365 tenant from this environment.
- Preview is visual only — starters are not a live Copilot chat.
- Instructions step is long: cookbook recipes (compiled into `instructions`)
  and SKILL.md folders are edited separately even though templates seed one
  from the other.
- Adaptive Cards are generated JSON, not a visual card designer.
- One API plugin per agent.
- Jira server host and vault reference remain placeholders until the customer
  fills them in Teams Developer Portal.
- Ajv still warns `unknown format "uri"` (cosmetic, same as the DA schema).

---

## Fix plan (this round) — done

1. Vendor plugin schema v2.4 + js-yaml; parse OpenAPI 3; generate valid plugins.
2. Ship Jira Cloud sample and attach it to Kundtjänstagent.
3. Real SKILL.md per template skill, editable in the UI, round-tripped on import.
4. Copilot preview pane, clearly labelled as preview.
5. Mobile topbar, accessibility, Swedish copy.
6. Tests (27) + Playwright shots including `12-plugin.png`.
7. Rebuild `dist/agent-studio.html`; commit locally only.
