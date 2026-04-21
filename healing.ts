import * as fs from 'fs';
import * as path from 'path';
import { loadTriadConfig } from './config';
import { parseNodeRef, readTriadMap, TriadNodeDefinition } from './protocol';
import { normalizePath, WorkspacePaths } from './workspace';

export type HealingBranchKind = 'left_branch' | 'right_branch' | 'contract' | 'topology' | 'unknown';
export type HealingActionKind = 'modify' | 'create_child' | 'manual_review';

export interface RuntimeTraceFrame {
    raw: string;
    sourcePath: string;
    line: number;
    column: number;
    symbol?: string;
}

export interface HealingDiagnosis {
    projectRoot: string;
    adapterLanguage: string;
    retryCount: number;
    matchedNodeId: string | null;
    matchedSourcePath: string | null;
    diagnosis: HealingBranchKind;
    suggestedAction: HealingActionKind;
    summary: string;
    blastRadius: {
        impactedNodeIds: string[];
        risk: 'low' | 'medium' | 'high';
    };
    traceFrames: RuntimeTraceFrame[];
    evidence: string[];
    requiresHumanApproval: boolean;
}

type BlastRadius = {
    impactedNodeIds: string[];
    risk: 'low' | 'medium' | 'high';
};

export function prepareHealingArtifacts(paths: WorkspacePaths, errorText: string, retryCount = 0) {
    const config = loadTriadConfig(paths);
    const nodes = readTriadMap(paths.mapFile);
    const diagnosis = diagnoseRuntimeFailure(paths, errorText, retryCount, nodes);
    const requiresHumanApproval =
        diagnosis.blastRadius.risk === 'high' ||
        (diagnosis.diagnosis === 'contract' && config.runtimeHealing.requireHumanApprovalForContractChanges);
    const finalDiagnosis: HealingDiagnosis = {
        ...diagnosis,
        requiresHumanApproval
    };
    const prompt = buildHealingPrompt(paths, errorText, finalDiagnosis);

    fs.writeFileSync(paths.runtimeErrorFile, errorText.trim(), 'utf-8');
    fs.writeFileSync(paths.healingReportFile, JSON.stringify(finalDiagnosis, null, 2), 'utf-8');
    fs.writeFileSync(paths.healingPromptFile, prompt, 'utf-8');

    return {
        diagnosis: finalDiagnosis,
        prompt
    };
}

export function diagnoseRuntimeFailure(
    paths: WorkspacePaths,
    errorText: string,
    retryCount: number,
    nodes: TriadNodeDefinition[]
): HealingDiagnosis {
    const config = loadTriadConfig(paths);
    const traceFrames = extractTraceFrames(errorText, paths.projectRoot);
    const match = locateBestNodeMatch(traceFrames, nodes);
    const diagnosis = classifyDiagnosis(errorText);
    const blastRadius = estimateBlastRadius(match?.node ?? null, nodes);
    const suggestedAction = chooseSuggestedAction(diagnosis, retryCount, config.runtimeHealing.maxAutoRetries);
    const evidence = buildEvidence(errorText, traceFrames, match?.node ?? null, diagnosis, blastRadius);

    return {
        projectRoot: normalizePath(paths.projectRoot),
        adapterLanguage: config.architecture.language,
        retryCount,
        matchedNodeId: match?.node.nodeId ?? null,
        matchedSourcePath: match?.node.sourcePath ?? null,
        diagnosis,
        suggestedAction,
        summary: buildSummary(match?.node ?? null, diagnosis, suggestedAction, blastRadius),
        blastRadius,
        traceFrames,
        evidence,
        requiresHumanApproval: false
    };
}

export function buildHealingPrompt(paths: WorkspacePaths, errorText: string, diagnosis: HealingDiagnosis) {
    const config = loadTriadConfig(paths);
    const triadMapJson = fs.existsSync(paths.mapFile) ? fs.readFileSync(paths.mapFile, 'utf-8').trim() : '[]';
    const triadSpec = fs.existsSync(paths.triadSpecFile) ? fs.readFileSync(paths.triadSpecFile, 'utf-8').trim() : '';
    const latestDemand = fs.existsSync(paths.demandFile) ? fs.readFileSync(paths.demandFile, 'utf-8').trim() : '';
    const contractGuard = config.runtimeHealing.requireHumanApprovalForContractChanges
        ? '如果判断为 Demand / Answer 契约变更，请只输出待审阅协议，不要假定可直接自动落盘。'
        : '契约变更允许自动生成待执行协议。';

    return [
        '[System]',
        '你是 TriadMind 的 Runtime Self-Healing 架构师。',
        '你的任务不是直接输出补丁代码，而是先根据运行时错误回溯到拓扑节点，再输出严格 JSON 升级协议。',
        '优先使用 `modify` 修复当前节点；只有当重试预算耗尽或职责明显过载时，才允许 `create_child`。',
        contractGuard,
        '',
        '[Triad Spec]',
        triadSpec,
        '',
        '[Project Root]',
        normalizePath(paths.projectRoot),
        '',
        '[Runtime Healing Config]',
        '```json',
        JSON.stringify(config.runtimeHealing, null, 2),
        '```',
        '',
        '[Latest User Demand]',
        latestDemand ? JSON.stringify(latestDemand) : '""',
        '',
        '[Triad Map JSON]',
        '```json',
        triadMapJson,
        '```',
        '',
        '[Runtime Error]',
        '```text',
        errorText.trim(),
        '```',
        '',
        '[Healing Diagnosis]',
        '```json',
        JSON.stringify(diagnosis, null, 2),
        '```',
        '',
        '[Output Rules]',
        '1. 先明确错误属于 left_branch / right_branch / contract / topology 哪一类。',
        '2. 如果当前节点可修复，输出以 `modify` 为主的严格 JSON 协议。',
        '3. 如果 retryCount 已达到上限，且节点职责过载，可提出 `create_child`。',
        '4. 输出必须兼容 `.triadmind/draft-protocol.json`。',
        '5. 只返回严格 JSON，不要返回 Markdown 解释。',
        '',
        '[Output Target]',
        normalizePath(paths.draftFile)
    ].join('\n');
}

function extractTraceFrames(errorText: string, projectRoot: string) {
    const frames: RuntimeTraceFrame[] = [];
    const projectRootNormalized = normalizePath(projectRoot).toLowerCase();

    for (const rawLine of errorText.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) {
            continue;
        }

        const frame = parseTraceLine(line, projectRootNormalized, projectRoot);
        if (frame) {
            frames.push(frame);
        }
    }

    return frames;
}

function parseTraceLine(line: string, projectRootNormalized: string, projectRoot: string) {
    const pathMatch = line.match(/((?:[A-Za-z]:)?[^():\n\r]+?\.[A-Za-z0-9]+):(\d+):(\d+)/);
    if (!pathMatch) {
        return null;
    }

    const absoluteCandidate = path.isAbsolute(pathMatch[1]) ? pathMatch[1] : path.resolve(projectRoot, pathMatch[1]);
    const normalizedPath = normalizePath(absoluteCandidate).toLowerCase();
    if (!normalizedPath.includes(projectRootNormalized)) {
        return null;
    }

    const symbolMatch = line.match(/at\s+(.+?)\s+\(/);
    return {
        raw: line,
        sourcePath: normalizePath(path.relative(projectRoot, absoluteCandidate)),
        line: Number(pathMatch[2]),
        column: Number(pathMatch[3]),
        symbol: symbolMatch?.[1]?.trim()
    } satisfies RuntimeTraceFrame;
}

function locateBestNodeMatch(frames: RuntimeTraceFrame[], nodes: TriadNodeDefinition[]) {
    let bestMatch:
        | {
              node: TriadNodeDefinition;
              score: number;
          }
        | undefined;

    for (const frame of frames) {
        for (const node of nodes) {
            const score = scoreNodeMatch(frame, node);
            if (score <= 0) {
                continue;
            }

            if (!bestMatch || score > bestMatch.score) {
                bestMatch = {
                    node,
                    score
                };
            }
        }
    }

    return bestMatch;
}

function scoreNodeMatch(frame: RuntimeTraceFrame, node: TriadNodeDefinition) {
    const nodeSourcePath = normalizePath(node.sourcePath ?? '').toLowerCase();
    const frameSourcePath = normalizePath(frame.sourcePath).toLowerCase();
    if (!nodeSourcePath || nodeSourcePath !== frameSourcePath) {
        return 0;
    }

    const ref = parseNodeRef(node.nodeId, node.category);
    let score = 10;

    if (frame.symbol) {
        const symbol = frame.symbol.toLowerCase();
        if (symbol.includes(ref.methodName.toLowerCase())) {
            score += 8;
        }

        if (symbol.includes(ref.className.toLowerCase())) {
            score += 5;
        }
    }

    return score;
}

function classifyDiagnosis(errorText: string): HealingBranchKind {
    const text = errorText.toLowerCase();

    if (/(validation|schema|contract|argument mismatch|expected .* received|assignable|zod)/.test(text)) {
        return 'contract';
    }

    if (/(config|state|env|undefined.*config|missing.*config|option|settings)/.test(text)) {
        return 'right_branch';
    }

    if (/(import|dependency|module not found|circular|topology|parentnode|childnode|reuse)/.test(text)) {
        return 'topology';
    }

    if (/(exception|error|failed|cannot read|undefined|null reference|stack overflow)/.test(text)) {
        return 'left_branch';
    }

    return 'unknown';
}

function chooseSuggestedAction(
    diagnosis: HealingBranchKind,
    retryCount: number,
    maxAutoRetries: number
): HealingActionKind {
    if (diagnosis === 'topology') {
        return 'manual_review';
    }

    if (retryCount >= maxAutoRetries) {
        return 'create_child';
    }

    return 'modify';
}

function estimateBlastRadius(rootNode: TriadNodeDefinition | null, nodes: TriadNodeDefinition[]): BlastRadius {
    if (!rootNode) {
        return {
            impactedNodeIds: [] as string[],
            risk: 'medium'
        };
    }

    const rootRef = parseNodeRef(rootNode.nodeId, rootNode.category);
    const impactedNodeIds = nodes
        .filter((node) => node.nodeId !== rootNode.nodeId)
        .filter((node) => {
            const sameSource = node.sourcePath && rootNode.sourcePath && node.sourcePath === rootNode.sourcePath;
            if (sameSource) {
                return true;
            }

            const ref = parseNodeRef(node.nodeId, node.category);
            if (ref.className === rootRef.className) {
                return true;
            }

            const signatureText = `${node.fission.demand.join(' ')} ${node.fission.answer.join(' ')}`.toLowerCase();
            return signatureText.includes(rootRef.className.toLowerCase()) || signatureText.includes(rootRef.methodName.toLowerCase());
        })
        .map((node) => node.nodeId)
        .slice(0, 12);

    const risk: BlastRadius['risk'] =
        impactedNodeIds.length >= 5 ? 'high' : impactedNodeIds.length >= 2 ? 'medium' : 'low';

    return {
        impactedNodeIds,
        risk
    };
}

function buildEvidence(
    errorText: string,
    traceFrames: RuntimeTraceFrame[],
    matchedNode: TriadNodeDefinition | null,
    diagnosis: HealingBranchKind,
    blastRadius: BlastRadius
) {
    const evidence = [`diagnosis=${diagnosis}`, `traceFrames=${traceFrames.length}`, `blastRadius=${blastRadius.risk}`];

    if (matchedNode) {
        evidence.push(`matchedNode=${matchedNode.nodeId}`);
    }

    if (blastRadius.impactedNodeIds.length > 0) {
        evidence.push(`impacted=${blastRadius.impactedNodeIds.join(', ')}`);
    }

    const firstLine = errorText.split(/\r?\n/).find((line) => line.trim());
    if (firstLine) {
        evidence.push(`error=${firstLine.trim()}`);
    }

    return evidence;
}

function buildSummary(
    matchedNode: TriadNodeDefinition | null,
    diagnosis: HealingBranchKind,
    suggestedAction: HealingActionKind,
    blastRadius: BlastRadius
) {
    const target = matchedNode?.nodeId ?? 'unknown node';
    return `${target} is classified as ${diagnosis}; suggested action is ${suggestedAction}; blast radius is ${blastRadius.risk}.`;
}
