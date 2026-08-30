// Post-build step: reads the live graph/data doc from Firestore and emits
// one static, JS-free HTML page per node (person/practice/school/award)
// into dist/{kind}/{id}/index.html, plus dist/sitemap.xml. The React app
// is a single client-rendered route ("/"), so without this there is
// nothing for a crawler to index and nothing for other pages to link to
// -- these pages exist purely so the dataset has real, crawlable URLs.
// Not linked from the app's own nav; discoverable via sitemap.xml and
// robots.txt, and each page links back to "/" for the interactive view.
//
// Needs Firestore Admin credentials, same as seed-firestore.mjs:
// - Locally: scripts/serviceAccountKey.json (gitignored)
// - In CI: the FIREBASE_SERVICE_ACCOUNT_JSON env var (repo secret)
// If neither is present, this script warns and exits 0 rather than
// failing the build -- `npm run build` must still work for contributors
// who don't have Firestore access.

import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { NODE_KIND, EDGE_KIND, RELATIONSHIP_ORDER, HOUSE } from "../src/data/taxonomy.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "..", "dist");
const SITE = "https://architectureaffinities.com";

const KIND_SEGMENT = { person: "person", practice: "practice", school: "school", award: "award" };
const JSONLD_TYPE = { person: "Person", practice: "Organization", school: "EducationalOrganization", award: "Thing" };

function loadCredentials() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }
  const keyPath = join(__dirname, "serviceAccountKey.json");
  if (existsSync(keyPath)) return JSON.parse(readFileSync(keyPath, "utf8"));
  return null;
}

const serviceAccount = loadCredentials();
if (!serviceAccount) {
  console.warn(
    "generate-seo-pages: no Firestore credentials (scripts/serviceAccountKey.json or " +
      "FIREBASE_SERVICE_ACCOUNT_JSON) -- skipping static page generation."
  );
  process.exit(0);
}

if (!existsSync(distDir)) {
  console.error(`generate-seo-pages: ${distDir} does not exist -- run \`vite build\` first.`);
  process.exit(1);
}

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();
const snap = await db.doc("graph/data").get();
if (!snap.exists) {
  console.error("generate-seo-pages: graph/data doc does not exist.");
  process.exit(1);
}
const { nodes, edges, updatedAt } = snap.data();
const lastmod = updatedAt?.toDate ? updatedAt.toDate().toISOString() : undefined;

const nodeById = new Map(nodes.map((n) => [n.id, n]));

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function endpointId(e) {
  return typeof e === "string" ? e : e.id;
}

// Mirrors buildRelationshipGroups in src/pages/NetworkPage.jsx so the
// static page reads the same as the interactive detail panel.
function buildRelationshipGroups(node) {
  const groups = new Map();
  for (const l of edges) {
    if (l.source !== node.id && l.target !== node.id) continue;
    const otherId = l.source === node.id ? l.target : l.source;
    const other = nodeById.get(otherId);
    if (!other) continue;
    const outgoing = l.source === node.id;
    const spec = EDGE_KIND[l.kind];
    if (!spec) continue;
    const label = outgoing ? spec.labelOut : spec.labelIn;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(other);
  }
  const ordered = [];
  for (const label of RELATIONSHIP_ORDER) {
    if (groups.has(label)) ordered.push([label, groups.get(label)]);
  }
  for (const [label, items] of groups) {
    if (!RELATIONSHIP_ORDER.includes(label)) ordered.push([label, items]);
  }
  for (const [, items] of ordered) items.sort((a, b) => a.n.localeCompare(b.n));
  return ordered;
}

function pageUrl(node) {
  return `${SITE}/${KIND_SEGMENT[node.k]}/${node.id}/`;
}

function buildDescription(node, kindLabel) {
  let desc = node.t || `${kindLabel} in the American Architecture Network, a graph of American architectural lineage.`;
  if (desc.length > 160) desc = desc.slice(0, 157).trimEnd() + "...";
  return desc;
}

function renderPage(node) {
  const kindLabel = NODE_KIND[node.k]?.label ?? "Entry";
  const description = buildDescription(node, kindLabel);
  const url = pageUrl(node);
  const groups = buildRelationshipGroups(node);
  const houseLabels = (node.h || []).map((code) => HOUSE[code]).filter(Boolean);
  const tags = [...houseLabels, ...(node.a || [])];

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": JSONLD_TYPE[node.k] ?? "Thing",
    name: node.n,
    description,
    url,
  };

  const sections = groups
    .map(
      ([label, items]) => `
    <section>
      <h2>${esc(label)}</h2>
      <ul>
        ${items.map((o) => `<li><a href="${SITE}/${KIND_SEGMENT[o.k]}/${o.id}/">${esc(o.n)}</a></li>`).join("\n        ")}
      </ul>
    </section>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(node.n)} — American Architecture Network</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${url}" />
<meta property="og:type" content="profile" />
<meta property="og:title" content="${esc(node.n)} — American Architecture Network" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${url}" />
<meta name="twitter:card" content="summary" />
<meta name="twitter:title" content="${esc(node.n)} — American Architecture Network" />
<meta name="twitter:description" content="${esc(description)}" />
<link rel="icon" type="image/svg+xml" href="${SITE}/favicon.svg" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>
  :root { color-scheme: light; }
  body { font-family: "Inter", system-ui, sans-serif; max-width: 640px; margin: 0 auto; padding: 48px 24px 96px; color: #111; background: #fff; line-height: 1.5; }
  a { color: #111; }
  a:hover { color: #555; }
  .kind { text-transform: uppercase; letter-spacing: 0.06em; font-size: 12px; color: #888; }
  h1 { font-size: 28px; font-weight: 600; margin: 4px 0 0; }
  .meta { color: #555; margin: 4px 0 0; }
  .note { margin-top: 16px; }
  .tags { color: #888; font-size: 14px; margin-top: 8px; }
  section { margin-top: 32px; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.04em; color: #888; font-weight: 500; margin-bottom: 8px; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { padding: 4px 0; border-bottom: 1px solid #eee; }
  .home-link { display: inline-block; margin-bottom: 32px; font-size: 14px; }
  .network-link { display: inline-block; margin-top: 48px; font-size: 14px; }
</style>
</head>
<body>
  <a class="home-link" href="${SITE}/">← American Architecture Network</a>
  <p class="kind">${esc(kindLabel)}</p>
  <h1>${esc(node.n)}</h1>
  ${node.l ? `<p class="meta">${esc(node.l)}</p>` : ""}
  ${node.t ? `<p class="note">${esc(node.t)}</p>` : ""}
  ${node.post ? `<p class="note">${esc(node.post)}</p>` : ""}
  ${tags.length ? `<p class="tags">${tags.map(esc).join(" · ")}</p>` : ""}
  ${sections}
  <a class="network-link" href="${SITE}/">View in the interactive network →</a>
</body>
</html>
`;
}

let written = 0;
const sitemapEntries = [`  <url><loc>${SITE}/</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`];

for (const node of nodes) {
  const segment = KIND_SEGMENT[node.k];
  if (!segment) continue;
  const dir = join(distDir, segment, node.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), renderPage(node));
  sitemapEntries.push(`  <url><loc>${pageUrl(node)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`);
  written++;
}

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapEntries.join("\n")}
</urlset>
`;
writeFileSync(join(distDir, "sitemap.xml"), sitemap);

console.log(`generate-seo-pages: wrote ${written} entity pages + sitemap.xml (${nodes.length - written} nodes skipped, unknown kind).`);
process.exit(0);
