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
`src/firebase-config.js`), used for manual node/edge additions and
corrections. The plan is to eventually run a periodic AI-agent research
pass from that dashboard that proposes additions from a predefined set of
architecture sources (awards, publications) -- not built yet, v1 admin is
manual CRUD only.

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

**Firestore rules** (Firestore Database → Rules):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isAdmin() {
      return request.auth != null &&
        request.auth.token.email in [
          "admin1@example.com",
          "admin2@example.com"
        ];
    }

    match /graph/{docId} {
      allow read: if true;
      allow write: if isAdmin();
    }
  }
}
```

Public read, admin-only write. Keep the email list in sync with
`ADMIN_EMAILS` in `src/firebase-config.js` — the rules are what actually
enforce it, the constant is just for the app's own messaging.

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
to GitHub Pages on every push to `main`. No manual deploy step.
