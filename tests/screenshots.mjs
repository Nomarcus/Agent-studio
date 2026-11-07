/**
 * End-to-end check + screenshots with system Chrome (playwright-core).
 *  1. file:// dist/agent-studio.html  (what a buyer double-clicks) — full flow + shots
 *  2. http:// dev mode (index.html + ES modules)                  — smoke flow
 * Fails on page errors, console errors, Ajv "unknown format" warnings, or axe-core violations.
 */
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFileSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { extname, join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const shots = join(root, "shots");
const tmp = join(root, ".test-output");
mkdirSync(shots, { recursive: true });
mkdirSync(tmp, { recursive: true });

const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".yaml": "text/yaml" };
const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url || "/").split("?")[0]);
  let path = join(root, url === "/" ? "index.html" : url.replace(/^\//, ""));
  if (!path.startsWith(root)) { res.writeHead(403); res.end(); return; }
  try {
    if (statSync(path).isDirectory()) path = join(path, "index.html");
    res.writeHead(200, { "content-type": mime[extname(path)] || "application/octet-stream" });
    res.end(readFileSync(path));
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const httpBase = `http://127.0.0.1:${server.address().port}/`;
const fileUrl = pathToFileURL(join(root, "dist/agent-studio.html")).href;

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const problems = [];
const written = [];
function watch(page, label) {
  page.on("pageerror", (e) => problems.push(`[${label}] pageerror: ${e}`));
  page.on("console", (m) => {
    if (m.type() === "error" || /unknown format/i.test(m.text())) problems.push(`[${label}] console.${m.type()}: ${m.text()}`);
  });
  page.on("dialog", (d) => { problems.push(`[${label}] unexpected dialog: ${d.message()}`); d.dismiss(); });
}
const must = async (cond, msg) => { if (!(await cond)) throw new Error(msg); };
const shot = async (page, name, full = true) => { await page.evaluate(() => document.getElementById("toast")?.classList.remove("show")); await page.waitForTimeout(60); await page.screenshot({ path: join(shots, name), fullPage: full }); written.push(name); };
const axeSource = readFileSync(join(root, "vendor/axe.min.js"), "utf8");
async function audit(page, label) {
  const ready = await page.evaluate(() => typeof window.axe?.run === "function");
  if (!ready) await page.addScriptTag({ content: axeSource });
  const results = await page.evaluate(async () => axe.run({
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
  }));
  for (const v of results.violations) {
    const nodes = v.nodes.slice(0, 5).map((n) => n.target.join(" ")).join(" | ");
    problems.push(`[${label}] axe ${v.id} (${v.impact}): ${v.help} — ${nodes}`);
  }
}

async function fresh(page, url) {
  await page.goto(url, { waitUntil: "load" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector(".tpl-tile");
}

/* ── 1. file:// full flow ── */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
  const page = await ctx.newPage();
  watch(page, "file");
  await fresh(page, fileUrl);
  await must(page.locator("h2.display").isVisible(), "landing hero missing");
  await must(page.locator(".feature").count().then((n) => n === 4), "expected 4 feature cards");
  await must(page.locator(".tpl-tile").count().then((n) => n === 14), "expected 14 template tiles");
  await must(page.locator(".mock-card strong").innerText().then((t) => t.includes("Kundtjänstagent")), "default mock should show Customer Service Agent");
  await audit(page, "file-welcome");
  await shot(page, "01-welcome.png", false);
  await shot(page, "01b-welcome-full.png");

  await page.locator('.tpl-tile[data-id="customer-service"]').click();
  await page.waitForSelector('input[data-field="name"]');
  await must(page.locator('input[data-field="name"]').inputValue().then((v) => v === "Kundtjänstagent"), "unexpected template name");
  await must(page.locator("text=Förhandsgranskning — inte live").first().isVisible(), "preview badge missing");
  const chip = page.locator(".preview-chip").first();
  await must(chip.isEnabled(), "prompt chip should be fully clickable");
  const promptText = await chip.getAttribute("title");
  await chip.click();
  await must(page.locator(".preview-compose").innerText().then((t) => t === promptText), "compose box did not show the selected prompt");
  await audit(page, "file-identity");
  await shot(page, "02-identity.png");

  await page.locator('[data-action="goto-step"][data-step="1"]').click();
  await page.waitForSelector("details.skill-card");
  await must(page.locator("details.skill-card").count().then((n) => n === 4), "expected 4 skill cards");
  await must(page.locator("details.skill-card[open]").count().then((n) => n === 1), "exactly one card should be open");
  await must(page.locator(".chip.gold", { hasText: "SKILL.md" }).count().then((n) => n === 4), "each skill should show a SKILL.md chip");
  const height = await page.evaluate(() => document.querySelector("main").scrollHeight);
  if (height > 2600) throw new Error(`Skills step too long: ${height}px`);
  await page.locator('[data-action="md-mode"][data-path="skills.0.how"][data-mode="preview"]').click();
  await must(page.locator('[data-md-for="skills.0.how"]').isVisible(), "markdown preview did not open");
  await must(page.locator('[data-md-for="skills.0.how"] li').count().then((n) => n > 0), "markdown preview should render list items");
  await page.locator('[data-action="md-mode"][data-path="skills.0.how"][data-mode="edit"]').click();
  await audit(page, "file-skills");
  await shot(page, "03-skills.png");

  // Open the SKILL.md details on card 1 and check live preview follows edits.
  await page.locator("details.skill-card[open] details.sub > summary").first().click();
  await page.fill('input[data-field="skills.0.name"]', "Analysera Jira-ärende");
  await page.waitForTimeout(350);
  await must(page.locator('[data-skill-title="0"]').innerText().then((t) => t === "Analysera Jira-ärende"), "summary title did not update live");
  await must(page.locator('[data-skill-md="0"]').innerText().then((t) => /name: Analysera Jira-ärende/.test(t)), "SKILL.md preview did not update");
  await must(page.locator("#compiled-preview").textContent().then((t) => t.includes("## Skill: Analysera Jira-ärende")), "instructions did not update");
  await shot(page, "03b-skill-card.png", false);

  // Recipe library adds a skill from another template; remove + undo brings it back.
  await page.selectOption("select[data-library]", { label: "Classify the incident" });
  await page.waitForSelector('details.skill-card[data-skill-index="4"][open]');
  await page.locator('details.skill-card[data-skill-index="4"] [data-action="remove-skill"]').click();
  await must(page.locator("details.skill-card").count().then((n) => n === 4), "remove failed");
  await page.waitForTimeout(400);
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(200);
  await must(page.locator("details.skill-card").count().then((n) => n === 5), "undo did not restore removed skill");
  await page.locator('details.skill-card[data-skill-index="4"] > summary').click();
  await page.locator('details.skill-card[data-skill-index="4"] [data-action="remove-skill"]').click();
  await page.waitForTimeout(400);

  await page.locator('[data-action="goto-step"][data-step="2"]').click();
  await page.waitForSelector(".op-row strong >> text=searchIssues");
  await shot(page, "04-capabilities.png");
  await page.locator(".op-row").first().scrollIntoViewIfNeeded();
  await shot(page, "12-plugin.png", false);

  await page.locator('[data-action="goto-step"][data-step="3"] .n').click();
  await page.waitForSelector("text=Startfrågor (max 12)");
  await shot(page, "05-starters.png");

  await page.locator('[data-action="goto-step"][data-step="4"]').click();
  await page.waitForSelector(".file-browser");
  await must(page.locator('[data-action="export-zip"]').isEnabled(), "export disabled: " + (await page.locator("#aside").innerText()));
  await page.locator('.file-btn[data-file="skills/analyze-jira-ticket/SKILL.md"]').click();
  await must(page.locator("#json-preview").innerText().then((t) => /## Steps/.test(t)), "SKILL.md not previewable");
  await page.locator('.file-btn[data-file="declarativeAgent.json"]').click();
  await shot(page, "06-package.png");

  const [download] = await Promise.all([page.waitForEvent("download"), page.locator('[data-action="export-zip"]').click()]);
  if (!download.suggestedFilename().endsWith(".zip")) throw new Error("Expected a zip download");
  const zipPath = join(tmp, download.suggestedFilename());
  await download.saveAs(zipPath);
  await page.waitForSelector(".toast.show");

  // Re-import the exported zip: structured skills must come back.
  await page.locator('[data-action="go-home"]').click();
  await must(page.locator(".mock-card strong").innerText().then((t) => t.includes("Kundtjänstagent")), "welcome mock should show the last opened agent");
  const [libDownload] = await Promise.all([page.waitForEvent("download"), page.locator('[data-action="export-library"]').first().click()]);
  if (!libDownload.suggestedFilename().includes("agent-studio-library")) throw new Error("Expected a team library download");
  const libPath = join(tmp, libDownload.suggestedFilename());
  await libDownload.saveAs(libPath);
  await page.setInputFiles("#file-json", libPath);
  await page.waitForSelector(".toast.show");
  await page.setInputFiles("#file-zip", zipPath);
  await page.waitForSelector('input[data-field="name"]');
  await page.locator('[data-action="goto-step"][data-step="1"]').click();
  await must(page.locator("details.skill-card").count().then((n) => n === 4), "import did not restore 4 skill cards");
  await must(page.locator('textarea[data-field="role"]').count().then((n) => n === 1), "import fell back to raw text");
  await must(page.locator(".draft-card.active .tpl-ico").innerText().then((t) => t.trim() === "KU"), "imported draft lost its initials");

  // Broken file → friendly toast, no crash.
  writeFileSync(join(tmp, "broken.zip"), "not a zip");
  await page.setInputFiles("#file-zip", join(tmp, "broken.zip"));
  await page.waitForSelector(".toast.error.show");

  await page.locator('[data-action="toggle-lang"]').click();
  await page.waitForSelector("text=Recipes for Microsoft 365 Copilot agents");
  await must(page.locator('[data-action="goto-step"][data-step="3"]').innerText().then((t) => /Prompts/.test(t)), "English stepper should say Prompts");
  await audit(page, "file-english");
  await shot(page, "07-english.png");
  await page.locator('[data-action="toggle-theme"]').click();
  await page.waitForTimeout(150);
  await shot(page, "08-light.png");
  await page.locator('[data-action="go-home"]').click();
  await must(page.locator(".mock-card strong").innerText().then((t) => t.includes("Kundtjänstagent")), "light welcome mock should keep the last agent");
  await shot(page, "08b-light-welcome.png", false);
  await page.locator('[data-action="toggle-lang"]').click();
  await page.locator('[data-action="toggle-theme"]').click();

  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, "09-mobile-welcome.png");
  await page.locator(".continue .draft-card").first().click();
  await page.locator('[data-action="goto-step"][data-step="1"]').click();
  await shot(page, "09-mobile.png");

  // Quick start
  await page.setViewportSize({ width: 1440, height: 960 });
  await fresh(page, fileUrl);
  await page.locator('[data-action="quick-start"]').click();
  await page.waitForSelector("text=Tre fält");
  await page.fill('input[data-field="name"]', "Jira-hjälpen");
  await page.fill('input[data-field="app.websiteUrl"]', "https://contoso.se");
  await shot(page, "10-quickstart.png", false);
  await page.locator('[data-action="quick-finish"]').click();
  await page.waitForSelector(".export-hero");
  await shot(page, "11-quickstart-export.png", false);
  await ctx.close();
}

/* ── 2. http:// dev mode smoke ── */
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  watch(page, "http");
  await fresh(page, httpBase);
  await page.locator('.tpl-tile[data-id="xml-analyst"]').click();
  for (const step of [1, 2, 3, 4]) {
    await page.locator(`[data-action="goto-step"][data-step="${step}"]`).click();
    await page.waitForTimeout(120);
  }
  await page.waitForSelector(".export-hero.is-ok");
  await ctx.close();
}

writeFileSync(join(shots, "report.json"), JSON.stringify({ problems, shots: written }, null, 2));
await browser.close();
server.close();
if (problems.length) {
  console.error("Problems:\n" + problems.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`OK — ${written.length} screenshots, no console errors or warnings (file:// + http://)`);
}
