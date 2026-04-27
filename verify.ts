import * as fs from 'fs';
import * as path from 'path';
import { loadTriadConfig, TriadLanguage } from './config';
import { buildTopologyIR, TriadOperationIR } from './ir';
import { TriadNodeDefinition } from './protocolRightBranch';
import { RuntimeMap } from './runtime/types';
import { calculateRuntimeRenderStats } from './runtime/runtimeVisualizer';
import { WorkspacePaths } from './workspace';

export interface VerifyMetrics {
    triad_nodes: number;
    triad_vertices: number;
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
    left_only_vertices: number;
    right_only_vertices: number;
    empty_vertices: number;
    scale_mixing_vertices: number;
    triad_completeness_violations: number;
    protocol_focus_alignment_violations: number;
    focus_closure_violations: number;
}

export interface VerifyThresholds {
    diagnostics_no_code: number;
    execute_like_ratio: number;
    ghost_ratio: number;
    rendered_edges_consistency: boolean;
    runtime_unmatched_route_count?: number;
    ghost_policy_compliance: boolean;
    left_only_vertices: number;
    right_only_vertices: number;
    empty_vertices: number;
    scale_mixing_vertices: number;
    triad_completeness: boolean;
    protocol_focus_alignment: boolean;
    triad_focus_closure: boolean;
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
        draftProtocolFile: string;
        microSplitFile: string;
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

export type TriadizationFocusGateFailureKind = 'protocol_focus_alignment' | 'triad_focus_closure' | 'mixed';

export interface TriadizationFocusGateReport {
    status: 'pass' | 'fail' | 'skip';
    failureKind?: TriadizationFocusGateFailureKind;
    canonicalFocus?: string;
    recommendedOperation?: string;
    summary: string;
    repairTarget?: string;
    details: string[];
    alignmentViolations: string[];
    closureViolations: string[];
}

type TriadNodeLike = {
    nodeId?: string;
    category?: string;
    sourcePath?: string;
    fission?: {
        problem?: string;
        demand?: unknown[];
        answer?: unknown[];
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

type TriadizationFocusReferenceLike = {
    triadizationFocus?: unknown;
    recommendedOperation?: unknown;
};

type MicroClassLike = {
    className?: string;
    staticRightBranch?: unknown[];
    dynamicLeftBranch?: unknown[];
    properties?: unknown[];
    methods?: unknown[];
};

type MicroSplitLike = TriadizationFocusReferenceLike & {
    classes?: Array<{
        className?: string;
        staticRightBranch?: unknown[];
        dynamicLeftBranch?: unknown[];
        properties?: unknown[];
        methods?: unknown[];
    }>;
};

type TriadCompletenessAnalysis = {
    triadVertices: number;
    leftOnlyVertices: string[];
    rightOnlyVertices: string[];
    emptyVertices: string[];
    scaleMixingVertices: string[];
};

type DraftProtocolLike = {
    macroSplit?: TriadizationFocusReferenceLike;
    mesoSplit?: TriadizationFocusReferenceLike;
    microSplit?: TriadizationFocusReferenceLike & {
        classes?: MicroClassLike[];
    };
};

type NormalizedFocusReference = {
    source: string;
    triadizationFocus: string;
    recommendedOperation: string;
};

type FocusAlignmentAnalysis = {
    artifactsInspected: string[];
    focusReferences: NormalizedFocusReference[];
    alignmentViolations: string[];
};

type FocusClosureAnalysis = {
    focusReference?: NormalizedFocusReference;
    closureViolations: string[];
};

type ParsedFocusTarget = {
    raw: string;
    owner: string;
    method?: string;
    sourcePath?: string;
};

const EXECUTE_LIKE_METHOD_PATTERN = /execute/i;

const GHOST_DEMAND_PATTERN = /^\[Ghost:[^\]]+\]/i;
const ORCHESTRATION_METHOD_PATTERN = /^(execute|run|handle|process|dispatch|apply|invoke|plan|schedule|orchestrate)$/i;
const HELPER_METHOD_PATTERN = /^(build|parse|format|normalize|sanitize|validate|resolve|collect|load|save|get|set)$/i;
const ORCHESTRATION_RESPONSIBILITY_PATTERN = /(workflow|orchestrat|pipeline|router|dispatch|command|stage|coordinat)/i;
const NONE_TOKENS = new Set(['', 'none', 'void', 'null', 'undefined']);

export function runTopologyVerify(paths: WorkspacePaths, options: VerifyOptions = {}): VerifyReport {
    const triadNodes = readTriadNodes(paths.mapFile);
    const config = loadTriadConfig(paths);
    const runtimeMap = readRuntimeMap(paths.runtimeMapFile);
    const runtimeDiagnostics = readRuntimeDiagnostics(paths.runtimeDiagnosticsFile);
    const draftProtocol = readDraftProtocol(paths.draftFile);
    const microSplit = readMicroSplit(paths.microSplitFile);
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
    const triadCompleteness = analyzeTriadCompleteness(
        triadNodes,
        microSplit,
        config.architecture.language,
        config.parser.genericContractIgnoreList
    );
    const focusAlignment = analyzeTriadizationFocusAlignment(draftProtocol, microSplit);
    const focusClosure = analyzeTriadFocusClosure(draftProtocol, microSplit, focusAlignment.focusReferences);

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
        ghost_policy_compliance: true,
        left_only_vertices: 0,
        right_only_vertices: 0,
        empty_vertices: 0,
        scale_mixing_vertices: 0,
        triad_completeness: true,
        protocol_focus_alignment: true,
        triad_focus_closure: true
    };

    const metrics: VerifyMetrics = {
        triad_nodes: triadNodes.length,
        triad_vertices: triadCompleteness.triadVertices,
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
        ghost_policy_violations: ghostPolicyViolations.length,
        left_only_vertices: triadCompleteness.leftOnlyVertices.length,
        right_only_vertices: triadCompleteness.rightOnlyVertices.length,
        empty_vertices: triadCompleteness.emptyVertices.length,
        scale_mixing_vertices: triadCompleteness.scaleMixingVertices.length,
        triad_completeness_violations:
            triadCompleteness.leftOnlyVertices.length +
            triadCompleteness.rightOnlyVertices.length +
            triadCompleteness.emptyVertices.length +
            triadCompleteness.scaleMixingVertices.length,
        protocol_focus_alignment_violations: focusAlignment.alignmentViolations.length,
        focus_closure_violations: focusClosure.closureViolations.length
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
    checks.push(
        evaluateNumericThreshold(
            'left_only_vertices',
            metrics.left_only_vertices,
            thresholds.left_only_vertices,
            '<=',
            buildTriadViolationDetail('Left-only vertices', triadCompleteness.leftOnlyVertices)
        )
    );
    checks.push(
        evaluateNumericThreshold(
            'right_only_vertices',
            metrics.right_only_vertices,
            thresholds.right_only_vertices,
            '<=',
            buildTriadViolationDetail('Right-only vertices', triadCompleteness.rightOnlyVertices)
        )
    );
    checks.push(
        evaluateNumericThreshold(
            'empty_vertices',
            metrics.empty_vertices,
            thresholds.empty_vertices,
            '<=',
            buildTriadViolationDetail('Empty vertices', triadCompleteness.emptyVertices)
        )
    );
    checks.push(
        evaluateNumericThreshold(
            'scale_mixing_vertices',
            metrics.scale_mixing_vertices,
            thresholds.scale_mixing_vertices,
            '<=',
            buildTriadViolationDetail('Scale-mixing vertices', triadCompleteness.scaleMixingVertices)
        )
    );
    checks.push(
        evaluateBooleanThreshold(
            'triad_completeness',
            metrics.triad_completeness_violations === 0,
            thresholds.triad_completeness,
            metrics.triad_completeness_violations > 0
                ? [
                      buildTriadViolationDetail('Left-only vertices', triadCompleteness.leftOnlyVertices),
                      buildTriadViolationDetail('Right-only vertices', triadCompleteness.rightOnlyVertices),
                      buildTriadViolationDetail('Empty vertices', triadCompleteness.emptyVertices),
                      buildTriadViolationDetail('Scale-mixing vertices', triadCompleteness.scaleMixingVertices)
                  ]
                      .filter((item) => !item.endsWith('none'))
                      .join('; ')
                : 'Triad completeness checks satisfied'
        )
    );
    if (focusAlignment.artifactsInspected.length > 0) {
        checks.push(
            evaluateBooleanThreshold(
                'protocol_focus_alignment',
                metrics.protocol_focus_alignment_violations === 0,
                thresholds.protocol_focus_alignment,
                metrics.protocol_focus_alignment_violations > 0
                    ? buildTriadViolationDetail('Protocol focus alignment', focusAlignment.alignmentViolations)
                    : 'draft-protocol.json and micro-split.json stay on the same triadization focus'
            )
        );
    } else {
        checks.push({
            key: 'protocol_focus_alignment',
            status: 'skip',
            expected: 'draft-protocol.json or micro-split.json present',
            actual: null,
            detail: 'Skipped protocol focus alignment because no triadization focus artifacts were found'
        });
    }
    if (focusClosure.focusReference) {
        checks.push(
            evaluateBooleanThreshold(
                'triad_focus_closure',
                metrics.focus_closure_violations === 0,
                thresholds.triad_focus_closure,
                metrics.focus_closure_violations > 0
                    ? buildTriadViolationDetail('Triad focus closure', focusClosure.closureViolations)
                    : `Focused class closes around ${focusClosure.focusReference.triadizationFocus}`
            )
        );
    } else {
        checks.push({
            key: 'triad_focus_closure',
            status: 'skip',
            expected: 'triadizationFocus available',
            actual: null,
            detail: 'Skipped triad focus closure because no canonical triadization focus could be resolved'
        });
    }

    const report: VerifyReport = {
        generatedAt: new Date().toISOString(),
        projectRoot: paths.projectRoot,
        artifacts: {
            triadMapFile: paths.mapFile,
            runtimeMapFile: paths.runtimeMapFile,
            runtimeDiagnosticsFile: paths.runtimeDiagnosticsFile,
            draftProtocolFile: paths.draftFile,
            microSplitFile: paths.microSplitFile
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
        `triad_nodes=${report.metrics.triad_nodes}, triad_vertices=${report.metrics.triad_vertices}, runtime_nodes=${report.metrics.runtime_nodes}, runtime_edges=${report.metrics.runtime_edges}`,
        `execute_like_ratio=${report.metrics.execute_like_ratio.toFixed(3)}, ghost_ratio=${report.metrics.ghost_ratio.toFixed(3)}`,
        `ghost_ratio_by_language=${JSON.stringify(report.metrics.ghost_ratio_by_language)}`,
        `ghost_in_demand_count_by_language=${JSON.stringify(report.metrics.ghost_in_demand_count_by_language)}`,
        `diagnostics_no_code=${report.metrics.diagnostics_no_code}, runtime_unmatched_route_count=${report.metrics.runtime_unmatched_route_count}`,
        `ghost_policy_violations=${report.metrics.ghost_policy_violations}`,
        `left_only_vertices=${report.metrics.left_only_vertices}, right_only_vertices=${report.metrics.right_only_vertices}, empty_vertices=${report.metrics.empty_vertices}, scale_mixing_vertices=${report.metrics.scale_mixing_vertices}`,
        `protocol_focus_alignment_violations=${report.metrics.protocol_focus_alignment_violations}, focus_closure_violations=${report.metrics.focus_closure_violations}`,
        `rendered_runtime_edges=${report.metrics.rendered_runtime_edges}, rendered_edges_consistency=${report.metrics.rendered_edges_consistency}`,
        ...checkLines
    ].join('\n');
}

function evaluateNumericThreshold(
    key: keyof VerifyThresholds,
    actual: number,
    expected: number,
    operator: '<' | '<=',
    detailHint?: string
): VerifyCheckResult {
    const pass = operator === '<' ? actual < expected : actual <= expected;
    return {
        key,
        status: pass ? 'pass' : 'fail',
        expected,
        actual,
        detail: detailHint ?? (operator === '<' ? `must be < ${expected}` : `must be <= ${expected}`)
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

function readMicroSplit(filePath: string) {
    const parsed = readJsonIfExists(filePath);
    if (!parsed || typeof parsed !== 'object') {
        return undefined;
    }
    return parsed as MicroSplitLike;
}

function readDraftProtocol(filePath: string) {
    const parsed = readJsonIfExists(filePath);
    if (!parsed || typeof parsed !== 'object') {
        return undefined;
    }
    return parsed as DraftProtocolLike;
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

function analyzeTriadCompleteness(
    triadNodes: TriadNodeLike[],
    microSplit: MicroSplitLike | undefined,
    language: TriadLanguage,
    genericContractIgnoreList: string[]
): TriadCompletenessAnalysis {
    const leftOnlyVertices = new Set<string>();
    const rightOnlyVertices = new Set<string>();
    const emptyVertices = new Set<string>();
    const scaleMixingVertices = new Set<string>();
    const triadDefinitions = triadNodes.filter(isTriadNodeDefinition);

    for (const blueprint of Array.isArray(microSplit?.classes) ? microSplit!.classes! : []) {
        const className = String(blueprint?.className ?? '').trim();
        if (!className) {
            continue;
        }

        const staticRightBranch = readBranchArray(blueprint?.staticRightBranch, blueprint?.properties);
        const dynamicLeftBranch = readBranchArray(blueprint?.dynamicLeftBranch, blueprint?.methods);
        const label = `micro:${className}`;

        if (staticRightBranch.length === 0 && dynamicLeftBranch.length > 0) {
            leftOnlyVertices.add(label);
        }
        if (staticRightBranch.length > 0 && dynamicLeftBranch.length === 0) {
            rightOnlyVertices.add(label);
        }
        if (staticRightBranch.length === 0 && dynamicLeftBranch.length === 0) {
            emptyVertices.add(label);
        }
        if (hasScaleMixingBranch(dynamicLeftBranch)) {
            scaleMixingVertices.add(label);
        }
    }

    const topology = buildTopologyIR(triadDefinitions, language);
    for (const vertex of topology.vertices) {
        const meaningfulStaticRightBranch = vertex.staticRightBranch.filter((entry) =>
            isMeaningfulRightBranchContract(entry, genericContractIgnoreList)
        );
        const orchestrationCount = vertex.dynamicLeftBranch.filter((operation) => isOrchestrationOperation(operation)).length;
        const label = `ir:${formatVertexLabel(vertex.nodeId, vertex.sourcePath)}`;

        if (
            meaningfulStaticRightBranch.length === 0 &&
            orchestrationCount > 0 &&
            vertex.dynamicLeftBranch.length >= 2
        ) {
            leftOnlyVertices.add(label);
        }
        if (hasScaleMixingOperations(vertex.dynamicLeftBranch)) {
            scaleMixingVertices.add(label);
        }
    }

    return {
        triadVertices: topology.vertices.length,
        leftOnlyVertices: Array.from(leftOnlyVertices).sort(),
        rightOnlyVertices: Array.from(rightOnlyVertices).sort(),
        emptyVertices: Array.from(emptyVertices).sort(),
        scaleMixingVertices: Array.from(scaleMixingVertices).sort()
    };
}

function analyzeTriadizationFocusAlignment(
    draftProtocol: DraftProtocolLike | undefined,
    microSplit: MicroSplitLike | undefined
): FocusAlignmentAnalysis {
    const artifactsInspected: string[] = [];
    const focusReferences: NormalizedFocusReference[] = [];
    const alignmentViolations: string[] = [];

    if (draftProtocol) {
        artifactsInspected.push('draft-protocol.json');
        collectFocusReference('draft-protocol.json macroSplit', draftProtocol.macroSplit, focusReferences, alignmentViolations);
        collectFocusReference('draft-protocol.json mesoSplit', draftProtocol.mesoSplit, focusReferences, alignmentViolations);
        collectFocusReference('draft-protocol.json microSplit', draftProtocol.microSplit, focusReferences, alignmentViolations);
    }

    if (microSplit) {
        artifactsInspected.push('micro-split.json');
        collectFocusReference('micro-split.json', microSplit, focusReferences, alignmentViolations);
    }

    const canonicalReference = resolvePrimaryFocusReference(focusReferences);
    if (!canonicalReference) {
        return {
            artifactsInspected,
            focusReferences,
            alignmentViolations: dedupeStrings(alignmentViolations)
        };
    }

    for (const reference of focusReferences) {
        if (
            reference.triadizationFocus !== canonicalReference.triadizationFocus ||
            reference.recommendedOperation !== canonicalReference.recommendedOperation
        ) {
            alignmentViolations.push(
                `${reference.source} drifts from ${canonicalReference.source}: ${reference.triadizationFocus} -> ${reference.recommendedOperation}`
            );
        }
    }

    return {
        artifactsInspected,
        focusReferences,
        alignmentViolations: dedupeStrings(alignmentViolations)
    };
}

export function evaluateTriadizationFocusGateArtifacts(
    draftProtocol: unknown,
    microSplit: unknown
): TriadizationFocusGateReport {
    const normalizedDraftProtocol =
        draftProtocol && typeof draftProtocol === 'object' ? (draftProtocol as DraftProtocolLike) : undefined;
    const normalizedMicroSplit =
        microSplit && typeof microSplit === 'object' ? (microSplit as MicroSplitLike) : undefined;
    const focusAlignment = analyzeTriadizationFocusAlignment(normalizedDraftProtocol, normalizedMicroSplit);
    const focusClosure = analyzeTriadFocusClosure(
        normalizedDraftProtocol,
        normalizedMicroSplit,
        focusAlignment.focusReferences
    );
    const canonicalReference = focusClosure.focusReference ?? resolvePrimaryFocusReference(focusAlignment.focusReferences);
    const alignmentViolations = focusAlignment.alignmentViolations;
    const closureViolations = focusClosure.closureViolations;
    const failureKind = resolveFocusGateFailureKind(alignmentViolations.length, closureViolations.length);
    const canonicalFocus = canonicalReference?.triadizationFocus;
    const recommendedOperation = canonicalReference?.recommendedOperation;

    if (!canonicalReference && focusAlignment.artifactsInspected.length === 0) {
        return {
            status: 'skip',
            summary: '尚未检测到可用的 triadization focus 工件',
            details: [],
            alignmentViolations,
            closureViolations
        };
    }

    if (!failureKind) {
        return {
            status: canonicalReference ? 'pass' : 'skip',
            canonicalFocus,
            recommendedOperation,
            summary: canonicalReference
                ? `焦点已对齐并闭环：${canonicalReference.triadizationFocus} -> ${canonicalReference.recommendedOperation}`
                : '未解析出稳定的 triadization focus，但当前没有检测到显式漂移',
            repairTarget: canonicalReference
                ? `${canonicalReference.triadizationFocus} -> ${canonicalReference.recommendedOperation}`
                : undefined,
            details: canonicalReference
                ? [`canonicalFocus: ${canonicalReference.triadizationFocus} -> ${canonicalReference.recommendedOperation}`]
                : [],
            alignmentViolations,
            closureViolations
        };
    }

    return {
        status: 'fail',
        failureKind,
        canonicalFocus,
        recommendedOperation,
        summary: buildTriadizationFocusGateSummary(failureKind, canonicalReference),
        repairTarget: buildTriadizationFocusGateRepairTarget(failureKind, canonicalReference),
        details: [...alignmentViolations, ...closureViolations],
        alignmentViolations,
        closureViolations
    };
}

function analyzeTriadFocusClosure(
    draftProtocol: DraftProtocolLike | undefined,
    microSplit: MicroSplitLike | undefined,
    focusReferences: NormalizedFocusReference[]
): FocusClosureAnalysis {
    const focusReference = resolvePrimaryFocusReference(focusReferences);
    if (!focusReference) {
        return {
            closureViolations: []
        };
    }

    const focusTarget = parseFocusTarget(focusReference.triadizationFocus);
    if (!focusTarget) {
        return {
            focusReference,
            closureViolations: [`Unable to parse triadization focus ${focusReference.triadizationFocus}`]
        };
    }

    const closureViolations: string[] = [];
    closureViolations.push(
        ...evaluateFocusedClassClosure('micro-split.json', readMicroClasses(microSplit?.classes), focusTarget)
    );
    if (draftProtocol?.microSplit) {
        closureViolations.push(
            ...evaluateFocusedClassClosure(
                'draft-protocol.json microSplit',
                readMicroClasses(draftProtocol.microSplit.classes),
                focusTarget
            )
        );
    }

    return {
        focusReference,
        closureViolations: dedupeStrings(closureViolations)
    };
}

function isTriadNodeDefinition(node: TriadNodeLike): node is TriadNodeDefinition {
    return (
        typeof node?.nodeId === 'string' &&
        typeof node?.fission?.problem === 'string' &&
        Array.isArray(node?.fission?.demand) &&
        Array.isArray(node?.fission?.answer)
    );
}

function readBranchArray(primary: unknown[] | undefined, fallback: unknown[] | undefined) {
    if (Array.isArray(primary)) {
        return primary;
    }
    return Array.isArray(fallback) ? fallback : [];
}

function readMicroClasses(classes: unknown[] | undefined) {
    return Array.isArray(classes) ? (classes as MicroClassLike[]) : [];
}

function collectFocusReference(
    source: string,
    reference: TriadizationFocusReferenceLike | undefined,
    focusReferences: NormalizedFocusReference[],
    violations: string[]
) {
    if (!reference || typeof reference !== 'object') {
        return;
    }

    const triadizationFocus = String(reference.triadizationFocus ?? '').trim();
    const recommendedOperation = String(reference.recommendedOperation ?? '').trim().toLowerCase();
    const hasOtherStructure = Object.entries(reference as Record<string, unknown>).some(([key, value]) => {
        if (key === 'triadizationFocus' || key === 'recommendedOperation') {
            return false;
        }
        if (Array.isArray(value)) {
            return value.length > 0;
        }
        if (typeof value === 'string') {
            return value.trim().length > 0;
        }
        return value !== undefined && value !== null;
    });
    if (!triadizationFocus && !recommendedOperation) {
        if (hasOtherStructure) {
            violations.push(`${source} is missing triadizationFocus and recommendedOperation`);
        }
        return;
    }

    if (!triadizationFocus || !recommendedOperation) {
        violations.push(`${source} is missing triadizationFocus or recommendedOperation`);
        return;
    }

    focusReferences.push({
        source,
        triadizationFocus,
        recommendedOperation
    });
}

function resolvePrimaryFocusReference(focusReferences: NormalizedFocusReference[]) {
    if (focusReferences.length === 0) {
        return undefined;
    }

    const preferredSourceOrder = [
        'draft-protocol.json microSplit',
        'micro-split.json',
        'draft-protocol.json macroSplit',
        'draft-protocol.json mesoSplit'
    ];
    for (const source of preferredSourceOrder) {
        const match = focusReferences.find((reference) => reference.source === source);
        if (match) {
            return match;
        }
    }

    return focusReferences[0];
}

function resolveFocusGateFailureKind(alignmentViolationCount: number, closureViolationCount: number) {
    if (alignmentViolationCount > 0 && closureViolationCount > 0) {
        return 'mixed' as const;
    }
    if (alignmentViolationCount > 0) {
        return 'protocol_focus_alignment' as const;
    }
    if (closureViolationCount > 0) {
        return 'triad_focus_closure' as const;
    }
    return undefined;
}

function buildTriadizationFocusGateSummary(
    failureKind: TriadizationFocusGateFailureKind,
    focusReference: NormalizedFocusReference | undefined
) {
    if (failureKind === 'protocol_focus_alignment') {
        return focusReference
            ? `焦点漂移：draft-protocol.json 与 micro-split.json 没有围绕同一个 triadization focus（当前应对齐到 ${focusReference.triadizationFocus} -> ${focusReference.recommendedOperation}）`
            : '焦点漂移：draft-protocol.json 与 micro-split.json 没有围绕同一个 triadization focus';
    }

    if (failureKind === 'triad_focus_closure') {
        return focusReference
            ? `焦点未闭环：${focusReference.triadizationFocus} 还没有在同一类的左右分支中闭合`
            : '焦点未闭环：当前 triadization focus 还没有在同一类的左右分支中闭合';
    }

    return focusReference
        ? `焦点既漂移又未闭环：先把所有产物对齐到 ${focusReference.triadizationFocus} -> ${focusReference.recommendedOperation}，再补齐类级左右分支闭环`
        : '焦点既漂移又未闭环：先统一 triadization focus，再补齐类级左右分支闭环';
}

function buildTriadizationFocusGateRepairTarget(
    failureKind: TriadizationFocusGateFailureKind,
    focusReference: NormalizedFocusReference | undefined
) {
    if (!focusReference) {
        return failureKind === 'protocol_focus_alignment'
            ? '统一 triadizationFocus / recommendedOperation'
            : undefined;
    }

    if (failureKind === 'protocol_focus_alignment') {
        return `${focusReference.triadizationFocus} -> ${focusReference.recommendedOperation}`;
    }

    const focusTarget = parseFocusTarget(focusReference.triadizationFocus);
    if (!focusTarget) {
        return `${focusReference.triadizationFocus} -> ${focusReference.recommendedOperation}`;
    }

    if (!focusTarget.method) {
        return `${focusTarget.raw} (class ${focusTarget.owner})`;
    }

    return `${focusTarget.raw} (class ${focusTarget.owner}, method ${focusTarget.method})`;
}

function parseFocusTarget(triadizationFocus: string): ParsedFocusTarget | undefined {
    const raw = String(triadizationFocus ?? '').trim();
    if (!raw) {
        return undefined;
    }

    const atIndex = raw.indexOf('@');
    const nodePart = atIndex >= 0 ? raw.slice(0, atIndex).trim() : raw;
    const sourcePath = atIndex >= 0 ? raw.slice(atIndex + 1).trim() : undefined;
    const parts = nodePart.split('.').map((part) => part.trim()).filter(Boolean);
    if (parts.length === 0) {
        return undefined;
    }

    if (parts.length === 1) {
        return {
            raw,
            owner: parts[0],
            sourcePath
        };
    }

    return {
        raw,
        owner: parts[parts.length - 2],
        method: parts[parts.length - 1],
        sourcePath
    };
}

function evaluateFocusedClassClosure(label: string, classes: MicroClassLike[], focusTarget: ParsedFocusTarget) {
    if (classes.length === 0) {
        return [`${label} has no classes for focus ${focusTarget.raw}`];
    }

    const blueprint = classes.find(
        (candidate) => String(candidate?.className ?? '').trim() === focusTarget.owner
    );
    if (!blueprint) {
        return [`${label} is missing focused class ${focusTarget.owner}`];
    }

    const closureViolations: string[] = [];
    const staticRightBranch = readBranchArray(blueprint.staticRightBranch, blueprint.properties);
    const dynamicLeftBranch = readBranchArray(blueprint.dynamicLeftBranch, blueprint.methods);
    if (staticRightBranch.length === 0) {
        closureViolations.push(`${label} class ${focusTarget.owner} has no staticRightBranch`);
    }
    if (dynamicLeftBranch.length === 0) {
        closureViolations.push(`${label} class ${focusTarget.owner} has no dynamicLeftBranch`);
    }

    if (focusTarget.method) {
        const hasFocusedMethod = dynamicLeftBranch.some(
            (entry) => String((entry as { name?: unknown })?.name ?? '').trim() === focusTarget.method
        );
        if (!hasFocusedMethod) {
            closureViolations.push(`${label} class ${focusTarget.owner} is missing focus method ${focusTarget.method}`);
        }
    }

    return closureViolations;
}

function hasScaleMixingBranch(branch: unknown[]) {
    if (branch.length < 2) {
        return false;
    }

    let helperCount = 0;
    let orchestrationCount = 0;
    for (const entry of branch) {
        const name = typeof (entry as { name?: unknown })?.name === 'string' ? String((entry as { name?: unknown }).name) : '';
        const responsibility =
            typeof (entry as { responsibility?: unknown })?.responsibility === 'string'
                ? String((entry as { responsibility?: unknown }).responsibility)
                : '';
        if (isHelperMethodName(name)) {
            helperCount += 1;
        }
        if (ORCHESTRATION_METHOD_PATTERN.test(name) || ORCHESTRATION_RESPONSIBILITY_PATTERN.test(responsibility)) {
            orchestrationCount += 1;
        }
    }

    return helperCount > 0 && orchestrationCount > 0;
}

function hasScaleMixingOperations(operations: TriadOperationIR[]) {
    if (operations.length < 3) {
        return false;
    }

    const helperCount = operations.filter((operation) => isHelperMethodName(operation.name)).length;
    const orchestrationCount = operations.filter((operation) => isOrchestrationOperation(operation)).length;
    return helperCount > 0 && orchestrationCount > 0;
}

function isOrchestrationOperation(operation: Pick<TriadOperationIR, 'name' | 'responsibility'>) {
    return (
        ORCHESTRATION_METHOD_PATTERN.test(String(operation.name ?? '').trim()) ||
        ORCHESTRATION_RESPONSIBILITY_PATTERN.test(String(operation.responsibility ?? '').trim())
    );
}

function isHelperMethodName(name: string) {
    return HELPER_METHOD_PATTERN.test(String(name ?? '').trim());
}

function isMeaningfulRightBranchContract(contract: string, genericContractIgnoreList: string[]) {
    const normalized = normalizeContractKey(contract);
    if (!normalized || NONE_TOKENS.has(normalized) || GHOST_DEMAND_PATTERN.test(String(contract ?? '').trim())) {
        return false;
    }

    return !resolveGenericContractIgnoreSet(genericContractIgnoreList).has(normalized);
}

function resolveGenericContractIgnoreSet(values: string[]) {
    return new Set(
        (Array.isArray(values) ? values : [])
            .map((value) => normalizeContractKey(value))
            .filter((value) => value && !NONE_TOKENS.has(value))
    );
}

function normalizeContractKey(contract: unknown) {
    if (typeof contract !== 'string') {
        return '';
    }

    return contract
        .trim()
        .replace(/\[[^\]]+\]/g, '')
        .replace(/\([^()]*\)/g, '')
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

function formatVertexLabel(nodeId: string, sourcePath?: string) {
    return sourcePath?.trim() ? `${nodeId}@${sourcePath.trim()}` : nodeId;
}

function buildTriadViolationDetail(title: string, values: string[]) {
    return values.length === 0 ? `${title}: none` : `${title}: ${values.slice(0, 6).join(', ')}`;
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
