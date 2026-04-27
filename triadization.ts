import * as fs from 'fs';
import * as path from 'path';
import { AnalyzerOptions, calculateBlastRadius, detectCycles } from './analyzer';
import { loadTriadConfig } from './config';
import { readTriadMap } from './protocol';
import { WorkspacePaths } from './workspace';

const DEFAULT_SPLIT_FANOUT_THRESHOLD = 6;
const DEFAULT_AGGREGATE_GROUP_SIZE = 3;
const ORCHESTRATION_NODE_PATTERN = /(workflow|orchestrate|dispatch|pipeline|plan|apply|bootstrap|sync)/i;
const FRAGMENT_METHOD_PATTERN = /^(build|parse|format|normalize|sanitize|validate|resolve|collect|load|save|get|set)/i;

type TriadMapNodeLike = {
    nodeId?: unknown;
    category?: unknown;
    sourcePath?: unknown;
    fission?: {
        problem?: unknown;
        demand?: unknown;
        answer?: unknown;
    };
};

export type TriadizationOperation = 'aggregate' | 'split' | 'renormalize';
export type TriadizationScale = 'class' | 'capability' | 'module' | 'workflow' | 'cluster';
export type TriadizationDiagnosisCode =
    | 'cyclic_cluster'
    | 'overloaded_vertex'
    | 'left_right_mixing'
    | 'capability_fragmented'
    | 'triadization_candidate';

export type TriadizationTaskPhase = 'macro' | 'meso' | 'micro' | 'renormalize' | 'protocol' | 'verify';
export type TriadizationConfirmationSource = 'plan' | 'apply' | 'invoke' | 'triadize';

export interface TriadizationTask {
    phase: TriadizationTaskPhase;
    title: string;
    objective: string;
}

export interface TriadizationAlternative {
    operation: Exclude<TriadizationOperation, never>;
    reason: string;
}

export interface TriadizationProposal {
    proposalId: string;
    targetNodeId: string;
    targetNodeIds: string[];
    triadScale: TriadizationScale;
    diagnosis: TriadizationDiagnosisCode[];
    recommendedOperation: TriadizationOperation;
    rationale: string;
    rejectedAlternatives: TriadizationAlternative[];
    evidence: string[];
    blastRadius: {
        impactedNodeCount: number;
        impactedNodeIds: string[];
    };
    taskBundle: TriadizationTask[];
    confirmationPrompt: string;
    confirmationNeeded: true;
    score: number;
}

export interface TriadizationReport {
    schemaVersion: '1.0';
    project: string;
    generatedAt: string;
    summary: string[];
    primaryProposal?: TriadizationProposal;
    candidates: TriadizationProposal[];
}

export interface TriadizationConfirmation {
    schemaVersion: '1.0';
    confirmedAt: string;
    source: TriadizationConfirmationSource;
    proposalId: string;
    targetNodeId: string;
    recommendedOperation: TriadizationOperation;
    reportGeneratedAt: string;
}

/**
 * @LeftBranch
 */
export function analyzeTriadizationOpportunities(
    projectRoot: string,
    map: any[],
    options?: AnalyzerOptions
): TriadizationReport {
    const normalizedMap = Array.isArray(map) ? map : [];
    const nodes = normalizedMap.filter((node) => getNodeId(node).length > 0);
    const downstreamEntries = detectHighFanoutNodes(nodes);
    const downstreamByNode = new Map(downstreamEntries.map((entry) => [entry.nodeId, entry]));
    const candidates = [
        ...buildRenormalizeCandidates(nodes, options),
        ...buildSplitCandidates(nodes, downstreamEntries, options),
        ...buildAggregateCandidates(nodes, downstreamByNode)
    ].sort((left, right) => right.score - left.score || left.targetNodeId.localeCompare(right.targetNodeId));

    if (candidates.length === 0 && nodes.length > 0) {
        candidates.push(buildFallbackCandidate(nodes, downstreamEntries, options));
    }

    const primaryProposal = candidates[0];
    const summary =
        primaryProposal === undefined
            ? ['No triadization proposal generated because the current map has no analyzable nodes.']
            : [
                  `Primary proposal: ${primaryProposal.recommendedOperation} ${primaryProposal.targetNodeId} (${primaryProposal.diagnosis.join(', ')}).`,
                  `Confirmation required before evolution: ${primaryProposal.confirmationPrompt}`
              ];

    return {
        schemaVersion: '1.0',
        project: path.basename(projectRoot),
        generatedAt: new Date().toISOString(),
        summary,
        primaryProposal,
        candidates
    };
}

/**
 * @LeftBranch
 */
export function buildTriadizationTaskMarkdown(report: TriadizationReport) {
    if (!report.primaryProposal) {
        return ['# Triadization Task', '', '当前没有可执行的三元化提案。'].join('\n');
    }

    const proposal = report.primaryProposal;
    return [
        '# Triadization Task',
        '',
        `- Project: ${report.project}`,
        `- Generated At: ${report.generatedAt}`,
        `- Target Node: ${proposal.targetNodeId}`,
        `- Operation: ${proposal.recommendedOperation}`,
        `- Scale: ${proposal.triadScale}`,
        `- Diagnosis: ${proposal.diagnosis.join(', ')}`,
        `- Blast Radius: ${proposal.blastRadius.impactedNodeCount}`,
        '',
        '## Confirmation',
        proposal.confirmationPrompt,
        '',
        '## Rationale',
        proposal.rationale,
        '',
        '## Evidence',
        ...proposal.evidence.map((item) => `- ${item}`),
        '',
        '## Task Bundle',
        ...proposal.taskBundle.map((task, index) => `${index + 1}. [${task.phase}] ${task.title}: ${task.objective}`)
    ].join('\n');
}

/**
 * @LeftBranch
 */
export function writeTriadizationArtifacts(paths: WorkspacePaths) {
    const config = loadTriadConfig(paths);
    const map = readTriadMap(paths.mapFile);
    const report = analyzeTriadizationOpportunities(paths.projectRoot, map, {
        ignoreGenericContracts: config.parser.ignoreGenericContracts,
        genericContractIgnoreList: config.parser.genericContractIgnoreList
    });

    fs.writeFileSync(paths.triadizationReportFile, JSON.stringify(report, null, 2), 'utf-8');
    fs.writeFileSync(paths.triadizationTaskFile, buildTriadizationTaskMarkdown(report), 'utf-8');

    return report;
}

/**
 * @LeftBranch
 */
export function readTriadizationConfirmation(paths: WorkspacePaths) {
    if (!fs.existsSync(paths.triadizationConfirmationFile)) {
        return undefined;
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(paths.triadizationConfirmationFile, 'utf-8'));
        if (
            typeof parsed?.proposalId !== 'string' ||
            typeof parsed?.targetNodeId !== 'string' ||
            typeof parsed?.recommendedOperation !== 'string'
        ) {
            return undefined;
        }

        return parsed as TriadizationConfirmation;
    } catch {
        return undefined;
    }
}

/**
 * @LeftBranch
 */
export function hasConfirmedTriadization(paths: WorkspacePaths, report: TriadizationReport) {
    if (!report.primaryProposal) {
        return true;
    }

    const confirmation = readTriadizationConfirmation(paths);
    return confirmation?.proposalId === report.primaryProposal.proposalId;
}

/**
 * @LeftBranch
 */
export function writeTriadizationConfirmation(
    paths: WorkspacePaths,
    report: TriadizationReport,
    source: TriadizationConfirmationSource
) {
    if (!report.primaryProposal) {
        return undefined;
    }

    const confirmation: TriadizationConfirmation = {
        schemaVersion: '1.0',
        confirmedAt: new Date().toISOString(),
        source,
        proposalId: report.primaryProposal.proposalId,
        targetNodeId: report.primaryProposal.targetNodeId,
        recommendedOperation: report.primaryProposal.recommendedOperation,
        reportGeneratedAt: report.generatedAt
    };

    fs.writeFileSync(paths.triadizationConfirmationFile, JSON.stringify(confirmation, null, 2), 'utf-8');
    return confirmation;
}

function buildRenormalizeCandidates(nodes: TriadMapNodeLike[], options?: AnalyzerOptions) {
    return detectCycles(nodes, options)
        .filter((cycle) => cycle.length >= 2)
        .map((cycle) => {
            const impactedNodeIds = Array.from(
                new Set(
                    cycle.flatMap((nodeId) =>
                        calculateBlastRadius(nodes, nodeId, true, options).filter((candidate) => !cycle.includes(candidate))
                    )
                )
            ).sort();

            const proposalId = `renormalize:${cycle.slice().sort().join('|')}`;
            const targetNodeId = cycle[0];
            const targetNodeIds = cycle.slice().sort();
            const rationale = `节点簇 ${targetNodeIds.join(', ')} 形成强连通环，继续单点切分会保留回环依赖，应先提升为宏观顶点后再重建外部输入输出。`;

            return {
                proposalId,
                targetNodeId,
                targetNodeIds,
                triadScale: 'cluster' as const,
                diagnosis: ['cyclic_cluster'] as TriadizationDiagnosisCode[],
                recommendedOperation: 'renormalize' as const,
                rationale,
                rejectedAlternatives: [
                    {
                        operation: 'split' as const,
                        reason: '单独切分环内节点不能消除强连通回路，依赖会继续互相牵引。'
                    },
                    {
                        operation: 'aggregate' as const,
                        reason: '简单聚合离散叶子不会重建外部边界，仍然无法解释环的整体语义。'
                    }
                ],
                evidence: [
                    `Cycle nodes: ${targetNodeIds.join(' -> ')}`,
                    `External blast radius after renormalization candidate: ${impactedNodeIds.length}`
                ],
                blastRadius: {
                    impactedNodeCount: impactedNodeIds.length,
                    impactedNodeIds
                },
                taskBundle: [
                    createTriadizationTask(
                        'renormalize',
                        '提升环簇为宏顶点',
                        `把 ${targetNodeIds.join(', ')} 提升为一个可命名的宏观顶点，并重建环外输入输出边界。`
                    ),
                    createTriadizationTask(
                        'macro',
                        '重写挂载点与外部接口',
                        '确认新宏顶点的挂载点、左分支子能力节点与右分支编排约束。'
                    ),
                    createTriadizationTask(
                        'protocol',
                        '生成重整化协议',
                        '把新宏顶点、被吸收节点和新的 demand/answer 边界写入协议。'
                    ),
                    createTriadizationTask(
                        'verify',
                        '重跑拓扑校验',
                        '确认新环已经被解开，没有新增 broken contract 或 removed edge。'
                    )
                ],
                confirmationPrompt: `确认先对环簇 ${targetNodeIds.join(', ')} 执行 renormalize，再进入后续协议与实现演进吗？`,
                confirmationNeeded: true as const,
                score: 1000 + targetNodeIds.length * 20 + impactedNodeIds.length
            };
        });
}

function buildSplitCandidates(
    nodes: TriadMapNodeLike[],
    downstreamEntries: Array<{ nodeId: string; downstreamNodeIds: string[]; downstreamCount: number }>,
    options?: AnalyzerOptions
) {
    const nodeMap = new Map(nodes.map((node) => [getNodeId(node), node]));

    return downstreamEntries
        .filter((entry) => entry.downstreamCount >= DEFAULT_SPLIT_FANOUT_THRESHOLD)
        .map((entry) => {
            const node = nodeMap.get(entry.nodeId);
            const impactedNodeIds = calculateBlastRadius(nodes, entry.nodeId, true, options).sort();
            const diagnosis: TriadizationDiagnosisCode[] = ['overloaded_vertex'];
            if (looksLikeOrchestrationNode(node)) {
                diagnosis.push('left_right_mixing');
            }

            const rationale = looksLikeOrchestrationNode(node)
                ? `节点 ${entry.nodeId} 同时呈现编排语义与高扇出下游（${entry.downstreamCount} 个），说明它很可能把顶点、左支执行和右支约束混在了一起。`
                : `节点 ${entry.nodeId} 影响 ${entry.downstreamCount} 个下游能力，已经接近胖顶点，应拆成显式左右分支以降低爆炸半径。`;

            return {
                proposalId: `split:${entry.nodeId}`,
                targetNodeId: entry.nodeId,
                targetNodeIds: [entry.nodeId],
                triadScale: 'capability' as const,
                diagnosis,
                recommendedOperation: 'split' as const,
                rationale,
                rejectedAlternatives: [
                    {
                        operation: 'aggregate' as const,
                        reason: '当前问题不是节点太碎，而是单点职责过载。'
                    },
                    {
                        operation: 'renormalize' as const,
                        reason: '当前没有检测到必须先收缩的强连通环，优先切分更直接。'
                    }
                ],
                evidence: [
                    `Downstream fanout: ${entry.downstreamCount}`,
                    `Top downstreams: ${entry.downstreamNodeIds.slice(0, 6).join(', ') || 'none'}`
                ],
                blastRadius: {
                    impactedNodeCount: impactedNodeIds.length,
                    impactedNodeIds
                },
                taskBundle: [
                    createTriadizationTask(
                        'macro',
                        '确认顶点挂载点',
                        `确认 ${entry.nodeId} 是否仍是本轮挂载点，并把职责切成左分支子功能与右分支约束。`
                    ),
                    createTriadizationTask(
                        'meso',
                        '拆出子能力与编排件',
                        '把执行动作、策略编排、配置状态拆成更清晰的能力节点与管道。'
                    ),
                    createTriadizationTask(
                        'micro',
                        '标注静态右支与动态左支',
                        '为核心类补齐属性/状态与方法/动作的显式分支边界。'
                    ),
                    createTriadizationTask(
                        'protocol',
                        '写入最小演进协议',
                        '用 reuse / modify / create_child 形成最小可审阅的演进协议。'
                    ),
                    createTriadizationTask(
                        'verify',
                        '校验下游半径',
                        '确认切分后 blast radius 下降，且没有新增 drift。'
                    )
                ],
                confirmationPrompt: `确认先对节点 ${entry.nodeId} 执行 split，并据此继续后续三轮拆分与协议演进吗？`,
                confirmationNeeded: true as const,
                score: 500 + entry.downstreamCount * 10 + (diagnosis.includes('left_right_mixing') ? 25 : 0)
            };
        });
}

function buildAggregateCandidates(
    nodes: TriadMapNodeLike[],
    downstreamByNode: Map<string, { nodeId: string; downstreamNodeIds: string[]; downstreamCount: number }>
) {
    const groups = new Map<string, TriadMapNodeLike[]>();

    for (const node of nodes) {
        const groupKey = getFragmentGroupKey(node);
        if (!groupKey) {
            continue;
        }

        const current = groups.get(groupKey) ?? [];
        current.push(node);
        groups.set(groupKey, current);
    }

    return Array.from(groups.entries())
        .map(([groupKey, groupNodes]) => {
            const targetNodeIds = groupNodes.map((node) => getNodeId(node)).sort();
            const helperLikeCount = targetNodeIds.filter((nodeId) => FRAGMENT_METHOD_PATTERN.test(getMethodName(nodeId))).length;
            const uniqueSourcePaths = new Set(groupNodes.map((node) => getSourcePath(node)).filter(Boolean));
            const downstreamCounts = targetNodeIds.map((nodeId) => downstreamByNode.get(nodeId)?.downstreamCount ?? 0);
            const averageDownstream =
                downstreamCounts.length === 0
                    ? 0
                    : downstreamCounts.reduce((sum, value) => sum + value, 0) / downstreamCounts.length;

            return {
                groupKey,
                targetNodeIds,
                helperLikeCount,
                uniqueSourcePaths,
                averageDownstream
            };
        })
        .filter(
            (group) =>
                group.targetNodeIds.length >= DEFAULT_AGGREGATE_GROUP_SIZE &&
                (group.helperLikeCount > 0 || (group.uniqueSourcePaths.size <= 1 && group.averageDownstream <= 1.5))
        )
        .map((group) => {
            const targetNodeId = group.groupKey;
            const sourcePath = getCommonSourcePath(nodes, group.targetNodeIds);
            const rationale = sourcePath
                ? `节点组 ${group.targetNodeIds.join(', ')} 长期落在同一源码文件 ${sourcePath}，但架构价值被离散叶子切碎，适合先聚合回一个可理解的顶点。`
                : `节点组 ${group.targetNodeIds.join(', ')} 语义接近且平均下游仅 ${group.averageDownstream.toFixed(1)}，适合先聚合成一个稳定顶点。`;

            return {
                proposalId: `aggregate:${group.targetNodeIds.join('|')}`,
                targetNodeId,
                targetNodeIds: group.targetNodeIds,
                triadScale: 'module' as const,
                diagnosis: ['capability_fragmented'] as TriadizationDiagnosisCode[],
                recommendedOperation: 'aggregate' as const,
                rationale,
                rejectedAlternatives: [
                    {
                        operation: 'split' as const,
                        reason: '当前问题不是单点过载，而是离散叶子没有被收束成可理解的顶点。'
                    },
                    {
                        operation: 'renormalize' as const,
                        reason: '当前没有检测到需要先收缩的环结构，直接聚合更合适。'
                    }
                ],
                evidence: [
                    `Grouped nodes: ${group.targetNodeIds.join(', ')}`,
                    `Average downstream fanout: ${group.averageDownstream.toFixed(1)}`
                ],
                blastRadius: {
                    impactedNodeCount: 0,
                    impactedNodeIds: []
                },
                taskBundle: [
                    createTriadizationTask(
                        'macro',
                        '确认聚合挂载点',
                        `为 ${targetNodeId} 指定统一挂载点，并定义聚合后顶点的外部职责。`
                    ),
                    createTriadizationTask(
                        'meso',
                        '收束离散子节点',
                        '把同源碎片节点收束为一个主顶点，再决定哪些叶子继续作为左分支保留。'
                    ),
                    createTriadizationTask(
                        'protocol',
                        '生成聚合协议',
                        '优先使用 reuse / modify，必要时才 create_child，避免横向再扩散。'
                    ),
                    createTriadizationTask(
                        'verify',
                        '校验主图可读性',
                        '确认聚合后主图节点更少、语义更清晰，没有丢失关键输入输出。'
                    )
                ],
                confirmationPrompt: `确认先对节点组 ${group.targetNodeIds.join(', ')} 执行 aggregate，先收束顶点再继续协议演进吗？`,
                confirmationNeeded: true as const,
                score:
                    200 +
                    group.targetNodeIds.length * 10 +
                    group.helperLikeCount * 6 +
                    Math.max(0, 5 - Math.round(group.averageDownstream))
            };
        });
}

function buildFallbackCandidate(
    nodes: TriadMapNodeLike[],
    downstreamEntries: Array<{ nodeId: string; downstreamNodeIds: string[]; downstreamCount: number }>,
    options?: AnalyzerOptions
) {
    const bestNodeId =
        downstreamEntries[0]?.nodeId ??
        nodes
            .map((node) => getNodeId(node))
            .filter(Boolean)
            .sort()[0];
    const impactedNodeIds = bestNodeId ? calculateBlastRadius(nodes, bestNodeId, true, options).sort() : [];

    return {
        proposalId: `split:${bestNodeId}`,
        targetNodeId: bestNodeId,
        targetNodeIds: [bestNodeId],
        triadScale: 'capability' as const,
        diagnosis: ['triadization_candidate'] as TriadizationDiagnosisCode[],
        recommendedOperation: 'split' as const,
        rationale: `当前没有明显的环或碎片簇，先从节点 ${bestNodeId} 开始做顶点三元化，可以为后续 Macro/Meso/Micro 建立明确起点。`,
        rejectedAlternatives: [
            {
                operation: 'aggregate' as const,
                reason: '没有检测到足够密集的离散碎片簇。'
            },
            {
                operation: 'renormalize' as const,
                reason: '当前没有检测到强连通环。'
            }
        ],
        evidence: ['Fallback candidate selected from current topology frontier.'],
        blastRadius: {
            impactedNodeCount: impactedNodeIds.length,
            impactedNodeIds
        },
        taskBundle: [
            createTriadizationTask('macro', '先确认起点节点', `确认 ${bestNodeId} 作为当前对话的三元化起点。`),
            createTriadizationTask(
                'micro',
                '补齐左右分支',
                '把该节点的静态右支与动态左支先明确出来，再决定是否继续裂变。'
            ),
            createTriadizationTask(
                'protocol',
                '形成第一版协议',
                '把这次确认后的最小演进动作写入 draft-protocol。'
            )
        ],
        confirmationPrompt: `确认先从节点 ${bestNodeId} 开始执行 split 型三元化，再继续协议演进吗？`,
        confirmationNeeded: true as const,
        score: 100
    };
}

function detectHighFanoutNodes(map: TriadMapNodeLike[]) {
    const answerProducers = new Map<string, string[]>();
    const downstreamByNode = new Map<string, Set<string>>();

    for (const node of map) {
        const nodeId = getNodeId(node);
        if (!nodeId) {
            continue;
        }

        const answers = getContracts(node?.fission?.answer);
        for (const answer of answers) {
            const answerKey = normalizeContractKey(answer);
            if (!answerKey) {
                continue;
            }

            const producers = answerProducers.get(answerKey) ?? [];
            producers.push(nodeId);
            answerProducers.set(answerKey, producers);
        }
    }

    for (const node of map) {
        const consumerNodeId = getNodeId(node);
        if (!consumerNodeId) {
            continue;
        }

        const demands = getContracts(node?.fission?.demand);
        for (const demand of demands) {
            const demandKey = normalizeContractKey(demand);
            if (!demandKey) {
                continue;
            }

            const producers = answerProducers.get(demandKey) ?? [];
            for (const producerNodeId of producers) {
                if (producerNodeId === consumerNodeId) {
                    continue;
                }

                const downstreams = downstreamByNode.get(producerNodeId) ?? new Set<string>();
                downstreams.add(consumerNodeId);
                downstreamByNode.set(producerNodeId, downstreams);
            }
        }
    }

    return Array.from(downstreamByNode.entries())
        .map(([nodeId, downstreams]) => ({
            nodeId,
            downstreamNodeIds: Array.from(downstreams).sort(),
            downstreamCount: downstreams.size
        }))
        .sort((left, right) => right.downstreamCount - left.downstreamCount || left.nodeId.localeCompare(right.nodeId));
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

function looksLikeOrchestrationNode(node: TriadMapNodeLike | undefined) {
    const nodeId = getNodeId(node);
    const problem = getProblem(node);
    return ORCHESTRATION_NODE_PATTERN.test(nodeId) || ORCHESTRATION_NODE_PATTERN.test(problem);
}

function getFragmentGroupKey(node: TriadMapNodeLike) {
    const nodeId = getNodeId(node);
    const sourcePath = getSourcePath(node);
    if (!nodeId) {
        return sourcePath;
    }

    const parts = nodeId.split('.').filter(Boolean);
    const owner = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    return sourcePath ? `${owner}@${sourcePath}` : owner;
}

function getCommonSourcePath(nodes: TriadMapNodeLike[], targetNodeIds: string[]) {
    const targetSet = new Set(targetNodeIds);
    const matching = nodes
        .filter((node) => targetSet.has(getNodeId(node)))
        .map((node) => getSourcePath(node))
        .filter(Boolean);
    const unique = Array.from(new Set(matching));
    return unique.length === 1 ? unique[0] : '';
}

function getNodeId(node: TriadMapNodeLike | undefined) {
    return typeof node?.nodeId === 'string' ? node.nodeId.trim() : '';
}

function getSourcePath(node: TriadMapNodeLike | undefined) {
    return typeof node?.sourcePath === 'string' ? node.sourcePath.trim() : '';
}

function getProblem(node: TriadMapNodeLike | undefined) {
    return typeof node?.fission?.problem === 'string' ? node.fission.problem.trim() : '';
}

function getContracts(value: unknown) {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function getMethodName(nodeId: string) {
    const parts = nodeId.split('.').filter(Boolean);
    return parts.length === 0 ? nodeId : parts[parts.length - 1];
}

function createTriadizationTask(phase: TriadizationTaskPhase, title: string, objective: string): TriadizationTask {
    return {
        phase,
        title,
        objective
    };
}
