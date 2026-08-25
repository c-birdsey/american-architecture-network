import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { addDoc, collection, doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { auth, db } from "../firebase.js";
import { useAuth, useAuthSignIn } from "../hooks/useAuthHooks.js";
import { useGraph } from "../hooks/useGraph.js";
import { useExpansionRuns } from "../hooks/useExpansionRuns.js";
import { ADMIN_EMAILS } from "../firebase-config.js";
import { NODE_KIND, EDGE_KIND, HOUSE } from "../data/taxonomy.js";
import CreatableSelect from "../components/CreatableSelect.jsx";

// Fixed taxonomy, so unlike Awards below there's no "add a new one" case
// -- Tags stays a searchable pick-list (allowCreate={false} everywhere
// it's used), not an open vocabulary. See taxonomy.js's own comment on
// HOUSE for why: new codes are only ever added there, in code.
const TAG_OPTIONS = Object.entries(HOUSE).map(([code, label]) => ({ value: code, label }));

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

// Sign-in/allowlist check shared by AdminPanel and EditNodePopover -- both
// need the same three gate states (still checking, signed out, signed in
// but not on ADMIN_EMAILS) before rendering whatever admin content they're
// wrapping. `children` is a render prop so the wrapped content only mounts
// once a real admin user is available.
function AdminGate({ children, onClose }) {
  const user = useAuth();
  const signIn = useAuthSignIn();
  const [error, setError] = useState("");

  if (user === undefined) return <p className="admin-status">Loading…</p>;

  if (user === null) {
    return (
      <div className="admin-gate">
        <p>Admin access requires signing in with an approved Google account.</p>
        <button
          type="button"
          className="link-btn link-btn-edit"
          onClick={() => {
            setError("");
            signIn().then(onClose).catch((err) => setError(err.message));
          }}
        >
          Sign In with Google
        </button>
        {error && <p className="admin-status">{error}</p>}
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
    <div className="overlay">
      <button type="button" className="overlay-close overlay-close-floating" onClick={onClose}>
        Close
      </button>

      <AdminGate onClose={onClose}>
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

// Full-screen popover editor for a single node's attributes -- opened
// from the network detail panel's Edit button. Same overlay chrome as
// AdminPanel and the same title/Save/Cancel-in-one-row header and
// borderless field styling as the archive app's own New/Edit Entry
// overlay, but scoped to one node, and -- like Manual Addition's Add
// Node form -- only shows the fields that kind actually uses. Unlike
// Add Node's plain Person/everything-else split though, the live data
// (scripts/seed.json) shows Award nodes carry a date 87% of the time
// and 139 of 348 Practice nodes are marked active, so the per-kind
// field set below is wider than Add Node's. No click-off-to-close here
// (unlike Admin/Search) -- Cancel is the only way out, so a stray click
// while filling in a field can't lose it.
export function EditNodePopover({ nodeId, onClose }) {
  const rawGraph = useGraph();
  const [busy, setBusy] = useState(false);

  return (
    <div className="overlay">
      <div className="overlay-bar">
        <h1 className="overlay-title">Edit</h1>
        <button type="submit" form="edit-node-form" className="overlay-submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className="overlay-close" onClick={onClose}>Cancel</button>
      </div>

      <AdminGate onClose={onClose}>
        {() =>
          rawGraph === undefined ? (
            <p className="admin-status">Loading…</p>
          ) : rawGraph === null ? (
            <p className="admin-status">The network's data hasn't been seeded yet — run the migration script first (see README).</p>
          ) : (
            <EditNodeForm graph={rawGraph} nodeId={nodeId} onSaved={onClose} busy={busy} setBusy={setBusy} />
          )
        }
      </AdminGate>
    </div>
  );
}

// Life dates matter for Person (birth–death) and Award (a single year,
// not a range) but not Practice/School. Active matters for Person and
// Practice. Current position and the Awards-list are Person/Practice-
// only -- every Award/School node in the live data has an empty Awards
// list. Note/Tags stay universal: every kind uses Tags, and Note
// (labeled Description outside Person) is populated on most Award nodes
// and a good chunk of the rest. Whichever fields a kind hides stay
// untouched on save -- switching Kind never clobbers a field the form
// isn't currently showing. Awards draws its suggestions from every
// award string already used anywhere in the graph, the same "search the
// live database, or add a new value" pattern as the archive app's
// author/collaborator fields.
function EditNodeForm({ graph, nodeId, onSaved, busy, setBusy }) {
  const node = graph.nodes.find((n) => n.id === nodeId);

  const [kind, setKind] = useState(node?.k || "person");
  const [name, setName] = useState(node?.n || "");
  const [life, setLife] = useState(node?.l || "");
  const [active, setActive] = useState(!!node?.now);
  const [post, setPost] = useState(node?.post || "");
  const [note, setNote] = useState(node?.t || "");
  const [tags, setTags] = useState(node?.h || []);
  const [awards, setAwards] = useState(node?.a || []);

  const awardOptions = useMemo(() => {
    const set = new Set(graph.nodes.flatMap((n) => n.a || []));
    return [...set].sort().map((a) => ({ value: a, label: a }));
  }, [graph.nodes]);

  if (!node) return <p className="admin-status">This node no longer exists.</p>;

  const showLife = kind === "person" || kind === "award";
  const showActive = kind === "person" || kind === "practice";
  const showPost = kind === "person";
  const showAwards = kind === "person" || kind === "practice";

  async function handleSubmit(e) {
    e.preventDefault();
    const updated = {
      ...node,
      n: name.trim(),
      k: kind,
      t: note.trim(),
      h: tags,
      ...(showLife ? { l: life.trim() } : null),
      ...(showActive ? { now: active ? 1 : 0 } : null),
      ...(showPost ? { post: post.trim() } : null),
      ...(showAwards ? { a: awards } : null),
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
    <form id="edit-node-form" onSubmit={handleSubmit} className="admin-form-edit">
      <div className="admin-form-row">
        <label className="field">
          <span>Name</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" disabled={busy} required />
        </label>

        <div className="field">
          <span>Type</span>
          <div className="choice-list">
            {Object.entries(NODE_KIND).map(([k, spec]) => (
              <button
                type="button"
                key={k}
                className={kind === k ? "active" : ""}
                onClick={() => setKind(k)}
                disabled={busy}
              >
                {spec.label}
              </button>
            ))}
          </div>
        </div>

        {showLife && (
          <label className="field">
            <span>{kind === "award" ? "Date" : "Dates"}</span>
            <input
              type="text"
              value={life}
              onChange={(e) => setLife(e.target.value)}
              placeholder={kind === "award" ? "e.g. 1962" : "e.g. 1900–1975"}
              disabled={busy}
            />
          </label>
        )}

        {showActive && (
          <div className="field">
            <span>Active?</span>
            <div className="choice-list">
              <button type="button" className={active ? "active" : ""} onClick={() => setActive(true)} disabled={busy}>Active</button>
              <button type="button" className={!active ? "active" : ""} onClick={() => setActive(false)} disabled={busy}>Inactive</button>
            </div>
          </div>
        )}

        {showPost && (
          <label className="field">
            <span>Current position</span>
            <input type="text" value={post} onChange={(e) => setPost(e.target.value)} placeholder="Current position" disabled={busy} />
          </label>
        )}
      </div>

      <label className="field">
        <span>{kind === "person" ? "Note" : "Description"}</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={kind === "person" ? "Note…" : "Description…"}
          rows={3}
          disabled={busy}
        />
      </label>

      <div className="field">
        <span>Tags</span>
        <CreatableSelect
          options={TAG_OPTIONS}
          selected={tags}
          onChange={setTags}
          multiple
          placeholder="Search tags…"
        />
      </div>

      {showAwards && (
        <div className="field">
          <span>Awards</span>
          <CreatableSelect
            options={awardOptions}
            selected={awards}
            onChange={setAwards}
            multiple
            allowCreate
            placeholder="Search or add an award…"
          />
        </div>
      )}
    </form>
  );
}

// Route wrapper for direct navigation to /admin (bookmarks, typed URLs) --
// closing here has nowhere settled to return to, so it's a real navigation
// back to "/", same as any other link.
export default function AdminPage() {
  const navigate = useNavigate();
  return <AdminPanel onClose={() => navigate("/")} />;
}

// The three top-level admin modes, stacked as a choice-list top-left of
// the dashboard -- same pattern as Primative Type gating the rest of
// NewEntryPage's form, so switching modes just swaps which panel renders
// below rather than navigating away.
const ADMIN_TABS = [
  { key: "manual", label: "Manual Addition" },
  { key: "manage", label: "Manage Data" },
  { key: "expand", label: "Database Expansion" },
];

function AdminDashboard({ graph, user }) {
  const [tab, setTab] = useState("manual");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const existingIds = useMemo(() => new Set(graph.nodes.map((n) => n.id)), [graph.nodes]);

  return (
    <div className="admin-content">
      <div className="admin-topbar">
        <span className="overlay-heading">Admin — {user.email}</span>
        <span className="network-layout-sep">|</span>
        <button type="button" className="link-btn" onClick={() => signOut(auth)}>Sign Out</button>
      </div>

      {message && <p className="admin-message">{message}</p>}

      <div className="admin-layout">
        <div className="admin-tabs choice-list">
          {ADMIN_TABS.map((t) => (
            <button
              type="button"
              key={t.key}
              className={tab === t.key ? "active" : ""}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="admin-tab-content">
          {tab === "manual" && (
            <ManualAdditionForm graph={graph} existingIds={existingIds} busy={busy} setBusy={setBusy} setMessage={setMessage} />
          )}
          {tab === "manage" && (
            <ManageDataPanel graph={graph} busy={busy} setBusy={setBusy} setMessage={setMessage} />
          )}
          {tab === "expand" && (
            <ExpansionPanel graph={graph} existingIds={existingIds} busy={busy} setBusy={setBusy} setMessage={setMessage} user={user} />
          )}
        </div>
      </div>
    </div>
  );
}

// Add Node / Add Edge, styled after the archive app's NewEntryPage: a
// row-head with the row's title and a red/greyed Submit next to it, a
// Type choice-list that gates which columns show (Person gets dates/
// active/position, everything else just gets a description), and an
// Active/Inactive choice-list standing in for the checkbox -- same
// two-line-toggle read as the archive app's Built/Unbuilt status field.
function ManualAdditionForm({ graph, existingIds, busy, setBusy, setMessage }) {
  const [kind, setKind] = useState("person");
  const [name, setName] = useState("");
  const [life, setLife] = useState("");
  const [active, setActive] = useState(false);
  const [post, setPost] = useState("");
  const [description, setDescription] = useState("");

  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [edgeKind, setEdgeKind] = useState("office");

  const nodeReady = name.trim().length > 0;
  const edgeReady = source.trim().length > 0 && target.trim().length > 0;

  async function handleAddNode(e) {
    e.preventDefault();
    if (!nodeReady) return;
    const trimmedName = name.trim();
    const id = uniqueId(slugify(trimmedName), existingIds);
    const node = {
      id,
      n: trimmedName,
      k: kind,
      l: kind === "person" ? life.trim() : "",
      t: kind === "person" ? "" : description.trim(),
      h: [],
      a: [],
      now: kind === "person" && active ? 1 : 0,
      post: kind === "person" ? post.trim() : "",
    };
    setBusy(true);
    try {
      await writeGraph({ nodes: [...graph.nodes, node] });
      setMessage(`Added "${trimmedName}" (${id}).`);
      setName(""); setLife(""); setActive(false); setPost(""); setDescription("");
    } finally {
      setBusy(false);
    }
  }

  async function handleAddEdge(e) {
    e.preventDefault();
    if (!edgeReady) return;
    const src = source.trim();
    const tgt = target.trim();
    if (!existingIds.has(src) || !existingIds.has(tgt)) {
      setMessage(`Both node ids must already exist. "${src}" or "${tgt}" not found.`);
      return;
    }
    setBusy(true);
    try {
      await writeGraph({ edges: [...graph.edges, { source: src, target: tgt, kind: edgeKind }] });
      setMessage(`Added edge ${src} → ${tgt} (${edgeKind}).`);
      setSource(""); setTarget("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-manual">
      <form onSubmit={handleAddNode} className="admin-row">
        <div className="admin-row-head">
          <h3>Add Node</h3>
          <button type="submit" className="admin-row-submit" disabled={busy || !nodeReady}>Submit</button>
        </div>

        <div className="admin-form-row">
          <div className="field field-type">
            <span>Type</span>
            <div className="choice-list">
              {Object.entries(NODE_KIND).map(([k, spec]) => (
                <button
                  type="button"
                  key={k}
                  className={kind === k ? "active" : ""}
                  onClick={() => setKind(k)}
                  disabled={busy}
                >
                  {spec.label}
                </button>
              ))}
            </div>
          </div>

          <label className="field">
            <span>Name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" disabled={busy} />
          </label>

          {kind === "person" ? (
            <>
              <label className="field">
                <span>Dates</span>
                <input type="text" value={life} onChange={(e) => setLife(e.target.value)} placeholder="e.g. 1900–1975" disabled={busy} />
              </label>
              <div className="field">
                <span>Active</span>
                <div className="choice-list">
                  <button type="button" className={active ? "active" : ""} onClick={() => setActive(true)} disabled={busy}>Active</button>
                  <button type="button" className={!active ? "active" : ""} onClick={() => setActive(false)} disabled={busy}>Inactive</button>
                </div>
              </div>
              <label className="field">
                <span>Current position</span>
                <input type="text" value={post} onChange={(e) => setPost(e.target.value)} placeholder="Current position" disabled={busy} />
              </label>
            </>
          ) : (
            <label className="field">
              <span>Description</span>
              <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" disabled={busy} />
            </label>
          )}
        </div>
      </form>

      <form onSubmit={handleAddEdge} className="admin-row">
        <div className="admin-row-head">
          <h3>Add Edge</h3>
          <button type="submit" className="admin-row-submit" disabled={busy || !edgeReady}>Submit</button>
        </div>

        <div className="admin-form-row">
          <NodeSearchField label="Source" placeholder="Source" nodes={graph.nodes} valueId={source} onSelect={setSource} disabled={busy} />
          <NodeSearchField label="Target" placeholder="Target" nodes={graph.nodes} valueId={target} onSelect={setTarget} disabled={busy} />
          <label className="field">
            <span>Relation</span>
            <select value={edgeKind} onChange={(e) => setEdgeKind(e.target.value)} disabled={busy}>
              {Object.entries(EDGE_KIND).map(([k, spec]) => (
                <option key={k} value={k}>{k} ({spec.labelOut})</option>
              ))}
            </select>
          </label>
        </div>
      </form>
    </div>
  );
}

// A live-search node picker for Add Edge's Source/Target -- searches by
// name (not id, which nobody has memorized), shows matches in a dropdown,
// and commits the picked node's id via onSelect while displaying its name
// in the field. Typing without picking a result clears any prior
// selection rather than silently keeping a stale id.
function NodeSearchField({ label, placeholder, nodes, valueId, onSelect, disabled }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!valueId) { setQuery(""); return; }
    const node = nodes.find((n) => n.id === valueId);
    setQuery(node ? node.n : "");
  }, [valueId, nodes]);

  useEffect(() => {
    function onDocMouseDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return nodes.filter((n) => n.n.toLowerCase().includes(q)).slice(0, 20);
  }, [nodes, query]);

  function handleChange(e) {
    setQuery(e.target.value);
    setOpen(true);
    if (valueId) onSelect("");
  }

  function handleSelect(node) {
    onSelect(node.id);
    setQuery(node.n);
    setOpen(false);
  }

  return (
    <div className="field admin-search-field" ref={wrapRef}>
      <span>{label}</span>
      <input
        type="text"
        value={query}
        onChange={handleChange}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
      />
      {open && results.length > 0 && (
        <ul className="admin-search-results">
          {results.map((n) => (
            <li key={n.id}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => handleSelect(n)}>
                {n.n} <span className="admin-search-kind">{n.k}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Two side-by-side columns, Nodes and Edges, each independently
// searchable, filterable by kind (multi-select toggles, same on/off
// pattern as the network's own Filters panel), and sortable by name or
// grouped by kind -- then deletable, same as before.
function ManageDataPanel({ graph, busy, setBusy, setMessage }) {
  const [nodeQuery, setNodeQuery] = useState("");
  const [nodeSort, setNodeSort] = useState("name"); // "name" | "type"
  const [nodeKindsOn, setNodeKindsOn] = useState(() => new Set(Object.keys(NODE_KIND)));

  const [edgeQuery, setEdgeQuery] = useState("");
  const [edgeSort, setEdgeSort] = useState("name"); // "name" | "type"
  const [edgeKindsOn, setEdgeKindsOn] = useState(() => new Set(Object.keys(EDGE_KIND)));

  function toggleNodeKind(k) {
    setNodeKindsOn((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  function toggleEdgeKind(k) {
    setEdgeKindsOn((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  const filteredNodes = useMemo(() => {
    const q = nodeQuery.trim().toLowerCase();
    const matches = graph.nodes.filter((n) => nodeKindsOn.has(n.k) && (!q || n.n.toLowerCase().includes(q)));
    matches.sort((a, b) =>
      nodeSort === "type" ? a.k.localeCompare(b.k) || a.n.localeCompare(b.n) : a.n.localeCompare(b.n)
    );
    return matches.slice(0, 60);
  }, [graph.nodes, nodeQuery, nodeSort, nodeKindsOn]);

  const filteredEdges = useMemo(() => {
    const q = edgeQuery.trim().toLowerCase();
    const matches = graph.edges.filter(
      (e) => edgeKindsOn.has(e.kind) && (!q || e.source.includes(q) || e.target.includes(q) || e.kind.includes(q))
    );
    matches.sort((a, b) =>
      edgeSort === "type"
        ? a.kind.localeCompare(b.kind) || a.source.localeCompare(b.source)
        : a.source.localeCompare(b.source) || a.target.localeCompare(b.target)
    );
    return matches.slice(0, 60);
  }, [graph.edges, edgeQuery, edgeSort, edgeKindsOn]);

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

  async function handleDeleteEdge(edge) {
    if (!confirm(`Delete the edge ${edge.source} → ${edge.target} (${edge.kind})? This can't be undone.`)) return;
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
    <div className="admin-columns">
      <section className="admin-section">
        <div className="admin-section-head">
          <h2 className="detail-heading">Nodes ({graph.nodes.length})</h2>
          <input
            type="text"
            placeholder="Search"
            value={nodeQuery}
            onChange={(e) => setNodeQuery(e.target.value)}
            className="admin-filter"
          />
        </div>
        <div className="admin-type-filters">
          {Object.entries(NODE_KIND).map(([k, spec]) => (
            <button
              type="button"
              key={k}
              className={nodeKindsOn.has(k) ? "admin-type-toggle" : "admin-type-toggle off"}
              onClick={() => toggleNodeKind(k)}
            >
              {spec.label}
            </button>
          ))}
        </div>
        <div className="admin-controls">
          <span>Sort</span>
          <button type="button" className={nodeSort === "name" ? "link-btn active" : "link-btn"} onClick={() => setNodeSort("name")}>
            Name
          </button>
          <button type="button" className={nodeSort === "type" ? "link-btn active" : "link-btn"} onClick={() => setNodeSort("type")}>
            Type
          </button>
        </div>
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
        {filteredNodes.length === 60 && (
          <p className="admin-hint">Showing first 60 matches — refine the filter for more.</p>
        )}
      </section>

      <section className="admin-section">
        <div className="admin-section-head">
          <h2 className="detail-heading">Edges ({graph.edges.length})</h2>
          <input
            type="text"
            placeholder="Search"
            value={edgeQuery}
            onChange={(e) => setEdgeQuery(e.target.value)}
            className="admin-filter"
          />
        </div>
        <div className="admin-type-filters">
          {Object.keys(EDGE_KIND).map((k) => (
            <button
              type="button"
              key={k}
              className={edgeKindsOn.has(k) ? "admin-type-toggle" : "admin-type-toggle off"}
              onClick={() => toggleEdgeKind(k)}
            >
              {k}
            </button>
          ))}
        </div>
        <div className="admin-controls">
          <span>Sort</span>
          <button type="button" className={edgeSort === "name" ? "link-btn active" : "link-btn"} onClick={() => setEdgeSort("name")}>
            Name
          </button>
          <button type="button" className={edgeSort === "type" ? "link-btn active" : "link-btn"} onClick={() => setEdgeSort("type")}>
            Type
          </button>
        </div>
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
        {filteredEdges.length === 60 && (
          <p className="admin-hint">Showing first 60 matches — refine the filter for more.</p>
        )}
      </section>
    </div>
  );
}

const RUN_STATUS_LABEL = {
  pending: "Running…",
  running: "Running…",
  awaiting_review: "Awaiting Review",
  confirmed: "Confirmed & Incorporated",
  rejected: "Rejected",
  failed: "Failed",
};

function formatRunDate(ts) {
  if (!ts?.toDate) return "Just now";
  return ts.toDate().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const EXPANSION_INFO_TEXT =
  "Runs an unattended research agent (Claude, with live web search) against your prompt. It reads the graph's existing nodes first, so it won't recreate someone already here, then proposes new people/practices/schools/awards and the edges connecting them, plus a written note on its sources and reasoning. Nothing touches the live graph automatically -- a run sits at \"Awaiting Review\" until an admin looks at the results and Incorporates or Rejects it. One run is scoped to a single focused topic (a hard 9-minute research budget), and can take a few minutes -- feel free to close the tab and check back later.";

// Submit a prompt -> a Firestore doc appears with status "pending" ->
// the Cloud Function (functions/index.js) picks it up via a Firestore
// trigger, researches it with Claude + web search, and writes { nodes,
// edges, provenance } back onto the same doc as status "awaiting_review".
// This tab is purely the client half: kick off a run and, once one comes
// back, review/incorporate/reject it -- the research itself runs
// unattended, possibly well after the admin who submitted it has closed
// the tab.
function ExpansionPanel({ graph, existingIds, busy, setBusy, setMessage, user }) {
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const infoRef = useRef(null);
  const { runs, error: runsError } = useExpansionRuns();

  useEffect(() => {
    if (!infoOpen) return;
    function onDocMouseDown(e) {
      if (infoRef.current && !infoRef.current.contains(e.target)) setInfoOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [infoOpen]);

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmedTitle = title.trim();
    const trimmedPrompt = prompt.trim();
    if (!trimmedTitle || !trimmedPrompt) return;
    setSubmitting(true);
    try {
      await addDoc(collection(db, "expansionRuns"), {
        title: trimmedTitle,
        prompt: trimmedPrompt,
        status: "pending",
        createdBy: user.email,
        createdAt: serverTimestamp(),
        startedAt: null,
        completedAt: null,
        result: null,
        error: null,
        reviewedBy: null,
        reviewedAt: null,
        rejectReason: null,
      });
      setTitle("");
      setPrompt("");
      setMessage("Run kicked off — check back once it reaches Awaiting Review.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="admin-expand">
      <form onSubmit={handleSubmit} className="admin-row admin-run-form">
        <div className="admin-row-head">
          <h3>New Research Run</h3>
          <span className="admin-info-wrap" ref={infoRef}>
            <button
              type="button"
              className="info-icon-btn"
              onClick={() => setInfoOpen((o) => !o)}
              aria-label="What does this do?"
            >
              i
            </button>
            {infoOpen && <p className="admin-info-popover">{EXPANSION_INFO_TEXT}</p>}
          </span>
          <button type="submit" className="admin-row-submit" disabled={submitting || !title.trim() || !prompt.trim()}>
            Submit
          </button>
        </div>

        <label className="field">
          <span>Title</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Research Label"
            disabled={submitting}
          />
        </label>

        <label className="field entry-form-full">
          <span>Prompt</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. Find AIA Gold Medal laureates from the 1950s missing from the graph"
            rows={3}
            disabled={submitting}
          />
        </label>
      </form>

      <h3 className="detail-heading admin-run-table-heading">Past Research</h3>
      <div className="admin-run-table">
        <div className="admin-run-row admin-run-head">
          <span>Title</span>
          <span>Submitted</span>
          <span>Status</span>
        </div>
        {runsError && (
          <p className="admin-hint">
            Couldn't load runs: {runsError.message}
            {runsError.code === "permission-denied" && " — have the Firestore rules in firestore.rules been deployed yet? See README's \"4. Security rules\"."}
          </p>
        )}
        {!runsError && runs === undefined && <p className="admin-status-inline">Loading…</p>}
        {!runsError && runs && runs.length === 0 && <p className="admin-hint">No runs yet.</p>}
        {runs && runs.map((run) => (
          <div key={run.id}>
            <button
              type="button"
              className={
                selectedRunId && selectedRunId !== run.id
                  ? "admin-run-row admin-run-row-clickable admin-run-row-dimmed"
                  : "admin-run-row admin-run-row-clickable"
              }
              onClick={() => setSelectedRunId((id) => (id === run.id ? null : run.id))}
            >
              <span className="admin-run-prompt">{run.title || run.prompt}</span>
              <span className="admin-run-date">{formatRunDate(run.createdAt)}</span>
              <span className={`admin-run-status admin-run-status-${run.status}`}>
                {RUN_STATUS_LABEL[run.status] || run.status}
              </span>
            </button>
            {selectedRunId === run.id && (
              <RunDetail
                run={run}
                graph={graph}
                existingIds={existingIds}
                busy={busy}
                setBusy={setBusy}
                user={user}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function RunDetail({ run, graph, existingIds, busy, setBusy, user }) {
  const [resultsOpen, setResultsOpen] = useState(false);

  async function handleIncorporate() {
    setBusy(true);
    try {
      const liveIds = new Set(existingIds);
      const existingEdgeKeys = new Set(graph.edges.map((e) => `${e.source}|${e.target}|${e.kind}`));

      const newNodes = [];
      for (const node of run.result?.nodes || []) {
        if (liveIds.has(node.id)) continue; // never overwrite an existing node
        newNodes.push(node);
        liveIds.add(node.id);
      }

      const newEdges = [];
      for (const edge of run.result?.edges || []) {
        const key = `${edge.source}|${edge.target}|${edge.kind}`;
        if (existingEdgeKeys.has(key)) continue;
        if (!liveIds.has(edge.source) || !liveIds.has(edge.target)) continue; // dangling endpoint
        newEdges.push(edge);
        existingEdgeKeys.add(key);
      }

      await writeGraph({ nodes: [...graph.nodes, ...newNodes], edges: [...graph.edges, ...newEdges] });
      await updateDoc(doc(db, "expansionRuns", run.id), {
        status: "confirmed",
        reviewedBy: user.email,
        reviewedAt: serverTimestamp(),
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    setBusy(true);
    try {
      await updateDoc(doc(db, "expansionRuns", run.id), {
        status: "rejected",
        reviewedBy: user.email,
        reviewedAt: serverTimestamp(),
      });
    } finally {
      setBusy(false);
    }
  }

  // Rejected just means archived, not deleted -- this walks a run back to
  // Awaiting Review so it can be reconsidered instead of resubmitted.
  async function handleUnarchive() {
    setBusy(true);
    try {
      await updateDoc(doc(db, "expansionRuns", run.id), {
        status: "awaiting_review",
        rejectReason: null,
        reviewedBy: user.email,
        reviewedAt: serverTimestamp(),
      });
    } finally {
      setBusy(false);
    }
  }

  const hasResult = Boolean(run.result);

  return (
    <div className="admin-run-detail">
      <p className="admin-run-desc-label">Prompt</p>
      <p className="admin-run-desc">{run.prompt}</p>

      {(run.status === "pending" || run.status === "running") && (
        <p className="admin-hint">Still researching — this can take a while, check back later.</p>
      )}
      {run.status === "failed" && <p className="admin-hint">Run failed: {run.error}</p>}
      {run.status === "rejected" && run.rejectReason && (
        <p className="admin-hint">Rejected — {run.rejectReason}</p>
      )}

      <div className="admin-run-actions">
        {hasResult && (
          <button type="button" className="link-btn" onClick={() => setResultsOpen((o) => !o)}>
            {resultsOpen ? "Hide Results" : "View Results"}
          </button>
        )}
        {run.status === "awaiting_review" && (
          <>
            <button type="button" className="link-btn" onClick={handleIncorporate} disabled={busy}>
              Incorporate
            </button>
            <button type="button" className="link-btn" onClick={handleReject} disabled={busy}>
              Reject
            </button>
          </>
        )}
        {run.status === "rejected" && (
          <button type="button" className="link-btn" onClick={handleUnarchive} disabled={busy}>
            Unarchive
          </button>
        )}
      </div>

      {resultsOpen && hasResult && (
        <div className="admin-run-results">
          {run.result.provenance && <p className="admin-run-provenance">{run.result.provenance}</p>}

          <div className="admin-run-columns">
            <section className="admin-section">
              <h3 className="detail-heading">Nodes ({run.result.nodes.length})</h3>
              <ul className="admin-list">
                {run.result.nodes.map((n) => (
                  <li key={n.id} className="admin-list-row">
                    <span className="admin-list-id">{n.id}</span>
                    <span>{n.n}</span>
                    <span className="admin-list-kind">{n.k}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="admin-section">
              <h3 className="detail-heading">Edges ({run.result.edges.length})</h3>
              <ul className="admin-list">
                {run.result.edges.map((edge, i) => (
                  <li key={`${edge.source}-${edge.target}-${edge.kind}-${i}`} className="admin-list-row">
                    <span className="admin-list-id">{edge.source} → {edge.target}</span>
                    <span className="admin-list-kind">{edge.kind}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
