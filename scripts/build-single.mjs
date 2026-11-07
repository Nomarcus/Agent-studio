#!/usr/bin/env node
/**
 * Builds dist/agent-studio.html — a single offline file that works from file://
 * (no ES module imports; CSS + JS inlined).
 */
import * as esbuild from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
mkdirSync(dist, { recursive: true });

const result = await esbuild.build({
  entryPoints: [join(root, "app.js")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  write: false,
  logLevel: "warning",
});

const js = result.outputFiles[0].text;
const css = readFileSync(join(root, "styles.css"), "utf8");
const icon = "%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%231F4E79'/%3E%3Cpath d='M8 10h16v2H8zm0 5h16v2H8zm0 5h10v2H8z' fill='%23E8B86D'/%3E%3C/svg%3E";

const html = `<!DOCTYPE html>
<html lang="sv">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark light" />
    <title>Agent Studio</title>
    <meta
      name="description"
      content="Designa, validera och exportera deklarativa agenter för Microsoft 365 Copilot — helt i webbläsaren."
    />
    <link rel="icon" href="data:image/svg+xml,${icon}" />
    <style>
${css}
    </style>
  </head>
  <body>
    <div id="app">
      <div class="boot">Öppnar Agent Studio…</div>
    </div>
    <div id="print-root"></div>
    <input id="file-zip" type="file" accept=".zip,application/zip" hidden aria-hidden="true" tabindex="-1" />
    <input id="file-json" type="file" accept=".json,application/json" hidden aria-hidden="true" tabindex="-1" />
    <input id="file-embedded" type="file" accept=".doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.pdf,application/pdf,text/plain" multiple hidden aria-hidden="true" tabindex="-1" />
    <input id="file-openapi" type="file" accept=".yaml,.yml,.json,text/yaml,application/json,application/x-yaml" hidden aria-hidden="true" tabindex="-1" />
    <script>
${js}
    </script>
  </body>
</html>
`;

const out = join(dist, "agent-studio.html");
writeFileSync(out, html);
console.log(`Wrote ${out} (${(html.length / 1024).toFixed(1)} KB)`);
