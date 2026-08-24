# American Architecture Network

A public, read-only force-directed graph of American architectural
lineage — who trained whom, who employed whom, who partnered with whom,
who taught where, who was recognised by which prizes. React (Vite)
frontend, Firebase (Auth + Firestore) backend, deployed to GitHub Pages
at `amerarchnet.calderbirdsey.com`.

This is a sibling project to the private `digital-archive/archive-app`
repo -- same visual language (Inter, white ground, no cards/shadows/
color-coding) and the same canvas + `d3-force`/`d3-zoom` rendering
engine, adapted for a different dataset and a different access model.
It's a fully separate app, repo, and Firebase project; nothing is shared.

## Access model

Unlike the archive, **there is no login wall for visitors.** Anyone can
browse, search, and click through the network at `/`. The only gated
route is `/admin` (Google sign-in, restricted to `ADMIN_EMAILS` in
`src/firebase-config.js`), which has three tabs: Manual Addition (add one
node/edge at a time), Manage Data (search/filter/sort/delete existing
nodes and edges), and Database Expansion (kick off an AI research run
from a prompt, then review/approve/reject its proposed additions) --
see "9. Database Expansion" below for how that last one is wired up.

## Data model

Everything lives in a single Firestore document, `graph/data`:

```
{
  nodes: [{ id, n (name), k (person|practice|award|school), l (life dates),
             t (note), h (house/cohort codes), a (award strings),
             now (0|1), post (current position) }, ...],
  edges: [{ source (id), target (id), kind }, ...],
  updatedAt
}
```

One document (not one-doc-per-node) because the whole dataset is well
under Firestore's 1MiB document limit -- this keeps a page load to one
read instead of ~2,600, and keeps admin writes a simple whole-array
read-modify-write rather than juggling per-doc consistency.

`kind` is one of: `office`, `studio`, `partner`, `hire`, `faculty`,
`seat`, `principal`, `honor` — see `src/data/taxonomy.js` for what each
means and how it's labeled in the UI. Node kinds, edge kinds, and house
codes are fixed taxonomy baked into the app code (`src/data/taxonomy.js`),
not stored in Firestore -- extend that file (and redeploy) if a new kind
or house is needed.

Database Expansion runs (see "9. Database Expansion" below) live
separately, one doc per run, in `expansionRuns/{id}`:

```
{
  prompt, status (pending|running|awaiting_review|confirmed|rejected|failed),
  createdBy, createdAt, startedAt, completedAt,
  result: { nodes, edges, provenance } | null,
  error, reviewedBy, reviewedAt,
}
```

## 1. Create the Firebase project

[console.firebase.google.com](https://console.firebase.google.com) →
**Add project**. This must be a **new, separate project** — do not reuse
the private archive's Firebase project. Analytics is optional, skip it.

## 2. Enable Authentication

**Build → Authentication → Get started → Sign-in method → Google →
Enable.** Only used for `/admin` — public visitors never see this.

## 3. Enable Firestore

**Build → Firestore Database → Create database.** Production mode, any
nearby region. No Storage needed — this app has no image uploads.

## 4. Security rules

The rules live in `firestore.rules` at the repo root (not pasted inline
here, so there's one source of truth instead of two copies drifting
apart) -- `graph/data` is public read / admin-only write, and
`expansionRuns/*` (Database Expansion's run docs) is admin-only read,
create, and update. Push it either by pasting the file's contents into
**Firestore Database → Rules** in the console, or:

```
firebase deploy --only firestore:rules
```

Keep `isAdmin()`'s email list in sync with `ADMIN_EMAILS` in
`src/firebase-config.js` — the rules are what actually enforce it, the
constant is just for the app's own messaging.

## 5. Get the web app config

**Project settings → General → Your apps → Add app → Web.** Paste the
resulting config object into `src/firebase-config.js` (replacing the
`REPLACE_ME` placeholders).

## 6. Seed the dataset

The original dataset lives as a static HTML page at
`scripts/source/american-architecture-network.original.html` (kept for
provenance). To load it into Firestore:

1. `npm run extract-seed` — parses that file into `scripts/seed.json`.
2. Firebase Console → Project Settings → Service Accounts → **Generate
   new private key** → save as `scripts/serviceAccountKey.json`
   (gitignored, never commit it).
3. `npm run seed-firestore` — uploads `scripts/seed.json` to `graph/data`
   in one write.

Re-run steps 1 and 3 any time the source file changes; step 3 fully
overwrites `graph/data`, so any admin-added nodes/edges since the last
seed would be lost — treat this as a one-time bootstrap, not a
recurring sync, once the admin dashboard is the real source of new data.

## 7. Domain

`amerarchnet.calderbirdsey.com` is a Cloudflare CNAME record (**DNS-only
/ grey cloud**, not proxied) pointing at `c-birdsey.github.io`, same
pattern as the archive's `archive.calderbirdsey.com`. `public/CNAME`
holds the domain name; GitHub Pages settings needs it added as the
repo's custom domain too.

Deliberately structured to move to a bought domain later without a code
change: the domain only appears in `public/CNAME` and the Cloudflare DNS
record. Swapping it is a one-line file edit plus a DNS change, nothing in
the app itself references the domain.

## 8. Deploy

GitHub Actions (`.github/workflows/deploy.yml`) auto-builds and deploys
the frontend to GitHub Pages on every push to `main`. No manual deploy
step for the site itself -- but that workflow doesn't touch Cloud
Functions or Firestore rules, so 9 below is a manual `firebase deploy`.

## 9. Database Expansion (agentic research) — optional

The admin dashboard's Database Expansion tab: type a prompt (e.g. "find
AIA Gold Medal laureates from the 1950s missing from the graph"), submit
it, and walk away. That write is a Cloud Function's trigger
(`functions/index.js`) -- it runs Claude with the hosted `web_search`
tool against the prompt, using the same node/edge shape as
`scripts/additions/*.json`, and writes an `{ nodes, edges, provenance }`
result back onto the run doc once done. Reviewing a finished run in the
UI: Approve merges it into `graph/data` with the same dedupe rules as
`scripts/append-graph.mjs` (an id that already exists is never
overwritten, duplicate edges and edges with a missing endpoint are
skipped); Reject just marks it rejected and leaves `graph/data`
untouched. This whole section is opt-in -- skip it if you don't want an
agent (and its API cost) running against your project; the other two
admin tabs work fine without it.

Two things beyond the base setup above:

**Upgrade to the Blaze (pay-as-you-go) plan.** Cloud Functions don't run
on Firebase's free Spark plan. Firebase Console → gear icon → **Usage and
billing → Details & settings → Modify plan**.

**An Anthropic API key**, from
[console.anthropic.com](https://console.anthropic.com). Store it as a
Cloud Functions secret -- never put it in `firebase-config.js`, that
file is public client config and this key is the opposite of that:

```
firebase functions:secrets:set ANTHROPIC_API_KEY
```

Then deploy the function and the Firestore rules together (the rules
file already covers `expansionRuns`, see "4. Security rules" above):

```
firebase deploy --only functions,firestore:rules
```

Each run is real Anthropic API usage -- the function caps it at 20 web
searches per run, but keep an eye on cost at
[console.anthropic.com](https://console.anthropic.com). A Firestore-
triggered Cloud Function also has a hard 9-minute execution ceiling
(Google's limit, not tunable), so scope each prompt to one focused topic
rather than expecting a single run to cover a whole broad request --
split it into a few narrower prompts instead.
