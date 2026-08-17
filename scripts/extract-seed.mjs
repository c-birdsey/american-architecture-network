// One-time migration: pulls the hardcoded NODES/EDGES arrays out of the
// original static HTML page (scripts/source/american-architecture-network.original.html)
// and writes them to scripts/seed.json, in the shape the app expects at
// graph/data in Firestore. Run once with `npm run extract-seed`, inspect
// the output, then upload it with `npm run seed-firestore`.
//
// The source file's NODES/EDGES literals happen to already be valid JSON
// (double-quoted, no trailing commas or JS-only syntax) -- confirmed by
// hand before writing this -- so this is a straight extract + JSON.parse,
// not a JS-eval.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(__dirname, "source", "american-architecture-network.original.html");
const outPath = join(__dirname, "seed.json");

const html = readFileSync(sourcePath, "utf8");

function extractArrayLiteral(varName) {
  const marker = `const ${varName}=`;
  const start = html.indexOf(marker);
  if (start === -1) throw new Error(`Couldn't find "${marker}" in source file`);
  const arrayStart = start + marker.length;
  const arrayEnd = html.indexOf("];", arrayStart) + 1;
  return html.slice(arrayStart, arrayEnd);
}

const nodes = JSON.parse(extractArrayLiteral("NODES"));
const edges = JSON.parse(extractArrayLiteral("EDGES"));

console.log(`Extracted ${nodes.length} nodes, ${edges.length} edges.`);

writeFileSync(outPath, JSON.stringify({ nodes, edges }, null, 2));
console.log(`Wrote ${outPath}`);
