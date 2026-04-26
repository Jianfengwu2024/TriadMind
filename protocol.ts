import * as fs from 'fs';
import {
    getPrefixCategoryMap,
    getTriadNodeDefinitionSchema,
    getUpgradeProtocolSchema,
    ParsedDemand,
    ParsedNodeRef,
    ProtocolValidationContext,
    TriadCategory,
    TriadNodeDefinition,
    UpgradeProtocol
} from './protocolRightBranch';

export * from './protocolRightBranch';

/**
 * @LeftBranch
 */
export function normalizeCategory(category?: string, fallback: TriadCategory = 'core'): TriadCategory {
    if (!category) {
        return fallback;
    }

    const normalized = category.trim().toLowerCase();
    return getPrefixCategoryMap()[normalized] ?? normalized;
}

/**
 * @LeftBranch
 */
export function parseNodeRef(nodeId: string, category?: string): ParsedNodeRef {
    const trimmed = nodeId.trim();
    const rawParts = trimmed.split('.').filter(Boolean);

    if (rawParts.length === 0) {
        throw new Error('节点 nodeId 不能为空');
    }

    let resolvedCategory = normalizeCategory(category);
    let parts = rawParts;

    const firstPart = rawParts[0].toLowerCase();
    const prefixCategoryMap = getPrefixCategoryMap();
    if (firstPart in prefixCategoryMap) {
        resolvedCategory = prefixCategoryMap[firstPart];
        parts = rawParts.slice(1);
    }

    if (parts.length === 0) {
        throw new Error(`节点 ${nodeId} 缺少类名`);
    }

    const methodName = parts.length >= 2 ? parts[parts.length - 1] : 'execute';
    const className = parts.length >= 2 ? parts[parts.length - 2] : parts[0];

    return {
        rawNodeId: nodeId,
        normalizedNodeId: `${className}.${methodName}`,
        category: resolvedCategory,
        className,
        methodName
    };
}

/**
 * @LeftBranch
 */
export function parseDemandEntry(entry: string, index: number): ParsedDemand | null {
    const text = entry.trim();
    if (!text || text.toLowerCase().startsWith('none')) {
        return null;
    }

    const match = text.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
    if (match) {
        return {
            type: match[1].trim(),
            name: match[2].trim()
        };
    }

    return {
        type: text,
        name: `input${index + 1}`
    };
}

/**
 * @LeftBranch
 */
export function parseReturnType(answer: string) {
    const text = answer.trim();
    if (!text) {
        return 'void';
    }

    const match = text.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
    return match ? match[1].trim() : text;
}

/**
 * @LeftBranch
 */
export function readTriadMap(mapPath: string) {
    if (!fs.existsSync(mapPath)) {
        return [] as TriadNodeDefinition[];
    }

    try {
        return getTriadNodeDefinitionSchema().array().parse(readJsonFile<unknown>(mapPath));
    } catch {
        return [] as TriadNodeDefinition[];
    }
}

/**
 * @LeftBranch
 */
export function readJsonFile<T>(filePath: string): T {
    const content = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
    return JSON.parse(content) as T;
}

/**
 * @LeftBranch
 */
export function assertProtocolShape(protocol: UpgradeProtocol, context: ProtocolValidationContext = {}) {
    const parsed = getUpgradeProtocolSchema().parse(protocol) as UpgradeProtocol;
    validateConfidenceRules(parsed, context);
    validateTopologyRules(parsed, context.existingNodes ?? []);
    return parsed;
}

function validateConfidenceRules(protocol: UpgradeProtocol, context: ProtocolValidationContext) {
    const minConfidence = context.minConfidence ?? 0;
    const requireConfidence = context.requireConfidence ?? false;

    protocol.actions.forEach((action, index) => {
        if (requireConfidence && typeof action.confidence !== 'number') {
            throw new Error(`actions[${index}] 缺少 confidence；当前配置要求所有协议动作必须提供置信度`);
        }

        if (typeof action.confidence === 'number' && action.confidence < minConfidence) {
            throw new Error(
                `actions[${index}] confidence=${action.confidence} 低于最小阈值 ${minConfidence}，请人工审核或重新推演`
            );
        }
    });
}

function validateTopologyRules(protocol: UpgradeProtocol, existingNodes: TriadNodeDefinition[]) {
    const existingNodeMap = new Map(existingNodes.map((node) => [node.nodeId, node]));
    const actionTargetIds = new Set<string>();

    protocol.actions.forEach((action, index) => {
        if (action.op === 'reuse') {
            ensureExistingNode(existingNodeMap, action.nodeId, `actions[${index}].nodeId`);
            ensureUniqueActionTarget(actionTargetIds, action.nodeId, index);
            return;
        }

        if (action.op === 'modify') {
            const existingNode = ensureExistingNode(existingNodeMap, action.nodeId, `actions[${index}].nodeId`);
            ensureUniqueActionTarget(actionTargetIds, action.nodeId, index);

            if (normalizeText(existingNode.fission.problem) !== normalizeText(action.fission.problem)) {
                throw new Error(
                    `actions[${index}] 违反三元法：modify 只能升级输入/输出，不能改变核心职责 problem`
                );
            }

            return;
        }

        ensureExistingNode(existingNodeMap, action.parentNodeId, `actions[${index}].parentNodeId`);
        if (existingNodeMap.has(action.node.nodeId)) {
            throw new Error(`actions[${index}] 违反三元法：create_child 不能复用已存在的 nodeId ${action.node.nodeId}`);
        }

        ensureUniqueActionTarget(actionTargetIds, action.node.nodeId, index);
    });
}

function ensureExistingNode(existingNodeMap: Map<string, TriadNodeDefinition>, nodeId: string, field: string) {
    const existingNode = existingNodeMap.get(nodeId);
    if (!existingNode) {
        throw new Error(`${field} 指向不存在的拓扑节点：${nodeId}`);
    }

    return existingNode;
}

function ensureUniqueActionTarget(actionTargetIds: Set<string>, nodeId: string, index: number) {
    if (actionTargetIds.has(nodeId)) {
        throw new Error(`actions[${index}] 重复操作同一节点：${nodeId}`);
    }

    actionTargetIds.add(nodeId);
}

function normalizeText(value: string) {
    return value.trim().replace(/\s+/g, ' ');
}
