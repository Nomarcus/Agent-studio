#!/usr/bin/env node
/** Builds agent-studio.zip for a buyer: the single-file app, README, docs and examples. */
import JSZip from "jszip";
import { readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const zip = new JSZip();
const folder = zip.folder("agent-studio");
const add = (rel) => folder.file(rel, readFileSync(join(root, rel)));
add("dist/agent-studio.html");
add("README.md");
for (const dir of ["docs", "examples"]) {
  for (const name of readdirSync(join(root, dir))) {
    if (statSync(join(root, dir, name)).isFile()) add(`${dir}/${name}`);
  }
}
const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 9 } });
writeFileSync(join(root, "agent-studio.zip"), bytes);
console.log(`agent-studio.zip (${(bytes.length / 1024).toFixed(0)} KB):`, Object.keys(zip.files).filter((n) => !zip.files[n].dir).join(", "));
