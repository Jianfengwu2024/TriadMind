
import * as fs from 'fs';
import { readJsonFile, UpgradeProtocol } from './protocol';
import {
    generateMayaFeatureHash,
    generateMayaSequence,
    mapTopologyToYoungPartition,
    normalizeSubgraph
} from './analyzer';

type NodeStatus = 'existing' | 'new' | 'modified' | 'reused' | 'protocol' | 'left_branch' | 'right_branch' | 'macro';
type EdgeType = 'create_child' | 'reuse' | 'modify' | 'protocol_target' | 'triad_left' | 'triad_right' | 'renormalize_absorb' | 'renormalize_contract';
type TriadNodeKind = 'vertex' | 'left_branch' | 'right_branch' | 'protocol' | 'macro';

interface TriadMapNode {
    nodeId: string;
    category?: string;
    sourcePath?: string;
    fission?: { problem?: string; demand?: string[]; answer?: string[] };
}

interface RenormalizeProtocol {
    actions?: RenormalizeAction[];
    summary?: string[];
}

interface RenormalizeAction {
    op: 'create_macro_node';
    macro_node_id: string;
    absorbed_nodes: string[];
    new_demand: string[];
    new_answer: string[];
    rationale?: string;
}

interface MayaFingerprint {
    key: string;
    title: string;
    scope: 'project' | 'feature' | 'macro';
    nodeIds: string[];
    normalizedNodeIds: string[];
    partition: number[];
    sequence: number[];
    hash: string;
    stones: string[];
}

interface MayaPanelData {
    project: MayaFingerprint;
    byOwner: Record<string, MayaFingerprint>;
    byMacro: Record<string, MayaFingerprint>;
}

interface KnowledgeNode {
    id: string;
    label: string;
    status: NodeStatus;
    kind: TriadNodeKind;
    category: string;
    sourcePath: string;
    problem: string;
    demand: string[];
    answer: string[];
    community: string;
    communityName: string;
    triadOwner: string;
    branchTitle: string;
    absorbedNodes: string[];
    rationale: string;
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
    protocol: { background: '#312e81', border: '#a78bfa', highlight: '#ddd6fe' },
    left_branch: { background: '#052e16', border: '#22c55e', highlight: '#86efac' },
    right_branch: { background: '#2e1065', border: '#c084fc', highlight: '#e9d5ff' },
    macro: { background: '#3f0d12', border: '#f43f5e', highlight: '#fda4af' }
};

const COMMUNITY_COLORS: Record<string, string> = {
    frontend: '#4E79A7', backend: '#F28E2B', core: '#59A14F', protocol: '#B07AA1', macro: '#E15759'
};

const MACRO_CLUSTER_PALETTE = ['#f43f5e', '#38bdf8', '#f59e0b', '#22c55e', '#a78bfa', '#14b8a6'];
const VISUALIZER_STRICT_MAYA_LIMIT = 6;

export function generateDashboard(mapPath: string, protocolPath: string, outputPath: string) {
    if (!fs.existsSync(mapPath) || !fs.existsSync(protocolPath)) {
        throw new Error(`Cannot find required TriadMind files. Map: ${mapPath}, Protocol: ${protocolPath}`);
    }

    const originalMap = readJsonFile<TriadMapNode[]>(mapPath);
    const protocol = readJsonFile<UpgradeProtocol>(protocolPath);
    const renormalizeProtocol = readRenormalizeProtocol(mapPath, outputPath);
    const graph = buildKnowledgeGraph(originalMap, protocol, renormalizeProtocol);
    const previewMap = buildPreviewTopology(originalMap, protocol);
    const mayaData = buildMayaPanelData(previewMap, renormalizeProtocol);
    fs.writeFileSync(outputPath, buildHtml(graph, protocol, mayaData, renormalizeProtocol), 'utf-8');
}

function readRenormalizeProtocol(mapPath: string, outputPath: string) {
    const candidates = [
        outputPath.replace(/visualizer\.html$/i, 'renormalize-protocol.json'),
        mapPath.replace(/triad-map\.json$/i, 'renormalize-protocol.json')
    ];
    for (const candidate of candidates) {
        if (!fs.existsSync(candidate)) continue;
        try { return readJsonFile<RenormalizeProtocol>(candidate); } catch { return undefined; }
    }
    return undefined;
}

function buildKnowledgeGraph(originalMap: TriadMapNode[], protocol: UpgradeProtocol, renormalizeProtocol?: RenormalizeProtocol) {
    const nodeMap = new Map<string, KnowledgeNode>();
    const edges: KnowledgeEdge[] = [];

    nodeMap.set('__protocol__', {
        id: '__protocol__', label: 'Upgrade Protocol', status: 'protocol', kind: 'protocol', category: 'protocol',
        sourcePath: protocol.mapSource ?? '', problem: protocol.userDemand ?? 'TriadMind topology upgrade protocol',
        demand: [], answer: [], community: 'protocol', communityName: 'Protocol', triadOwner: '__protocol__',
        branchTitle: 'Protocol vertex', absorbedNodes: [], rationale: protocol.userDemand ?? ''
    });

    originalMap.forEach((node) => upsertTriadVertex(nodeMap, edges, node, 'existing'));

    protocol.actions.forEach((action) => {
        if (action.op === 'reuse') {
            const node = ensureNode(nodeMap, edges, { nodeId: action.nodeId, fission: { problem: action.reason ?? 'Reused by protocol', demand: [], answer: [] } });
            node.status = node.status === 'existing' ? 'reused' : node.status;
            edges.push({ from: '__protocol__', to: action.nodeId, type: 'reuse', label: 'reuse', title: action.reason ?? 'reuse existing node', highlighted: false });
            return;
        }
        if (action.op === 'modify') {
            const node = ensureNode(nodeMap, edges, { nodeId: action.nodeId, category: action.category, sourcePath: action.sourcePath, fission: action.fission });
            node.status = 'modified';
            node.problem = action.fission.problem; node.demand = action.fission.demand; node.answer = action.fission.answer;
            edges.push({ from: '__protocol__', to: action.nodeId, type: 'modify', label: 'modify', title: action.reason ?? 'modify node contract', highlighted: false });
            (action.reuse ?? []).forEach((reuseTarget) => {
                ensureNode(nodeMap, edges, { nodeId: reuseTarget });
                edges.push({ from: action.nodeId, to: reuseTarget, type: 'reuse', label: 'reuse', title: `${action.nodeId} reuses ${reuseTarget}`, highlighted: false });
            });
            return;
        }
        upsertTriadVertex(nodeMap, edges, action.node, 'new');
        edges.push({ from: '__protocol__', to: action.node.nodeId, type: 'protocol_target', label: 'new leaf', title: action.reason ?? 'new leaf node proposed by protocol', highlighted: true });
        ensureNode(nodeMap, edges, { nodeId: action.parentNodeId });
        edges.push({ from: action.parentNodeId, to: action.node.nodeId, type: 'create_child', label: 'create_child', title: `${action.parentNodeId} -> ${action.node.nodeId}`, highlighted: true });
    });

    (renormalizeProtocol?.actions ?? []).forEach((action) => {
        if (action.op !== 'create_macro_node') return;
        nodeMap.set(action.macro_node_id, {
            id: action.macro_node_id, label: action.macro_node_id, status: 'macro', kind: 'macro', category: 'core', sourcePath: '',
            problem: action.rationale ?? 'Renormalized macro node', demand: action.new_demand ?? [], answer: action.new_answer ?? [],
            community: 'macro', communityName: 'Renormalized Macro', triadOwner: action.macro_node_id,
            branchTitle: 'Macro vertex: renormalized strongly connected component', absorbedNodes: action.absorbed_nodes ?? [], rationale: action.rationale ?? ''
        });
        (action.absorbed_nodes ?? []).forEach((nodeId) => {
            ensureNode(nodeMap, edges, { nodeId });
            addUniqueEdge(edges, { from: action.macro_node_id, to: nodeId, type: 'renormalize_absorb', label: 'absorbs', title: `${action.macro_node_id} absorbs ${nodeId}`, highlighted: true });
        });
        if ((action.new_demand ?? []).length > 0 || (action.new_answer ?? []).length > 0) {
            addUniqueEdge(edges, { from: '__protocol__', to: action.macro_node_id, type: 'renormalize_contract', label: 'renormalize', title: `${action.macro_node_id} exposes external contract boundary`, highlighted: false });
        }
    });

    const nodes = Array.from(nodeMap.values()).map((node) => ({ ...node, degree: edges.filter((edge) => edge.from === node.id || edge.to === node.id).length }));
    return {
        nodes,
        edges,
        legend: buildLegend(nodes),
        stats: {
            nodes: nodes.length,
            edges: edges.length,
            vertices: nodes.filter((node) => node.kind === 'vertex').length,
            macroNodes: nodes.filter((node) => node.kind === 'macro').length,
            branchNodes: nodes.filter((node) => node.kind === 'left_branch' || node.kind === 'right_branch').length,
            newNodes: nodes.filter((node) => node.status === 'new').length,
            modifiedNodes: nodes.filter((node) => node.status === 'modified').length,
            reusedNodes: nodes.filter((node) => node.status === 'reused').length
        }
    };
}

function toKnowledgeNode(node: TriadMapNode, status: NodeStatus): KnowledgeNode {
    const category = node.category ?? 'core';
    return {
        id: node.nodeId, label: node.nodeId, status, kind: 'vertex', category, sourcePath: node.sourcePath ?? '',
        problem: node.fission?.problem ?? '', demand: node.fission?.demand ?? [], answer: node.fission?.answer ?? [],
        community: category, communityName: toCommunityName(category), triadOwner: node.nodeId,
        branchTitle: 'Vertex: wraps dynamic left branch and static right branch', absorbedNodes: [], rationale: ''
    };
}

function ensureNode(nodeMap: Map<string, KnowledgeNode>, edges: KnowledgeEdge[], node: TriadMapNode) {
    return nodeMap.get(node.nodeId) ?? upsertTriadVertex(nodeMap, edges, node, 'existing');
}

function upsertTriadVertex(nodeMap: Map<string, KnowledgeNode>, edges: KnowledgeEdge[], node: TriadMapNode, status: NodeStatus) {
    const vertex = toKnowledgeNode(node, status);
    const existing = nodeMap.get(vertex.id);
    if (existing) {
        if (status === 'new' || status === 'modified' || status === 'reused') existing.status = status;
        existing.category = vertex.category; existing.sourcePath = vertex.sourcePath; existing.problem = vertex.problem; existing.demand = vertex.demand; existing.answer = vertex.answer;
        addTriadBranches(nodeMap, edges, existing);
        return existing;
    }
    nodeMap.set(vertex.id, vertex);
    addTriadBranches(nodeMap, edges, vertex);
    return vertex;
}

function addTriadBranches(nodeMap: Map<string, KnowledgeNode>, edges: KnowledgeEdge[], vertex: KnowledgeNode) {
    if (vertex.id === '__protocol__' || vertex.kind !== 'vertex') return;
    const leftId = `${vertex.id}::__left`;
    const rightId = `${vertex.id}::__right`;
    nodeMap.set(leftId, { ...vertex, id: leftId, label: `L · ${getMethodName(vertex.id)}`, status: 'left_branch', kind: 'left_branch', branchTitle: 'Dynamic left branch: action / method / flow execution', triadOwner: vertex.id });
    nodeMap.set(rightId, { ...vertex, id: rightId, label: 'R · contract', status: 'right_branch', kind: 'right_branch', problem: `Static contract: ${vertex.sourcePath || vertex.category}`, branchTitle: 'Static right branch: state / config / demand-answer contract', triadOwner: vertex.id });
    addUniqueEdge(edges, { from: leftId, to: vertex.id, type: 'triad_left', label: 'left', title: `${vertex.id} dynamic left branch`, highlighted: vertex.status === 'new' || vertex.status === 'modified' });
    addUniqueEdge(edges, { from: rightId, to: vertex.id, type: 'triad_right', label: 'right', title: `${vertex.id} static right branch`, highlighted: vertex.status === 'new' || vertex.status === 'modified' });
}

function addUniqueEdge(edges: KnowledgeEdge[], edge: KnowledgeEdge) {
    if (!edges.some((item) => item.from === edge.from && item.to === edge.to && item.type === edge.type)) edges.push(edge);
}

function getMethodName(nodeId: string) {
    const parts = nodeId.split('.').filter(Boolean);
    return parts[parts.length - 1] ?? nodeId;
}

function buildLegend(nodes: Array<KnowledgeNode & { degree: number }>) {
    const communities = new Map<string, { cid: string; label: string; color: string; count: number }>();
    nodes.forEach((node) => {
        const current = communities.get(node.community) ?? { cid: node.community, label: node.communityName, color: COMMUNITY_COLORS[node.community] ?? '#BAB0AC', count: 0 };
        current.count += 1;
        communities.set(node.community, current);
    });
    return Array.from(communities.values()).sort((left, right) => left.label.localeCompare(right.label));
}

function toCommunityName(category: string) {
    if (category === 'frontend') return 'Frontend';
    if (category === 'backend') return 'Backend';
    if (category === 'protocol') return 'Protocol';
    return 'Core';
}
function buildHtml(
    graph: ReturnType<typeof buildKnowledgeGraph>,
    protocol: UpgradeProtocol,
    mayaData: MayaPanelData,
    renormalizeProtocol?: RenormalizeProtocol
) {
    const macroActions = renormalizeProtocol?.actions ?? [];
    const macroColorMap = new Map<string, string>();
    const absorbedOwnerMap = new Map<string, string>();

    macroActions.forEach((action, index) => {
        const color = MACRO_CLUSTER_PALETTE[index % MACRO_CLUSTER_PALETTE.length];
        macroColorMap.set(action.macro_node_id, color);
        action.absorbed_nodes.forEach((nodeId) => absorbedOwnerMap.set(nodeId, action.macro_node_id));
    });

    const visNodes = graph.nodes.map((node) => {
        const color = STATUS_COLORS[node.status];
        const ownerId =
            node.status === 'macro'
                ? node.id
                : absorbedOwnerMap.get(node.id) ??
                  (node.kind === 'left_branch' || node.kind === 'right_branch' ? absorbedOwnerMap.get(node.triadOwner) : undefined);
        const macroColor = ownerId ? macroColorMap.get(ownerId) : undefined;
        const size = node.kind === 'left_branch' || node.kind === 'right_branch' ? 15 : node.status === 'macro' ? 42 : node.status === 'new' ? 38 : node.status === 'protocol' ? 34 : 20 + Math.min(node.degree * 4, 20);
        return {
            id: node.id,
            label: node.label,
            shape: node.status === 'protocol' ? 'diamond' : node.status === 'macro' ? 'star' : node.kind === 'left_branch' ? 'box' : node.kind === 'right_branch' ? 'hexagon' : 'dot',
            size,
            borderWidth: node.status === 'new' ? 4 : node.status === 'macro' ? 4 : node.status === 'modified' ? 3 : node.kind === 'left_branch' || node.kind === 'right_branch' ? 2 : 1.5,
            color: {
                background: node.status === 'macro' && macroColor ? `${macroColor}22` : color.background,
                border: macroColor ?? color.border,
                highlight: { background: node.status === 'macro' && macroColor ? `${macroColor}33` : color.highlight, border: macroColor ?? color.border }
            },
            font: { color: '#f8fafc', size: node.status === 'existing' ? 0 : 14, face: 'Inter, Segoe UI, sans-serif' },
            title: escapeHtml(node.problem || node.label),
            _status: node.status, _kind: node.kind, _community: node.community, _community_name: node.communityName, _sourcePath: node.sourcePath,
            _problem: node.problem, _demand: node.demand, _answer: node.answer, _degree: node.degree, _triadOwner: node.triadOwner,
            _branchTitle: node.branchTitle, _absorbedNodes: node.absorbedNodes, _rationale: node.rationale, _macroOwner: ownerId ?? '', _macroColor: macroColor ?? ''
        };
    });

    const visEdges = graph.edges.map((edge, index) => {
        const style = edgeStyle(edge);
        return {
            id: index, from: edge.from, to: edge.to, label: edge.highlighted ? edge.label : '', title: escapeHtml(edge.title),
            dashes: style.dashes, width: style.width,
            color: { color: style.color, highlight: style.highlight, opacity: style.opacity },
            arrows: { to: { enabled: true, scaleFactor: edge.highlighted ? 1.1 : 0.6 } },
            font: { align: 'middle', color: edge.highlighted ? '#e0f2fe' : '#94a3b8', strokeWidth: 3, strokeColor: '#0f0f1a' },
            smooth: { enabled: true, type: edge.highlighted ? 'curvedCW' : 'continuous', roundness: edge.highlighted ? 0.22 : 0.12 },
            _type: edge.type,
            _highlighted: edge.highlighted
        };
    });

    const statusSummary = [
        `vertices: ${graph.stats.vertices}`,
        `macro: ${graph.stats.macroNodes}`,
        `branches: ${graph.stats.branchNodes}`,
        `new: ${graph.stats.newNodes}`,
        `modified: ${graph.stats.modifiedNodes}`,
        `reused: ${graph.stats.reusedNodes}`
    ].join(' · ');

    const renormalizeSummary = (renormalizeProtocol?.summary ?? []).length
        ? (renormalizeProtocol?.summary ?? []).map((item) => `<div class="status-row">${escapeHtml(item)}</div>`).join('')
        : '<div class="status-row"><span class="empty">No renormalization overlay loaded</span></div>';

    const projectMayaSummary = renderMayaFingerprintMarkup(mayaData.project);

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>TriadMind Knowledge Graph Visualizer</title>
<script src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>
${buildStyles()}
</head>
<body>
<div id="graph"></div>
<aside id="sidebar">
  <section id="hero"><div class="eyebrow">TriadMind Knowledge Graph</div><h1>拓扑升级知识图谱</h1><p>${escapeHtml(protocol.userDemand ?? 'No user demand provided')}</p><div class="stats">${graph.stats.nodes} nodes · ${graph.stats.edges} edges · ${statusSummary}</div></section>
  <section id="search-wrap"><input id="search" type="text" placeholder="Search nodes..." autocomplete="off"><div id="search-results"></div></section>
  <section id="status-legend">
    <h3>Status</h3>
    <div class="triad-explain">
      <div><span class="branch-chip left-chip">L</span>dynamic evolution: action / method / flow</div>
      <div><span class="branch-chip vertex-chip">V</span>vertex: usable feature wrapping both branches</div>
      <div><span class="branch-chip right-chip">R</span>static stability: state / config / contract</div>
    </div>
    <div class="status-row"><span class="status-dot status-new"></span>new leaf node</div>
    <div class="status-row"><span class="status-dot status-modified"></span>modified node</div>
    <div class="status-row"><span class="status-dot status-reused"></span>reused node</div>
    <div class="status-row"><span class="status-dot status-left"></span>left branch</div>
    <div class="status-row"><span class="status-dot status-right"></span>right branch</div>
    <div class="status-row"><span class="status-dot status-macro"></span>macro node</div>
    <div class="status-row"><span class="status-line"></span>highlighted leaf / absorb edge</div>
  </section>
  <section id="maya-panel">
    <h3>Maya Fingerprint</h3>
    <div class="maya-block">
      <div class="maya-caption">Project Topology</div>
      <div id="maya-project">${projectMayaSummary}</div>
    </div>
    <div class="maya-block">
      <div class="maya-caption">Focused Feature</div>
      <div id="maya-feature"><span class="empty">Click a vertex or macro node to inspect its Young partition and Maya stones</span></div>
    </div>
  </section>
  <section id="renormalize-panel"><h3>Renormalize</h3>${renormalizeSummary}</section>
  <section id="info-panel"><h3>Node Info</h3><div id="info-content"><span class="empty">Click a node to inspect it</span></div></section>
  <section id="legend-wrap"><h3>Communities</h3><div id="legend"></div></section>
</aside>
<div id="cluster-controls"><button id="toggle-clusters" type="button">Collapse Macro Clusters</button></div>
${buildScript(visNodes, visEdges, graph.legend, mayaData)}
</body>
</html>`;
}

function edgeStyle(edge: KnowledgeEdge) {
    if (edge.type === 'triad_left') return { color: '#22c55e', highlight: '#86efac', width: edge.highlighted ? 3 : 1.7, opacity: 0.68, dashes: false };
    if (edge.type === 'triad_right') return { color: '#c084fc', highlight: '#e9d5ff', width: edge.highlighted ? 3 : 1.7, opacity: 0.68, dashes: [4, 3] };
    if (edge.type === 'create_child') return { color: '#38bdf8', highlight: '#7dd3fc', width: 5, opacity: 0.95, dashes: false };
    if (edge.type === 'protocol_target') return { color: '#a78bfa', highlight: '#ddd6fe', width: 3, opacity: 0.75, dashes: [8, 5] };
    if (edge.type === 'modify') return { color: '#fb923c', highlight: '#fdba74', width: 3, opacity: 0.8, dashes: false };
    if (edge.type === 'renormalize_absorb') return { color: '#f43f5e', highlight: '#fda4af', width: 4, opacity: 0.92, dashes: [10, 4] };
    if (edge.type === 'renormalize_contract') return { color: '#fb7185', highlight: '#fecdd3', width: 2.5, opacity: 0.65, dashes: [3, 4] };
    return { color: '#fbbf24', highlight: '#fde68a', width: 2, opacity: 0.55, dashes: [6, 4] };
}

function buildStyles() {
    return `<style>
*{box-sizing:border-box;margin:0;padding:0}body{background:#0f0f1a;color:#e0e0e0;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;height:100vh;overflow:hidden}#graph{flex:1;min-width:0}#sidebar{width:380px;background:#1a1a2e;border-left:1px solid #2a2a4e;display:flex;flex-direction:column;overflow:hidden}#hero{padding:16px;border-bottom:1px solid #2a2a4e}.eyebrow{color:#38bdf8;font-size:11px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px}h1{font-size:18px;margin-bottom:8px;color:#f8fafc}#hero p{color:#cbd5e1;font-size:12px;line-height:1.5;max-height:58px;overflow:auto}.stats{color:#94a3b8;font-size:11px;margin-top:10px}#search-wrap{padding:12px;border-bottom:1px solid #2a2a4e}#search{width:100%;background:#0f0f1a;border:1px solid #3a3a5e;color:#e0e0e0;padding:8px 10px;border-radius:6px;font-size:13px;outline:none}#search:focus{border-color:#38bdf8}#search-results{max-height:150px;overflow-y:auto;display:none;padding-top:8px}#status-legend,#maya-panel,#renormalize-panel,#info-panel,#legend-wrap{padding:14px;border-bottom:1px solid #2a2a4e}#legend-wrap{flex:1;overflow-y:auto}#cluster-controls{position:absolute;top:16px;left:16px;z-index:20}#cluster-controls button{background:#0f172a;border:1px solid #475569;color:#e2e8f0;padding:8px 12px;border-radius:999px;cursor:pointer;font-size:12px;box-shadow:0 10px 24px rgba(0,0,0,.25)}#cluster-controls button:hover{filter:brightness(1.1)}h3{font-size:12px;color:#aaa;margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em}.status-row{display:flex;align-items:center;gap:8px;color:#cbd5e1;font-size:12px;padding:3px 0;line-height:1.5}.status-dot{width:12px;height:12px;border-radius:999px;display:inline-block;border:2px solid currentColor;flex-shrink:0}.status-new{color:#38bdf8;background:#082f49;box-shadow:0 0 14px rgba(56,189,248,.8)}.status-modified{color:#fb923c;background:#431407}.status-reused{color:#fbbf24;background:#312e12}.status-left{color:#22c55e;background:#052e16}.status-right{color:#c084fc;background:#2e1065}.status-macro{color:#f43f5e;background:#3f0d12}.status-line{width:22px;height:3px;background:#38bdf8;box-shadow:0 0 10px rgba(56,189,248,.9);display:inline-block;flex-shrink:0}.triad-explain{background:#0f172a;border:1px solid #334155;border-radius:8px;padding:9px;margin-bottom:10px;color:#cbd5e1;font-size:11px;line-height:1.7}.branch-chip{display:inline-block;min-width:24px;text-align:center;border-radius:999px;padding:1px 6px;margin-right:6px;font-weight:700}.left-chip{background:#052e16;color:#86efac;border:1px solid #22c55e}.vertex-chip{background:#082f49;color:#7dd3fc;border:1px solid #38bdf8}.right-chip{background:#2e1065;color:#e9d5ff;border:1px solid #c084fc}.maya-block{background:#0f172a;border:1px solid #334155;border-radius:10px;padding:10px;margin-bottom:10px}.maya-block:last-child{margin-bottom:0}.maya-caption{font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px}.maya-grid{display:grid;gap:7px}.maya-line{font-size:12px;color:#cbd5e1;line-height:1.55;word-break:break-word}.maya-key{color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:.05em}.maya-pills,.maya-node-list{display:flex;flex-wrap:wrap;gap:6px}.maya-pill{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;background:#111827;border:1px solid #334155;color:#e2e8f0;font-size:12px}.maya-strip{display:flex;flex-wrap:nowrap;gap:0;overflow-x:auto;padding:10px 0 6px 0;border-radius:10px;background:linear-gradient(180deg,#0b1220 0%,#111827 100%);border:1px solid #334155;box-shadow:inset 0 0 0 1px rgba(148,163,184,.06)}.maya-cell{position:relative;min-width:22px;height:38px;display:flex;align-items:center;justify-content:center;border-right:1px solid rgba(148,163,184,.14);flex-shrink:0}.maya-cell:last-child{border-right:none}.maya-cell.black{background:linear-gradient(180deg,#0f172a 0%,#020617 100%)}.maya-cell.white{background:linear-gradient(180deg,#f8fafc 0%,#cbd5e1 100%)}.maya-pebble{width:12px;height:12px;border-radius:999px;display:block;box-shadow:0 0 0 1px rgba(148,163,184,.35),0 4px 10px rgba(15,23,42,.28)}.maya-cell.black .maya-pebble{background:#f8fafc;box-shadow:0 0 0 1px rgba(248,250,252,.45),0 0 14px rgba(248,250,252,.22)}.maya-cell.white .maya-pebble{background:#0f172a;box-shadow:0 0 0 1px rgba(15,23,42,.35),0 0 14px rgba(15,23,42,.18)}.maya-bitline{display:flex;flex-wrap:nowrap;gap:0;overflow-x:auto;padding:4px 0 0 0}.maya-bit{min-width:22px;text-align:center;font-size:10px;color:#94a3b8;flex-shrink:0}.maya-node{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;background:#082f49;border:1px solid #38bdf8;color:#dbeafe;font-size:11px;cursor:pointer}.maya-node:hover{filter:brightness(1.1)}#info-content{font-size:12px;color:#ccc;line-height:1.55;max-height:300px;overflow-y:auto}.field{margin-bottom:6px;word-break:break-word}.field b{color:#f8fafc}.empty{color:#64748b;font-style:italic}.triad-card{display:grid;grid-template-columns:1fr;gap:7px;margin:10px 0}.triad-col{border-radius:8px;padding:8px;border:1px solid #334155;cursor:pointer;word-break:break-word}.triad-col:hover{filter:brightness(1.16)}.triad-col b{display:block;color:#f8fafc;margin-bottom:2px}.triad-col small{display:block;color:#94a3b8;margin-bottom:5px}.triad-col span{display:block;color:#cbd5e1}.triad-left{background:rgba(5,46,22,.8);border-color:#22c55e}.triad-vertex{background:rgba(8,47,73,.8);border-color:#38bdf8}.triad-right{background:rgba(46,16,101,.8);border-color:#c084fc}.pill{display:inline-block;padding:2px 6px;border-radius:999px;background:#0f172a;border:1px solid #334155;margin:2px 4px 2px 0;color:#cbd5e1}.neighbor-link,.search-item{display:block;padding:5px 8px;cursor:pointer;border-radius:4px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.neighbor-link{padding:3px 6px;margin:3px 0;border-left:3px solid #333}.neighbor-link:hover,.search-item:hover,.legend-item:hover{background:#2a2a4e}.legend-item{display:flex;align-items:center;gap:8px;padding:5px 0;cursor:pointer;border-radius:4px;font-size:12px}.legend-item.dimmed{opacity:.35}.legend-dot{width:12px;height:12px;border-radius:50%;flex-shrink:0}.legend-label{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.legend-count{color:#777;font-size:11px}
</style>`;
}
function buildScript(nodes: unknown[], edges: unknown[], legend: unknown[], mayaData: MayaPanelData) {
    return `<script>
const RAW_NODES = ${jsSafe(nodes)};
const RAW_EDGES = ${jsSafe(edges)};
const LEGEND = ${jsSafe(legend)};
const MAYA_DATA = ${jsSafe(mayaData)};
const nodesDS = new vis.DataSet(RAW_NODES);
const edgesDS = new vis.DataSet(RAW_EDGES);
const container = document.getElementById('graph');
const network = new vis.Network(container, { nodes: nodesDS, edges: edgesDS }, {
  physics: { enabled: true, solver: 'forceAtlas2Based', forceAtlas2Based: { gravitationalConstant: -75, centralGravity: 0.006, springLength: 150, springConstant: 0.08, damping: 0.42, avoidOverlap: 0.9 }, stabilization: { iterations: 260, fit: true } },
  interaction: { hover: true, tooltipDelay: 120, hideEdgesOnDrag: true, navigationButtons: true, keyboard: false },
  nodes: { shadow: { enabled: true, color: 'rgba(0,0,0,.35)', size: 12, x: 0, y: 2 } }, edges: { selectionWidth: 4 }
});
let clustersCollapsed = false;
let focusedMacroId = '';
function getMacroNodes(){ return RAW_NODES.filter(n => n._status === 'macro' && Array.isArray(n._absorbedNodes) && n._absorbedNodes.length); }
function getMacroClusterNodeIds(macro){ const vertexIds = macro._absorbedNodes || []; const branchIds = vertexIds.flatMap(id => [id + '::__left', id + '::__right']).filter(id => nodesDS.get(id)); return [...vertexIds, ...branchIds]; }
function applyMacroClusterLayout(){ getMacroNodes().forEach((macro, macroIndex) => { const macroPos = network.getPositions([macro.id])[macro.id]; if(!macroPos) return; const absorbed = (macro._absorbedNodes || []).map(id => nodesDS.get(id)).filter(Boolean); const total = Math.max(absorbed.length, 1); const radius = 90 + Math.min(total * 8, 48); absorbed.forEach((node, index) => { const angle = ((Math.PI * 2) / total) * index - Math.PI / 2 + macroIndex * 0.15; const x = macroPos.x + Math.cos(angle) * radius; const y = macroPos.y + Math.sin(angle) * radius; network.moveNode(node.id, x, y); const leftId = node.id + '::__left'; const rightId = node.id + '::__right'; if(nodesDS.get(leftId)) network.moveNode(leftId, x - 38, y - 28); if(nodesDS.get(rightId)) network.moveNode(rightId, x + 38, y + 28); }); }); }
function setMacroClusterCollapsed(collapsed){ clustersCollapsed = collapsed; getMacroNodes().forEach(macro => { const hidden = collapsed; const ids = getMacroClusterNodeIds(macro); nodesDS.update(ids.map(id => ({ id, hidden }))); }); const button = document.getElementById('toggle-clusters'); if(button) button.textContent = collapsed ? 'Expand Macro Clusters' : 'Collapse Macro Clusters'; }
function withAlpha(color, alpha){ if(!color) return color; if(color.startsWith('#')){ const hex = color.slice(1); const expanded = hex.length === 3 ? hex.split('').map(ch => ch + ch).join('') : hex.slice(0,6); const normalized = Math.max(0, Math.min(1, alpha)); const alphaHex = Math.round(normalized * 255).toString(16).padStart(2,'0'); return '#' + expanded + alphaHex; } if(color.startsWith('rgb(')){ return color.replace('rgb(', 'rgba(').replace(')', ',' + alpha + ')'); } if(color.startsWith('rgba(')){ return color.replace(/rgba\(([^)]+),[^,]+\)$/, 'rgba($1,' + alpha + ')'); } return color; }
function getMacroById(macroId){ return getMacroNodes().find(node => node.id === macroId); }
function getFocusedMacroIdForNode(nodeId){ const node = nodesDS.get(nodeId); if(!node) return ''; if(node._status === 'macro') return node.id; return node._macroOwner || ''; }
function getFeatureFingerprintForNode(nodeId){ const node = nodesDS.get(nodeId); if(!node) return null; if(node._status === 'macro') return MAYA_DATA.byMacro[node.id] || null; const ownerId = node._triadOwner || node.id; return MAYA_DATA.byOwner[ownerId] || null; }
function renderMayaStrip(sequence){ if(!Array.isArray(sequence) || !sequence.length) return '<span class="empty">None</span>'; const cells = sequence.map(v => '<div class="maya-cell ' + (v ? 'black' : 'white') + '"><span class="maya-pebble"></span></div>').join(''); const bits = sequence.map(v => '<div class="maya-bit">' + esc(v) + '</div>').join(''); return '<div class="maya-strip">' + cells + '</div><div class="maya-bitline">' + bits + '</div>'; }
function renderMayaFingerprint(data, interactive){ if(!data) return '<span class="empty">No Maya fingerprint available</span>'; const partition = Array.isArray(data.partition) && data.partition.length ? data.partition.map(v => '<span class="maya-pill">' + esc(v) + '</span>').join('') : '<span class="empty">[]</span>'; const sequence = Array.isArray(data.sequence) && data.sequence.length ? data.sequence.map(v => '<span class="maya-pill">' + esc(v) + '</span>').join('') : '<span class="empty">[]</span>'; const nodes = Array.isArray(data.normalizedNodeIds) && data.normalizedNodeIds.length ? data.normalizedNodeIds.map(id => interactive ? '<span class="maya-node" onclick="focusNode(' + JSON.stringify(id).replace(/"/g,'&quot;') + ')">' + esc(id) + '</span>' : '<span class="maya-pill">' + esc(id) + '</span>').join('') : '<span class="empty">None</span>'; return '<div class="maya-grid">' + '<div class="maya-line"><span class="maya-key">Scope</span><br>' + esc(data.title) + '</div>' + '<div class="maya-line"><span class="maya-key">Maya-ID</span><br><span class="pill">' + esc(data.hash) + '</span></div>' + '<div class="maya-line"><span class="maya-key">Young Partition</span><div class="maya-pills">' + partition + '</div></div>' + '<div class="maya-line"><span class="maya-key">Maya Strip</span>' + renderMayaStrip(data.sequence) + '</div>' + '<div class="maya-line"><span class="maya-key">Maya Sequence</span><div class="maya-pills">' + sequence + '</div></div>' + '<div class="maya-line"><span class="maya-key">Normalized Fragment</span><div class="maya-node-list">' + nodes + '</div></div>' + '</div>'; }
function showMaya(nodeId){ const panel = document.getElementById('maya-feature'); if(!panel) return; panel.innerHTML = renderMayaFingerprint(getFeatureFingerprintForNode(nodeId), true); }
function applyMacroFocus(macroId){ focusedMacroId = macroId || ''; const macro = focusedMacroId ? getMacroById(focusedMacroId) : null; const focusSet = new Set(macro ? [macro.id, ...getMacroClusterNodeIds(macro)] : []); nodesDS.update(RAW_NODES.map(node => { const inFocus = !macro || focusSet.has(node.id); const baseColor = node.color || {}; return { id: node.id, color: { background: inFocus ? baseColor.background : withAlpha(baseColor.background, 0.18), border: inFocus ? baseColor.border : withAlpha(baseColor.border, 0.2), highlight: baseColor.highlight }, font: { ...(node.font || {}), color: inFocus ? '#f8fafc' : 'rgba(248,250,252,0.18)' } }; })); edgesDS.update(RAW_EDGES.map(edge => { const connected = !macro || (focusSet.has(edge.from) && focusSet.has(edge.to)); return { id: edge.id, color: { ...(edge.color || {}), opacity: connected ? (edge.color?.opacity ?? 1) : 0.08 }, hidden: false, width: connected ? edge.width : Math.max((edge.width || 1) * 0.5, 1) }; })); }
function drawMacroClusterHull(ctx, macro){ const ids = [macro.id, ...getMacroClusterNodeIds(macro)].filter(id => !nodesDS.get(id)?.hidden); if(ids.length <= 1) return; const positions = network.getPositions(ids); const points = ids.map(id => positions[id]).filter(Boolean); if(points.length === 0) return; const minX = Math.min(...points.map(p => p.x)); const maxX = Math.max(...points.map(p => p.x)); const minY = Math.min(...points.map(p => p.y)); const maxY = Math.max(...points.map(p => p.y)); const pad = 44; const radius = 26; const color = macro._macroColor || '#f43f5e'; const x = minX - pad; const y = minY - pad; const width = (maxX - minX) + pad * 2; const height = (maxY - minY) + pad * 2; ctx.save(); ctx.beginPath(); ctx.moveTo(x + radius, y); ctx.lineTo(x + width - radius, y); ctx.quadraticCurveTo(x + width, y, x + width, y + radius); ctx.lineTo(x + width, y + height - radius); ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height); ctx.lineTo(x + radius, y + height); ctx.quadraticCurveTo(x, y + height, x, y + height - radius); ctx.lineTo(x, y + radius); ctx.quadraticCurveTo(x, y, x + radius, y); ctx.closePath(); ctx.fillStyle = color + '14'; ctx.strokeStyle = color + 'bb'; ctx.lineWidth = 2.5; ctx.setLineDash([9,6]); ctx.shadowColor = color; ctx.shadowBlur = 18; ctx.fill(); ctx.stroke(); ctx.restore(); }
network.once('stabilizationIterationsDone', () => { applyMacroClusterLayout(); network.setOptions({ physics: { enabled: false } }); });
network.on('afterDrawing', function(ctx){ getMacroNodes().forEach(macro => drawMacroClusterHull(ctx, macro)); RAW_NODES.filter(n => (n._status === 'new' || n._status === 'macro') && (n._kind === 'vertex' || n._kind === 'macro')).forEach(n => { const pos = network.getPositions([n.id])[n.id]; if(!pos) return; ctx.save(); ctx.beginPath(); ctx.arc(pos.x, pos.y, n._status === 'macro' ? 54 : 48, 0, Math.PI * 2); ctx.strokeStyle = n._macroColor ? n._macroColor + 'cc' : (n._status === 'macro' ? 'rgba(244,63,94,.65)' : 'rgba(56,189,248,.65)'); ctx.lineWidth = 4; ctx.shadowColor = n._macroColor || (n._status === 'macro' ? '#f43f5e' : '#38bdf8'); ctx.shadowBlur = 24; ctx.stroke(); ctx.restore(); }); });
function esc(s){ return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function focusNode(nodeId){ const macroId = getFocusedMacroIdForNode(nodeId); applyMacroFocus(macroId); network.focus(nodeId,{ scale:1.35, animation:true }); network.selectNodes([nodeId]); showInfo(nodeId); showMaya(nodeId); }
function showInfo(nodeId){ const n = nodesDS.get(nodeId); if(!n) return; const ownerId = n._triadOwner || n.id; const owner = nodesDS.get(ownerId) || n; const left = nodesDS.get(ownerId + '::__left'); const right = nodesDS.get(ownerId + '::__right'); const neighborIds = network.getConnectedNodes(nodeId); const neighborItems = neighborIds.map(nid => { const nb = nodesDS.get(nid); const color = nb?.color?.background ?? '#555'; return '<span class="neighbor-link" style="border-left-color:' + esc(color) + '" onclick="focusNode(' + JSON.stringify(nid).replace(/"/g,'&quot;') + ')">' + esc(nb ? nb.label : nid) + '</span>'; }).join(''); const demand = Array.isArray(n._demand) && n._demand.length ? n._demand.map(x => '<span class="pill">' + esc(x) + '</span>').join('') : '<span class="empty">None</span>'; const answer = Array.isArray(n._answer) && n._answer.length ? n._answer.map(x => '<span class="pill">' + esc(x) + '</span>').join('') : '<span class="empty">None</span>'; const absorbed = Array.isArray(n._absorbedNodes) && n._absorbedNodes.length ? n._absorbedNodes.map(x => '<span class="pill" onclick="focusNode(' + JSON.stringify(x).replace(/"/g,'&quot;') + ')" style="cursor:pointer">' + esc(x) + '</span>').join('') : '<span class="empty">None</span>'; const ownerDemand = Array.isArray(owner._demand) && owner._demand.length ? owner._demand.map(x => '<span class="pill">' + esc(x) + '</span>').join('') : '<span class="empty">None</span>'; const ownerAnswer = Array.isArray(owner._answer) && owner._answer.length ? owner._answer.map(x => '<span class="pill">' + esc(x) + '</span>').join('') : '<span class="empty">None</span>'; document.getElementById('info-content').innerHTML = '<div class="field"><b>' + esc(n.label) + '</b></div>' + '<div class="field">Triad Kind: <span class="pill">' + esc(n._kind) + '</span></div>' + '<div class="field">Triad Owner: <span class="pill" onclick="focusNode(' + JSON.stringify(ownerId).replace(/"/g,'&quot;') + ')" style="cursor:pointer">' + esc(ownerId) + '</span></div>' + '<div class="field">Status: <span class="pill">' + esc(n._status) + '</span></div>' + '<div class="field">Community: ' + esc(n._community_name) + '</div>' + '<div class="field">Source: ' + esc(n._sourcePath || '-') + '</div>' + '<div class="field">Role: ' + esc(n._branchTitle || '-') + '</div>' + '<div class="field">Problem: ' + esc(n._problem || '-') + '</div>' + '<div class="field">Demand: ' + demand + '</div>' + '<div class="field">Answer: ' + answer + '</div>' + (n._kind === 'macro' ? '<div class="field">Absorbed Nodes: ' + absorbed + '</div><div class="field">Rationale: ' + esc(n._rationale || '-') + '</div>' : '') + '<div class="triad-card"><div class="triad-col triad-left" onclick="focusNode(' + JSON.stringify(left?.id || ownerId).replace(/"/g,'&quot;') + ')"><b>Left</b><small>dynamic branch</small><span>' + esc(owner._problem || '-') + '</span></div><div class="triad-col triad-vertex" onclick="focusNode(' + JSON.stringify(ownerId).replace(/"/g,'&quot;') + ')"><b>Vertex</b><small>feature wrapper</small><span>' + esc(owner.label || ownerId) + '</span></div><div class="triad-col triad-right" onclick="focusNode(' + JSON.stringify(right?.id || ownerId).replace(/"/g,'&quot;') + ')"><b>Right</b><small>static contract</small><span>Demand: ' + ownerDemand + '</span><span>Answer: ' + ownerAnswer + '</span></div></div><div class="field">Degree: ' + esc(n._degree) + '</div>' + (neighborIds.length ? '<div class="field" style="margin-top:8px;color:#aaa;font-size:11px">Neighbors (' + neighborIds.length + ')</div>' + neighborItems : ''); }
let hoveredNodeId = null; network.on('hoverNode', params => { hoveredNodeId = params.node; container.style.cursor = 'pointer'; }); network.on('blurNode', () => { hoveredNodeId = null; container.style.cursor = 'default'; }); network.on('click', params => { if (params.nodes.length > 0) { showInfo(params.nodes[0]); showMaya(params.nodes[0]); } else if (hoveredNodeId === null) { applyMacroFocus(''); document.getElementById('info-content').innerHTML = '<span class="empty">Click a node to inspect it</span>'; document.getElementById('maya-feature').innerHTML = '<span class="empty">Click a vertex or macro node to inspect its Young partition and Maya stones</span>'; } });
const searchInput = document.getElementById('search'); const searchResults = document.getElementById('search-results'); searchInput.addEventListener('input', () => { const q = searchInput.value.toLowerCase().trim(); searchResults.innerHTML = ''; if (!q) { searchResults.style.display = 'none'; return; } const matches = RAW_NODES.filter(n => n.label.toLowerCase().includes(q)).slice(0,20); if (!matches.length) { searchResults.style.display = 'none'; return; } searchResults.style.display = 'block'; matches.forEach(n => { const el = document.createElement('div'); el.className = 'search-item'; el.textContent = n.label; el.style.borderLeft = '3px solid ' + (n.color?.border ?? '#555'); el.onclick = () => { focusNode(n.id); searchResults.style.display = 'none'; searchInput.value = ''; }; searchResults.appendChild(el); }); });
const hiddenCommunities = new Set(); const legendEl = document.getElementById('legend'); LEGEND.forEach(c => { const item = document.createElement('div'); item.className = 'legend-item'; item.innerHTML = '<div class="legend-dot" style="background:' + esc(c.color) + '"></div><span class="legend-label">' + esc(c.label) + '</span><span class="legend-count">' + esc(c.count) + '</span>'; item.onclick = () => { if (hiddenCommunities.has(c.cid)) { hiddenCommunities.delete(c.cid); item.classList.remove('dimmed'); } else { hiddenCommunities.add(c.cid); item.classList.add('dimmed'); } nodesDS.update(RAW_NODES.filter(n => n._community === c.cid).map(n => ({ id:n.id, hidden:hiddenCommunities.has(c.cid) }))); }; legendEl.appendChild(item); });
const toggleClustersButton = document.getElementById('toggle-clusters'); if (toggleClustersButton) { toggleClustersButton.addEventListener('click', () => setMacroClusterCollapsed(!clustersCollapsed)); }
const firstFocus = RAW_NODES.find(n => n._status === 'new') || RAW_NODES.find(n => n._status === 'macro'); if (firstFocus) setTimeout(() => focusNode(firstFocus.id), 350);
</script>`;
}

function buildPreviewTopology(originalMap: TriadMapNode[], protocol: UpgradeProtocol) {
    const preview = new Map<string, TriadMapNode>();
    originalMap.forEach((node) => preview.set(node.nodeId, cloneNode(node)));

    protocol.actions.forEach((action) => {
        if (action.op === 'modify') {
            preview.set(action.nodeId, {
                nodeId: action.nodeId,
                category: action.category,
                sourcePath: action.sourcePath,
                fission: {
                    problem: action.fission.problem,
                    demand: [...action.fission.demand],
                    answer: [...action.fission.answer]
                }
            });
            return;
        }

        if (action.op === 'create_child') {
            preview.set(action.node.nodeId, cloneNode(action.node));
        }
    });

    return Array.from(preview.values());
}

function buildMayaPanelData(previewMap: TriadMapNode[], renormalizeProtocol?: RenormalizeProtocol): MayaPanelData {
    const projectProjection = buildModuleProjection(previewMap);
    const project = createMayaFingerprint(
        'project::topology',
        'Whole project topology (module projection)',
        'project',
        projectProjection
    );
    const { outgoing, incoming, nodeMap } = buildContractNeighborhood(previewMap);
    const byOwner: Record<string, MayaFingerprint> = {};

    previewMap.forEach((node) => {
        const ownerId = node.nodeId;
        const neighborIds = new Set<string>([ownerId, ...(outgoing.get(ownerId) ?? []), ...(incoming.get(ownerId) ?? [])]);
        const fragment = Array.from(neighborIds)
            .map((nodeId) => nodeMap.get(nodeId))
            .filter((item): item is TriadMapNode => Boolean(item));
        byOwner[ownerId] = createMayaFingerprint(`feature::${ownerId}`, ownerId, 'feature', fragment);
    });

    const byMacro: Record<string, MayaFingerprint> = {};
    (renormalizeProtocol?.actions ?? []).forEach((action) => {
        const fragment = action.absorbed_nodes
            .map((nodeId) => nodeMap.get(nodeId))
            .filter((item): item is TriadMapNode => Boolean(item));
        byMacro[action.macro_node_id] = createMayaFingerprint(
            `macro::${action.macro_node_id}`,
            `${action.macro_node_id} macro cluster`,
            'macro',
            fragment
        );
    });

    return { project, byOwner, byMacro };
}

function createMayaFingerprint(key: string, title: string, scope: 'project' | 'feature' | 'macro', nodes: TriadMapNode[]): MayaFingerprint {
    let normalized: TriadMapNode[];
    let partition: number[];

    try {
        if (nodes.length > VISUALIZER_STRICT_MAYA_LIMIT) {
            throw new Error('Use stable fallback for larger visualizer fragments');
        }
        normalized = normalizeSubgraph(nodes) as TriadMapNode[];
        partition = mapTopologyToYoungPartition(nodes);
    } catch {
        normalized = nodes
            .slice()
            .sort((left, right) => left.nodeId.localeCompare(right.nodeId))
            .map((node) => cloneNode(node));
        partition = buildFallbackPartition(normalized);
    }

    const sequence = generateMayaSequence(partition);
    return {
        key,
        title,
        scope,
        nodeIds: nodes.map((node) => node.nodeId),
        normalizedNodeIds: normalized.map((node) => node.nodeId),
        partition,
        sequence,
        hash: generateMayaFeatureHash(sequence),
        stones: sequence.map((value) => (value ? '⚫' : '⚪'))
    };
}

function buildFallbackPartition(nodes: TriadMapNode[]) {
    return nodes
        .map((node) => {
            const demandCount = (node.fission?.demand ?? []).filter((entry) => normalizeContractKey(entry, true)).length;
            const answerCount = (node.fission?.answer ?? []).filter((entry) => normalizeContractKey(entry, false)).length;
            return 1 + demandCount + answerCount;
        })
        .filter((value) => value > 0)
        .sort((left, right) => right - left);
}

function renderMayaFingerprintMarkup(fingerprint: MayaFingerprint) {
    const partition = fingerprint.partition.length
        ? fingerprint.partition.map((value) => `<span class="maya-pill">${value}</span>`).join('')
        : '<span class="empty">[]</span>';
    const sequence = fingerprint.sequence.length
        ? fingerprint.sequence.map((value) => `<span class="maya-pill">${value}</span>`).join('')
        : '<span class="empty">[]</span>';
    const normalizedNodes = fingerprint.normalizedNodeIds.length
        ? fingerprint.normalizedNodeIds.map((nodeId) => `<span class="maya-pill">${escapeHtml(nodeId)}</span>`).join('')
        : '<span class="empty">None</span>';

    return `<div class="maya-grid">
  <div class="maya-line"><span class="maya-key">Scope</span><br>${escapeHtml(fingerprint.title)}</div>
  <div class="maya-line"><span class="maya-key">Maya-ID</span><br><span class="pill">${escapeHtml(fingerprint.hash)}</span></div>
  <div class="maya-line"><span class="maya-key">Young Partition</span><div class="maya-pills">${partition}</div></div>
  <div class="maya-line"><span class="maya-key">Maya Strip</span>${renderMayaStripMarkup(fingerprint.sequence)}</div>
  <div class="maya-line"><span class="maya-key">Maya Sequence</span><div class="maya-pills">${sequence}</div></div>
  <div class="maya-line"><span class="maya-key">Normalized Fragment</span><div class="maya-node-list">${normalizedNodes}</div></div>
</div>`;
}

function renderMayaStripMarkup(sequence: number[]) {
    if (!sequence.length) {
        return '<span class="empty">None</span>';
    }

    const cells = sequence
        .map((value) => `<div class="maya-cell ${value ? 'black' : 'white'}"><span class="maya-pebble"></span></div>`)
        .join('');
    const bits = sequence.map((value) => `<div class="maya-bit">${value}</div>`).join('');
    return `<div class="maya-strip">${cells}</div><div class="maya-bitline">${bits}</div>`;
}

function buildContractNeighborhood(map: TriadMapNode[]) {
    const nodeMap = new Map<string, TriadMapNode>();
    const producersByContract = new Map<string, string[]>();
    const outgoing = new Map<string, Set<string>>();
    const incoming = new Map<string, Set<string>>();

    map.forEach((node) => {
        nodeMap.set(node.nodeId, node);
        outgoing.set(node.nodeId, new Set<string>());
        incoming.set(node.nodeId, new Set<string>());

        (node.fission?.answer ?? [])
            .map((entry) => normalizeContractKey(entry, false))
            .filter((entry): entry is string => Boolean(entry))
            .forEach((contract) => {
                const items = producersByContract.get(contract) ?? [];
                items.push(node.nodeId);
                producersByContract.set(contract, items);
            });
    });

    map.forEach((node) => {
        (node.fission?.demand ?? [])
            .map((entry) => normalizeContractKey(entry, true))
            .filter((entry): entry is string => Boolean(entry))
            .forEach((contract) => {
                (producersByContract.get(contract) ?? []).forEach((producerId) => {
                    if (producerId === node.nodeId) return;
                    outgoing.get(producerId)?.add(node.nodeId);
                    incoming.get(node.nodeId)?.add(producerId);
                });
            });
    });

    return { nodeMap, outgoing, incoming };
}

function normalizeContractKey(entry: string, isDemand: boolean) {
    const raw = String(entry ?? '').trim();
    if (!raw) return null;
    if (isDemand && /^\[Ghost/i.test(raw)) return null;
    const match = raw.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
    const value = (match ? match[1] : raw)
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/\s*([<>{}()[\]|,:=&?])\s*/g, '$1');
    return /^(none|void|null|undefined)$/i.test(value) ? null : value;
}

function cloneNode(node: TriadMapNode): TriadMapNode {
    return {
        nodeId: node.nodeId,
        category: node.category,
        sourcePath: node.sourcePath,
        fission: {
            problem: node.fission?.problem,
            demand: [...(node.fission?.demand ?? [])],
            answer: [...(node.fission?.answer ?? [])]
        }
    };
}

function buildModuleProjection(map: TriadMapNode[]): TriadMapNode[] {
    const moduleMap = new Map<
        string,
        {
            nodeId: string;
            category?: string;
            sourcePath?: string;
            problems: Set<string>;
            demand: Set<string>;
            answer: Set<string>;
        }
    >();

    map.forEach((node) => {
        const moduleId = toModuleNodeId(node);
        const current =
            moduleMap.get(moduleId) ??
            {
                nodeId: moduleId,
                category: node.category ?? 'core',
                sourcePath: node.sourcePath ?? '',
                problems: new Set<string>(),
                demand: new Set<string>(),
                answer: new Set<string>()
            };

        if (node.fission?.problem) current.problems.add(node.fission.problem);
        (node.fission?.demand ?? []).forEach((entry) => current.demand.add(entry));
        (node.fission?.answer ?? []).forEach((entry) => current.answer.add(entry));
        moduleMap.set(moduleId, current);
    });

    return Array.from(moduleMap.values()).map((entry) => ({
        nodeId: entry.nodeId,
        category: entry.category,
        sourcePath: entry.sourcePath,
        fission: {
            problem: `module projection of ${entry.sourcePath || entry.nodeId}`,
            demand: Array.from(entry.demand).sort(),
            answer: Array.from(entry.answer).sort()
        }
    }));
}

function toModuleNodeId(node: TriadMapNode) {
    const sourcePath = String(node.sourcePath ?? '').replace(/\\/g, '/').trim();
    const moduleName = sourcePath ? sourcePath.replace(/\.ts$/i, '') : node.nodeId.split('.')[0] ?? node.nodeId;
    return `Module.${moduleName}`;
}

function jsSafe(value: unknown) { return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026'); }
function escapeHtml(value: string) { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
