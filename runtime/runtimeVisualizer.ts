import * as fs from 'fs';
import * as path from 'path';
import { buildRuntimeGraphIndex } from './runtimeGraph';
import { normalizeRuntimeNodeLabel } from './runtimeLabeling';
import { RuntimeMap } from './types';

export type RuntimeVisualizerLayout = 'force' | 'dagre';
export type RuntimeVisualizerTheme = 'auto' | 'leaf-like' | 'runtime-dark';

export interface RuntimeDashboardOptions {
    title?: string;
    interactive?: boolean;
    layout?: RuntimeVisualizerLayout;
    traceDepth?: number;
    hideIsolated?: boolean;
    maxRenderEdges?: number;
    theme?: RuntimeVisualizerTheme;
}

export function generateRuntimeDashboard(runtimeMapPath: string, outputPath: string, options: RuntimeDashboardOptions = {}) {
    const startedAt = Date.now();
    const runtimeMap = JSON.parse(fs.readFileSync(runtimeMapPath, 'utf-8')) as RuntimeMap;
    const runtimeMapForView = normalizeRuntimeMapForVisualizer(runtimeMap);
    const graphIndex = buildRuntimeGraphIndex(runtimeMapForView);
    const dashboardOptions = normalizeRuntimeDashboardOptions(options);
    const html = renderRuntimeDashboard(
        runtimeMapForView,
        graphIndex.edges.length,
        dashboardOptions,
        options.title ?? `TriadMind Runtime Topology - ${runtimeMapForView.project}`
    );

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, html, 'utf-8');
    console.log(
        `[TriadMind] Runtime visualizer mode: interactive=${dashboardOptions.interactive} layout=${dashboardOptions.layout} theme=${dashboardOptions.theme} view=${runtimeMapForView.view ?? 'full'} nodes=${runtimeMapForView.nodes.length} edges=${runtimeMapForView.edges.length} diagnostics=${(runtimeMapForView.diagnostics ?? []).length}`
    );
    if (graphIndex.edges.length > dashboardOptions.maxRenderEdges) {
        console.log(
            `[TriadMind] Runtime visualizer edge cap active: ${dashboardOptions.maxRenderEdges}/${graphIndex.edges.length}`
        );
    }
    console.log(`[TriadMind] Runtime dashboard generated in ${Date.now() - startedAt}ms`);
}

function normalizeRuntimeMapForVisualizer(runtimeMap: RuntimeMap): RuntimeMap {
    return {
        ...runtimeMap,
        nodes: runtimeMap.nodes.map((node) => {
            const normalized = normalizeRuntimeNodeLabel(node);
            return {
                ...node,
                label: normalized.label,
                metadata: {
                    ...(node.metadata ?? {}),
                    originalLabel: node.label,
                    runtimeLabelSource: normalized.source,
                    runtimeLowSignalLabel: normalized.lowSignal
                }
            };
        })
    };
}

function normalizeRuntimeDashboardOptions(options: RuntimeDashboardOptions): Required<Omit<RuntimeDashboardOptions, 'title'>> {
    return {
        interactive: options.interactive ?? true,
        layout: options.layout === 'force' || options.layout === 'dagre' ? options.layout : 'dagre',
        traceDepth: normalizePositiveInteger(options.traceDepth, 2),
        hideIsolated: options.hideIsolated ?? false,
        maxRenderEdges: normalizePositiveInteger(options.maxRenderEdges, 2000),
        theme: normalizeRuntimeTheme(options.theme)
    };
}

function normalizeRuntimeTheme(theme: RuntimeDashboardOptions['theme']): RuntimeVisualizerTheme {
    if (theme === 'auto' || theme === 'leaf-like' || theme === 'runtime-dark') {
        return theme;
    }
    return 'leaf-like';
}

function renderRuntimeDashboard(
    runtimeMap: RuntimeMap,
    normalizedEdgeCount: number,
    options: Required<Omit<RuntimeDashboardOptions, 'title'>>,
    title: string
) {
    const payload = JSON.stringify(runtimeMap).replace(/</g, '\\u003c');
    const optionPayload = JSON.stringify(options).replace(/</g, '\\u003c');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{color-scheme:dark;--bg:#0f0f1a;--panel:#1a1a2e;--line:#2a2a4e;--line2:#334155;--text:#e0e0e0;--muted:#94a3b8;--accent:#38bdf8;--chip:#0f172a;--chip-border:#475569}
body[data-theme="runtime-dark"]{--bg:#090f1f;--panel:#101827;--line:#27354f;--line2:#344967;--accent:#7ec8ff;--chip:#101a2e;--chip-border:#3b4f70}
body{background:var(--bg);color:var(--text);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;height:100vh;overflow:hidden}
#graph{flex:1;min-width:0;position:relative;background:radial-gradient(circle at 24% 14%,rgba(56,189,248,.15) 0,transparent 36%),var(--bg)}
#runtime-graph{width:100%;height:100%;display:block;cursor:grab}
#runtime-graph.dragging{cursor:grabbing}
#sidebar{width:390px;background:var(--panel);border-left:1px solid var(--line);display:flex;flex-direction:column;overflow:hidden}
#hero{padding:16px;border-bottom:1px solid var(--line)}
.eyebrow{color:var(--accent);font-size:11px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px}
h1{font-size:18px;margin-bottom:8px;color:#f8fafc}
#hero p{color:#cbd5e1;font-size:12px;line-height:1.5}
.stats{color:var(--muted);font-size:11px;margin-top:10px;line-height:1.5}
#search-wrap,#status-legend,#filters-panel,#info-panel,#legend-wrap{padding:14px;border-bottom:1px solid var(--line)}
#search-wrap{display:grid;gap:8px}
#search{width:100%;background:var(--bg);border:1px solid #3a3a5e;color:var(--text);padding:8px 10px;border-radius:6px;font-size:13px;outline:none}
#search:focus{border-color:var(--accent)}
#search-results{max-height:150px;overflow-y:auto;display:none;padding-top:6px}
#legend-wrap{flex:1;overflow:auto}
#runtime-toolbar{position:absolute;top:14px;left:14px;z-index:20;display:flex;gap:8px;flex-wrap:wrap;background:rgba(15,23,42,.92);border:1px solid var(--line2);border-radius:12px;padding:10px;box-shadow:0 12px 28px rgba(0,0,0,.28);max-width:calc(100% - 28px)}
#runtime-toolbar button,#runtime-toolbar select,#runtime-toolbar input{background:var(--chip);border:1px solid var(--chip-border);color:#e2e8f0;padding:7px 10px;border-radius:999px;font-size:12px}
#runtime-toolbar button{cursor:pointer}
#runtime-toolbar button:hover,#runtime-toolbar select:hover,#runtime-toolbar input:hover{filter:brightness(1.08)}
#runtime-toolbar .active{background:#082f49;border-color:#38bdf8;color:#e0f2fe}
#runtime-toolbar .runtime-search-chip{width:240px;border-radius:8px}
h3{font-size:12px;color:#a5b4fc;margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em}
.status-row{display:flex;align-items:center;gap:8px;color:#cbd5e1;font-size:12px;padding:3px 0;line-height:1.5}
.status-dot{width:12px;height:12px;border-radius:999px;display:inline-block;border:2px solid currentColor;flex-shrink:0}
.status-selected{color:#38bdf8;background:#082f49;box-shadow:0 0 14px rgba(56,189,248,.6)}
.status-neighbor{color:#f8fafc;background:#1f2937}
.status-trace{color:#fbbf24;background:#3f2b0a;box-shadow:0 0 14px rgba(251,191,36,.4)}
.status-lock{color:#a78bfa;background:#312e81}
.status-line{width:22px;height:3px;background:#38bdf8;box-shadow:0 0 10px rgba(56,189,248,.9);display:inline-block;flex-shrink:0}
.legend-hint{color:var(--muted);font-size:11px;line-height:1.5;margin-top:8px}
.legend-item{display:grid;grid-template-columns:auto auto 1fr auto;align-items:center;gap:8px;padding:6px 4px;cursor:pointer;border-radius:6px;font-size:12px}
.legend-item:hover{background:#2a2a4e}
.legend-item.dimmed{opacity:.35}
.legend-dot{width:12px;height:12px;border-radius:50%;border:1px solid rgba(226,232,240,.45)}
.legend-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.legend-count{color:#94a3b8;font-size:11px}
.preset-list{display:flex;gap:6px;flex-wrap:wrap}
.preset-btn{background:var(--chip);border:1px solid var(--chip-border);color:#e2e8f0;padding:6px 10px;border-radius:999px;font-size:11px;cursor:pointer}
.preset-btn:hover{filter:brightness(1.08)}
.preset-btn.active{background:#082f49;border-color:#38bdf8;color:#e0f2fe}
#detail-title{font-size:14px;color:#f8fafc;margin-bottom:10px;line-height:1.4;word-break:break-word}
.detail-kv{display:grid;grid-template-columns:96px 1fr;gap:6px;font-size:12px;line-height:1.45}
.detail-kv b{color:var(--muted);font-weight:500}
.runtime-flow-card{display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px;margin:10px 0}
.flow-col{border-radius:8px;padding:8px;border:1px solid #334155;cursor:pointer;word-break:break-word;background:#0f172a;color:#cbd5e1;text-align:left}
.flow-col:hover{filter:brightness(1.12)}
.flow-col b{display:block;color:#f8fafc;margin-bottom:2px}
.flow-col small{display:block;color:#94a3b8;margin-bottom:5px}
.flow-in{background:rgba(5,46,22,.8);border-color:#22c55e}
.flow-core{background:rgba(8,47,73,.8);border-color:#38bdf8}
.flow-out{background:rgba(46,16,101,.8);border-color:#c084fc}
.neighbor-link,.search-item{display:block;padding:5px 8px;cursor:pointer;border-radius:4px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.neighbor-link{padding:3px 6px;margin:3px 0;border-left:3px solid #333}
.neighbor-link:hover,.search-item:hover{background:#2a2a4e}
.pill{display:inline-block;padding:2px 6px;border-radius:999px;background:#0f172a;border:1px solid #334155;margin:2px 4px 2px 0;color:#cbd5e1;font-size:11px}
pre{white-space:pre-wrap;word-break:break-word;background:#0b1224;border:1px solid var(--line2);border-radius:8px;padding:8px;color:#dce8ff;font-size:12px;max-height:190px;overflow:auto;margin-top:7px}
.node-shape{stroke-width:1.4;cursor:pointer;filter:drop-shadow(0 3px 8px rgba(0,0,0,.28))}
.node-label{fill:#eff6ff;font-size:11px;font-weight:600;pointer-events:none;text-anchor:middle;dominant-baseline:central}
.node-sub{fill:#dbeafe;font-size:9px;pointer-events:none;text-anchor:middle;dominant-baseline:central;opacity:.82}
.edge-line{fill:none;stroke-width:1.8;marker-end:url(#arrow);cursor:pointer;opacity:.88}
.edge-hit{fill:none;stroke:transparent;stroke-width:12;cursor:pointer}
.edge-label{fill:#e2e8f0;font-size:9px;pointer-events:none;text-anchor:middle;paint-order:stroke;stroke:#020617;stroke-width:4px}
.dim{opacity:.14}
.neighbor .node-shape{stroke:#f8fafc;stroke-width:3}
.trace .node-shape{stroke:#fbbf24;stroke-width:3}
.selected .node-shape{stroke:#38bdf8;stroke-width:4}
.locked .node-shape{stroke:#a78bfa;stroke-width:3}
.edge-neighbor{stroke-width:3.6;opacity:1}
.edge-trace{stroke:#fbbf24 !important;stroke-width:4;opacity:1}
.edge-selected{stroke:#38bdf8 !important;stroke-width:4.2;opacity:1}
#runtime-notice{position:absolute;left:14px;bottom:14px;background:rgba(15,23,42,.92);border:1px solid var(--line2);border-radius:10px;padding:8px 10px;color:var(--muted);font-size:12px;max-width:min(620px,calc(100% - 28px));line-height:1.45}
.trace-input{width:66px !important;border-radius:8px !important}
.toggle-chip{display:flex;align-items:center;gap:6px;font-size:12px;color:#cbd5e1}
.toggle-chip input{accent-color:var(--accent)}
@media (max-width:1100px){#sidebar{display:none}#runtime-toolbar .runtime-search-chip{width:180px}}
</style>
</head>
<body>
<main id="graph" data-runtime-visualizer-version="2">
  <div id="runtime-toolbar">
    <input id="search" class="runtime-search-chip" placeholder="Search id / label / type / sourcePath">
    <select id="layout-select"><option value="dagre">dagre</option><option value="force">force</option></select>
    <input id="trace-depth" class="trace-input" type="number" min="1" max="8" value="${options.traceDepth}">
    <button id="trace-upstream" type="button">Upstream</button>
    <button id="trace-downstream" type="button">Downstream</button>
    <button id="trace-both" type="button">Both</button>
    <button id="edge-label-toggle" type="button" class="active">Edge Labels: on</button>
    <label class="toggle-chip"><input id="hide-isolated" type="checkbox" ${options.hideIsolated ? 'checked' : ''}>Hide isolated</label>
    <button id="reset-view" type="button">Reset</button>
    <button id="fit-view" type="button">Fit</button>
  </div>
  <svg id="runtime-graph" role="img" aria-label="Leaf-style runtime topology graph">
    <defs>
      <marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
        <path d="M0,0 L0,6 L9,3 z" fill="#7aa2df"></path>
      </marker>
    </defs>
    <g id="viewport">
      <g id="edges-layer"></g>
      <g id="edge-labels-layer"></g>
      <g id="nodes-layer"></g>
    </g>
  </svg>
  <div id="runtime-notice">Runtime visualizer v2: drag/zoom graph, click node for 1-hop, double-click to lock focus subgraph.</div>
</main>
<aside id="sidebar">
  <section id="hero">
    <div class="eyebrow">TriadMind Runtime Graph</div>
    <h1>${escapeHtml(runtimeMap.project)}</h1>
    <p>Leaf-style runtime graph: consistent controls and review flow with capability visualizer while keeping runtime semantics.</p>
    <div class="stats">view: ${escapeHtml(runtimeMap.view ?? 'full')} · nodes: ${runtimeMap.nodes.length} · edges: ${runtimeMap.edges.length} · normalized edges: ${normalizedEdgeCount}</div>
    <div class="stats">diagnostics: ${(runtimeMap.diagnostics ?? []).length} · layout: ${escapeHtml(options.layout)} · interactive: ${options.interactive ? 'on' : 'off'}</div>
  </section>
  <section id="search-wrap">
    <h3>Node Presets</h3>
    <div id="node-presets" class="preset-list"></div>
    <div id="search-results"></div>
    <p class="legend-hint">快速收敛到 ApiRoute → Service → Worker → Resource 主链路。</p>
  </section>
  <section id="status-legend">
    <h3>Status</h3>
    <div class="status-row"><span class="status-dot status-selected"></span><span>selected node / edge</span></div>
    <div class="status-row"><span class="status-dot status-neighbor"></span><span>1-hop neighbors</span></div>
    <div class="status-row"><span class="status-dot status-trace"></span><span>trace path (upstream / downstream / both)</span></div>
    <div class="status-row"><span class="status-dot status-lock"></span><span>double-click lock focus subgraph</span></div>
    <div class="status-row"><span class="status-line"></span><span>directional runtime dependency edge</span></div>
  </section>
  <section id="filters-panel">
    <h3>Node Types</h3>
    <div id="node-type-filters"></div>
    <h3 style="margin-top:12px">Edge Types</h3>
    <div id="edge-type-filters"></div>
  </section>
  <section id="info-panel">
    <h3 id="detail-title">Select a node or edge</h3>
    <div id="detail-body" class="detail-kv"><b>Hint</b><span>Click node/edge to inspect details and evidence.</span></div>
  </section>
  <section id="legend-wrap">
    <h3>Runtime Diagnostics</h3>
    <div id="diagnostics-content"></div>
  </section>
</aside>
<script>
const runtimeMap = ${payload};
const dashboardOptions = ${optionPayload};
${buildRuntimeVisualizerScript()}
</script>
</body>
</html>`;
}

function buildRuntimeVisualizerScript() {
    return String.raw`
const NODE_TYPE_PRESETS = {
  All: [],
  ApiRoute: ['ApiRoute','RpcEndpoint','CliCommand'],
  Service: ['Service','Workflow','WorkflowNode','WorkflowEdge'],
  Worker: ['Worker','Task','Queue','Scheduler','EventConsumer','MessageProducer'],
  Resource: ['DataStore','ObjectStore','Cache','FileSystem'],
  External: ['ExternalApi','ExternalTool','ModelProvider'],
  Frontend: ['FrontendEntry','FrontendComponent'],
  Infra: ['Config','Secret','Kernel','Plugin']
};

const NODE_COLORS = {
  FrontendEntry:'#4cc9f0',
  FrontendComponent:'#4cc9f0',
  ApiRoute:'#38bdf8',
  CliCommand:'#38bdf8',
  RpcEndpoint:'#38bdf8',
  Service:'#22c55e',
  Workflow:'#a78bfa',
  WorkflowNode:'#c084fc',
  WorkflowEdge:'#d8b4fe',
  Worker:'#f59e0b',
  Task:'#fb923c',
  Queue:'#f97316',
  Scheduler:'#f97316',
  EventConsumer:'#f97316',
  MessageProducer:'#f97316',
  DataStore:'#14b8a6',
  ObjectStore:'#2dd4bf',
  Cache:'#84cc16',
  FileSystem:'#eab308',
  Config:'#64748b',
  Secret:'#ef4444',
  ExternalApi:'#f43f5e',
  ExternalTool:'#fb7185',
  ModelProvider:'#06d6a0',
  Kernel:'#64748b',
  Plugin:'#64748b',
  UnknownRuntime:'#94a3b8'
};

const EDGE_COLORS = {
  calls:'#5bc0eb',
  invokes:'#9bc53d',
  dispatches:'#f6c85f',
  publishes:'#f25f5c',
  subscribes:'#f25f5c',
  enqueues:'#f25f5c',
  consumes:'#ff7f51',
  schedules:'#ff7f51',
  reads:'#ffe066',
  writes:'#ff9f1c',
  caches:'#c77dff',
  contains:'#6c8ef5',
  connects:'#8d99ae',
  executes:'#2ec4b6',
  uses_tool:'#ef476f',
  uses_model:'#06d6a0',
  returns_to:'#38bdf8',
  depends_on:'#94a3b8',
  loads_config:'#64748b',
  uses_secret:'#ef4444'
};

const dom = {
  svg: document.getElementById('runtime-graph'),
  viewport: document.getElementById('viewport'),
  nodesLayer: document.getElementById('nodes-layer'),
  edgesLayer: document.getElementById('edges-layer'),
  edgeLabelsLayer: document.getElementById('edge-labels-layer'),
  notice: document.getElementById('runtime-notice'),
  search: document.getElementById('search'),
  layoutSelect: document.getElementById('layout-select'),
  traceDepth: document.getElementById('trace-depth'),
  traceUpstream: document.getElementById('trace-upstream'),
  traceDownstream: document.getElementById('trace-downstream'),
  traceBoth: document.getElementById('trace-both'),
  edgeLabelToggle: document.getElementById('edge-label-toggle'),
  hideIsolated: document.getElementById('hide-isolated'),
  resetView: document.getElementById('reset-view'),
  fitView: document.getElementById('fit-view'),
  nodeFilterContainer: document.getElementById('node-type-filters'),
  edgeFilterContainer: document.getElementById('edge-type-filters'),
  presetContainer: document.getElementById('node-presets'),
  searchResults: document.getElementById('search-results'),
  detailTitle: document.getElementById('detail-title'),
  detailBody: document.getElementById('detail-body'),
  diagnosticsContent: document.getElementById('diagnostics-content')
};

const graphStore = buildGraphStore(runtimeMap);
const state = {
  layout: dashboardOptions.layout || 'dagre',
  query: '',
  selectedNodeId: null,
  selectedEdgeId: null,
  focusNodeId: null,
  trace: null,
  hideIsolated: Boolean(dashboardOptions.hideIsolated),
  showEdgeLabels: true,
  activeNodeTypes: new Set(),
  activeEdgeTypes: new Set(),
  transform: { x: 0, y: 0, k: 1 },
  positions: new Map(),
  draggingNodeId: null,
  layoutDirty: true
};

const allNodeTypes = Array.from(new Set(graphStore.nodes.map(node => node.type))).sort();
const allEdgeTypes = Array.from(new Set(graphStore.edges.map(edge => edge.type))).sort();
const nodeTypeCounts = buildCountMap(graphStore.nodes.map(node => node.type));
const edgeTypeCounts = buildCountMap(graphStore.edges.map(edge => edge.type));
allNodeTypes.forEach(type => state.activeNodeTypes.add(type));
allEdgeTypes.forEach(type => state.activeEdgeTypes.add(type));

bootRuntimeVisualizer();

function bootRuntimeVisualizer() {
  applyTheme(dashboardOptions.theme);
  hydrateControls();
  hydrateDiagnostics();
  renderGraph();
  fitSoon();
}

function applyTheme(theme) {
  if (theme === 'auto') {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.body.setAttribute('data-theme', prefersDark ? 'leaf-like' : 'runtime-dark');
    return;
  }
  document.body.setAttribute('data-theme', theme || 'leaf-like');
}

function buildGraphStore(map) {
  const nodes = Array.isArray(map?.nodes) ? map.nodes : [];
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const edges = (Array.isArray(map?.edges) ? map.edges : [])
    .filter(edge => nodeById.has(edge.from) && nodeById.has(edge.to))
    .map(edge => ({ ...edge, id: edge.id || stableEdgeId(edge) }));
  const edgeById = new Map(edges.map(edge => [edge.id, edge]));
  const incoming = new Map();
  const outgoing = new Map();
  nodes.forEach(node => { incoming.set(node.id, []); outgoing.set(node.id, []); });
  edges.forEach(edge => {
    outgoing.get(edge.from)?.push(edge);
    incoming.get(edge.to)?.push(edge);
  });
  return { nodes, edges, nodeById, edgeById, incoming, outgoing };
}

function stableEdgeId(edge) {
  return 'RuntimeEdge.' + [edge.from, edge.type, edge.to].join('.').replace(/[^\w./:{}-]+/g, '_');
}

function hydrateControls() {
  dom.layoutSelect.value = state.layout;
  dom.hideIsolated.checked = state.hideIsolated;
  syncEdgeLabelToggle();
  setupPresetButtons();
  buildFilterControls(dom.nodeFilterContainer, allNodeTypes, state.activeNodeTypes, type => NODE_COLORS[type] || '#64748b', nodeTypeCounts, true);
  buildFilterControls(dom.edgeFilterContainer, allEdgeTypes, state.activeEdgeTypes, type => EDGE_COLORS[type] || '#7aa2df', edgeTypeCounts, false);

  dom.search.addEventListener('input', event => {
    state.query = String(event.target.value || '').trim().toLowerCase();
    renderSearchResults();
    state.layoutDirty = true;
    renderGraph();
  });
  dom.layoutSelect.addEventListener('change', event => {
    state.layout = event.target.value === 'force' ? 'force' : 'dagre';
    state.positions = new Map();
    state.layoutDirty = true;
    renderGraph();
  });
  dom.traceDepth.addEventListener('change', () => {
    dom.traceDepth.value = String(normalizedTraceDepth());
  });
  dom.traceUpstream.addEventListener('click', () => runTrace('upstream'));
  dom.traceDownstream.addEventListener('click', () => runTrace('downstream'));
  dom.traceBoth.addEventListener('click', () => runTrace('both'));
  dom.edgeLabelToggle.addEventListener('click', () => {
    state.showEdgeLabels = !state.showEdgeLabels;
    syncEdgeLabelToggle();
    renderGraph();
  });
  dom.hideIsolated.addEventListener('change', event => {
    state.hideIsolated = Boolean(event.target.checked);
    state.layoutDirty = true;
    renderGraph();
  });
  dom.resetView.addEventListener('click', resetStateAndRender);
  dom.fitView.addEventListener('click', fitView);
  setupPanAndZoom();
  renderSearchResults();
}

function hydrateDiagnostics() {
  const diagnostics = Array.isArray(runtimeMap?.diagnostics) ? runtimeMap.diagnostics : [];
  if (!diagnostics.length) {
    dom.diagnosticsContent.innerHTML = '<span class="pill">No runtime diagnostics</span>';
    return;
  }
  dom.diagnosticsContent.innerHTML = diagnostics.slice(0, 80).map(diagnostic => {
    const level = esc(String(diagnostic.level || 'info'));
    const extractor = esc(String(diagnostic.extractor || 'runtime'));
    const sourcePath = esc(String(diagnostic.sourcePath || '-'));
    const message = esc(String(diagnostic.message || ''));
    return '<pre>[' + level + '] ' + extractor + '\\n' + sourcePath + '\\n' + message + '</pre>';
  }).join('');
}

function setupPresetButtons() {
  const container = dom.presetContainer;
  container.innerHTML = '';
  Object.entries(NODE_TYPE_PRESETS).forEach(([name, types]) => {
    const resolvedTypes = types.length ? types.filter(type => allNodeTypes.includes(type)) : [...allNodeTypes];
    if (!resolvedTypes.length) {
      return;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'preset-btn';
    button.textContent = name;
    button.addEventListener('click', () => {
      state.activeNodeTypes = new Set(resolvedTypes);
      syncNodeFilterInputs();
      markActivePreset(name);
      state.layoutDirty = true;
      renderGraph();
    });
    container.appendChild(button);
  });
  markActivePreset('All');
}

function markActivePreset(name) {
  document.querySelectorAll('#node-presets .preset-btn').forEach(button => {
    button.classList.toggle('active', button.textContent === name);
  });
}

function syncNodeFilterInputs() {
  allNodeTypes.forEach(type => {
    const input = document.getElementById('node-filter-' + cssSafe(type));
    const item = input?.closest('.legend-item');
    const checked = state.activeNodeTypes.has(type);
    if (input) {
      input.checked = checked;
    }
    if (item) {
      item.classList.toggle('dimmed', !checked);
    }
  });
}

function syncEdgeLabelToggle() {
  dom.edgeLabelToggle.textContent = 'Edge Labels: ' + (state.showEdgeLabels ? 'on' : 'off');
  dom.edgeLabelToggle.classList.toggle('active', state.showEdgeLabels);
}

function buildFilterControls(container, items, activeSet, colorResolver, countMap, isNodeFilter) {
  container.innerHTML = '';
  items.forEach(item => {
    const safeId = (isNodeFilter ? 'node-filter-' : 'edge-filter-') + cssSafe(item);
    const row = document.createElement('label');
    row.className = 'legend-item';
    row.innerHTML = '<input id="' + escAttr(safeId) + '" type="checkbox" checked>' +
      '<span class="legend-dot" style="background:' + escAttr(colorResolver(item)) + '"></span>' +
      '<span class="legend-label">' + esc(item) + '</span>' +
      '<span class="legend-count">' + String(countMap.get(item) || 0) + '</span>';
    const input = row.querySelector('input');
    input.addEventListener('change', event => {
      if (event.target.checked) {
        activeSet.add(item);
        row.classList.remove('dimmed');
      } else {
        activeSet.delete(item);
        row.classList.add('dimmed');
      }
      if (isNodeFilter) {
        markActivePreset('');
      }
      state.layoutDirty = true;
      renderGraph();
    });
    container.appendChild(row);
  });
}

function renderSearchResults() {
  const container = dom.searchResults;
  if (!container) {
    return;
  }
  if (!state.query) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  const matches = graphStore.nodes
    .filter(node => matchesSearch(node))
    .slice(0, 20);

  if (!matches.length) {
    container.style.display = 'block';
    container.innerHTML = '<span class="pill">No matched node</span>';
    return;
  }

  container.style.display = 'block';
  container.innerHTML = matches
    .map(node => {
      const color = NODE_COLORS[node.type] || '#64748b';
      return '<div class="search-item" data-runtime-node-id="' + escAttr(node.id) + '" style="border-left:3px solid ' + escAttr(color) + '">' +
        esc(node.label || node.id) +
        '</div>';
    })
    .join('');

  container.querySelectorAll('[data-runtime-node-id]').forEach(element => {
    element.addEventListener('click', () => {
      const nodeId = element.getAttribute('data-runtime-node-id');
      if (!nodeId) {
        return;
      }
      selectNode(nodeId);
      fitView();
      container.style.display = 'none';
      container.innerHTML = '';
    });
  });
}

function renderGraph() {
  const graph = getVisibleGraph();
  if (state.layoutDirty) {
    computeLayout(graph.nodes, graph.edges);
    state.layoutDirty = false;
  }
  applyTransform();
  dom.edgesLayer.innerHTML = '';
  dom.edgeLabelsLayer.innerHTML = '';
  dom.nodesLayer.innerHTML = '';
  const highlighted = computeHighlightSets();
  graph.edges.forEach((edge, edgeIndex) => renderEdge(edge, highlighted, edgeIndex, graph.edges.length));
  graph.nodes.forEach(node => renderNode(node, highlighted));
  if (!graph.nodes.length) {
    dom.notice.textContent = 'No runtime nodes match current filters.';
  }
}

function getVisibleGraph() {
  let nodes = graphStore.nodes.filter(node => state.activeNodeTypes.has(node.type) && matchesSearch(node));
  let allowedNodeIds = new Set(nodes.map(node => node.id));
  let edges = graphStore.edges.filter(edge =>
    allowedNodeIds.has(edge.from) &&
    allowedNodeIds.has(edge.to) &&
    state.activeEdgeTypes.has(edge.type)
  );

  if (state.focusNodeId) {
    const focusTrace = traceFromNode(state.focusNodeId, 'both', 1);
    nodes = nodes.filter(node => focusTrace.nodeIds.has(node.id));
    allowedNodeIds = new Set(nodes.map(node => node.id));
    edges = edges.filter(edge =>
      focusTrace.edgeIds.has(edge.id) &&
      allowedNodeIds.has(edge.from) &&
      allowedNodeIds.has(edge.to)
    );
  }

  if (state.hideIsolated) {
    const connected = new Set();
    edges.forEach(edge => { connected.add(edge.from); connected.add(edge.to); });
    nodes = nodes.filter(node => connected.has(node.id));
  }

  if (edges.length > dashboardOptions.maxRenderEdges) {
    edges = edges.slice(0, dashboardOptions.maxRenderEdges);
    dom.notice.textContent = 'Edge cap active: rendering first ' + edges.length + ' edges. Narrow by search/filter for full detail.';
  }

  return { nodes, edges };
}

function matchesSearch(node) {
  if (!state.query) {
    return true;
  }
  return [node.id, node.label, node.type, node.sourcePath || '', node.framework || '']
    .join(' ')
    .toLowerCase()
    .includes(state.query);
}

function computeHighlightSets() {
  const neighborNodeIds = new Set();
  const neighborEdgeIds = new Set();
  const traceNodeIds = new Set();
  const traceEdgeIds = new Set();

  if (state.selectedNodeId) {
    neighborNodeIds.add(state.selectedNodeId);
    const edges = [...(graphStore.incoming.get(state.selectedNodeId) || []), ...(graphStore.outgoing.get(state.selectedNodeId) || [])];
    edges.forEach(edge => {
      neighborEdgeIds.add(edge.id);
      neighborNodeIds.add(edge.from);
      neighborNodeIds.add(edge.to);
    });
  }

  if (state.selectedEdgeId) {
    const edge = graphStore.edgeById.get(state.selectedEdgeId);
    if (edge) {
      neighborEdgeIds.add(edge.id);
      neighborNodeIds.add(edge.from);
      neighborNodeIds.add(edge.to);
    }
  }

  if (state.trace) {
    state.trace.nodeIds.forEach(id => traceNodeIds.add(id));
    state.trace.edgeIds.forEach(id => traceEdgeIds.add(id));
  }

  return {
    neighborNodeIds,
    neighborEdgeIds,
    traceNodeIds,
    traceEdgeIds,
    hasFocus: Boolean(state.selectedNodeId || state.selectedEdgeId || state.trace)
  };
}

function runTrace(direction) {
  const startId = state.selectedNodeId || state.focusNodeId;
  if (!startId) {
    dom.notice.textContent = 'Select a node before trace.';
    return;
  }
  const previouslyFocused = Boolean(state.focusNodeId);
  state.trace = traceFromNode(startId, direction, normalizedTraceDepth());
  state.focusNodeId = null;
  if (previouslyFocused) {
    state.layoutDirty = true;
  }
  dom.notice.textContent = direction + ' trace depth=' + normalizedTraceDepth() + ': ' + state.trace.nodeIds.size + ' nodes / ' + state.trace.edgeIds.size + ' edges';
  renderGraph();
}

function traceFromNode(startNodeId, direction, depth) {
  const nodeIds = new Set([startNodeId]);
  const edgeIds = new Set();
  const queue = [{ nodeId: startNodeId, depth: 0 }];
  const visited = new Set([startNodeId + ':0']);

  while (queue.length) {
    const current = queue.shift();
    if (!current || current.depth >= depth) {
      continue;
    }

    const edges = direction === 'upstream'
      ? (graphStore.incoming.get(current.nodeId) || [])
      : direction === 'downstream'
        ? (graphStore.outgoing.get(current.nodeId) || [])
        : [...(graphStore.incoming.get(current.nodeId) || []), ...(graphStore.outgoing.get(current.nodeId) || [])];

    edges.forEach(edge => {
      const nextNodeId = edge.from === current.nodeId ? edge.to : edge.from;
      edgeIds.add(edge.id);
      nodeIds.add(edge.from);
      nodeIds.add(edge.to);
      const visitKey = nextNodeId + ':' + (current.depth + 1);
      if (!visited.has(visitKey)) {
        visited.add(visitKey);
        queue.push({ nodeId: nextNodeId, depth: current.depth + 1 });
      }
    });
  }

  return { nodeIds, edgeIds, direction, depth };
}

function normalizedTraceDepth() {
  const parsed = Number(dom.traceDepth.value || dashboardOptions.traceDepth || 2);
  const normalized = Math.max(1, Math.min(8, Number.isFinite(parsed) ? Math.floor(parsed) : 2));
  dom.traceDepth.value = String(normalized);
  return normalized;
}

function renderNode(node, highlighted) {
  const position = state.positions.get(node.id) || { x: 0, y: 0 };
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const isSelected = state.selectedNodeId === node.id;
  const isTrace = highlighted.traceNodeIds.has(node.id);
  const isNeighbor = highlighted.neighborNodeIds.has(node.id);
  const isLocked = state.focusNodeId === node.id;
  group.setAttribute(
    'class',
    'runtime-node' +
      (isSelected ? ' selected' : '') +
      (isTrace ? ' trace' : '') +
      (isNeighbor ? ' neighbor' : '') +
      (isLocked ? ' locked' : '') +
      (highlighted.hasFocus && !isNeighbor && !isTrace && !isSelected ? ' dim' : '')
  );
  group.setAttribute('transform', 'translate(' + position.x + ',' + position.y + ')');
  group.dataset.nodeId = node.id;

  const nodeWidth = 168;
  const nodeHeight = 54;
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('class', 'node-shape');
  rect.setAttribute('x', String(-nodeWidth / 2));
  rect.setAttribute('y', String(-nodeHeight / 2));
  rect.setAttribute('rx', '12');
  rect.setAttribute('width', String(nodeWidth));
  rect.setAttribute('height', String(nodeHeight));
  rect.setAttribute('fill', NODE_COLORS[node.type] || '#64748b');
  rect.setAttribute('stroke', '#1e293b');

  const title = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  title.setAttribute('class', 'node-label');
  title.setAttribute('y', '-7');
  title.textContent = truncate(node.label || node.id, 30);

  const subtitle = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  subtitle.setAttribute('class', 'node-sub');
  subtitle.setAttribute('y', '12');
  subtitle.textContent = node.type;

  group.append(rect, title, subtitle);
  group.addEventListener('click', event => {
    event.stopPropagation();
    selectNode(node.id);
  });
  group.addEventListener('dblclick', event => {
    event.stopPropagation();
    state.focusNodeId = node.id;
    state.selectedNodeId = node.id;
    state.selectedEdgeId = null;
    state.trace = null;
    state.layoutDirty = true;
    dom.notice.textContent = 'Focus mode locked around ' + (node.label || node.id);
    showNodeDetail(node);
    renderGraph();
  });
  group.addEventListener('pointerdown', event => startNodeDrag(event, node.id));
  dom.nodesLayer.appendChild(group);
}

function renderEdge(edge, highlighted, edgeIndex, totalEdges) {
  const from = state.positions.get(edge.from);
  const to = state.positions.get(edge.to);
  if (!from || !to) {
    return;
  }
  const points = edgePoints(from, to);
  const color = EDGE_COLORS[edge.type] || '#7aa2df';
  const isSelected = state.selectedEdgeId === edge.id;
  const isTrace = highlighted.traceEdgeIds.has(edge.id);
  const isNeighbor = highlighted.neighborEdgeIds.has(edge.id);
  const pathData = 'M' + points.x1 + ',' + points.y1 + ' L' + points.x2 + ',' + points.y2;

  const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  line.setAttribute(
    'class',
    'edge-line' +
      (isSelected ? ' edge-selected' : '') +
      (isTrace ? ' edge-trace' : '') +
      (isNeighbor ? ' edge-neighbor' : '') +
      (highlighted.hasFocus && !isSelected && !isNeighbor && !isTrace ? ' dim' : '')
  );
  line.setAttribute('d', pathData);
  line.setAttribute('stroke', color);

  const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  hit.setAttribute('class', 'edge-hit');
  hit.setAttribute('d', pathData);
  hit.addEventListener('click', event => {
    event.stopPropagation();
    selectEdge(edge.id);
  });

  dom.edgesLayer.append(line, hit);

  if (!shouldRenderEdgeLabel(edgeIndex, totalEdges)) {
    return;
  }
  const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  label.setAttribute('class', 'edge-label' + (highlighted.hasFocus && !isSelected && !isNeighbor && !isTrace ? ' dim' : ''));
  label.setAttribute('x', String((points.x1 + points.x2) / 2));
  label.setAttribute('y', String((points.y1 + points.y2) / 2 - 5));
  label.textContent = edge.type + (edge.confidence !== undefined ? ' ' + Number(edge.confidence).toFixed(2) : '');
  dom.edgeLabelsLayer.appendChild(label);
}

function shouldRenderEdgeLabel(edgeIndex, totalEdges) {
  if (!state.showEdgeLabels) {
    return false;
  }
  if (state.transform.k < 0.55) {
    return false;
  }
  const maxLabels = 500;
  const sampling = totalEdges > maxLabels ? Math.ceil(totalEdges / maxLabels) : 1;
  return edgeIndex % sampling === 0;
}

function edgePoints(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  const offsetX = dx / length * 84;
  const offsetY = dy / length * 30;
  return {
    x1: from.x + offsetX,
    y1: from.y + offsetY,
    x2: to.x - offsetX,
    y2: to.y - offsetY
  };
}

function selectNode(nodeId) {
  state.selectedNodeId = nodeId;
  state.selectedEdgeId = null;
  state.trace = null;
  state.focusNodeId = null;
  const node = graphStore.nodeById.get(nodeId);
  showNodeDetail(node);
  renderGraph();
}

function selectEdge(edgeId) {
  state.selectedEdgeId = edgeId;
  state.selectedNodeId = null;
  state.trace = null;
  state.focusNodeId = null;
  const edge = graphStore.edgeById.get(edgeId);
  showEdgeDetail(edge);
  renderGraph();
}

function resetStateAndRender() {
  state.selectedNodeId = null;
  state.selectedEdgeId = null;
  state.focusNodeId = null;
  state.trace = null;
  state.layoutDirty = true;
  dom.notice.textContent = 'Graph reset.';
  showWelcome();
  renderGraph();
}

function showNodeDetail(node) {
  if (!node) {
    return;
  }
  const incoming = graphStore.incoming.get(node.id) || [];
  const outgoing = graphStore.outgoing.get(node.id) || [];
  const neighborIds = Array.from(
    new Set([
      ...incoming.map(edge => edge.from),
      ...outgoing.map(edge => edge.to)
    ])
  ).filter(nodeId => nodeId !== node.id);
  dom.detailTitle.textContent = node.label || node.id;
  dom.detailBody.innerHTML =
    renderKeyValue({
      id: node.id,
      type: node.type,
      sourcePath: node.sourcePath || '-',
      framework: node.framework || '-',
      incoming: incoming.length,
      outgoing: outgoing.length,
      originalLabel: node.metadata?.originalLabel || '-'
    }) +
    renderNodeFlowCard(node.id, incoming.length, outgoing.length) +
    '<h3 style="margin-top:10px">Neighbors</h3>' + renderNeighborLinks(neighborIds) +
    '<h3 style="margin-top:10px">Metadata</h3><pre>' + esc(JSON.stringify(node.metadata || {}, null, 2)) + '</pre>' +
    '<h3 style="margin-top:10px">Evidence</h3>' + renderEvidence(node.evidence || []);
  bindDetailInteractions();
}

function showEdgeDetail(edge) {
  if (!edge) {
    return;
  }
  const fromNode = graphStore.nodeById.get(edge.from);
  const toNode = graphStore.nodeById.get(edge.to);
  dom.detailTitle.textContent = edge.type + ': ' + edge.from + ' -> ' + edge.to;
  dom.detailBody.innerHTML =
    renderKeyValue({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      type: edge.type,
      confidence: edge.confidence ?? '-',
      label: edge.label || '-'
    }) +
    '<div class="runtime-flow-card">' +
      '<button type="button" class="flow-col flow-in" data-runtime-node-id="' + escAttr(edge.from) + '">' +
        '<b>From</b><small>' + esc(fromNode?.type || '-') + '</small><span>' + esc(fromNode?.label || edge.from) + '</span>' +
      '</button>' +
      '<button type="button" class="flow-col flow-core">' +
        '<b>Edge</b><small>' + esc(edge.type) + '</small><span>' + esc(edge.id || '') + '</span>' +
      '</button>' +
      '<button type="button" class="flow-col flow-out" data-runtime-node-id="' + escAttr(edge.to) + '">' +
        '<b>To</b><small>' + esc(toNode?.type || '-') + '</small><span>' + esc(toNode?.label || edge.to) + '</span>' +
      '</button>' +
    '</div>' +
    '<h3 style="margin-top:10px">Evidence</h3>' + renderEvidence(edge.evidence || []) +
    '<h3 style="margin-top:10px">Metadata</h3><pre>' + esc(JSON.stringify(edge.metadata || {}, null, 2)) + '</pre>';
  bindDetailInteractions();
}

function showWelcome() {
  dom.detailTitle.textContent = 'Select a node or edge';
  dom.detailBody.innerHTML = '<div class="detail-kv"><b>Hint</b><span>Click node/edge to inspect details and evidence.</span></div>';
}

function renderEvidence(evidence) {
  const entries = Array.isArray(evidence) ? evidence : [];
  if (!entries.length) {
    return '<span class="pill">No evidence recorded</span>';
  }
  try {
    return entries.map(item => {
      const lines = [
        typeof item?.sourcePath === 'string' ? item.sourcePath : '-',
        Number.isFinite(item?.line) ? 'line ' + item.line : '',
        Number.isFinite(item?.column) ? 'column ' + item.column : '',
        typeof item?.kind === 'string' ? item.kind : 'unknown',
        typeof item?.text === 'string' ? item.text : ''
      ].filter(Boolean);
      return '<pre>' + esc(lines.join('\\n')) + '</pre>';
    }).join('');
  } catch {
    return '<span class="pill">Evidence rendering fallback</span>';
  }
}

function renderKeyValue(value) {
  return '<div class="detail-kv">' + Object.entries(value)
    .map(([key, data]) => '<b>' + esc(key) + '</b><span>' + esc(String(data)) + '</span>')
    .join('') + '</div>';
}

function renderNodeFlowCard(nodeId, incomingCount, outgoingCount) {
  return '<div class="runtime-flow-card">' +
    '<button type="button" class="flow-col flow-in" data-runtime-action="trace-upstream" data-runtime-node-id="' + escAttr(nodeId) + '">' +
      '<b>Upstream</b><small>dependency providers</small><span>' + esc(String(incomingCount)) + ' edge(s)</span>' +
    '</button>' +
    '<button type="button" class="flow-col flow-core" data-runtime-action="focus-node" data-runtime-node-id="' + escAttr(nodeId) + '">' +
      '<b>Current Node</b><small>lock focus subgraph</small><span>' + esc(nodeId) + '</span>' +
    '</button>' +
    '<button type="button" class="flow-col flow-out" data-runtime-action="trace-downstream" data-runtime-node-id="' + escAttr(nodeId) + '">' +
      '<b>Downstream</b><small>dependent consumers</small><span>' + esc(String(outgoingCount)) + ' edge(s)</span>' +
    '</button>' +
  '</div>';
}

function renderNeighborLinks(nodeIds) {
  if (!nodeIds.length) {
    return '<span class="pill">No direct neighbors</span>';
  }
  return nodeIds
    .slice(0, 60)
    .map(nodeId => {
      const node = graphStore.nodeById.get(nodeId);
      const color = NODE_COLORS[node?.type] || '#64748b';
      return '<span class="neighbor-link" data-runtime-node-id="' + escAttr(nodeId) + '" style="border-left-color:' + escAttr(color) + '">' +
        esc(node?.label || nodeId) +
      '</span>';
    })
    .join('');
}

function bindDetailInteractions() {
  dom.detailBody.querySelectorAll('[data-runtime-node-id]:not([data-runtime-action])').forEach(element => {
    element.addEventListener('click', () => {
      const nodeId = element.getAttribute('data-runtime-node-id');
      if (!nodeId) {
        return;
      }
      selectNode(nodeId);
    });
  });

  dom.detailBody.querySelectorAll('[data-runtime-action="trace-upstream"]').forEach(element => {
    element.addEventListener('click', event => {
      event.stopPropagation();
      const nodeId = element.getAttribute('data-runtime-node-id');
      if (!nodeId) {
        return;
      }
      state.selectedNodeId = nodeId;
      runTrace('upstream');
    });
  });

  dom.detailBody.querySelectorAll('[data-runtime-action="trace-downstream"]').forEach(element => {
    element.addEventListener('click', event => {
      event.stopPropagation();
      const nodeId = element.getAttribute('data-runtime-node-id');
      if (!nodeId) {
        return;
      }
      state.selectedNodeId = nodeId;
      runTrace('downstream');
    });
  });

  dom.detailBody.querySelectorAll('[data-runtime-action="focus-node"]').forEach(element => {
    element.addEventListener('click', event => {
      event.stopPropagation();
      const nodeId = element.getAttribute('data-runtime-node-id');
      if (!nodeId) {
        return;
      }
      state.focusNodeId = nodeId;
      state.selectedNodeId = nodeId;
      state.selectedEdgeId = null;
      state.trace = null;
      state.layoutDirty = true;
      renderGraph();
    });
  });
}

function computeLayout(nodes, edges) {
  if (!nodes.length) {
    return;
  }
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

  edges.forEach(edge => {
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      return;
    }
    indegree.set(edge.to, (indegree.get(edge.to) || 0) + 1);
    outgoing.get(edge.from).push(edge.to);
  });

  const layer = new Map();
  const queue = [];
  indegree.forEach((degree, nodeId) => {
    if (degree === 0) {
      layer.set(nodeId, 0);
      queue.push(nodeId);
    }
  });
  if (!queue.length && nodes.length) {
    layer.set(nodes[0].id, 0);
    queue.push(nodes[0].id);
  }

  while (queue.length) {
    const nodeId = queue.shift();
    const nextLayer = (layer.get(nodeId) || 0) + 1;
    outgoing.get(nodeId).forEach(nextId => {
      if ((layer.get(nextId) ?? -1) < nextLayer) {
        layer.set(nextId, nextLayer);
      }
      indegree.set(nextId, (indegree.get(nextId) || 0) - 1);
      if ((indegree.get(nextId) || 0) <= 0) {
        queue.push(nextId);
      }
    });
  }

  nodes.forEach(node => {
    if (!layer.has(node.id)) {
      layer.set(node.id, 0);
    }
  });

  const lanes = new Map();
  nodes.forEach(node => {
    const currentLayer = layer.get(node.id) || 0;
    const list = lanes.get(currentLayer) || [];
    list.push(node);
    lanes.set(currentLayer, list);
  });

  lanes.forEach((laneNodes, lane) => {
    laneNodes
      .sort((left, right) => String(left.label || left.id).localeCompare(String(right.label || right.id)))
      .forEach((node, index) => {
        state.positions.set(node.id, {
          x: 140 + lane * 280,
          y: 90 + index * 94
        });
      });
  });
}

function computeForceLayout(nodes, edges) {
  if (!state.positions.size) {
    computeDagreLayout(nodes, edges);
  }
  const nodeIds = new Set(nodes.map(node => node.id));
  const iterations = nodes.length > 500 ? 25 : 70;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const deltas = new Map(nodes.map(node => [node.id, { x: 0, y: 0 }]));

    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const leftPos = state.positions.get(nodes[i].id);
        const rightPos = state.positions.get(nodes[j].id);
        if (!leftPos || !rightPos) {
          continue;
        }
        const dx = leftPos.x - rightPos.x;
        const dy = leftPos.y - rightPos.y;
        const distanceSquared = Math.max(100, dx * dx + dy * dy);
        const force = 5600 / distanceSquared;
        deltas.get(nodes[i].id).x += dx * force;
        deltas.get(nodes[i].id).y += dy * force;
        deltas.get(nodes[j].id).x -= dx * force;
        deltas.get(nodes[j].id).y -= dy * force;
      }
    }

    edges.forEach(edge => {
      if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
        return;
      }
      const fromPos = state.positions.get(edge.from);
      const toPos = state.positions.get(edge.to);
      const fromDelta = deltas.get(edge.from);
      const toDelta = deltas.get(edge.to);
      if (!fromPos || !toPos || !fromDelta || !toDelta) {
        return;
      }
      const dx = toPos.x - fromPos.x;
      const dy = toPos.y - fromPos.y;
      const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const force = (distance - 230) * 0.012;
      fromDelta.x += dx / distance * force;
      fromDelta.y += dy / distance * force;
      toDelta.x -= dx / distance * force;
      toDelta.y -= dy / distance * force;
    });

    nodes.forEach(node => {
      const current = state.positions.get(node.id);
      const delta = deltas.get(node.id);
      if (!current || !delta) {
        return;
      }
      state.positions.set(node.id, {
        x: current.x + Math.max(-8, Math.min(8, delta.x)),
        y: current.y + Math.max(-8, Math.min(8, delta.y))
      });
    });
  }
}

function setupPanAndZoom() {
  let panning = false;
  let last = null;

  dom.svg.addEventListener('pointerdown', event => {
    if (event.target.closest && event.target.closest('.runtime-node')) {
      return;
    }
    panning = true;
    last = { x: event.clientX, y: event.clientY };
    dom.svg.classList.add('dragging');
  });

  window.addEventListener('pointermove', event => {
    if (state.draggingNodeId) {
      dragNode(event);
      return;
    }
    if (!panning || !last) {
      return;
    }
    state.transform.x += event.clientX - last.x;
    state.transform.y += event.clientY - last.y;
    last = { x: event.clientX, y: event.clientY };
    applyTransform();
  });

  window.addEventListener('pointerup', () => {
    panning = false;
    state.draggingNodeId = null;
    dom.svg.classList.remove('dragging');
  });

  dom.svg.addEventListener('wheel', event => {
    event.preventDefault();
    const scale = event.deltaY > 0 ? 0.9 : 1.1;
    state.transform.k = Math.max(0.15, Math.min(3, state.transform.k * scale));
    applyTransform();
  }, { passive: false });

  dom.svg.addEventListener('click', event => {
    if (event.target === dom.svg) {
      resetStateAndRender();
    }
  });
}

function startNodeDrag(event, nodeId) {
  state.draggingNodeId = nodeId;
  event.stopPropagation();
}

function dragNode(event) {
  if (!state.draggingNodeId) {
    return;
  }
  const position = clientToGraph(event.clientX, event.clientY);
  state.positions.set(state.draggingNodeId, position);
  renderGraph();
}

function clientToGraph(clientX, clientY) {
  const rect = dom.svg.getBoundingClientRect();
  return {
    x: (clientX - rect.left - state.transform.x) / state.transform.k,
    y: (clientY - rect.top - state.transform.y) / state.transform.k
  };
}

function applyTransform() {
  dom.viewport.setAttribute(
    'transform',
    'translate(' + state.transform.x + ',' + state.transform.y + ') scale(' + state.transform.k + ')'
  );
}

function fitSoon() {
  setTimeout(fitView, 40);
}

function fitView() {
  const graph = getVisibleGraph();
  if (!graph.nodes.length) {
    return;
  }
  const xs = graph.nodes.map(node => state.positions.get(node.id)?.x || 0);
  const ys = graph.nodes.map(node => state.positions.get(node.id)?.y || 0);
  const minX = Math.min(...xs) - 150;
  const maxX = Math.max(...xs) + 150;
  const minY = Math.min(...ys) - 90;
  const maxY = Math.max(...ys) + 90;
  const rect = dom.svg.getBoundingClientRect();
  const scale = Math.max(
    0.15,
    Math.min(
      1.5,
      Math.min(rect.width / Math.max(1, maxX - minX), rect.height / Math.max(1, maxY - minY))
    )
  );
  state.transform.k = scale;
  state.transform.x = (rect.width - (minX + maxX) * scale) / 2;
  state.transform.y = (rect.height - (minY + maxY) * scale) / 2;
  applyTransform();
}

function buildCountMap(values) {
  const map = new Map();
  values.forEach(value => map.set(value, (map.get(value) || 0) + 1));
  return map;
}

function truncate(value, maxLength) {
  const text = String(value || '');
  return text.length > maxLength ? text.slice(0, maxLength - 3) + '...' : text;
}

function cssSafe(value) {
  return String(value || '').replace(/[^\w-]/g, '_');
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[char]));
}

function escAttr(value) {
  return esc(value).replace(/'/g, '&#39;');
}
`;
}

function normalizePositiveInteger(value: number | undefined, fallback: number) {
    return Number.isFinite(value) && (value as number) > 0 ? Math.floor(value as number) : fallback;
}

function escapeHtml(value: string) {
    return value.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char] ?? char));
}
