import {
    FunctionDeclaration,
    FunctionDeclarationStructure,
    MethodDeclaration,
    MethodDeclarationStructure,
    OptionalKind,
    ParameterDeclarationStructure,
    Project,
    Scope,
    SourceFile
} from 'ts-morph';
import * as fs from 'fs';
import * as path from 'path';
import { loadTriadConfig } from './config';
import { getWorkspacePaths } from './workspace';
import {
    assertProtocolShape,
    CreateChildAction,
    ModifyAction,
    parseDemandEntry,
    parseNodeRef,
    parseReturnType,
    ParsedNodeRef,
    readJsonFile,
    readTriadMap,
    TriadNodeDefinition,
    UpgradeProtocol
} from './protocol';

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

interface NodeLocationMap {
    [nodeId: string]: string;
}

export function applyProtocol(projectRoot: string, protocolPath?: string) {
    const resolvedProjectRoot = path.resolve(projectRoot);
    const resolvedProtocolPath = protocolPath ?? path.join(resolvedProjectRoot, '.triadmind', 'draft-protocol.json');
    const tsConfigFilePath = path.join(resolvedProjectRoot, 'tsconfig.json');

    if (!fs.existsSync(resolvedProtocolPath)) {
        throw new Error(`找不到协议文件：${resolvedProtocolPath}`);
    }

    if (!fs.existsSync(tsConfigFilePath)) {
        throw new Error(`找不到 tsconfig.json：${tsConfigFilePath}`);
    }

    const protocol = readJsonFile<UpgradeProtocol>(resolvedProtocolPath);
    const triadMapPath = path.join(resolvedProjectRoot, '.triadmind', 'triad-map.json');
    const existingNodes = readTriadMap(triadMapPath);
    const config = loadTriadConfig(getWorkspacePaths(resolvedProjectRoot));
    assertProtocolShape(protocol, {
        existingNodes,
        minConfidence: config.protocol.minConfidence,
        requireConfidence: config.protocol.requireConfidence
    });

    const project = new Project({
        tsConfigFilePath
    });

    const exportedTypeNames = getExportedTypeNames(project, resolvedProjectRoot);
    const nodeLocations = loadNodeLocations(resolvedProjectRoot);
    const changedFiles = new Set<string>();

    for (const action of protocol.actions) {
        if (action.op === 'reuse') {
            continue;
        }

        if (action.op === 'create_child') {
            changedFiles.add(
                upsertNode(project, resolvedProjectRoot, action.node, exportedTypeNames, nodeLocations, action)
            );
            continue;
        }

        if (action.op === 'modify') {
            changedFiles.add(
                upsertNode(
                    project,
                    resolvedProjectRoot,
                    {
                        nodeId: action.nodeId,
                        category: action.category,
                        sourcePath: action.sourcePath,
                        fission: action.fission
                    },
                    exportedTypeNames,
                    nodeLocations,
                    action
                )
            );
        }
    }

    project.saveSync();
    const normalizedFiles = Array.from(changedFiles).map((filePath) => path.relative(resolvedProjectRoot, filePath));
    console.log(`[TriadMind] 协议执行完成，涉及 ${normalizedFiles.length} 个源码文件。`);

    return {
        changedFiles: normalizedFiles
    };
}

function upsertNode(
    project: Project,
    projectRoot: string,
    node: TriadNodeDefinition,
    exportedTypeNames: Set<string>,
    nodeLocations: NodeLocationMap,
    action: CreateChildAction | ModifyAction
) {
    const ref = parseNodeRef(node.nodeId, node.category);
    const filePath = resolveSourceFilePath(projectRoot, ref, node, nodeLocations);
    const sourceFile =
        project.getSourceFile(filePath) ?? project.createSourceFile(filePath, '', { overwrite: false });

    ensureTypeImports(projectRoot, sourceFile, ref, exportedTypeNames, node);

    if (shouldUseTopLevelFunction(sourceFile, ref, node.sourcePath)) {
        upsertFunctionVertex(sourceFile, ref, node, action);
    } else {
        upsertClassVertex(sourceFile, ref, node, action);
    }

    sourceFile.formatText({
        indentSize: 4
    });

    return filePath;
}

function upsertClassVertex(
    sourceFile: SourceFile,
    ref: ParsedNodeRef,
    node: TriadNodeDefinition,
    action: CreateChildAction | ModifyAction
) {
    const cls =
        sourceFile.getClass(ref.className) ??
        sourceFile.addClass({
            name: ref.className,
            isExported: true
        });

    const existingMethod = cls.getMethod(ref.methodName);
    const parameters = buildParameters(node.fission.demand);
    const returnType = parseReturnType(node.fission.answer[0] ?? 'void');

    if (!existingMethod) {
        cls.addMethod(buildMethodStructure(ref, node, parameters, returnType, action.op === 'create_child'));
    } else {
        syncMethod(existingMethod, parameters, returnType, node);
    }
}

function upsertFunctionVertex(
    sourceFile: SourceFile,
    ref: ParsedNodeRef,
    node: TriadNodeDefinition,
    action: CreateChildAction | ModifyAction
) {
    const existingFunction = sourceFile.getFunction(ref.methodName);
    const parameters = buildParameters(node.fission.demand);
    const returnType = parseReturnType(node.fission.answer[0] ?? 'void');

    if (!existingFunction) {
        sourceFile.addFunction(buildFunctionStructure(ref, node, parameters, returnType, action.op === 'create_child'));
    } else {
        syncFunction(existingFunction, parameters, returnType, node);
    }
}

function resolveSourceFilePath(
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

function buildParameters(demand: string[]) {
    return demand
        .map((entry, index) => parseDemandEntry(entry, index))
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
        .map<OptionalKind<ParameterDeclarationStructure>>((entry) => ({
            name: entry.name,
            type: entry.type
        }));
}

function buildMethodStructure(
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

function buildFunctionStructure(
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

function syncMethod(
    method: MethodDeclaration,
    parameters: OptionalKind<ParameterDeclarationStructure>[],
    returnType: string,
    node: TriadNodeDefinition
) {
    const existingParameters = method.getParameters();

    for (let index = existingParameters.length - 1; index >= parameters.length; index -= 1) {
        existingParameters[index].remove();
    }

    parameters.forEach((parameter, index) => {
        const existing = method.getParameters()[index];
        if (!existing) {
            method.insertParameter(index, parameter);
            return;
        }

        existing.rename(parameter.name);
        existing.setType(parameter.type ?? 'unknown');
    });

    method.setReturnType(returnType);
    replaceDocs(method, node.fission.problem);

    if (method.getStatements().length === 0) {
        method.addStatements([
            `throw new Error(${JSON.stringify(`TODO: 实现 ${node.nodeId}，职责：${node.fission.problem}`)});`
        ]);
    }
}

function syncFunction(
    fn: FunctionDeclaration,
    parameters: OptionalKind<ParameterDeclarationStructure>[],
    returnType: string,
    node: TriadNodeDefinition
) {
    const existingParameters = fn.getParameters();

    for (let index = existingParameters.length - 1; index >= parameters.length; index -= 1) {
        existingParameters[index].remove();
    }

    parameters.forEach((parameter, index) => {
        const existing = fn.getParameters()[index];
        if (!existing) {
            fn.insertParameter(index, parameter);
            return;
        }

        existing.rename(parameter.name);
        existing.setType(parameter.type ?? 'unknown');
    });

    fn.setReturnType(returnType);
    fn.setIsExported(true);
    replaceDocs(fn, node.fission.problem);

    if (fn.getStatements().length === 0) {
        fn.addStatements([`throw new Error(${JSON.stringify(`TODO: 实现 ${node.nodeId}，职责：${node.fission.problem}`)});`]);
    }
}

function ensureTypeImports(
    projectRoot: string,
    sourceFile: SourceFile,
    ref: ParsedNodeRef,
    exportedTypeNames: Set<string>,
    node: TriadNodeDefinition
) {
    const referencedTypes = new Set<string>();
    for (const demand of node.fission.demand) {
        const parsed = parseDemandEntry(demand, 0);
        if (parsed) {
            collectTypeTokens(parsed.type).forEach((token) => referencedTypes.add(token));
        }
    }

    collectTypeTokens(parseReturnType(node.fission.answer[0] ?? 'void')).forEach((token) =>
        referencedTypes.add(token)
    );

    const typeImports = Array.from(referencedTypes).filter((token) => exportedTypeNames.has(token));
    if (typeImports.length === 0) {
        return;
    }

    const moduleSpecifier = resolveTypesModuleSpecifier(projectRoot, sourceFile);
    removeStaleTypeImports(sourceFile, moduleSpecifier, typeImports);
    const existingImport = sourceFile.getImportDeclaration(
        (declaration) => declaration.getModuleSpecifierValue() === moduleSpecifier
    );

    if (!existingImport) {
        sourceFile.addImportDeclaration({
            moduleSpecifier,
            namedImports: typeImports.sort()
        });
        return;
    }

    const existingNames = new Set(existingImport.getNamedImports().map((specifier) => specifier.getName()));
    typeImports
        .sort()
        .filter((name) => !existingNames.has(name))
        .forEach((name) => existingImport.addNamedImport(name));
}

function getExportedTypeNames(project: Project, projectRoot: string) {
    const typesFilePath = path.join(projectRoot, 'src', 'types.ts');
    const sourceFile = project.getSourceFile(typesFilePath);
    const exported = new Set<string>();

    if (!sourceFile) {
        return exported;
    }

    for (const [name] of sourceFile.getExportedDeclarations()) {
        exported.add(name);
    }

    return exported;
}

function loadNodeLocations(projectRoot: string) {
    const candidates = [
        path.join(projectRoot, '.triadmind', 'triad-map.json'),
        path.join(projectRoot, 'triad-map.json')
    ];

    for (const candidate of candidates) {
        if (!fs.existsSync(candidate)) {
            continue;
        }

        try {
            const nodes = JSON.parse(fs.readFileSync(candidate, 'utf-8')) as Array<{
                nodeId?: string;
                sourcePath?: string;
            }>;

            return nodes.reduce<NodeLocationMap>((result, item) => {
                if (item?.nodeId && item?.sourcePath) {
                    result[item.nodeId] = item.sourcePath;
                }
                return result;
            }, {});
        } catch {
            return {};
        }
    }

    return {};
}

function shouldUseTopLevelFunction(sourceFile: SourceFile, ref: ParsedNodeRef, sourcePath?: string) {
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

function replaceDocs(node: MethodDeclaration | FunctionDeclaration, responsibility: string) {
    node.getJsDocs().forEach((doc) => doc.remove());
    node.addJsDoc({
        description: `TriadMind 自动生成骨架\n职责：${responsibility}`
    });
}

function collectTypeTokens(typeText: string) {
    const matches = typeText.match(/[A-Za-z_]\w*/g) ?? [];
    return matches.filter((token) => !BUILTIN_TYPE_NAMES.has(token));
}

function normalizeToken(value: string) {
    return value.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

function removeStaleTypeImports(sourceFile: SourceFile, moduleSpecifier: string, typeImports: string[]) {
    const targetNames = new Set(typeImports);
    sourceFile
        .getImportDeclarations()
        .filter((declaration) => {
            const value = declaration.getModuleSpecifierValue();
            return value !== moduleSpecifier && value.includes('types');
        })
        .forEach((declaration) => {
            declaration
                .getNamedImports()
                .filter((specifier) => targetNames.has(specifier.getName()))
                .forEach((specifier) => specifier.remove());

            if (
                declaration.getNamedImports().length === 0 &&
                !declaration.getDefaultImport() &&
                !declaration.getNamespaceImport()
            ) {
                declaration.remove();
            }
        });
}

function resolveTypesModuleSpecifier(projectRoot: string, sourceFile: SourceFile) {
    const sourceFilePath = sourceFile.getFilePath();
    const typesFilePath = path.join(projectRoot, 'src', 'types.ts');
    const relativePath = path.relative(path.dirname(sourceFilePath), typesFilePath);
    const withoutExtension = relativePath.replace(/\.ts$/, '');
    const normalized = withoutExtension.replace(/\\/g, '/');
    return normalized.startsWith('.') ? normalized : `./${normalized}`;
}

if (require.main === module) {
    applyProtocol(process.argv[2] ?? process.cwd(), process.argv[3]);
}
