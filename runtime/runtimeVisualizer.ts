import * as fs from 'fs';
import * as path from 'path';
import { buildRuntimeGraphIndex } from './runtimeGraph';
import { RuntimeMap } from './types';

export type RuntimeVisualizerLayout = 'force' | 'dagre';

export interface RuntimeDashboardOptions {
    title?: string;
    interactive?: boolean;
    layout?: RuntimeVisualizerLayout;
    traceDepth?: number;
    hideIsolated?: boolean;
    maxRenderEdges?: number;
}

export function generateRuntimeDashboard(runtimeMapPath: string, outputPath: string, options: RuntimeDashboardOptions = {}) {
    const startedAt = Date.now();
    const runtimeMap = JSON.parse(fs.readFileSync(runtimeMapPath, 'utf-8')) as RuntimeMap;
    const graphIndex = buildRuntimeGraphIndex(runtimeMap);
    const dashboardOptions = normalizeRuntimeDashboardOptions(options);
    const html = renderRuntimeDashboard(
        runtimeMap,
        graphIndex.edges.length,
        dashboardOptions,
        options.title ?? `TriadMind Runtime Topology - ${runtimeMap.project}`
    );

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, html, 'utf-8');
    console.log(
        `[TriadMind] Runtime visualizer mode: interactive=${dashboardOptions.interactive} layout=${dashboardOptions.layout} view=${runtimeMap.view ?? 'full'} nodes=${runtimeMap.nodes.length} edges=${runtimeMap.edges.length} diagnostics=${(runtimeMap.diagnostics ?? []).length}`
    );
    if (graphIndex.edges.length > dashboardOptions.maxRenderEdges) {
        console.log(
            `[TriadMind] Runtime visualizer edge cap active: ${dashboardOptions.maxRenderEdges}/${graphIndex.edges.length}`
        );
    }
    console.log(`[TriadMind] Runtime dashboard generated in ${Date.now() - startedAt}ms`);
}

function normalizeRuntimeDashboardOptions(options: RuntimeDashboardOptions): Required<Omit<RuntimeDashboardOptions, 'title'>> {
    return {
        interactive: options.interactive ?? true,
        layout: options.layout === 'force' || options.layout === 'dagre' ? options.layout : 'dagre',
        traceDepth: normalizePositiveInteger(options.traceDepth, 2),
        hideIsolated: options.hideIsolated ?? false,
        maxRenderEdges: normalizePositiveInteger(options.maxRenderEdges, 2000)
    };
}

function renderRuntimeDashboard(
    runtimeMap: RuntimeMap,
    normalizedEdgeCount: number,
    options: Required<Omit<RuntimeDashboardOptions, 'title'>>,
    title: string
) {
    const payload = JSON.stringify(runtimeMap).replace(/</g, '\\u003c');
    const optionPayload = JSON.stringify(options).replace(/</g, '\\u003c');
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: dark; --bg:#090f1f; --panel:#111a30; --panel2:#15203a; --line:#29385f; --text:#e9f0ff; --muted:#91a4c8; --accent:#69b7ff; font-family: Inter, Segoe UI, Arial, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); overflow: hidden; }
    .app { display: grid; grid-template-columns: 1fr 390px; grid-template-rows: auto 1fr; height: 100vh; }
    .toolbar { grid-column: 1 / 3; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 10px 14px; border-bottom: 1px solid var(--line); background: #0d162b; }
    .toolbar h1 { font-size: 16px; margin: 0 12px 0 0; white-space: nowrap; }
    .toolbar input, .toolbar select, .toolbar button { background: var(--panel2); color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 7px 9px; }
    .toolbar input { width: 280px; }
    .toolbar button { cursor: pointer; }
    .toolbar button:hover { border-color: var(--accent); }
    .graph-wrap { position: relative; min-width: 0; min-height: 0; }
    .graph { width: 100%; height: 100%; display: block; background: radial-gradient(circle at 20% 10%, #132447 0, transparent 32%), #090f1f; cursor: grab; }
    .graph.dragging { cursor: grabbing; }
    .sidebar { border-left: 1px solid var(--line); background: var(--panel); overflow: auto; padding: 14px; }
    .section { border: 1px solid var(--line); background: rgba(255,255,255,0.025); border-radius: 12px; padding: 10px; margin-bottom: 12px; }
    .section h2, .section h3 { margin: 0 0 8px; font-size: 14px; }
    .summary { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { background: var(--panel2); border: 1px solid var(--line); color: var(--muted); padding: 5px 8px; border-radius: 999px; font-size: 12px; }
    .filters { display: grid; gap: 6px; max-height: 220px; overflow: auto; }
    .check { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12px; }
    .detail-kv { display: grid; grid-template-columns: 92px 1fr; gap: 5px; font-size: 12px; line-height: 1.45; }
    .detail-kv b { color: var(--muted); font-weight: 500; }
    pre { white-space: pre-wrap; word-break: break-word; background: #0b1224; border: 1px solid var(--line); border-radius: 8px; padding: 8px; color: #dce8ff; font-size: 12px; max-height: 260px; overflow: auto; }
    .node-shape { stroke-width: 1.5; cursor: pointer; filter: drop-shadow(0 4px 8px rgba(0,0,0,.25)); }
    .node-label { fill: #eff6ff; font-size: 11px; pointer-events: none; text-anchor: middle; dominant-baseline: central; }
    .node-sub { fill: #a8b8d8; font-size: 9px; pointer-events: none; text-anchor: middle; dominant-baseline: central; }
    .edge-line { fill: none; stroke-width: 2; marker-end: url(#arrow); cursor: pointer; }
    .edge-hit { fill: none; stroke: transparent; stroke-width: 12; cursor: pointer; }
    .edge-label { fill: #c7d7f5; font-size: 9px; pointer-events: none; text-anchor: middle; paint-order: stroke; stroke: #081020; stroke-width: 3px; }
    .dim { opacity: .12; }
    .highlight .node-shape { stroke: #ffffff; stroke-width: 3; }
    .trace .node-shape { stroke: #facc15; stroke-width: 3; }
    .selected .node-shape { stroke: #38bdf8; stroke-width: 4; }
    .edge-highlight { stroke-width: 4; }
    .edge-trace { stroke: #facc15 !important; stroke-width: 4; }
    .notice { position: absolute; left: 14px; bottom: 14px; background: rgba(10,18,34,.86); border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; color: var(--muted); font-size: 12px; max-width: 560px; }
    @media (max-width: 1100px) { .app { grid-template-columns: 1fr; } .toolbar { grid-column: 1; } .sidebar { display: none; } }
  </style>
</head>
<body>
  <div class="app" data-runtime-visualizer-version="2">
    <div class="toolbar" id="runtime-toolbar">
      <h1>${escapeHtml(runtimeMap.project)} runtime graph</h1>
      <input id="search-input" placeholder="Search id / label / type / sourcePath" />
      <label>Layout <select id="layout-select"><option value="dagre">dagre</option><option value="force">force</option></select></label>
      <label>Depth <input id="trace-depth" type="number" min="1" max="8" value="${options.traceDepth}" style="width:64px" /></label>
      <button id="trace-upstream">Upstream</button>
      <button id="trace-downstream">Downstream</button>
      <button id="trace-both">Both</button>
      <label class="check"><input id="hide-isolated" type="checkbox" ${options.hideIsolated ? 'checked' : ''}/> Hide isolated</label>
      <button id="reset-view">Reset</button>
      <button id="fit-view">Fit</button>
    </div>
    <main class="graph-wrap">
      <svg id="runtime-graph" class="graph" role="img" aria-label="Interactive runtime topology graph">
        <defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="#7aa2df"></path></marker></defs>
        <g id="viewport"><g id="edges-layer"></g><g id="edge-labels-layer"></g><g id="nodes-layer"></g></g>
      </svg>
      <div class="notice" id="graph-notice">Interactive runtime topology v2. Drag canvas to pan, wheel to zoom, click nodes/edges to inspect, double-click a node to lock its 1-hop subgraph.</div>
    </main>
    <aside class="sidebar">
      <div class="section">
        <h2>Runtime Map</h2>
        <div class="summary">
          <span class="chip">view: ${escapeHtml(runtimeMap.view ?? 'full')}</span>
          <span class="chip">nodes: ${runtimeMap.nodes.length}</span>
          <span class="chip">edges: ${runtimeMap.edges.length}</span>
          <span class="chip">normalized edges: ${normalizedEdgeCount}</span>
          <span class="chip">diagnostics: ${(runtimeMap.diagnostics ?? []).length}</span>
        </div>
      </div>
      <div class="section">
        <h3>Node Types</h3>
        <div id="node-type-filters" class="filters"></div>
      </div>
      <div class="section">
        <h3>Edge Types</h3>
        <div id="edge-type-filters" class="filters"></div>
      </div>
      <div class="section">
        <h3 id="detail-title">Select a node or edge</h3>
        <div id="detail-body" class="detail-kv"><b>Hint</b><span>Click a node to highlight 1-hop links. Click an edge for evidence.</span></div>
      </div>
    </aside>
  </div>
  <script>
    const runtimeMap = ${payload};
    const dashboardOptions = ${optionPayload};
${buildInteractiveScript()}
  </script>
</body>
</html>`;
}

function buildInteractiveScript() {
    return String.raw`
const EDGE_COLORS = { calls:'#5bc0eb', invokes:'#9bc53d', dispatches:'#f6c85f', enqueues:'#f25f5c', consumes:'#ff7f51', reads:'#ffe066', writes:'#ff9f1c', caches:'#c77dff', executes:'#2ec4b6', contains:'#6c8ef5', connects:'#8d99ae', uses_tool:'#ef476f', uses_model:'#06d6a0', depends_on:'#94a3b8' };
const NODE_COLORS = { FrontendEntry:'#4cc9f0', FrontendComponent:'#4cc9f0', ApiRoute:'#38bdf8', Service:'#22c55e', Workflow:'#a78bfa', WorkflowNode:'#c084fc', WorkflowEdge:'#d8b4fe', Worker:'#f59e0b', Task:'#fb923c', Queue:'#f97316', DataStore:'#14b8a6', ObjectStore:'#2dd4bf', Cache:'#84cc16', FileSystem:'#eab308', ExternalApi:'#f43f5e', ExternalTool:'#fb7185', ModelProvider:'#06d6a0', Config:'#64748b', Secret:'#ef4444', UnknownRuntime:'#94a3b8' };
const state = { layout: dashboardOptions.layout, query: '', selectedNodeId: null, selectedEdgeId: null, focusNodeId: null, trace: null, hideIsolated: dashboardOptions.hideIsolated, activeNodeTypes: new Set(), activeEdgeTypes: new Set(), transform: { x: 0, y: 0, k: 1 }, positions: new Map(), draggingNodeId: null, layoutDirty: true };
const svg = document.getElementById('runtime-graph');
const viewport = document.getElementById('viewport');
const nodesLayer = document.getElementById('nodes-layer');
const edgesLayer = document.getElementById('edges-layer');
const edgeLabelsLayer = document.getElementById('edge-labels-layer');
const detailTitle = document.getElementById('detail-title');
const detailBody = document.getElementById('detail-body');
const notice = document.getElementById('graph-notice');
const normalized = normalizeRuntimeMap(runtimeMap);
const index = buildIndex(normalized);
const allNodeTypes = Array.from(new Set(normalized.nodes.map(node => node.type))).sort();
const allEdgeTypes = Array.from(new Set(normalized.edges.map(edge => edge.type))).sort();
allNodeTypes.forEach(type => state.activeNodeTypes.add(type));
allEdgeTypes.forEach(type => state.activeEdgeTypes.add(type));
setupControls();
render();
fitViewSoon();

function normalizeRuntimeMap(map) {
  const nodeIds = new Set((map.nodes || []).map(node => node.id));
  const edges = (map.edges || []).filter(edge => nodeIds.has(edge.from) && nodeIds.has(edge.to)).map(edge => ({ ...edge, id: edge.id || stableEdgeId(edge) }));
  return { ...map, nodes: map.nodes || [], edges };
}
function stableEdgeId(edge) { return 'RuntimeEdge.' + [edge.from, edge.type, edge.to].join('.').replace(/[^\w./:{}-]+/g, '_'); }
function buildIndex(map) {
  const nodeById = new Map(map.nodes.map(node => [node.id, node]));
  const edgeById = new Map(map.edges.map(edge => [edge.id, edge]));
  const incoming = new Map(); const outgoing = new Map();
  map.nodes.forEach(node => { incoming.set(node.id, []); outgoing.set(node.id, []); });
  map.edges.forEach(edge => { outgoing.get(edge.from)?.push(edge); incoming.get(edge.to)?.push(edge); });
  return { nodeById, edgeById, incoming, outgoing };
}
function setupControls() {
  document.getElementById('layout-select').value = state.layout;
  document.getElementById('layout-select').addEventListener('change', event => { state.layout = event.target.value; state.positions = new Map(); state.layoutDirty = true; render(); });
  document.getElementById('search-input').addEventListener('input', event => { state.query = event.target.value.trim().toLowerCase(); state.layoutDirty = true; render(); });
  document.getElementById('hide-isolated').addEventListener('change', event => { state.hideIsolated = event.target.checked; state.layoutDirty = true; render(); });
  document.getElementById('trace-upstream').addEventListener('click', () => runTrace('upstream'));
  document.getElementById('trace-downstream').addEventListener('click', () => runTrace('downstream'));
  document.getElementById('trace-both').addEventListener('click', () => runTrace('both'));
  document.getElementById('reset-view').addEventListener('click', () => { state.selectedNodeId = null; state.selectedEdgeId = null; state.focusNodeId = null; state.trace = null; state.layoutDirty = true; showWelcome(); render(); });
  document.getElementById('fit-view').addEventListener('click', fitView);
  buildFilterControls('node-type-filters', allNodeTypes, state.activeNodeTypes);
  buildFilterControls('edge-type-filters', allEdgeTypes, state.activeEdgeTypes);
  setupPanZoom();
}
function buildFilterControls(containerId, items, activeSet) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  items.forEach(item => {
    const id = containerId + '-' + item;
    const label = document.createElement('label');
    label.className = 'check';
    label.innerHTML = '<input id="' + escAttr(id) + '" type="checkbox" checked /> <span>' + esc(item) + '</span>';
    label.querySelector('input').addEventListener('change', event => { event.target.checked ? activeSet.add(item) : activeSet.delete(item); state.layoutDirty = true; render(); });
    container.appendChild(label);
  });
}
function currentDepth() { return Math.max(1, Math.min(8, Number(document.getElementById('trace-depth').value || dashboardOptions.traceDepth || 2))); }
function runTrace(direction) {
  const startId = state.selectedNodeId || state.focusNodeId;
  if (!startId) { notice.textContent = 'Select a node before tracing.'; return; }
  const hadFocusNode = Boolean(state.focusNodeId);
  state.trace = traceGraph(startId, direction, currentDepth());
  state.focusNodeId = null;
  if (hadFocusNode) state.layoutDirty = true;
  notice.textContent = direction + ' trace depth=' + currentDepth() + ': ' + state.trace.nodeIds.size + ' nodes / ' + state.trace.edgeIds.size + ' edges';
  render();
}
function traceGraph(startId, direction, depth) {
  const nodeIds = new Set([startId]);
  const edgeIds = new Set();
  const queue = [{ nodeId: startId, depth: 0 }];
  const seen = new Set([startId + ':0']);
  while (queue.length) {
    const current = queue.shift();
    if (current.depth >= depth) continue;
    const edges = direction === 'upstream' ? (index.incoming.get(current.nodeId) || []) : direction === 'downstream' ? (index.outgoing.get(current.nodeId) || []) : [...(index.incoming.get(current.nodeId) || []), ...(index.outgoing.get(current.nodeId) || [])];
    edges.forEach(edge => {
      const next = edge.from === current.nodeId ? edge.to : edge.from;
      edgeIds.add(edge.id); nodeIds.add(edge.from); nodeIds.add(edge.to);
      const key = next + ':' + (current.depth + 1);
      if (!seen.has(key)) { seen.add(key); queue.push({ nodeId: next, depth: current.depth + 1 }); }
    });
  }
  return { nodeIds, edgeIds, direction, depth };
}
function getVisibleGraph() {
  let nodes = normalized.nodes.filter(node => state.activeNodeTypes.has(node.type) && matchesQuery(node));
  let allowedNodeIds = new Set(nodes.map(node => node.id));
  let edges = normalized.edges.filter(edge => allowedNodeIds.has(edge.from) && allowedNodeIds.has(edge.to) && state.activeEdgeTypes.has(edge.type));
  if (state.focusNodeId) {
    const focus = traceGraph(state.focusNodeId, 'both', 1);
    nodes = nodes.filter(node => focus.nodeIds.has(node.id));
    allowedNodeIds = new Set(nodes.map(node => node.id));
    edges = edges.filter(edge => focus.edgeIds.has(edge.id) && allowedNodeIds.has(edge.from) && allowedNodeIds.has(edge.to));
  }
  if (state.hideIsolated) {
    const connected = new Set();
    edges.forEach(edge => { connected.add(edge.from); connected.add(edge.to); });
    nodes = nodes.filter(node => connected.has(node.id));
  }
  if (edges.length > dashboardOptions.maxRenderEdges) {
    edges = edges.slice(0, dashboardOptions.maxRenderEdges);
    notice.textContent = 'Edge cap active: rendering first ' + edges.length + ' edges. Use filters/search to narrow the graph.';
  }
  return { nodes, edges };
}
function matchesQuery(node) {
  if (!state.query) return true;
  return [node.id, node.label, node.type, node.sourcePath || '', node.framework || ''].join(' ').toLowerCase().includes(state.query);
}
function render() {
  const graph = getVisibleGraph();
  if (state.layoutDirty) {
    computeLayout(graph.nodes, graph.edges);
    state.layoutDirty = false;
  }
  applyTransform();
  edgesLayer.innerHTML = ''; edgeLabelsLayer.innerHTML = ''; nodesLayer.innerHTML = '';
  const highlighted = buildHighlightSets();
  graph.edges.forEach(edge => renderEdge(edge, highlighted));
  graph.nodes.forEach(node => renderNode(node, highlighted));
}
function buildHighlightSets() {
  const nodes = new Set(); const edges = new Set(); const traceNodes = new Set(); const traceEdges = new Set();
  if (state.selectedNodeId) {
    nodes.add(state.selectedNodeId);
    [...(index.incoming.get(state.selectedNodeId) || []), ...(index.outgoing.get(state.selectedNodeId) || [])].forEach(edge => { edges.add(edge.id); nodes.add(edge.from); nodes.add(edge.to); });
  }
  if (state.selectedEdgeId) {
    const edge = index.edgeById.get(state.selectedEdgeId);
    if (edge) { edges.add(edge.id); nodes.add(edge.from); nodes.add(edge.to); }
  }
  if (state.trace) { state.trace.nodeIds.forEach(id => traceNodes.add(id)); state.trace.edgeIds.forEach(id => traceEdges.add(id)); }
  return { nodes, edges, traceNodes, traceEdges, hasFocus: Boolean(state.selectedNodeId || state.selectedEdgeId || state.trace) };
}
function renderNode(node, highlighted) {
  const pos = state.positions.get(node.id) || { x: 0, y: 0 };
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const isSelected = state.selectedNodeId === node.id;
  const isTrace = highlighted.traceNodes.has(node.id);
  const isHighlight = highlighted.nodes.has(node.id);
  g.setAttribute('class', 'runtime-node' + (isSelected ? ' selected' : '') + (isTrace ? ' trace' : '') + (isHighlight ? ' highlight' : '') + (highlighted.hasFocus && !isHighlight && !isTrace ? ' dim' : ''));
  g.setAttribute('transform', 'translate(' + pos.x + ',' + pos.y + ')');
  g.dataset.nodeId = node.id;
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('class', 'node-shape');
  rect.setAttribute('x', '-70'); rect.setAttribute('y', '-24'); rect.setAttribute('rx', '12'); rect.setAttribute('width', '140'); rect.setAttribute('height', '48');
  rect.setAttribute('fill', NODE_COLORS[node.type] || '#64748b');
  rect.setAttribute('stroke', '#1e293b');
  const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  label.setAttribute('class', 'node-label'); label.setAttribute('y', '-5'); label.textContent = truncate(node.label || node.id, 24);
  const sub = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  sub.setAttribute('class', 'node-sub'); sub.setAttribute('y', '12'); sub.textContent = node.type;
  g.append(rect, label, sub);
  g.addEventListener('click', event => { event.stopPropagation(); selectNode(node.id); });
  g.addEventListener('dblclick', event => { event.stopPropagation(); state.focusNodeId = node.id; state.selectedNodeId = node.id; state.selectedEdgeId = null; state.trace = null; state.layoutDirty = true; showNodeDetail(node); render(); });
  g.addEventListener('pointerdown', event => startNodeDrag(event, node.id));
  nodesLayer.appendChild(g);
}
function renderEdge(edge, highlighted) {
  const from = state.positions.get(edge.from); const to = state.positions.get(edge.to);
  if (!from || !to) return;
  const points = edgePoints(from, to);
  const color = EDGE_COLORS[edge.type] || '#7aa2df';
  const isTrace = highlighted.traceEdges.has(edge.id);
  const isHighlight = highlighted.edges.has(edge.id) || state.selectedEdgeId === edge.id;
  const pathD = 'M' + points.x1 + ',' + points.y1 + ' L' + points.x2 + ',' + points.y2;
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  line.setAttribute('class', 'edge-line' + (isTrace ? ' edge-trace' : '') + (isHighlight ? ' edge-highlight' : '') + (highlighted.hasFocus && !isHighlight && !isTrace ? ' dim' : ''));
  line.setAttribute('d', pathD); line.setAttribute('stroke', color);
  const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  hit.setAttribute('class', 'edge-hit'); hit.setAttribute('d', pathD);
  hit.addEventListener('click', event => { event.stopPropagation(); selectEdge(edge.id); });
  const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  label.setAttribute('class', 'edge-label' + (highlighted.hasFocus && !isHighlight && !isTrace ? ' dim' : ''));
  label.setAttribute('x', String((points.x1 + points.x2) / 2)); label.setAttribute('y', String((points.y1 + points.y2) / 2 - 4));
  label.textContent = edge.type + (edge.confidence !== undefined ? ' ' + Number(edge.confidence).toFixed(2) : '');
  edgesLayer.append(line, hit); edgeLabelsLayer.appendChild(label);
}
function edgePoints(from, to) {
  const dx = to.x - from.x; const dy = to.y - from.y; const len = Math.max(1, Math.sqrt(dx*dx + dy*dy));
  const ox = dx / len * 72; const oy = dy / len * 28;
  return { x1: from.x + ox, y1: from.y + oy, x2: to.x - ox, y2: to.y - oy };
}
function selectNode(nodeId) {
  state.selectedNodeId = nodeId; state.selectedEdgeId = null; state.trace = null; state.focusNodeId = null;
  showNodeDetail(index.nodeById.get(nodeId)); render();
}
function selectEdge(edgeId) {
  state.selectedEdgeId = edgeId; state.selectedNodeId = null; state.trace = null; state.focusNodeId = null;
  showEdgeDetail(index.edgeById.get(edgeId)); render();
}
function showNodeDetail(node) {
  if (!node) return;
  const incoming = index.incoming.get(node.id) || []; const outgoing = index.outgoing.get(node.id) || [];
  detailTitle.textContent = node.label || node.id;
  detailBody.innerHTML = kv({ id: node.id, type: node.type, sourcePath: node.sourcePath || '-', framework: node.framework || '-', incoming: incoming.length, outgoing: outgoing.length }) + '<h3>Metadata</h3><pre>' + esc(JSON.stringify(node.metadata || {}, null, 2)) + '</pre><h3>Evidence</h3>' + renderEvidence(node.evidence || []);
}
function showEdgeDetail(edge) {
  if (!edge) return;
  detailTitle.textContent = edge.type + ': ' + edge.from + ' → ' + edge.to;
  detailBody.innerHTML = kv({ id: edge.id, from: edge.from, to: edge.to, type: edge.type, confidence: edge.confidence ?? '-', label: edge.label || '-' }) + '<h3>Evidence</h3>' + renderEvidence(edge.evidence || []) + '<h3>Metadata</h3><pre>' + esc(JSON.stringify(edge.metadata || {}, null, 2)) + '</pre>';
}
function renderEvidence(evidence) {
  if (!evidence.length) return '<div class="chip">No evidence recorded</div>';
  return evidence.map(item => '<pre>' + esc([item.sourcePath || '-', item.line ? 'line ' + item.line : '', item.kind || 'unknown', item.text || ''].filter(Boolean).join('\n')) + '</pre>').join('');
}
function kv(value) { return '<div class="detail-kv">' + Object.entries(value).map(([k,v]) => '<b>' + esc(k) + '</b><span>' + esc(String(v)) + '</span>').join('') + '</div>'; }
function showWelcome() { detailTitle.textContent = 'Select a node or edge'; detailBody.innerHTML = '<b>Hint</b><span>Click a node to highlight 1-hop links. Click an edge for evidence.</span>'; }
function computeLayout(nodes, edges) {
  if (!nodes.length) return;
  if (state.layout === 'force') {
    computeForceLayout(nodes, edges);
    return;
  }
  computeDagreLayout(nodes, edges);
}
function computeDagreLayout(nodes, edges) {
  const ids = new Set(nodes.map(node => node.id));
  const indegree = new Map(nodes.map(node => [node.id, 0]));
  const outgoing = new Map(nodes.map(node => [node.id, []]));
  edges.forEach(edge => { if (ids.has(edge.from) && ids.has(edge.to)) { indegree.set(edge.to, (indegree.get(edge.to) || 0) + 1); outgoing.get(edge.from).push(edge.to); } });
  const layer = new Map(); const queue = [];
  indegree.forEach((degree, id) => { if (degree === 0) { layer.set(id, 0); queue.push(id); } });
  if (!queue.length && nodes.length) { layer.set(nodes[0].id, 0); queue.push(nodes[0].id); }
  while (queue.length) {
    const id = queue.shift(); const nextLayer = (layer.get(id) || 0) + 1;
    outgoing.get(id).forEach(next => { if ((layer.get(next) ?? -1) < nextLayer) layer.set(next, nextLayer); indegree.set(next, (indegree.get(next) || 0) - 1); if ((indegree.get(next) || 0) <= 0) queue.push(next); });
  }
  nodes.forEach(node => { if (!layer.has(node.id)) layer.set(node.id, 0); });
  const lanes = new Map();
  nodes.forEach(node => { const level = layer.get(node.id) || 0; const items = lanes.get(level) || []; items.push(node); lanes.set(level, items); });
  lanes.forEach((items, level) => items.sort((a,b) => a.label.localeCompare(b.label)).forEach((node, index) => state.positions.set(node.id, { x: 120 + level * 260, y: 90 + index * 90 })));
}
function computeForceLayout(nodes, edges) {
  if (state.positions.size === 0) computeDagreLayout(nodes, edges);
  const ids = new Set(nodes.map(node => node.id));
  const iterations = nodes.length > 500 ? 25 : 70;
  for (let iter = 0; iter < iterations; iter++) {
    const delta = new Map(nodes.map(node => [node.id, { x: 0, y: 0 }]));
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = state.positions.get(nodes[i].id), b = state.positions.get(nodes[j].id); if (!a || !b) continue;
      const dx = a.x - b.x, dy = a.y - b.y, dist2 = Math.max(100, dx*dx + dy*dy), force = 5500 / dist2;
      delta.get(nodes[i].id).x += dx * force; delta.get(nodes[i].id).y += dy * force; delta.get(nodes[j].id).x -= dx * force; delta.get(nodes[j].id).y -= dy * force;
    }
    edges.forEach(edge => { if (!ids.has(edge.from) || !ids.has(edge.to)) return; const a = state.positions.get(edge.from), b = state.positions.get(edge.to); const da = delta.get(edge.from), db = delta.get(edge.to); if (!a || !b || !da || !db) return; const dx = b.x-a.x, dy = b.y-a.y, dist = Math.max(1, Math.sqrt(dx*dx+dy*dy)), force = (dist - 220) * 0.012; da.x += dx/dist*force; da.y += dy/dist*force; db.x -= dx/dist*force; db.y -= dy/dist*force; });
    nodes.forEach(node => { const p = state.positions.get(node.id), d = delta.get(node.id); if (p && d) state.positions.set(node.id, { x: p.x + Math.max(-8, Math.min(8, d.x)), y: p.y + Math.max(-8, Math.min(8, d.y)) }); });
  }
}
function setupPanZoom() {
  let panning = false; let last = null;
  svg.addEventListener('pointerdown', event => { if (event.target.closest && event.target.closest('.runtime-node')) return; panning = true; last = { x: event.clientX, y: event.clientY }; svg.classList.add('dragging'); });
  window.addEventListener('pointermove', event => { if (state.draggingNodeId) return dragNode(event); if (!panning || !last) return; state.transform.x += event.clientX - last.x; state.transform.y += event.clientY - last.y; last = { x: event.clientX, y: event.clientY }; applyTransform(); });
  window.addEventListener('pointerup', () => { panning = false; state.draggingNodeId = null; svg.classList.remove('dragging'); });
  svg.addEventListener('wheel', event => { event.preventDefault(); const scale = event.deltaY > 0 ? 0.9 : 1.1; state.transform.k = Math.max(0.15, Math.min(3, state.transform.k * scale)); applyTransform(); }, { passive: false });
  svg.addEventListener('click', event => { if (event.target === svg) { state.selectedNodeId = null; state.selectedEdgeId = null; state.trace = null; state.focusNodeId = null; state.layoutDirty = true; showWelcome(); render(); } });
}
function startNodeDrag(event, nodeId) { state.draggingNodeId = nodeId; event.stopPropagation(); }
function dragNode(event) {
  const nodeId = state.draggingNodeId; if (!nodeId) return;
  const pt = clientToGraph(event.clientX, event.clientY);
  state.positions.set(nodeId, pt); render();
}
function clientToGraph(clientX, clientY) {
  const rect = svg.getBoundingClientRect();
  return { x: (clientX - rect.left - state.transform.x) / state.transform.k, y: (clientY - rect.top - state.transform.y) / state.transform.k };
}
function applyTransform() { viewport.setAttribute('transform', 'translate(' + state.transform.x + ',' + state.transform.y + ') scale(' + state.transform.k + ')'); }
function fitViewSoon() { setTimeout(fitView, 40); }
function fitView() {
  const graph = getVisibleGraph(); if (!graph.nodes.length) return;
  const xs = graph.nodes.map(node => state.positions.get(node.id)?.x || 0), ys = graph.nodes.map(node => state.positions.get(node.id)?.y || 0);
  const minX = Math.min(...xs) - 140, maxX = Math.max(...xs) + 140, minY = Math.min(...ys) - 90, maxY = Math.max(...ys) + 90;
  const rect = svg.getBoundingClientRect();
  const k = Math.max(0.15, Math.min(1.5, Math.min(rect.width / Math.max(1, maxX-minX), rect.height / Math.max(1, maxY-minY))));
  state.transform.k = k; state.transform.x = (rect.width - (minX + maxX) * k) / 2; state.transform.y = (rect.height - (minY + maxY) * k) / 2; applyTransform();
}
function truncate(value, max) { value = String(value || ''); return value.length > max ? value.slice(0, max - 1) + '…' : value; }
function esc(value) { return String(value ?? '').replace(/[&<>"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[char])); }
function escAttr(value) { return esc(value).replace(/'/g, '&#39;'); }
`;
}

function normalizePositiveInteger(value: number | undefined, fallback: number) {
    return Number.isFinite(value) && (value as number) > 0 ? Math.floor(value as number) : fallback;
}

function escapeHtml(value: string) {
    return value.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char] ?? char));
}
