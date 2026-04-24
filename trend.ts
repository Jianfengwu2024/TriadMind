import * as fs from 'fs';
import * as path from 'path';
import { calculateProducerConsumerEdges } from './analyzer';
import { loadTriadConfig } from './config';
import { RuntimeMap } from './runtime/types';
import { runTopologyVerify } from './verify';
import { WorkspacePaths } from './workspace';

type TriadNode = {
    nodeId?: string;
    sourcePath?: string;
    fission?: {
        demand?: string[];
    };
};

export interface TrendNodeRisk {
    nodeId: string;
    sourcePath?: string;
    inDegree: number;
    outDegree: number;
    degree: number;
    ghost: boolean;
    executeLike: boolean;
    riskScore: number;
}

export interface TrendSnapshot {
    generatedAt: string;
    triadNodeCount: number;
    triadEdgeCount: number;
    runtimeNodeCount: number;
    runtimeEdgeCount: number;
    executeLikeRatio: number;
    ghostRatio: number;
    diagnosticsNoCode: number;
    highRiskNodes: TrendNodeRisk[];
    centralityByNode: Record<string, number>;
    triadEdgeKeys: string[];
    runtimeEdgeKeys: string[];
}

export interface TrendHistory {
    schemaVersion: '1.0';
    updatedAt: string;
    snapshots: TrendSnapshot[];
}

export interface TrendDeltaReport {
    generatedAt: string;
    previousGeneratedAt?: string;
    summary: string[];
    highRiskAdded: TrendNodeRisk[];
    highRiskRemoved: TrendNodeRisk[];
    centralitySurges: Array<{
        nodeId: string;
        previousDegree: number;
        currentDegree: number;
        delta: number;
    }>;
    addedTriadEdges: string[];
    removedTriadEdges: string[];
    addedRuntimeEdges: string[];
    removedRuntimeEdges: string[];
    snapshot: TrendSnapshot;
}

export interface TrendOptions {
    historyWindow?: number;
    maxEdgeDiff?: number;
}

export function generateTrendArtifacts(paths: WorkspacePaths, options: TrendOptions = {}) {
    const snapshot = createTrendSnapshot(paths);
    const previousHistory = readTrendHistory(paths.trendFile);
    const previousSnapshot = previousHistory.snapshots[previousHistory.snapshots.length - 1];
    const report = createTrendDeltaReport(snapshot, previousSnapshot, options.maxEdgeDiff ?? 50);
    const historyWindow = normalizePositiveInteger(options.historyWindow, 26);
    const nextHistory: TrendHistory = {
        schemaVersion: '1.0',
        updatedAt: snapshot.generatedAt,
        snapshots: [...previousHistory.snapshots, snapshot].slice(-historyWindow)
    };

    fs.mkdirSync(path.dirname(paths.trendFile), { recursive: true });
    fs.writeFileSync(paths.trendFile, JSON.stringify(nextHistory, null, 2), 'utf-8');
    fs.writeFileSync(paths.trendReportFile, renderTrendMarkdown(report), 'utf-8');

    return {
        history: nextHistory,
        report
    };
}

function createTrendSnapshot(paths: WorkspacePaths): TrendSnapshot {
    const triadMap = readJsonArray<TriadNode>(paths.mapFile);
    const runtimeMap = readRuntimeMap(paths.runtimeMapFile);
    const verifyReport = runTopologyVerify(paths);
    const config = loadTriadConfig(paths);
    const triadEdges = calculateProducerConsumerEdges(triadMap as any[], {
        ignoreGenericContracts: config.parser.ignoreGenericContracts,
        genericContractIgnoreList: config.parser.genericContractIgnoreList
    });
    const inDegreeByNode = new Map<string, number>();
    const outDegreeByNode = new Map<string, number>();

    for (const edge of triadEdges) {
        outDegreeByNode.set(edge.from, (outDegreeByNode.get(edge.from) ?? 0) + 1);
        inDegreeByNode.set(edge.to, (inDegreeByNode.get(edge.to) ?? 0) + 1);
    }

    const riskNodes: TrendNodeRisk[] = [];
    const centralityByNode: Record<string, number> = {};
    for (const node of triadMap) {
        const nodeId = String(node?.nodeId ?? '').trim();
        if (!nodeId) {
            continue;
        }
        const inDegree = inDegreeByNode.get(nodeId) ?? 0;
        const outDegree = outDegreeByNode.get(nodeId) ?? 0;
        const degree = inDegree + outDegree;
        const ghost = hasGhostDemand(node);
        const executeLike = /execute/i.test(nodeId);
        const riskScore = degree + (ghost ? 5 : 0) + (executeLike ? 1 : 0);
        centralityByNode[nodeId] = degree;

        riskNodes.push({
            nodeId,
            sourcePath: node.sourcePath,
            inDegree,
            outDegree,
            degree,
            ghost,
            executeLike,
            riskScore
        });
    }

    const highRiskNodes = riskNodes
        .filter((node) => node.ghost || node.inDegree >= 5 || node.outDegree >= 5 || node.degree >= 8)
        .sort((left, right) => right.riskScore - left.riskScore || left.nodeId.localeCompare(right.nodeId))
        .slice(0, 80);

    const triadEdgeKeys = triadEdges
        .map((edge) => `${edge.from}::${edge.contract}::${edge.to}`)
        .sort((left, right) => left.localeCompare(right));
    const runtimeEdgeKeys = (runtimeMap?.edges ?? [])
        .map((edge) => `${edge.from}::${edge.type}::${edge.to}`)
        .sort((left, right) => left.localeCompare(right));

    return {
        generatedAt: new Date().toISOString(),
        triadNodeCount: triadMap.length,
        triadEdgeCount: triadEdges.length,
        runtimeNodeCount: runtimeMap?.nodes?.length ?? 0,
        runtimeEdgeCount: runtimeMap?.edges?.length ?? 0,
        executeLikeRatio: verifyReport.metrics.execute_like_ratio,
        ghostRatio: verifyReport.metrics.ghost_ratio,
        diagnosticsNoCode: verifyReport.metrics.diagnostics_no_code,
        highRiskNodes,
        centralityByNode,
        triadEdgeKeys,
        runtimeEdgeKeys
    };
}

function createTrendDeltaReport(snapshot: TrendSnapshot, previous: TrendSnapshot | undefined, maxEdgeDiff: number): TrendDeltaReport {
    const previousHighRiskSet = new Set((previous?.highRiskNodes ?? []).map((node) => node.nodeId));
    const currentHighRiskSet = new Set(snapshot.highRiskNodes.map((node) => node.nodeId));
    const highRiskAdded = snapshot.highRiskNodes.filter((node) => !previousHighRiskSet.has(node.nodeId));
    const highRiskRemoved = (previous?.highRiskNodes ?? []).filter((node) => !currentHighRiskSet.has(node.nodeId));

    const centralitySurges = computeCentralitySurges(snapshot.centralityByNode, previous?.centralityByNode ?? {});
    const addedTriadEdges = diffSet(snapshot.triadEdgeKeys, previous?.triadEdgeKeys ?? []).slice(0, maxEdgeDiff);
    const removedTriadEdges = diffSet(previous?.triadEdgeKeys ?? [], snapshot.triadEdgeKeys).slice(0, maxEdgeDiff);
    const addedRuntimeEdges = diffSet(snapshot.runtimeEdgeKeys, previous?.runtimeEdgeKeys ?? []).slice(0, maxEdgeDiff);
    const removedRuntimeEdges = diffSet(previous?.runtimeEdgeKeys ?? [], snapshot.runtimeEdgeKeys).slice(0, maxEdgeDiff);

    const summary = [
        `Current topology: triad=${snapshot.triadNodeCount} nodes/${snapshot.triadEdgeCount} edges, runtime=${snapshot.runtimeNodeCount} nodes/${snapshot.runtimeEdgeCount} edges`,
        `Governance: execute_like_ratio=${snapshot.executeLikeRatio.toFixed(3)}, ghost_ratio=${snapshot.ghostRatio.toFixed(3)}, diagnostics_no_code=${snapshot.diagnosticsNoCode}`,
        `High-risk nodes: total=${snapshot.highRiskNodes.length}, added=${highRiskAdded.length}, removed=${highRiskRemoved.length}`,
        `Centrality surges: ${centralitySurges.length} node(s) changed >= 3`,
        `Edge drift: triad +${addedTriadEdges.length} / -${removedTriadEdges.length}, runtime +${addedRuntimeEdges.length} / -${removedRuntimeEdges.length}`
    ];

    return {
        generatedAt: snapshot.generatedAt,
        previousGeneratedAt: previous?.generatedAt,
        summary,
        highRiskAdded,
        highRiskRemoved,
        centralitySurges,
        addedTriadEdges,
        removedTriadEdges,
        addedRuntimeEdges,
        removedRuntimeEdges,
        snapshot
    };
}

function renderTrendMarkdown(report: TrendDeltaReport) {
    const lines: string[] = [];
    lines.push('# TriadMind Architecture Drift Weekly Report');
    lines.push('');
    lines.push(`- GeneratedAt: ${report.generatedAt}`);
    lines.push(`- PreviousSnapshot: ${report.previousGeneratedAt ?? 'N/A'}`);
    lines.push('');
    lines.push('## Summary');
    report.summary.forEach((entry) => lines.push(`- ${entry}`));
    lines.push('');
    lines.push('## High-Risk Nodes Added');
    if (report.highRiskAdded.length === 0) {
        lines.push('- None');
    } else {
        report.highRiskAdded.slice(0, 30).forEach((node) => {
            lines.push(
                `- ${node.nodeId} (degree=${node.degree}, in=${node.inDegree}, out=${node.outDegree}, ghost=${node.ghost}, source=${node.sourcePath ?? '-'})`
            );
        });
    }
    lines.push('');
    lines.push('## Centrality Surges');
    if (report.centralitySurges.length === 0) {
        lines.push('- None');
    } else {
        report.centralitySurges.slice(0, 30).forEach((item) => {
            lines.push(`- ${item.nodeId}: ${item.previousDegree} -> ${item.currentDegree} (delta=${item.delta})`);
        });
    }
    lines.push('');
    lines.push('## Key Chain Drift (Triad)');
    lines.push(`- Added: ${report.addedTriadEdges.length}`);
    report.addedTriadEdges.slice(0, 25).forEach((edge) => lines.push(`  - + ${edge}`));
    lines.push(`- Removed: ${report.removedTriadEdges.length}`);
    report.removedTriadEdges.slice(0, 25).forEach((edge) => lines.push(`  - - ${edge}`));
    lines.push('');
    lines.push('## Key Chain Drift (Runtime)');
    lines.push(`- Added: ${report.addedRuntimeEdges.length}`);
    report.addedRuntimeEdges.slice(0, 25).forEach((edge) => lines.push(`  - + ${edge}`));
    lines.push(`- Removed: ${report.removedRuntimeEdges.length}`);
    report.removedRuntimeEdges.slice(0, 25).forEach((edge) => lines.push(`  - - ${edge}`));
    lines.push('');
    return lines.join('\n');
}

function computeCentralitySurges(
    current: Record<string, number>,
    previous: Record<string, number>
): Array<{ nodeId: string; previousDegree: number; currentDegree: number; delta: number }> {
    const nodeIds = new Set<string>([...Object.keys(current), ...Object.keys(previous)]);
    const surges: Array<{ nodeId: string; previousDegree: number; currentDegree: number; delta: number }> = [];
    for (const nodeId of nodeIds) {
        const previousDegree = previous[nodeId] ?? 0;
        const currentDegree = current[nodeId] ?? 0;
        const delta = currentDegree - previousDegree;
        if (Math.abs(delta) < 3) {
            continue;
        }
        surges.push({
            nodeId,
            previousDegree,
            currentDegree,
            delta
        });
    }
    return surges.sort(
        (left, right) => Math.abs(right.delta) - Math.abs(left.delta) || left.nodeId.localeCompare(right.nodeId)
    );
}

function diffSet(left: string[], right: string[]) {
    const rightSet = new Set(right);
    return left.filter((entry) => !rightSet.has(entry));
}

function hasGhostDemand(node: TriadNode) {
    const demand = node?.fission?.demand ?? [];
    return Array.isArray(demand) && demand.some((entry) => /^\[Ghost:[^\]]+\]/i.test(String(entry ?? '').trim()));
}

function readRuntimeMap(filePath: string) {
    const parsed = readJsonObject(filePath);
    if (!parsed) {
        return undefined;
    }
    const runtimeMap = parsed as RuntimeMap;
    if (!Array.isArray(runtimeMap.nodes) || !Array.isArray(runtimeMap.edges)) {
        return undefined;
    }
    return runtimeMap;
}

function readTrendHistory(filePath: string): TrendHistory {
    const parsed = readJsonObject(filePath);
    if (!parsed || !Array.isArray((parsed as TrendHistory).snapshots)) {
        return {
            schemaVersion: '1.0',
            updatedAt: new Date(0).toISOString(),
            snapshots: []
        };
    }

    return {
        schemaVersion: '1.0',
        updatedAt: String((parsed as TrendHistory).updatedAt ?? new Date(0).toISOString()),
        snapshots: (parsed as TrendHistory).snapshots
            .filter((item) => item && typeof item === 'object')
            .map((item) => ({
                ...item,
                highRiskNodes: Array.isArray(item.highRiskNodes) ? item.highRiskNodes : [],
                centralityByNode: item.centralityByNode ?? {},
                triadEdgeKeys: Array.isArray(item.triadEdgeKeys) ? item.triadEdgeKeys : [],
                runtimeEdgeKeys: Array.isArray(item.runtimeEdgeKeys) ? item.runtimeEdgeKeys : []
            }))
    };
}

function readJsonArray<T>(filePath: string) {
    if (!fs.existsSync(filePath)) {
        return [] as T[];
    }
    try {
        const content = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
        const parsed = JSON.parse(content);
        return Array.isArray(parsed) ? (parsed as T[]) : ([] as T[]);
    } catch {
        return [] as T[];
    }
}

function readJsonObject(filePath: string) {
    if (!fs.existsSync(filePath)) {
        return undefined;
    }
    try {
        const content = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
        const parsed = JSON.parse(content);
        return parsed && typeof parsed === 'object' ? parsed : undefined;
    } catch {
        return undefined;
    }
}

function normalizePositiveInteger(value: number | undefined, fallback: number) {
    if (Number.isFinite(value) && (value as number) > 0) {
        return Math.floor(value as number);
    }
    return fallback;
}
