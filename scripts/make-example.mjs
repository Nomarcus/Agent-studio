#!/usr/bin/env node
/** Regenerates examples/kundtjanstagent-copilot-agent.zip from the Customer Service template. */
import JSZip from "jszip";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createFromTemplate } from "../src/templates.js";
import { buildZip } from "../src/package.js";
import { generateIcons } from "../src/icons.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const p = createFromTemplate("customer-service");
// Stable ids so the example does not churn on every run.
p.id = "6a1f0c52-7d3e-4b8a-9c21-5e0f4d2b7a10";
p.app.id = "0f8e2d61-3c4b-4a59-8e7d-1b2c3d4e5f60";
const { bytes, files } = await buildZip(p, generateIcons(p), JSZip);
mkdirSync(join(root, "examples"), { recursive: true });
writeFileSync(join(root, "examples/kundtjanstagent-copilot-agent.zip"), bytes);
console.log("examples/kundtjanstagent-copilot-agent.zip:", Object.keys(files).join(", "));
