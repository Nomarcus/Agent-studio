# Agent Studio — Review Round 2

Independent senior review after reading README, PROGRESS, docs, source, tests, official
[declarative agent schema v1.9](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/declarative-agent-manifest-1.9),
and driving the live app at `http://127.0.0.1:4173` with Playwright (system Chrome) as a
non-developer: blank agent, every template, import of `examples/kundtjanstagent-copilot-agent.zip`,
export zip, print spec, SV/EN, dark/light, mobile 390×844.

Tests before review: **10/10 passing**.

---

## P0 — Must fix for someone who would buy or demo this

### 1. Missing v1.9 fields that matter for a serious package
Verified against learn.microsoft.com (2026). Schema root supports but UI/model omit:
- `worker_agents` (preview — reference other declarative agents)
- `user_overrides` (let end users toggle capabilities such as WebSearch / TeamsMessages)
- `sensitivity_label` (Purview GUID; relevant with EmbeddedKnowledge)
- `editorial_answers` (Q&A pairs — high value for support/FAQ agents)
- `agent_skills` (folders with `SKILL.md`, max 8)

**Buyer impact:** a competitor or Agents Toolkit user will notice the package is “v1.9 in name only”.

### 2. Embedded knowledge is filenames-only — no real file picker
Schema allows up to 10 files (docx/pdf/txt/…) **inside the app package**, ≤1 MB each.
UI is a textarea of names; zip never contains those binaries → Copilot cannot ground on them.
**Need:** file picker, size/type checks, store bytes, write into zip, list/remove in UI.

### 3. No “quick start in 60 seconds”
Welcome is a flat template grid + “Välj en mall…”. A first-time Swede on an integration team
needs a hero CTA that creates Kundtjänstagent, asks for 3 fields (name, site, optional Jira
connector id), and lands on export. Today that journey is five wizard steps with developer GUIDs
up front.

### 4. Cannot open via `file://` / no single-file build
README admits Chrome blocks ES modules on `file://`. For internal share / USB / SharePoint
“drop this one file”, buyers expect `dist/agent-studio.html` that works offline without a server.

### 5. Re-clicking a template silently duplicates drafts
Playwright: click Kundtjänstagent twice → 2 draft cards. Easy to spam the sidebar; no confirm,
no “you already have this”.

---

## P1 — UX confusion / polish / Swedish quality

### 6. Weak landing / onboarding
No hero, no “how it works (kock + recept)”, no import on the welcome screen, no link to the
sales one-pager or publish steps. Aside is empty/hidden; first impression is “dev tool”, not product.

### 7. No undo
Every keystroke autosaves to `localStorage`. Accidental wipe of a skill or paste-over has no
Ctrl+Z / Ångra. Deal-breaker for long instruction editing.

### 8. Print spec ignores Swedish UI language
Hard-coded English `Quality score:` in `printSpec()` while the rest of the UI is Swedish.

### 9. Identity step leads with GUIDs and example.com
Non-developers hit App-id / version / three example.com URLs before they write a single skill.
Quick-start and a collapsed “Avancerat / utgivare” section would help.

### 10. Incident template name mismatch
Sidebar: “Ärende- och incidentanalytiker”. Agent `name`: “Incidentanalytiker”. Looks unfinished.

### 11. Capability extras half-translated
ScenarioModels label is English `"Model ids"`. EmbeddedKnowledge label is `"Filer / files"`.
Email group mailboxes not exposed. Meetings `items_by_id` not exposed (flag-only is OK for v1).

### 12. Share / project portability is easy to miss
Export project JSON exists only on the Package step. No top-bar share, no “backup all drafts”,
no copy-to-clipboard of project JSON. Welcome cannot import.

### 13. Mobile: usable but dense
At 390px layout stacks (good, no horizontal overflow). Sidebar templates end up below the editor;
no skip link / “Mallar”-drawer. Topbar wraps awkwardly. Validation aside appears between main and
templates — easy to miss errors before export.

### 14. Validation copy noise
Aside prefixes every error row with the heading **Fel** again (`<b>Fel</b>…`), so a list reads
“Fel Fel Fel”. Same for warnings.

### 15. Blank agent is not blank
“Tom agent” still ships a role + skill + 1145-character instructions and reports score 100 /
“Redo att exportera”. Fine as a starter scaffold, but the label “Tom” / “Blank” is misleading —
rename or truly empty with a stronger empty-state nudge.

### 16. Swedish microcopy nits
- Tagline “Recept för …” is good; welcome lede is thin.
- “appaket” → should be “app-paket” or “appaket” is uncommon; prefer “appaket (.zip)” → “appaket” is OK in compounds but “Exportera appaket” reads better as “Exportera app-paketet (.zip)”.
- Cookbook metaphor never appears in the UI itself (only README) — missed teaching moment for Marcus’s team rollout.

### 17. Light theme / visual polish
Icons and gold accents work. Light theme JSON preview stays near-black (intentional) but cards
could use slightly tighter hierarchy. Sticky topbar is good. No empty-state illustration / steps
on welcome.

### 18. API plugin stub UX
Toggle exists; OpenAPI remains placeholder — OK if clearly labeled. No upload of a real
`openapi.yaml` / `plugin.json` to replace the stub (buyer expectation for “Custom Skills” demos).

---

## P2 — Schema / correctness notes (verified)

### 19. Official schema alignment (good)
Vendored DA v1.9 + Teams 1.29; Ajv rejects unknown properties; WebSearch path/query rules match
docs (≤2 path segments, no query). Conversation starters max 12 enforced. Tests cover this.

### 20. `$schema` on DA object
Emitted in generated JSON; official examples include it. Ajv warns `unknown format "uri"` —
cosmetic, not a failure.

### 21. EmbeddedKnowledge + sensitivity_label
Docs: sensitivity labels apply when embedded files exist; feature still limited at Microsoft.
UI should still allow authors to set the Purview id and ship files for when the platform enables it.

### 22. `behavior_overrides.default_response_mode`
Values `Auto` | `Quick response` | `Think deeper` match docs — good.

### 23. Import zip roundtrip
Import of example zip restores name “Kundtjänstagent”. Structured skills collapse to raw
instructions (expected). Icons from zip are not re-applied into the icon generator state
(initials still used on next export) — minor fidelity gap.

---

## P3 — Product / sales gaps a buyer notices

### 24. No in-app publish checklist
README explains Teams Developer Portal / Agents Toolkit / sideload; Package step only has a
short paragraph. A 4-step checklist with copyable tips would close demos.

### 25. No sample “before/after” or demo script in UI
`docs/sales-onepager.md` is strong but not linked from the app.

### 26. No keyboard help / shortcuts
With undo added, document Ctrl+Z / Ctrl+S mental model (save is automatic — say so).

### 27. Tests do not cover UI or new v1.9 fields
Node tests are solid for generation; Playwright screenshots script is a smoke walk, not CI assertions
for quick-start, undo, embedded files, or single-file build.

---

## What already works well (keep)

- Offline, no account, autosave, bilingual SV/EN, dark/light.
- Cookbook templates map to Marcus’s real work (Jira, XML, estimates, monthly reports).
- Schema validation + instruction lint + test prompts in the aside.
- Zip export/import and project JSON.
- Generated color/outline icons.
- 10/10 unit tests; screenshot script against system Chrome.

---

## Fix plan (this round)

1. Add model + package + UI for `worker_agents`, `user_overrides`, `sensitivity_label`,
   `editorial_answers`, and basic `agent_skills` folder stubs.
2. Embedded-knowledge file picker with zip inclusion and validation.
3. Welcome hero + 60-second quick start + import on landing.
4. Undo stack + topbar control; fix template re-click duplication; print i18n; microcopy.
5. Collapsible publisher/advanced identity; publish checklist on Package.
6. `npm run build` → `dist/agent-studio.html` (single file, `file://` OK).
7. Tests for new fields, embedded files, undo helpers, single-file smoke; refresh `shots/`.
8. Update README + PROGRESS; commit locally often.

