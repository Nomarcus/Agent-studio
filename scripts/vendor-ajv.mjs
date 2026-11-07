#!/usr/bin/env node
/**
 * Re-vendors Ajv + ajv-formats into ONE browser ESM bundle (vendor/ajv.esm.js).
 * They must share a single copy of Ajv's codegen, so they are bundled together.
 *   default export: Ajv class
 *   named export:   addFormats
 */
import * as esbuild from "esbuild";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
await esbuild.build({
  stdin: {
    contents: `import Ajv from "ajv"; import addFormats from "ajv-formats"; export default Ajv; export { addFormats };`,
    resolveDir: root,
    loader: "js",
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2020"],
  outfile: join(root, "vendor/ajv.esm.js"),
  legalComments: "inline",
  logLevel: "info",
});
