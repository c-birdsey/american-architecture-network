// Turns the raw { nodes, edges } fetched from Firestore (see useGraph.js)
// into the { nodes, links } shape NetworkPage.jsx feeds to d3-force. Unlike
// the archive app's version of this file, nodes here are never synthesized
// from shared attribute values -- every node is already a real entity
// (person/practice/award/school) stored directly in the dataset, so this
// is mostly a passthrough plus degree tallying.

export function buildNetworkGraph({ nodes: rawNodes, edges: rawEdges }) {
  const byId = new Map();
  const nodes = rawNodes.map((n) => {
    const node = { ...n, degree: 0 };
    byId.set(node.id, node);
    return node;
  });

  // Edges are stored as {source, target, kind} objects, not [source,
  // target, kind] tuples -- Firestore rejects arrays-of-arrays. A
  // hand-edited edge could still point at a since-deleted node, so drop
  // those rather than letting d3-force throw on an unresolvable link id.
  const links = rawEdges
    .filter((e) => byId.has(e.source) && byId.has(e.target))
    .map((e) => ({ ...e }));

  for (const link of links) {
    byId.get(link.source).degree += 1;
    byId.get(link.target).degree += 1;
  }

  return { nodes, links };
}
