import * as fs from 'fs';
import { z } from 'zod';

export type TriadCategory = 'frontend' | 'backend' | 'core';
export type TriadOp = 'reuse' | 'modify' | 'create_child';

export interface TriadFission {
    problem: string;
    demand: string[];
    answer: string[];
}

export interface TriadNodeDefinition {
    nodeId: string;
    category?: string;
    sourcePath?: string;
    fission: TriadFission;
}

export interface MacroSplit {
    anchorNodeId: string;
    vertexGoal: string;
    leftBranch: string[];
    rightBranch: string[];
}

export interface MesoClassBlueprint {
    className: string;
    category: string;
    responsibility: string;
    upstreams: string[];
    downstreams: string[];
}

export interface MesoPipeline {
    pipelineId: string;
    purpose: string;
    steps: string[];
}

export interface MicroPropertyBlueprint {
    name: string;
    type: string;
    role: string;
}

export interface MicroMethodBlueprint {
    name: string;
    demand: string[];
    answer: string[];
    responsibility: string;
}

export interface MicroClassBlueprint {
    className: string;
    staticRightBranch: MicroPropertyBlueprint[];
    dynamicLeftBranch: MicroMethodBlueprint[];
}

export interface ReuseAction {
    op: 'reuse';
    nodeId: string;
    reason?: string;
    confidence?: number;
}

export interface ModifyAction {
    op: 'modify';
    nodeId: string;
    category?: string;
    sourcePath?: string;
    fission: TriadFission;
    reason?: string;
    reuse?: string[];
    confidence?: number;
}

export interface CreateChildAction {
    op: 'create_child';
    parentNodeId: string;
    node: TriadNodeDefinition;
    reason?: string;
    reuse?: string[];
    confidence?: number;
}

export type TriadAction = ReuseAction | ModifyAction | CreateChildAction;

export interface UpgradeProtocol {
    protocolVersion?: string;
    project?: string;
    mapSource?: string;
    userDemand?: string;
    upgradePolicy?: {
        allowedOps?: TriadOp[];
        principle?: string;
    };
    macroSplit?: MacroSplit;
    mesoSplit?: {
        classes: MesoClassBlueprint[];
        pipelines: MesoPipeline[];
    };
    microSplit?: {
        classes: MicroClassBlueprint[];
    };
    actions: TriadAction[];
    resultTopology?: TriadNodeDefinition[];
}

export interface ParsedNodeRef {
    rawNodeId: string;
    normalizedNodeId: string;
    category: TriadCategory;
    className: string;
    methodName: string;
}

export interface ParsedDemand {
    type: string;
    name: string;
}

export interface ProtocolValidationContext {
    existingNodes?: TriadNodeDefinition[];
    minConfidence?: number;
    requireConfidence?: boolean;
}

const PREFIX_CATEGORY_MAP: Record<string, TriadCategory> = {
    frontend: 'frontend',
    backend: 'backend',
    core: 'core'
};

const nonEmptyStringSchema = z.string().trim().min(1);
const triadCategorySchema = z.enum(['frontend', 'backend', 'core']);
const triadOpSchema = z.enum(['reuse', 'modify', 'create_child']);

export const triadFissionSchema = z.object({
    problem: nonEmptyStringSchema,
    demand: z.array(nonEmptyStringSchema),
    answer: z.array(nonEmptyStringSchema)
});

export const triadNodeDefinitionSchema = z.object({
    nodeId: nonEmptyStringSchema,
    category: triadCategorySchema.optional(),
    sourcePath: nonEmptyStringSchema.optional(),
    fission: triadFissionSchema
});

export const macroSplitSchema = z.object({
    anchorNodeId: z.string().trim(),
    vertexGoal: z.string().trim(),
    leftBranch: z.array(nonEmptyStringSchema),
    rightBranch: z.array(nonEmptyStringSchema)
});

export const mesoClassBlueprintSchema = z.object({
    className: nonEmptyStringSchema,
    category: nonEmptyStringSchema,
    responsibility: nonEmptyStringSchema,
    upstreams: z.array(nonEmptyStringSchema),
    downstreams: z.array(nonEmptyStringSchema)
});

export const mesoPipelineSchema = z.object({
    pipelineId: nonEmptyStringSchema,
    purpose: nonEmptyStringSchema,
    steps: z.array(nonEmptyStringSchema)
});

export const microPropertyBlueprintSchema = z.object({
    name: nonEmptyStringSchema,
    type: nonEmptyStringSchema,
    role: nonEmptyStringSchema
});

export const microMethodBlueprintSchema = z.object({
    name: nonEmptyStringSchema,
    demand: z.array(nonEmptyStringSchema),
    answer: z.array(nonEmptyStringSchema),
    responsibility: nonEmptyStringSchema
});

export const microClassBlueprintSchema = z.object({
    className: nonEmptyStringSchema,
    staticRightBranch: z.array(microPropertyBlueprintSchema),
    dynamicLeftBranch: z.array(microMethodBlueprintSchema)
});

export const reuseActionSchema = z.object({
    op: z.literal('reuse'),
    nodeId: nonEmptyStringSchema,
    reason: z.string().optional(),
    confidence: z.number().min(0).max(1).optional()
});

export const modifyActionSchema = z.object({
    op: z.literal('modify'),
    nodeId: nonEmptyStringSchema,
    category: triadCategorySchema.optional(),
    sourcePath: nonEmptyStringSchema.optional(),
    fission: triadFissionSchema,
    reason: z.string().optional(),
    reuse: z.array(nonEmptyStringSchema).optional(),
    confidence: z.number().min(0).max(1).optional()
});

export const createChildActionSchema = z.object({
    op: z.literal('create_child'),
    parentNodeId: nonEmptyStringSchema,
    node: triadNodeDefinitionSchema,
    reason: z.string().optional(),
    reuse: z.array(nonEmptyStringSchema).optional(),
    confidence: z.number().min(0).max(1).optional()
});

export const triadActionSchema = z.discriminatedUnion('op', [
    reuseActionSchema,
    modifyActionSchema,
    createChildActionSchema
]);

export const upgradeProtocolSchema = z.object({
    protocolVersion: z.string().optional(),
    project: z.string().optional(),
    mapSource: z.string().optional(),
    userDemand: z.string().optional(),
    upgradePolicy: z
        .object({
            allowedOps: z.array(triadOpSchema).optional(),
            principle: z.string().optional()
        })
        .optional(),
    macroSplit: macroSplitSchema.optional(),
    mesoSplit: z
        .object({
            classes: z.array(mesoClassBlueprintSchema),
            pipelines: z.array(mesoPipelineSchema)
        })
        .optional(),
    microSplit: z
        .object({
            classes: z.array(microClassBlueprintSchema)
        })
        .optional(),
    actions: z.array(triadActionSchema).min(1, 'actions must contain at least one reuse/modify/create_child operation'),
    resultTopology: z.array(triadNodeDefinitionSchema).optional()
});

export function normalizeCategory(category?: string, fallback: TriadCategory = 'core'): TriadCategory {
    if (!category) {
        return fallback;
    }

    const normalized = category.trim().toLowerCase();
    return PREFIX_CATEGORY_MAP[normalized] ?? fallback;
}

export function parseNodeRef(nodeId: string, category?: string): ParsedNodeRef {
    const trimmed = nodeId.trim();
    const rawParts = trimmed.split('.').filter(Boolean);

    if (rawParts.length === 0) {
        throw new Error('节点 nodeId 不能为空');
    }

    let resolvedCategory = normalizeCategory(category);
    let parts = rawParts;

    const firstPart = rawParts[0].toLowerCase();
    if (firstPart in PREFIX_CATEGORY_MAP) {
        resolvedCategory = PREFIX_CATEGORY_MAP[firstPart];
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

export function parseReturnType(answer: string) {
    const text = answer.trim();
    if (!text) {
        return 'void';
    }

    const match = text.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
    return match ? match[1].trim() : text;
}

export function readTriadMap(mapPath: string) {
    if (!fs.existsSync(mapPath)) {
        return [] as TriadNodeDefinition[];
    }

    try {
        return z.array(triadNodeDefinitionSchema).parse(readJsonFile<unknown>(mapPath));
    } catch {
        return [] as TriadNodeDefinition[];
    }
}

export function readJsonFile<T>(filePath: string): T {
    const content = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
    return JSON.parse(content) as T;
}

export function assertProtocolShape(protocol: UpgradeProtocol, context: ProtocolValidationContext = {}) {
    const parsed = upgradeProtocolSchema.parse(protocol);
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
