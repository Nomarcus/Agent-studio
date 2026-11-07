import { LIMITS, hasNonWhitespace } from "./util.js";
import { compileInstructions } from "./model.js";

const ROLE_RE = /\b(you are|you're|du är|du ar|act as|your role)\b/i;
const OUTPUT_RE = /\b(output format|format your|respond with|structure|markdown|rubrik|skriv som|return a|deliver)\b/i;
const GUARD_RE = /\b(do not|don't|never|avoid|must not|guardrail|inte gissa|hitta inte på|do not invent|don't invent|never invent)\b/i;
const SKILL_RE = /\b(skill:|## skill|when to use|recipe)\b/i;
const VAGUE_ONLY = /^(be helpful|var hjälpsam|help the user|du är en assistent\.?|you are an assistant\.?)$/i;

export function lintInstructions(project) {
  const text = compileInstructions(project);
  const issues = [];
  const suggestions = [];
  const length = text.length;

  if (!hasNonWhitespace(text)) {
    issues.push(issue("error", "EMPTY", "Instruktionerna är tomma.", "Instructions are empty.", "Skriv vem agenten är och minst en skill med när, steg och svarsformat.", "Write who the agent is and at least one skill with when, how and an output format."));
    return { issues, suggestions, length, score: 0 };
  }

  if (length > LIMITS.DA_INSTRUCTIONS) {
    issues.push(issue("error", "OVER_LIMIT", `Instruktionerna överskrider ${LIMITS.DA_INSTRUCTIONS} tecken (${length}).`, `Instructions exceed ${LIMITS.DA_INSTRUCTIONS} characters (${length}).`, "Korta ner varje skill. Ta bort upprepningar.", "Shorten each skill. Remove repetition."));
  } else if (length > LIMITS.DA_INSTRUCTIONS - 400) {
    issues.push(issue("warn", "NEAR_LIMIT", `Ni är nära gränsen: ${length} / ${LIMITS.DA_INSTRUCTIONS} tecken.`, `You are close to the limit: ${length} / ${LIMITS.DA_INSTRUCTIONS} characters.`, "Spara lite marginal så ni kan justera senare.", "Leave a little room so you can adjust later."));
  }

  const hasRoleField = hasNonWhitespace(project.role) || ROLE_RE.test(text);
  if (!hasRoleField) {
    issues.push(issue("error", "MISSING_ROLE", "Rollen (vem agenten är) saknas.", "The role (who the agent is) is missing.", "Börja med: en … för integrationsteamet (eller på engelska: a … for …).", "Start with: You are a … for an integration support team."));
  }

  const skills = (project.skills || []).filter((s) => (s?.name || "").trim());
  const hasSkills = skills.length > 0 || SKILL_RE.test(text);
  if (!hasSkills) {
    issues.push(issue("warn", "NO_SKILLS", "Det finns inga skills (recept) ännu.", "No skills/recipes are defined.", "Lägg till skills som Analysera ärende, Hitta dokumentation, Skriv kundsvar.", "Add skills such as Analyze ticket, Find documentation, Write reply."));
  }

  const missingOutput = skills.filter((s) => !(s.output || "").trim());
  if (missingOutput.length) {
    issues.push(issue("warn", "MISSING_OUTPUT", `${missingOutput.length} skill(s) saknar svarsformat: ${missingOutput.map((s) => s.name).join(", ")}.`, `${missingOutput.length} skill(s) are missing an output format: ${missingOutput.map((s) => s.name).join(", ")}.`, "Säg hur svaret ska se ut: rubriker, tabell, checklista, mejl.", "Say how the answer should look: headings, table, checklist, email."));
  } else if (!OUTPUT_RE.test(text) && skills.length === 0) {
    issues.push(issue("warn", "MISSING_OUTPUT", "Instruktionerna säger inte hur svaret ska formateras.", "The instructions do not say how the answer should be formatted.", "Lägg till ett svarsformat per skill.", "Add an output format per skill."));
  }

  if (length < 220 || VAGUE_ONLY.test(text.trim())) {
    issues.push(issue("warn", "TOO_VAGUE", "Instruktionerna är för korta eller för vaga för att styra Copilot.", "The instructions are too short or too vague to steer Copilot.", "Beskriv när varje skill används, vilka steg som ska följas och vad som inte får gissas.", "Describe when each skill is used, which steps to follow, and what must not be guessed."));
  }

  if (!GUARD_RE.test(text) && !hasNonWhitespace(project.guardrails)) {
    issues.push(issue("warn", "NO_GUARDRAILS", "Inga tydliga gränser (vad agenten inte får göra).", "No clear boundaries (what the agent must not do).", "Lägg till: gissa inte statuskoder, hitta inte på Jira-fält, märk osäkerhet.", "Add: do not invent status codes or Jira fields; mark uncertainty."));
  }

  const contradiction = findContradictions(text);
  if (contradiction) {
    issues.push(issue("warn", "CONTRADICTION", `Möjlig motsägelse: ${contradiction.sv}`, `Possible contradiction: ${contradiction.en}`, "Välj en regel och ta bort den andra.", "Pick one rule and remove the other."));
  }

  if (skills.length && skills.every((s) => (s.how || "").trim().length < 40)) {
    issues.push(issue("info", "THIN_SKILLS", "Flera skills har väldigt korta steg.", "Several skills have very short steps.", "Skriv 3–6 konkreta steg per skill.", "Write 3–6 concrete steps per skill."));
  }

  if (hasRoleField && hasSkills && !missingOutput.length && length >= 220 && length <= LIMITS.DA_INSTRUCTIONS) {
    suggestions.push({
      sv: "Bra stomme. Testa agenten med frågorna i testpanelen och justera det som blir vagt.",
      en: "Solid foundation. Test the agent with the prompts in the test panel and tighten anything vague.",
    });
  } else {
    suggestions.push({
      sv: "Tänk kokbok: agenten är kocken (vem), skills är recepten (hur). Varje recept behöver när, steg och servering (svarsformat).",
      en: "Think cookbook: the agent is the chef (who), skills are the recipes (how). Each recipe needs when, how and plating (output).",
    });
  }

  const score = scoreFromIssues(issues, { hasRoleField, hasSkills, length, hasGuards: GUARD_RE.test(text) || hasNonWhitespace(project.guardrails) });
  return { issues, suggestions, length, score };
}

function findContradictions(text) {
  const pairs = [
    { a: /\balways use web search\b/i, b: /\bnever use web search\b/i, sv: "alltid och aldrig använda webbsökning", en: "always and never use web search" },
    { a: /\balways answer in swedish\b/i, b: /\balways answer in english\b/i, sv: "alltid svenska och alltid engelska", en: "always Swedish and always English" },
    { a: /\balltid svara på svenska\b/i, b: /\balltid svara på engelska\b/i, sv: "alltid svenska och alltid engelska", en: "always Swedish and always English" },
    { a: /\bnever guess\b/i, b: /\balways guess\b/i, sv: "gissa aldrig / gissa alltid", en: "never guess / always guess" },
    { a: /\bdo not use (your )?model knowledge\b/i, b: /\buse (your )?general knowledge\b/i, sv: "använd inte modellkunskap / använd allmän kunskap", en: "don't use model knowledge / use general knowledge" },
  ];
  for (const p of pairs) {
    if (p.a.test(text) && p.b.test(text)) return p;
  }
  return null;
}

function issue(level, code, sv, en, fixSv, fixEn) {
  return { level, code, sv, en, fixSv, fixEn, message: sv };
}

function scoreFromIssues(issues, flags) {
  let score = 40;
  if (flags.hasRoleField) score += 20;
  if (flags.hasSkills) score += 20;
  if (flags.hasGuards) score += 10;
  if (flags.length >= 400 && flags.length <= 7000) score += 10;
  for (const i of issues) {
    if (i.level === "error") score -= 25;
    if (i.level === "warn") score -= 8;
  }
  return Math.max(0, Math.min(100, score));
}

export function suggestedTestPrompts(project, lang = "sv") {
  if (Array.isArray(project.testPrompts) && project.testPrompts.length) {
    return project.testPrompts.slice();
  }
  const en = lang === "en";
  const prompts = [];
  const skills = (project.skills || []).filter((s) => (s?.name || "").trim());
  for (const skill of skills) {
    prompts.push(en ? `Use the "${skill.name}" skill on this material: [paste an example].` : `Använd skillen "${skill.name}" på det här underlaget: [klistra in exempel].`);
  }
  if (en) {
    prompts.push("What can you help me with, and what can you not do?");
    prompts.push("The information is not enough. What do you need from me before you continue?");
    prompts.push("Answer in Swedish this time, with the same structure.");
  } else {
    prompts.push("Vad kan du hjälpa mig med, och vad kan du inte göra?");
    prompts.push("Informationen räcker inte. Vad behöver du av mig innan du går vidare?");
    prompts.push("Svara på engelska den här gången, med samma struktur.");
  }
  return prompts.slice(0, 10);
}
