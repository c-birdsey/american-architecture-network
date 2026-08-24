// Removes every expansionRuns doc tagged { mock: true } by
// seed-mock-expansion-runs.mjs. Real runs (created from the admin UI)
// never carry that flag, so this can't touch them.
//
// Usage: node scripts/clear-mock-expansion-runs.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = dirname(fileURLToPath(import.meta.url));
const keyPath = join(__dirname, "serviceAccountKey.json");

let serviceAccount;
try {
  serviceAccount = JSON.parse(readFileSync(keyPath, "utf8"));
} catch {
  console.error(`Missing ${keyPath}. Download it from Firebase Console -> Project Settings -> Service Accounts -> Generate new private key.`);
  process.exit(1);
}

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const snap = await db.collection("expansionRuns").where("mock", "==", true).get();
if (snap.empty) {
  console.log("No mock runs found.");
  process.exit(0);
}

const batch = db.batch();
snap.docs.forEach((d) => batch.delete(d.ref));
await batch.commit();

console.log(`Deleted ${snap.size} mock run(s).`);
process.exit(0);
