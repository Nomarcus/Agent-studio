import { slugify, isGuid } from "./util.js";

function yamlEscape(s) {
  const t = String(s).replace(/"/g, '\\"');
  if (/[:#\n&*!%>@`'"{}\[\],]|^\s|\s$/.test(t)) return `"${t}"`;
  return t;
}

export function defaultSkillExample(skill) {
  const name = skill?.name || "this skill";
  const output = (skill?.output || "## Summary\n## Answer\n## Open questions").trim();
  return `User: Please use the "${name}" skill on the material I pasted.

Assistant:
I will follow the output format and only use facts from the material. Inferences are marked "(inferred)".

${output}`;
}

export function agentSkillFromCookbook(skill, example) {
  const id = skill.id || slugify(skill.name);
  return {
    folder: `skills/${id}`,
    name: skill.name || id,
    description: clipDesc(skill.when || `Use the ${skill.name || id} skill.`),
    when: skill.when || "",
    how: skill.how || "",
    output: skill.output || "",
    example: example || defaultSkillExample(skill),
    body: "",
  };
}

function clipDesc(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length <= 220 ? t : `${t.slice(0, 217).trim()}...`;
}

/**
 * Legacy helper (round 3): kept for callers that still want a standalone list.
 * Since round 4 the cookbook skill IS the SKILL.md source; see deriveAgentSkills().
 */
export function attachAgentSkills(project, examples = {}) {
  for (const s of project.skills || []) {
    const ex = examples[s.id] || examples[s.name];
    if (ex && !(s.example || "").trim()) s.example = ex;
  }
  return project;
}

/** Default SKILL.md folder for a cookbook skill: skills/<slug>. */
export function skillFolderFor(skill) {
  const explicit = String(skill?.folder || "").trim().replace(/^\.\//, "").replace(/^\/+/, "").replace(/\\/g, "/");
  if (explicit) return explicit;
  const id = String(skill?.id || "");
  const slug = id && !isGuid(id) && /^[a-z0-9-]+$/.test(id) ? id : slugify(skill?.name || "skill");
  return `skills/${slug || "skill"}`;
}

/** Normalise one cookbook skill (the single source for instructions + SKILL.md). */
export function normalizeSkill(s) {
  return {
    id: s?.id || slugify(s?.name || "skill"),
    name: s?.name || "",
    when: s?.when || "",
    how: s?.how || "",
    output: s?.output || "",
    example: s?.example || "",
    folder: s?.folder || "",
    description: s?.description || "",
    notes: s?.notes || "",
    skillMd: s?.skillMd !== false,
  };
}

/**
 * SKILL.md folders that go into the package, derived from the cookbook skills.
 * Any legacy project.agentSkills entries that do not match a skill are appended.
 */
export function deriveAgentSkills(project) {
  const out = [];
  const used = new Set();
  const uniq = (folder) => {
    let f = folder;
    let n = 2;
    while (used.has(f)) f = `${folder}-${n++}`;
    used.add(f);
    return f;
  };
  for (const raw of project?.skills || []) {
    const s = normalizeSkill(raw);
    if (!s.name.trim() || !s.skillMd) continue;
    out.push({
      folder: uniq(skillFolderFor(s)),
      name: s.name.trim(),
      description: clipDesc(s.description || s.when || `Use the ${s.name} skill.`),
      when: s.when,
      how: s.how,
      output: s.output,
      example: (s.example || "").trim() ? s.example : defaultSkillExample(s),
      body: s.notes,
    });
  }
  for (const legacy of project?.agentSkills || []) {
    const folder = String(legacy?.folder || "").trim().replace(/^\.\//, "");
    if (!folder || used.has(folder)) continue;
    if (out.some((o) => o.name === legacy.name)) continue;
    used.add(folder);
    out.push({ ...legacy, folder });
  }
  return out;
}

/**
 * Fold legacy agentSkills (separate SKILL.md editor, rounds 2–3, and zip imports)
 * into the cookbook skills so the UI has ONE card per skill.
 */
export function mergeAgentSkillsIntoSkills(project) {
  const skills = (project.skills || []).map(normalizeSkill);
  for (const a of project.agentSkills || []) {
    const folder = String(a?.folder || "").trim().replace(/^\.\//, "");
    const match = skills.find(
      (s) => (a.name && s.name.trim().toLowerCase() === String(a.name).trim().toLowerCase()) || (folder && skillFolderFor(s) === folder)
    );
    if (match) {
      if (!match.when.trim() && a.when) match.when = a.when;
      if (!match.how.trim() && a.how) match.how = a.how;
      if (!match.output.trim() && a.output) match.output = a.output;
      if (!match.example.trim() && a.example) match.example = a.example;
      if (!match.description.trim() && a.description) match.description = a.description;
      if (!match.notes.trim() && a.body) match.notes = a.body;
      if (folder && folder !== skillFolderFor({ ...match, folder: "" })) match.folder = folder;
      match.skillMd = true;
    } else if (folder || a?.name) {
      skills.push(
        normalizeSkill({
          id: slugify(a.name || folder.split("/").pop()),
          name: a.name || folder.split("/").pop(),
          when: a.when || a.description || "",
          how: a.how || "",
          output: a.output || "",
          example: a.example || "",
          folder,
          description: a.description || "",
          notes: a.body || "",
          skillMd: true,
        })
      );
    }
  }
  project.skills = skills;
  project.agentSkills = [];
  return project;
}

const SKILLS_INTRO =
  "Each skill is a recipe. Pick the skill (or combination of skills) that matches the user's request. Follow the steps in order. Use the stated output format. If information is missing, ask one concise clarifying question instead of guessing.";

/**
 * Reverse of compileInstructions() for text that Agent Studio itself generated.
 * Returns null when the text does not look like our structure.
 */
export function parseCompiledInstructions(text) {
  const src = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!src) return null;
  const skillsAt = src.search(/^# Skills\n/m);
  const guardAt = src.search(/^# Guardrails\n/m);
  if (skillsAt === -1 && guardAt === -1) return null;
  const headEnd = skillsAt !== -1 ? skillsAt : guardAt;
  const head = src.slice(0, headEnd).trim();
  const chunks = head ? head.split(/\n\n/) : [];
  let role = (chunks.shift() || "").trim();
  if (role.startsWith("You are ")) role = role.slice("You are ".length);
  const style = chunks.join("\n\n").trim();
  let skillsText = "";
  if (skillsAt !== -1) skillsText = src.slice(skillsAt + "# Skills\n".length, guardAt > skillsAt ? guardAt : undefined).trim();
  const guardrails = guardAt !== -1 ? src.slice(guardAt + "# Guardrails\n".length).trim() : "";
  const skills = [];
  const blocks = skillsText.split(/^## Skill: /m).slice(1);
  for (const block of blocks) {
    const nl = block.indexOf("\n");
    const name = (nl === -1 ? block : block.slice(0, nl)).trim();
    const rest = nl === -1 ? "" : block.slice(nl + 1);
    const grab = (re) => {
      const m = rest.match(re);
      return m ? m[1].trim() : "";
    };
    skills.push(
      normalizeSkill({
        id: slugify(name),
        name,
        when: grab(/^When to use: ([\s\S]*?)(?=\nHow to do it:\n|\nOutput format:\n|$)/),
        how: grab(/(?:^|\n)How to do it:\n([\s\S]*?)(?=\nOutput format:\n|$)/),
        output: grab(/(?:^|\n)Output format:\n([\s\S]*)$/),
      })
    );
  }
  return { role, style, skills, guardrails };
}

export { SKILLS_INTRO };

export function compileSkillMarkdown(skill) {
  const title = (skill.name || skill.folder?.split("/").pop() || "Skill").trim();
  const desc = clipDesc(skill.description || skill.when || "Agent skill generated by Agent Studio.");
  const structured = [(skill.when || "").trim(), (skill.how || "").trim(), (skill.output || "").trim(), (skill.example || "").trim()].some(Boolean);
  const parts = [`# ${title}`, ""];
  if ((skill.when || "").trim()) {
    parts.push("## When to use", "", skill.when.trim(), "");
  }
  if ((skill.how || "").trim()) {
    parts.push("## Steps", "", skill.how.trim(), "");
  }
  if ((skill.output || "").trim()) {
    parts.push("## Output format", "", skill.output.trim(), "");
  }
  if ((skill.example || "").trim()) {
    parts.push("## Example", "", skill.example.trim(), "");
  }
  if ((skill.body || "").trim()) {
    if (structured) parts.push("## Additional notes", "", skill.body.trim(), "");
    else parts.push(skill.body.trim(), "");
  }
  if (parts.length === 2) {
    parts.push("Describe how the agent should use this skill.", "");
  }
  const md = `${parts.join("\n").trim()}\n`;
  return `---\nname: ${yamlEscape(title)}\ndescription: ${yamlEscape(desc)}\n---\n\n${md}`;
}

export function parseSkillMarkdown(folder, raw) {
  const empty = {
    folder,
    name: (folder || "").split("/").pop() || "",
    description: "",
    when: "",
    how: "",
    output: "",
    example: "",
    body: "",
  };
  if (!raw || !String(raw).trim()) return empty;
  let body = String(raw).replace(/^\uFEFF/, "");
  let name = empty.name;
  let description = "";
  if (body.startsWith("---")) {
    const end = body.indexOf("\n---", 3);
    if (end !== -1) {
      const fm = body.slice(3, end).trim();
      body = body.slice(end + 4).replace(/^\n/, "");
      const nameMatch = fm.match(/^name:\s*(.*)$/m);
      const descMatch = fm.match(/^description:\s*(.*)$/m);
      if (nameMatch) name = unquote(nameMatch[1]);
      if (descMatch) description = unquote(descMatch[1]);
    }
  }
  const sections = { when: "", how: "", output: "", example: "", notes: "" };
  const re = /^##\s+(When to use|Steps|Output format|Example|Additional notes)\s*$/gim;
  const hits = [];
  let m;
  while ((m = re.exec(body))) {
    hits.push({ key: m[1].toLowerCase(), index: m.index, end: m.index + m[0].length });
  }
  if (!hits.length) {
    empty.name = name;
    empty.description = description;
    empty.body = body.trim();
    return empty;
  }
  const map = {
    "when to use": "when",
    steps: "how",
    "output format": "output",
    example: "example",
    "additional notes": "notes",
  };
  for (let i = 0; i < hits.length; i++) {
    const start = hits[i].end;
    const stop = i + 1 < hits.length ? hits[i + 1].index : body.length;
    const key = map[hits[i].key];
    if (key) sections[key] = body.slice(start, stop).trim();
  }
  return {
    folder,
    name,
    description,
    when: sections.when,
    how: sections.how,
    output: sections.output,
    example: sections.example,
    body: sections.notes,
  };
}

function unquote(value) {
  const t = String(value || "").trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1).replace(/\\"/g, '"');
  }
  return t;
}
