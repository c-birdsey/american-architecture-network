import { useEffect, useMemo, useRef, useState } from "react";
import { forceSimulation, forceLink, forceManyBody, forceCollide, forceX, forceY } from "d3-force";
import { zoom as d3zoom, zoomIdentity } from "d3-zoom";
import { select, pointer } from "d3-selection";
import { buildNetworkGraph } from "../data/network.js";
import { useGraph } from "../hooks/useGraph.js";
import { NODE_KIND, EDGE_KIND, VIEW_PRESETS, RELATIONSHIP_ORDER, HOUSE } from "../data/taxonomy.js";
import { AdminPanel, EditNodePopover } from "./AdminPage.jsx";

const FOCUS_DIM_ALPHA = 0.15;
const LABEL_FONT_SIZE = 11;
const LABEL_FADE_START_K = 0.4;
const LABEL_FADE_END_K = 1.0;
const HIT_TOLERANCE_PX = 6;
const DRAG_CLICK_THRESHOLD_PX = 4;
const TOTAL_PREWARM_TICKS = 300;

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function endpointId(end) {
  return typeof end === "string" ? end : end.id;
}

// Award/school nodes are few but structurally important (a prize or a
// school sits at the center of dozens of relationships), so they get a
// strong fixed size and heavy repulsion regardless of degree -- everyone
// else's radius reflects how connected they actually are.
function nodeRadius(node) {
  if (node.k === "award") return node.h?.[0] === "HONOR" ? 9 : 7;
  if (node.k === "school") return 7;
  if (node.k === "practice") return 4.5;
  return clamp(3.2 + node.degree * 0.35, 3.2, 8); // person
}

function nodeCharge(node) {
  if (node.k === "award") return -420;
  if (node.k === "school") return -320;
  return -58;
}

// A world-space size that keeps growing on screen as you zoom in past 1x
// (never shrinking below its 1x size) but sub-linearly rather than
// tracking the canvas scale directly -- otherwise both shapes and labels
// balloon unboundedly at high zoom.
function taperedWorldSize(base, k) {
  return k <= 1 ? base : base / Math.sqrt(k);
}

function drawPolygon(ctx, cx, cy, r, sides, rotation) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const angle = rotation + (i * 2 * Math.PI) / sides;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function traceNodeShape(ctx, node, cx, cy, r) {
  const shape = NODE_KIND[node.k]?.shape;
  if (shape === "square") {
    ctx.beginPath();
    ctx.rect(cx - r, cy - r, r * 2, r * 2);
  } else if (shape === "diamond") {
    drawPolygon(ctx, cx, cy, r, 4, -Math.PI / 2);
  } else if (shape === "triangle") {
    drawPolygon(ctx, cx, cy, r, 3, -Math.PI / 2);
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  }
}

// Shared by the live node/link counter and the canvas draw loop (via
// visibilityRef, see below) so "what's visible" is defined in exactly one
// place. hideOrphans needs a first pass (baseVisible, kind/onlyNow only)
// to know which nodes have any visible edge before it can decide which of
// those nodes to actually keep -- same two-pass shape as the static
// reference's refreshVisibility().
function computeVisibility(graph, nodeById, { edgeKindsOn, nodeKindsOn, hideOrphans, onlyNow }) {
  function baseVisible(node) {
    if (!nodeKindsOn.has(node.k)) return false;
    if (onlyNow && !node.now && node.k !== "award" && node.k !== "school") return false;
    return true;
  }
  let linkedSet = null;
  if (hideOrphans) {
    linkedSet = new Set();
    for (const l of graph.links) {
      if (!edgeKindsOn.has(l.kind)) continue;
      const s = nodeById.get(endpointId(l.source));
      const t = nodeById.get(endpointId(l.target));
      if (!s || !t || !baseVisible(s) || !baseVisible(t)) continue;
      linkedSet.add(s.id);
      linkedSet.add(t.id);
    }
  }
  function nodeVisible(node) {
    return baseVisible(node) && (!hideOrphans || linkedSet.has(node.id));
  }
  function linkVisible(l) {
    if (!edgeKindsOn.has(l.kind)) return false;
    const s = nodeById.get(endpointId(l.source));
    const t = nodeById.get(endpointId(l.target));
    return !!s && !!t && nodeVisible(s) && nodeVisible(t);
  }
  return { nodeVisible, linkVisible };
}

const ALWAYS_VISIBLE = { nodeVisible: () => true, linkVisible: () => true };

// BFS outward from `id` through edges whose kind is currently enabled
// (regardless of node-kind visibility -- matches the static reference's
// setFocus, which only checks edgeOn). depth 1 is what plain selection
// shows; the panel's "Focus Neighbourhood" action escalates to depth 2.
function neighborhoodSet(id, depth, graph, nodeById, edgeKindsOn) {
  const set = new Set([id]);
  let frontier = [id];
  for (let hop = 0; hop < depth; hop++) {
    const next = [];
    for (const l of graph.links) {
      if (!edgeKindsOn.has(l.kind)) continue;
      const s = endpointId(l.source), t = endpointId(l.target);
      if (frontier.includes(s) && !set.has(t)) { set.add(t); next.push(t); }
      else if (frontier.includes(t) && !set.has(s)) { set.add(s); next.push(s); }
    }
    frontier = next;
  }
  return set;
}

export default function NetworkPage() {
  const rawGraph = useGraph();
  const canvasRef = useRef(null);
  const tooltipRef = useRef(null);
  const transformRef = useRef(zoomIdentity);
  const zoomBehaviorRef = useRef(null);
  const simRef = useRef(null);
  const dragNodeRef = useRef(null);
  const downRef = useRef(null);
  const visibilityRef = useRef(ALWAYS_VISIBLE);
  const colorizeRef = useRef(false);

  const [selectedId, setSelectedId] = useState(null);
  const [focusDepth, setFocusDepth] = useState(1);
  const selectedRef = useRef(null);
  const focusSetRef = useRef(null);
  const drawRef = useRef(null);

  const [settleProgress, setSettleProgress] = useState(0);
  const [settled, setSettled] = useState(false);

  // Relationship/view filtering -- what's actually hidden, not just
  // dimmed. Defaults to "Everything".
  const [edgeKindsOn, setEdgeKindsOn] = useState(() => new Set(Object.keys(EDGE_KIND)));
  const [nodeKindsOn, setNodeKindsOn] = useState(() => new Set(Object.keys(NODE_KIND)));
  const [hideOrphans, setHideOrphans] = useState(false);
  const [onlyNow, setOnlyNow] = useState(false);
  const [activePreset, setActivePreset] = useState("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [colorize, setColorize] = useState(false);

  const graph = useMemo(
    () => (rawGraph ? buildNetworkGraph(rawGraph) : null),
    [rawGraph]
  );

  const nodeById = useMemo(() => {
    const map = new Map();
    if (graph) for (const n of graph.nodes) map.set(n.id, n);
    return map;
  }, [graph]);

  const selectedNode = selectedId ? nodeById.get(selectedId) || null : null;

  const visibility = useMemo(() => {
    if (!graph) return ALWAYS_VISIBLE;
    return computeVisibility(graph, nodeById, { edgeKindsOn, nodeKindsOn, hideOrphans, onlyNow });
  }, [graph, nodeById, edgeKindsOn, nodeKindsOn, hideOrphans, onlyNow]);

  const visibleCounts = useMemo(() => {
    if (!graph) return { nodes: 0, links: 0 };
    return {
      nodes: graph.nodes.filter(visibility.nodeVisible).length,
      links: graph.links.filter(visibility.linkVisible).length,
    };
  }, [graph, visibility]);

  // The relationship groups shown in the detail panel only include kinds
  // currently toggled on in the sidebar -- same reasoning as the static
  // reference's dossier building.
  const focusLinks = useMemo(() => {
    if (!selectedId || !graph) return [];
    return graph.links.filter(
      (l) => edgeKindsOn.has(l.kind) &&
        (endpointId(l.source) === selectedId || endpointId(l.target) === selectedId)
    );
  }, [graph, selectedId, edgeKindsOn]);

  const focusSet = useMemo(() => {
    if (!graph || !selectedId) return null;
    return neighborhoodSet(selectedId, focusDepth, graph, nodeById, edgeKindsOn);
  }, [selectedId, focusDepth, graph, nodeById, edgeKindsOn]);

  useEffect(() => {
    if (!graph) return;
    setSettled(false);
    setSettleProgress(0);

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let W = 0, H = 0;
    const DPR = Math.min(2, window.devicePixelRatio || 1);

    function resize() {
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      canvas.width = W * DPR;
      canvas.height = H * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      draw();
    }

    function hitTest(worldX, worldY) {
      const tolerance = HIT_TOLERANCE_PX / transformRef.current.k;
      let best = null;
      let bestDist = Infinity;
      for (const node of graph.nodes) {
        if (node.x == null || !visibilityRef.current.nodeVisible(node)) continue;
        const dx = node.x - worldX, dy = node.y - worldY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= nodeRadius(node) + tolerance && dist < bestDist) {
          best = node;
          bestDist = dist;
        }
      }
      return best;
    }

    function draw() {
      const tf = transformRef.current;
      const vis = visibilityRef.current;
      ctx.save();
      ctx.clearRect(0, 0, W, H);
      ctx.translate(tf.x, tf.y);
      ctx.scale(tf.k, tf.k);

      const focus = focusSetRef.current;
      const labelAlpha = clamp((tf.k - LABEL_FADE_START_K) / (LABEL_FADE_END_K - LABEL_FADE_START_K), 0, 1);
      const labelWorldSize = taperedWorldSize(LABEL_FONT_SIZE, tf.k);

      for (const l of graph.links) {
        if (!vis.linkVisible(l)) continue;
        const s = nodeById.get(endpointId(l.source));
        const t = nodeById.get(endpointId(l.target));
        if (!s || !t || s.x == null || t.x == null) continue;
        const dimmed = focus && !(focus.has(s.id) && focus.has(t.id));
        const spec = EDGE_KIND[l.kind];
        ctx.globalAlpha = dimmed ? FOCUS_DIM_ALPHA : l.kind === "honor" ? 0.28 : l.kind === "principal" ? 0.4 : 0.55;
        ctx.strokeStyle = colorizeRef.current ? (spec?.color || "#000") : "#000";
        ctx.lineWidth = (spec?.weight || 1) / Math.max(0.6, tf.k);
        // Trained At (person -> school, attended-as-a-student) reads as
        // dashed to distinguish it from the solid faculty/seat lines that
        // cover the other two school relationships (taught/led there).
        ctx.setLineDash(l.kind === "trained" ? [5 / tf.k, 4 / tf.k] : []);
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(t.x, t.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      for (const node of graph.nodes) {
        if (node.x == null || !vis.nodeVisible(node)) continue;
        const r = taperedWorldSize(nodeRadius(node), tf.k);
        const dimmed = focus && !focus.has(node.id);
        ctx.globalAlpha = dimmed ? FOCUS_DIM_ALPHA : 1;

        traceNodeShape(ctx, node, node.x, node.y, r);
        ctx.lineWidth = (node.id === selectedRef.current ? 2.2 : 1.4) / tf.k;
        ctx.strokeStyle = colorizeRef.current ? (NODE_KIND[node.k]?.color || "#000") : "#000";
        ctx.stroke();

        const textAlpha = dimmed ? Math.min(labelAlpha, FOCUS_DIM_ALPHA) : labelAlpha;
        if (textAlpha > 0.02) {
          ctx.globalAlpha = textAlpha;
          ctx.fillStyle = "#000";
          ctx.font = `${labelWorldSize.toFixed(2)}px Inter, sans-serif`;
          ctx.textBaseline = "top";
          ctx.fillText(node.n, node.x + r + 4, node.y - 4);
        }
      }

      ctx.restore();
    }
    drawRef.current = draw;

    const linkForce = forceLink(graph.links)
      .id((d) => d.id)
      .distance((l) => EDGE_KIND[l.kind]?.dist ?? 50)
      .strength((l) => EDGE_KIND[l.kind]?.strength ?? 0.35);

    const sim = forceSimulation(graph.nodes)
      .force("link", linkForce)
      .force("charge", forceManyBody().strength(nodeCharge).distanceMax(700))
      .force("collide", forceCollide().radius((d) => nodeRadius(d) + 4))
      .force("x", forceX(0).strength(0.028))
      .force("y", forceY(0).strength(0.032))
      .alpha(1)
      .alphaDecay(0.022)
      .velocityDecay(0.36);
    sim.stop();
    simRef.current = sim;

    function boundsOfVisible() {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of graph.nodes) {
        if (n.x == null || !visibilityRef.current.nodeVisible(n)) continue;
        minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
        minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
      }
      return { minX, minY, maxX, maxY };
    }

    function fitView() {
      const { minX, minY, maxX, maxY } = boundsOfVisible();
      if (minX === Infinity) return;
      const margin = 70;
      const boxW = Math.max(maxX - minX, 1) + margin * 2;
      const boxH = Math.max(maxY - minY, 1) + margin * 2;
      const k = clamp(Math.min(W / boxW, H / boxH), 0.1, 3);
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      const next = zoomIdentity.translate(W / 2 - cx * k, H / 2 - cy * k).scale(k);
      zoomBehaviorRef.current.transform(select(canvas), next);
    }

    let cancelled = false;
    // requestAnimationFrame stops firing while the tab is hidden, so a
    // prewarm driven purely by rAF freezes at whatever % it had reached
    // the moment you switch away, and only resumes once you switch back
    // -- setTimeout keeps running (heavily throttled, but not paused) in
    // a background tab, so falling back to it while hidden means the
    // network is ready (or closer to it) by the time you return instead
    // of picking up from a dead stop. Bigger batches while hidden offset
    // that throttling since there's no need to match the visible frame
    // budget for a progress bar nobody's watching.
    function schedule(fn) {
      return document.hidden ? setTimeout(fn, 0) : requestAnimationFrame(fn);
    }
    function prewarm() {
      let n = 0;
      function chunk() {
        if (cancelled) return;
        // 3 ticks/frame against 300 total = exactly 100 steps, so the
        // percentage advances by 1 every frame instead of jumping in
        // 10-point chunks, while visible.
        const batch = document.hidden ? 30 : 3;
        for (let i = 0; i < batch && n < TOTAL_PREWARM_TICKS; i++, n++) sim.tick();
        setSettleProgress(Math.round((100 * n) / TOTAL_PREWARM_TICKS));
        draw();
        if (n < TOTAL_PREWARM_TICKS) {
          schedule(chunk);
        } else {
          setSettled(true);
          fitView();
          sim.alpha(0.2).alphaTarget(0).restart();
          sim.on("tick", draw);
        }
      }
      schedule(chunk);
    }

    const zoomBehavior = d3zoom()
      .scaleExtent([0.1, 7])
      .filter((event) => {
        if (event.type === "wheel") return true;
        if (event.button) return false;
        const [px, py] = pointer(event, canvas);
        const world = transformRef.current.invert([px, py]);
        return hitTest(world[0], world[1]) === null;
      })
      .on("zoom", (event) => {
        transformRef.current = event.transform;
        draw();
      });
    zoomBehaviorRef.current = zoomBehavior;
    select(canvas).call(zoomBehavior);

    function onPointerDown(event) {
      const [px, py] = pointer(event, canvas);
      const world = transformRef.current.invert([px, py]);
      const hit = hitTest(world[0], world[1]);
      downRef.current = { x: event.clientX, y: event.clientY, node: hit };
      if (hit) {
        dragNodeRef.current = hit;
        hit.fx = hit.x;
        hit.fy = hit.y;
        sim.alphaTarget(0.15).restart();
        canvas.classList.add("dragging");
        canvas.setPointerCapture(event.pointerId);
      }
    }

    function onPointerMove(event) {
      const [px, py] = pointer(event, canvas);
      const world = transformRef.current.invert([px, py]);

      if (dragNodeRef.current) {
        dragNodeRef.current.fx = world[0];
        dragNodeRef.current.fy = world[1];
        return;
      }

      const hit = hitTest(world[0], world[1]);
      const tip = tooltipRef.current;
      if (hit) {
        tip.textContent = hit.n;
        tip.style.left = `${event.clientX + 12}px`;
        tip.style.top = `${event.clientY + 12}px`;
        tip.style.display = "block";
        canvas.style.cursor = "pointer";
      } else {
        tip.style.display = "none";
        canvas.style.cursor = "grab";
      }
    }

    function onPointerUp(event) {
      const down = downRef.current;
      downRef.current = null;
      const dragged = dragNodeRef.current;
      if (dragged) {
        dragged.fx = null;
        dragged.fy = null;
        sim.alphaTarget(0);
        canvas.classList.remove("dragging");
        dragNodeRef.current = null;
      }
      if (!down) return;
      const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
      if (moved > DRAG_CLICK_THRESHOLD_PX) return;
      setSelectedId(down.node ? down.node.id : null);
      setFocusDepth(1);
    }

    window.addEventListener("resize", resize);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    resize();
    prewarm();

    return () => {
      cancelled = true;
      sim.stop();
      simRef.current = null;
      drawRef.current = null;
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
    // selectedId/focusSet/visibility intentionally excluded -- draw() reads
    // them through refs (kept in sync below) so a selection or filter
    // change redraws without tearing down and re-settling the simulation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, nodeById]);

  useEffect(() => {
    selectedRef.current = selectedId;
    focusSetRef.current = focusSet;
    drawRef.current?.();
  }, [selectedId, focusSet]);

  useEffect(() => {
    visibilityRef.current = visibility;
    drawRef.current?.();
  }, [visibility]);

  useEffect(() => {
    colorizeRef.current = colorize;
    drawRef.current?.();
  }, [colorize]);

  function boundsOfVisibleNodes() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    if (!graph) return { minX, minY, maxX, maxY };
    for (const n of graph.nodes) {
      if (n.x == null || !visibility.nodeVisible(n)) continue;
      minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
    }
    return { minX, minY, maxX, maxY };
  }

  function fitToScreen() {
    const canvas = canvasRef.current;
    if (!canvas || !zoomBehaviorRef.current || !graph) return;
    const { minX, minY, maxX, maxY } = boundsOfVisibleNodes();
    if (minX === Infinity) return;
    const margin = 70;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const boxW = Math.max(maxX - minX, 1) + margin * 2;
    const boxH = Math.max(maxY - minY, 1) + margin * 2;
    const k = clamp(Math.min(W / boxW, H / boxH), 0.1, 3);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const next = zoomIdentity.translate(W / 2 - cx * k, H / 2 - cy * k).scale(k);
    zoomBehaviorRef.current.transform(select(canvas), next);
  }

  function centerOnNode(node, targetK) {
    const canvas = canvasRef.current;
    if (!canvas || !zoomBehaviorRef.current || node.x == null) return;
    const k = targetK || Math.max(transformRef.current.k, 1.4);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const next = zoomIdentity.translate(W / 2 - k * node.x, H / 2 - k * node.y).scale(k);
    zoomBehaviorRef.current.transform(select(canvas), next);
  }

  function resettle() {
    simRef.current?.alpha(0.6).restart();
  }

  function applyPreset(id) {
    const p = VIEW_PRESETS[id];
    setEdgeKindsOn(new Set(p.edgeKinds));
    setNodeKindsOn(new Set(p.nodeKinds));
    setHideOrphans(p.hideOrphans);
    setOnlyNow(p.onlyNow);
    setActivePreset(id);
  }

  function toggleEdgeKind(kind) {
    setEdgeKindsOn((cur) => {
      const next = new Set(cur);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  function toggleNodeKind(kind) {
    setNodeKindsOn((cur) => {
      const next = new Set(cur);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [emailCopied, setEmailCopied] = useState(false);
  const [editingNodeId, setEditingNodeId] = useState(null);

  function handleCopyEmail() {
    navigator.clipboard.writeText("info@architectureaffinities.com").then(() => {
      setEmailCopied(true);
      setTimeout(() => setEmailCopied(false), 1500);
    });
  }

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q || !graph) return [];
    return graph.nodes
      .filter((n) => n.n.toLowerCase().includes(q))
      .sort((a, b) => b.degree - a.degree);
  }, [graph, searchQuery]);

  function selectFromSearch(node) {
    setSelectedId(node.id);
    setFocusDepth(1);
    setSearchOpen(false);
    setSearchQuery("");
    centerOnNode(node, 1.8);
  }

  // Same full-screen overlay pattern as the archive app's SearchOverlay --
  // open focuses the input and clears any prior query, Escape closes.
  useEffect(() => {
    if (searchOpen) {
      setSearchQuery("");
      searchInputRef.current?.focus();
    }
  }, [searchOpen]);

  useEffect(() => {
    if (!searchOpen) return;
    function onKeyDown(e) {
      if (e.key === "Escape") setSearchOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchOpen]);

  useEffect(() => {
    if (!infoOpen) return;
    function onKeyDown(e) {
      if (e.key === "Escape") setInfoOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [infoOpen]);

  if (rawGraph === undefined) {
    return <div className="network-loading">Loading the network…</div>;
  }
  if (rawGraph === null) {
    return <div className="network-loading">The network's data hasn't been seeded yet.</div>;
  }

  return (
    <div className="network-stage">
      <canvas ref={canvasRef} />
      <div ref={tooltipRef} className="network-tooltip" />

      {!settled && (
        <div className="network-loading">Settling the network — {settleProgress}%</div>
      )}

      <div className="network-topleft">
        <span className="network-wordmark">AA | American Architecture Network</span>
        <button type="button" className="link-btn" onClick={() => setFiltersOpen((open) => !open)}>
          {filtersOpen ? "Filter-" : "Filter+"}
        </button>
      </div>

      <div className="network-topright">
        <button type="button" className="link-btn" onClick={() => setSearchOpen(true)}>Search</button>
        <button type="button" className="link-btn" onClick={() => setAdminOpen(true)}>Admin</button>
        <button type="button" className="link-btn" onClick={() => setInfoOpen(true)}>Info</button>
      </div>

      <div className="network-counts">
        {visibleCounts.nodes.toLocaleString()} nodes · {visibleCounts.links.toLocaleString()} links shown
      </div>

      <div className="network-layout">
        <button type="button" className="link-btn" onClick={resettle}>Resettle</button>
        <button type="button" className="link-btn" onClick={fitToScreen}>Fit to Screen</button>
        <span className="network-layout-sep">|</span>
        <button
          type="button"
          className={colorize ? "link-btn active" : "link-btn"}
          onClick={() => setColorize((c) => !c)}
        >
          {colorize ? "Monochromy" : "Polychromy"}
        </button>
      </div>

      {filtersOpen && (
        <FilterPanel
          edgeKindsOn={edgeKindsOn}
          nodeKindsOn={nodeKindsOn}
          activePreset={activePreset}
          colorize={colorize}
          onToggleEdgeKind={toggleEdgeKind}
          onToggleNodeKind={toggleNodeKind}
          onApplyPreset={applyPreset}
          onClose={() => setFiltersOpen(false)}
        />
      )}

      {adminOpen && <AdminPanel onClose={() => setAdminOpen(false)} />}

      {selectedNode && (
        <NodeDetailPanel
          node={selectedNode}
          links={focusLinks}
          nodeById={nodeById}
          onSelect={(id) => { setSelectedId(id); setFocusDepth(1); }}
          onFocusNeighborhood={() => setFocusDepth(2)}
          onCenter={() => centerOnNode(selectedNode)}
          onEdit={() => setEditingNodeId(selectedNode.id)}
          onClose={() => setSelectedId(null)}
        />
      )}

      {editingNodeId && (
        <EditNodePopover nodeId={editingNodeId} onClose={() => setEditingNodeId(null)} />
      )}

      {searchOpen && (
        <div className="overlay" onClick={(e) => { if (!e.target.closest("a, button, input, textarea, select")) setSearchOpen(false); }}>
          <div className="overlay-bar">
            <input
              ref={searchInputRef}
              type="search"
              className="search-overlay-input"
              placeholder="Search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoComplete="off"
            />
            <button type="button" className="overlay-close" onClick={() => setSearchOpen(false)}>
              Close
            </button>
          </div>

          {searchQuery.trim() !== "" && (
            searchResults.length === 0 ? (
              <div className="empty-state">
                <p>No matches for "{searchQuery.trim()}".</p>
              </div>
            ) : (
              <div className="search-results">
                {searchResults.map((n) => (
                  <button
                    type="button"
                    key={n.id}
                    className="search-result-row"
                    onClick={() => selectFromSearch(n)}
                  >
                    <span className="search-result-title">{n.n}</span>
                    <span className="search-result-kind">{NODE_KIND[n.k]?.label}</span>
                  </button>
                ))}
              </div>
            )
          )}
        </div>
      )}

      {infoOpen && (
        <div className="overlay" onClick={(e) => { if (!e.target.closest("a, button")) setInfoOpen(false); }}>
          <button type="button" className="overlay-close overlay-close-floating" onClick={() => setInfoOpen(false)}>
            Close
          </button>
          <div className="info-content">
            <p>
              AA is a visualization of the relational network that
              underlies the contemporary American architectural landscape. It
              depicts people, practices, academic institutions, and award
              cohorts as the fundamental organizing data classes within this
              system, allowing influence to register as a weighted,
              gravitational field and surfacing clusters of cultural control.
            </p>
            <p>
              The choice to draw these relationships with a
              representational paradigm originating from the empirical
              sciences — sociograms, phylogenetic trees, muir webs, and other
              models of relational structure — is reductive, but also
              expressive. It visualizes a fundamental armature of the
              discipline, however distasteful it might appear at times, and
              shows how highly impressionable social dynamics influence the
              shape of the profession at large.
            </p>
            <p>
              This dataset is deeply subjective and incomplete. If interested
              in contributing to the database, or sharing feedback on the
              methodology or representation, please reach out via{" "}
              <button type="button" className="info-email-link" onClick={handleCopyEmail}>
                {emailCopied ? "Copied to clipboard" : "info@architectureaffinities.com"}
              </button>.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterPanel({ edgeKindsOn, nodeKindsOn, activePreset, colorize, onToggleEdgeKind, onToggleNodeKind, onApplyPreset, onClose }) {
  return (
    <aside className="network-panel network-panel-left">
      <div className="network-panel-kindrow">
        <span className="network-panel-kind">Filters</span>
        <button type="button" className="network-panel-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="network-rel-group">
        <p className="network-rel-head">Relationships</p>
        <div className="network-filter-list">
          {Object.entries(EDGE_KIND).map(([kind, spec]) => {
            const on = edgeKindsOn.has(kind);
            return (
              <button
                type="button"
                key={kind}
                className={on ? "network-filter-toggle" : "network-filter-toggle off"}
                style={on && colorize ? { color: spec.color } : undefined}
                onClick={() => onToggleEdgeKind(kind)}
              >
                {spec.labelOut}
              </button>
            );
          })}
        </div>
      </div>

      <div className="network-rel-group">
        <p className="network-rel-head">Views</p>
        <div className="network-filter-list">
          {Object.entries(VIEW_PRESETS).map(([id, preset]) => (
            <button
              type="button"
              key={id}
              className={activePreset === id ? "network-filter-preset active" : "network-filter-preset"}
              onClick={() => onApplyPreset(id)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="network-rel-group">
        <p className="network-rel-head">Node Type</p>
        <div className="network-filter-list">
          {Object.entries(NODE_KIND).map(([kind, spec]) => {
            const on = nodeKindsOn.has(kind);
            return (
              <button
                type="button"
                key={kind}
                className={on ? "network-filter-toggle" : "network-filter-toggle off"}
                style={on && colorize && spec.color ? { color: spec.color } : undefined}
                onClick={() => onToggleNodeKind(kind)}
              >
                {spec.label}
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

function buildRelationshipGroups(node, links, nodeById) {
  const groups = new Map();
  for (const l of links) {
    const otherId = endpointId(l.source) === node.id ? endpointId(l.target) : endpointId(l.source);
    const other = nodeById.get(otherId);
    if (!other) continue;
    const outgoing = endpointId(l.source) === node.id;
    const spec = EDGE_KIND[l.kind];
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

function NodeDetailPanel({ node, links, nodeById, onSelect, onFocusNeighborhood, onCenter, onEdit, onClose }) {
  const groups = useMemo(() => buildRelationshipGroups(node, links, nodeById), [node, links, nodeById]);
  const houseLabels = (node.h || []).map((code) => HOUSE[code]).filter(Boolean);

  return (
    <aside className="network-panel">
      <div className="network-panel-kindrow">
        <span className="network-panel-kind">{NODE_KIND[node.k]?.label}</span>
        <button type="button" className="network-panel-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <p className="detail-heading">{node.n}</p>
      {node.l && <p className="network-panel-meta">{node.l}</p>}
      {node.t && <p className="network-panel-note">{node.t}</p>}
      {node.post && <p className="network-panel-post">{node.post}</p>}
      {(houseLabels.length > 0 || (node.a || []).length > 0) && (
        <p className="network-panel-tags">
          {[...houseLabels, ...(node.a || [])].join(" · ")}
        </p>
      )}

      {groups.map(([label, items]) => (
        <div className="network-rel-group" key={label}>
          <p className="network-rel-head">{label} · {items.length}</p>
          <div className="network-rel-list">
            {items.map((item) => (
              <button type="button" key={item.id} onClick={() => onSelect(item.id)}>
                {item.n}
              </button>
            ))}
          </div>
        </div>
      ))}

      <div className="network-panel-actions">
        <button type="button" className="link-btn" onClick={onFocusNeighborhood}>Focus Neighbourhood</button>
        <button type="button" className="link-btn" onClick={onCenter}>Centre</button>
        <button type="button" className="link-btn link-btn-edit" onClick={onEdit}>Edit</button>
      </div>
    </aside>
  );
}
