import * as fs from 'fs';
import { readJsonFile, UpgradeProtocol } from './protocol';

type NodeStatus = 'existing' | 'new' | 'modified' | 'reused' | 'protocol';
type EdgeType = 'create_child' | 'reuse' | 'modify' | 'protocol_target';

interface TriadMapNode {
    nodeId: string;
    category?: string;
    sourcePath?: string;
    fission?: {
        problem?: string;
        demand?: string[];
        answer?: string[];
    };
}

interface KnowledgeNode {
    id: string;
    label: string;
    status: NodeStatus;
    category: string;
    sourcePath: string;
    problem: string;
    demand: string[];
    answer: string[];
    community: string;
    communityName: string;
}

interface KnowledgeEdge {
    from: string;
    to: string;
    type: EdgeType;
    label: string;
    title: string;
    highlighted: boolean;
}

const STATUS_COLORS: Record<NodeStatus, { background: string; border: string; highlight: string }> = {
    existing: { background: '#1f2937', border: '#64748b', highlight: '#94a3b8' },
    reused: { background: '#312e12', border: '#fbbf24', highlight: '#fde68a' },
    modified: { background: '#431407', border: '#f97316', highlight: '#fdba74' },
    new: { background: '#082f49', border: '#38bdf8', highlight: '#7dd3fc' },
    protocol: { background: '#312e81', border: '#a78bfa', highlight: '#ddd6fe' }
};

const COMMUNITY_COLORS: Record<string, string> = {
    frontend: '#4E79A7',
    backend: '#F28E2B',
    core: '#59A14F',
    protocol: '#B07AA1'
};

export function generateDashboard(mapPath: string, protocolPath: string, outputPath: string) {
    if (!fs.existsSync(mapPath) || !fs.existsSync(protocolPath)) {
        throw new Error(`Cannot find required TriadMind files. Map: ${mapPath}, Protocol: ${protocolPath}`);
    }

    const originalMap = readJsonFile<TriadMapNode[]>(mapPath);
    const protocol = readJsonFile<UpgradeProtocol>(protocolPath);
    const graph = buildKnowledgeGraph(originalMap, protocol);
    const html = buildHtml(graph, protocol);

    fs.writeFileSync(outputPath, html, 'utf-8');
}

function buildKnowledgeGraph(originalMap: TriadMapNode[], protocol: UpgradeProtocol) {
    const nodeMap = new Map<string, KnowledgeNode>();
    const edges: KnowledgeEdge[] = [];

    nodeMap.set('__protocol__', {
        id: '__protocol__',
        label: 'Upgrade Protocol',
        status: 'protocol',
        category: 'protocol',
        sourcePath: protocol.mapSource ?? '',
        problem: protocol.userDemand ?? 'TriadMind topology upgrade protocol',
        demand: [],
        answer: [],
        community: 'protocol',
        communityName: 'Protocol'
    });

    originalMap.forEach((node) => {
        nodeMap.set(node.nodeId, toKnowledgeNode(node, 'existing'));
    });

    protocol.actions.forEach((action) => {
        if (action.op === 'reuse') {
            const node = ensureNode(nodeMap, {
                nodeId: action.nodeId,
                fission: {
                    problem: action.reason ?? 'Reused by upgrade protocol',
                    demand: [],
                    answer: []
                }
            });
            node.status = node.status === 'existing' ? 'reused' : node.status;
            edges.push({
                from: '__protocol__',
                to: action.nodeId,
                type: 'reuse',
                label: 'reuse',
                title: action.reason ?? 'reuse existing node',
                highlighted: false
            });
            return;
        }

        if (action.op === 'modify') {
            const node = ensureNode(nodeMap, {
                nodeId: action.nodeId,
                category: action.category,
                sourcePath: action.sourcePath,
                fission: action.fission
            });
            node.status = 'modified';
            node.problem = action.fission.problem;
            node.demand = action.fission.demand;
            node.answer = action.fission.answer;
            edges.push({
                from: '__protocol__',
                to: action.nodeId,
                type: 'modify',
                label: 'modify',
                title: action.reason ?? 'modify node contract',
                highlighted: false
            });

            (action.reuse ?? []).forEach((reuseTarget) => {
                ensureNode(nodeMap, { nodeId: reuseTarget });
                edges.push({
                    from: action.nodeId,
                    to: reuseTarget,
                    type: 'reuse',
                    label: 'reuse',
                    title: `${action.nodeId} reuses ${reuseTarget}`,
                    highlighted: false
                });
            });
            return;
        }

        const newNode = toKnowledgeNode(action.node, 'new');
        nodeMap.set(action.node.nodeId, newNode);
        edges.push({
            from: '__protocol__',
            to: action.node.nodeId,
            type: 'protocol_target',
            label: 'new leaf',
            title: action.reason ?? 'new leaf node proposed by protocol',
            highlighted: true
        });

        ensureNode(nodeMap, { nodeId: action.parentNodeId });
        edges.push({
            from: action.parentNodeId,
            to: action.node.nodeId,
            type: 'create_child',
            label: 'create_child',
            title: `${action.parentNodeId} -> ${action.node.nodeId}`,
            highlighted: true
        });

        (action.reuse ?? []).forEach((reuseTarget) => {
            ensureNode(nodeMap, { nodeId: reuseTarget });
            edges.push({
                from: action.node.nodeId,
                to: reuseTarget,
                type: 'reuse',
                label: 'reuse',
                title: `${action.node.nodeId} reuses ${reuseTarget}`,
                highlighted: false
            });
        });
    });

    const nodes = Array.from(nodeMap.values()).map((node) => ({
        ...node,
        degree: edges.filter((edge) => edge.from === node.id || edge.to === node.id).length
    }));

    const legend = buildLegend(nodes);

    return {
        nodes,
        edges,
        legend,
        stats: {
            nodes: nodes.length,
            edges: edges.length,
            newNodes: nodes.filter((node) => node.status === 'new').length,
            modifiedNodes: nodes.filter((node) => node.status === 'modified').length,
            reusedNodes: nodes.filter((node) => node.status === 'reused').length
        }
    };
}

function toKnowledgeNode(node: TriadMapNode, status: NodeStatus): KnowledgeNode {
    const category = node.category ?? 'core';
    return {
        id: node.nodeId,
        label: node.nodeId,
        status,
        category,
        sourcePath: node.sourcePath ?? '',
        problem: node.fission?.problem ?? '',
        demand: node.fission?.demand ?? [],
        answer: node.fission?.answer ?? [],
        community: category,
        communityName: toCommunityName(category)
    };
}

function ensureNode(nodeMap: Map<string, KnowledgeNode>, node: TriadMapNode) {
    const existing = nodeMap.get(node.nodeId);
    if (existing) {
        return existing;
    }

    const created = toKnowledgeNode(node, 'existing');
    nodeMap.set(node.nodeId, created);
    return created;
}

function buildLegend(nodes: Array<KnowledgeNode & { degree: number }>) {
    const communities = new Map<string, { cid: string; label: string; color: string; count: number }>();
    nodes.forEach((node) => {
        const current =
            communities.get(node.community) ??
            {
                cid: node.community,
                label: node.communityName,
                color: COMMUNITY_COLORS[node.community] ?? '#BAB0AC',
                count: 0
            };
        current.count += 1;
        communities.set(node.community, current);
    });
    return Array.from(communities.values()).sort((left, right) => left.label.localeCompare(right.label));
}

function toCommunityName(category: string) {
    if (category === 'frontend') {
        return 'Frontend';
    }
    if (category === 'backend') {
        return 'Backend';
    }
    if (category === 'protocol') {
        return 'Protocol';
    }
    return 'Core';
}

function buildHtml(
    graph: ReturnType<typeof buildKnowledgeGraph>,
    protocol: UpgradeProtocol
) {
    const visNodes = graph.nodes.map((node) => {
        const color = STATUS_COLORS[node.status];
        const size = node.status === 'new' ? 36 : node.status === 'protocol' ? 32 : 18 + Math.min(node.degree * 4, 20);
        return {
            id: node.id,
            label: node.label,
            shape: node.status === 'protocol' ? 'diamond' : 'dot',
            size,
            borderWidth: node.status === 'new' ? 4 : node.status === 'modified' ? 3 : 1.5,
            color: {
                background: color.background,
                border: color.border,
                highlight: {
                    background: color.highlight,
                    border: color.border
                }
            },
            font: {
                color: '#f8fafc',
                size: node.status === 'new' || node.status === 'modified' || node.status === 'protocol' ? 16 : 0,
                face: 'Inter, Segoe UI, sans-serif'
            },
            title: escapeHtml(node.problem || node.label),
            _status: node.status,
            _category: node.category,
            _community: node.community,
            _community_name: node.communityName,
            _sourcePath: node.sourcePath,
            _problem: node.problem,
            _demand: node.demand,
            _answer: node.answer,
            _degree: node.degree
        };
    });

    const visEdges = graph.edges.map((edge, index) => {
        const style = edgeStyle(edge);
        return {
            id: index,
            from: edge.from,
            to: edge.to,
            label: edge.highlighted ? edge.label : '',
            title: escapeHtml(edge.title),
            dashes: style.dashes,
            width: style.width,
            color: {
                color: style.color,
                highlight: style.highlight,
                opacity: style.opacity
            },
            arrows: {
                to: {
                    enabled: true,
                    scaleFactor: edge.highlighted ? 1.1 : 0.6
                }
            },
            font: {
                align: 'middle',
                color: edge.highlighted ? '#e0f2fe' : '#94a3b8',
                strokeWidth: 3,
                strokeColor: '#0f0f1a'
            },
            smooth: {
                enabled: true,
                type: edge.highlighted ? 'curvedCW' : 'continuous',
                roundness: edge.highlighted ? 0.22 : 0.12
            },
            _type: edge.type,
            _highlighted: edge.highlighted
        };
    });

    const statusSummary = [
        `new: ${graph.stats.newNodes}`,
        `modified: ${graph.stats.modifiedNodes}`,
        `reused: ${graph.stats.reusedNodes}`
    ].join(' · ');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>TriadMind Knowledge Graph Visualizer</title>
<script src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>
${buildStyles()}
</head>
<body>
<div id="graph"></div>
<aside id="sidebar">
  <section id="hero">
    <div class="eyebrow">TriadMind Knowledge Graph</div>
    <h1>拓扑升级知识图谱</h1>
    <p>${escapeHtml(protocol.userDemand ?? 'No user demand provided')}</p>
    <div class="stats">${graph.stats.nodes} nodes · ${graph.stats.edges} edges · ${statusSummary}</div>
  </section>
  <section id="search-wrap">
    <input id="search" type="text" placeholder="Search nodes..." autocomplete="off">
    <div id="search-results"></div>
  </section>
  <section id="status-legend">
    <h3>Status</h3>
    <div class="status-row"><span class="status-dot status-new"></span>new leaf node</div>
    <div class="status-row"><span class="status-dot status-modified"></span>modified node</div>
    <div class="status-row"><span class="status-dot status-reused"></span>reused node</div>
    <div class="status-row"><span class="status-line"></span>highlighted create_child edge</div>
  </section>
  <section id="info-panel">
    <h3>Node Info</h3>
    <div id="info-content"><span class="empty">Click a node to inspect it</span></div>
  </section>
  <section id="legend-wrap">
    <h3>Communities</h3>
    <div id="legend"></div>
  </section>
</aside>
${buildScript(visNodes, visEdges, graph.legend)}
</body>
</html>`;
}

function edgeStyle(edge: KnowledgeEdge) {
    if (edge.type === 'create_child') {
        return { color: '#38bdf8', highlight: '#7dd3fc', width: 5, opacity: 0.95, dashes: false };
    }
    if (edge.type === 'protocol_target') {
        return { color: '#a78bfa', highlight: '#ddd6fe', width: 3, opacity: 0.75, dashes: [8, 5] };
    }
    if (edge.type === 'modify') {
        return { color: '#fb923c', highlight: '#fdba74', width: 3, opacity: 0.8, dashes: false };
    }
    return { color: '#fbbf24', highlight: '#fde68a', width: 2, opacity: 0.55, dashes: [6, 4] };
}

function buildStyles() {
    return `<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #0f0f1a;
    color: #e0e0e0;
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    display: flex;
    height: 100vh;
    overflow: hidden;
  }
  #graph { flex: 1; min-width: 0; }
  #sidebar {
    width: 340px;
    background: #1a1a2e;
    border-left: 1px solid #2a2a4e;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  #hero { padding: 16px; border-bottom: 1px solid #2a2a4e; }
  .eyebrow { color: #38bdf8; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 8px; }
  h1 { font-size: 18px; margin-bottom: 8px; color: #f8fafc; }
  #hero p { color: #cbd5e1; font-size: 12px; line-height: 1.5; max-height: 58px; overflow: auto; }
  .stats { color: #94a3b8; font-size: 11px; margin-top: 10px; }
  #search-wrap { padding: 12px; border-bottom: 1px solid #2a2a4e; }
  #search {
    width: 100%;
    background: #0f0f1a;
    border: 1px solid #3a3a5e;
    color: #e0e0e0;
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 13px;
    outline: none;
  }
  #search:focus { border-color: #38bdf8; }
  #search-results {
    max-height: 150px;
    overflow-y: auto;
    display: none;
    padding-top: 8px;
  }
  .search-item {
    padding: 5px 8px;
    cursor: pointer;
    border-radius: 4px;
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .search-item:hover { background: #2a2a4e; }
  #status-legend, #info-panel, #legend-wrap {
    padding: 14px;
    border-bottom: 1px solid #2a2a4e;
  }
  #legend-wrap { flex: 1; overflow-y: auto; }
  h3 {
    font-size: 12px;
    color: #aaa;
    margin-bottom: 10px;
    text-transform: uppercase;
    letter-spacing: .05em;
  }
  .status-row {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #cbd5e1;
    font-size: 12px;
    padding: 3px 0;
  }
  .status-dot {
    width: 12px;
    height: 12px;
    border-radius: 999px;
    display: inline-block;
    border: 2px solid currentColor;
  }
  .status-new { color: #38bdf8; background: #082f49; box-shadow: 0 0 14px rgba(56,189,248,.8); }
  .status-modified { color: #fb923c; background: #431407; }
  .status-reused { color: #fbbf24; background: #312e12; }
  .status-line {
    width: 22px;
    height: 3px;
    background: #38bdf8;
    box-shadow: 0 0 10px rgba(56,189,248,.9);
    display: inline-block;
  }
  #info-content {
    font-size: 12px;
    color: #ccc;
    line-height: 1.55;
    max-height: 260px;
    overflow-y: auto;
  }
  #info-content .field { margin-bottom: 6px; word-break: break-word; }
  #info-content .field b { color: #f8fafc; }
  #info-content .empty { color: #64748b; font-style: italic; }
  .pill {
    display: inline-block;
    padding: 2px 6px;
    border-radius: 999px;
    background: #0f172a;
    border: 1px solid #334155;
    margin: 2px 4px 2px 0;
    color: #cbd5e1;
  }
  .neighbor-link {
    display: block;
    padding: 3px 6px;
    margin: 3px 0;
    border-radius: 3px;
    cursor: pointer;
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    border-left: 3px solid #333;
  }
  .neighbor-link:hover { background: #2a2a4e; }
  .legend-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 0;
    cursor: pointer;
    border-radius: 4px;
    font-size: 12px;
  }
  .legend-item:hover { background: #2a2a4e; padding-left: 4px; }
  .legend-item.dimmed { opacity: .35; }
  .legend-dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
  .legend-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .legend-count { color: #777; font-size: 11px; }
</style>`;
}

function buildScript(nodes: unknown[], edges: unknown[], legend: unknown[]) {
    return `<script>
const RAW_NODES = ${jsSafe(nodes)};
const RAW_EDGES = ${jsSafe(edges)};
const LEGEND = ${jsSafe(legend)};

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

const nodesDS = new vis.DataSet(RAW_NODES);
const edgesDS = new vis.DataSet(RAW_EDGES);
const container = document.getElementById('graph');
const network = new vis.Network(container, { nodes: nodesDS, edges: edgesDS }, {
  physics: {
    enabled: true,
    solver: 'forceAtlas2Based',
    forceAtlas2Based: {
      gravitationalConstant: -75,
      centralGravity: 0.006,
      springLength: 150,
      springConstant: 0.08,
      damping: 0.42,
      avoidOverlap: 0.9
    },
    stabilization: { iterations: 260, fit: true }
  },
  interaction: {
    hover: true,
    tooltipDelay: 120,
    hideEdgesOnDrag: true,
    navigationButtons: true,
    keyboard: false
  },
  nodes: {
    shadow: { enabled: true, color: 'rgba(0,0,0,.35)', size: 12, x: 0, y: 2 }
  },
  edges: {
    selectionWidth: 4
  }
});

network.once('stabilizationIterationsDone', () => {
  network.setOptions({ physics: { enabled: false } });
});

network.on('afterDrawing', function(ctx) {
  RAW_NODES.filter(n => n._status === 'new').forEach(n => {
    const pos = network.getPositions([n.id])[n.id];
    if (!pos) return;
    ctx.save();
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 48, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(56,189,248,.65)';
    ctx.lineWidth = 4;
    ctx.shadowColor = '#38bdf8';
    ctx.shadowBlur = 24;
    ctx.stroke();
    ctx.restore();
  });
});

function showInfo(nodeId) {
  const n = nodesDS.get(nodeId);
  if (!n) return;
  const neighborIds = network.getConnectedNodes(nodeId);
  const neighborItems = neighborIds.map(nid => {
    const nb = nodesDS.get(nid);
    const color = nb?.color?.background ?? '#555';
    return '<span class="neighbor-link" style="border-left-color:' + esc(color) + '" onclick="focusNode(' + JSON.stringify(nid).replace(/"/g, '&quot;') + ')">' + esc(nb ? nb.label : nid) + '</span>';
  }).join('');
  const demand = Array.isArray(n._demand) && n._demand.length ? n._demand.map(x => '<span class="pill">' + esc(x) + '</span>').join('') : '<span class="empty">None</span>';
  const answer = Array.isArray(n._answer) && n._answer.length ? n._answer.map(x => '<span class="pill">' + esc(x) + '</span>').join('') : '<span class="empty">None</span>';
  document.getElementById('info-content').innerHTML = \`
    <div class="field"><b>\${esc(n.label)}</b></div>
    <div class="field">Status: <span class="pill">\${esc(n._status)}</span></div>
    <div class="field">Community: \${esc(n._community_name)}</div>
    <div class="field">Source: \${esc(n._sourcePath || '-')}</div>
    <div class="field">Problem: \${esc(n._problem || '-')}</div>
    <div class="field">Demand: \${demand}</div>
    <div class="field">Answer: \${answer}</div>
    <div class="field">Degree: \${esc(n._degree)}</div>
    \${neighborIds.length ? '<div class="field" style="margin-top:8px;color:#aaa;font-size:11px">Neighbors (' + neighborIds.length + ')</div>' + neighborItems : ''}
  \`;
}

function focusNode(nodeId) {
  network.focus(nodeId, { scale: 1.35, animation: true });
  network.selectNodes([nodeId]);
  showInfo(nodeId);
}

let hoveredNodeId = null;
network.on('hoverNode', params => {
  hoveredNodeId = params.node;
  container.style.cursor = 'pointer';
});
network.on('blurNode', () => {
  hoveredNodeId = null;
  container.style.cursor = 'default';
});
network.on('click', params => {
  if (params.nodes.length > 0) {
    showInfo(params.nodes[0]);
  } else if (hoveredNodeId === null) {
    document.getElementById('info-content').innerHTML = '<span class="empty">Click a node to inspect it</span>';
  }
});

const searchInput = document.getElementById('search');
const searchResults = document.getElementById('search-results');
searchInput.addEventListener('input', () => {
  const q = searchInput.value.toLowerCase().trim();
  searchResults.innerHTML = '';
  if (!q) { searchResults.style.display = 'none'; return; }
  const matches = RAW_NODES.filter(n => n.label.toLowerCase().includes(q)).slice(0, 20);
  if (!matches.length) { searchResults.style.display = 'none'; return; }
  searchResults.style.display = 'block';
  matches.forEach(n => {
    const el = document.createElement('div');
    el.className = 'search-item';
    el.textContent = n.label;
    el.style.borderLeft = '3px solid ' + (n.color?.border ?? '#555');
    el.onclick = () => {
      focusNode(n.id);
      searchResults.style.display = 'none';
      searchInput.value = '';
    };
    searchResults.appendChild(el);
  });
});

const hiddenCommunities = new Set();
const legendEl = document.getElementById('legend');
LEGEND.forEach(c => {
  const item = document.createElement('div');
  item.className = 'legend-item';
  item.innerHTML = '<div class="legend-dot" style="background:' + esc(c.color) + '"></div>' +
    '<span class="legend-label">' + esc(c.label) + '</span>' +
    '<span class="legend-count">' + esc(c.count) + '</span>';
  item.onclick = () => {
    if (hiddenCommunities.has(c.cid)) {
      hiddenCommunities.delete(c.cid);
      item.classList.remove('dimmed');
    } else {
      hiddenCommunities.add(c.cid);
      item.classList.add('dimmed');
    }
    nodesDS.update(RAW_NODES
      .filter(n => n._community === c.cid)
      .map(n => ({ id: n.id, hidden: hiddenCommunities.has(c.cid) })));
  };
  legendEl.appendChild(item);
});

const firstNew = RAW_NODES.find(n => n._status === 'new');
if (firstNew) {
  setTimeout(() => focusNode(firstNew.id), 350);
}
</script>`;
}

function jsSafe(value: unknown) {
    return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function escapeHtml(value: string) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
