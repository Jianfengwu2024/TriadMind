import {
    FunctionDeclarationStructure,
    MethodDeclarationStructure,
    OptionalKind,
    ParameterDeclarationStructure,
    Scope,
    SourceFile
} from 'ts-morph';
import * as path from 'path';
import {
    parseDemandEntry,
    ParsedNodeRef,
    parseReturnType,
    TriadNodeDefinition
} from './protocol';

export interface NodeLocationMap {
    [nodeId: string]: string;
}

const BUILTIN_TYPE_NAMES = new Set([
    'string',
    'number',
    'boolean',
    'void',
    'null',
    'undefined',
    'unknown',
    'any',
    'never',
    'object',
    'Array',
    'ReadonlyArray',
    'Promise',
    'Record',
    'Pick',
    'Omit',
    'Partial',
    'Required',
    'NonNullable',
    'ReturnType',
    'Parameters',
    'Date',
    'Map',
    'Set',
    'WeakMap',
    'WeakSet',
    'Blob',
    'HTMLElement',
    'HTMLButtonElement',
    'HTMLDivElement',
    'HTMLCanvasElement',
    'MouseEvent'
]);

/**
 * @RightBranch
 */
export function getBuiltinTypeNames() {
    return BUILTIN_TYPE_NAMES;
}

/**
 * @RightBranch
 */
export function resolveSourceFilePath(
    projectRoot: string,
    ref: ParsedNodeRef,
    node: TriadNodeDefinition,
    nodeLocations: NodeLocationMap
) {
    const explicitSourcePath = node.sourcePath?.trim();
    if (explicitSourcePath) {
        return path.join(projectRoot, explicitSourcePath);
    }

    const existingSourcePath = nodeLocations[node.nodeId] ?? nodeLocations[ref.normalizedNodeId];
    if (existingSourcePath) {
        return path.join(projectRoot, existingSourcePath);
    }

    const folder = ref.category === 'frontend' || ref.category === 'backend' ? ref.category : 'core';
    return path.join(projectRoot, 'src', folder, `${ref.className}.ts`);
}

/**
 * @RightBranch
 */
export function buildParameters(demand: string[]) {
    return demand
        .map((entry, index) => parseDemandEntry(entry, index))
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
        .map<OptionalKind<ParameterDeclarationStructure>>((entry) => ({
            name: entry.name,
            type: entry.type
        }));
}

/**
 * @RightBranch
 */
export function buildMethodStructure(
    ref: ParsedNodeRef,
    node: TriadNodeDefinition,
    parameters: OptionalKind<ParameterDeclarationStructure>[],
    returnType: string,
    includeTodo: boolean
): OptionalKind<MethodDeclarationStructure> {
    const statements = includeTodo
        ? [`throw new Error(${JSON.stringify(`TODO: 实现 ${ref.normalizedNodeId}，职责：${node.fission.problem}`)});`]
        : [];

    return {
        name: ref.methodName,
        scope: Scope.Public,
        parameters,
        returnType,
        docs: [
            {
                description: `TriadMind 自动生成骨架\n职责：${node.fission.problem}`
            }
        ],
        statements
    };
}

/**
 * @RightBranch
 */
export function buildFunctionStructure(
    ref: ParsedNodeRef,
    node: TriadNodeDefinition,
    parameters: OptionalKind<ParameterDeclarationStructure>[],
    returnType: string,
    includeTodo: boolean
): OptionalKind<FunctionDeclarationStructure> {
    const statements = includeTodo
        ? [`throw new Error(${JSON.stringify(`TODO: 实现 ${ref.normalizedNodeId}，职责：${node.fission.problem}`)});`]
        : [];

    return {
        name: ref.methodName,
        isExported: true,
        parameters,
        returnType,
        docs: [
            {
                description: `TriadMind 自动生成骨架\n职责：${node.fission.problem}`
            }
        ],
        statements
    };
}

/**
 * @RightBranch
 */
export function shouldUseTopLevelFunction(sourceFile: SourceFile, ref: ParsedNodeRef, sourcePath?: string) {
    const existingFunction = sourceFile.getFunction(ref.methodName);
    if (existingFunction?.isExported()) {
        return true;
    }

    if (sourceFile.getClass(ref.className)) {
        return false;
    }

    if (!sourcePath) {
        return false;
    }

    return normalizeToken(sourceFile.getBaseNameWithoutExtension()) === normalizeToken(ref.className);
}

/**
 * @RightBranch
 */
export function collectTypeTokens(typeText: string) {
    const matches = typeText.match(/[A-Za-z_]\w*/g) ?? [];
    return matches.filter((token) => !getBuiltinTypeNames().has(token));
}

/**
 * @RightBranch
 */
export function normalizeToken(value: string) {
    return value.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

/**
 * @RightBranch
 */
export function resolveTypesModuleSpecifier(projectRoot: string, sourceFile: SourceFile) {
    const sourceFilePath = sourceFile.getFilePath();
    const typesFilePath = path.join(projectRoot, 'src', 'types.ts');
    const relativePath = path.relative(path.dirname(sourceFilePath), typesFilePath);
    const withoutExtension = relativePath.replace(/\.ts$/, '');
    const normalized = withoutExtension.replace(/\\/g, '/');
    return normalized.startsWith('.') ? normalized : `./${normalized}`;
}

/**
 * @RightBranch
 */
export function buildTodoStatement(nodeId: string, responsibility: string) {
    return `throw new Error(${JSON.stringify(`TODO: 实现 ${nodeId}，职责：${responsibility}`)});`;
}

/**
 * @RightBranch
 */
export function buildTriadGeneratedDoc(responsibility: string) {
    return `TriadMind 自动生成骨架\n职责：${responsibility}`;
}
