import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { signInWithPopup, signOut } from "firebase/auth";
import { auth, db, googleProvider } from "../firebase.js";
import { useAuth } from "../hooks/useAuth.js";
import { useGraph } from "../hooks/useGraph.js";
import { ADMIN_EMAILS } from "../firebase-config.js";
import { NODE_KIND, EDGE_KIND, HOUSE } from "../data/taxonomy.js";

function slugify(name) {
  return name
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uniqueId(base, existingIds) {
  if (!existingIds.has(base)) return base;
  let n = 2;
  while (existingIds.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

async function writeGraph(patch) {
  await updateDoc(doc(db, "graph", "data"), { ...patch, updatedAt: serverTimestamp() });
}

// Sign-in/allowlist check shared by AdminPanel and EditNodeOverlay -- both
// need the same three gate states (still checking, signed out, signed in
// but not on ADMIN_EMAILS) before rendering whatever admin content they're
// wrapping. `children` is a render prop so the wrapped content only mounts
// once a real admin user is available.
function AdminGate({ children }) {
  const user = useAuth();

  if (user === undefined) return <p className="admin-status">Loading…</p>;

  if (user === null) {
    return (
      <div className="admin-gate">
        <p>Admin access requires signing in with an approved Google account.</p>
        <button type="button" className="link-btn" onClick={() => signInWithPopup(auth, googleProvider)}>
          Sign In with Google
        </button>
      </div>
    );
  }

  if (!ADMIN_EMAILS.includes(user.email)) {
    return (
      <div className="admin-gate">
        <p>{user.email} isn't on the admin list for this app.</p>
        <button type="button" className="link-btn" onClick={() => signOut(auth)}>Sign Out</button>
      </div>
    );
  }

  return children(user);
}

// Same overlay chrome as NetworkPage's Info panel (background, padding,
// floating Close button) -- used both as a route (/admin, direct link/
// bookmark) and as an in-page overlay from the network's "Admin" button.
// The overlay path matters: swapping routes would unmount the network's
// canvas and force the ~30s force-simulation prewarm to run again on the
// way back, so the network button never navigates, it just shows this on
// top of the still-mounted, already-settled canvas.
export function AdminPanel({ onClose }) {
  const rawGraph = useGraph();

  return (
    <div className="overlay" onClick={(e) => { if (!e.target.closest("a, button, input, textarea, select")) onClose(); }}>
      <button type="button" className="overlay-close overlay-close-floating" onClick={onClose}>
        Close
      </button>

      <AdminGate>
        {(user) =>
          rawGraph === undefined ? (
            <p className="admin-status">Loading…</p>
          ) : rawGraph === null ? (
            <p className="admin-status">The network's data hasn't been seeded yet — run the migration script first (see README).</p>
          ) : (
            <AdminDashboard graph={rawGraph} user={user} />
          )
        }
      </AdminGate>
    </div>
  );
}

// Full-screen editor for a single node's attributes -- opened from the
// network detail panel's Edit button. Same overlay chrome and admin gate
// as AdminPanel, but scoped to one node instead of the whole dashboard, and
// exposes every field the schema has (see README's "Data model") rather
// than just the subset AdminDashboard's Add Node form takes.
export function EditNodeOverlay({ nodeId, onClose }) {
  const rawGraph = useGraph();

  return (
    <div className="overlay" onClick={(e) => { if (!e.target.closest("a, button, input, textarea, select")) onClose(); }}>
      <button type="button" className="overlay-close overlay-close-floating" onClick={onClose}>
        Close
      </button>

      <AdminGate>
        {() =>
          rawGraph === undefined ? (
            <p className="admin-status">Loading…</p>
          ) : rawGraph === null ? (
            <p className="admin-status">The network's data hasn't been seeded yet — run the migration script first (see README).</p>
          ) : (
            <EditNodeForm graph={rawGraph} nodeId={nodeId} onSaved={onClose} />
          )
        }
      </AdminGate>
    </div>
  );
}

function EditNodeForm({ graph, nodeId, onSaved }) {
  const node = graph.nodes.find((n) => n.id === nodeId);
  const [busy, setBusy] = useState(false);

  if (!node) return <p className="admin-status">This node no longer exists.</p>;

  async function handleSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const updated = {
      ...node,
      n: form.name.value.trim(),
      k: form.kind.value,
      l: form.life.value.trim(),
      t: form.note.value.trim(),
      post: form.post.value.trim(),
      now: form.now.checked ? 1 : 0,
      h: Array.from(form.houses.selectedOptions).map((o) => o.value),
      a: form.awards.value.split(",").map((s) => s.trim()).filter(Boolean),
    };
    setBusy(true);
    try {
      const nodes = graph.nodes.map((n) => (n.id === nodeId ? updated : n));
      await writeGraph({ nodes });
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-content">
      <div className="admin-topbar">
        <span className="overlay-heading">Edit — {node.id}</span>
      </div>
      <form onSubmit={handleSubmit} className="admin-form admin-form-edit">
        <label className="admin-label">
          Name
          <input name="name" defaultValue={node.n} required disabled={busy} />
        </label>
        <label className="admin-label">
          Kind
          <select name="kind" defaultValue={node.k} disabled={busy}>
            {Object.entries(NODE_KIND).map(([k, spec]) => (
              <option key={k} value={k}>{spec.label}</option>
            ))}
          </select>
        </label>
        <label className="admin-label">
          Life dates
          <input name="life" defaultValue={node.l || ""} placeholder="e.g. 1900–1975" disabled={busy} />
        </label>
        <label className="admin-label">
          Note
          <textarea name="note" defaultValue={node.t || ""} rows={3} disabled={busy} />
        </label>
        <label className="admin-label">
          Current position
          <input name="post" defaultValue={node.post || ""} disabled={busy} />
        </label>
        <label className="admin-label">
          Houses / cohorts
          <select name="houses" multiple defaultValue={node.h || []} disabled={busy} size={6}>
            {Object.entries(HOUSE).map(([code, label]) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>
        </label>
        <label className="admin-label">
          Awards (comma-separated)
          <input name="awards" defaultValue={(node.a || []).join(", ")} disabled={busy} />
        </label>
        <label className="admin-checkbox">
          <input type="checkbox" name="now" defaultChecked={!!node.now} disabled={busy} /> Active now
        </label>
        <button type="submit" className="link-btn" disabled={busy}>Save</button>
      </form>
    </div>
  );
}

// Route wrapper for direct navigation to /admin (bookmarks, typed URLs) --
// closing here has nowhere settled to return to, so it's a real navigation
// back to "/", same as any other link.
export default function AdminPage() {
  const navigate = useNavigate();
  return <AdminPanel onClose={() => navigate("/")} />;
}

function AdminDashboard({ graph, user }) {
  const [nodeQuery, setNodeQuery] = useState("");
  const [edgeQuery, setEdgeQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const existingIds = useMemo(() => new Set(graph.nodes.map((n) => n.id)), [graph.nodes]);

  const filteredEdges = useMemo(() => {
    const q = edgeQuery.trim().toLowerCase();
    if (!q) return graph.edges.slice(0, 60);
    return graph.edges.filter((e) => e.source.includes(q) || e.target.includes(q) || e.kind.includes(q)).slice(0, 60);
  }, [graph.edges, edgeQuery]);

  const filteredNodes = useMemo(() => {
    const q = nodeQuery.trim().toLowerCase();
    if (!q) return graph.nodes.slice(0, 60);
    return graph.nodes.filter((n) => n.n.toLowerCase().includes(q)).slice(0, 60);
  }, [graph.nodes, nodeQuery]);

  async function handleAddNode(e) {
    e.preventDefault();
    const form = e.target;
    const name = form.name.value.trim();
    if (!name) return;
    const id = uniqueId(slugify(name), existingIds);
    const node = {
      id,
      n: name,
      k: form.kind.value,
      l: form.life.value.trim(),
      t: form.note.value.trim(),
      h: [],
      a: [],
      now: form.now.checked ? 1 : 0,
      post: form.post.value.trim(),
    };
    setBusy(true);
    try {
      await writeGraph({ nodes: [...graph.nodes, node] });
      setMessage(`Added "${name}" (${id}).`);
      form.reset();
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteNode(id) {
    if (!confirm(`Delete "${id}" and every edge touching it? This can't be undone.`)) return;
    setBusy(true);
    try {
      const nodes = graph.nodes.filter((n) => n.id !== id);
      const edges = graph.edges.filter((e) => e.source !== id && e.target !== id);
      await writeGraph({ nodes, edges });
      setMessage(`Deleted "${id}".`);
    } finally {
      setBusy(false);
    }
  }

  async function handleAddEdge(e) {
    e.preventDefault();
    const form = e.target;
    const source = form.source.value.trim();
    const target = form.target.value.trim();
    const kind = form.kind.value;
    if (!existingIds.has(source) || !existingIds.has(target)) {
      setMessage(`Both node ids must already exist. "${source}" or "${target}" not found.`);
      return;
    }
    setBusy(true);
    try {
      await writeGraph({ edges: [...graph.edges, { source, target, kind }] });
      setMessage(`Added edge ${source} → ${target} (${kind}).`);
      form.reset();
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteEdge(edge) {
    setBusy(true);
    try {
      const idx = graph.edges.findIndex((e) => e.source === edge.source && e.target === edge.target && e.kind === edge.kind);
      if (idx === -1) return;
      const edges = [...graph.edges];
      edges.splice(idx, 1);
      await writeGraph({ edges });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-content">
      <div className="admin-topbar">
        <span className="overlay-heading">Admin — {user.email}</span>
        <span className="network-layout-sep">|</span>
        <button type="button" className="link-btn" onClick={() => signOut(auth)}>Sign Out</button>
      </div>

      {message && <p className="admin-message">{message}</p>}

      <div className="admin-columns">
        <section className="admin-section">
          <h2 className="detail-heading">Add Node</h2>
          <form onSubmit={handleAddNode} className="admin-form">
            <input name="name" placeholder="Name" required disabled={busy} />
            <select name="kind" defaultValue="person" disabled={busy}>
              {Object.entries(NODE_KIND).map(([k, spec]) => (
                <option key={k} value={k}>{spec.label}</option>
              ))}
            </select>
            <input name="life" placeholder="Life dates, e.g. 1900–1975" disabled={busy} />
            <textarea name="note" placeholder="Short note" rows={3} disabled={busy} />
            <input name="post" placeholder="Current position (optional)" disabled={busy} />
            <label className="admin-checkbox">
              <input type="checkbox" name="now" disabled={busy} /> Active now
            </label>
            <button type="submit" className="link-btn" disabled={busy}>Add Node</button>
          </form>
        </section>

        <section className="admin-section">
          <h2 className="detail-heading">Add Edge</h2>
          <form onSubmit={handleAddEdge} className="admin-form">
            <input name="source" placeholder="Source node id" required disabled={busy} />
            <input name="target" placeholder="Target node id" required disabled={busy} />
            <select name="kind" defaultValue="office" disabled={busy}>
              {Object.entries(EDGE_KIND).map(([k, spec]) => (
                <option key={k} value={k}>{k} ({spec.labelOut})</option>
              ))}
            </select>
            <button type="submit" className="link-btn" disabled={busy}>Add Edge</button>
          </form>
          <p className="admin-hint">
            Node ids are shown in the list on the right — click a node's id to copy it into place isn't wired up yet, just read it off the list.
          </p>
        </section>

        <section className="admin-section admin-section-wide">
          <h2 className="detail-heading">Nodes ({graph.nodes.length})</h2>
          <input
            type="text"
            placeholder="Filter by name…"
            value={nodeQuery}
            onChange={(e) => setNodeQuery(e.target.value)}
            className="admin-filter"
          />
          <ul className="admin-list">
            {filteredNodes.map((n) => (
              <li key={n.id} className="admin-list-row">
                <span className="admin-list-id">{n.id}</span>
                <span>{n.n}</span>
                <span className="admin-list-kind">{n.k}</span>
                <button type="button" className="link-btn" onClick={() => handleDeleteNode(n.id)} disabled={busy}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
          {nodeQuery && filteredNodes.length === 60 && (
            <p className="admin-hint">Showing first 60 matches — refine the filter for more.</p>
          )}
        </section>

        <section className="admin-section admin-section-wide">
          <h2 className="detail-heading">Edges ({graph.edges.length})</h2>
          <input
            type="text"
            placeholder="Filter by node id or kind…"
            value={edgeQuery}
            onChange={(e) => setEdgeQuery(e.target.value)}
            className="admin-filter"
          />
          <ul className="admin-list">
            {filteredEdges.map((edge, i) => (
              <li key={`${edge.source}-${edge.target}-${edge.kind}-${i}`} className="admin-list-row">
                <span className="admin-list-id">{edge.source} → {edge.target}</span>
                <span className="admin-list-kind">{edge.kind}</span>
                <button type="button" className="link-btn" onClick={() => handleDeleteEdge(edge)} disabled={busy}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
          {edgeQuery && filteredEdges.length === 60 && (
            <p className="admin-hint">Showing first 60 matches — refine the filter for more.</p>
          )}
        </section>
      </div>
    </div>
  );
}
