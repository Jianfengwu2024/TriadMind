import * as fs from 'fs';
import * as path from 'path';
import { buildRuntimeGraphIndex } from './runtimeGraph';
import { normalizeRuntimeNodeLabel } from './runtimeLabeling';
import { RuntimeMap, RuntimeNode, RuntimeNodeType } from './types';

export type RuntimeVisualizerLayout = 'leaf-force' | 'dagre';
export type RuntimeVisualizerTheme = 'leaf-like' | 'runtime-dark';

export interface RuntimeDashboardOptions {
    title?: string;
    interactive?: boolean;
    layout?: RuntimeVisualizerLayout;
    traceDepth?: number;
    hideIsolated?: boolean;
    maxRenderEdges?: number;
    theme?: RuntimeVisualizerTheme;
}

type RuntimeNodeGroup = 'frontend' | 'api' | 'service' | 'workflow' | 'worker' | 'resource' | 'external' | 'infra' | 'other';

interface RuntimeLegendItem {
    cid: RuntimeNodeGroup;
    label: string;
    color: string;
    count: number;
}

interface RuntimeVisualNode {
    id: string;
    label: string;
    title: string;
    shape: 'dot' | 'box' | 'diamond' | 'ellipse';
    size: number;
    borderWidth: number;
    font: Record<string, unknown>;
    color: Record<string, unknown>;
    _type: RuntimeNodeType;
    _group: RuntimeNodeGroup;
    _sourcePath?: string;
    _framework?: string;
    _metadata: Record<string, unknown>;
    _evidence: unknown[];
    _searchText: string;
}

interface RuntimeVisualEdge {
    id: string;
    from: string;
    to: string;
    label: string;
    title: string;
    arrows: Record<string, unknown>;
    width: number;
    dashes: false | [number, number];
    color: Record<string, unknown>;
    font: Record<string, unknown>;
    smooth: Record<string, unknown>;
    _type: string;
    _confidence: number;
    _metadata: Record<string, unknown>;
    _evidence: unknown[];
}

interface RuntimeDashboardPayload {
    runtimeMap: RuntimeMap;
    nodes: RuntimeVisualNode[];
    edges: RuntimeVisualEdge[];
    legend: RuntimeLegendItem[];
    denseResourceNodeIds: string[];
}

const GROUP_THEME: Record<RuntimeNodeGroup, { label: string; color: string; border: string; highlight: string }> = {
    frontend: { label: 'Frontend', color: '#1d4ed8', border: '#60a5fa', highlight: '#93c5fd' },
    api: { label: 'API', color: '#0f766e', border: '#2dd4bf', highlight: '#99f6e4' },
    service: { label: 'Service', color: '#7c2d12', border: '#fb923c', highlight: '#fdba74' },
    workflow: { label: 'Workflow', color: '#4c1d95', border: '#a78bfa', highlight: '#ddd6fe' },
    worker: { label: 'Worker', color: '#3f3f46', border: '#facc15', highlight: '#fde68a' },
    resource: { label: 'Resource', color: '#0f172a', border: '#94a3b8', highlight: '#cbd5e1' },
    external: { label: 'External', color: '#3f0d12', border: '#fb7185', highlight: '#fecdd3' },
    infra: { label: 'Infra', color: '#3f3f46', border: '#22d3ee', highlight: '#67e8f9' },
    other: { label: 'Other', color: '#1f2937', border: '#64748b', highlight: '#cbd5e1' }
};

const EDGE_THEME: Record<string, { color: string; highlight: string; dashes?: [number, number] }> = {
    calls: { color: '#38bdf8', highlight: '#7dd3fc' },
    invokes: { color: '#f97316', highlight: '#fdba74' },
    dispatches: { color: '#8b5cf6', highlight: '#c4b5fd' },
    enqueues: { color: '#f59e0b', highlight: '#fcd34d', dashes: [8, 4] },
    consumes: { color: '#eab308', highlight: '#fde047', dashes: [8, 4] },
    executes: { color: '#22c55e', highlight: '#86efac' },
    reads: { color: '#64748b', highlight: '#94a3b8', dashes: [4, 4] },
    writes: { color: '#ef4444', highlight: '#fca5a5', dashes: [4, 4] },
    caches: { color: '#14b8a6', highlight: '#5eead4', dashes: [6, 4] },
    depends_on: { color: '#94a3b8', highlight: '#cbd5e1', dashes: [4, 6] }
};

const RESOURCE_NODE_TYPES = new Set<RuntimeNodeType>(['DataStore', 'ObjectStore', 'Cache', 'FileSystem', 'Queue']);

export function generateRuntimeDashboard(runtimeMapPath: string, outputPath: string, options: RuntimeDashboardOptions = {}) {
    const startedAt = Date.now();
    const runtimeMap = JSON.parse(fs.readFileSync(runtimeMapPath, 'utf-8')) as RuntimeMap;
    const runtimeMapForView = normalizeRuntimeMapForVisualizer(runtimeMap);
    const dashboardOptions = normalizeRuntimeDashboardOptions(options);
    const payload = buildRuntimeDashboardPayload(runtimeMapForView, dashboardOptions.maxRenderEdges);
    const html = renderRuntimeDashboard(payload, dashboardOptions, options.title ?? `TriadMind Runtime Topology - ${runtimeMapForView.project}`);

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, html, 'utf-8');
    console.log(
        `[TriadMind] Runtime visualizer mode: interactive=${dashboardOptions.interactive} layout=${dashboardOptions.layout} theme=${dashboardOptions.theme} view=${runtimeMapForView.view ?? 'full'} nodes=${payload.nodes.length} edges=${payload.edges.length} diagnostics=${(runtimeMapForView.diagnostics ?? []).length}`
    );
    if (runtimeMapForView.edges.length > payload.edges.length) {
        console.log(`[TriadMind] Runtime visualizer edge cap active: ${payload.edges.length}/${runtimeMapForView.edges.length}`);
    }
    console.log(`[TriadMind] Runtime dashboard generated in ${Date.now() - startedAt}ms`);
}

function buildRuntimeDashboardPayload(runtimeMap: RuntimeMap, maxRenderEdges: number): RuntimeDashboardPayload {
    const graphIndex = buildRuntimeGraphIndex(runtimeMap);
    const selectedEdges = graphIndex.edges
        .slice()
        .sort((left, right) => (right.confidence ?? 0) - (left.confidence ?? 0))
        .slice(0, Math.max(1, maxRenderEdges));
    const edgeIds = new Set(selectedEdges.map((edge) => edge.id));
    const degree = new Map<string, number>();
    selectedEdges.forEach((edge) => {
        degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
        degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
    });

    const nodes: RuntimeVisualNode[] = runtimeMap.nodes.map((node) => toVisualNode(node, degree));
    const nodeById = new Set(nodes.map((node) => node.id));
    const edges: RuntimeVisualEdge[] = selectedEdges.filter((edge) => nodeById.has(edge.from) && nodeById.has(edge.to) && edgeIds.has(edge.id)).map((edge) => toVisualEdge(edge));
    const legend = buildLegend(nodes);
    const denseResourceNodeIds = nodes.filter((node) => node._group === 'resource' && (degree.get(node.id) ?? 0) >= 12).map((node) => node.id);
    return { runtimeMap, nodes, edges, legend, denseResourceNodeIds };
}

function toVisualNode(node: RuntimeNode, degreeMap: Map<string, number>): RuntimeVisualNode {
    const group = resolveRuntimeNodeGroup(node.type);
    const theme = GROUP_THEME[group];
    const degree = degreeMap.get(node.id) ?? 0;
    return {
        id: node.id,
        label: truncate(node.label || node.id, 42),
        title: `${node.label} [${node.type}]${node.sourcePath ? `\\n${node.sourcePath}` : ''}`,
        shape: resolveNodeShape(node.type),
        size: Math.max(18, Math.min(42, 18 + Math.floor(Math.log2(Math.max(1, degree + 1)) * 8))),
        borderWidth: 1.8,
        font: { color: '#f8fafc', face: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', size: 12, strokeWidth: 3, strokeColor: '#0f0f1a' },
        color: { background: theme.color, border: theme.border, highlight: { background: theme.highlight, border: theme.border } },
        _type: node.type,
        _group: group,
        _sourcePath: node.sourcePath,
        _framework: node.framework,
        _metadata: node.metadata ?? {},
        _evidence: node.evidence ?? [],
        _searchText: [node.id, node.label, node.type, node.sourcePath ?? '', node.framework ?? ''].join(' ').toLowerCase()
    };
}

function toVisualEdge(edge: { id: string; from: string; to: string; type: string; confidence?: number; metadata?: Record<string, unknown>; evidence?: unknown[] }): RuntimeVisualEdge {
    const style = EDGE_THEME[edge.type] ?? EDGE_THEME.depends_on;
    const confidence = Math.max(0, Math.min(1, Number(edge.confidence ?? 0.55)));
    return {
        id: edge.id,
        from: edge.from,
        to: edge.to,
        label: edge.type,
        title: `${edge.type}\\nconfidence: ${confidence.toFixed(2)}\\nevidence: ${Array.isArray(edge.evidence) ? edge.evidence.length : 0}`,
        arrows: { to: { enabled: true, scaleFactor: 0.62 } },
        width: 1.4 + confidence * 2.2,
        dashes: style.dashes ?? false,
        color: { color: style.color, highlight: style.highlight, opacity: 0.88 },
        font: { align: 'middle', color: '#cbd5e1', strokeWidth: 3, strokeColor: '#0f0f1a', size: 11 },
        smooth: { enabled: true, type: 'continuous', roundness: 0.14 },
        _type: edge.type,
        _confidence: confidence,
        _metadata: edge.metadata ?? {},
        _evidence: edge.evidence ?? []
    };
}

function buildLegend(nodes: RuntimeVisualNode[]): RuntimeLegendItem[] {
    const counts = new Map<RuntimeNodeGroup, number>();
    nodes.forEach((node) => counts.set(node._group, (counts.get(node._group) ?? 0) + 1));
    return Array.from(counts.entries())
        .map(([cid, count]) => ({ cid, label: GROUP_THEME[cid].label, color: GROUP_THEME[cid].border, count }))
        .sort((left, right) => right.count - left.count);
}

function resolveRuntimeNodeGroup(type: RuntimeNodeType): RuntimeNodeGroup {
    if (type === 'FrontendEntry' || type === 'FrontendComponent') return 'frontend';
    if (type === 'ApiRoute' || type === 'CliCommand' || type === 'RpcEndpoint') return 'api';
    if (type === 'Service') return 'service';
    if (type === 'Workflow' || type === 'WorkflowNode' || type === 'WorkflowEdge') return 'workflow';
    if (type === 'Worker' || type === 'Task' || type === 'Queue' || type === 'Scheduler') return 'worker';
    if (RESOURCE_NODE_TYPES.has(type)) return 'resource';
    if (type === 'ExternalApi' || type === 'ExternalTool' || type === 'ModelProvider' || type === 'Plugin') return 'external';
    if (type === 'Config' || type === 'Secret' || type === 'Kernel') return 'infra';
    return 'other';
}

function resolveNodeShape(type: RuntimeNodeType): 'dot' | 'box' | 'diamond' | 'ellipse' {
    if (type === 'ApiRoute' || type === 'CliCommand' || type === 'RpcEndpoint') return 'box';
    if (type === 'Workflow' || type === 'WorkflowNode') return 'diamond';
    if (type === 'FrontendEntry' || type === 'FrontendComponent') return 'ellipse';
    return 'dot';
}

function normalizeRuntimeMapForVisualizer(runtimeMap: RuntimeMap): RuntimeMap {
    return {
        ...runtimeMap,
        nodes: runtimeMap.nodes.map((node) => {
            const normalized = normalizeRuntimeNodeLabel(node);
            const lowSignalFallback = normalized.lowSignal ? buildLowSignalFallbackLabel(node) : undefined;
            return {
                ...node,
                label: lowSignalFallback ?? normalized.label,
                metadata: {
                    ...(node.metadata ?? {}),
                    originalLabel: node.label,
                    runtimeLabelSource: normalized.source,
                    runtimeLowSignalLabel: normalized.lowSignal,
                    runtimeFallbackLabel: lowSignalFallback
                }
            };
        })
    };
}

function buildLowSignalFallbackLabel(node: RuntimeNode) {
    const sourceName = node.sourcePath ? path.basename(node.sourcePath) : '';
    const handler =
        typeof node.metadata?.handler === 'string'
            ? String(node.metadata.handler)
            : typeof node.metadata?.service === 'string'
              ? String(node.metadata.service)
              : '';
    if (handler.trim()) {
        return `${node.type} ${handler.trim()}`;
    }
    if (sourceName) {
        return `${node.type} ${sourceName}`;
    }
    return `${node.type} ${node.id.split('.').slice(0, 2).join('.')}`;
}

function normalizeRuntimeDashboardOptions(options: RuntimeDashboardOptions): Required<Omit<RuntimeDashboardOptions, 'title'>> {
    return {
        interactive: options.interactive ?? true,
        layout: options.layout === 'dagre' ? 'dagre' : 'leaf-force',
        traceDepth: normalizePositiveInteger(options.traceDepth, 2),
        hideIsolated: options.hideIsolated ?? false,
        maxRenderEdges: normalizePositiveInteger(options.maxRenderEdges, 2200),
        theme: options.theme === 'runtime-dark' ? 'runtime-dark' : 'leaf-like'
    };
}

function renderRuntimeDashboard(payload: RuntimeDashboardPayload, options: Required<Omit<RuntimeDashboardOptions, 'title'>>, title: string) {
    const safePayload = JSON.stringify(payload).replace(/</g, '\\u003c');
    const safeOptions = JSON.stringify(options).replace(/</g, '\\u003c');
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<script src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>
${buildRuntimeStyle(options.theme)}
</head>
<body data-runtime-visualizer-version="3">
<div id="canvas-wrap">
  <div id="graph"></div>
  <div id="cluster-controls"><button id="view-leaf" class="active" type="button">Leaf View</button><button id="view-flow" type="button">Flow View</button><button id="toggle-clusters" class="active" type="button">Edge Bundling: on</button></div>
  <div id="runtime-toolbar">
    <input id="search-inline" class="search-chip" placeholder="Search id / label / type / sourcePath">
    <select id="layout-select"><option value="leaf-force">leaf-force</option><option value="dagre">dagre</option></select>
    <input id="trace-depth" class="trace-chip" type="number" min="1" max="8" value="${options.traceDepth}">
    <button id="trace-upstream" type="button">Upstream</button><button id="trace-downstream" type="button">Downstream</button><button id="trace-both" type="button">Both</button>
    <button id="edge-label-toggle" class="active" type="button">Edge Labels: on</button>
    <label class="filter-row"><input id="hide-isolated" type="checkbox" ${options.hideIsolated ? 'checked' : ''}>Hide isolated</label>
    <button id="reset-view" type="button">Reset</button><button id="fit-view" type="button">Fit</button>
  </div>
  <div id="runtime-notice">Runtime graph uses vis-network and matches visualizer control semantics.</div>
</div>
<aside id="sidebar">
  <section id="hero"><div class="eyebrow">TriadMind Runtime Graph</div><h1>${escapeHtml(payload.runtimeMap.project)}</h1><p>Interactive runtime topology aligned with visualizer.html patterns.</p><div class="stats">view: ${escapeHtml(payload.runtimeMap.view ?? 'full')} | nodes: ${payload.nodes.length} | edges: ${payload.edges.length}</div></section>
  <section id="search-wrap"><input id="search" type="text" placeholder="Search nodes..." autocomplete="off"><div id="search-results"></div></section>
  <section id="status-legend"><h3>Status</h3><div class="status-row"><span class="status-dot status-selected"></span><span>selected node / edge</span></div><div class="status-row"><span class="status-dot status-neighbor"></span><span>1-hop neighbors</span></div><div class="status-row"><span class="status-dot status-trace"></span><span>trace path</span></div><div class="status-row"><span class="status-dot status-focus"></span><span>focus lock</span></div></section>
  <section id="filters-panel"><h3>Node Types</h3><div id="node-type-filters"></div><h3 style="margin-top:10px">Edge Types</h3><div id="edge-type-filters"></div></section>
  <section id="info-panel"><h3 id="info-title">Node Info</h3><div id="info-content"><span class="empty">Click a node or edge to inspect.</span></div></section>
  <section id="diagnostic-wrap"><h3>Runtime Diagnostics</h3><div id="diagnostic-content"></div></section>
  <section id="legend-wrap"><h3>Communities</h3><div id="legend"></div></section>
</aside>
<script>
const runtimePayload = ${safePayload};
const dashboardOptions = ${safeOptions};
${buildRuntimeVisualizerScript()}
</script>
</body></html>`;
}

function buildRuntimeStyle(theme: RuntimeVisualizerTheme) {
    const dark = theme === 'runtime-dark';
    const panel = dark ? '#101827' : '#1a1a2e';
    const line = dark ? '#23324a' : '#2a2a4e';
    return `<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#0f0f1a;color:#e0e0e0;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;height:100vh;overflow:hidden}#canvas-wrap{position:relative;flex:1;min-width:0}#graph{width:100%;height:100%;background:radial-gradient(circle at 15% 10%,rgba(56,189,248,.08) 0,transparent 38%),#0f0f1a}#sidebar{width:390px;background:${panel};border-left:1px solid ${line};display:flex;flex-direction:column;overflow:hidden}#hero{padding:16px;border-bottom:1px solid ${line}}.eyebrow{color:#38bdf8;font-size:11px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px}h1{font-size:18px;margin-bottom:8px;color:#f8fafc}#hero p{color:#cbd5e1;font-size:12px;line-height:1.5}.stats{color:#94a3b8;font-size:11px;margin-top:8px}#search-wrap,#status-legend,#filters-panel,#info-panel,#legend-wrap,#diagnostic-wrap{padding:14px;border-bottom:1px solid ${line}}#legend-wrap{flex:1;overflow-y:auto}#search{width:100%;background:#0f0f1a;border:1px solid #3a3a5e;color:#e0e0e0;padding:8px 10px;border-radius:6px;font-size:13px;outline:none}#search-results{max-height:170px;overflow-y:auto;display:none;padding-top:8px}#cluster-controls{position:absolute;top:16px;left:16px;z-index:20;display:flex;gap:8px;flex-wrap:wrap}#cluster-controls button,#runtime-toolbar button,#runtime-toolbar select,#runtime-toolbar input{background:#0f172a;border:1px solid #475569;color:#e2e8f0;padding:8px 12px;border-radius:999px;cursor:pointer;font-size:12px;box-shadow:0 10px 24px rgba(0,0,0,.25)}#cluster-controls button.active,#runtime-toolbar button.active{background:#082f49;border-color:#38bdf8;color:#e0f2fe}#runtime-toolbar{position:absolute;top:60px;left:16px;z-index:20;display:flex;gap:8px;flex-wrap:wrap;max-width:calc(100% - 24px)}#runtime-toolbar .search-chip{width:230px;border-radius:8px}#runtime-toolbar .trace-chip{width:72px;border-radius:8px}h3{font-size:12px;color:#a5b4fc;margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em}.status-row{display:flex;align-items:center;gap:8px;color:#cbd5e1;font-size:12px;padding:3px 0;line-height:1.5}.status-dot{width:12px;height:12px;border-radius:999px;display:inline-block;border:2px solid currentColor;flex-shrink:0}.status-selected{color:#38bdf8;background:#082f49}.status-neighbor{color:#f8fafc;background:#1f2937}.status-trace{color:#fbbf24;background:#3f2b0a}.status-focus{color:#a78bfa;background:#2e1065}.search-item,.neighbor-link,.legend-item{display:block;padding:6px 8px;cursor:pointer;border-radius:4px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.search-item:hover,.neighbor-link:hover,.legend-item:hover{background:#2a2a4e}.legend-item{display:flex;align-items:center;gap:8px;padding:5px 0}.legend-item.dimmed{opacity:.3}.legend-dot{width:12px;height:12px;border-radius:50%;flex-shrink:0}.legend-label{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.legend-count{color:#94a3b8;font-size:11px}.detail-grid{display:grid;grid-template-columns:96px 1fr;gap:6px;font-size:12px;line-height:1.45}.detail-grid b{color:#94a3b8;font-weight:500}.pill{display:inline-block;padding:2px 6px;border-radius:999px;background:#0f172a;border:1px solid #334155;margin:2px 4px 2px 0;color:#cbd5e1;font-size:11px}.runtime-flow-card{display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px;margin:10px 0}.flow-col{border-radius:8px;padding:8px;border:1px solid #334155;background:#0f172a;color:#cbd5e1}.flow-in{background:rgba(5,46,22,.75);border-color:#22c55e}.flow-core{background:rgba(8,47,73,.75);border-color:#38bdf8}.flow-out{background:rgba(46,16,101,.75);border-color:#c084fc}.filter-row{display:flex;align-items:center;gap:6px;font-size:12px;color:#cbd5e1;padding:2px 0}.filter-row input{accent-color:#38bdf8}.empty{color:#64748b;font-style:italic}#runtime-notice{position:absolute;left:16px;bottom:14px;z-index:20;background:rgba(15,23,42,.92);border:1px solid #334155;border-radius:10px;padding:8px 10px;color:#94a3b8;font-size:12px;max-width:min(640px,calc(100% - 24px));line-height:1.45}@media (max-width:1100px){#sidebar{display:none}#runtime-toolbar .search-chip{width:170px}}</style>`;
}

function buildRuntimeVisualizerScript() {
    return `
const runtimeMap = runtimePayload.runtimeMap;
const runtimeNodes = runtimePayload.nodes;
const runtimeEdges = runtimePayload.edges;
const runtimeLegend = runtimePayload.legend;
const denseResourceNodeIds = new Set(runtimePayload.denseResourceNodeIds || []);
const FLOW_ALLOWED = new Set(['frontend','api','service','workflow','worker','resource','external']);

const dom = {
  graph: document.getElementById('graph'),
  search: document.getElementById('search'),
  searchInline: document.getElementById('search-inline'),
  searchResults: document.getElementById('search-results'),
  infoTitle: document.getElementById('info-title'),
  infoContent: document.getElementById('info-content'),
  legend: document.getElementById('legend'),
  diagnostics: document.getElementById('diagnostic-content'),
  nodeTypeFilters: document.getElementById('node-type-filters'),
  edgeTypeFilters: document.getElementById('edge-type-filters'),
  hideIsolated: document.getElementById('hide-isolated'),
  traceDepth: document.getElementById('trace-depth'),
  layoutSelect: document.getElementById('layout-select'),
  viewLeaf: document.getElementById('view-leaf'),
  viewFlow: document.getElementById('view-flow'),
  toggleClusters: document.getElementById('toggle-clusters'),
  traceUpstream: document.getElementById('trace-upstream'),
  traceDownstream: document.getElementById('trace-downstream'),
  traceBoth: document.getElementById('trace-both'),
  resetView: document.getElementById('reset-view'),
  fitView: document.getElementById('fit-view'),
  edgeLabelToggle: document.getElementById('edge-label-toggle'),
  notice: document.getElementById('runtime-notice')
};

const nodesDS = new vis.DataSet(runtimeNodes);
const edgesDS = new vis.DataSet(runtimeEdges);
const network = new vis.Network(dom.graph, { nodes: nodesDS, edges: edgesDS }, buildNetworkOptions(dashboardOptions.layout));
const adjacency = buildAdjacency(runtimeNodes, runtimeEdges);

const state = {
  currentView: 'leaf',
  selectedNodeId: '',
  selectedEdgeId: '',
  focusRootId: '',
  traceDirection: 'both',
  enabledNodeTypes: new Set(runtimeNodes.map((node) => node._type)),
  enabledEdgeTypes: new Set(runtimeEdges.map((edge) => edge._type)),
  hiddenGroups: new Set(),
  showEdgeLabels: true,
  hideIsolated: Boolean(dashboardOptions.hideIsolated),
  compactResourceEdges: true,
  resourceEdgeCap: 10
};

const firstRenderStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
wireControls();
renderLegend();
renderDiagnostics();
renderTypeFilters();
showWelcome();
applyGraphState();
fitGraph();
console.log('[TriadMind] Runtime first render: ' + elapsedMs(firstRenderStartedAt) + 'ms');

if (dashboardOptions.interactive !== false) {
  network.on('click', onGraphClick);
  network.on('doubleClick', onGraphDoubleClick);
}
network.on('hoverNode', function() { dom.graph.style.cursor = 'pointer'; });
network.on('blurNode', function() { dom.graph.style.cursor = 'default'; });

function buildNetworkOptions(layout) {
  if (layout === 'dagre') {
    return {
      layout: { hierarchical: { enabled: true, direction: 'LR', sortMethod: 'directed', levelSeparation: 180, nodeSpacing: 220 } },
      physics: { enabled: false },
      interaction: { hover: true, tooltipDelay: 80, hideEdgesOnDrag: true, navigationButtons: true, keyboard: false },
      edges: { selectionWidth: 4 }
    };
  }
  return {
    physics: {
      enabled: true,
      solver: 'forceAtlas2Based',
      forceAtlas2Based: { gravitationalConstant: -78, centralGravity: 0.007, springLength: 150, springConstant: 0.08, damping: 0.42, avoidOverlap: 0.88 },
      stabilization: { iterations: 240, fit: true }
    },
    interaction: { hover: true, tooltipDelay: 80, hideEdgesOnDrag: true, navigationButtons: true, keyboard: false },
    nodes: { shadow: { enabled: true, color: 'rgba(0,0,0,.35)', size: 10, x: 0, y: 2 } },
    edges: { selectionWidth: 4 }
  };
}

function buildAdjacency(nodes, edges) {
  const byNode = new Map();
  const incoming = new Map();
  const outgoing = new Map();
  nodes.forEach((node) => {
    byNode.set(node.id, []);
    incoming.set(node.id, []);
    outgoing.set(node.id, []);
  });
  edges.forEach((edge) => {
    byNode.get(edge.from).push(edge);
    byNode.get(edge.to).push(edge);
    outgoing.get(edge.from).push(edge);
    incoming.get(edge.to).push(edge);
  });
  return { byNode, incoming, outgoing };
}

function wireControls() {
  dom.search.addEventListener('input', onSearchInput);
  dom.searchInline.addEventListener('input', function(event) {
    dom.search.value = event.target.value;
    onSearchInput();
  });
  dom.hideIsolated.checked = state.hideIsolated;
  dom.hideIsolated.addEventListener('change', function() {
    state.hideIsolated = dom.hideIsolated.checked;
    applyGraphState();
  });
  dom.layoutSelect.value = dashboardOptions.layout;
  dom.layoutSelect.addEventListener('change', function() {
    network.setOptions(buildNetworkOptions(dom.layoutSelect.value === 'dagre' ? 'dagre' : 'leaf-force'));
    fitGraph();
  });
  dom.viewLeaf.addEventListener('click', function() {
    state.currentView = 'leaf';
    syncViewButtons();
    applyGraphState();
  });
  dom.viewFlow.addEventListener('click', function() {
    state.currentView = 'flow';
    syncViewButtons();
    applyGraphState();
  });
  dom.traceUpstream.addEventListener('click', function() {
    state.traceDirection = 'upstream';
    applyGraphState();
  });
  dom.traceDownstream.addEventListener('click', function() {
    state.traceDirection = 'downstream';
    applyGraphState();
  });
  dom.traceBoth.addEventListener('click', function() {
    state.traceDirection = 'both';
    applyGraphState();
  });
  dom.resetView.addEventListener('click', resetViewState);
  dom.fitView.addEventListener('click', fitGraph);
  dom.edgeLabelToggle.addEventListener('click', function() {
    state.showEdgeLabels = !state.showEdgeLabels;
    dom.edgeLabelToggle.classList.toggle('active', state.showEdgeLabels);
    dom.edgeLabelToggle.textContent = state.showEdgeLabels ? 'Edge Labels: on' : 'Edge Labels: off';
    applyGraphState();
  });
  dom.toggleClusters.addEventListener('click', function() {
    state.compactResourceEdges = !state.compactResourceEdges;
    dom.toggleClusters.classList.toggle('active', state.compactResourceEdges);
    dom.toggleClusters.textContent = state.compactResourceEdges ? 'Edge Bundling: on' : 'Edge Bundling: off';
    applyGraphState();
  });
  dom.infoContent.addEventListener('click', function(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const nodeId = target.getAttribute('data-node-id');
    if (!nodeId) return;
    focusNode(nodeId);
  });
}

function syncViewButtons() {
  dom.viewLeaf.classList.toggle('active', state.currentView === 'leaf');
  dom.viewFlow.classList.toggle('active', state.currentView === 'flow');
}

function onSearchInput() {
  const query = (dom.search.value || '').trim().toLowerCase();
  dom.searchInline.value = dom.search.value;
  dom.searchResults.innerHTML = '';
  if (!query) {
    dom.searchResults.style.display = 'none';
    return;
  }
  const matches = runtimeNodes.filter((node) => node._searchText.includes(query)).slice(0, 25);
  if (!matches.length) {
    dom.searchResults.style.display = 'none';
    return;
  }
  dom.searchResults.style.display = 'block';
  matches.forEach((node) => {
    const item = document.createElement('div');
    item.className = 'search-item';
    item.textContent = node.label + ' [' + node._type + ']';
    item.style.borderLeft = '3px solid ' + (node.color && node.color.border ? node.color.border : '#64748b');
    item.addEventListener('click', function() {
      focusNode(node.id);
      dom.search.value = '';
      dom.searchInline.value = '';
      dom.searchResults.style.display = 'none';
    });
    dom.searchResults.appendChild(item);
  });
}

function renderTypeFilters() {
  const nodeTypes = Array.from(new Set(runtimeNodes.map((node) => node._type))).sort();
  dom.nodeTypeFilters.innerHTML = '';
  nodeTypes.forEach((type) => {
    const row = document.createElement('label');
    row.className = 'filter-row';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = true;
    input.addEventListener('change', function() {
      if (input.checked) state.enabledNodeTypes.add(type); else state.enabledNodeTypes.delete(type);
      applyGraphState();
    });
    row.appendChild(input);
    row.appendChild(document.createTextNode(type));
    dom.nodeTypeFilters.appendChild(row);
  });
  const edgeTypes = Array.from(new Set(runtimeEdges.map((edge) => edge._type))).sort();
  dom.edgeTypeFilters.innerHTML = '';
  edgeTypes.forEach((type) => {
    const row = document.createElement('label');
    row.className = 'filter-row';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = true;
    input.addEventListener('change', function() {
      if (input.checked) state.enabledEdgeTypes.add(type); else state.enabledEdgeTypes.delete(type);
      applyGraphState();
    });
    row.appendChild(input);
    row.appendChild(document.createTextNode(type));
    dom.edgeTypeFilters.appendChild(row);
  });
}

function renderLegend() {
  dom.legend.innerHTML = '';
  runtimeLegend.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'legend-item';
    row.innerHTML = '<span class="legend-dot" style="background:' + esc(item.color) + '"></span><span class="legend-label">' + esc(item.label) + '</span><span class="legend-count">' + esc(item.count) + '</span>';
    row.addEventListener('click', function() {
      if (state.hiddenGroups.has(item.cid)) state.hiddenGroups.delete(item.cid); else state.hiddenGroups.add(item.cid);
      row.classList.toggle('dimmed', state.hiddenGroups.has(item.cid));
      applyGraphState();
    });
    dom.legend.appendChild(row);
  });
}

function renderDiagnostics() {
  const diagnostics = runtimeMap.diagnostics || [];
  if (!diagnostics.length) {
    dom.diagnostics.innerHTML = '<span class="empty">No runtime diagnostics.</span>';
    return;
  }
  dom.diagnostics.innerHTML = diagnostics.slice(0, 60).map((item) => {
    const source = item.sourcePath ? ' [' + esc(item.sourcePath) + ']' : '';
    const extractor = item.extractor ? ' (' + esc(item.extractor) + ')' : '';
    return '<div style="font-size:12px;line-height:1.5;margin-bottom:6px">[' + esc(item.level) + ']' + extractor + ' ' + esc(item.message) + source + '</div>';
  }).join('');
}

function onGraphClick(params) {
  if (params.nodes && params.nodes.length > 0) {
    selectNode(params.nodes[0]);
    return;
  }
  if (params.edges && params.edges.length > 0) {
    selectEdge(params.edges[0]);
    return;
  }
  clearSelection();
}

function onGraphDoubleClick(params) {
  if (!params.nodes || params.nodes.length === 0) return;
  const nodeId = params.nodes[0];
  state.focusRootId = state.focusRootId === nodeId ? '' : nodeId;
  applyGraphState();
}

function clearSelection() {
  state.selectedNodeId = '';
  state.selectedEdgeId = '';
  showWelcome();
  applyGraphState();
}

function focusNode(nodeId) {
  selectNode(nodeId);
  network.focus(nodeId, { scale: 1.3, animation: true });
}

function selectNode(nodeId) {
  state.selectedNodeId = nodeId;
  state.selectedEdgeId = '';
  network.selectNodes([nodeId]);
  showNodeInfo(nodeId);
  applyGraphState();
}

function selectEdge(edgeId) {
  state.selectedEdgeId = edgeId;
  state.selectedNodeId = '';
  network.selectEdges([edgeId]);
  showEdgeInfo(edgeId);
  applyGraphState();
}

function resetViewState() {
  state.selectedNodeId = '';
  state.selectedEdgeId = '';
  state.focusRootId = '';
  state.traceDirection = 'both';
  state.currentView = 'leaf';
  syncViewButtons();
  showWelcome();
  applyGraphState();
}

function showWelcome() {
  dom.infoTitle.textContent = 'Node Info';
  dom.infoContent.innerHTML = '<span class="empty">Click a node or edge to inspect.</span>';
}

function showNodeInfo(nodeId) {
  const node = nodesDS.get(nodeId);
  if (!node) return;
  const neighbors = network.getConnectedNodes(nodeId);
  const incomingCount = (adjacency.incoming.get(nodeId) || []).length;
  const outgoingCount = (adjacency.outgoing.get(nodeId) || []).length;
  const neighborsHtml = neighbors.length ? neighbors.map((id) => {
    const target = nodesDS.get(id);
    if (!target) return '';
    return '<span class="neighbor-link" data-node-id="' + escAttr(id) + '" style="border-left:3px solid ' + esc(target.color && target.color.border ? target.color.border : '#64748b') + '">' + esc(target.label) + '</span>';
  }).join('') : '<span class="empty">No neighbors</span>';
  dom.infoTitle.textContent = 'Node Info';
  dom.infoContent.innerHTML =
    '<div style="font-size:14px;color:#f8fafc;margin-bottom:8px">' + esc(node.label) + '</div>' +
    '<div class="detail-grid"><b>ID</b><span>' + esc(node.id) + '</span><b>Type</b><span><span class="pill">' + esc(node._type) + '</span></span><b>Group</b><span><span class="pill">' + esc(node._group) + '</span></span><b>Source</b><span>' + esc(node._sourcePath || '-') + '</span><b>Framework</b><span>' + esc(node._framework || '-') + '</span></div>' +
    '<div class="runtime-flow-card"><div class="flow-col flow-in"><b>Upstream</b><small>incoming</small>' + esc(incomingCount) + '</div><div class="flow-col flow-core"><b>Node</b><small>current</small>' + esc(node.label) + '</div><div class="flow-col flow-out"><b>Downstream</b><small>outgoing</small>' + esc(outgoingCount) + '</div></div>' +
    '<div style="margin-top:8px;font-size:11px;color:#94a3b8">Neighbors</div>' + neighborsHtml +
    '<div style="margin-top:10px;font-size:11px;color:#94a3b8">Metadata</div>' + renderJson(node._metadata) +
    '<div style="margin-top:10px;font-size:11px;color:#94a3b8">Evidence</div>' + renderEvidence(node._evidence);
}

function showEdgeInfo(edgeId) {
  const edge = edgesDS.get(edgeId);
  if (!edge) return;
  const from = nodesDS.get(edge.from);
  const to = nodesDS.get(edge.to);
  dom.infoTitle.textContent = 'Edge Info';
  dom.infoContent.innerHTML =
    '<div style="font-size:14px;color:#f8fafc;margin-bottom:8px">' + esc(edge._type) + '</div>' +
    '<div class="detail-grid"><b>ID</b><span>' + esc(edge.id) + '</span><b>From</b><span><span class="neighbor-link" data-node-id="' + escAttr(edge.from) + '">' + esc(from ? from.label : edge.from) + '</span></span><b>To</b><span><span class="neighbor-link" data-node-id="' + escAttr(edge.to) + '">' + esc(to ? to.label : edge.to) + '</span></span><b>Type</b><span><span class="pill">' + esc(edge._type) + '</span></span><b>Confidence</b><span>' + esc((edge._confidence || 0).toFixed(2)) + '</span></div>' +
    '<div style="margin-top:10px;font-size:11px;color:#94a3b8">Metadata</div>' + renderJson(edge._metadata) +
    '<div style="margin-top:10px;font-size:11px;color:#94a3b8">Evidence</div>' + renderEvidence(edge._evidence);
}

function renderJson(value) {
  if (!value || Object.keys(value).length === 0) return '<span class="empty">None</span>';
  return '<pre style="white-space:pre-wrap;word-break:break-word;background:#0b1224;border:1px solid #334155;border-radius:8px;padding:8px;color:#dce8ff;font-size:12px;max-height:180px;overflow:auto">' + esc(JSON.stringify(value, null, 2)) + '</pre>';
}

function renderEvidence(evidence) {
  if (!Array.isArray(evidence) || evidence.length === 0) return '<span class="empty">No evidence</span>';
  return evidence.slice(0, 20).map((item) => {
    const source = item && item.sourcePath ? item.sourcePath : '-';
    const line = item && item.line ? ':' + item.line : '';
    const kind = item && item.kind ? item.kind : 'inferred';
    const text = item && item.text ? item.text : '';
    return '<div style="font-size:12px;line-height:1.5;margin-bottom:6px;border-left:2px solid #334155;padding-left:8px"><div><span class="pill">' + esc(kind) + '</span> ' + esc(source + line) + '</div><div style="color:#94a3b8">' + esc(text) + '</div></div>';
  }).join('');
}

function applyGraphState() {
  const visible = computeVisibleSets();
  const highlight = computeHighlightSets(visible.nodeIds, visible.edgeIds);
  nodesDS.update(runtimeNodes.map((node) => {
    const isVisible = visible.nodeIds.has(node.id);
    const isSelected = state.selectedNodeId === node.id;
    const isNeighbor = highlight.neighborNodeIds.has(node.id);
    const isTrace = highlight.traceNodeIds.has(node.id);
    const isDimmed = !isSelected && !isNeighbor && !isTrace && (state.selectedNodeId || state.selectedEdgeId);
    return {
      id: node.id,
      hidden: !isVisible,
      borderWidth: isSelected ? 4 : isTrace ? 3.2 : isNeighbor ? 2.8 : 1.8,
      color: { background: isDimmed ? withAlpha(node.color.background, 0.18) : node.color.background, border: isSelected ? '#38bdf8' : isTrace ? '#fbbf24' : isNeighbor ? '#f8fafc' : node.color.border, highlight: node.color.highlight },
      font: { ...node.font, color: isDimmed ? 'rgba(248,250,252,0.18)' : '#f8fafc' }
    };
  }));
  edgesDS.update(runtimeEdges.map((edge) => {
    const isVisible = visible.edgeIds.has(edge.id);
    const isSelected = state.selectedEdgeId === edge.id;
    const isNeighbor = highlight.neighborEdgeIds.has(edge.id);
    const isTrace = highlight.traceEdgeIds.has(edge.id);
    const isDimmed = !isSelected && !isNeighbor && !isTrace && (state.selectedNodeId || state.selectedEdgeId);
    return {
      id: edge.id,
      hidden: !isVisible,
      label: state.showEdgeLabels ? edge.label : '',
      width: isSelected ? Math.max(edge.width, 4.2) : isTrace ? Math.max(edge.width, 3.8) : isNeighbor ? Math.max(edge.width, 3.2) : edge.width,
      color: { ...edge.color, color: isSelected ? '#38bdf8' : isTrace ? '#fbbf24' : edge.color.color, opacity: isDimmed ? 0.12 : edge.color.opacity },
      font: { ...edge.font, color: isDimmed ? 'rgba(203,213,225,0.12)' : edge.font.color }
    };
  }));
  if (visible.suppressedEdges > 0 && state.compactResourceEdges) {
    dom.notice.textContent = 'Edge bundling active: hidden ' + visible.suppressedEdges + ' dense resource edges.';
  } else {
    dom.notice.textContent = 'Runtime graph uses vis-network and matches visualizer control semantics.';
  }
}

function computeVisibleSets() {
  const nodeIds = new Set();
  runtimeNodes.forEach((node) => {
    if (!state.enabledNodeTypes.has(node._type)) return;
    if (state.hiddenGroups.has(node._group)) return;
    if (state.currentView === 'flow' && !FLOW_ALLOWED.has(node._group)) return;
    nodeIds.add(node.id);
  });
  let edgeIds = new Set();
  runtimeEdges.forEach((edge) => {
    if (!state.enabledEdgeTypes.has(edge._type)) return;
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) return;
    edgeIds.add(edge.id);
  });
  if (state.hideIsolated) {
    const connected = new Set();
    edgeIds.forEach((id) => {
      const edge = edgesDS.get(id);
      if (!edge) return;
      connected.add(edge.from); connected.add(edge.to);
    });
    Array.from(nodeIds).forEach((id) => { if (!connected.has(id)) nodeIds.delete(id); });
    edgeIds = new Set(Array.from(edgeIds).filter((id) => {
      const edge = edgesDS.get(id);
      return edge && nodeIds.has(edge.from) && nodeIds.has(edge.to);
    }));
  }
  if (state.focusRootId && nodeIds.has(state.focusRootId)) {
    const focused = traceFrom(state.focusRootId, 'both', normalizedDepth(), edgeIds);
    edgeIds = focused.edgeIds;
    Array.from(nodeIds).forEach((id) => { if (!focused.nodeIds.has(id)) nodeIds.delete(id); });
  }
  let suppressedEdges = 0;
  if (state.compactResourceEdges) {
    const keep = new Set(edgeIds);
    denseResourceNodeIds.forEach((resourceId) => {
      if (!nodeIds.has(resourceId) || state.selectedNodeId === resourceId) return;
      const connected = (adjacency.byNode.get(resourceId) || []).map((edge) => edge.id).filter((id) => keep.has(id));
      if (connected.length <= state.resourceEdgeCap) return;
      const preferred = connected
        .map((id) => edgesDS.get(id))
        .filter(Boolean)
        .sort((a, b) => (b._confidence || 0) - (a._confidence || 0))
        .slice(0, state.resourceEdgeCap)
        .map((edge) => edge.id);
      const preferredSet = new Set(preferred);
      connected.forEach((id) => {
        if (!preferredSet.has(id)) { keep.delete(id); suppressedEdges += 1; }
      });
    });
    edgeIds = keep;
  }
  return { nodeIds, edgeIds, suppressedEdges };
}

function computeHighlightSets(nodeIds, edgeIds) {
  const neighborNodeIds = new Set();
  const neighborEdgeIds = new Set();
  const traceNodeIds = new Set();
  const traceEdgeIds = new Set();
  if (state.selectedNodeId && nodeIds.has(state.selectedNodeId)) {
    neighborNodeIds.add(state.selectedNodeId);
    (adjacency.byNode.get(state.selectedNodeId) || []).forEach((edge) => {
      if (!edgeIds.has(edge.id)) return;
      neighborEdgeIds.add(edge.id);
      neighborNodeIds.add(edge.from);
      neighborNodeIds.add(edge.to);
    });
    const trace = traceFrom(state.selectedNodeId, state.traceDirection, normalizedDepth(), edgeIds);
    trace.nodeIds.forEach((id) => traceNodeIds.add(id));
    trace.edgeIds.forEach((id) => traceEdgeIds.add(id));
  }
  if (state.selectedEdgeId && edgeIds.has(state.selectedEdgeId)) {
    const edge = edgesDS.get(state.selectedEdgeId);
    if (edge) {
      neighborEdgeIds.add(edge.id);
      neighborNodeIds.add(edge.from);
      neighborNodeIds.add(edge.to);
    }
  }
  return { neighborNodeIds, neighborEdgeIds, traceNodeIds, traceEdgeIds };
}

function traceFrom(startNodeId, direction, depth, edgeIdFilter) {
  const nodeIds = new Set([startNodeId]);
  const edgeIds = new Set();
  const queue = [{ id: startNodeId, depth: 0 }];
  const visited = new Set([startNodeId + ':0']);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth >= depth) continue;
    const candidates = getTraceEdges(current.id, direction);
    candidates.forEach((edge) => {
      if (edgeIdFilter && !edgeIdFilter.has(edge.id)) return;
      edgeIds.add(edge.id);
      nodeIds.add(edge.from);
      nodeIds.add(edge.to);
      const next = edge.from === current.id ? edge.to : edge.from;
      const key = next + ':' + (current.depth + 1);
      if (!visited.has(key)) { visited.add(key); queue.push({ id: next, depth: current.depth + 1 }); }
    });
  }
  return { nodeIds, edgeIds };
}

function getTraceEdges(nodeId, direction) {
  if (direction === 'upstream') return adjacency.incoming.get(nodeId) || [];
  if (direction === 'downstream') return adjacency.outgoing.get(nodeId) || [];
  return [...(adjacency.incoming.get(nodeId) || []), ...(adjacency.outgoing.get(nodeId) || [])];
}

function normalizedDepth() {
  const value = Number(dom.traceDepth.value);
  if (Number.isFinite(value) && value > 0) return Math.min(8, Math.floor(value));
  return 2;
}

function fitGraph() {
  network.fit({ animation: true });
}

function withAlpha(color, alpha) {
  if (!color || typeof color !== 'string') return color;
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const expanded = hex.length === 3 ? hex.split('').map((ch) => ch + ch).join('') : hex.slice(0, 6);
    const safeAlpha = Math.max(0, Math.min(1, alpha));
    const alphaHex = Math.round(safeAlpha * 255).toString(16).padStart(2, '0');
    return '#' + expanded + alphaHex;
  }
  return color;
}

function elapsedMs(startedAt) {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return Math.max(0, Math.round(now - startedAt));
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"]/g, function(char) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]); });
}

function escAttr(value) {
  return esc(value).replace(/'/g, '&#39;');
}
`;
}

function truncate(value: string, maxLength: number) {
    const text = String(value || '');
    return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function normalizePositiveInteger(value: number | undefined, fallback: number) {
    return Number.isFinite(value) && (value as number) > 0 ? Math.floor(value as number) : fallback;
}

function escapeHtml(value: string) {
    return value.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char] ?? char));
}
