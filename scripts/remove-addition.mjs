// Reverses a previously-applied addition (see append-graph.mjs) -- removes
// exactly the node ids and {source,target,kind} edges listed in the given
// addition file from graph/data. Doesn't touch anything append-graph.mjs
// itself skipped (e.g. because it already existed), since this never
// added that in the first place.
//
// Usage: node scripts/remove-addition.mjs scripts/additions/<file>.json

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const __dirname = dirname(fileURLToPath(import.meta.url));
const keyPath = join(__dirname, "serviceAccountKey.json");

const additionPath = process.argv[2];
if (!additionPath) {
  console.error("Usage: node scripts/remove-addition.mjs <path-to-addition.json>");
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(readFileSync(keyPath, "utf8"));
} catch {
  console.error(`Missing ${keyPath}.`);
  process.exit(1);
}

const addition = JSON.parse(readFileSync(resolve(additionPath), "utf8"));

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();
const ref = db.doc("graph/data");

const snap = await ref.get();
if (!snap.exists) {
  console.error("graph/data doesn't exist.");
  process.exit(1);
}

const current = snap.data();
const removeNodeIds = new Set((addition.nodes || []).map((n) => n.id));
const removeEdgeKeys = new Set((addition.edges || []).map((e) => `${e.source}|${e.target}|${e.kind}`));

const nodes = current.nodes.filter((n) => !removeNodeIds.has(n.id));
const edges = current.edges.filter((e) => !removeEdgeKeys.has(`${e.source}|${e.target}|${e.kind}`));

const removedNodes = current.nodes.length - nodes.length;
const removedEdges = current.edges.length - edges.length;

await ref.update({ nodes, edges, updatedAt: FieldValue.serverTimestamp() });

console.log(`Removed ${removedNodes} node(s), ${removedEdges} edge(s) from ${additionPath}.`);
process.exit(0);
