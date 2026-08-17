import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { forceSimulation, forceLink, forceManyBody, forceCollide, forceX, forceY } from "d3-force";
import { zoom as d3zoom, zoomIdentity } from "d3-zoom";
import { select, pointer } from "d3-selection";
import { buildNetworkGraph } from "../data/network.js";
import { useGraph } from "../hooks/useGraph.js";
import { NODE_KIND, EDGE_KIND, RELATIONSHIP_ORDER, HOUSE } from "../data/taxonomy.js";

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

export default function NetworkPage() {
  const rawGraph = useGraph();
  const canvasRef = useRef(null);
  const tooltipRef = useRef(null);
  const transformRef = useRef(zoomIdentity);
  const zoomBehaviorRef = useRef(null);
  const dragNodeRef = useRef(null);
  const downRef = useRef(null);

  const [selectedId, setSelectedId] = useState(null);
  const [kindFilter, setKindFilter] = useState(null);
  const selectedRef = useRef(null);
  const focusSetRef = useRef(null);
  const drawRef = useRef(null);

  const [settleProgress, setSettleProgress] = useState(0);
  const [settled, setSettled] = useState(false);

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

  const focusLinks = useMemo(() => {
    if (!selectedId || !graph) return [];
    return graph.links.filter(
      (l) => endpointId(l.source) === selectedId || endpointId(l.target) === selectedId
    );
  }, [graph, selectedId]);

  const focusSet = useMemo(() => {
    if (!graph) return null;
    if (kindFilter) {
      return new Set(graph.nodes.filter((n) => n.k === kindFilter).map((n) => n.id));
    }
    if (!selectedId) return null;
    const set = new Set([selectedId]);
    for (const l of focusLinks) {
      set.add(endpointId(l.source));
      set.add(endpointId(l.target));
    }
    return set;
  }, [selectedId, focusLinks, kindFilter, graph]);

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
        if (node.x == null) continue;
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
      ctx.save();
      ctx.clearRect(0, 0, W, H);
      ctx.translate(tf.x, tf.y);
      ctx.scale(tf.k, tf.k);

      const focus = focusSetRef.current;
      const labelAlpha = clamp((tf.k - LABEL_FADE_START_K) / (LABEL_FADE_END_K - LABEL_FADE_START_K), 0, 1);
      const labelWorldSize = taperedWorldSize(LABEL_FONT_SIZE, tf.k);

      for (const l of graph.links) {
        const s = nodeById.get(endpointId(l.source));
        const t = nodeById.get(endpointId(l.target));
        if (!s || !t || s.x == null || t.x == null) continue;
        const dimmed = focus && !(focus.has(s.id) && focus.has(t.id));
        const spec = EDGE_KIND[l.kind];
        ctx.globalAlpha = dimmed ? FOCUS_DIM_ALPHA : l.kind === "honor" ? 0.28 : l.kind === "principal" ? 0.4 : 0.55;
        ctx.strokeStyle = "#000";
        ctx.lineWidth = (spec?.weight || 1) / Math.max(0.6, tf.k);
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(t.x, t.y);
        ctx.stroke();
      }

      for (const node of graph.nodes) {
        if (node.x == null) continue;
        const r = taperedWorldSize(nodeRadius(node), tf.k);
        const dimmed = focus && !focus.has(node.id);
        ctx.globalAlpha = dimmed ? FOCUS_DIM_ALPHA : 1;

        traceNodeShape(ctx, node, node.x, node.y, r);
        ctx.lineWidth = (node.id === selectedRef.current ? 2.2 : 1.4) / tf.k;
        ctx.strokeStyle = "#000";
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

    function fitView() {
      if (graph.nodes.length === 0) return;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of graph.nodes) {
        if (n.x == null) continue;
        minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
        minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
      }
      const margin = 70;
      const boxW = Math.max(maxX - minX, 1) + margin * 2;
      const boxH = Math.max(maxY - minY, 1) + margin * 2;
      const k = clamp(Math.min(W / boxW, H / boxH), 0.1, 3);
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      const next = zoomIdentity.translate(W / 2 - cx * k, H / 2 - cy * k).scale(k);
      zoomBehaviorRef.current.transform(select(canvas), next);
    }

    let cancelled = false;
    function prewarm() {
      let n = 0;
      function chunk() {
        if (cancelled) return;
        for (let i = 0; i < 30 && n < TOTAL_PREWARM_TICKS; i++, n++) sim.tick();
        setSettleProgress(Math.round((100 * n) / TOTAL_PREWARM_TICKS));
        draw();
        if (n < TOTAL_PREWARM_TICKS) {
          requestAnimationFrame(chunk);
        } else {
          setSettled(true);
          fitView();
          sim.alpha(0.2).alphaTarget(0).restart();
          sim.on("tick", draw);
        }
      }
      requestAnimationFrame(chunk);
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
      setKindFilter(null);
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
      drawRef.current = null;
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
    // selectedId/focusSet intentionally excluded -- draw() reads them
    // through selectedRef/focusSetRef (kept in sync below) so a selection
    // change redraws without tearing down and re-settling the simulation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, nodeById]);

  useEffect(() => {
    selectedRef.current = selectedId;
    focusSetRef.current = focusSet;
    drawRef.current?.();
  }, [selectedId, focusSet]);

  function fitToScreen() {
    const canvas = canvasRef.current;
    if (!canvas || !zoomBehaviorRef.current || !graph) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of graph.nodes) {
      if (n.x == null) continue;
      minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
    }
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

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchWrapRef = useRef(null);
  const [infoOpen, setInfoOpen] = useState(false);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q || !graph) return [];
    return graph.nodes
      .filter((n) => n.n.toLowerCase().includes(q))
      .sort((a, b) => b.degree - a.degree)
      .slice(0, 8);
  }, [graph, searchQuery]);

  function selectFromSearch(id) {
    setSelectedId(id);
    setKindFilter(null);
    setSearchOpen(false);
    setSearchQuery("");
  }

  function toggleFilterFromLegend(kind) {
    setSelectedId(null);
    setKindFilter((current) => (current === kind ? null : kind));
  }

  useEffect(() => {
    if (!searchOpen) return;
    function onDown(e) {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target)) {
        setSearchOpen(false);
        setSearchQuery("");
      }
    }
    function onKeyDown(e) {
      if (e.key === "Escape") {
        setSearchOpen(false);
        setSearchQuery("");
      }
    }
    document.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
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
        <span className="network-wordmark">American Architecture — The Network</span>
      </div>

      <div className="network-topright">
        <div className="network-search" ref={searchWrapRef}>
          {searchOpen ? (
            <>
              <input
                type="text"
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search…"
                className="network-search-input"
                autoComplete="off"
              />
              {searchResults.length > 0 && (
                <div className="creatable-menu network-search-menu">
                  {searchResults.map((n) => (
                    <button
                      type="button"
                      key={n.id}
                      className="creatable-option"
                      onMouseDown={(e) => { e.preventDefault(); selectFromSearch(n.id); }}
                    >
                      {n.n}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <button type="button" className="link-btn" onClick={() => setSearchOpen(true)}>Search</button>
          )}
        </div>
        <Link className="link-btn" to="/admin">Admin</Link>
        <button type="button" className="link-btn" onClick={() => setInfoOpen(true)}>Info</button>
      </div>

      <button type="button" className="link-btn network-fit-btn" onClick={fitToScreen}>Fit to Screen</button>

      <div className="network-legend">
        {Object.entries(NODE_KIND).map(([kind, spec]) => (
          <LegendItem
            key={kind}
            shape={spec.shape}
            label={spec.label}
            active={kindFilter === kind}
            onClick={() => toggleFilterFromLegend(kind)}
          />
        ))}
      </div>

      {selectedNode && (
        <NodeDetailPanel
          node={selectedNode}
          links={focusLinks}
          nodeById={nodeById}
          onSelect={setSelectedId}
          onClose={() => setSelectedId(null)}
        />
      )}

      {infoOpen && (
        <div className="overlay network-info-overlay" onClick={(e) => { if (!e.target.closest("a, button")) setInfoOpen(false); }}>
          <button type="button" className="overlay-close overlay-close-floating" onClick={() => setInfoOpen(false)}>
            Close
          </button>
          <div className="info-content">
            <p>
              A map of American architectural lineage — who trained whom, who
              employed whom, who partnered with whom, who taught where, and
              who was recognised by which prizes and honours. Every person,
              practice, school, and prize is a node; every documented
              relationship between them is a line.
            </p>
            <p>
              Click a node to see its connections. Click a shape in the
              legend to isolate that kind. Search finds a name directly.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function LegendItem({ shape, label, onClick, active }) {
  const icon = (
    <svg width="12" height="12" viewBox="-8 -8 16 16" className="network-legend-icon" aria-hidden="true">
      {shape === "square" && <rect x="-5" y="-5" width="10" height="10" fill="none" stroke="#000" strokeWidth="1.3" />}
      {shape === "triangle" && <polygon points="0,-6 5.2,3 -5.2,3" fill="none" stroke="#000" strokeWidth="1.3" />}
      {shape === "diamond" && <polygon points="0,-6 6,0 0,6 -6,0" fill="none" stroke="#000" strokeWidth="1.3" />}
      {shape === "circle" && <circle cx="0" cy="0" r="4.4" fill="none" stroke="#000" strokeWidth="1.3" />}
    </svg>
  );

  return (
    <button type="button" className={active ? "network-legend-item active" : "network-legend-item"} onClick={onClick}>
      {icon}
      {label}
    </button>
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
  // Sort into RELATIONSHIP_ORDER, dropping empty groups; anything unknown
  // (shouldn't happen, but a bad edge kind shouldn't silently vanish)
  // falls through at the end.
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

function NodeDetailPanel({ node, links, nodeById, onSelect, onClose }) {
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
    </aside>
  );
}
