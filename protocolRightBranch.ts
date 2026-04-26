import { z } from 'zod';

export type TriadCategory = string;
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

export const PREFIX_CATEGORY_MAP: Record<string, TriadCategory> = {
    core: 'core'
};

const nonEmptyStringSchema = z.string().trim().min(1);
const triadCategorySchema = nonEmptyStringSchema;
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

/**
 * @RightBranch
 */
export function getPrefixCategoryMap() {
    return PREFIX_CATEGORY_MAP;
}

/**
 * @RightBranch
 */
export function getUpgradeProtocolSchema() {
    return upgradeProtocolSchema;
}

/**
 * @RightBranch
 */
export function getTriadNodeDefinitionSchema() {
    return triadNodeDefinitionSchema;
}
