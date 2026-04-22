import * as path from 'path';
import { calculateBlastRadius } from './analyzer';
import { parseNodeRef, TriadNodeDefinition } from './protocol';
import { normalizePath } from './workspace';

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

export type BlastRadius = {
    impactedNodeIds: string[];
    risk: 'low' | 'medium' | 'high';
};

/**
 * @RightBranch
 */
export function getContractGuardLine(requireHumanApprovalForContractChanges: boolean) {
    return requireHumanApprovalForContractChanges
        ? '如果判断为 Demand / Answer 契约变更，请只输出待审阅协议，不要假定可直接自动落盘。'
        : '契约变更允许自动生成待执行协议。';
}

/**
 * @RightBranch
 */
export function getHealingOutputRuleLines() {
    return [
        '1. 先明确错误属于 left_branch / right_branch / contract / topology 哪一类。',
        '2. 如果当前节点可修复，输出以 `modify` 为主的严格 JSON 协议。',
        '3. 如果 retryCount 已达到上限，且节点职责过载，可提出 `create_child`。',
        '4. 输出必须兼容 `.triadmind/draft-protocol.json`。',
        '5. 只返回严格 JSON，不要返回 Markdown 解释。'
    ];
}

/**
 * @RightBranch
 */
export function parseTraceLine(line: string, projectRootNormalized: string, projectRoot: string) {
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

/**
 * @RightBranch
 */
export function scoreNodeMatch(frame: RuntimeTraceFrame, node: TriadNodeDefinition) {
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

/**
 * @RightBranch
 */
export function classifyDiagnosis(errorText: string): HealingBranchKind {
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

/**
 * @RightBranch
 */
export function chooseSuggestedAction(
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

/**
 * @RightBranch
 */
export function estimateBlastRadius(
    rootNode: TriadNodeDefinition | null,
    nodes: TriadNodeDefinition[],
    isContractChange: boolean
): BlastRadius {
    if (!rootNode) {
        return {
            impactedNodeIds: [],
            risk: 'low'
        };
    }

    const impactedNodeIds = calculateBlastRadius(nodes, rootNode.nodeId, isContractChange);

    const risk: BlastRadius['risk'] =
        impactedNodeIds.length >= 5 ? 'high' : impactedNodeIds.length >= 2 ? 'medium' : 'low';

    return {
        impactedNodeIds,
        risk
    };
}

/**
 * @RightBranch
 */
export function buildEvidence(
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

    const firstLine = errorText.split(/\r?\n/).find((textLine) => textLine.trim());
    if (firstLine) {
        evidence.push(`error=${firstLine.trim()}`);
    }

    return evidence;
}

/**
 * @RightBranch
 */
export function buildSummary(
    matchedNode: TriadNodeDefinition | null,
    diagnosis: HealingBranchKind,
    suggestedAction: HealingActionKind,
    blastRadius: BlastRadius
) {
    const target = matchedNode?.nodeId ?? 'unknown node';
    return `${target} is classified as ${diagnosis}; suggested action is ${suggestedAction}; blast radius is ${blastRadius.risk}.`;
}
