# Agent Studio — Review Round 5

Independent pass after round 4. I read REVIEW-ROUND4, PROGRESS and the source,
then drove `dist/agent-studio.html` from **file://** and the dev build over
**http://** with Playwright + system Chrome, including a full axe-core audit
(`vendor/axe.min.js`, WCAG 2.0/2.1 A and AA).

Tests before: **41/41**. Tests after: **47/47** unit tests + Playwright E2E
(file:// + http://) with no console errors and **no axe violations**.

---

## What was fixed

### 1. The Prompts buttons were not fully clickable
Conversation starter chips in the Copilot preview (`Suggested prompts` /
`Föreslagna frågor`) were `<button disabled>`. They looked like prompts but
ate clicks: a disabled button does not fire `click`, so the hit appeared to
work only sometimes (the event fell through). The English step pill was also
labelled the vague word “Starters”.

**Fixed.** The chips are real buttons. Clicking one fills the compose box with
the prompt and marks the chip as active. The whole stepper pill is the hit
target (`pointer-events: none` on the number badge, `min-height: 36px`). The
English step is now **Prompts**. Test prompts in the side panel are clickable
too and copy to the clipboard.

### 2. Markdown preview for skill fields
`when`, `how`, `output` and `example` are written as markdown (headings,
numbered steps) but could only be edited as raw text.

**Fixed.** Each of those fields has an Edit / Preview toggle. Preview is
rendered by a small offline helper (`src/markdown.js`) that escapes HTML
first, then turns headings, lists, `**bold**` and `` `code` `` into safe
markup. Switching back to Edit keeps the textarea.

### 3. English UI now matches Swedish quality
Round 4 polished Swedish carefully and left English shorter and more jargon-y
(`Starters`, `Add Q&A`, `Test prompts`, `Eight ready cookbooks`, “Discourage
general model knowledge”).

**Fixed.** Parallel wording: Prompts, “Add a prompt”, “What the user says”,
“Try these prompts”, “Add a question and answer”, “Stick to the sources you
configured…”, “{n} ready cookbooks…”. SV/EN key parity is still asserted by
a test.

### 4. Six new high-value templates
Each has four real skills that compile to both instruction sections and
`SKILL.md`, plus starters and test prompts. All fourteen templates stay
inside the 8 000-character instruction limit and validate against DA v1.9,
Teams 1.29 and plugin v2.4.

| Template | Skills |
| --- | --- |
| Offertskrivaren / Proposal writer | Scope the request, Draft the proposal structure, Write the commercial text, List assumptions and exclusions |
| Onboarding-kompisen / Onboarding buddy | Plan the first weeks, Explain how we work, Find the right person or doc, Answer a newcomer question |
| Versionsantecknaren / Release notes writer | Collect the changes, Write user-facing notes, Write technical notes, Draft the announcement |
| Testfallsskrivaren / Test case generator | Extract testable requirements, Write happy-path cases, Write negative and boundary cases, Build a coverage matrix |
| Mappningsspecen / Mapping spec writer | Inventory the source, Propose the mapping table, Document transforms and codes, List open questions and risks |
| Rotorsaksanalytikern / Root cause analysis (5 whys) | State the problem, Walk the five whys, Challenge a weak link, Write the RCA summary |

### 5. Team library
Drafts lived in one browser. A team lead had to send zip or JSON files one by
one. The existing “back up all drafts” file could not even be re-imported
(`importProjectJson` rejected the backup type).

**Fixed.** A library file
`{ type: "agent-studio-library", version: 1, name, exportedAt, agents: [...] }`
exports every current draft. Import upserts by id (new agents are added,
matching ids are updated) and also accepts the older backup format and a
single project file. Buttons live on the welcome page, in the footer and on
the Package step.

### 6. Accessibility audit with vendored axe-core
Playwright injects `vendor/axe.min.js` (axe v4.14, no CDN) on the welcome,
identity, skills and English views.

**Fixed violations:**
- `label-content-name-mismatch` on language, theme and backup buttons
  (`aria-label` now includes the visible text).
- `label` on the accent colour `<input type="color">` (now has `aria-label`).
- Unnamed “×” remove buttons, unlabeled hidden file inputs, conflicting
  `listbox`/`option` roles on the zip file browser, two unnamed `aside`
  landmarks, and the decorative hero title that used `color: transparent`
  (failed contrast).

The audit finishes clean on file://.

### 7. Welcome mock card showed a hard-coded Kundtjänstagent
**Fixed.** The mock uses the last opened draft (`lastAgentId`, persisted in
settings). If none is stored it falls back to the most recently updated draft,
then to the Customer Service template. Name, description, chips, skill count,
icon and zip filename all follow that agent.

---

## Tests added (6)

catalog has 14 templates · each new template has the expected skills, SKILL.md
files and a schema-valid package · markdown preview escapes HTML and renders
lists · team library export + merge (add vs update) · parseStudioJson accepts
library, backup and single project · English step label is “Prompts”.

E2E also clicks a prompt chip, opens a markdown preview, clicks the Prompts
step via its number badge, exports and imports a team library, and checks that
the welcome mock shows Kundtjänstagent after you leave that draft.

---

## Remaining weaknesses

- Not tested against a real Microsoft 365 tenant: upload, Copilot rendering of
  SKILL.md and Jira plugin calls are still unverified from this environment.
- Template instruction text is English while conversation starters are Swedish.
  A Swedish-only template set would still help Swedish-only teams.
- The preview pane is a sketch. Starters now fill the compose box, but there
  is no live Copilot chat and Adaptive Cards are still JSON, not a designer.
- One API plugin per agent; the Jira sample still needs `{yourDomain}` and a
  real vault reference id.
- The team library is a file you send yourself — there is no shared cloud
  catalog (intentional for an offline product).
- Licensing is honour-based: a single HTML file cannot enforce seats.
- `dist/agent-studio.html` is ~1.05 MB (Ajv + schemas + JSZip + js-yaml).
  axe-core is vendored for tests only and is not inlined into the app.
