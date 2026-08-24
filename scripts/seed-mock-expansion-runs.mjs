// Populates expansionRuns with a handful of fake runs covering every
// stage (pending/running/awaiting_review/confirmed/rejected/failed) so
// the Database Expansion tab's UI can be previewed before the real Cloud
// Function is deployed (see README's "9. Database Expansion" for the
// deploy steps this stands in for). Every doc is tagged { mock: true }
// and titled with a "[MOCK]" prefix so it's unmistakable and easy to
// clear out later with `npm run clear-mock-expansion-runs`.
//
// Usage: node scripts/seed-mock-expansion-runs.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

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

const ADMIN_EMAIL = "calder.birdsey@gmail.com";
const now = Date.now();
const minutesAgo = (n) => Timestamp.fromDate(new Date(now - n * 60_000));
const daysAgo = (n) => Timestamp.fromDate(new Date(now - n * 86_400_000));

const runs = [
  {
    title: "[MOCK] SOM alumni missing from the graph",
    prompt: "Search for former SOM (Skidmore, Owings & Merrill) principals or notable alumni from the 1980s-2000s who aren't yet in the graph, and add them with an office edge to the SOM practice node.",
    status: "pending",
    createdBy: ADMIN_EMAIL,
    createdAt: minutesAgo(8),
    startedAt: null,
    completedAt: null,
    result: null,
    error: null,
    reviewedBy: null,
    reviewedAt: null,
    rejectReason: null,
  },
  {
    title: "[MOCK] Texas Rangers cohort verification",
    prompt: "Verify the full membership of the 'Texas Rangers' teaching cohort at UT Austin in the 1950s-60s and add anyone missing, with faculty/trained edges to the relevant school node.",
    status: "running",
    createdBy: ADMIN_EMAIL,
    createdAt: minutesAgo(25),
    startedAt: minutesAgo(20),
    completedAt: null,
    result: null,
    error: null,
    reviewedBy: null,
    reviewedAt: null,
    rejectReason: null,
  },
  {
    title: "[MOCK] Emerging Voices honorees, early cohort",
    prompt: "Find Architectural League 'Emerging Voices' honorees from 1990-1995 missing from the graph.",
    status: "awaiting_review",
    createdBy: ADMIN_EMAIL,
    createdAt: daysAgo(1),
    startedAt: daysAgo(1),
    completedAt: minutesAgo(50),
    result: {
      nodes: [
        {
          id: "mock-moussavi",
          n: "Farshid Moussavi",
          k: "person",
          l: "1965–",
          t: "British-Iranian architect known for expressive material research; founder of Farshid Moussavi Architecture.",
          h: [],
          a: [],
          now: 1,
          post: "Professor of Architecture, Harvard GSD",
        },
        {
          id: "mock-tsien",
          n: "Billie Tsien",
          k: "person",
          l: "1949–",
          t: "American architect, co-founder of Tod Williams Billie Tsien Architects, known for material-sensitive cultural buildings.",
          h: [],
          a: [],
          now: 1,
          post: "Principal, Tod Williams Billie Tsien Architects",
        },
        {
          id: "mock-twbt",
          n: "Tod Williams Billie Tsien Architects",
          k: "practice",
          l: "",
          t: "New York practice known for the American Folk Art Museum and the Obama Presidential Center.",
          h: [],
          a: [],
          now: 0,
          post: "",
        },
      ],
      edges: [
        { source: "mock-tsien", target: "mock-twbt", kind: "principal" },
      ],
      provenance:
        "MOCK DATA -- placeholder for previewing the Database Expansion UI, not a real research result. Do not Incorporate into production. (A real run's provenance note reads like this one, describing sources, methodology, and any inclusions/exclusions/uncertainties.)",
    },
    error: null,
    reviewedBy: null,
    reviewedAt: null,
    rejectReason: null,
  },
  {
    title: "[MOCK] Bauhaus at Harvard cohort gaps",
    prompt: "Find students who studied under Walter Gropius at Harvard GSD in the late 1930s-40s who are missing from the graph.",
    status: "confirmed",
    createdBy: ADMIN_EMAIL,
    createdAt: daysAgo(4),
    startedAt: daysAgo(4),
    completedAt: daysAgo(4),
    result: {
      nodes: [
        {
          id: "mock-jacobsen",
          n: "Hugh Jacobsen",
          k: "person",
          l: "1929–2021",
          t: "American residential architect known for crisp, formal modernist houses.",
          h: [],
          a: [],
          now: 0,
          post: "",
        },
      ],
      edges: [],
      provenance: "MOCK DATA -- placeholder for previewing an already-reviewed, incorporated run.",
    },
    error: null,
    reviewedBy: ADMIN_EMAIL,
    reviewedAt: daysAgo(3),
    rejectReason: null,
  },
  {
    title: "[MOCK] Unverified regional firm roster",
    prompt: "Add every architect listed on the 'About' page of [a regional firm's website] to the graph.",
    status: "rejected",
    createdBy: ADMIN_EMAIL,
    createdAt: daysAgo(6),
    startedAt: daysAgo(6),
    completedAt: daysAgo(6),
    result: {
      nodes: [
        {
          id: "mock-unverified-1",
          n: "J. Alvarez",
          k: "person",
          l: "",
          t: "Listed on a firm's About page with no independently verifiable biography.",
          h: [],
          a: [],
          now: 1,
          post: "Associate",
        },
      ],
      edges: [],
      provenance: "MOCK DATA -- single-source, self-published bios with no independent verification.",
    },
    error: null,
    reviewedBy: ADMIN_EMAIL,
    reviewedAt: daysAgo(5),
    rejectReason: "Sourced entirely from a single firm's own website with no independent verification -- didn't meet the bar for names/dates.",
  },
  {
    title: "[MOCK] Pre-1900 Beaux-Arts honorary list",
    prompt: "Find every honorary (non-practicing) AIA Gold Medal recipient from before 1900.",
    status: "failed",
    createdBy: ADMIN_EMAIL,
    createdAt: daysAgo(2),
    startedAt: daysAgo(2),
    completedAt: daysAgo(2),
    result: null,
    error: "No ```json block found in the model's response.",
    reviewedBy: null,
    reviewedAt: null,
    rejectReason: null,
  },
];

const col = db.collection("expansionRuns");
for (const run of runs) {
  const ref = await col.add({ ...run, mock: true });
  console.log(`Added ${run.status.padEnd(16)} ${ref.id}  ${run.title}`);
}

console.log(`\nDone -- ${runs.length} mock run(s) added. Run \`npm run clear-mock-expansion-runs\` to remove them later.`);
process.exit(0);
