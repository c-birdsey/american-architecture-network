// Backs the admin dashboard's Database Expansion tab (see
// src/pages/AdminPage.jsx and README.md's "Database Expansion" section).
// An admin types a prompt in the browser, which writes a Firestore doc to
// expansionRuns/{runId} with status "pending". That write is this
// function's trigger: it runs Claude with the hosted web_search tool
// against the prompt, asks for additions in the same { nodes, edges }
// shape as scripts/additions/*.json, and writes the result back onto the
// same doc for an admin to review/approve/reject in the UI. Nothing here
// touches graph/data directly -- Approve is a client-side write, same
// dedupe logic as scripts/append-graph.mjs, so a bad or hallucinated run
// can never reach the live graph without a human looking at it first.

import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import Anthropic from "@anthropic-ai/sdk";

initializeApp();
const db = getFirestore();

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 16000;
const MAX_SEARCHES = 20;
const MAX_CONTINUATIONS = 6; // guards against an infinite pause_turn loop
const MAX_EXISTING_NODES_LISTED = 6000; // headroom over the ~2,600-node current dataset

// Mirrors src/data/taxonomy.js -- this function runs outside the Vite
// build so it can't import that file directly. Keep these two in sync by
// hand if the taxonomy changes.
const NODE_KINDS = "person, practice, award (labeled \"Prize / Cohort\" in the UI), school";
const EDGE_KINDS = [
  "office (employed)", "studio (taught/studied under)", "partner (business partners)",
  "hire (recruited)", "faculty (taught at a school)", "seat (led/chaired an institution)",
  "principal (principal of a practice)", "honor (recognised by a prize/cohort)",
  "trained (attended/graduated from a school, as a student)",
].join(", ");
const HOUSES = [
  "BA Beaux-Arts", "CHI Chicago School", "PRA Wright & the Prairie", "BAU Bauhaus at Harvard",
  "IIT Mies & IIT", "SOM SOM", "PEN Kahn & Penn", "YAL Yale", "TEX Texas Rangers & Cornell",
  "COO Cooper Union", "NY5 New York Five & the IAUS", "CAL California Modern", "LA SCI-Arc & Los Angeles",
  "PRI Princeton", "COL Columbia", "GSD Harvard GSD", "MIT MIT", "DIG Digital & Research Practice",
  "CHIc Chicago, Later", "EV Emerging Voices", "MCHAP Mies Crown Hall Americas Prize",
  "STATE State AIA Firm Awards", "SCHOOL School", "HONOR National Honour",
].join(", ");

function buildSystemPrompt(existingNodesText) {
  return `You are a research agent extending a public, factual graph of American architectural lineage -- who trained whom, who employed whom, who partnered with whom, who taught where, who was recognised by which prizes.

Use the web_search tool to research the user's request. Verify facts (names, dates, relationships) across at least two independent sources where possible. Be conservative: only include people/practices/schools/awards and relationships you're confident are accurate. It's fine to return an empty result if the request doesn't turn up verifiable additions.

## Node kinds
${NODE_KINDS}

## Edge kinds (source -> target, meaning of the relationship)
${EDGE_KINDS}

## House/cohort codes (optional, node field "h")
${HOUSES}

## Node shape
{ "id": "kebab-case-slug", "n": "Full Name", "k": "person|practice|award|school", "l": "life dates e.g. 1900–1975, or 1950– if living, empty string if not a person or unknown", "t": "one or two sentence descriptive note", "h": ["house codes, usually []"], "a": [], "now": 0 or 1 (person only, else 0), "post": "current position, person only, else empty string" }

## Edge shape
{ "source": "node id", "target": "node id", "kind": "one of the edge kinds above" }

## Existing nodes already in the graph (id|name|kind) -- do not recreate any of these; if your research subject is already here, add edges pointing at its existing id instead of a new node. Every edge's source and target must be either one of these existing ids or the id of a node you're adding in this same batch.
${existingNodesText}

## Output
Keep your narrative reasoning brief -- once you've gathered enough verified information (or established there's nothing verifiable to add), move straight to the final answer rather than writing an extended essay first.

You MUST end your response with exactly one fenced json code block containing a single JSON object: {"nodes": [...], "edges": [...], "provenance": "..."}, even if nodes and edges are both empty arrays. Never end a response without this block. The provenance string should explain your sources, methodology, and any notable inclusions/exclusions/uncertainties, in the style of a researcher's changelog note -- not marketing copy. Output nothing (empty arrays) rather than guess. Do not include nodes or edges anywhere outside that final json block.`;
}

function extractResultJson(text) {
  const matches = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  if (matches.length === 0) throw new Error("No ```json block found in the model's response.");
  const raw = matches[matches.length - 1][1];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
    throw new Error("Parsed json block is missing a nodes[] or edges[] array.");
  }
  return {
    nodes: parsed.nodes,
    edges: parsed.edges,
    provenance: typeof parsed.provenance === "string" ? parsed.provenance : "",
  };
}

function collectText(content) {
  return content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

// 540s (9 minutes) is the hard ceiling for a Firestore-triggered 2nd-gen
// function -- unlike an HTTP/callable function, it can't go to 60 minutes.
// That's the real budget a research prompt gets: plenty for one focused
// topic (a handful of web searches plus writing up the result, roughly
// what a manual research pass over one award list takes), but broad
// prompts should be split into a few narrower runs rather than one that
// tries to cover everything.
export const runExpansion = onDocumentCreated(
  { document: "expansionRuns/{runId}", secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 540, memory: "1GiB" },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const runRef = snap.ref;
    const { prompt } = snap.data();

    if (!prompt || typeof prompt !== "string") {
      await runRef.update({ status: "failed", error: "Missing prompt.", completedAt: FieldValue.serverTimestamp() });
      return;
    }

    await runRef.update({ status: "running", startedAt: FieldValue.serverTimestamp() });

    try {
      const graphSnap = await db.doc("graph/data").get();
      const existingNodes = graphSnap.exists ? graphSnap.data().nodes || [] : [];
      const existingNodesText = existingNodes
        .slice(0, MAX_EXISTING_NODES_LISTED)
        .map((n) => `${n.id}|${n.n}|${n.k}`)
        .join("\n");

      const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
      const tools = [{ type: "web_search_20250305", name: "web_search", max_uses: MAX_SEARCHES }];
      const system = buildSystemPrompt(existingNodesText);
      const messages = [{ role: "user", content: prompt }];

      let response = await anthropic.messages.create({ model: MODEL, max_tokens: MAX_TOKENS, system, tools, messages });

      // web_search is a server tool -- Anthropic executes it and Claude
      // keeps generating within the same call. A long research task can
      // still come back with stop_reason "pause_turn" asking to be
      // resumed rather than "end_turn" -- loop those forward instead of
      // treating an unfinished run as done.
      let rounds = 0;
      while (response.stop_reason === "pause_turn" && rounds < MAX_CONTINUATIONS) {
        messages.push({ role: "assistant", content: response.content });
        response = await anthropic.messages.create({ model: MODEL, max_tokens: MAX_TOKENS, system, tools, messages });
        rounds++;
      }

      const fullText = collectText(response.content);

      // Parsed separately from the API call itself so a malformed/missing
      // json block still leaves the model's actual text on the run doc --
      // otherwise a parse failure is undebuggable (this bit an early test
      // run: it just failed with no way to see what the model actually
      // said).
      let result;
      try {
        result = extractResultJson(fullText);
      } catch (parseErr) {
        logger.error("Expansion run: couldn't parse model output", parseErr);
        await runRef.update({
          status: "failed",
          error: parseErr.message,
          rawResponse: fullText.slice(0, 20000),
          completedAt: FieldValue.serverTimestamp(),
        });
        return;
      }

      await runRef.update({
        status: "awaiting_review",
        result,
        rawResponse: fullText.slice(0, 20000),
        completedAt: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      logger.error("Expansion run failed", err);
      await runRef.update({
        status: "failed",
        error: err.message || String(err),
        completedAt: FieldValue.serverTimestamp(),
      });
    }
  }
);
