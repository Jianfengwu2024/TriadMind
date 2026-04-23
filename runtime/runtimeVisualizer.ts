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
    :root { color-scheme: dark; --bg:#0f0f1a; --panel:#1a1a2e; --panel2:#0f172a; --line:#2a2a4e; --line2:#334155; --text:#e2e8f0; --muted:#94a3b8; --accent:#38bdf8; font-family: Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: var(--bg); color: var(--text); display: flex; height: 100vh; overflow: hidden; }
    .app { display: flex; flex: 1; min-width: 0; }
    .graph-wrap { position: relative; flex: 1; min-width: 0; background: radial-gradient(circle at 22% 12%, rgba(56,189,248,.16) 0, transparent 34%), #0f0f1a; }
    .graph { width: 100%; height: 100%; display: block; cursor: grab; }
    .graph.dragging { cursor: grabbing; }
    .toolbar { position: absolute; top: 14px; left: 14px; z-index: 20; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; background: rgba(15,23,42,.92); border: 1px solid var(--line2); border-radius: 12px; padding: 10px; box-shadow: 0 12px 28px rgba(0,0,0,.28); max-width: calc(100% - 28px); }
    .toolbar h1 { font-size: 12px; color: #7dd3fc; letter-spacing: .04em; text-transform: uppercase; margin-right: 6px; white-space: nowrap; }
    .toolbar input, .toolbar select, .toolbar button { background: #111827; color: var(--text); border: 1px solid var(--line2); border-radius: 999px; padding: 7px 10px; font-size: 12px; }
    .toolbar input { width: 240px; border-radius: 8px; }
    .toolbar button { cursor: pointer; }
    .toolbar button:hover, .toolbar input:focus, .toolbar select:focus { border-color: var(--accent); outline: none; }
    .sidebar { width: 390px; background: var(--panel); border-left: 1px solid var(--line); display: flex; flex-direction: column; overflow: auto; }
    .section { padding: 14px; border-bottom: 1px solid var(--line); }
    .section h2 { font-size: 18px; margin-bottom: 8px; color: #f8fafc; }
    .section h3 { font-size: 12px; color: #a5b4fc; margin-bottom: 8px; text-transform: uppercase; letter-spacing: .05em; }
    .eyebrow { color: var(--accent); font-size: 11px; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 8px; }
    .desc { color: #cbd5e1; font-size: 12px; line-height: 1.5; margin-bottom: 10px; }
    .summary { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { background: #111827; border: 1px solid var(--line2); color: var(--muted); padding: 4px 8px; border-radius: 999px; font-size: 11px; }
    .filters { display: grid; gap: 6px; max-height: 210px; overflow: auto; }
    .check { display: flex; align-items: center; gap: 6px; color: #cbd5e1; font-size: 12px; line-height: 1.4; }
    .check input { accent-color: var(--accent); }
    .status-row { display: flex; align-items: center; gap: 8px; color: #cbd5e1; font-size: 12px; padding: 3px 0; line-height: 1.45; }
    .status-dot { width: 12px; height: 12px; border-radius: 999px; display: inline-block; border: 2px solid currentColor; flex-shrink: 0; }
    .status-selected { color: #38bdf8; background: #082f49; box-shadow: 0 0 14px rgba(56,189,248,.5); }
    .status-hop { color: #f8fafc; background: #1f2937; }
    .status-trace { color: #facc15; background: #3f2b0a; box-shadow: 0 0 14px rgba(250,204,21,.38); }
    .legend-hint { color: var(--muted); font-size: 11px; line-height: 1.5; margin-top: 8px; }
    .legend-item { display: grid; grid-template-columns: auto auto 1fr auto; align-items: center; gap: 8px; padding: 5px 4px; border-radius: 6px; cursor: pointer; font-size: 12px; color: #cbd5e1; }
    .legend-item:hover { background: rgba(71,85,105,.24); }
    .legend-item.dimmed { opacity: .45; }
    .legend-item input { margin: 0; accent-color: var(--accent); }
    .legend-dot { width: 12px; height: 12px; border-radius: 50%; border: 1px solid rgba(226,232,240,.45); flex-shrink: 0; }
    .legend-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .legend-count { color: #94a3b8; font-size: 11px; }
    .detail-kv { display: grid; grid-template-columns: 92px 1fr; gap: 6px; font-size: 12px; line-height: 1.45; }
    .detail-kv b { color: var(--muted); font-weight: 500; }
    pre { white-space: pre-wrap; word-break: break-word; background: #0b1224; border: 1px solid var(--line2); border-radius: 8px; padding: 8px; color: #dce8ff; font-size: 12px; max-height: 250px; overflow: auto; margin-top: 6px; }
    .node-shape { stroke-width: 1.4; cursor: pointer; filter: drop-shadow(0 3px 8px rgba(0,0,0,.28)); }
    .node-label { fill: #eff6ff; font-size: 11px; font-weight: 600; pointer-events: none; text-anchor: middle; dominant-baseline: central; }
    .node-sub { fill: #dbeafe; font-size: 9px; pointer-events: none; text-anchor: middle; dominant-baseline: central; opacity: .8; }
    .edge-line { fill: none; stroke-width: 1.8; marker-end: url(#arrow); cursor: pointer; opacity: .88; }
    .edge-hit { fill: none; stroke: transparent; stroke-width: 12; cursor: pointer; }
    .edge-label { fill: #e2e8f0; font-size: 9px; pointer-events: none; text-anchor: middle; paint-order: stroke; stroke: #020617; stroke-width: 4px; }
    .dim { opacity: .12; }
    .highlight .node-shape { stroke: #f8fafc; stroke-width: 3; }
    .trace .node-shape { stroke: #facc15; stroke-width: 3; }
    .selected .node-shape { stroke: #38bdf8; stroke-width: 4; }
    .edge-highlight { stroke-width: 3.6; opacity: 1; }
    .edge-trace { stroke: #facc15 !important; stroke-width: 4; opacity: 1; }
    .notice { position: absolute; left: 14px; bottom: 14px; background: rgba(15,23,42,.92); border: 1px solid var(--line2); border-radius: 10px; padding: 8px 10px; color: var(--muted); font-size: 12px; max-width: min(560px, calc(100% - 28px)); line-height: 1.45; }
    @media (max-width: 1100px) { .sidebar { display: none; } .toolbar { right: 14px; } .toolbar input { width: 180px; } }
  </style>
</head>
<body>
  <div class="app" data-runtime-visualizer-version="2">
    <main class="graph-wrap">
      <div class="toolbar" id="runtime-toolbar">
        <h1>Runtime Graph</h1>
        <input id="search-input" placeholder="Search id / label / type / sourcePath" />
        <label class="check">Layout <select id="layout-select"><option value="dagre">dagre</option><option value="force">force</option></select></label>
        <label class="check">Depth <input id="trace-depth" type="number" min="1" max="8" value="${options.traceDepth}" style="width:64px" /></label>
        <button id="trace-upstream">Upstream</button>
        <button id="trace-downstream">Downstream</button>
        <button id="trace-both">Both</button>
        <label class="check"><input id="hide-isolated" type="checkbox" ${options.hideIsolated ? 'checked' : ''}/> Hide isolated</label>
        <button id="reset-view">Reset</button>
        <button id="fit-view">Fit</button>
      </div>
      <svg id="runtime-graph" class="graph" role="img" aria-label="Interactive runtime topology graph">
        <defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="#7aa2df"></path></marker></defs>
        <g id="viewport"><g id="edges-layer"></g><g id="edge-labels-layer"></g><g id="nodes-layer"></g></g>
      </svg>
      <div class="notice" id="graph-notice">Runtime visualizer v2: drag to pan, scroll to zoom, click node/edge to inspect, double-click node to lock 1-hop subgraph.</div>
    </main>
    <aside class="sidebar">
      <div class="section">
        <div class="eyebrow">TriadMind Runtime Topology</div>
        <h2>${escapeHtml(runtimeMap.project)}</h2>
        <p class="desc">Leaf-style review panel for runtime flows. Use filters to narrow API -> Service -> Worker -> Resource chains.</p>
        <div class="summary">
          <span class="chip">view: ${escapeHtml(runtimeMap.view ?? 'full')}</span>
          <span class="chip">nodes: ${runtimeMap.nodes.length}</span>
          <span class="chip">edges: ${runtimeMap.edges.length}</span>
          <span class="chip">normalized edges: ${normalizedEdgeCount}</span>
          <span class="chip">diagnostics: ${(runtimeMap.diagnostics ?? []).length}</span>
        </div>
      </div>
      <div class="section">
        <h3>Graph Status</h3>
        <div class="status-row"><span class="status-dot status-selected"></span><span>Selected node / edge</span></div>
        <div class="status-row"><span class="status-dot status-hop"></span><span>1-hop neighborhood highlight</span></div>
        <div class="status-row"><span class="status-dot status-trace"></span><span>Trace path (upstream / downstream / both)</span></div>
      </div>
      <div class="section">
        <h3>Node Types</h3>
        <div id="node-type-filters" class="filters"></div>
        <p class="legend-hint">Toggle node domains to match leaf-view style focus.</p>
      </div>
      <div class="section">
        <h3>Edge Types</h3>
        <div id="edge-type-filters" class="filters"></div>
        <p class="legend-hint">Keep only key relation types for cleaner chain reading.</p>
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
const nodeTypeCounts = buildCountMap(normalized.nodes.map(node => node.type));
const edgeTypeCounts = buildCountMap(normalized.edges.map(edge => edge.type));
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
  buildFilterControls('node-type-filters', allNodeTypes, state.activeNodeTypes, type => NODE_COLORS[type] || '#64748b', nodeTypeCounts);
  buildFilterControls('edge-type-filters', allEdgeTypes, state.activeEdgeTypes, type => EDGE_COLORS[type] || '#7aa2df', edgeTypeCounts);
  setupPanZoom();
}
function buildFilterControls(containerId, items, activeSet, colorResolver, counts) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  items.forEach(item => {
    const id = containerId + '-' + item;
    const label = document.createElement('label');
    label.className = 'legend-item';
    label.innerHTML = '<input id="' + escAttr(id) + '" type="checkbox" checked />' +
      '<span class="legend-dot" style="background:' + escAttr(colorResolver(item)) + '"></span>' +
      '<span class="legend-label">' + esc(item) + '</span>' +
      '<span class="legend-count">' + String(counts.get(item) || 0) + '</span>';
    const input = label.querySelector('input');
    input.addEventListener('change', event => {
      if (event.target.checked) {
        activeSet.add(item);
        label.classList.remove('dimmed');
      } else {
        activeSet.delete(item);
        label.classList.add('dimmed');
      }
      state.layoutDirty = true;
      render();
    });
    container.appendChild(label);
  });
}
function buildCountMap(values) {
  const map = new Map();
  values.forEach(value => map.set(value, (map.get(value) || 0) + 1));
  return map;
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
  const nodeWidth = 160;
  const nodeHeight = 52;
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('class', 'node-shape');
  rect.setAttribute('x', String(-nodeWidth / 2)); rect.setAttribute('y', String(-nodeHeight / 2)); rect.setAttribute('rx', '13'); rect.setAttribute('width', String(nodeWidth)); rect.setAttribute('height', String(nodeHeight));
  rect.setAttribute('fill', NODE_COLORS[node.type] || '#64748b');
  rect.setAttribute('stroke', '#1e293b');
  const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  label.setAttribute('class', 'node-label'); label.setAttribute('y', '-6'); label.textContent = truncate(node.label || node.id, 28);
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
  const ox = dx / len * 82; const oy = dy / len * 30;
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
  detailTitle.textContent = edge.type + ': ' + edge.from + ' -> ' + edge.to;
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
function truncate(value, max) { value = String(value || ''); return value.length > max ? value.slice(0, max - 3) + '...' : value; }
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
