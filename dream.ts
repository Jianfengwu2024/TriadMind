import * as fs from 'fs';
import * as path from 'path';
import { loadTriadConfig, resolveCategoryBySourcePath, TriadLanguage } from './config';
import { TriadCategory, TriadOp, UpgradeProtocol } from './protocol';
import { VerifyMetrics, runTopologyVerify } from './verify';
import { WorkspacePaths } from './workspace';

const EXECUTE_LIKE_METHOD_PATTERN = /execute/i;
const GHOST_DEMAND_PATTERN = /^\[Ghost:[^\]]+\]/i;
const UNMATCHED_ROUTE_DIAGNOSTIC_CODE = 'RUNTIME_FRONTEND_API_ROUTE_UNMATCHED';
const DEFAULT_EXECUTE_RATIO_LIMIT = 0.1;
const DEFAULT_GHOST_RATIO_LIMIT = 0.4;
const FANOUT_ALERT_THRESHOLD = 6;
const DREAM_IDLE_YIELD_BATCH_SIZE = 200;

type TriadNodeLike = {
    nodeId?: string;
    category?: string;
    sourcePath?: string;
    fission?: {
        problem?: string;
        demand?: string[];
        answer?: string[];
    };
};

type RuntimeDiagnosticLike = {
    level?: string;
    code?: string;
    extractor?: string;
    message?: string;
    sourcePath?: string;
};

interface RuntimeMapLike {
    nodes?: unknown[];
    edges?: unknown[];
}

export interface DreamDiagnostic {
    level: 'info' | 'warning' | 'error';
    code: string;
    component: string;
    message: string;
    sourcePath?: string;
}

export interface DreamEvidence {
    type: 'metric' | 'node' | 'diagnostic' | 'runtime';
    key: string;
    value: string;
    sourcePath?: string;
}

export interface DreamFinding {
    id: string;
    type: 'metric' | 'topology' | 'runtime' | 'governance';
    severity: 'info' | 'warning' | 'error';
    title: string;
    description: string;
    metric?: string;
    currentValue?: number | boolean | string;
    targetValue?: number | boolean | string;
    confidence: number;
    evidence: DreamEvidence[];
}

export interface DreamProposal {
    id: string;
    title: string;
    priority: 'low' | 'medium' | 'high';
    confidence: number;
    category?: TriadCategory | 'unknown';
    sourcePath?: string;
    objective: string;
    expectedOutcome: string;
    actions: string[];
    linkedFindings: string[];
    evidence: DreamEvidence[];
    protocolDraft?: UpgradeProtocol;
}

export interface DreamState {
    schemaVersion: '1.0';
    updatedAt: string;
    lastRunAt?: string;
    lastMode?: DreamMode;
    runs: number;
    lastFindingCount: number;
    lastProposalCount: number;
}

export interface DreamReport {
    schemaVersion: '1.0';
    project: string;
    generatedAt: string;
    mode: DreamMode;
    skipped: boolean;
    skipReason?: string;
    config: {
        enabled: boolean;
        idleOnly: boolean;
        minHoursBetweenRuns: number;
        minConfidence: number;
        maxProposals: number;
    };
    metrics: VerifyMetrics;
    findings: DreamFinding[];
    proposals: DreamProposal[];
    diagnostics: DreamDiagnostic[];
    summary: string[];
}

export type DreamMode = 'manual' | 'idle';

export interface DreamRunOptions {
    mode?: DreamMode;
    force?: boolean;
    maxProposals?: number;
    minConfidence?: number;
}

export interface DreamRunResult {
    report: DreamReport;
    artifacts: {
        reportFile: string;
        diagnosticsFile: string;
        proposalsFile: string;
        stateFile: string;
    };
}

interface DreamConfigNormalized {
    enabled: boolean;
    idleOnly: boolean;
    minHoursBetweenRuns: number;
    minConfidence: number;
    maxProposals: number;
    failOnDreamError: boolean;
}

interface FanoutNode {
    nodeId: string;
    downstreamCount: number;
    downstreamNodeIds: string[];
}

export async function runDreamAnalysis(paths: WorkspacePaths, options: DreamRunOptions = {}): Promise<DreamRunResult> {
    const config = loadTriadConfig(paths);
    const dreamConfig = normalizeDreamConfig(config.dream, options);
    const mode = normalizeDreamMode(options.mode, dreamConfig.idleOnly);
    const now = new Date();
    const generatedAt = now.toISOString();
    const diagnostics: DreamDiagnostic[] = [];
    const metrics = runTopologyVerify(paths, { strict: false }).metrics;
    const state = readDreamState(paths.dreamStateFile);

    if (!dreamConfig.enabled && !options.force) {
        const report = createSkippedReport(
            paths,
            generatedAt,
            mode,
            dreamConfig,
            metrics,
            'Dream analysis disabled by config.dream.enabled=false',
            diagnostics
        );
        persistDreamArtifacts(paths, report, state);
        return buildDreamResult(paths, report);
    }

    if (mode === 'idle' && !options.force && isIdleGateBlocked(state.lastRunAt, dreamConfig.minHoursBetweenRuns, now)) {
        const report = createSkippedReport(
            paths,
            generatedAt,
            mode,
            dreamConfig,
            metrics,
            `Idle gate active: wait at least ${dreamConfig.minHoursBetweenRuns} hour(s) between runs`,
            diagnostics
        );
        persistDreamArtifacts(paths, report, state);
        return buildDreamResult(paths, report);
    }

    const triadNodes = readTriadNodes(paths.mapFile, diagnostics);
    const runtimeMap = readRuntimeMap(paths.runtimeMapFile, diagnostics);
    const runtimeDiagnostics = readRuntimeDiagnostics(paths.runtimeDiagnosticsFile, diagnostics);
    const fanoutNodes = await detectHighFanoutNodes(triadNodes, FANOUT_ALERT_THRESHOLD, {
        enableYield: mode === 'idle',
        batchSize: DREAM_IDLE_YIELD_BATCH_SIZE
    });
    const findings = buildDreamFindings(metrics, triadNodes, runtimeDiagnostics, fanoutNodes);
    const rankedProposals = rankAndFilterProposals(
        buildDreamProposals(paths, findings, triadNodes, runtimeDiagnostics, fanoutNodes),
        dreamConfig.minConfidence,
        dreamConfig.maxProposals
    );
    const proposals = validateProposalConsistency(rankedProposals, config.categories, diagnostics);
    const summary = buildSummary(metrics, findings, proposals, runtimeMap);

    const report: DreamReport = {
        schemaVersion: '1.0',
        project: path.basename(paths.projectRoot),
        generatedAt,
        mode,
        skipped: false,
        config: {
            enabled: dreamConfig.enabled,
            idleOnly: dreamConfig.idleOnly,
            minHoursBetweenRuns: dreamConfig.minHoursBetweenRuns,
            minConfidence: dreamConfig.minConfidence,
            maxProposals: dreamConfig.maxProposals
        },
        metrics,
        findings,
        proposals,
        diagnostics,
        summary
    };

    persistDreamArtifacts(paths, report, state, mode);
    return buildDreamResult(paths, report);
}

export function loadLatestDreamReport(paths: WorkspacePaths) {
    return readJsonIfExists(paths.dreamReportFile) as DreamReport | undefined;
}

export function formatDreamReport(report: DreamReport) {
    const lines: string[] = [];
    const status = report.skipped ? 'SKIP' : 'PASS';
    lines.push(`TriadMind Dream (${status})`);
    lines.push(`generatedAt=${report.generatedAt}`);
    lines.push(`mode=${report.mode}, skipped=${report.skipped ? 'true' : 'false'}`);
    if (report.skipReason) {
        lines.push(`skip_reason=${report.skipReason}`);
    }
    lines.push(
        `metrics: execute_like_ratio=${report.metrics.execute_like_ratio.toFixed(3)}, ghost_ratio=${report.metrics.ghost_ratio.toFixed(3)}, runtime_unmatched_route_count=${report.metrics.runtime_unmatched_route_count}`
    );
    lines.push(
        `runtime: nodes=${report.metrics.runtime_nodes}, edges=${report.metrics.runtime_edges}, rendered_edges_consistency=${report.metrics.rendered_edges_consistency}`
    );
    lines.push(`findings=${report.findings.length}, proposals=${report.proposals.length}, diagnostics=${report.diagnostics.length}`);
    report.summary.forEach((entry) => lines.push(`- ${entry}`));
    report.proposals.slice(0, 6).forEach((proposal) => {
        lines.push(
            `* [${proposal.priority.toUpperCase()}] ${proposal.id} confidence=${proposal.confidence.toFixed(2)} :: ${proposal.title}`
        );
    });
    return lines.join('\n');
}

function createSkippedReport(
    paths: WorkspacePaths,
    generatedAt: string,
    mode: DreamMode,
    config: DreamConfigNormalized,
    metrics: VerifyMetrics,
    reason: string,
    diagnostics: DreamDiagnostic[]
) {
    diagnostics.push({
        level: 'info',
        code: 'DREAM_RUN_SKIPPED',
        component: 'DreamRunner',
        message: reason
    });

    return {
        schemaVersion: '1.0' as const,
        project: path.basename(paths.projectRoot),
        generatedAt,
        mode,
        skipped: true,
        skipReason: reason,
        config: {
            enabled: config.enabled,
            idleOnly: config.idleOnly,
            minHoursBetweenRuns: config.minHoursBetweenRuns,
            minConfidence: config.minConfidence,
            maxProposals: config.maxProposals
        },
        metrics,
        findings: [] as DreamFinding[],
        proposals: [] as DreamProposal[],
        diagnostics,
        summary: [reason]
    };
}

function buildDreamFindings(
    metrics: VerifyMetrics,
    triadNodes: TriadNodeLike[],
    runtimeDiagnostics: RuntimeDiagnosticLike[],
    fanoutNodes: FanoutNode[]
) {
    const findings: DreamFinding[] = [];

    if (metrics.execute_like_ratio >= DEFAULT_EXECUTE_RATIO_LIMIT) {
        findings.push({
            id: 'FINDING_EXECUTE_RATIO_HIGH',
            type: 'metric',
            severity: 'warning',
            title: 'execute-like ratio is high',
            description: `execute-like capability nodes occupy ${(metrics.execute_like_ratio * 100).toFixed(1)}% of triad map.`,
            metric: 'execute_like_ratio',
            currentValue: metrics.execute_like_ratio,
            targetValue: DEFAULT_EXECUTE_RATIO_LIMIT,
            confidence: ratioConfidence(metrics.execute_like_ratio, DEFAULT_EXECUTE_RATIO_LIMIT),
            evidence: collectTopExecuteEvidence(triadNodes, 6)
        });
    }

    if (metrics.ghost_ratio >= DEFAULT_GHOST_RATIO_LIMIT) {
        findings.push({
            id: 'FINDING_GHOST_RATIO_HIGH',
            type: 'metric',
            severity: 'warning',
            title: 'ghost ratio is high',
            description: `ghost demand appears in ${(metrics.ghost_ratio * 100).toFixed(1)}% of capability nodes.`,
            metric: 'ghost_ratio',
            currentValue: metrics.ghost_ratio,
            targetValue: DEFAULT_GHOST_RATIO_LIMIT,
            confidence: ratioConfidence(metrics.ghost_ratio, DEFAULT_GHOST_RATIO_LIMIT),
            evidence: collectTopGhostEvidence(triadNodes, 6)
        });
    }

    if (metrics.runtime_unmatched_route_count > 0) {
        findings.push({
            id: 'FINDING_RUNTIME_UNMATCHED_ROUTES',
            type: 'runtime',
            severity: metrics.runtime_unmatched_route_count > 22 ? 'error' : 'warning',
            title: 'frontend API calls are not fully matched',
            description: `Detected ${metrics.runtime_unmatched_route_count} unmatched frontend API route call(s).`,
            metric: 'runtime_unmatched_route_count',
            currentValue: metrics.runtime_unmatched_route_count,
            targetValue: '<= 22',
            confidence: clampNumber(0.55 + metrics.runtime_unmatched_route_count * 0.02, 0, 0.95),
            evidence: collectUnmatchedRouteEvidence(runtimeDiagnostics, 8)
        });
    }

    if (!metrics.rendered_edges_consistency) {
        findings.push({
            id: 'FINDING_RUNTIME_RENDER_INCONSISTENT',
            type: 'runtime',
            severity: 'error',
            title: 'runtime rendered edges mismatch runtime-map',
            description: `Rendered edges=${metrics.rendered_runtime_edges}, runtime map edges=${metrics.runtime_edges}.`,
            metric: 'rendered_edges_consistency',
            currentValue: metrics.rendered_edges_consistency,
            targetValue: true,
            confidence: 0.9,
            evidence: [
                {
                    type: 'metric',
                    key: 'rendered_runtime_edges',
                    value: String(metrics.rendered_runtime_edges)
                },
                {
                    type: 'metric',
                    key: 'runtime_edges',
                    value: String(metrics.runtime_edges)
                }
            ]
        });
    }

    if (metrics.diagnostics_no_code > 0) {
        findings.push({
            id: 'FINDING_RUNTIME_DIAGNOSTICS_NO_CODE',
            type: 'governance',
            severity: 'error',
            title: 'runtime diagnostics have missing code',
            description: `${metrics.diagnostics_no_code} runtime diagnostic item(s) do not contain code.`,
            metric: 'diagnostics_no_code',
            currentValue: metrics.diagnostics_no_code,
            targetValue: 0,
            confidence: 0.95,
            evidence: [
                {
                    type: 'metric',
                    key: 'diagnostics_no_code',
                    value: String(metrics.diagnostics_no_code)
                }
            ]
        });
    }

    if (fanoutNodes.length > 0) {
        findings.push({
            id: 'FINDING_HIGH_FANOUT_CAPABILITY',
            type: 'topology',
            severity: 'warning',
            title: 'high-fanout capability detected',
            description: `${fanoutNodes.length} node(s) exceed downstream fanout threshold ${FANOUT_ALERT_THRESHOLD}.`,
            metric: 'fanout',
            currentValue: fanoutNodes.length,
            targetValue: `0 nodes >= ${FANOUT_ALERT_THRESHOLD}`,
            confidence: 0.76,
            evidence: fanoutNodes.slice(0, 6).map((item) => ({
                type: 'node',
                key: item.nodeId,
                value: `${item.downstreamCount} downstream nodes`
            }))
        });
    }

    return findings.sort((left, right) => severityRank(right.severity) - severityRank(left.severity));
}

function buildDreamProposals(
    paths: WorkspacePaths,
    findings: DreamFinding[],
    triadNodes: TriadNodeLike[],
    runtimeDiagnostics: RuntimeDiagnosticLike[],
    fanoutNodes: FanoutNode[]
) {
    const proposals: DreamProposal[] = [];
    const findingIndex = new Map(findings.map((item) => [item.id, item]));
    const nodeById = new Map(
        triadNodes
            .map((node) => ({
                nodeId: String(node?.nodeId ?? '').trim(),
                node
            }))
            .filter((item) => item.nodeId)
            .map((item) => [item.nodeId, item.node])
    );

    const executeFinding = findingIndex.get('FINDING_EXECUTE_RATIO_HIGH');
    if (executeFinding) {
        const executeNodes = triadNodes
            .filter((node) => isExecuteLikeNodeId(node.nodeId))
            .slice(0, 4);
        proposals.push({
            id: 'DREAM_CAPABILITY_EXECUTE_DENOISE',
            title: 'Reduce execute-like capability dominance',
            priority: 'high',
            confidence: clampNumber(executeFinding.confidence, 0, 0.92),
            objective: 'Split generic execute orchestration into explicit business capabilities.',
            expectedOutcome: 'execute_like_ratio trends down and blast-radius impact becomes more explicit.',
            actions: [
                'Promote business verbs over generic execute/run naming for capability anchors.',
                'Split orchestration-heavy execute nodes into child capabilities with explicit contracts.',
                'Run `triadmind sync --force` + `triadmind verify --strict` after refactor.'
            ],
            linkedFindings: [executeFinding.id],
            evidence: executeFinding.evidence,
            protocolDraft: buildExecuteDenoiseProtocol(paths, executeNodes)
        });
    }

    const ghostFinding = findingIndex.get('FINDING_GHOST_RATIO_HIGH');
    if (ghostFinding) {
        proposals.push({
            id: 'DREAM_GHOST_SIGNAL_REBALANCE',
            title: 'Rebalance ghost signals into evidence layer',
            priority: 'high',
            confidence: clampNumber(ghostFinding.confidence, 0, 0.9),
            objective: 'Keep main capability graph readable while preserving ghost evidence for drill-down.',
            expectedOutcome: 'ghost_ratio drops under governance threshold without losing traceability.',
            actions: [
                'Apply language-aware ghost policy: dynamic languages keep ghost in evidence only.',
                'Retain only high-confidence Top-K ghost reads in demand for static languages.',
                'Audit retained ghost entries by confidence and business relevance.'
            ],
            linkedFindings: [ghostFinding.id],
            evidence: [...ghostFinding.evidence, ...enrichGhostPolicyEvidence(triadNodes).slice(0, 4)]
        });
    }

    const unmatchedFinding = findingIndex.get('FINDING_RUNTIME_UNMATCHED_ROUTES');
    if (unmatchedFinding) {
        proposals.push({
            id: 'DREAM_RUNTIME_ROUTE_ALIGNMENT',
            title: 'Improve frontend-to-api route matching',
            priority: 'medium',
            confidence: clampNumber(unmatchedFinding.confidence, 0, 0.88),
            objective: 'Reduce runtime unmatched route warnings and improve request-flow confidence.',
            expectedOutcome: 'runtime_unmatched_route_count declines and request-flow graph becomes actionable.',
            actions: [
                'Normalize frontend URL paths before matching: template params, query strip, duplicated slash collapse.',
                'Align dynamic segment forms (`{id}` / `:id` / `[id]` / `${id}`) to unified token `:param`.',
                'Add extractor evidence with raw path + normalized path for all unmatched calls.'
            ],
            linkedFindings: [unmatchedFinding.id],
            evidence: collectUnmatchedRouteEvidence(runtimeDiagnostics, 10)
        });
    }

    const fanoutFinding = findingIndex.get('FINDING_HIGH_FANOUT_CAPABILITY');
    if (fanoutFinding && fanoutNodes.length > 0) {
        const target = fanoutNodes[0];
        const targetNode = nodeById.get(target.nodeId);
        proposals.push({
            id: `DREAM_SPLIT_HIGH_FANOUT_${sanitizeId(target.nodeId)}`,
            title: `Split high-fanout capability ${target.nodeId}`,
            priority: 'medium',
            confidence: 0.79,
            objective: 'Reduce implicit coupling by separating orchestration and resource concerns.',
            expectedOutcome: 'Fanout risk drops and downstream dependency chains become easier to reason about.',
            actions: [
                `Create dedicated child capability under ${target.nodeId} to isolate orchestration steps.`,
                'Move cross-cutting side effects (queue/cache/external API) into explicit runtime nodes.',
                'Regenerate trend and verify artifacts to confirm fanout reduction.'
            ],
            linkedFindings: [fanoutFinding.id],
            evidence: fanoutFinding.evidence,
            protocolDraft: buildHighFanoutSplitProtocol(paths, target, targetNode)
        });
    }

    const renderFinding = findingIndex.get('FINDING_RUNTIME_RENDER_INCONSISTENT');
    if (renderFinding) {
        proposals.push({
            id: 'DREAM_RUNTIME_RENDER_PARITY',
            title: 'Restore runtime rendered edge parity',
            priority: 'high',
            confidence: 0.9,
            objective: 'Guarantee runtime visualizer edge count equals runtime-map edge count by default.',
            expectedOutcome: 'rendered_edges_consistency remains true in strict verify/govern checks.',
            actions: [
                'Keep runtime visualizer default maxRenderEdges unset (no cap).',
                'Allow edge cap only via explicit CLI option and log when cap is active.',
                'Add regression test for rendered edge consistency.'
            ],
            linkedFindings: [renderFinding.id],
            evidence: renderFinding.evidence
        });
    }

    const diagnosticsFinding = findingIndex.get('FINDING_RUNTIME_DIAGNOSTICS_NO_CODE');
    if (diagnosticsFinding) {
        proposals.push({
            id: 'DREAM_DIAGNOSTICS_CONTRACT_ENFORCEMENT',
            title: 'Enforce diagnostic code contract',
            priority: 'high',
            confidence: 0.95,
            objective: 'Ensure all runtime diagnostics are machine-governable by stable code.',
            expectedOutcome: 'diagnostics_no_code remains zero and issue triage becomes automatable.',
            actions: [
                'Require `level/code/extractor/message` for all runtime diagnostic writes.',
                'Normalize unknown diagnostics to fallback code `RUNTIME_UNKNOWN_DIAGNOSTIC`.',
                'Add contract test that fails when any runtime diagnostic lacks code.'
            ],
            linkedFindings: [diagnosticsFinding.id],
            evidence: diagnosticsFinding.evidence
        });
    }

    return proposals;
}

function buildExecuteDenoiseProtocol(paths: WorkspacePaths, executeNodes: TriadNodeLike[]) {
    const existingNodeIds = new Set(
        executeNodes.map((node) => String(node.nodeId ?? '').trim()).filter(Boolean)
    );

    const actions = executeNodes
        .filter((node) => String(node.nodeId ?? '').trim())
        .slice(0, 3)
        .map((node, index) => {
            const parentNodeId = String(node.nodeId ?? '').trim();
            const childNodeId = deriveChildNodeId(parentNodeId, `stage${index + 1}`, existingNodeIds);
            return {
                op: 'create_child' as const,
                parentNodeId,
                node: {
                    nodeId: childNodeId,
                    category: node.category ?? 'core',
                    sourcePath: node.sourcePath,
                    fission: {
                        problem: `Refine orchestration stage for ${parentNodeId}`,
                        demand:
                            Array.isArray(node.fission?.demand) && node.fission!.demand!.length > 0
                                ? node.fission!.demand!.slice(0, 3)
                                : ['None'],
                        answer:
                            Array.isArray(node.fission?.answer) && node.fission!.answer!.length > 0
                                ? node.fission!.answer!.slice(0, 1)
                                : ['void']
                    }
                },
                reason: 'Dream proposal: reduce execute-like concentration via explicit child capability',
                confidence: 0.7
            };
        });

    if (actions.length === 0) {
        return undefined;
    }
    const allowedOps: TriadOp[] = ['reuse', 'modify', 'create_child'];

    return {
        protocolVersion: '1.0',
        project: path.basename(paths.projectRoot),
        mapSource: paths.mapFile.replace(/\\/g, '/'),
        userDemand: 'Dream proposal: reduce execute-like capability concentration',
        upgradePolicy: {
            allowedOps,
            principle: 'reuse-first with explicit orchestration split'
        },
        actions
    };
}

function buildHighFanoutSplitProtocol(paths: WorkspacePaths, target: FanoutNode, targetNode?: TriadNodeLike) {
    const childNodeId = deriveChildNodeId(target.nodeId, 'orchestrateFlow', new Set([target.nodeId]));
    const allowedOps: TriadOp[] = ['reuse', 'modify', 'create_child'];
    return {
        protocolVersion: '1.0',
        project: path.basename(paths.projectRoot),
        mapSource: paths.mapFile.replace(/\\/g, '/'),
        userDemand: `Dream proposal: split high-fanout capability ${target.nodeId}`,
        upgradePolicy: {
            allowedOps,
            principle: 'reduce fanout by moving orchestration to dedicated child capability'
        },
        actions: [
            {
                op: 'create_child' as const,
                parentNodeId: target.nodeId,
                node: {
                    nodeId: childNodeId,
                    category: targetNode?.category ?? 'core',
                    sourcePath: targetNode?.sourcePath,
                    fission: {
                        problem: `Extract orchestration flow from ${target.nodeId}`,
                        demand:
                            Array.isArray(targetNode?.fission?.demand) && targetNode!.fission!.demand!.length > 0
                                ? targetNode!.fission!.demand!.slice(0, 3)
                                : ['None'],
                        answer:
                            Array.isArray(targetNode?.fission?.answer) && targetNode!.fission!.answer!.length > 0
                                ? targetNode!.fission!.answer!.slice(0, 1)
                                : ['void']
                    }
                },
                reason: `Dream proposal: downstream fanout=${target.downstreamCount}`,
                confidence: 0.74
            }
        ]
    };
}

function rankAndFilterProposals(proposals: DreamProposal[], minConfidence: number, maxProposals: number) {
    return proposals
        .filter((proposal) => proposal.confidence >= minConfidence)
        .sort((left, right) => {
            const priorityDiff = proposalPriorityRank(right.priority) - proposalPriorityRank(left.priority);
            if (priorityDiff !== 0) {
                return priorityDiff;
            }
            return right.confidence - left.confidence || left.id.localeCompare(right.id);
        })
        .slice(0, maxProposals);
}

function validateProposalConsistency(
    proposals: DreamProposal[],
    categories: Record<TriadCategory, string[]>,
    diagnostics: DreamDiagnostic[]
) {
    return proposals.map((proposal) => {
        const protocolDraft = canonicalizeProtocolDraft(proposal, categories, diagnostics);
        const sourcePath = normalizeProposalSourcePath(
            proposal.sourcePath ??
                extractProposalSourcePathFromProtocolDraft(protocolDraft) ??
                extractProposalSourcePathFromEvidence(proposal)
        );
        const previousCategory = normalizeProposalCategory(proposal.category);
        const resolvedCategory = sourcePath ? resolveCategoryBySourcePath(sourcePath, categories) : 'unknown';
        emitCategoryConsistencyDiagnostics({
            diagnostics,
            proposalId: proposal.id,
            scope: 'proposal',
            previousCategory,
            resolvedCategory,
            sourcePath
        });
        return {
            ...proposal,
            protocolDraft,
            category: resolvedCategory,
            sourcePath: sourcePath || undefined
        };
    });
}

function normalizeProposalCategory(value: DreamProposal['category']) {
    if (value === 'frontend' || value === 'backend' || value === 'core' || value === 'unknown') {
        return value;
    }
    return 'unknown';
}

function normalizeProposalSourcePath(value: string | undefined) {
    const normalized = String(value ?? '')
        .trim()
        .replace(/\\/g, '/')
        .replace(/^\.?\//, '')
        .replace(/\/{2,}/g, '/');
    return normalized || '';
}

function extractProposalSourcePathFromProtocolDraft(protocolDraft: UpgradeProtocol | undefined) {
    const actions = Array.isArray(protocolDraft?.actions) ? protocolDraft.actions : [];
    for (const action of actions) {
        if (action?.op === 'create_child' && typeof action?.node?.sourcePath === 'string') {
            const normalized = normalizeProposalSourcePath(action.node.sourcePath);
            if (normalized) {
                return normalized;
            }
        }
        if (action?.op === 'modify' && typeof action?.sourcePath === 'string') {
            const normalized = normalizeProposalSourcePath(action.sourcePath);
            if (normalized) {
                return normalized;
            }
        }
    }
    return '';
}

function canonicalizeProtocolDraft(
    proposal: DreamProposal,
    categories: Record<TriadCategory, string[]>,
    diagnostics: DreamDiagnostic[]
) {
    if (!proposal.protocolDraft || !Array.isArray(proposal.protocolDraft.actions)) {
        return proposal.protocolDraft;
    }

    const protocolDraft = {
        ...proposal.protocolDraft,
        actions: proposal.protocolDraft.actions.map((action, actionIndex) => {
            if (action?.op === 'create_child' && action?.node) {
                const nodeSourcePath = normalizeProposalSourcePath(action.node.sourcePath);
                const previousNodeCategory = normalizeProposalCategory(action.node.category as any);
                const resolvedNodeCategory = nodeSourcePath
                    ? resolveCategoryBySourcePath(nodeSourcePath, categories)
                    : 'unknown';

                emitCategoryConsistencyDiagnostics({
                    diagnostics,
                    proposalId: proposal.id,
                    scope: 'protocolDraft.actions.node',
                    previousCategory: previousNodeCategory,
                    resolvedCategory: resolvedNodeCategory,
                    sourcePath: nodeSourcePath,
                    nodeId: action.node.nodeId,
                    actionIndex
                });

                return {
                    ...action,
                    node: {
                        ...action.node,
                        category: resolvedNodeCategory as any,
                        sourcePath: nodeSourcePath || undefined
                    }
                };
            }

            if (action?.op === 'modify') {
                const actionSourcePath = normalizeProposalSourcePath((action as any).sourcePath);
                const previousActionCategory = normalizeProposalCategory((action as any).category);
                const resolvedActionCategory = actionSourcePath
                    ? resolveCategoryBySourcePath(actionSourcePath, categories)
                    : 'unknown';

                emitCategoryConsistencyDiagnostics({
                    diagnostics,
                    proposalId: proposal.id,
                    scope: 'protocolDraft.actions',
                    previousCategory: previousActionCategory,
                    resolvedCategory: resolvedActionCategory,
                    sourcePath: actionSourcePath,
                    nodeId: (action as any).nodeId,
                    actionIndex
                });

                return {
                    ...action,
                    category: resolvedActionCategory as any,
                    sourcePath: actionSourcePath || undefined
                };
            }

            return action;
        })
    };
    return protocolDraft;
}

function emitCategoryConsistencyDiagnostics(input: {
    diagnostics: DreamDiagnostic[];
    proposalId: string;
    scope: string;
    previousCategory: TriadCategory | 'unknown';
    resolvedCategory: TriadCategory | 'unknown';
    sourcePath: string;
    nodeId?: string;
    actionIndex?: number;
}) {
    const {
        diagnostics,
        proposalId,
        scope,
        previousCategory,
        resolvedCategory,
        sourcePath,
        nodeId,
        actionIndex
    } = input;

    const targetLabelParts = [`Proposal ${proposalId}`, scope];
    if (typeof actionIndex === 'number') {
        targetLabelParts.push(`action#${actionIndex}`);
    }
    if (nodeId) {
        targetLabelParts.push(`node=${nodeId}`);
    }
    const targetLabel = targetLabelParts.join(' | ');

    if (sourcePath && previousCategory !== resolvedCategory) {
        diagnostics.push({
            level: 'warning',
            code: 'DREAM_PROPOSAL_CATEGORY_MISMATCH_AUTO_FIXED',
            component: 'DreamProposalValidator',
            message: `${targetLabel} category auto-fixed: ${previousCategory} -> ${resolvedCategory}`,
            sourcePath
        });
    }

    if (resolvedCategory === 'unknown') {
        diagnostics.push({
            level: 'warning',
            code: 'DREAM_PROPOSAL_CATEGORY_UNRESOLVED',
            component: 'DreamProposalValidator',
            message: sourcePath
                ? `${targetLabel} sourcePath cannot map to configured categories; category=unknown`
                : `${targetLabel} has no resolvable sourcePath; category=unknown`,
            sourcePath: sourcePath || undefined
        });
    }
}

function extractProposalSourcePathFromEvidence(proposal: DreamProposal) {
    for (const evidence of proposal.evidence) {
        if (typeof evidence?.sourcePath !== 'string') {
            continue;
        }
        const normalized = normalizeProposalSourcePath(evidence.sourcePath);
        if (normalized) {
            return normalized;
        }
    }
    return '';
}

function buildSummary(
    metrics: VerifyMetrics,
    findings: DreamFinding[],
    proposals: DreamProposal[],
    runtimeMap: RuntimeMapLike | undefined
) {
    const topFinding = findings[0];
    const summary: string[] = [];
    summary.push(
        `Metrics snapshot: execute_like_ratio=${metrics.execute_like_ratio.toFixed(3)}, ghost_ratio=${metrics.ghost_ratio.toFixed(3)}, diagnostics_no_code=${metrics.diagnostics_no_code}, unmatched_routes=${metrics.runtime_unmatched_route_count}`
    );
    summary.push(
        `Runtime snapshot: nodes=${runtimeMap?.nodes?.length ?? 0}, edges=${runtimeMap?.edges?.length ?? 0}, rendered_edges_consistency=${metrics.rendered_edges_consistency}`
    );
    if (topFinding) {
        summary.push(`Top risk: ${topFinding.title} (${topFinding.severity}, confidence=${topFinding.confidence.toFixed(2)})`);
    } else {
        summary.push('No blocking risk detected in current topology metrics.');
    }
    summary.push(`Generated ${proposals.length} proposal(s) after confidence and Top-K filtering.`);
    return summary;
}

function persistDreamArtifacts(
    paths: WorkspacePaths,
    report: DreamReport,
    previousState: DreamState,
    mode?: DreamMode
) {
    fs.mkdirSync(path.dirname(paths.dreamReportFile), { recursive: true });
    fs.writeFileSync(paths.dreamReportFile, JSON.stringify(report, null, 2), 'utf-8');
    fs.writeFileSync(paths.dreamDiagnosticsFile, JSON.stringify(report.diagnostics, null, 2), 'utf-8');
    fs.writeFileSync(
        paths.dreamProposalsFile,
        JSON.stringify(
            {
                schemaVersion: '1.0',
                generatedAt: report.generatedAt,
                project: report.project,
                mode: report.mode,
                skipped: report.skipped,
                proposals: report.proposals
            },
            null,
            2
        ),
        'utf-8'
    );

    if (!report.skipped) {
        const nextState: DreamState = {
            schemaVersion: '1.0',
            updatedAt: report.generatedAt,
            lastRunAt: report.generatedAt,
            lastMode: mode ?? report.mode,
            runs: previousState.runs + 1,
            lastFindingCount: report.findings.length,
            lastProposalCount: report.proposals.length
        };
        fs.writeFileSync(paths.dreamStateFile, JSON.stringify(nextState, null, 2), 'utf-8');
        return;
    }

    const skippedState: DreamState = {
        ...previousState,
        schemaVersion: '1.0',
        updatedAt: report.generatedAt
    };
    fs.writeFileSync(paths.dreamStateFile, JSON.stringify(skippedState, null, 2), 'utf-8');
}

function buildDreamResult(paths: WorkspacePaths, report: DreamReport): DreamRunResult {
    return {
        report,
        artifacts: {
            reportFile: paths.dreamReportFile,
            diagnosticsFile: paths.dreamDiagnosticsFile,
            proposalsFile: paths.dreamProposalsFile,
            stateFile: paths.dreamStateFile
        }
    };
}

function normalizeDreamConfig(
    config: {
        enabled: boolean;
        idleOnly: boolean;
        minHoursBetweenRuns: number;
        minConfidence: number;
        maxProposals: number;
        failOnDreamError: boolean;
    },
    options: DreamRunOptions
): DreamConfigNormalized {
    return {
        enabled: config.enabled,
        idleOnly: config.idleOnly,
        minHoursBetweenRuns: Math.max(1, Math.floor(config.minHoursBetweenRuns || 24)),
        minConfidence: normalizeConfidence(options.minConfidence, config.minConfidence),
        maxProposals: normalizePositiveInteger(options.maxProposals, config.maxProposals),
        failOnDreamError: config.failOnDreamError
    };
}

function normalizeDreamMode(mode: string | undefined, idleOnly: boolean): DreamMode {
    if (mode === 'idle') {
        return 'idle';
    }
    if (mode === 'manual') {
        return 'manual';
    }
    return idleOnly ? 'idle' : 'manual';
}

function isIdleGateBlocked(lastRunAt: string | undefined, minHoursBetweenRuns: number, now: Date) {
    if (!lastRunAt) {
        return false;
    }
    const parsed = Date.parse(lastRunAt);
    if (!Number.isFinite(parsed)) {
        return false;
    }
    const elapsedHours = (now.getTime() - parsed) / 3_600_000;
    return elapsedHours < minHoursBetweenRuns;
}

function readDreamState(filePath: string): DreamState {
    const parsed = readJsonIfExists(filePath) as Partial<DreamState> | undefined;
    return {
        schemaVersion: '1.0',
        updatedAt: String(parsed?.updatedAt ?? new Date(0).toISOString()),
        lastRunAt: typeof parsed?.lastRunAt === 'string' ? parsed.lastRunAt : undefined,
        lastMode: parsed?.lastMode === 'idle' || parsed?.lastMode === 'manual' ? parsed.lastMode : undefined,
        runs: normalizeNonNegativeInteger(parsed?.runs, 0),
        lastFindingCount: normalizeNonNegativeInteger(parsed?.lastFindingCount, 0),
        lastProposalCount: normalizeNonNegativeInteger(parsed?.lastProposalCount, 0)
    };
}

function readTriadNodes(filePath: string, diagnostics: DreamDiagnostic[]) {
    if (!fs.existsSync(filePath)) {
        diagnostics.push({
            level: 'warning',
            code: 'DREAM_TRIAD_MAP_MISSING',
            component: 'DreamReader',
            message: `triad map missing: ${filePath}`
        });
        return [] as TriadNodeLike[];
    }

    const parsed = readJsonIfExists(filePath);
    if (!Array.isArray(parsed)) {
        diagnostics.push({
            level: 'error',
            code: 'DREAM_TRIAD_MAP_INVALID',
            component: 'DreamReader',
            message: `triad map is not a valid array: ${filePath}`
        });
        return [] as TriadNodeLike[];
    }
    return parsed as TriadNodeLike[];
}

function readRuntimeMap(filePath: string, diagnostics: DreamDiagnostic[]) {
    if (!fs.existsSync(filePath)) {
        diagnostics.push({
            level: 'warning',
            code: 'DREAM_RUNTIME_MAP_MISSING',
            component: 'DreamReader',
            message: `runtime map missing: ${filePath}`
        });
        return undefined;
    }
    const parsed = readJsonIfExists(filePath);
    if (!parsed || typeof parsed !== 'object') {
        diagnostics.push({
            level: 'error',
            code: 'DREAM_RUNTIME_MAP_INVALID',
            component: 'DreamReader',
            message: `runtime map is invalid JSON object: ${filePath}`
        });
        return undefined;
    }
    return parsed as RuntimeMapLike;
}

function readRuntimeDiagnostics(filePath: string, diagnostics: DreamDiagnostic[]) {
    if (!fs.existsSync(filePath)) {
        diagnostics.push({
            level: 'warning',
            code: 'DREAM_RUNTIME_DIAGNOSTICS_MISSING',
            component: 'DreamReader',
            message: `runtime diagnostics missing: ${filePath}`
        });
        return [] as RuntimeDiagnosticLike[];
    }
    const parsed = readJsonIfExists(filePath);
    if (!Array.isArray(parsed)) {
        diagnostics.push({
            level: 'error',
            code: 'DREAM_RUNTIME_DIAGNOSTICS_INVALID',
            component: 'DreamReader',
            message: `runtime diagnostics is not an array: ${filePath}`
        });
        return [] as RuntimeDiagnosticLike[];
    }
    return parsed as RuntimeDiagnosticLike[];
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

function collectTopExecuteEvidence(nodes: TriadNodeLike[], limit: number) {
    return nodes
        .filter((node) => isExecuteLikeNodeId(node.nodeId))
        .slice(0, limit)
        .map((node) => ({
            type: 'node' as const,
            key: String(node.nodeId ?? 'unknown'),
            value: String(node.fission?.problem ?? 'execute-like capability'),
            sourcePath: node.sourcePath
        }));
}

function collectTopGhostEvidence(nodes: TriadNodeLike[], limit: number) {
    return nodes
        .filter((node) => hasGhostDemand(node))
        .slice(0, limit)
        .map((node) => ({
            type: 'node' as const,
            key: String(node.nodeId ?? 'unknown'),
            value: summarizeGhostDemand(node.fission?.demand ?? []),
            sourcePath: node.sourcePath
        }));
}

function collectUnmatchedRouteEvidence(diagnostics: RuntimeDiagnosticLike[], limit: number) {
    return diagnostics
        .filter((item) => String(item?.code ?? '').toUpperCase() === UNMATCHED_ROUTE_DIAGNOSTIC_CODE)
        .slice(0, limit)
        .map((item, index) => ({
            type: 'diagnostic' as const,
            key: `unmatched_${index + 1}`,
            value: extractRouteHint(String(item.message ?? 'unmatched route')),
            sourcePath: item.sourcePath
        }));
}

function summarizeGhostDemand(demand: string[]) {
    const ghostEntries = demand.filter((entry) => GHOST_DEMAND_PATTERN.test(String(entry ?? '').trim()));
    if (ghostEntries.length === 0) {
        return 'ghost demand';
    }
    return ghostEntries.slice(0, 2).join('; ');
}

function extractRouteHint(message: string) {
    const match = message.match(/\/api[^\s'"]+/i);
    return match ? `${match[0]} | ${message}` : message;
}

async function detectHighFanoutNodes(
    triadNodes: TriadNodeLike[],
    threshold: number,
    options: {
        enableYield: boolean;
        batchSize: number;
    }
) {
    const answerProducers = new Map<string, string[]>();
    const downstreamByNode = new Map<string, Set<string>>();
    const maybeYield = createLoopYieldController(options.enableYield, options.batchSize);

    for (const node of triadNodes) {
        await maybeYield();
        const nodeId = String(node?.nodeId ?? '').trim();
        if (!nodeId) {
            continue;
        }
        const answers = Array.isArray(node?.fission?.answer) ? node.fission!.answer! : [];
        for (const answer of answers) {
            await maybeYield();
            const answerKey = normalizeContractKey(answer);
            if (!answerKey) {
                continue;
            }
            const producers = answerProducers.get(answerKey) ?? [];
            producers.push(nodeId);
            answerProducers.set(answerKey, producers);
        }
    }

    for (const node of triadNodes) {
        await maybeYield();
        const consumerNodeId = String(node?.nodeId ?? '').trim();
        if (!consumerNodeId) {
            continue;
        }
        const demands = Array.isArray(node?.fission?.demand) ? node.fission!.demand! : [];
        for (const demand of demands) {
            await maybeYield();
            const demandKey = normalizeContractKey(demand);
            if (!demandKey) {
                continue;
            }
            const producers = answerProducers.get(demandKey) ?? [];
            for (const producerNodeId of producers) {
                await maybeYield();
                if (producerNodeId === consumerNodeId) {
                    continue;
                }
                const downstream = downstreamByNode.get(producerNodeId) ?? new Set<string>();
                downstream.add(consumerNodeId);
                downstreamByNode.set(producerNodeId, downstream);
            }
        }
    }

    return Array.from(downstreamByNode.entries())
        .map(([nodeId, downstreamNodeIds]) => ({
            nodeId,
            downstreamCount: downstreamNodeIds.size,
            downstreamNodeIds: Array.from(downstreamNodeIds).sort()
        }))
        .filter((item) => item.downstreamCount >= threshold)
        .sort((left, right) => right.downstreamCount - left.downstreamCount || left.nodeId.localeCompare(right.nodeId));
}

function createLoopYieldController(enableYield: boolean, configuredBatchSize: number) {
    if (!enableYield) {
        return async () => {
            // no-op
        };
    }

    const batchSize = Math.max(50, Math.floor(configuredBatchSize || DREAM_IDLE_YIELD_BATCH_SIZE));
    let processed = 0;
    return async () => {
        processed += 1;
        if (processed < batchSize) {
            return;
        }
        processed = 0;
        await yieldToEventLoop();
    };
}

function yieldToEventLoop() {
    return new Promise<void>((resolve) => setImmediate(resolve));
}

function normalizeContractKey(contract: unknown) {
    if (typeof contract !== 'string') {
        return '';
    }
    const trimmed = contract.trim();
    if (!trimmed || /^none$/i.test(trimmed)) {
        return '';
    }
    const ghostPrefixMatch = trimmed.match(/^\[Ghost:[^\]]+\]\s*(.+)$/i);
    const withoutGhostPrefix = ghostPrefixMatch ? ghostPrefixMatch[1].trim() : trimmed;
    const signatureMatch = withoutGhostPrefix.match(/^(.+?)\s*\(/);
    return (signatureMatch ? signatureMatch[1] : withoutGhostPrefix).trim();
}

function isExecuteLikeNodeId(nodeId: string | undefined) {
    return typeof nodeId === 'string' && EXECUTE_LIKE_METHOD_PATTERN.test(nodeId);
}

function hasGhostDemand(node: TriadNodeLike) {
    const demand = Array.isArray(node?.fission?.demand) ? node.fission!.demand! : [];
    return demand.some((entry) => GHOST_DEMAND_PATTERN.test(String(entry ?? '').trim()));
}

function deriveChildNodeId(parentNodeId: string, suffix: string, existingIds: Set<string>) {
    const trimmedParent = parentNodeId.trim();
    if (!trimmedParent) {
        return `DreamNode.${suffix}`;
    }
    const parts = trimmedParent.split('.').filter(Boolean);
    const className = parts.length > 1 ? parts[parts.length - 2] : parts[0];
    const base = `${className}.${suffix}`;
    if (!existingIds.has(base)) {
        existingIds.add(base);
        return base;
    }
    let index = 2;
    while (existingIds.has(`${base}${index}`)) {
        index += 1;
    }
    const candidate = `${base}${index}`;
    existingIds.add(candidate);
    return candidate;
}

function ratioConfidence(actual: number, threshold: number) {
    const delta = Math.max(0, actual - threshold);
    const normalized = threshold <= 0 ? delta : delta / threshold;
    return clampNumber(0.6 + normalized * 0.25, 0, 0.95);
}

function severityRank(severity: DreamFinding['severity']) {
    if (severity === 'error') return 3;
    if (severity === 'warning') return 2;
    return 1;
}

function proposalPriorityRank(priority: DreamProposal['priority']) {
    if (priority === 'high') return 3;
    if (priority === 'medium') return 2;
    return 1;
}

function sanitizeId(value: string) {
    return value.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'proposal';
}

function normalizePositiveInteger(value: number | undefined, fallback: number) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return Math.floor(value);
    }
    return fallback;
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        return Math.floor(value);
    }
    return fallback;
}

function normalizeConfidence(value: number | undefined, fallback: number) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) {
        return value;
    }
    return fallback;
}

function clampNumber(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
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

function enrichGhostPolicyEvidence(nodes: TriadNodeLike[]) {
    const byLanguage = new Map<string, number>();
    for (const node of nodes) {
        if (!hasGhostDemand(node)) {
            continue;
        }
        const language = inferLanguageFromSourcePath(node.sourcePath);
        byLanguage.set(language, (byLanguage.get(language) ?? 0) + 1);
    }

    return Array.from(byLanguage.entries()).map(([language, count]) => ({
        type: 'metric' as const,
        key: `ghost_nodes_${language}`,
        value: String(count)
    }));
}

export function buildDreamQuickHints(paths: WorkspacePaths) {
    const report = loadLatestDreamReport(paths);
    if (!report) {
        return [] as string[];
    }

    const hints: string[] = [];
    const top = report.proposals[0];
    if (top) {
        hints.push(`Top proposal: ${top.title} (confidence=${top.confidence.toFixed(2)})`);
    }
    hints.push(`findings=${report.findings.length}, proposals=${report.proposals.length}`);
    return hints;
}
