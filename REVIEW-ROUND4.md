# Agent Studio — Review Round 4 (final polish)

Independent first-time-buyer review. I read README, PROGRESS, REVIEW-ROUND2/3 and the
source, then drove `dist/agent-studio.html` from **file://** and the dev build over
**http://** with Playwright + system Chrome (`/usr/bin/google-chrome`).

Tests before: **27/27**. Tests after: **41/41** unit tests + an end-to-end Playwright run
(`npm run e2e`) that exercises both file:// and http:// and fails on any console error,
page error, unexpected dialog or Ajv `unknown format` warning.

---

## P0 — What a buyer would hit first

### 1. The Instructions step was 7 500 px long and edited every skill twice
Cookbook recipes (compiled into `instructions`) and SKILL.md folders had separate editors
that drifted apart. A buyer saw four recipes, then the same four again as "SKILL.md 1–4".

**Fixed — one "Skills" step, one card per skill.**
- Top card *Kocken*: role, working style, guardrails.
- One collapsible card per skill with **Vem och när? / Steg / Svarsformat**, plus an
  optional *Exempel och SKILL.md-inställningar* drawer (example, folder, frontmatter
  description, live SKILL.md preview). Only one card is open at a time.
- Each card generates **both** the instruction section and `skills/<slug>/SKILL.md`.
  A per-card toggle can keep a skill in the instructions only.
- *Hämta ett recept från mallarna…* adds any skill from the other templates.
- Move up/down, remove with toast + Ctrl+Z.
- A result bar shows chars/8 000 as a meter and "N SKILL.md-filer"; the compiled text and
  the free-text mode are tucked into a drawer.
- Page height for Kundtjänstagent: **7 492 px → ~1 850 px**.

Data model: `skills[]` is now the single source of truth (`id, name, when, how, output,
example, folder, description, notes, skillMd`). `deriveAgentSkills()` builds the
`agent_skills` + SKILL.md files. Old drafts with a separate `agentSkills[]` are merged into
the cards on load (`mergeAgentSkillsIntoSkills`) — nothing is lost.

### 2. Importing a zip threw the cookbook away
Round 3 imported every package as raw text. Re-importing your own export meant losing the
skill cards.

**Fixed:** `parseCompiledInstructions()` reverses Agent Studio's own format; if the
round-trip is byte-identical the project comes back structured, otherwise it stays raw.
SKILL.md examples merge back into their cards. Imported icons are kept (a real logo is not
replaced by initials on re-export), initials/accent are restored, and broken files give a
friendly toast instead of an uncaught exception.

### 3. Welcome screen looked like an admin page
Templates were listed twice (sidebar + grid) next to a plain hero.

**Fixed:** full-width landing page — gradient headline, three trust points, a product mock
(agent card + zip contents with schema versions), four feature cards, a 1-2-3 strip,
"Fortsätt där du slutade" for existing drafts, and template tiles with accent stripe and
audience tag. Sidebar and validation panel are hidden on the landing page. Undo/redo are
hidden until a draft is open.

---

## P1 — Bugs and friction found while clicking through

| # | Finding | Fix |
|---|---|---|
| 4 | Ajv logged 10× `unknown format "uri" ignored` in the browser and in tests. | `ajv-formats` vendored **in the same bundle** as Ajv (`vendor/ajv.esm.js`, `npm run vendor`) so codegen is shared; `createValidators(…, addFormats)`. URIs are now actually validated (test proves an invalid `websiteUrl` fails). Unused `ajv2020.esm.js` / `jszip.min.js` removed. |
| 5 | Undo after add+remove skipped steps (one 280 ms debounce for everything). | Structural edits (add/remove/move skill, starter, answer, worker, file, Jira sample, mode switch) commit immediately; pending typing is flushed first. |
| 6 | Native `confirm()` blocked every template click once a draft existed; `alert()` for file errors. | Template click just creates a new draft + toast ("ditt förra utkast finns kvar"). All alerts are toasts. Only *Ta bort utkast* still confirms. |
| 7 | Swedish role "en kundtjänstagent…" compiled to "You are en kundtjänstagent". | Roles starting with "en/ett" compile to "Du är en …"; hint under the field explains it. |
| 8 | Renaming the agent kept the old initials ("Jira-hjälpen" showed "KU"). | Auto-initials follow the name until the user sets their own; sidebar name/initials update live. |
| 9 | Test prompts were Swedish in the English UI and generic after import. | `suggestedTestPrompts(project, lang)`; imports derive prompts from the restored skills. |
| 10 | Package step: four buttons of equal weight, a static checklist that said "byt example.com" even after you had, JSON preview limited to 3 files. | Export hero (green/red status, big CTA, zip filename), **dynamic checklist** (real URLs, plugin reference id, Jira `{yourDomain}`, validation), secondary actions in a side card, and a **zip file browser** — click any file incl. `SKILL.md`, `openapi.yaml` or the PNG icons. |
| 11 | Capabilities step: 3 000 px of OpenAPI text and per-operation JSONPath fields. | Spec textarea collapsed once loaded (summary shows "3 operationer"), per-operation citation/card/confirmation fields in a drawer, *Avancerat (schema v1.9)* collapsed. |
| 12 | Textareas cut off multi-line steps. | Auto-grow (max 520 px). |
| 13 | Steps didn't scroll to top; page started mid-way after "Nästa". | Scroll to top on step change; new skills scroll into view and focus. |
| 14 | Mobile: backup button forced the topbar to three rows. | Hidden < 760 px (still on the Package step). |

## P2 — Swedish copy

Fixed: *integrationincidenser* → integrationsincidenter, *kundupdate* → kunduppdatering,
*diff:a payloads, kartlägga* → jämför payloads, kartlägg (consistent imperative),
*Teamlead* → Teamledare, *Scenario-modeller* → Scenariomodeller, *valv-referens* →
valvreferens, *Användaröverskridning för X* → "Användaren får stänga av X, men förmågan är
redan avstängd", *Hopade över* → Hoppade över, *Lägg till Q&A* → Lägg till fråga och svar,
*sen* → sedan, *Så funkar det* → Så fungerar det, *Fixa felen* → Åtgärda felen,
*output-format* → svarsformat throughout (UI + lint), clearer capability hint, an
identity lede instead of repeating "Identitet". A test asserts SV/EN tables have identical
keys and that the old typos are gone.

## Docs and delivery

- `docs/Guide-sv.md` — team guide: prerequisites (custom app upload policy), build each
  step, three upload paths (Teams Developer Portal, Teams "Ladda upp en app", Agents
  Toolkit), testing and versioning, sharing (zip, org catalog, project JSON), FAQ.
- `docs/pitch-sv.md` — replaces the outdated `sales-onepager.md` (which still mentioned a
  plugin "stub"): one-liner, problem, buyers, value calculation, price list
  (Team 9 900 kr/år, Organisation 39 000 kr/år, workshop 24 000 kr, mallpaket,
  partner/white-label), objection handling, 5-minute demo.
- `examples/kundtjanstagent-copilot-agent.zip` regenerated (`npm run example`, stable ids)
  and covered by a test that imports and schema-validates it.
- `agent-studio.zip` (`npm run release`): `dist/agent-studio.html`, README, docs, examples.

## Tests added (14)

ajv-formats silences warnings · uri format enforced · vendored bundle exports both ·
one card → instructions + SKILL.md · skillMd off · GUID ids → slug folders + dedupe ·
legacy agentSkills merge · compile/parse round-trip for all templates · raw import keeps
text + cards · SV/EN key parity · Swedish typo guard · import keeps icons/initials/accent ·
"Du är en …" role · example zip validates. Plus updated round-trip tests (structured
import) and a rewritten Playwright E2E (16 screenshots).

## Remaining weaknesses

- Not tested against a real tenant: upload, Copilot rendering of SKILL.md and the Jira
  plugin calls are unverified from this environment.
- Template instructions/skills are English while starters are Swedish; a Swedish-language
  template set would help Swedish-only teams.
- Preview pane is a sketch (no live chat); Adaptive Cards are JSON, not a designer.
- One API plugin per agent; the Jira sample still needs `{yourDomain}` and a real
  reference id (both flagged in the checklist).
- Drafts live in one browser's localStorage; sharing relies on JSON/zip files.
- Licensing is honour-based: a single HTML file cannot enforce seats.
- `dist/agent-studio.html` is ~1 MB (Ajv + schemas + JSZip + js-yaml inlined).
