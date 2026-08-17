// Merges a verified { nodes, edges } addition (see scripts/additions/*.json
// for the expected shape and the provenance-notes convention) into the
// live graph/data document -- unlike seed-firestore.mjs, this never
// overwrites the existing dataset, it only adds to it. Existing node ids
// are never overwritten (skipped with a warning instead, since a
// collision usually means the addition should reuse the existing node,
// not shadow it) and duplicate {source,target,kind} edges are skipped
// silently.
//
// Usage: node scripts/append-graph.mjs scripts/additions/<file>.json

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const __dirname = dirname(fileURLToPath(import.meta.url));
const keyPath = join(__dirname, "serviceAccountKey.json");

const additionPath = process.argv[2];
if (!additionPath) {
  console.error("Usage: node scripts/append-graph.mjs <path-to-addition.json>");
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(readFileSync(keyPath, "utf8"));
} catch {
  console.error(`Missing ${keyPath}. Download it from Firebase Console -> Project Settings -> Service Accounts -> Generate new private key.`);
  process.exit(1);
}

const addition = JSON.parse(readFileSync(resolve(additionPath), "utf8"));

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();
const ref = db.doc("graph/data");

const snap = await ref.get();
if (!snap.exists) {
  console.error("graph/data doesn't exist yet -- run seed-firestore.mjs first.");
  process.exit(1);
}

const current = snap.data();
const existingIds = new Set(current.nodes.map((n) => n.id));
const existingEdgeKeys = new Set(current.edges.map((e) => `${e.source}|${e.target}|${e.kind}`));

const newNodes = [];
for (const node of addition.nodes || []) {
  if (existingIds.has(node.id)) {
    console.warn(`Skipping node "${node.id}" -- id already exists.`);
    continue;
  }
  newNodes.push(node);
  existingIds.add(node.id);
}

const newEdges = [];
for (const edge of addition.edges || []) {
  const key = `${edge.source}|${edge.target}|${edge.kind}`;
  if (existingEdgeKeys.has(key)) {
    console.warn(`Skipping edge ${key} -- already exists.`);
    continue;
  }
  if (!existingIds.has(edge.source) || !existingIds.has(edge.target)) {
    console.warn(`Skipping edge ${key} -- endpoint node doesn't exist.`);
    continue;
  }
  newEdges.push(edge);
  existingEdgeKeys.add(key);
}

await ref.update({
  nodes: [...current.nodes, ...newNodes],
  edges: [...current.edges, ...newEdges],
  updatedAt: FieldValue.serverTimestamp(),
});

console.log(`Added ${newNodes.length} node(s), ${newEdges.length} edge(s) from ${additionPath}.`);
process.exit(0);
