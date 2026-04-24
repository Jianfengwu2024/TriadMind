import * as fs from 'fs';
import * as path from 'path';
import { RuntimeMap } from './runtime/types';
import { calculateRuntimeRenderStats } from './runtime/runtimeVisualizer';
import { WorkspacePaths } from './workspace';

export interface VerifyMetrics {
    triad_nodes: number;
    execute_like_count: number;
    execute_like_ratio: number;
    ghost_nodes: number;
    ghost_ratio: number;
    runtime_nodes: number;
    runtime_edges: number;
    rendered_runtime_edges: number;
    rendered_edges_consistency: boolean;
    runtime_unmatched_route_count: number;
    diagnostics_total: number;
    diagnostics_no_code: number;
}

export interface VerifyThresholds {
    diagnostics_no_code: number;
    execute_like_ratio: number;
    ghost_ratio: number;
    rendered_edges_consistency: boolean;
    runtime_unmatched_route_count?: number;
}

export interface VerifyCheckResult {
    key: keyof VerifyThresholds;
    status: 'pass' | 'fail' | 'skip';
    expected: number | boolean | string;
    actual: number | boolean | null;
    detail: string;
}

export interface VerifyReport {
    generatedAt: string;
    projectRoot: string;
    artifacts: {
        triadMapFile: string;
        runtimeMapFile: string;
        runtimeDiagnosticsFile: string;
    };
    strict: boolean;
    thresholds: VerifyThresholds;
    metrics: VerifyMetrics;
    checks: VerifyCheckResult[];
    passed: boolean;
    baseline?: {
        path: string;
        runtime_unmatched_route_count: number;
    };
}

export interface VerifyOptions {
    strict?: boolean;
    maxExecuteLikeRatio?: number;
    maxGhostRatio?: number;
    maxUnmatchedRouteCount?: number;
    baselinePath?: string;
    maxRenderEdges?: number;
    updateBaseline?: boolean;
}

type TriadNodeLike = {
    nodeId?: string;
    fission?: {
        demand?: unknown[];
    };
};

type RuntimeDiagnosticLike = {
    level?: string;
    code?: string;
    extractor?: string;
    message?: string;
};

const EXECUTE_LIKE_METHOD_PATTERN = /execute/i;

const GHOST_DEMAND_PATTERN = /^\[Ghost:[^\]]+\]/i;

export function runTopologyVerify(paths: WorkspacePaths, options: VerifyOptions = {}): VerifyReport {
    const triadNodes = readTriadNodes(paths.mapFile);
    const runtimeMap = readRuntimeMap(paths.runtimeMapFile);
    const runtimeDiagnostics = readRuntimeDiagnostics(paths.runtimeDiagnosticsFile);
    const runtimeRenderStats = runtimeMap
        ? calculateRuntimeRenderStats(runtimeMap, options.maxRenderEdges)
        : { sourceEdges: 0, renderedEdges: 0, edgeCapApplied: false, nodeCount: 0 };
    const executeLikeCount = triadNodes.filter((node) => isExecuteLikeNodeId(node.nodeId)).length;
    const ghostNodes = triadNodes.filter((node) => hasGhostDemand(node)).length;
    const diagnosticsNoCode = runtimeDiagnostics.filter((item) => !String(item.code ?? '').trim()).length;
    const runtimeUnmatchedRouteCount = runtimeDiagnostics.filter(
        (item) => String(item.code ?? '').trim().toUpperCase() === 'RUNTIME_FRONTEND_API_ROUTE_UNMATCHED'
    ).length;
    const runtimeNodes = runtimeMap?.nodes?.length ?? 0;
    const runtimeEdges = runtimeMap?.edges?.length ?? 0;
    const renderedRuntimeEdges = runtimeRenderStats.renderedEdges;
    const renderedEdgesConsistency = runtimeMap ? renderedRuntimeEdges === runtimeEdges : false;

    const baseline = readVerifyBaseline(resolveBaselinePath(paths, options.baselinePath));
    const unresolvedUnmatchedLimit =
        options.maxUnmatchedRouteCount ??
        (baseline ? Math.max(0, Math.ceil(baseline.runtime_unmatched_route_count * 1.1)) : undefined);

    const thresholds: VerifyThresholds = {
        diagnostics_no_code: 0,
        execute_like_ratio: normalizeRatioThreshold(options.maxExecuteLikeRatio, 0.1),
        ghost_ratio: normalizeRatioThreshold(options.maxGhostRatio, 0.4),
        rendered_edges_consistency: true,
        runtime_unmatched_route_count: unresolvedUnmatchedLimit
    };

    const metrics: VerifyMetrics = {
        triad_nodes: triadNodes.length,
        execute_like_count: executeLikeCount,
        execute_like_ratio: safeRatio(executeLikeCount, triadNodes.length),
        ghost_nodes: ghostNodes,
        ghost_ratio: safeRatio(ghostNodes, triadNodes.length),
        runtime_nodes: runtimeNodes,
        runtime_edges: runtimeEdges,
        rendered_runtime_edges: renderedRuntimeEdges,
        rendered_edges_consistency: renderedEdgesConsistency,
        runtime_unmatched_route_count: runtimeUnmatchedRouteCount,
        diagnostics_total: runtimeDiagnostics.length,
        diagnostics_no_code: diagnosticsNoCode
    };

    const checks: VerifyCheckResult[] = [
        evaluateNumericThreshold('diagnostics_no_code', metrics.diagnostics_no_code, thresholds.diagnostics_no_code, '<='),
        evaluateNumericThreshold('execute_like_ratio', metrics.execute_like_ratio, thresholds.execute_like_ratio, '<'),
        evaluateNumericThreshold('ghost_ratio', metrics.ghost_ratio, thresholds.ghost_ratio, '<')
    ];
    if (runtimeMap) {
        checks.push(
            evaluateBooleanThreshold(
                'rendered_edges_consistency',
                metrics.rendered_edges_consistency,
                thresholds.rendered_edges_consistency
            )
        );
    } else {
        checks.push({
            key: 'rendered_edges_consistency',
            status: 'skip',
            expected: 'runtime-map.json present',
            actual: null,
            detail: 'Skipped rendered edge consistency check because runtime-map.json is missing'
        });
    }
    checks.push(
        evaluateOptionalNumericThreshold(
            'runtime_unmatched_route_count',
            metrics.runtime_unmatched_route_count,
            thresholds.runtime_unmatched_route_count
        )
    );

    const report: VerifyReport = {
        generatedAt: new Date().toISOString(),
        projectRoot: paths.projectRoot,
        artifacts: {
            triadMapFile: paths.mapFile,
            runtimeMapFile: paths.runtimeMapFile,
            runtimeDiagnosticsFile: paths.runtimeDiagnosticsFile
        },
        strict: Boolean(options.strict),
        thresholds,
        metrics,
        checks,
        passed: checks.every((check) => check.status !== 'fail'),
        baseline: baseline
            ? {
                  path: resolveBaselinePath(paths, options.baselinePath),
                  runtime_unmatched_route_count: baseline.runtime_unmatched_route_count
              }
            : undefined
    };

    if (options.updateBaseline) {
        writeVerifyBaseline(
            resolveBaselinePath(paths, options.baselinePath),
            metrics.runtime_unmatched_route_count,
            report.generatedAt
        );
    }

    return report;
}

export function formatVerifyReport(report: VerifyReport) {
    const checkLines = report.checks.map((check) => {
        const icon = check.status === 'pass' ? 'PASS' : check.status === 'fail' ? 'FAIL' : 'SKIP';
        return `[${icon}] ${check.key} | expected: ${check.expected} | actual: ${check.actual ?? '-'} | ${check.detail}`;
    });

    const summary = report.passed ? 'PASS' : 'FAIL';
    return [
        `TriadMind Verify (${summary})`,
        `generatedAt=${report.generatedAt}`,
        `triad_nodes=${report.metrics.triad_nodes}, runtime_nodes=${report.metrics.runtime_nodes}, runtime_edges=${report.metrics.runtime_edges}`,
        `execute_like_ratio=${report.metrics.execute_like_ratio.toFixed(3)}, ghost_ratio=${report.metrics.ghost_ratio.toFixed(3)}`,
        `diagnostics_no_code=${report.metrics.diagnostics_no_code}, runtime_unmatched_route_count=${report.metrics.runtime_unmatched_route_count}`,
        `rendered_runtime_edges=${report.metrics.rendered_runtime_edges}, rendered_edges_consistency=${report.metrics.rendered_edges_consistency}`,
        ...checkLines
    ].join('\n');
}

function evaluateNumericThreshold(
    key: keyof VerifyThresholds,
    actual: number,
    expected: number,
    operator: '<' | '<='
): VerifyCheckResult {
    const pass = operator === '<' ? actual < expected : actual <= expected;
    return {
        key,
        status: pass ? 'pass' : 'fail',
        expected,
        actual,
        detail: operator === '<' ? `must be < ${expected}` : `must be <= ${expected}`
    };
}

function evaluateBooleanThreshold(
    key: keyof VerifyThresholds,
    actual: boolean,
    expected: boolean
): VerifyCheckResult {
    const pass = actual === expected;
    return {
        key,
        status: pass ? 'pass' : 'fail',
        expected,
        actual,
        detail: `must equal ${expected}`
    };
}

function evaluateOptionalNumericThreshold(
    key: keyof VerifyThresholds,
    actual: number,
    expected?: number
): VerifyCheckResult {
    if (typeof expected !== 'number' || !Number.isFinite(expected)) {
        return {
            key,
            status: 'skip',
            expected: 'not configured',
            actual,
            detail: 'No threshold configured (set --max-unmatched-routes or provide baseline)'
        };
    }
    return {
        key,
        status: actual <= expected ? 'pass' : 'fail',
        expected,
        actual,
        detail: `must be <= ${expected}`
    };
}

function readTriadNodes(filePath: string) {
    const parsed = readJsonIfExists(filePath);
    if (!Array.isArray(parsed)) {
        return [] as TriadNodeLike[];
    }
    return parsed as TriadNodeLike[];
}

function readRuntimeMap(filePath: string) {
    const parsed = readJsonIfExists(filePath);
    if (!parsed || typeof parsed !== 'object') {
        return undefined;
    }
    const runtimeMap = parsed as RuntimeMap;
    if (!Array.isArray(runtimeMap.nodes) || !Array.isArray(runtimeMap.edges)) {
        return undefined;
    }
    return runtimeMap;
}

function readRuntimeDiagnostics(filePath: string) {
    const parsed = readJsonIfExists(filePath);
    if (Array.isArray(parsed)) {
        return parsed as RuntimeDiagnosticLike[];
    }
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { diagnostics?: unknown[] }).diagnostics)) {
        return ((parsed as { diagnostics?: unknown[] }).diagnostics ?? []) as RuntimeDiagnosticLike[];
    }
    return [] as RuntimeDiagnosticLike[];
}

function readVerifyBaseline(baselinePath: string) {
    const parsed = readJsonIfExists(baselinePath);
    if (!parsed || typeof parsed !== 'object') {
        return undefined;
    }
    const unmatched = Number((parsed as { runtime_unmatched_route_count?: number }).runtime_unmatched_route_count);
    if (!Number.isFinite(unmatched) || unmatched < 0) {
        return undefined;
    }
    return {
        runtime_unmatched_route_count: Math.floor(unmatched)
    };
}

function writeVerifyBaseline(baselinePath: string, unmatchedCount: number, generatedAt: string) {
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    fs.writeFileSync(
        baselinePath,
        JSON.stringify(
            {
                generatedAt,
                runtime_unmatched_route_count: Math.max(0, Math.floor(unmatchedCount))
            },
            null,
            2
        ),
        'utf-8'
    );
}

function resolveBaselinePath(paths: WorkspacePaths, overridePath?: string) {
    const raw = String(overridePath ?? '').trim();
    if (!raw) {
        return paths.verifyBaselineFile;
    }
    return path.isAbsolute(raw) ? raw : path.resolve(paths.projectRoot, raw);
}

function readJsonIfExists(filePath: string) {
    if (!fs.existsSync(filePath)) {
        return undefined;
    }
    try {
        const content = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
        return JSON.parse(content) as unknown;
    } catch {
        return undefined;
    }
}

function isExecuteLikeNodeId(nodeId: string | undefined) {
    if (!nodeId) {
        return false;
    }
    return EXECUTE_LIKE_METHOD_PATTERN.test(String(nodeId));
}

function hasGhostDemand(node: TriadNodeLike) {
    const demand = node.fission?.demand ?? [];
    return Array.isArray(demand) && demand.some((entry) => GHOST_DEMAND_PATTERN.test(String(entry ?? '').trim()));
}

function safeRatio(part: number, total: number) {
    if (!total) {
        return 0;
    }
    return Number((part / total).toFixed(6));
}

function normalizeRatioThreshold(value: number | undefined, fallback: number) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        return value;
    }
    return fallback;
}
