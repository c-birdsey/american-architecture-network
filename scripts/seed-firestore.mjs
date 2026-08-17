// Uploads scripts/seed.json (produced by extract-seed.mjs) to the
// graph/data document in Firestore, as one atomic write. Requires a
// service account key -- Firebase Console -> Project Settings -> Service
// Accounts -> Generate new private key -- saved as
// scripts/serviceAccountKey.json (gitignored, never commit it).
//
// Run once, after the Firebase project/Firestore/rules exist (see
// README.md) and before the app is expected to show real data.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const __dirname = dirname(fileURLToPath(import.meta.url));
const keyPath = join(__dirname, "serviceAccountKey.json");
const seedPath = join(__dirname, "seed.json");

let serviceAccount;
try {
  serviceAccount = JSON.parse(readFileSync(keyPath, "utf8"));
} catch {
  console.error(`Missing ${keyPath}. Download it from Firebase Console -> Project Settings -> Service Accounts -> Generate new private key.`);
  process.exit(1);
}

const { nodes, edges } = JSON.parse(readFileSync(seedPath, "utf8"));

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

await db.doc("graph/data").set({
  nodes,
  edges,
  updatedAt: FieldValue.serverTimestamp(),
});

console.log(`Seeded graph/data with ${nodes.length} nodes and ${edges.length} edges.`);
process.exit(0);
