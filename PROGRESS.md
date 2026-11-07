# Agent Studio — progress

## Goal
A complete, offline, client-side web app that lets a non-developer design, validate and export a Microsoft 365 Copilot declarative agent package (manifest v1.29 + declarative agent schema v1.9 + API plugin schema v2.4).

## Research (done)
- Official DA schema: v1.9
  https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/declarative-agent-manifest-1.9
- Official Teams/M365 app manifest: v1.29
- Official API plugin schema: v2.4
  https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/plugin-manifest-2.4
  https://developer.microsoft.com/json-schemas/copilot/plugin/v2.4/schema.json

## Done
- Core generation, validation, lint, cookbook templates
- Official schemas vendored (DA v1.9, Teams 1.29, plugin v2.4); Ajv + JSZip + js-yaml vendored
- Bilingual UI (SV/EN), dark/light, wizard + editor, autosave, undo/redo
- Export/import app zip and project JSON, printable spec, generated icons
- v1.9 fields in UI + package: worker_agents, user_overrides, sensitivity_label,
  editorial_answers, agent_skills (real SKILL.md), embedded knowledge file picker
- Welcome hero + 60-second quick start (Kundtjänstagent)
- Publish checklist, draft backup
- Real API plugins: upload/paste OpenAPI 3, pick operations, auth (None / OAuth / API key
  vault reference id), response semantics + Adaptive Cards
- Bundled Jira Cloud REST sample (searchIssues, getIssue, addComment) on Customer Service Agent
- Copilot appearance preview pane (labelled as preview, not live)
- Mobile stacked topbar, label/keyboard/contrast accessibility pass, Swedish copy polish
- Single-file build: `npm run build` → `dist/agent-studio.html` (file:// OK)
- Round 4: single "Skills" step (one card per skill → instructions + SKILL.md), recipe
  library, structured zip re-import, kept imported icons, premium landing page, package
  file browser + dynamic checklist, toasts instead of alert/confirm, undo per structural edit,
  ajv-formats vendored (no more "unknown format" warnings), Swedish copy pass
- docs/Guide-sv.md (team guide) and docs/pitch-sv.md (pitch + pricing)
- `npm run release` → agent-studio.zip (app, README, docs, examples)
- Round 5: clickable Prompts (preview chips + stepper), markdown preview on skill fields,
  English copy brought in line with Swedish, six new templates (proposal, onboarding,
  release notes, test cases, mapping spec, 5-whys RCA), team library export/import,
  axe-core vendored and wired into Playwright (WCAG 2.1 A/AA clean), welcome mock
  shows the last opened agent
- Node tests: 47/47 passing; Playwright E2E (file:// + http://) clean, including axe
- Playwright screenshots against system Chrome (including plugin editor)
- REVIEW-ROUND2.md, REVIEW-ROUND3.md, REVIEW-ROUND4.md and REVIEW-ROUND5.md written
- Local git only; nothing published

## Still weak / out of scope here
- Cannot sideload into a real Microsoft 365 tenant from this environment
- Jira sample uses placeholder vault id `jira-api-key` and `{yourDomain}.atlassian.net`
- Preview pane is visual only (starters now fill the compose box, still no live chat)
- Template instructions are English (starters Swedish); no Swedish-only template set yet
- Adaptive Cards are generated, not rendered as a live card designer
- One API plugin per agent (typical for a declarative agent package)
- sensitivity_label / EmbeddedKnowledge still limited on Microsoft's platform
- No cloud shared template catalog / SSO (intentional offline product)
- Team library is a file you pass around, not a live shared folder

## How to open
```bash
cd /workspace/agent-studio && npm run build
# open dist/agent-studio.html   (or npm run release → agent-studio.zip)
# or: python3 -m http.server 4173
```
