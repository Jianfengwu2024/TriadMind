import * as fs from 'fs';
import * as path from 'path';
import { loadTriadConfig, TriadLanguage } from './config';
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
    ghost_ratio_by_language: Record<string, number>;
    ghost_in_demand_count_by_language: Record<string, number>;
    ghost_policy_violations: number;
}

export interface VerifyThresholds {
    diagnostics_no_code: number;
    execute_like_ratio: number;
    ghost_ratio: number;
    rendered_edges_consistency: boolean;
    runtime_unmatched_route_count?: number;
    ghost_policy_compliance: boolean;
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
    sourcePath?: string;
    fission?: {
        demand?: unknown[];
        evidence?: {
            ghostReads?: Array<{
                raw?: string;
                retainedInDemand?: boolean;
                score?: number;
            }>;
        };
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
    const config = loadTriadConfig(paths);
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
    const ghostByLanguage = collectGhostMetricsByLanguage(triadNodes);
    const ghostPolicyViolations = evaluateGhostPolicyViolations(
        triadNodes,
        config.parser.ghostPolicyByLanguage as Record<
            string,
            { includeInDemand: boolean; topK: number; minConfidence: number } | undefined
        >
    );

    const baseline = readVerifyBaseline(resolveBaselinePath(paths, options.baselinePath));
    const unresolvedUnmatchedLimit =
        options.maxUnmatchedRouteCount ??
        (baseline ? Math.max(0, Math.ceil(baseline.runtime_unmatched_route_count * 1.1)) : undefined);

    const thresholds: VerifyThresholds = {
        diagnostics_no_code: 0,
        execute_like_ratio: normalizeRatioThreshold(options.maxExecuteLikeRatio, 0.1),
        ghost_ratio: normalizeRatioThreshold(options.maxGhostRatio, 0.4),
        rendered_edges_consistency: true,
        runtime_unmatched_route_count: unresolvedUnmatchedLimit,
        ghost_policy_compliance: true
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
        diagnostics_no_code: diagnosticsNoCode,
        ghost_ratio_by_language: ghostByLanguage.ghostRatioByLanguage,
        ghost_in_demand_count_by_language: ghostByLanguage.ghostInDemandCountByLanguage,
        ghost_policy_violations: ghostPolicyViolations.length
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
    checks.push(
        evaluateBooleanThreshold(
            'ghost_policy_compliance',
            metrics.ghost_policy_violations === 0,
            thresholds.ghost_policy_compliance,
            metrics.ghost_policy_violations > 0
                ? ghostPolicyViolations.join('; ')
                : 'Language ghost policy constraints satisfied'
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
        `ghost_ratio_by_language=${JSON.stringify(report.metrics.ghost_ratio_by_language)}`,
        `ghost_in_demand_count_by_language=${JSON.stringify(report.metrics.ghost_in_demand_count_by_language)}`,
        `diagnostics_no_code=${report.metrics.diagnostics_no_code}, runtime_unmatched_route_count=${report.metrics.runtime_unmatched_route_count}`,
        `ghost_policy_violations=${report.metrics.ghost_policy_violations}`,
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
    expected: boolean,
    detailHint?: string
): VerifyCheckResult {
    const pass = actual === expected;
    return {
        key,
        status: pass ? 'pass' : 'fail',
        expected,
        actual,
        detail: detailHint ?? `must equal ${expected}`
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

function collectGhostMetricsByLanguage(triadNodes: TriadNodeLike[]) {
    const totalByLanguage = new Map<string, number>();
    const ghostDemandByLanguage = new Map<string, number>();

    for (const node of triadNodes) {
        const language = inferLanguageFromSourcePath(node.sourcePath);
        totalByLanguage.set(language, (totalByLanguage.get(language) ?? 0) + 1);
        if (hasGhostDemand(node)) {
            ghostDemandByLanguage.set(language, (ghostDemandByLanguage.get(language) ?? 0) + 1);
        }
    }

    const ghostRatioByLanguage: Record<string, number> = {};
    const ghostInDemandCountByLanguage: Record<string, number> = {};
    for (const [language, total] of totalByLanguage.entries()) {
        const ghostCount = ghostDemandByLanguage.get(language) ?? 0;
        ghostRatioByLanguage[language] = safeRatio(ghostCount, total);
        ghostInDemandCountByLanguage[language] = ghostCount;
    }

    return {
        ghostRatioByLanguage,
        ghostInDemandCountByLanguage
    };
}

function evaluateGhostPolicyViolations(
    triadNodes: TriadNodeLike[],
    policyByLanguage: Record<string, { includeInDemand: boolean; topK: number; minConfidence: number } | undefined>
) {
    const violations: string[] = [];
    for (const node of triadNodes) {
        const language = inferLanguageFromSourcePath(node.sourcePath);
        const policy = resolveLanguageGhostPolicy(language, policyByLanguage);
        const demandEntries = Array.isArray(node.fission?.demand) ? node.fission!.demand! : [];
        const ghostDemandEntries = demandEntries.filter((entry) =>
            GHOST_DEMAND_PATTERN.test(String(entry ?? '').trim())
        );
        if (!policy.includeInDemand && ghostDemandEntries.length > 0) {
            violations.push(`${language}:${node.nodeId ?? 'unknown'} disallows ghost in demand`);
            continue;
        }
        if (policy.includeInDemand && ghostDemandEntries.length > policy.topK) {
            violations.push(
                `${language}:${node.nodeId ?? 'unknown'} ghost demand ${ghostDemandEntries.length} exceeds topK=${policy.topK}`
            );
        }

        const retainedGhostReads = (node.fission?.evidence?.ghostReads ?? []).filter((entry) => entry?.retainedInDemand);
        const lowConfidenceGhost = retainedGhostReads.find(
            (entry) => Number(entry?.score ?? 0) < policy.minConfidence
        );
        if (lowConfidenceGhost) {
            violations.push(
                `${language}:${node.nodeId ?? 'unknown'} retained ghost score ${Number(
                    lowConfidenceGhost.score ?? 0
                )} below minConfidence=${policy.minConfidence}`
            );
        }
    }

    return dedupeStrings(violations).slice(0, 50);
}

function resolveLanguageGhostPolicy(
    language: string,
    policyByLanguage: Record<string, { includeInDemand: boolean; topK: number; minConfidence: number } | undefined>
) {
    const fallback = policyByLanguage.default ?? {
        includeInDemand: true,
        topK: 5,
        minConfidence: 4
    };
    const policy = policyByLanguage[language] ?? fallback;
    return {
        includeInDemand: policy.includeInDemand,
        topK: Math.max(0, Math.floor(policy.topK)),
        minConfidence: Math.max(0, Number(policy.minConfidence))
    };
}

function inferLanguageFromSourcePath(sourcePath: string | undefined): TriadLanguage | 'unknown' {
    const normalized = String(sourcePath ?? '').toLowerCase();
    if (/\.(ts|tsx|mts|cts)$/.test(normalized)) return 'typescript';
    if (/\.(js|jsx|mjs|cjs)$/.test(normalized)) return 'javascript';
    if (/\.py$/.test(normalized)) return 'python';
    if (/\.go$/.test(normalized)) return 'go';
    if (/\.rs$/.test(normalized)) return 'rust';
    if (/\.(cc|cpp|cxx|hpp|hh|h)$/.test(normalized)) return 'cpp';
    if (/\.java$/.test(normalized)) return 'java';
    return 'unknown';
}

function dedupeStrings(values: string[]) {
    return Array.from(new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean)));
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
