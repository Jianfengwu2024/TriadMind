import Parser = require('tree-sitter');
import JavaScript = require('tree-sitter-javascript');
import Python = require('tree-sitter-python');
import Go = require('tree-sitter-go');
import Rust = require('tree-sitter-rust');
import Cpp = require('tree-sitter-cpp');
import Java = require('tree-sitter-java');
import TypeScript = require('tree-sitter-typescript');
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import {
    createSourcePathFilter,
    describeSourceScanScope,
    GhostLanguagePolicy,
    isIgnorableFsError,
    shouldSkipWalkPath,
    TriadConfig,
    TriadLanguage,
    resolveCategoryFromConfig
} from './config';
import { scanTreeSitterGhostReferences, TreeSitterGhostAccessMode } from './treeSitterGhostScanner';
import { normalizePath } from './workspace';

export interface TreeSitterTriadNode {
    nodeId: string;
    category: string;
    sourcePath: string;
    fission: {
        problem: string;
        demand: string[];
        answer: string[];
        evidence?: {
            ghostReads?: Array<{
                raw: string;
                mode: 'read' | 'read_write';
                target: string;
                valueType: string;
                retainedInDemand: boolean;
                score: number;
            }>;
            promotionReasons?: string[];
        };
    };
    topology?: {
        foldedLeaves?: string[];
    };
}

type TriadNode = TreeSitterTriadNode;

export interface TreeSitterParseResult {
    language: TriadLanguage;
    leafNodes: TreeSitterTriadNode[];
    capabilityNodes: TreeSitterTriadNode[];
    projectedNodes: TreeSitterTriadNode[];
    fileCount: number;
    scanUnit: string;
}

interface ParsedSourceFile {
    filePath: string;
    sourcePath: string;
    source: string;
    rootNode: Parser.SyntaxNode;
}

interface BindingInfo {
    typeName: string;
    callableReturnType?: string;
}

interface GhostBindingContext {
    importedBindings: Map<string, BindingInfo>;
    moduleBindings: Map<string, BindingInfo>;
}

function createValueBinding(typeName: string): BindingInfo {
    return {
        typeName: normalizeTypeText(typeName || 'unknown')
    };
}

function createCallableBinding(displayName: string, returnType: string): BindingInfo {
    return {
        typeName: normalizeTypeText(displayName || 'unknown'),
        callableReturnType: normalizeTypeText(returnType || 'unknown')
    };
}

function createModuleBinding(typeName = 'module'): BindingInfo {
    return {
        typeName: normalizeTypeText(typeName || 'module')
    };
}

function resolveBindingValueType(binding: BindingInfo | undefined, fallbackName: string) {
    return normalizeTypeText(binding?.callableReturnType ?? binding?.typeName ?? guessBindingTypeFromName(fallbackName));
}

const TREE_SITTER_LANGUAGES: Record<TriadLanguage, any> = {
    typescript: TypeScript.typescript,
    javascript: JavaScript,
    python: Python,
    go: Go,
    rust: Rust,
    cpp: Cpp,
    java: Java
};

const FILE_PATTERNS: Record<TriadLanguage, RegExp> = {
    typescript: /\.(ts|tsx|mts|cts)$/i,
    javascript: /\.(js|jsx|mjs|cjs)$/i,
    python: /\.py$/i,
    go: /\.go$/i,
    rust: /\.rs$/i,
    cpp: /\.(cpp|cc|cxx|hpp|hh|h)$/i,
    java: /\.java$/i
};

let ACTIVE_PARSER_CONFIG: TriadConfig | undefined;

export function runTreeSitterParser(
    language: TriadLanguage,
    targetDir: string,
    outputPath: string,
    config: TriadConfig
) {
    const result = collectTreeSitterParseResult(language, targetDir, config);
    const leafOutputPath = resolveParserOutputPath(targetDir, config.parser.leafOutputFile);
    const capabilityOutputPath = resolveParserOutputPath(targetDir, config.parser.capabilityOutputFile);
    fs.mkdirSync(path.dirname(leafOutputPath), { recursive: true });
    fs.mkdirSync(path.dirname(capabilityOutputPath), { recursive: true });
    fs.writeFileSync(leafOutputPath, JSON.stringify(result.leafNodes, null, 2), 'utf-8');
    fs.writeFileSync(capabilityOutputPath, JSON.stringify(result.projectedNodes, null, 2), 'utf-8');
    if (normalizePath(path.resolve(outputPath)) !== normalizePath(path.resolve(capabilityOutputPath))) {
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, JSON.stringify(result.projectedNodes, null, 2), 'utf-8');
    }
    console.log(
        chalk.gray(
            `   - [Parser] tree-sitter scan complete, extracted ${result.projectedNodes.length} ${result.scanUnit}; leaf-map has ${result.leafNodes.length} leaf nodes.`
        )
    );
    if (config.parser.scanMode === 'capability' && result.projectedNodes.length > 300) {
        console.log(chalk.yellow('   - [Parser] capability graph is still dense; consider module/domain view for overview.'));
    }
}

export function collectTreeSitterParseResult(
    language: TriadLanguage,
    targetDir: string,
    config: TriadConfig
): TreeSitterParseResult {
    ACTIVE_PARSER_CONFIG = config;
    console.log(chalk.gray(`   - [Parser] scanning ${language} via tree-sitter...`));

    const parser = new Parser();
    parser.setLanguage(TREE_SITTER_LANGUAGES[language]);

    const leafGraph: TreeSitterTriadNode[] = [];
    const capabilityGraph: TreeSitterTriadNode[] = [];
    const files = collectSourceFiles(language, targetDir, config);
    const parsedFiles: ParsedSourceFile[] = [];
    const leafConfig = withScanMode(config, 'leaf');
    const architectureScanMode = config.parser.scanMode === 'leaf' ? 'capability' : config.parser.scanMode;
    const architectureConfig = withScanMode(config, architectureScanMode);

    for (const filePath of files) {
        let source: string;
        try {
            source = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
        } catch (error: any) {
            if (isIgnorableFsError(error)) {
                continue;
            }
            throw error;
        }
        const sourcePath = normalizePath(path.relative(targetDir, filePath));
        const tree = parseSourceFile(parser, source, sourcePath);
        parsedFiles.push({
            filePath,
            sourcePath,
            source,
            rootNode: tree.rootNode
        });
    }

    for (const parsedFile of parsedFiles) {
        const category = resolveCategoryFromConfig(parsedFile.sourcePath, config);
        leafGraph.push(
            ...collectLanguageNodes(
                language,
                parsedFile.rootNode,
                parsedFile.source,
                parsedFile.filePath,
                parsedFile.sourcePath,
                category,
                leafConfig,
                parsedFiles
            )
        );
        capabilityGraph.push(
            ...collectLanguageNodes(
                language,
                parsedFile.rootNode,
                parsedFile.source,
                parsedFile.filePath,
                parsedFile.sourcePath,
                category,
                architectureConfig,
                parsedFiles
            )
        );
    }

    const leafNodes = dedupeNodes(leafGraph).sort((left, right) => left.nodeId.localeCompare(right.nodeId));
    const capabilityNodes = dedupeNodes(capabilityGraph).sort((left, right) => left.nodeId.localeCompare(right.nodeId));
    const projectedNodes =
        config.parser.scanMode === 'leaf'
            ? leafNodes
            : aggregateNodesForScanMode(capabilityNodes, architectureConfig).sort((left, right) =>
                  left.nodeId.localeCompare(right.nodeId)
              );

    const scanUnit =
        config.parser.scanMode === 'leaf'
            ? 'leaf nodes'
            : config.parser.scanMode === 'module'
              ? 'module capability nodes'
              : config.parser.scanMode === 'domain'
                ? 'domain capability nodes'
                : 'capability nodes';

    return {
        language,
        leafNodes,
        capabilityNodes,
        projectedNodes,
        fileCount: files.length,
        scanUnit
    };
}

function withScanMode(config: TriadConfig, scanMode: TriadConfig['parser']['scanMode']): TriadConfig {
    return {
        ...config,
        parser: {
            ...config.parser,
            scanMode
        }
    };
}

function resolveParserOutputPath(projectRoot: string, outputFile: string) {
    return path.resolve(projectRoot, outputFile);
}

export function runTreeSitterTypeScriptParser(targetDir: string, outputPath: string, config: TriadConfig) {
    runTreeSitterParser('typescript', targetDir, outputPath, config);
}

function parseSourceFile(parser: Parser, source: string, sourcePath: string) {
    try {
        return parser.parse(source, undefined, { bufferSize: Math.max(65536, source.length + 1) });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Tree-sitter failed to parse ${sourcePath}: ${message}`);
    }
}

function collectLanguageNodes(
    language: TriadLanguage,
    rootNode: Parser.SyntaxNode,
    source: string,
    filePath: string,
    sourcePath: string,
    category: string,
    config: TriadConfig,
    parsedFiles: ParsedSourceFile[]
) {
    switch (language) {
        case 'typescript':
            return collectTypeScriptNodes(rootNode, source, filePath, sourcePath, category, config, parsedFiles);
        case 'javascript':
            return collectJavaScriptNodes(rootNode, source, filePath, sourcePath, category, config, parsedFiles);
        case 'python':
            return collectPythonNodes(rootNode, filePath, sourcePath, category, config, parsedFiles);
        case 'go':
            return collectGoNodes(rootNode, filePath, sourcePath, category, config, parsedFiles);
        case 'rust':
            return collectRustNodes(rootNode, filePath, sourcePath, category, config, parsedFiles);
        case 'cpp':
            return collectCppNodes(rootNode, filePath, sourcePath, category, config, parsedFiles);
        case 'java':
            return collectJavaNodes(rootNode, filePath, sourcePath, category, config, parsedFiles);
    }
}

function collectTypeScriptNodes(
    rootNode: Parser.SyntaxNode,
    source: string,
    filePath: string,
    sourcePath: string,
    category: string,
    config: TriadConfig,
    parsedFiles: ParsedSourceFile[]
) {
    if (config.parser.scanMode === 'capability' || config.parser.scanMode === 'module' || config.parser.scanMode === 'domain') {
        return collectTypeScriptCapabilityNodes(rootNode, source, filePath, sourcePath, category, config, parsedFiles);
    }

    return collectTypeScriptLeafNodes(rootNode, source, filePath, sourcePath, category, config, parsedFiles);
}

function collectTypeScriptLeafNodes(
    rootNode: Parser.SyntaxNode,
    source: string,
    filePath: string,
    sourcePath: string,
    category: string,
    config: TriadConfig,
    parsedFiles: ParsedSourceFile[]
) {
    const triadGraph: TriadNode[] = [];
    const ghostContext = buildGhostBindingContext(rootNode, filePath, parsedFiles);
    const moduleName = toPascalCase(path.basename(filePath).replace(/\.(tsx?|mts|cts)$/, ''));

    for (const classNode of rootNode.descendantsOfType('class_declaration')) {
        const className = getNameText(classNode.childForFieldName('name'));
        const classBody = classNode.childForFieldName('body');
        if (!className || !classBody) {
            continue;
        }

        const classHasTriadTag = hasNearbyTriadTag(source, classNode.startIndex, config);
        const classPropertyTypes = collectTypeScriptClassPropertyTypes(classNode, ghostContext);
        for (const methodNode of classBody.namedChildren.filter((node) => node.type === 'method_definition')) {
            const methodName = getNameText(methodNode.childForFieldName('name'));
            if (!methodName || methodName === 'constructor' || hasModifier(methodNode, ['private', 'protected'])) {
                continue;
            }

            if (
                !config.parser.includeUntaggedExports &&
                !classHasTriadTag &&
                !hasNearbyTriadTag(source, methodNode.startIndex, config)
            ) {
                continue;
            }

            const ghostDemand = collectTypeScriptGhostDemand(methodNode, ghostContext, classPropertyTypes);
            triadGraph.push(
                createTriadNode(
                    `${className}.${methodName}`,
                    category,
                    sourcePath,
                    mergeDemandEntries(parseTsParameters(methodNode.childForFieldName('parameters')), ghostDemand),
                    [normalizeGenericContractType(methodNode.childForFieldName('return_type')?.text.replace(/^:\s*/, '') ?? 'void')]
                )
            );
        }
    }

    const topLevelRecords = collectTypeScriptTopLevelExecutableRecords(rootNode, moduleName, ghostContext, source, config);
    for (const record of topLevelRecords) {
        triadGraph.push(
            createTriadNode(
                `${toPascalCase(record.ownerName || moduleName)}.${record.name}`,
                category,
                sourcePath,
                record.demand,
                record.answer
            )
        );
    }

    return triadGraph;
}

function buildGhostBindingContext(rootNode: Parser.SyntaxNode, filePath: string, parsedFiles: ParsedSourceFile[]) {
    return {
        importedBindings: collectTypeScriptImportedBindings(rootNode, filePath, parsedFiles),
        moduleBindings: collectTypeScriptModuleBindings(rootNode)
    };
}

function collectTypeScriptImportedBindings(
    rootNode: Parser.SyntaxNode,
    filePath: string,
    parsedFiles: ParsedSourceFile[]
) {
    const bindings = new Map<string, BindingInfo>();

    for (const importNode of rootNode.descendantsOfType('import_statement')) {
        const modulePath = getImportModulePath(importNode);
        const targetFile = resolveImportedParsedFile(filePath, modulePath, parsedFiles);

        for (const importClause of importNode.namedChildren.filter((node) => node.type === 'import_clause')) {
            for (const child of importClause.namedChildren) {
                if (child.type === 'identifier') {
                    const localName = child.text;
                    bindings.set(localName, resolveImportedBindingInfo(targetFile, 'default', localName));
                    continue;
                }

                if (child.type === 'named_imports') {
                    for (const specifier of child.namedChildren.filter((node) => node.type === 'import_specifier')) {
                        const identifiers = specifier.namedChildren.filter(
                            (node) => node.type === 'identifier' || node.type === 'type_identifier'
                        );
                        const importedName = identifiers[0]?.text ?? '';
                        const localName = identifiers[identifiers.length - 1]?.text ?? importedName;
                        if (!localName) {
                            continue;
                        }

                        bindings.set(localName, resolveImportedBindingInfo(targetFile, importedName, localName));
                    }
                    continue;
                }

                if (child.type === 'namespace_import') {
                    const localName = getFirstNamedChildText(child, ['identifier']);
                    if (localName) {
                        bindings.set(localName, createModuleBinding());
                    }
                }
            }
        }
    }

    return bindings;
}

function collectTypeScriptModuleBindings(rootNode: Parser.SyntaxNode) {
    const bindings = new Map<string, BindingInfo>();

    for (const child of rootNode.namedChildren) {
        const declarationNode = child.type === 'export_statement' ? child.namedChildren[0] : child;
        if (!declarationNode) {
            continue;
        }

        if (declarationNode.type === 'lexical_declaration' || declarationNode.type === 'variable_declaration') {
            for (const declarator of declarationNode.namedChildren.filter((node) => node.type === 'variable_declarator')) {
                const nameNode = declarator.childForFieldName('name') ?? declarator.namedChildren[0];
                const localName = extractBindingNames(nameNode)[0];
                if (!localName) {
                    continue;
                }

                bindings.set(localName, createValueBinding(inferTypeScriptDeclaratorType(declarator, localName, bindings)));
            }
            continue;
        }

        if (declarationNode.type === 'function_declaration') {
            const localName = getNameText(declarationNode.childForFieldName('name'));
            if (localName) {
                bindings.set(localName, createCallableBinding(localName, extractTypeScriptFunctionReturnType(declarationNode)));
            }
            continue;
        }

        if (declarationNode.type === 'class_declaration') {
            const localName = getNameText(declarationNode.childForFieldName('name'));
            if (localName) {
                bindings.set(localName, createValueBinding(localName));
            }
            continue;
        }

        if (declarationNode.type === 'enum_declaration') {
            const localName = getNameText(declarationNode.childForFieldName('name'));
            if (localName) {
                bindings.set(localName, createValueBinding(localName));
            }
        }
    }

    return bindings;
}

function collectTypeScriptClassPropertyTypes(
    classNode: Parser.SyntaxNode,
    ghostContext: GhostBindingContext
) {
    const propertyTypes = new Map<string, string>();
    const classBody = classNode.childForFieldName('body');
    if (!classBody) {
        return propertyTypes;
    }

    for (const child of classBody.namedChildren.filter((node) => node.type === 'public_field_definition')) {
        const propertyName = getNameText(child.childForFieldName('name') ?? child.namedChildren[0]);
        if (!propertyName) {
            continue;
        }

        const explicitType = normalizeTypeAnnotationNode(child.childForFieldName('type') ?? child.namedChildren.find((node) => node.type === 'type_annotation') ?? null);
        if (explicitType && explicitType !== 'unknown') {
            propertyTypes.set(propertyName, explicitType);
            continue;
        }

        const valueNode = child.childForFieldName('value') ?? child.namedChildren[1] ?? null;
        propertyTypes.set(propertyName, inferTypeScriptValueType(valueNode, propertyName, ghostContext));
    }

    return propertyTypes;
}

function collectTypeScriptGhostDemand(
    executableNode: Parser.SyntaxNode,
    ghostContext: GhostBindingContext,
    classPropertyTypes = new Map<string, string>()
) {
    const ghostStates = new Map<string, { typeName: string; read: boolean; write: boolean }>();

    for (const reference of scanTreeSitterGhostReferences(executableNode)) {
        if (reference.kind === 'self') {
            const propertyName = reference.propertyName ?? reference.rootName;
            const typeName = classPropertyTypes.get(propertyName) ?? 'unknown';
            registerGhostState(ghostStates, reference.label, typeName, reference.mode);
            continue;
        }

        const binding = ghostContext.importedBindings.get(reference.rootName) ?? ghostContext.moduleBindings.get(reference.rootName);
        if (!binding) {
            continue;
        }

        registerGhostState(ghostStates, reference.label, binding.typeName, reference.mode);
    }

    return Array.from(ghostStates.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([label, state]) => {
            if (state.read && state.write) {
                return `[Ghost:ReadWrite] ${state.typeName} (${label})`;
            }
            if (state.write) {
                return `[Ghost:Write] ${state.typeName} (${label})`;
            }
            return `[Ghost:Read] ${state.typeName} (${label})`;
        });
}

function registerGhostState(
    ghostStates: Map<string, { typeName: string; read: boolean; write: boolean }>,
    label: string,
    typeName: string,
    mode: TreeSitterGhostAccessMode
) {
    const current = ghostStates.get(label) ?? {
        typeName: normalizeTypeText(typeName || 'unknown'),
        read: false,
        write: false
    };

    if (mode === 'read' || mode === 'readwrite') {
        current.read = true;
    }
    if (mode === 'write' || mode === 'readwrite') {
        current.write = true;
    }

    if (!current.typeName || current.typeName === 'unknown') {
        current.typeName = normalizeTypeText(typeName || 'unknown');
    }

    ghostStates.set(label, current);
}

function mergeDemandEntries(demand: string[], ghostDemand: string[]) {
    const merged = [...demand];
    const seen = new Set(merged);

    for (const entry of ghostDemand) {
        if (!seen.has(entry)) {
            merged.push(entry);
            seen.add(entry);
        }
    }

    return merged;
}

function extractParameterNames(parametersNode: Parser.SyntaxNode | null) {
    if (!parametersNode) {
        return [];
    }

    return parametersNode.namedChildren.flatMap((child) => extractBindingNames(child.childForFieldName('pattern') ?? child.childForFieldName('name') ?? child.namedChildren[0] ?? null));
}

function extractBindingNames(node: Parser.SyntaxNode | null): string[] {
    if (!node) {
        return [];
    }

    if (
        node.type === 'type_annotation' ||
        node.type === 'predefined_type' ||
        node.type === 'type_identifier' ||
        node.type === 'generic_type' ||
        node.type === 'type_arguments'
    ) {
        return [];
    }

    if (node.type === 'identifier' || node.type === 'property_identifier') {
        return [node.text];
    }

    if (node.type === 'shorthand_property_identifier_pattern') {
        return [node.text];
    }

    const names: string[] = [];
    for (const child of node.namedChildren) {
        names.push(...extractBindingNames(child));
    }
    return names;
}

function getImportModulePath(importNode: Parser.SyntaxNode) {
    const stringNode = importNode.namedChildren.find((node) => node.type === 'string');
    const fragment = stringNode?.namedChildren.find((node) => node.type === 'string_fragment');
    return fragment?.text ?? stringNode?.text.replace(/^['"]|['"]$/g, '') ?? '';
}

function resolveImportedParsedFile(
    currentFilePath: string,
    importPath: string,
    parsedFiles: ParsedSourceFile[]
) {
    if (!importPath.startsWith('.')) {
        return undefined;
    }

    const basePath = path.resolve(path.dirname(currentFilePath), importPath);
    const candidates = [
        basePath,
        `${basePath}.ts`,
        `${basePath}.tsx`,
        `${basePath}.mts`,
        `${basePath}.cts`,
        path.join(basePath, 'index.ts'),
        path.join(basePath, 'index.tsx')
    ].map((candidate) => path.normalize(candidate));

    return parsedFiles.find((entry) => candidates.includes(path.normalize(entry.filePath)));
}

function resolveImportedBindingInfo(
    targetFile: ParsedSourceFile | undefined,
    importedName: string,
    localName: string
) {
    if (!targetFile) {
        return createValueBinding(importedName || localName);
    }

    return lookupExportedBindingInfo(targetFile.rootNode, importedName || localName) ?? createValueBinding(importedName || localName);
}

function lookupExportedBindingInfo(rootNode: Parser.SyntaxNode, bindingName: string): BindingInfo | undefined {
    for (const child of rootNode.namedChildren.filter((node) => node.type === 'export_statement')) {
        const declarationNode = child.namedChildren[0];
        if (!declarationNode) {
            continue;
        }

        if (declarationNode.type === 'class_declaration') {
            const name = getNameText(declarationNode.childForFieldName('name'));
            if (name === bindingName || bindingName === 'default') {
                return createValueBinding(name || bindingName);
            }
        }

        if (declarationNode.type === 'function_declaration') {
            const name = getNameText(declarationNode.childForFieldName('name'));
            if (name === bindingName || bindingName === 'default') {
                return createCallableBinding(name || bindingName, extractTypeScriptFunctionReturnType(declarationNode));
            }
        }

        if (declarationNode.type === 'lexical_declaration' || declarationNode.type === 'variable_declaration') {
            for (const declarator of declarationNode.namedChildren.filter((node) => node.type === 'variable_declarator')) {
                const nameNode = declarator.childForFieldName('name') ?? declarator.namedChildren[0];
                const localName = extractBindingNames(nameNode)[0];
                if (localName === bindingName || bindingName === 'default') {
                    return createValueBinding(inferTypeScriptDeclaratorType(declarator, localName || bindingName));
                }
            }
        }
    }

    return undefined;
}

function inferTypeScriptDeclaratorType(
    declarator: Parser.SyntaxNode,
    fallbackName: string,
    ghostContext?: GhostBindingContext | Map<string, BindingInfo>
) {
    const explicitType = normalizeTypeAnnotationNode(
        declarator.childForFieldName('type') ?? declarator.namedChildren.find((node) => node.type === 'type_annotation') ?? null
    );
    if (explicitType && explicitType !== 'unknown') {
        return explicitType;
    }

    const valueNode = declarator.childForFieldName('value') ?? declarator.namedChildren[1] ?? null;
    return inferTypeScriptValueType(
        valueNode,
        fallbackName,
        ghostContext instanceof Map
            ? { importedBindings: new Map<string, BindingInfo>(), moduleBindings: ghostContext }
            : ghostContext
    );
}

function inferTypeScriptValueType(
    valueNode: Parser.SyntaxNode | null,
    fallbackName: string,
    ghostContext?: GhostBindingContext
) {
    if (!valueNode) {
        return guessBindingTypeFromName(fallbackName);
    }

    if (valueNode.type === 'object') {
        return inferTypeScriptObjectType(valueNode, ghostContext);
    }

    if (valueNode.type === 'array') {
        return 'unknown[]';
    }

    if (valueNode.type === 'string' || valueNode.type === 'template_string') {
        return 'string';
    }

    if (valueNode.type === 'number') {
        return 'number';
    }

    if (valueNode.type === 'true' || valueNode.type === 'false') {
        return 'boolean';
    }

    if (valueNode.type === 'identifier') {
        const identifierType =
            ghostContext?.importedBindings.get(valueNode.text)?.typeName ??
            ghostContext?.moduleBindings.get(valueNode.text)?.typeName;
        return identifierType ?? guessBindingTypeFromName(valueNode.text);
    }

    if (valueNode.type === 'call_expression') {
        const calleeNode = valueNode.namedChildren[0] ?? null;
        const calleeName = getNameText(calleeNode);
        if (calleeName) {
            const binding =
                ghostContext?.importedBindings.get(calleeName) ??
                ghostContext?.moduleBindings.get(calleeName);
            if (binding) {
                return resolveBindingValueType(binding, calleeName);
            }
        }

        return guessBindingTypeFromName(calleeName || fallbackName);
    }

    if (valueNode.type === 'member_expression') {
        const rootName = getNameText(valueNode.namedChildren[0] ?? null);
        const propertyName = getNameText(valueNode.namedChildren[1] ?? null);
        const binding =
            ghostContext?.importedBindings.get(rootName) ??
            ghostContext?.moduleBindings.get(rootName);
        if (binding && binding.typeName !== 'module') {
            return binding.typeName;
        }

        return guessBindingTypeFromName(propertyName || rootName || fallbackName);
    }

    if (valueNode.type === 'new_expression') {
        const constructorNode = valueNode.namedChildren.find(
            (node) => node.type === 'identifier' || node.type === 'type_identifier' || node.type === 'member_expression'
        );
        return normalizeTypeText(getNameText(constructorNode) || fallbackName);
    }

    return guessBindingTypeFromName(fallbackName);
}

function inferTypeScriptObjectType(objectNode: Parser.SyntaxNode, ghostContext?: GhostBindingContext) {
    const fields: string[] = [];

    for (const child of objectNode.namedChildren) {
        if (child.type === 'pair') {
            const keyNode = child.namedChildren[0];
            const valueNode = child.namedChildren[1] ?? null;
            const key = getNameText(keyNode);
            if (!key) {
                continue;
            }

            fields.push(`${key}: ${inferTypeScriptValueType(valueNode, key, ghostContext)}`);
            continue;
        }

        if (child.type === 'method_definition') {
            const methodName = getNameText(child.childForFieldName('name') ?? child.namedChildren[0]);
            const parameters = formatTypeScriptParameterSignature(child.childForFieldName('parameters'));
            const returnType = normalizeTypeAnnotationNode(child.childForFieldName('return_type') ?? child.namedChildren.find((node) => node.type === 'type_annotation') ?? null);
            if (methodName) {
                fields.push(`${methodName}(${parameters}): ${returnType || 'unknown'}`);
            }
        }
    }

    return fields.length > 0 ? `{ ${fields.join('; ')} }` : 'object';
}

function extractTypeScriptFunctionReturnType(functionNode: Parser.SyntaxNode) {
    return normalizeTypeText(functionNode.childForFieldName('return_type')?.text.replace(/^:\s*/, '') ?? 'unknown');
}

function formatTypeScriptParameterSignature(parametersNode: Parser.SyntaxNode | null) {
    if (!parametersNode) {
        return '';
    }

    return parametersNode.namedChildren
        .map((child, index) => {
            const nameNode = child.childForFieldName('pattern') ?? child.childForFieldName('name') ?? child.namedChildren[0] ?? null;
            const typeNode = child.childForFieldName('type') ?? child.namedChildren.find((node) => node.type === 'type_annotation') ?? null;
            const name = getNameText(nameNode) || `input${index + 1}`;
            const typeName = normalizeTypeAnnotationNode(typeNode) || 'unknown';
            return `${name}: ${typeName}`;
        })
        .join(', ');
}

function normalizeTypeAnnotationNode(node: Parser.SyntaxNode | null) {
    if (!node) {
        return '';
    }

    return normalizeTypeText(node.text.replace(/^:\s*/, '').trim());
}

function guessBindingTypeFromName(name: string) {
    if (/^[A-Z]/.test(name)) {
        return name;
    }

    return normalizeTypeText(name || 'unknown');
}

function collectJavaScriptNodes(
    rootNode: Parser.SyntaxNode,
    source: string,
    filePath: string,
    sourcePath: string,
    category: string,
    config: TriadConfig,
    parsedFiles: ParsedSourceFile[]
) {
    if (config.parser.scanMode === 'capability' || config.parser.scanMode === 'module' || config.parser.scanMode === 'domain') {
        return collectJavaScriptCapabilityNodes(rootNode, filePath, sourcePath, category, config, parsedFiles);
    }

    return collectJavaScriptLeafNodes(rootNode, filePath, sourcePath, category, config, parsedFiles);
}

function collectJavaScriptLeafNodes(
    rootNode: Parser.SyntaxNode,
    filePath: string,
    sourcePath: string,
    category: string,
    config: TriadConfig,
    parsedFiles: ParsedSourceFile[]
) {
    const triadGraph: TriadNode[] = [];
    const moduleName = toPascalCase(path.basename(filePath).replace(/\.(jsx?|mjs|cjs)$/, ''));
    const ghostContext = buildJavaScriptGhostContext(rootNode, filePath, parsedFiles);

    for (const classNode of rootNode.descendantsOfType('class_declaration')) {
        const className = getNameText(classNode.childForFieldName('name'));
        const classBody = classNode.childForFieldName('body');
        if (!className || !classBody) {
            continue;
        }

        const classPropertyTypes = collectJavaScriptClassPropertyTypes(classNode, ghostContext);
        for (const methodNode of classBody.namedChildren.filter((node) => node.type === 'method_definition')) {
            const methodName = getNameText(methodNode.childForFieldName('name'));
            if (!methodName || methodName === 'constructor') {
                continue;
            }

            const ghostDemand = collectTypeScriptGhostDemand(methodNode, ghostContext, classPropertyTypes);
            triadGraph.push(
                createTriadNode(
                    `${className}.${methodName}`,
                    category,
                    sourcePath,
                    mergeDemandEntries(parseJsParameters(methodNode.childForFieldName('parameters')), ghostDemand),
                    ['unknown']
                )
            );
        }
    }

    const topLevelNodes = config.parser.includeUntaggedExports
        ? rootNode.namedChildren
        : rootNode.namedChildren.filter((node) => node.type === 'export_statement');
    const topLevelRecords = topLevelNodes.flatMap((node) =>
        collectJavaScriptTopLevelCapabilityRecords(node, rootNode, moduleName, ghostContext)
    );
    for (const record of topLevelRecords) {
        triadGraph.push(
            createTriadNode(
                `${toPascalCase(record.ownerName || moduleName)}.${record.name}`,
                category,
                sourcePath,
                record.demand,
                record.answer
            )
        );
    }

    return triadGraph;
}

function buildJavaScriptGhostContext(rootNode: Parser.SyntaxNode, filePath: string, parsedFiles: ParsedSourceFile[]) {
    return {
        importedBindings: collectJavaScriptImportedBindings(rootNode, filePath, parsedFiles),
        moduleBindings: collectJavaScriptModuleBindings(rootNode)
    };
}

function collectJavaScriptImportedBindings(
    rootNode: Parser.SyntaxNode,
    filePath: string,
    parsedFiles: ParsedSourceFile[]
) {
    const bindings = new Map<string, BindingInfo>();

    for (const importNode of rootNode.descendantsOfType('import_statement')) {
        const modulePath = getImportModulePath(importNode);
        const targetFile = resolveImportedParsedFile(filePath, modulePath, parsedFiles);

        for (const importClause of importNode.namedChildren.filter((node) => node.type === 'import_clause')) {
            for (const child of importClause.namedChildren) {
                if (child.type === 'identifier') {
                    const localName = child.text;
                    bindings.set(localName, resolveJavaScriptImportedBindingInfo(targetFile, 'default', localName));
                    continue;
                }

                if (child.type === 'named_imports') {
                    for (const specifier of child.namedChildren.filter((node) => node.type === 'import_specifier')) {
                        const identifiers = specifier.namedChildren.filter((node) => node.type === 'identifier');
                        const importedName = identifiers[0]?.text ?? '';
                        const localName = identifiers[identifiers.length - 1]?.text ?? importedName;
                        if (!localName) {
                            continue;
                        }

                        bindings.set(localName, resolveJavaScriptImportedBindingInfo(targetFile, importedName, localName));
                    }
                    continue;
                }

                if (child.type === 'namespace_import') {
                    const localName = getFirstNamedChildText(child, ['identifier']);
                    if (localName) {
                        bindings.set(localName, createModuleBinding());
                    }
                }
            }
        }
    }

    for (const requireCall of rootNode.descendantsOfType('call_expression')) {
        if (requireCall.namedChildren[0]?.text !== 'require') {
            continue;
        }

        const parent = requireCall.parent;
        if (!parent || parent.type !== 'variable_declarator') {
            continue;
        }

        const nameNode = parent.childForFieldName('name') ?? parent.namedChildren[0] ?? null;
        const localNames = extractBindingNames(nameNode);
        if (localNames.length === 0) {
            continue;
        }

        const modulePath = requireCall.namedChildren.find((node) => node.type === 'arguments')?.namedChildren[0]?.text.replace(/^['"]|['"]$/g, '') ?? '';
        const targetFile = resolveImportedParsedFile(filePath, modulePath, parsedFiles);
        for (const localName of localNames) {
            bindings.set(localName, resolveJavaScriptImportedBindingInfo(targetFile, localName, localName));
        }
    }

    return bindings;
}

function collectJavaScriptModuleBindings(rootNode: Parser.SyntaxNode) {
    const bindings = new Map<string, BindingInfo>();

    for (const child of rootNode.namedChildren) {
        const declarationNode = child.type === 'export_statement' ? child.namedChildren[0] : child;
        if (!declarationNode) {
            continue;
        }

        if (declarationNode.type === 'lexical_declaration' || declarationNode.type === 'variable_declaration') {
            for (const declarator of declarationNode.namedChildren.filter((node) => node.type === 'variable_declarator')) {
                const nameNode = declarator.childForFieldName('name') ?? declarator.namedChildren[0];
                const localName = extractBindingNames(nameNode)[0];
                if (!localName) {
                    continue;
                }

                bindings.set(localName, createValueBinding(inferJavaScriptDeclaratorType(declarator, localName, bindings)));
            }
            continue;
        }

        if (declarationNode.type === 'function_declaration') {
            const localName = getNameText(declarationNode.childForFieldName('name'));
            if (localName) {
                bindings.set(localName, createCallableBinding(localName, 'unknown'));
            }
            continue;
        }

        if (declarationNode.type === 'class_declaration') {
            const localName = getNameText(declarationNode.childForFieldName('name'));
            if (localName) {
                bindings.set(localName, createValueBinding(localName));
            }
        }
    }

    return bindings;
}

function collectJavaScriptClassPropertyTypes(
    classNode: Parser.SyntaxNode,
    ghostContext: GhostBindingContext
) {
    const propertyTypes = new Map<string, string>();
    const classBody = classNode.childForFieldName('body');
    if (!classBody) {
        return propertyTypes;
    }

    for (const child of classBody.namedChildren.filter((node) => node.type === 'field_definition' || node.type === 'public_field_definition')) {
        const propertyName = getNameText(child.childForFieldName('name') ?? child.namedChildren[0]);
        if (!propertyName) {
            continue;
        }

        const valueNode = child.childForFieldName('value') ?? child.namedChildren[1] ?? null;
        propertyTypes.set(propertyName, inferJavaScriptValueType(valueNode, propertyName, ghostContext));
    }

    return propertyTypes;
}

function resolveJavaScriptImportedBindingInfo(
    targetFile: ParsedSourceFile | undefined,
    importedName: string,
    localName: string
) {
    if (!targetFile) {
        return createValueBinding(importedName || localName);
    }

    return (
        lookupJavaScriptExportedBindingInfo(targetFile.rootNode, importedName || localName) ??
        createValueBinding(importedName || localName)
    );
}

function lookupJavaScriptExportedBindingInfo(rootNode: Parser.SyntaxNode, bindingName: string): BindingInfo | undefined {
    for (const child of rootNode.namedChildren.filter((node) => node.type === 'export_statement')) {
        const declarationNode = child.namedChildren[0];
        if (!declarationNode) {
            continue;
        }

        if (declarationNode.type === 'class_declaration') {
            const name = getNameText(declarationNode.childForFieldName('name'));
            if (name === bindingName || bindingName === 'default') {
                return createValueBinding(name || bindingName);
            }
        }

        if (declarationNode.type === 'function_declaration') {
            const name = getNameText(declarationNode.childForFieldName('name'));
            if (name === bindingName || bindingName === 'default') {
                return createCallableBinding(name || bindingName, 'unknown');
            }
        }

        if (declarationNode.type === 'lexical_declaration' || declarationNode.type === 'variable_declaration') {
            for (const declarator of declarationNode.namedChildren.filter((node) => node.type === 'variable_declarator')) {
                const nameNode = declarator.childForFieldName('name') ?? declarator.namedChildren[0];
                const localName = extractBindingNames(nameNode)[0];
                if (localName === bindingName || bindingName === 'default') {
                    return createValueBinding(inferJavaScriptDeclaratorType(declarator, localName || bindingName));
                }
            }
        }
    }

    return undefined;
}

function inferJavaScriptDeclaratorType(
    declarator: Parser.SyntaxNode,
    fallbackName: string,
    ghostContext?: GhostBindingContext | Map<string, BindingInfo>
) {
    const valueNode = declarator.childForFieldName('value') ?? declarator.namedChildren[1] ?? null;
    return inferJavaScriptValueType(
        valueNode,
        fallbackName,
        ghostContext instanceof Map
            ? { importedBindings: new Map<string, BindingInfo>(), moduleBindings: ghostContext }
            : ghostContext
    );
}

function inferJavaScriptValueType(
    valueNode: Parser.SyntaxNode | null,
    fallbackName: string,
    ghostContext?: GhostBindingContext
) {
    return inferTypeScriptValueType(valueNode, fallbackName, ghostContext);
}

function collectPythonNodes(
    rootNode: Parser.SyntaxNode,
    filePath: string,
    sourcePath: string,
    category: string,
    config: TriadConfig,
    parsedFiles: ParsedSourceFile[]
) {
    if (config.parser.scanMode === 'capability' || config.parser.scanMode === 'module' || config.parser.scanMode === 'domain') {
        return collectPythonCapabilityNodes(rootNode, filePath, sourcePath, category, config, parsedFiles);
    }

    return collectPythonLeafNodes(rootNode, filePath, sourcePath, category, parsedFiles);
}

function collectPythonLeafNodes(
    rootNode: Parser.SyntaxNode,
    filePath: string,
    sourcePath: string,
    category: string,
    parsedFiles: ParsedSourceFile[]
) {
    const triadGraph: TriadNode[] = [];
    const moduleName = toPascalCase(path.basename(sourcePath).replace(/\.py$/, ''));
    const ghostContext = buildPythonGhostContext(rootNode, filePath, parsedFiles);

    for (const node of rootNode.namedChildren) {
        const classNode = unwrapPythonDefinition(node, 'class_definition');
        if (classNode) {
            const className = getNameText(classNode.childForFieldName('name'));
            const classBody = classNode.childForFieldName('body');
            if (!className || !classBody) {
                continue;
            }

            const classPropertyTypes = collectPythonClassPropertyTypes(classNode, ghostContext);
            for (const methodNode of getPythonFunctionDefinitions(classBody)) {
                const methodName = getNameText(methodNode.childForFieldName('name'));
                if (!methodName || methodName === '__init__') {
                    continue;
                }

                const ghostDemand = collectPythonGhostDemand(methodNode, ghostContext, classPropertyTypes);
                triadGraph.push(
                    createTriadNode(
                        `${className}.${methodName}`,
                        category,
                        sourcePath,
                        mergeDemandEntries(parsePythonParametersAst(methodNode.childForFieldName('parameters')), ghostDemand),
                        [extractPythonReturnType(methodNode)]
                    )
                );
            }
            continue;
        }

        const functionNode = unwrapPythonDefinition(node, 'function_definition');
        if (functionNode) {
            const functionName = getNameText(functionNode.childForFieldName('name'));
            if (!functionName || functionName.startsWith('_')) {
                continue;
            }

            const ghostDemand = collectPythonGhostDemand(functionNode, ghostContext);
            triadGraph.push(
                createTriadNode(
                    `${moduleName}.${functionName}`,
                    category,
                    sourcePath,
                    mergeDemandEntries(parsePythonParametersAst(functionNode.childForFieldName('parameters')), ghostDemand),
                    [extractPythonReturnType(functionNode)]
                )
            );
        }
    }

    return triadGraph;
}

function collectTypeScriptCapabilityNodes(
    rootNode: Parser.SyntaxNode,
    source: string,
    filePath: string,
    sourcePath: string,
    category: string,
    config: TriadConfig,
    parsedFiles: ParsedSourceFile[]
) {
    const triadGraph: TriadNode[] = [];
    const ghostContext = buildGhostBindingContext(rootNode, filePath, parsedFiles);
    const moduleName = toPascalCase(path.basename(filePath).replace(/\.(tsx?|mts|cts)$/, ''));

    for (const classNode of rootNode.descendantsOfType('class_declaration')) {
        triadGraph.push(...collectTypeScriptClassCapabilityNodes(classNode, source, sourcePath, category, config, ghostContext));
    }

    const topLevelRecords = collectTypeScriptTopLevelExecutableRecords(rootNode, moduleName, ghostContext, source, config);
    const promotableTopLevel = topLevelRecords.filter((record) => !isTypeScriptNoiseCapability(record.name, config, sourcePath, record));
    const promotedTopLevel = promotableTopLevel.filter((record) =>
        shouldPromoteTypeScriptCapability(record.name, sourcePath, record.ownerName, record.isExported, config, record)
    );

    for (const record of promotedTopLevel) {
        triadGraph.push(
            createTriadNode(
                `${toPascalCase(record.ownerName || moduleName)}.${record.name}`,
                category,
                sourcePath,
                record.demand,
                record.answer,
                `execute ${toPascalCase(record.ownerName || moduleName)}.${record.name} capability`
            )
        );
    }

    if (triadGraph.length === 0 && promotableTopLevel.length > 0) {
        triadGraph.push(
            createTriadNode(
                `${moduleName}.module_pipeline`,
                category,
                sourcePath,
                mergeCapabilityDemand(promotableTopLevel.map((record) => record.demand)),
                mergeCapabilityAnswer(promotableTopLevel.map((record) => record.answer)),
                `execute ${moduleName} module capability`
            )
        );
    }

    return triadGraph;
}

type TypeScriptExecutableRecord = {
    name: string;
    demand: string[];
    answer: string[];
    isExported: boolean;
    ownerName: string;
    decorators?: string[];
};

function collectTypeScriptTopLevelExecutableRecords(
    rootNode: Parser.SyntaxNode,
    moduleName: string,
    ghostContext: GhostBindingContext,
    source: string,
    config: TriadConfig
) {
    const topLevelNodes = config.parser.includeUntaggedExports
        ? rootNode.namedChildren
        : rootNode.namedChildren.filter((node) => node.type === 'export_statement');

    return topLevelNodes.flatMap((node) =>
        collectTypeScriptTopLevelExecutableRecordsFromDeclaration(node, rootNode, moduleName, ghostContext, source, config)
    );
}

function collectTypeScriptTopLevelExecutableRecordsFromDeclaration(
    node: Parser.SyntaxNode,
    rootNode: Parser.SyntaxNode,
    moduleName: string,
    ghostContext: GhostBindingContext,
    source: string,
    config: TriadConfig
): TypeScriptExecutableRecord[] {
    const declarationNode = node.type === 'export_statement' ? node.namedChildren[0] : node;
    const isExported = node.type === 'export_statement';
    if (!declarationNode) {
        return [];
    }

    if (
        !config.parser.includeUntaggedExports &&
        !hasNearbyTriadTag(source, node.startIndex, config) &&
        !hasNearbyTriadTag(source, declarationNode.startIndex, config)
    ) {
        return [];
    }

    if (declarationNode.type === 'function_declaration') {
        return [buildTypeScriptExecutableRecord(declarationNode, ghostContext, moduleName, undefined, isExported)];
    }

    if (declarationNode.type === 'lexical_declaration' || declarationNode.type === 'variable_declaration') {
        return declarationNode.namedChildren
            .filter((child) => child.type === 'variable_declarator')
            .flatMap((declarator) => {
                const name = getNameText(declarator.childForFieldName('name'));
                const valueNode = unwrapTypeScriptExecutableValueNode(declarator.childForFieldName('value'));
                if (!name || !valueNode) {
                    return [];
                }

                if (valueNode.type === 'arrow_function' || valueNode.type === 'function') {
                    return [buildTypeScriptExecutableRecord(valueNode, ghostContext, moduleName, undefined, isExported, name)];
                }

                if (valueNode.type === 'object') {
                    return collectTypeScriptObjectExecutableRecords(valueNode, ghostContext, name, isExported);
                }

                return [];
            })
            .filter((record): record is TypeScriptExecutableRecord => Boolean(record));
    }

    if (declarationNode.type === 'object') {
        return collectTypeScriptObjectExecutableRecords(declarationNode, ghostContext, moduleName, isExported);
    }

    if (declarationNode.type === 'identifier' || declarationNode.type === 'type_identifier') {
        return resolveTypeScriptTopLevelExecutableRecordByName(
            declarationNode.text,
            rootNode,
            moduleName,
            ghostContext,
            source,
            config
        );
    }

    if (declarationNode.type === 'export_clause') {
        return declarationNode.namedChildren
            .filter((child) => child.type === 'identifier' || child.type === 'type_identifier')
            .flatMap((child) =>
                resolveTypeScriptTopLevelExecutableRecordByName(
                    child.text,
                    rootNode,
                    moduleName,
                    ghostContext,
                    source,
                    config
                )
            );
    }

    return [];
}

function resolveTypeScriptTopLevelExecutableRecordByName(
    bindingName: string,
    rootNode: Parser.SyntaxNode,
    moduleName: string,
    ghostContext: GhostBindingContext,
    source: string,
    config: TriadConfig
) {
    if (!bindingName) {
        return [];
    }

    for (const child of rootNode.namedChildren) {
        const declarationNode = child.type === 'export_statement' ? child.namedChildren[0] : child;
        if (!declarationNode) {
            continue;
        }

        if (
            !config.parser.includeUntaggedExports &&
            !hasNearbyTriadTag(source, child.startIndex, config) &&
            !hasNearbyTriadTag(source, declarationNode.startIndex, config)
        ) {
            continue;
        }

        if (declarationNode.type === 'function_declaration') {
            const functionName = getNameText(declarationNode.childForFieldName('name'));
            if (functionName === bindingName) {
                return [buildTypeScriptExecutableRecord(declarationNode, ghostContext, moduleName, undefined, true)];
            }
            continue;
        }

        if (declarationNode.type !== 'lexical_declaration' && declarationNode.type !== 'variable_declaration') {
            continue;
        }

        for (const declarator of declarationNode.namedChildren.filter((entry) => entry.type === 'variable_declarator')) {
            const functionName = getNameText(declarator.childForFieldName('name'));
            const valueNode = unwrapTypeScriptExecutableValueNode(declarator.childForFieldName('value'));
            if (functionName !== bindingName || !valueNode) {
                continue;
            }
            if (valueNode.type === 'arrow_function' || valueNode.type === 'function') {
                return [buildTypeScriptExecutableRecord(valueNode, ghostContext, moduleName, undefined, true, functionName)];
            }
            if (valueNode.type === 'object') {
                return collectTypeScriptObjectExecutableRecords(valueNode, ghostContext, functionName, true);
            }
        }
    }

    return [];
}

function collectTypeScriptClassCapabilityNodes(
    classNode: Parser.SyntaxNode,
    source: string,
    sourcePath: string,
    category: string,
    config: TriadConfig,
    ghostContext: GhostBindingContext
) {
    const className = getNameText(classNode.childForFieldName('name'));
    const classBody = classNode.childForFieldName('body');
    if (!className || !classBody || isSuppressedCapabilityContainerName(className, config)) {
        return [];
    }

    const classHasTriadTag = hasNearbyTriadTag(source, classNode.startIndex, config);
    const classPropertyTypes = collectTypeScriptClassPropertyTypes(classNode, ghostContext);
    const records = classBody.namedChildren
        .filter((node) => node.type === 'method_definition')
        .map((methodNode) => ({
            node: methodNode,
            name: getNameText(methodNode.childForFieldName('name'))
        }))
        .filter((entry) => entry.name && entry.name !== 'constructor' && !hasModifier(entry.node, ['private', 'protected']))
        .filter(
            (entry) =>
                config.parser.includeUntaggedExports ||
                classHasTriadTag ||
                hasNearbyTriadTag(source, entry.node.startIndex, config)
        )
        .map((entry) => buildTypeScriptExecutableRecord(entry.node, ghostContext, className, classPropertyTypes));

    const promotable = records.filter((record) => !isTypeScriptNoiseCapability(record.name, config, sourcePath, record));
    if (promotable.length === 0) {
        return [];
    }

    const entrypoint = promotable.find((record) => isTypeScriptPrimaryCapabilityMethod(record.name, config));
    if (
        entrypoint &&
        shouldPromoteTypeScriptCapability(entrypoint.name, sourcePath, className, false, config, entrypoint)
    ) {
        const foldedRecords = getFoldableCapabilityRecords(records, promotable, config, TYPESCRIPT_MAGIC_METHODS);
        return [
            createTriadNode(
                `${className}.${entrypoint.name}`,
                category,
                sourcePath,
                mergeCapabilityDemand(foldedRecords.map((record) => record.demand)),
                mergeCapabilityAnswer(foldedRecords.map((record) => record.answer)),
                `execute ${className} capability pipeline`,
                buildFoldedLeafIds(className, foldedRecords)
            )
        ];
    }

    const capabilityMethods = promotable.filter((record) =>
        shouldPromoteTypeScriptCapability(record.name, sourcePath, className, false, config, record)
    );

    if (capabilityMethods.length > 0) {
        return capabilityMethods.map((record) =>
            createTriadNode(
                `${className}.${record.name}`,
                category,
                sourcePath,
                record.demand,
                record.answer,
                `execute ${className}.${record.name} capability`
            )
        );
    }

    if (isTypeScriptCapabilityContainer(className)) {
        const foldedRecords = getFoldableCapabilityRecords(records, promotable, config, TYPESCRIPT_MAGIC_METHODS);
        return [
            createTriadNode(
                `${className}.capability`,
                category,
                sourcePath,
                mergeCapabilityDemand(foldedRecords.map((record) => record.demand)),
                mergeCapabilityAnswer(foldedRecords.map((record) => record.answer)),
                `execute ${className} aggregate capability`,
                buildFoldedLeafIds(className, foldedRecords)
            )
        ];
    }

    return [];
}

function buildTypeScriptExecutableRecord(
    executableNode: Parser.SyntaxNode,
    ghostContext: GhostBindingContext,
    ownerName: string,
    classPropertyTypes?: Map<string, string>,
    isExported = false,
    fallbackName?: string
): TypeScriptExecutableRecord {
    const name = fallbackName ?? getNameText(executableNode.childForFieldName('name')) ?? 'execute';
    const ghostDemand = collectTypeScriptGhostDemand(executableNode, ghostContext, classPropertyTypes);
    return {
        name,
        demand: mergeDemandEntries(parseTsParameters(executableNode.childForFieldName('parameters')), ghostDemand),
        answer: [normalizeGenericContractType(executableNode.childForFieldName('return_type')?.text.replace(/^:\s*/, '') ?? 'void')],
        isExported,
        ownerName,
        decorators: getTypeScriptDecorators(executableNode)
    };
}

function collectTypeScriptObjectExecutableRecords(
    objectNode: Parser.SyntaxNode,
    ghostContext: GhostBindingContext,
    ownerName: string,
    isExported = false
) {
    const records: TypeScriptExecutableRecord[] = [];
    for (const child of objectNode.namedChildren) {
        if (child.type === 'method_definition') {
            records.push(buildTypeScriptExecutableRecord(child, ghostContext, ownerName, undefined, isExported));
            continue;
        }

        if (child.type !== 'pair') {
            continue;
        }

        const propertyName = getNameText(child.namedChildren[0] ?? null);
        const valueNode = unwrapTypeScriptExecutableValueNode(child.namedChildren[1] ?? null);
        if (!propertyName || !valueNode) {
            continue;
        }

        if (valueNode.type === 'arrow_function' || valueNode.type === 'function') {
            records.push(
                buildTypeScriptExecutableRecord(valueNode, ghostContext, ownerName, undefined, isExported, propertyName)
            );
        }
    }
    return records;
}

function unwrapTypeScriptExecutableValueNode(node: Parser.SyntaxNode | null) {
    let current = node;
    while (current) {
        if (
            current.type === 'satisfies_expression' ||
            current.type === 'as_expression' ||
            current.type === 'parenthesized_expression' ||
            current.type === 'type_assertion'
        ) {
            current = current.namedChildren[0] ?? null;
            continue;
        }
        break;
    }
    return current;
}

function getTypeScriptDecorators(executableNode: Parser.SyntaxNode) {
    return (executableNode.children ?? executableNode.namedChildren ?? [])
        .filter((child) => child.type === 'decorator')
        .map((child) => child.text.replace(/^@/, '').trim())
        .filter(Boolean);
}

function collectJavaScriptCapabilityNodes(
    rootNode: Parser.SyntaxNode,
    filePath: string,
    sourcePath: string,
    category: string,
    config: TriadConfig,
    parsedFiles: ParsedSourceFile[]
) {
    const triadGraph: TriadNode[] = [];
    const moduleName = toPascalCase(path.basename(filePath).replace(/\.(jsx?|mjs|cjs)$/, ''));
    const ghostContext = buildJavaScriptGhostContext(rootNode, filePath, parsedFiles);

    for (const classNode of rootNode.descendantsOfType('class_declaration')) {
        triadGraph.push(...collectJavaScriptClassCapabilityNodes(classNode, sourcePath, category, config, ghostContext));
    }

    const topLevelNodes = config.parser.includeUntaggedExports
        ? rootNode.namedChildren
        : rootNode.namedChildren.filter((node) => node.type === 'export_statement');
    const topLevelRecords = topLevelNodes.flatMap((node) =>
        collectJavaScriptTopLevelCapabilityRecords(node, rootNode, moduleName, ghostContext)
    );
    const promotableTopLevel = topLevelRecords.filter((record) => !isJavaScriptNoiseCapability(record.name, config, sourcePath, record));
    const promotedTopLevel = promotableTopLevel.filter((record) =>
        shouldPromoteJavaScriptCapability(record.name, sourcePath, record.ownerName, record.isExported, config, record)
    );

    for (const record of promotedTopLevel) {
        triadGraph.push(
            createTriadNode(
                `${moduleName}.${record.name}`,
                category,
                sourcePath,
                record.demand,
                record.answer,
                `execute ${moduleName}.${record.name} capability`
            )
        );
    }

    if (triadGraph.length === 0 && promotableTopLevel.length > 0) {
        triadGraph.push(
            createTriadNode(
                `${moduleName}.module_pipeline`,
                category,
                sourcePath,
                mergeCapabilityDemand(promotableTopLevel.map((record) => record.demand)),
                mergeCapabilityAnswer(promotableTopLevel.map((record) => record.answer)),
                `execute ${moduleName} module capability`
            )
        );
    }

    return triadGraph;
}

function collectJavaScriptClassCapabilityNodes(
    classNode: Parser.SyntaxNode,
    sourcePath: string,
    category: string,
    config: TriadConfig,
    ghostContext: GhostBindingContext
) {
    const className = getNameText(classNode.childForFieldName('name'));
    const classBody = classNode.childForFieldName('body');
    if (!className || !classBody || isSuppressedCapabilityContainerName(className, config)) {
        return [];
    }

    const classPropertyTypes = collectJavaScriptClassPropertyTypes(classNode, ghostContext);
    const records = classBody.namedChildren
        .filter((node) => node.type === 'method_definition')
        .map((methodNode) => buildJavaScriptExecutableRecord(methodNode, ghostContext, className, classPropertyTypes))
        .filter((record) => record.name !== 'constructor');

    const promotable = records.filter((record) => !isJavaScriptNoiseCapability(record.name, config, sourcePath, record));
    if (promotable.length === 0) {
        return [];
    }

    const entrypoint = promotable.find((record) => isJavaScriptPrimaryCapabilityMethod(record.name, config));
    if (
        entrypoint &&
        shouldPromoteJavaScriptCapability(entrypoint.name, sourcePath, className, entrypoint.isExported, config, entrypoint)
    ) {
        const foldedRecords = getFoldableCapabilityRecords(records, promotable, config, JAVASCRIPT_MAGIC_METHODS);
        return [
            createTriadNode(
                `${className}.${entrypoint.name}`,
                category,
                sourcePath,
                mergeCapabilityDemand(foldedRecords.map((record) => record.demand)),
                mergeCapabilityAnswer(foldedRecords.map((record) => record.answer)),
                `execute ${className} capability pipeline`,
                buildFoldedLeafIds(className, foldedRecords)
            )
        ];
    }

    const capabilityMethods = promotable.filter((record) =>
        shouldPromoteJavaScriptCapability(record.name, sourcePath, className, record.isExported, config, record)
    );

    if (capabilityMethods.length > 0) {
        return capabilityMethods.map((record) =>
            createTriadNode(
                `${className}.${record.name}`,
                category,
                sourcePath,
                record.demand,
                record.answer,
                `execute ${className}.${record.name} capability`
            )
        );
    }

    if (isJavaScriptCapabilityContainer(className)) {
        const foldedRecords = getFoldableCapabilityRecords(records, promotable, config, JAVASCRIPT_MAGIC_METHODS);
        return [
            createTriadNode(
                `${className}.capability`,
                category,
                sourcePath,
                mergeCapabilityDemand(foldedRecords.map((record) => record.demand)),
                mergeCapabilityAnswer(foldedRecords.map((record) => record.answer)),
                `execute ${className} aggregate capability`,
                buildFoldedLeafIds(className, foldedRecords)
            )
        ];
    }

    return [];
}

function collectJavaScriptTopLevelCapabilityRecords(
    node: Parser.SyntaxNode,
    rootNode: Parser.SyntaxNode,
    moduleName: string,
    ghostContext: GhostBindingContext
) {
    if (node.type === 'export_statement') {
        return collectJavaScriptTopLevelCapabilityRecordsFromDeclaration(
            node.namedChildren[0],
            rootNode,
            moduleName,
            ghostContext,
            true
        );
    }

    return collectJavaScriptTopLevelCapabilityRecordsFromDeclaration(node, rootNode, moduleName, ghostContext, false);
}

function collectJavaScriptTopLevelCapabilityRecordsFromDeclaration(
    declarationNode: Parser.SyntaxNode | undefined,
    rootNode: Parser.SyntaxNode,
    moduleName: string,
    ghostContext: GhostBindingContext,
    isExported: boolean
) {
    if (!declarationNode) {
        return [];
    }

    if (declarationNode.type === 'function_declaration') {
        return [buildJavaScriptExecutableRecord(declarationNode, ghostContext, moduleName, undefined, isExported)];
    }

    if (declarationNode.type === 'lexical_declaration' || declarationNode.type === 'variable_declaration') {
        return declarationNode.namedChildren
            .filter((node) => node.type === 'variable_declarator')
            .flatMap((declarator) => {
                const name = getNameText(declarator.childForFieldName('name'));
                const valueNode = unwrapJavaScriptExecutableValueNode(declarator.childForFieldName('value'));
                if (!name || !valueNode) {
                    return [];
                }

                if (valueNode.type === 'arrow_function' || valueNode.type === 'function') {
                    return [buildJavaScriptExecutableRecord(valueNode, ghostContext, moduleName, undefined, isExported, name)];
                }

                if (valueNode.type === 'object') {
                    return collectJavaScriptObjectExecutableRecords(valueNode, ghostContext, name, isExported);
                }

                return [];
            })
            .filter((record): record is JavaScriptExecutableRecord => Boolean(record));
    }

    if (declarationNode.type === 'object') {
        return collectJavaScriptObjectExecutableRecords(declarationNode, ghostContext, moduleName, isExported);
    }

    if (declarationNode.type === 'identifier') {
        return resolveJavaScriptTopLevelExecutableRecordByName(declarationNode.text, rootNode, moduleName, ghostContext);
    }

    if (declarationNode.type === 'export_clause') {
        return declarationNode.namedChildren
            .filter((child) => child.type === 'identifier')
            .flatMap((child) =>
                resolveJavaScriptTopLevelExecutableRecordByName(child.text, rootNode, moduleName, ghostContext)
            );
    }

    return [];
}

function resolveJavaScriptTopLevelExecutableRecordByName(
    bindingName: string,
    rootNode: Parser.SyntaxNode,
    moduleName: string,
    ghostContext: GhostBindingContext
) {
    if (!bindingName) {
        return [];
    }

    for (const child of rootNode.namedChildren) {
        const declarationNode = child.type === 'export_statement' ? child.namedChildren[0] : child;
        if (!declarationNode) {
            continue;
        }

        if (declarationNode.type === 'function_declaration') {
            const functionName = getNameText(declarationNode.childForFieldName('name'));
            if (functionName === bindingName) {
                return [buildJavaScriptExecutableRecord(declarationNode, ghostContext, moduleName, undefined, true)];
            }
            continue;
        }

        if (declarationNode.type !== 'lexical_declaration' && declarationNode.type !== 'variable_declaration') {
            continue;
        }

        for (const declarator of declarationNode.namedChildren.filter((entry) => entry.type === 'variable_declarator')) {
            const functionName = getNameText(declarator.childForFieldName('name'));
            const valueNode = unwrapJavaScriptExecutableValueNode(declarator.childForFieldName('value'));
            if (functionName !== bindingName || !valueNode) {
                continue;
            }
            if (valueNode.type === 'arrow_function' || valueNode.type === 'function') {
                return [buildJavaScriptExecutableRecord(valueNode, ghostContext, moduleName, undefined, true, functionName)];
            }
            if (valueNode.type === 'object') {
                return collectJavaScriptObjectExecutableRecords(valueNode, ghostContext, functionName, true);
            }
        }
    }

    return [];
}

type JavaScriptExecutableRecord = {
    name: string;
    demand: string[];
    answer: string[];
    ownerName: string;
    isExported: boolean;
};

function buildJavaScriptExecutableRecord(
    executableNode: Parser.SyntaxNode,
    ghostContext: GhostBindingContext,
    ownerName: string,
    classPropertyTypes?: Map<string, string>,
    isExported = false,
    fallbackName?: string
): JavaScriptExecutableRecord {
    const name = fallbackName ?? getNameText(executableNode.childForFieldName('name')) ?? 'execute';
    const ghostDemand = collectTypeScriptGhostDemand(executableNode, ghostContext, classPropertyTypes);
    return {
        name,
        demand: mergeDemandEntries(parseJsParameters(executableNode.childForFieldName('parameters')), ghostDemand),
        answer: [inferJavaScriptExecutableReturnType(executableNode)],
        ownerName,
        isExported
    };
}

function collectJavaScriptObjectExecutableRecords(
    objectNode: Parser.SyntaxNode,
    ghostContext: GhostBindingContext,
    ownerName: string,
    isExported = false
) {
    const records: JavaScriptExecutableRecord[] = [];
    for (const child of objectNode.namedChildren) {
        if (child.type === 'method_definition') {
            records.push(buildJavaScriptExecutableRecord(child, ghostContext, ownerName, undefined, isExported));
            continue;
        }

        if (child.type !== 'pair') {
            continue;
        }

        const propertyName = getNameText(child.namedChildren[0] ?? null);
        const valueNode = unwrapJavaScriptExecutableValueNode(child.namedChildren[1] ?? null);
        if (!propertyName || !valueNode) {
            continue;
        }

        if (valueNode.type === 'arrow_function' || valueNode.type === 'function') {
            records.push(
                buildJavaScriptExecutableRecord(valueNode, ghostContext, ownerName, undefined, isExported, propertyName)
            );
        }
    }

    return records;
}

function unwrapJavaScriptExecutableValueNode(node: Parser.SyntaxNode | null) {
    let current = node;
    while (current && current.type === 'parenthesized_expression') {
        current = current.namedChildren[0] ?? null;
    }
    return current;
}

function inferJavaScriptExecutableReturnType(executableNode: Parser.SyntaxNode) {
    const bodyNode = executableNode.childForFieldName('body') ?? executableNode.namedChildren[executableNode.namedChildren.length - 1];
    if (executableNode.type === 'arrow_function' && bodyNode && bodyNode.type !== 'statement_block') {
        return normalizeGenericContractType(inferJavaScriptValueType(bodyNode, 'result'));
    }

    return '[Generic] unknown';
}

const JAVASCRIPT_MAGIC_METHODS = new Set(['toString', 'valueOf', 'toJSON', 'inspect']);

const JAVASCRIPT_HELPER_PREFIXES = [
    '_',
    'get',
    'set',
    'build',
    'parse',
    'format',
    'normalize',
    'sanitize',
    'validate',
    'ensure',
    'create',
    'load',
    'save',
    'list',
    'collect',
    'resolve',
    'prepare',
    'read',
    'write',
    'convert',
    'sync',
    'merge',
    'filter',
    'check',
    'infer',
    'guess',
    'serialize',
    'deserialize',
    'dump',
    'helper'
];

const JAVASCRIPT_PRIMARY_CAPABILITY_PREFIXES = [
    'execute',
    'run',
    'handle',
    'process',
    'invoke',
    'dispatch',
    'orchestrate',
    'apply',
    'plan',
    'schedule'
];

const JAVASCRIPT_CAPABILITY_CLASS_SUFFIXES = [
    'Service',
    'Node',
    'Workflow',
    'Pipeline',
    'Step',
    'Handler',
    'Controller',
    'Tool',
    'Agent',
    'Manager'
];

const TYPESCRIPT_MAGIC_METHODS = JAVASCRIPT_MAGIC_METHODS;
const TYPESCRIPT_HELPER_PREFIXES = JAVASCRIPT_HELPER_PREFIXES;
const TYPESCRIPT_PRIMARY_CAPABILITY_PREFIXES = JAVASCRIPT_PRIMARY_CAPABILITY_PREFIXES;
const TYPESCRIPT_CAPABILITY_CLASS_SUFFIXES = JAVASCRIPT_CAPABILITY_CLASS_SUFFIXES;

const JAVA_MAGIC_METHODS = new Set(['toString', 'hashCode', 'equals']);
const JAVA_HELPER_PREFIXES = [
    'get', 'set', 'build', 'parse', 'format', 'normalize', 'sanitize', 'validate', 'ensure', 'create', 'load', 'save',
    'list', 'collect', 'resolve', 'prepare', 'read', 'write', 'convert', 'sync', 'merge', 'filter', 'check', 'infer',
    'guess', 'serialize', 'deserialize', 'dump'
];
const JAVA_PRIMARY_CAPABILITY_PREFIXES = ['execute', 'run', 'handle', 'process', 'invoke', 'dispatch', 'orchestrate', 'apply', 'plan', 'schedule'];
const JAVA_CAPABILITY_CLASS_SUFFIXES = ['Service', 'Node', 'Workflow', 'Pipeline', 'Step', 'Handler', 'Controller', 'Tool', 'Agent', 'Manager'];

const GO_HELPER_PREFIXES = [
    'get', 'set', 'build', 'parse', 'format', 'normalize', 'sanitize', 'validate', 'ensure', 'create', 'load', 'save',
    'list', 'collect', 'resolve', 'prepare', 'read', 'write', 'convert', 'sync', 'merge', 'filter', 'check', 'infer',
    'guess', 'dump'
];
const GO_PRIMARY_CAPABILITY_PREFIXES = ['execute', 'run', 'handle', 'process', 'invoke', 'dispatch', 'orchestrate', 'apply', 'plan', 'schedule'];
const GO_CAPABILITY_TYPE_SUFFIXES = ['Service', 'Node', 'Workflow', 'Pipeline', 'Step', 'Handler', 'Controller', 'Tool', 'Agent', 'Manager'];

const RUST_HELPER_PREFIXES = [
    '_', 'get', 'set', 'build', 'parse', 'format', 'normalize', 'sanitize', 'validate', 'ensure', 'create', 'load',
    'save', 'list', 'collect', 'resolve', 'prepare', 'read', 'write', 'convert', 'sync', 'merge', 'filter', 'check',
    'infer', 'guess', 'dump'
];
const RUST_PRIMARY_CAPABILITY_PREFIXES = ['execute', 'run', 'handle', 'process', 'invoke', 'dispatch', 'orchestrate', 'apply', 'plan', 'schedule'];
const RUST_CAPABILITY_TYPE_SUFFIXES = ['Service', 'Node', 'Workflow', 'Pipeline', 'Step', 'Handler', 'Controller', 'Tool', 'Agent', 'Manager'];

const CPP_MAGIC_METHODS = new Set(['ToString', 'toString']);
const CPP_HELPER_PREFIXES = [
    'Build', 'Parse', 'Format', 'Normalize', 'Sanitize', 'Validate', 'Ensure', 'Create', 'Load', 'Save', 'List',
    'Collect', 'Resolve', 'Prepare', 'Read', 'Write', 'Convert', 'Sync', 'Merge', 'Filter', 'Check', 'Infer', 'Guess',
    'Get', 'Set', 'Dump', 'build', 'parse', 'format', 'normalize', 'sanitize', 'validate', 'ensure', 'create', 'load',
    'save', 'list', 'collect', 'resolve', 'prepare', 'read', 'write', 'convert', 'sync', 'merge', 'filter', 'check',
    'infer', 'guess', 'get', 'set', 'dump'
];
const CPP_PRIMARY_CAPABILITY_PREFIXES = ['Execute', 'Run', 'Handle', 'Process', 'Invoke', 'Dispatch', 'Orchestrate', 'Apply', 'Plan', 'Schedule', 'execute', 'run', 'handle', 'process', 'invoke', 'dispatch', 'orchestrate', 'apply', 'plan', 'schedule'];
const CPP_CAPABILITY_TYPE_SUFFIXES = ['Service', 'Node', 'Workflow', 'Pipeline', 'Step', 'Handler', 'Controller', 'Tool', 'Agent', 'Manager'];

type CapabilityCandidateRecord = {
    name?: string;
    demand?: string[];
    answer?: string[];
    isExported?: boolean;
    decorators?: string[];
    promotionReasons?: string[];
};

type SourceCapabilityPolicy =
    | 'api'
    | 'services'
    | 'nodes'
    | 'tasks'
    | 'utils'
    | 'ui'
    | 'agent'
    | 'cli'
    | 'types'
    | 'migrations'
    | 'tests'
    | 'other';
type HelperVerbClass = 'hard' | 'conditional' | 'none';

const CAPABILITY_ACTION_PREFIXES = ['submit', 'export', 'import', 'reconcile'];
const CAPABILITY_DECORATOR_PATTERN = /\b(route|get|post|put|delete|patch|task|workflow|tool|step|action|consumer|handler|command|event|rpc)\b/i;
const HARD_SUPPRESSED_HELPER_PREFIXES = [
    'set', 'build', 'parse', 'format', 'normalize', 'sanitize', 'validate', 'collect', 'resolve', 'prepare', 'infer',
    'guess', 'convert', 'merge', 'filter', 'check'
];
const CONDITIONAL_HELPER_PREFIXES = ['get', 'list', 'create', 'load', 'save', 'ensure', 'read', 'write', 'sync'];
const UTILS_ALLOWED_CAPABILITY_PREFIXES = ['run', 'detect', 'analyze', 'apply'];
const NODE_ENTRYPOINT_PREFIXES = ['execute', 'run', 'process'];
const EXECUTE_LIKE_METHOD_PATTERN = /^(execute|run|handle|process|dispatch|apply|invoke|orchestrate|schedule|plan|do)(?:$|[_A-Z])/i;
const DEFAULT_GHOST_POLICY: GhostLanguagePolicy = {
    includeInDemand: true,
    topK: 5,
    minConfidence: 4
};

function isConfiguredNoiseCapability(name: string, config?: TriadConfig) {
    const trimmedName = name.trim();
    if (!trimmedName) {
        return true;
    }

    return (config?.parser.excludeNodeNamePatterns ?? []).some((pattern) => {
        try {
            return new RegExp(pattern, 'i').test(trimmedName);
        } catch {
            return false;
        }
    });
}

function isSuppressedCapabilityContainerName(name: string, config?: TriadConfig) {
    const trimmedName = name.trim();
    if (!trimmedName) {
        return true;
    }

    return /^_/.test(trimmedName) || /^__.*__$/.test(trimmedName) || isConfiguredNoiseCapability(trimmedName, config);
}

function isConfiguredPrimaryCapabilityMethod(name: string, config?: TriadConfig) {
    const entries = config?.parser.entryMethodNames ?? [];
    return entries.some((entryName) => hasNamePrefix(name, entryName) || name.trim().toLowerCase() === entryName.toLowerCase());
}

function inferSourceCapabilityPolicy(sourcePath = ''): SourceCapabilityPolicy {
    const normalizedPath = normalizePath(String(sourcePath ?? '')).toLowerCase();
    const segments = normalizedPath.split('/').filter(Boolean);
    if (segments.some((segment) => segment === 'test' || segment === 'tests' || segment === '__tests__')) {
        return 'tests';
    }
    if (segments.some((segment) => segment === 'migration' || segment === 'migrations' || segment === 'alembic')) {
        return 'migrations';
    }
    if (segments.some((segment) => ['types', 'schemas', 'schema', 'models', 'model', 'entities', 'entity', 'dto', 'vo'].includes(segment))) {
        return 'types';
    }
    if (segments.includes('api')) {
        return 'api';
    }
    if (isLikelyAgentSourcePath(normalizedPath, segments)) {
        return 'agent';
    }
    if (isLikelyCliSourcePath(normalizedPath, segments)) {
        return 'cli';
    }
    if (isLikelyUiSourcePath(normalizedPath, segments)) {
        return 'ui';
    }
    if (segments.includes('services') || segments.includes('service')) {
        return 'services';
    }
    if (segments.includes('nodes') || segments.includes('node')) {
        return 'nodes';
    }
    if (segments.includes('tasks') || segments.includes('task') || segments.includes('workflows') || segments.includes('workflow')) {
        return 'tasks';
    }
    if (segments.includes('utils') || segments.includes('util')) {
        return 'utils';
    }
    return 'other';
}

function isLikelyUiSourcePath(normalizedPath: string, segments: string[]) {
    const hasFrontendRoot = segments.some((segment) => ['frontend', 'client', 'web'].includes(segment));
    const hasUiSegment = segments.some((segment) =>
        ['app', 'pages', 'page', 'layouts', 'layout', 'components', 'hooks', 'screens', 'views', 'dashboard', 'ui'].includes(segment)
    );
    return /\.(tsx|jsx)$/.test(normalizedPath) || (hasFrontendRoot && hasUiSegment);
}

function isLikelyAgentSourcePath(normalizedPath: string, segments: string[]) {
    return (
        segments.includes('agent') ||
        segments.includes('agents') ||
        segments.some((segment) =>
            ['orchestration', 'function_calling', 'memory', 'session', 'planner', 'reasoning', 'tools', 'tooling', 'chat'].includes(segment)
        ) ||
        /(^|\/)(agent|agents|function_calling|orchestration|memory|session|planner|reasoning|chat)(\/|$)/.test(normalizedPath)
    );
}

function isLikelyCliSourcePath(normalizedPath: string, segments: string[]) {
    return (
        segments.includes('rheo_cli') ||
        segments.some((segment) => segment === 'cli') ||
        (segments.includes('commands') && (segments.includes('rheo_cli') || segments.some((segment) => segment === 'cli'))) ||
        /(^|\/)(rheo_cli|cli)(\/|$)/.test(normalizedPath)
    );
}

function classifyHelperVerb(name: string): HelperVerbClass {
    if (!name.trim()) {
        return 'none';
    }
    if (HARD_SUPPRESSED_HELPER_PREFIXES.some((prefix) => hasNamePrefix(name, prefix))) {
        return 'hard';
    }
    if (CONDITIONAL_HELPER_PREFIXES.some((prefix) => hasNamePrefix(name, prefix))) {
        return 'conditional';
    }
    return 'none';
}

function hasCapabilityDecorator(record?: CapabilityCandidateRecord) {
    return (record?.decorators ?? []).some((decorator) => CAPABILITY_DECORATOR_PATTERN.test(decorator));
}

function isPrivateCapabilityName(name: string, config?: TriadConfig) {
    return (config?.parser.excludePrivateMethods ?? true) && /^_/.test(name.trim());
}

function isMagicCapabilityName(name: string, magicMethods: Set<string>, config?: TriadConfig) {
    const trimmedName = name.trim();
    return (config?.parser.excludeMagicMethods ?? true) && (magicMethods.has(trimmedName) || /^__.*__$/.test(trimmedName));
}

function isConditionalHelperCapabilityAllowed(
    name: string,
    sourcePath: string,
    record: CapabilityCandidateRecord | undefined,
    isPrimary: boolean,
    config?: TriadConfig
) {
    if ((config?.parser.helperVerbPolicy ?? 'suppress') === 'allow') {
        return true;
    }

    const policy = inferSourceCapabilityPolicy(sourcePath);
    if (policy === 'api') {
        return hasCapabilityDecorator(record) || isPrimary || Boolean(record?.isExported);
    }
    if (policy === 'nodes') {
        return NODE_ENTRYPOINT_PREFIXES.some((prefix) => hasNamePrefix(name, prefix)) && isPrimary;
    }
    if (policy === 'tasks') {
        return isPrimary || hasCapabilityDecorator(record) || isWorkflowLikeName(name);
    }
    if (policy === 'ui') {
        return (
            Boolean(record?.isExported) ||
            isPrimary ||
            hasFrontendSurfaceCapabilitySignal(name, sourcePath) ||
            isWorkflowLikeName(name)
        );
    }
    if (policy === 'agent') {
        return isPrimary || hasCapabilityDecorator(record) || hasAgentCapabilitySignal(name, sourcePath) || isWorkflowLikeName(name);
    }
    if (policy === 'cli') {
        return (
            Boolean(record?.isExported) ||
            isPrimary ||
            hasCliCapabilitySignal(name, sourcePath) ||
            isWorkflowLikeName(name)
        );
    }
    if (policy === 'utils') {
        return UTILS_ALLOWED_CAPABILITY_PREFIXES.some((prefix) => hasNamePrefix(name, prefix));
    }
    if (policy === 'services') {
        return hasDomainContract(record?.demand ?? [], config) || hasDomainContract(record?.answer ?? [], config);
    }
    return isPrimary || hasCapabilityDecorator(record) || Boolean(record?.isExported);
}

function isSuppressedCapabilityCandidate(
    name: string,
    sourcePath: string,
    config: TriadConfig | undefined,
    record: CapabilityCandidateRecord | undefined,
    isPrimary: boolean,
    magicMethods: Set<string>
) {
    const trimmedName = name.trim();
    if (!trimmedName) {
        return true;
    }

    const sourcePolicy = inferSourceCapabilityPolicy(sourcePath);
    if (sourcePolicy === 'tests' || sourcePolicy === 'types' || sourcePolicy === 'migrations') {
        return true;
    }

    if (isPrivateCapabilityName(trimmedName, config)) {
        return true;
    }
    if (isMagicCapabilityName(trimmedName, magicMethods, config)) {
        return true;
    }
    if (isConfiguredNoiseCapability(trimmedName, config)) {
        return true;
    }

    const helperClass = classifyHelperVerb(trimmedName);
    if (helperClass === 'hard') {
        return true;
    }
    if (helperClass === 'conditional' && !isConditionalHelperCapabilityAllowed(trimmedName, sourcePath, record, isPrimary, config)) {
        return true;
    }

    if (sourcePolicy === 'api' && !hasCapabilityDecorator(record) && !isPrimary && !record?.isExported) {
        return true;
    }
    if (sourcePolicy === 'nodes' && !NODE_ENTRYPOINT_PREFIXES.some((prefix) => hasNamePrefix(trimmedName, prefix))) {
        return true;
    }
    if (sourcePolicy === 'tasks' && !isPrimary && !hasCapabilityDecorator(record) && !isWorkflowLikeName(trimmedName)) {
        return true;
    }
    if (
        sourcePolicy === 'utils' &&
        !UTILS_ALLOWED_CAPABILITY_PREFIXES.some((prefix) => hasNamePrefix(trimmedName, prefix)) &&
        !hasCapabilityDecorator(record)
    ) {
        return true;
    }

    return false;
}

function shouldPromoteCapabilityByScore(
    name: string,
    sourcePath: string,
    className: string | undefined,
    record: CapabilityCandidateRecord | undefined,
    config: TriadConfig | undefined,
    isContainer: boolean,
    isPrimary: boolean,
    isExported = false,
    magicMethods: Set<string> = new Set<string>()
) {
    if (isSuppressedCapabilityCandidate(name, sourcePath, config, record, isPrimary, magicMethods)) {
        return false;
    }

    const decorators = record?.decorators ?? [];
    const demand = record?.demand ?? [];
    const answer = record?.answer ?? [];
    const sourcePolicy = inferSourceCapabilityPolicy(sourcePath);
    const helperClass = classifyHelperVerb(name);
    const hasDecoratorSignal = decorators.some((decorator) => CAPABILITY_DECORATOR_PATTERN.test(decorator));
    const hasDomainSignal = hasDomainContract(demand, config) || hasDomainContract(answer, config);
    const hasWorkflowSignal = isWorkflowLikeName(name) || (className ? isWorkflowLikeName(className) : false);
    const hasFrontendSignal = hasFrontendSurfaceCapabilitySignal(name, sourcePath, className);
    const hasAgentSignal = hasAgentCapabilitySignal(name, sourcePath, className, demand, answer);
    const hasCliSignal = hasCliCapabilitySignal(name, sourcePath, className, demand, answer);
    const isExecuteLike = isExecuteLikeMethodName(name);
    const isSuppressedOwner = isSuppressedPromotionOwner(className);
    const evidenceReasons = derivePromotionEvidenceReasons(name, sourcePath, className, demand, answer, decorators);

    if (isSuppressedOwner) {
        return false;
    }
    if (evidenceReasons.length < 2) {
        return false;
    }
    if (isExecuteLike && !hasDomainSignal && !hasDecoratorSignal && !hasWorkflowSignal) {
        return false;
    }

    let score = 0;
    if (isExported || record?.isExported) score += 1;
    if (hasDecoratorSignal) score += 3;
    if (isPrimary) score += 1;
    if (hasWorkflowSignal) score += 2;
    if (hasFrontendSignal) score += 1;
    if (hasAgentSignal) score += 1;
    if (hasCliSignal) score += 1;
    if (isContainer && !isExecuteLike) score += 1;
    if (CAPABILITY_ACTION_PREFIXES.some((prefix) => hasNamePrefix(name, prefix))) score += 1;
    if (hasDomainSignal) score += 3;
    if (sourcePolicy === 'api' && hasCapabilityDecorator(record)) score += 2;
    if (sourcePolicy === 'ui' && (hasFrontendSignal || isExported || record?.isExported || hasWorkflowSignal)) score += 2;
    if (sourcePolicy === 'agent' && (hasAgentSignal || hasWorkflowSignal || isPrimary)) score += 2;
    if (sourcePolicy === 'cli' && (hasCliSignal || isPrimary || isExported || record?.isExported)) score += 2;
    if ((sourcePolicy === 'tasks' || sourcePolicy === 'nodes') && (isPrimary || hasWorkflowSignal)) score += 2;
    if (sourcePolicy === 'services' && (hasDomainSignal || hasWorkflowSignal)) score += 1;
    if (sourcePolicy === 'utils' && UTILS_ALLOWED_CAPABILITY_PREFIXES.some((prefix) => hasNamePrefix(name, prefix))) score += 1;
    if (helperClass === 'conditional') score -= 2;
    if (hasOnlyGenericContracts([...demand, ...answer], config)) score -= 3;
    if (isExecuteLike) score -= 3;

    const threshold = config?.parser.capabilityThreshold ?? 4;
    const promoted = score >= threshold;
    if (promoted && record) {
        record.promotionReasons = evidenceReasons;
    }
    return promoted;
}

function isSuppressedPromotionOwner(className?: string) {
    if (!className) {
        return false;
    }
    return /(base|abstract|container|wrapper)/i.test(className);
}

function derivePromotionEvidenceReasons(
    methodName: string,
    sourcePath: string,
    className: string | undefined,
    demand: string[],
    answer: string[],
    decorators: string[]
) {
    const reasons: string[] = [];
    if (hasDomainContract(demand, ACTIVE_PARSER_CONFIG) || hasDomainContract(answer, ACTIVE_PARSER_CONFIG)) {
        reasons.push('external_contract');
    }
    if (decorators.some((decorator) => CAPABILITY_DECORATOR_PATTERN.test(decorator)) || isWorkflowLikeName(methodName)) {
        reasons.push('runtime_signal');
    }
    if (hasFrontendSurfaceCapabilitySignal(methodName, sourcePath, className)) {
        reasons.push('frontend_surface');
    }
    if (hasAgentCapabilitySignal(methodName, sourcePath, className, demand, answer)) {
        reasons.push('agent_flow');
    }
    if (hasCliCapabilitySignal(methodName, sourcePath, className, demand, answer)) {
        reasons.push('cli_entrypoint');
    }
    if (hasBusinessSemanticSignal(methodName, className, sourcePath)) {
        reasons.push('business_semantic');
    }
    if (hasCrossModuleCallSignal(demand)) {
        reasons.push('cross_module_call');
    }
    return dedupeStringEntries(reasons);
}

function hasBusinessSemanticSignal(methodName: string, className: string | undefined, sourcePath: string) {
    const tokens = tokenizeSemanticName(`${methodName} ${className ?? ''} ${getSemanticSourcePathTail(sourcePath)}`);
    const meaningfulTokens = tokens.filter((token) => !GENERIC_SUBJECT_TOKENS.has(token) && !GENERIC_METHOD_TOKENS.has(token));
    return meaningfulTokens.length >= 2;
}

function hasFrontendSurfaceCapabilitySignal(methodName: string, sourcePath: string, className?: string) {
    const normalizedPath = normalizePath(String(sourcePath ?? '')).toLowerCase();
    if (!isLikelyUiSourcePath(normalizedPath, normalizedPath.split('/').filter(Boolean))) {
        return false;
    }

    const semanticText = `${methodName} ${className ?? ''} ${getSemanticSourcePathTail(sourcePath)}`;
    return (
        /^use[A-Z0-9_]/.test(methodName) ||
        /^render[A-Z0-9_]/.test(methodName) ||
        /(page|layout|provider|store|query|mutation|dashboard|screen|view|form|modal|dialog|panel|widget|table|chart|route)/i.test(
            semanticText
        ) ||
        /(^|\/)(page|layout|route|loading|error)\.(tsx|jsx|ts|js)$/.test(normalizedPath)
    );
}

function hasAgentCapabilitySignal(
    methodName: string,
    sourcePath: string,
    className?: string,
    demand: string[] = [],
    answer: string[] = []
) {
    const normalizedPath = normalizePath(String(sourcePath ?? '')).toLowerCase();
    if (!isLikelyAgentSourcePath(normalizedPath, normalizedPath.split('/').filter(Boolean))) {
        return false;
    }

    const semanticText = `${methodName} ${className ?? ''} ${getSemanticSourcePathTail(sourcePath)} ${getFirstDomainContractName([
        ...answer,
        ...demand
    ])}`;
    return /(agent|chat|conversation|orchestr|planner|tool|function|memory|session|assistant|reasoning|router)/i.test(
        semanticText
    );
}

function hasCliCapabilitySignal(
    methodName: string,
    sourcePath: string,
    className?: string,
    demand: string[] = [],
    answer: string[] = []
) {
    const normalizedPath = normalizePath(String(sourcePath ?? '')).toLowerCase();
    if (!isLikelyCliSourcePath(normalizedPath, normalizedPath.split('/').filter(Boolean))) {
        return false;
    }

    const semanticText = `${methodName} ${className ?? ''} ${getSemanticSourcePathTail(sourcePath)} ${getFirstDomainContractName([
        ...answer,
        ...demand
    ])}`;
    return /(cli|command|subcommand|argv|option|flag|serve|start|deploy|init|main|entry|program)/i.test(semanticText);
}

function hasCrossModuleCallSignal(demand: string[]) {
    return demand
        .filter((entry) => /^\[Ghost:/i.test(String(entry ?? '').trim()))
        .some((entry) => {
            const parsed = parseGhostDemandEntry(entry);
            if (/^(self|this|ctx|context|state|data)$/i.test(parsed.target)) {
                return false;
            }
            return (
                parsed.target.includes('.') ||
                isRuntimeResourceTarget(parsed.target) ||
                !isUnknownLikeType(parsed.valueType)
            );
        });
}

function isWorkflowLikeName(value: string) {
    return /(workflow|pipeline|stage|step|transition|handler|controller|service|adapter|gateway|tool|worker|operator|kernel|agent|command|consumer|endpoint)/i.test(value);
}

function hasDomainContract(entries: string[], config?: TriadConfig) {
    return entries.some((entry) => {
        const typeText = extractContractTypeText(entry);
        return Boolean(typeText) && !isIgnoredContractType(typeText, config);
    });
}

function hasOnlyGenericContracts(entries: string[], config?: TriadConfig) {
    const typeTexts = entries
        .map((entry) => extractContractTypeText(entry))
        .filter((entry): entry is string => Boolean(entry));
    return typeTexts.length > 0 && typeTexts.every((entry) => isIgnoredContractType(entry, config));
}

function isExecuteLikeMethodName(value: string) {
    return EXECUTE_LIKE_METHOD_PATTERN.test(String(value ?? '').trim());
}

function extractContractTypeText(entry: string) {
    const raw = String(entry ?? '')
        .trim()
        .replace(/^\[Generic\]\s*/i, '')
        .replace(/^\[Ghost:[^\]]+\]\s*/i, '');
    if (!raw || /^(none|void|null|undefined)$/i.test(raw)) {
        return '';
    }

    const match = raw.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
    return (match ? match[1] : raw).trim();
}

function isIgnoredContractType(value: string, config?: TriadConfig) {
    const compact = value.toLowerCase().replace(/^typing\./, '').replace(/\s+/g, '');
    const configured = new Set(
        (config?.parser.genericContractIgnoreList ?? []).map((entry) => entry.toLowerCase().replace(/\s+/g, ''))
    );
    return configured.has(compact) || isGenericContractType(value);
}

function isJavaScriptNoiseCapability(name: string, config?: TriadConfig, sourcePath = '', record?: CapabilityCandidateRecord) {
    return isSuppressedCapabilityCandidate(
        name,
        sourcePath,
        config,
        record,
        isJavaScriptPrimaryCapabilityMethod(name, config),
        JAVASCRIPT_MAGIC_METHODS
    );
}

function isTypeScriptNoiseCapability(name: string, config?: TriadConfig, sourcePath = '', record?: CapabilityCandidateRecord) {
    return isSuppressedCapabilityCandidate(
        name,
        sourcePath,
        config,
        record,
        isTypeScriptPrimaryCapabilityMethod(name, config),
        TYPESCRIPT_MAGIC_METHODS
    );
}

function isTypeScriptPrimaryCapabilityMethod(name: string, config?: TriadConfig) {
    return (
        isConfiguredPrimaryCapabilityMethod(name, config) ||
        TYPESCRIPT_PRIMARY_CAPABILITY_PREFIXES.some((prefix) => hasNamePrefix(name, prefix) || name === prefix)
    );
}

function isTypeScriptCapabilityContainer(className: string) {
    return TYPESCRIPT_CAPABILITY_CLASS_SUFFIXES.some((suffix) => className.endsWith(suffix));
}

function shouldPromoteTypeScriptCapability(
    name: string,
    sourcePath: string,
    className?: string,
    isExported = false,
    config?: TriadConfig,
    record?: CapabilityCandidateRecord
) {
    if (isTypeScriptNoiseCapability(name, config, sourcePath, record)) {
        return false;
    }

    return shouldPromoteCapabilityByScore(
        name,
        sourcePath,
        className,
        record,
        config,
        Boolean(className && isTypeScriptCapabilityContainer(className)),
        isTypeScriptPrimaryCapabilityMethod(name, config),
        isExported,
        TYPESCRIPT_MAGIC_METHODS
    );
}

function isJavaScriptPrimaryCapabilityMethod(name: string, config?: TriadConfig) {
    return (
        isConfiguredPrimaryCapabilityMethod(name, config) ||
        JAVASCRIPT_PRIMARY_CAPABILITY_PREFIXES.some((prefix) => hasNamePrefix(name, prefix) || name === prefix)
    );
}

function isJavaScriptCapabilityContainer(className: string) {
    return JAVASCRIPT_CAPABILITY_CLASS_SUFFIXES.some((suffix) => className.endsWith(suffix));
}

function shouldPromoteJavaScriptCapability(
    name: string,
    sourcePath: string,
    className?: string,
    isExported = false,
    config?: TriadConfig,
    record?: CapabilityCandidateRecord
) {
    if (isJavaScriptNoiseCapability(name, config, sourcePath, record)) {
        return false;
    }

    return shouldPromoteCapabilityByScore(
        name,
        sourcePath,
        className,
        record,
        config,
        Boolean(className && isJavaScriptCapabilityContainer(className)),
        isJavaScriptPrimaryCapabilityMethod(name, config),
        isExported,
        JAVASCRIPT_MAGIC_METHODS
    );
}

function isJavaNoiseCapability(name: string, config?: TriadConfig, sourcePath = '', record?: CapabilityCandidateRecord) {
    return isSuppressedCapabilityCandidate(
        name,
        sourcePath,
        config,
        record,
        isJavaPrimaryCapabilityMethod(name, config),
        JAVA_MAGIC_METHODS
    );
}

function isJavaPrimaryCapabilityMethod(name: string, config?: TriadConfig) {
    return (
        isConfiguredPrimaryCapabilityMethod(name, config) ||
        JAVA_PRIMARY_CAPABILITY_PREFIXES.some((prefix) => hasNamePrefix(name, prefix) || name === prefix)
    );
}

function isJavaCapabilityContainer(className: string) {
    return JAVA_CAPABILITY_CLASS_SUFFIXES.some((suffix) => className.endsWith(suffix));
}

function shouldPromoteJavaCapability(name: string, sourcePath: string, className?: string, config?: TriadConfig, record?: CapabilityCandidateRecord) {
    if (isJavaNoiseCapability(name, config, sourcePath, record)) {
        return false;
    }

    return shouldPromoteCapabilityByScore(
        name,
        sourcePath,
        className,
        record,
        config,
        Boolean(className && isJavaCapabilityContainer(className)),
        isJavaPrimaryCapabilityMethod(name, config),
        false,
        JAVA_MAGIC_METHODS
    );
}

function isGoNoiseCapability(name: string, config?: TriadConfig, sourcePath = '', record?: CapabilityCandidateRecord) {
    return isSuppressedCapabilityCandidate(
        name,
        sourcePath,
        config,
        record,
        isGoPrimaryCapabilityMethod(name, config),
        new Set<string>()
    );
}

function isGoPrimaryCapabilityMethod(name: string, config?: TriadConfig) {
    return (
        isConfiguredPrimaryCapabilityMethod(name, config) ||
        GO_PRIMARY_CAPABILITY_PREFIXES.some((prefix) => hasNamePrefix(name, prefix) || name === prefix)
    );
}

function isGoCapabilityContainer(typeName?: string) {
    return Boolean(typeName) && GO_CAPABILITY_TYPE_SUFFIXES.some((suffix) => typeName!.endsWith(suffix));
}

function shouldPromoteGoCapability(name: string, sourcePath: string, typeName?: string, config?: TriadConfig, record?: CapabilityCandidateRecord) {
    if (isGoNoiseCapability(name, config, sourcePath, record)) {
        return false;
    }

    return shouldPromoteCapabilityByScore(
        name,
        sourcePath,
        typeName,
        record,
        config,
        Boolean(isGoCapabilityContainer(typeName)),
        isGoPrimaryCapabilityMethod(name, config)
    );
}

function isRustNoiseCapability(name: string, config?: TriadConfig, sourcePath = '', record?: CapabilityCandidateRecord) {
    return isSuppressedCapabilityCandidate(
        name,
        sourcePath,
        config,
        record,
        isRustPrimaryCapabilityMethod(name, config),
        new Set<string>()
    );
}

function isRustPrimaryCapabilityMethod(name: string, config?: TriadConfig) {
    return (
        isConfiguredPrimaryCapabilityMethod(name, config) ||
        RUST_PRIMARY_CAPABILITY_PREFIXES.some((prefix) => hasNamePrefix(name, prefix) || name === prefix)
    );
}

function isRustCapabilityContainer(typeName?: string) {
    return Boolean(typeName) && RUST_CAPABILITY_TYPE_SUFFIXES.some((suffix) => typeName!.endsWith(suffix));
}

function shouldPromoteRustCapability(name: string, sourcePath: string, typeName?: string, config?: TriadConfig, record?: CapabilityCandidateRecord) {
    if (isRustNoiseCapability(name, config, sourcePath, record)) {
        return false;
    }

    return shouldPromoteCapabilityByScore(
        name,
        sourcePath,
        typeName,
        record,
        config,
        Boolean(isRustCapabilityContainer(typeName)),
        isRustPrimaryCapabilityMethod(name, config)
    );
}

function isCppNoiseCapability(name: string, config?: TriadConfig, sourcePath = '', record?: CapabilityCandidateRecord) {
    return isSuppressedCapabilityCandidate(
        name,
        sourcePath,
        config,
        record,
        isCppPrimaryCapabilityMethod(name, config),
        CPP_MAGIC_METHODS
    );
}

function isCppPrimaryCapabilityMethod(name: string, config?: TriadConfig) {
    return (
        isConfiguredPrimaryCapabilityMethod(name, config) ||
        CPP_PRIMARY_CAPABILITY_PREFIXES.some((prefix) => hasNamePrefix(name, prefix) || name === prefix)
    );
}

function isCppCapabilityContainer(typeName?: string) {
    return Boolean(typeName) && CPP_CAPABILITY_TYPE_SUFFIXES.some((suffix) => typeName!.endsWith(suffix));
}

function shouldPromoteCppCapability(name: string, sourcePath: string, typeName?: string, config?: TriadConfig, record?: CapabilityCandidateRecord) {
    if (isCppNoiseCapability(name, config, sourcePath, record)) {
        return false;
    }

    return shouldPromoteCapabilityByScore(
        name,
        sourcePath,
        typeName,
        record,
        config,
        Boolean(isCppCapabilityContainer(typeName)),
        isCppPrimaryCapabilityMethod(name, config),
        false,
        CPP_MAGIC_METHODS
    );
}

function hasNamePrefix(name: string, prefix: string) {
    const lowerName = name.trim().toLowerCase();
    const lowerPrefix = prefix.toLowerCase();
    return (
        lowerName === lowerPrefix ||
        lowerName.startsWith(`${lowerPrefix}_`) ||
        lowerName.startsWith(`${lowerPrefix}-`) ||
        lowerName.startsWith(lowerPrefix) && name.charAt(lowerPrefix.length) !== name.charAt(lowerPrefix.length).toLowerCase()
    );
}

function collectPythonCapabilityNodes(
    rootNode: Parser.SyntaxNode,
    filePath: string,
    sourcePath: string,
    category: string,
    config: TriadConfig,
    parsedFiles: ParsedSourceFile[]
) {
    const triadGraph: TriadNode[] = [];
    const moduleName = toPascalCase(path.basename(sourcePath).replace(/\.py$/, ''));
    const ghostContext = buildPythonGhostContext(rootNode, filePath, parsedFiles);

    for (const rootChild of rootNode.namedChildren) {
        const classNode = unwrapPythonDefinition(rootChild, 'class_definition');
        if (classNode) {
            triadGraph.push(...collectPythonClassCapabilityNodes(classNode, sourcePath, category, config, ghostContext));
        }
    }

    const topLevelRecords = rootNode.namedChildren
        .map((child) => unwrapPythonDefinition(child, 'function_definition'))
        .filter((node): node is Parser.SyntaxNode => Boolean(node))
        .map((node) => buildPythonExecutableRecord(node, ghostContext, moduleName));

    const promotableTopLevel = topLevelRecords.filter((record) => !isPythonNoiseCapability(record.name, config, sourcePath, record));
    const promotedTopLevel = promotableTopLevel.filter((record) =>
        shouldPromotePythonCapability(record.name, sourcePath, undefined, record.decorators, config, record)
    );

    for (const record of promotedTopLevel) {
        triadGraph.push(
            createTriadNode(
                `${moduleName}.${record.name}`,
                category,
                sourcePath,
                record.demand,
                record.answer,
                `execute ${moduleName}.${record.name} capability`
            )
        );
    }

    if (triadGraph.length === 0 && promotableTopLevel.length > 0) {
        triadGraph.push(
            createTriadNode(
                `${moduleName}.module_pipeline`,
                category,
                sourcePath,
                mergeCapabilityDemand(promotableTopLevel.map((record) => record.demand)),
                mergeCapabilityAnswer(promotableTopLevel.map((record) => record.answer)),
                `execute ${moduleName} module capability`
            )
        );
    }

    return triadGraph;
}

function collectPythonClassCapabilityNodes(
    classNode: Parser.SyntaxNode,
    sourcePath: string,
    category: string,
    config: TriadConfig,
    ghostContext: GhostBindingContext
) {
    const className = getNameText(classNode.childForFieldName('name'));
    const classBody = classNode.childForFieldName('body');
    if (!className || !classBody || isSuppressedCapabilityContainerName(className, config)) {
        return [];
    }

    const classPropertyTypes = collectPythonClassPropertyTypes(classNode, ghostContext);
    const records = getPythonFunctionDefinitions(classBody)
        .map((methodNode) => buildPythonExecutableRecord(methodNode, ghostContext, className, classPropertyTypes))
        .filter((record) => record.name !== '__init__');

    const promotable = records.filter((record) => !isPythonNoiseCapability(record.name, config, sourcePath, record));
    if (promotable.length === 0) {
        return [];
    }

    const entrypoint = promotable.find((record) => isPythonPrimaryCapabilityMethod(record.name, config));
    if (
        entrypoint &&
        shouldPromotePythonCapability(entrypoint.name, sourcePath, className, entrypoint.decorators, config, entrypoint)
    ) {
        const foldedRecords = getFoldableCapabilityRecords(records, promotable, config, PYTHON_MAGIC_METHODS);
        return [
            createTriadNode(
                `${className}.${entrypoint.name}`,
                category,
                sourcePath,
                mergeCapabilityDemand(foldedRecords.map((record) => record.demand)),
                mergeCapabilityAnswer(foldedRecords.map((record) => record.answer)),
                `execute ${className} capability pipeline`,
                buildFoldedLeafIds(className, foldedRecords)
            )
        ];
    }

    const capabilityMethods = promotable.filter((record) =>
        shouldPromotePythonCapability(record.name, sourcePath, className, record.decorators, config, record)
    );

    if (capabilityMethods.length > 0) {
        return capabilityMethods.map((record) =>
            createTriadNode(
                `${className}.${record.name}`,
                category,
                sourcePath,
                record.demand,
                record.answer,
                `execute ${className}.${record.name} capability`
            )
        );
    }

    if (isPythonCapabilityContainer(className)) {
        const foldedRecords = getFoldableCapabilityRecords(records, promotable, config, PYTHON_MAGIC_METHODS);
        return [
            createTriadNode(
                `${className}.capability`,
                category,
                sourcePath,
                mergeCapabilityDemand(foldedRecords.map((record) => record.demand)),
                mergeCapabilityAnswer(foldedRecords.map((record) => record.answer)),
                `execute ${className} aggregate capability`,
                buildFoldedLeafIds(className, foldedRecords)
            )
        ];
    }

    return [];
}

function unwrapPythonDefinition(
    node: Parser.SyntaxNode,
    expectedType: 'class_definition' | 'function_definition'
): Parser.SyntaxNode | null {
    if (node.type === expectedType) {
        return node;
    }

    if (node.type === 'decorated_definition') {
        return node.namedChildren.find((child) => child.type === expectedType) ?? null;
    }

    return null;
}

function getPythonFunctionDefinitions(parentNode: Parser.SyntaxNode) {
    return parentNode.namedChildren
        .map((child) => unwrapPythonDefinition(child, 'function_definition'))
        .filter((node): node is Parser.SyntaxNode => Boolean(node));
}

function buildPythonExecutableRecord(
    executableNode: Parser.SyntaxNode,
    ghostContext: GhostBindingContext,
    ownerName: string,
    classPropertyTypes?: Map<string, string>
) {
    const name = getNameText(executableNode.childForFieldName('name')) ?? 'execute';
    const decorators = getPythonDecorators(executableNode);
    const ghostDemand = collectPythonGhostDemand(executableNode, ghostContext, classPropertyTypes);
    return {
        name,
        decorators,
        demand: mergeDemandEntries(parsePythonParametersAst(executableNode.childForFieldName('parameters')), ghostDemand),
        answer: [extractPythonReturnType(executableNode)],
        ownerName
    };
}

function getPythonDecorators(executableNode: Parser.SyntaxNode) {
    const decoratedDefinition = executableNode.parent?.type === 'decorated_definition' ? executableNode.parent : null;
    return (decoratedDefinition?.namedChildren ?? [])
        .filter((child) => child.type === 'decorator')
        .map((child) => child.text.replace(/^@/, '').trim())
        .filter(Boolean);
}

const PYTHON_MAGIC_METHODS = new Set([
    '__str__',
    '__repr__',
    '__enter__',
    '__exit__',
    '__aenter__',
    '__aexit__',
    '__iter__',
    '__next__',
    '__len__',
    '__bool__',
    '__hash__',
    '__eq__'
]);

const PYTHON_HELPER_PREFIXES = [
    '_',
    'get',
    'set',
    'build',
    'parse',
    'format',
    'normalize',
    'sanitize',
    'validate',
    'ensure',
    'create',
    'load',
    'save',
    'list',
    'collect',
    'resolve',
    'prepare',
    'read',
    'write',
    'convert',
    'sync',
    'merge',
    'filter',
    'check',
    'infer',
    'guess',
    'serialize',
    'deserialize',
    'cache',
    'path',
    'dump',
    'helper'
];

const PYTHON_PRIMARY_CAPABILITY_PREFIXES = [
    'execute',
    'run',
    'handle',
    'process',
    'invoke',
    'dispatch',
    'orchestrate',
    'apply',
    'plan',
    'schedule'
];

const PYTHON_CAPABILITY_CLASS_SUFFIXES = [
    'Service',
    'Node',
    'Workflow',
    'Pipeline',
    'Step',
    'Handler',
    'Controller',
    'Tool',
    'Agent',
    'Manager'
];

function isPythonNoiseCapability(name: string, config?: TriadConfig, sourcePath = '', record?: CapabilityCandidateRecord) {
    return isSuppressedCapabilityCandidate(
        name,
        sourcePath,
        config,
        record,
        isPythonPrimaryCapabilityMethod(name, config),
        PYTHON_MAGIC_METHODS
    );
}

function isPythonPrimaryCapabilityMethod(name: string, config?: TriadConfig) {
    const lowerName = name.trim().toLowerCase();
    return (
        isConfiguredPrimaryCapabilityMethod(name, config) ||
        PYTHON_PRIMARY_CAPABILITY_PREFIXES.some((prefix) => lowerName === prefix || lowerName.startsWith(`${prefix}_`))
    );
}

function isPythonCapabilityContainer(className: string) {
    return PYTHON_CAPABILITY_CLASS_SUFFIXES.some((suffix) => className.endsWith(suffix));
}

function shouldPromotePythonCapability(
    name: string,
    sourcePath: string,
    className?: string,
    decorators: string[] = [],
    config?: TriadConfig,
    record?: CapabilityCandidateRecord
) {
    if (isPythonNoiseCapability(name, config, sourcePath, { ...record, decorators })) {
        return false;
    }

    return shouldPromoteCapabilityByScore(
        name,
        sourcePath,
        className,
        { ...record, decorators },
        config,
        Boolean(className && isPythonCapabilityContainer(className)),
        isPythonPrimaryCapabilityMethod(name, config),
        false,
        PYTHON_MAGIC_METHODS
    );
}

function mergeCapabilityDemand(demandGroups: string[][]) {
    return mergeCapabilityEntries(demandGroups, 'None');
}

function mergeCapabilityAnswer(answerGroups: string[][]) {
    return mergeCapabilityEntries(answerGroups, 'void');
}

function mergeCapabilityEntries(groups: string[][], fallback: string) {
    const merged: string[] = [];
    const seen = new Set<string>();

    for (const entry of groups.flat()) {
        const trimmed = String(entry ?? '').trim();
        if (!trimmed || trimmed.toLowerCase() === fallback.toLowerCase()) {
            continue;
        }

        if (!seen.has(trimmed)) {
            seen.add(trimmed);
            merged.push(trimmed);
        }
    }

    return merged.length > 0 ? merged : [fallback];
}

function buildPythonGhostContext(rootNode: Parser.SyntaxNode, filePath: string, parsedFiles: ParsedSourceFile[]) {
    return {
        importedBindings: collectPythonImportedBindings(rootNode, filePath, parsedFiles),
        moduleBindings: collectPythonModuleBindings(rootNode)
    };
}

function collectPythonImportedBindings(
    rootNode: Parser.SyntaxNode,
    filePath: string,
    parsedFiles: ParsedSourceFile[]
) {
    const bindings = new Map<string, BindingInfo>();

    for (const importFrom of rootNode.descendantsOfType('import_from_statement')) {
        const moduleNode = importFrom.namedChildren.find((node) => node.type === 'dotted_name');
        const modulePath = moduleNode?.text ?? '';
        const targetFile = resolvePythonImportedParsedFile(filePath, modulePath, parsedFiles);
        for (const child of importFrom.namedChildren.slice(1)) {
            if (child.type === 'dotted_name') {
                const localName = child.text;
                if (localName) {
                    bindings.set(localName, resolvePythonImportedBindingInfo(targetFile, localName));
                }
                continue;
            }

            if (child.type === 'aliased_import') {
                const importedNode = child.namedChildren.find((node) => node.type === 'dotted_name') ?? null;
                const aliasNode = child.namedChildren.find((node) => node.type === 'identifier') ?? null;
                const importedName = importedNode?.text ?? '';
                const localName = aliasNode?.text ?? importedName;
                if (localName) {
                    bindings.set(localName, resolvePythonImportedBindingInfo(targetFile, importedName || localName));
                }
            }
        }
    }

    for (const importStatement of rootNode.descendantsOfType('import_statement')) {
        for (const child of importStatement.namedChildren) {
            if (child.type === 'aliased_import') {
                const moduleNode = child.namedChildren.find((node) => node.type === 'dotted_name');
                const aliasNode = child.namedChildren.find((node) => node.type === 'identifier');
                const localName = aliasNode?.text ?? moduleNode?.text.split('.').pop() ?? '';
                if (!localName) {
                    continue;
                }

                bindings.set(localName, createModuleBinding());
                continue;
            }

            if (child.type === 'dotted_name') {
                const localName = child.text.split('.').pop() ?? '';
                if (!localName) {
                    continue;
                }

                bindings.set(localName, createModuleBinding());
            }
        }
    }

    return bindings;
}

function collectPythonModuleBindings(rootNode: Parser.SyntaxNode) {
    const bindings = new Map<string, BindingInfo>();

    for (const child of rootNode.namedChildren) {
        if (child.type === 'function_definition') {
            const localName = getNameText(child.childForFieldName('name'));
            if (localName) {
                bindings.set(localName, createCallableBinding(localName, extractPythonReturnType(child)));
            }
            continue;
        }

        if (child.type === 'class_definition') {
            const localName = getNameText(child.childForFieldName('name'));
            if (localName) {
                bindings.set(localName, createValueBinding(localName));
            }
            continue;
        }

        if (child.type === 'expression_statement') {
            const assignmentNode = child.namedChildren.find((node) => node.type === 'assignment');
            if (!assignmentNode) {
                continue;
            }

            const leftNode = assignmentNode.childForFieldName('left') ?? assignmentNode.namedChildren[0] ?? null;
            const localName = extractBindingNames(leftNode)[0];
            if (!localName) {
                continue;
            }

            bindings.set(localName, createValueBinding(inferPythonAssignmentType(assignmentNode, localName, {
                importedBindings: new Map<string, BindingInfo>(),
                moduleBindings: bindings
            })));
        }
    }

    return bindings;
}

function collectPythonClassPropertyTypes(
    classNode: Parser.SyntaxNode,
    ghostContext: GhostBindingContext
) {
    const propertyTypes = new Map<string, string>();
    const classBody = classNode.childForFieldName('body');
    if (!classBody) {
        return propertyTypes;
    }

    for (const child of classBody.namedChildren) {
        if (child.type === 'expression_statement') {
            const assignmentNode = child.namedChildren.find((node) => node.type === 'assignment');
            if (!assignmentNode) {
                continue;
            }

            const leftNode = assignmentNode.childForFieldName('left') ?? assignmentNode.namedChildren[0] ?? null;
            const propertyName = extractBindingNames(leftNode)[0];
            if (!propertyName) {
                continue;
            }

            propertyTypes.set(propertyName, inferPythonAssignmentType(assignmentNode, propertyName, ghostContext));
            continue;
        }

        if (child.type === 'function_definition' && getNameText(child.childForFieldName('name')) === '__init__') {
            const initBody = child.childForFieldName('body');
            if (!initBody) {
                continue;
            }

            for (const stmt of initBody.namedChildren.filter((node) => node.type === 'expression_statement')) {
                const assignmentNode = stmt.namedChildren.find((node) => node.type === 'assignment');
                if (!assignmentNode) {
                    continue;
                }

                const leftNode = assignmentNode.childForFieldName('left') ?? assignmentNode.namedChildren[0] ?? null;
                if (!leftNode || leftNode.type !== 'attribute') {
                    continue;
                }

                const rootNode = leftNode.namedChildren[0] ?? null;
                const propertyNode = leftNode.namedChildren[1] ?? null;
                if (!rootNode || rootNode.text !== 'self' || !propertyNode) {
                    continue;
                }

                const propertyName = getNameText(propertyNode);
                if (!propertyName) {
                    continue;
                }

                if (propertyTypes.has(propertyName)) {
                    continue;
                }

                propertyTypes.set(propertyName, inferPythonAssignmentType(assignmentNode, propertyName, ghostContext));
            }
        }
    }

    return propertyTypes;
}

function collectPythonGhostDemand(
    executableNode: Parser.SyntaxNode,
    ghostContext: GhostBindingContext,
    classPropertyTypes = new Map<string, string>()
) {
    const ghostStates = new Map<string, { typeName: string; read: boolean; write: boolean }>();

    for (const reference of scanTreeSitterGhostReferences(executableNode, {
        localDeclarationNodes: ['assignment', 'for_statement', 'for_in_clause', 'with_item'],
        memberExpressionNodes: ['attribute', 'subscript'],
        functionBodyNodes: ['block'],
        selfNames: ['self', 'cls']
    })) {
        if (reference.kind === 'self') {
            const propertyName = reference.propertyName ?? reference.rootName;
            const typeName = classPropertyTypes.get(propertyName) ?? 'unknown';
            registerGhostState(ghostStates, reference.label, typeName, reference.mode);
            continue;
        }

        const binding = ghostContext.importedBindings.get(reference.rootName) ?? ghostContext.moduleBindings.get(reference.rootName);
        if (!binding) {
            continue;
        }

        registerGhostState(ghostStates, reference.label, binding.typeName, reference.mode);
    }

    return Array.from(ghostStates.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([label, state]) => {
            if (state.read && state.write) {
                return `[Ghost:ReadWrite] ${state.typeName} (${label})`;
            }
            if (state.write) {
                return `[Ghost:Write] ${state.typeName} (${label})`;
            }
            return `[Ghost:Read] ${state.typeName} (${label})`;
        });
}

function resolvePythonImportedParsedFile(
    currentFilePath: string,
    importPath: string,
    parsedFiles: ParsedSourceFile[]
) {
    if (!importPath) {
        return undefined;
    }

    const modulePath = importPath.replace(/\./g, path.sep);
    const relativeCandidates = [
        `${modulePath}.py`,
        path.join(modulePath, '__init__.py')
    ].map((candidate) => path.normalize(candidate));

    const siblingCandidates = relativeCandidates.map((candidate) => path.normalize(path.join(path.dirname(currentFilePath), candidate)));

    return parsedFiles.find((entry) => {
        const normalized = path.normalize(entry.filePath);
        return siblingCandidates.includes(normalized) || relativeCandidates.some((candidate) => normalized.endsWith(candidate));
    });
}

function resolvePythonImportedBindingInfo(targetFile: ParsedSourceFile | undefined, bindingName: string) {
    if (!targetFile) {
        return createValueBinding(bindingName);
    }

    return lookupPythonExportedBindingInfo(targetFile.rootNode, bindingName) ?? createValueBinding(bindingName);
}

function lookupPythonExportedBindingInfo(rootNode: Parser.SyntaxNode, bindingName: string): BindingInfo | undefined {
    for (const child of rootNode.namedChildren) {
        if (child.type === 'class_definition') {
            const name = getNameText(child.childForFieldName('name'));
            if (name === bindingName) {
                return createValueBinding(name);
            }
            continue;
        }

        if (child.type === 'function_definition') {
            const name = getNameText(child.childForFieldName('name'));
            if (name === bindingName) {
                return createCallableBinding(name, extractPythonReturnType(child));
            }
            continue;
        }

        if (child.type === 'expression_statement') {
            const assignmentNode = child.namedChildren.find((node) => node.type === 'assignment');
            if (!assignmentNode) {
                continue;
            }

            const leftNode = assignmentNode.childForFieldName('left') ?? assignmentNode.namedChildren[0] ?? null;
            const name = extractBindingNames(leftNode)[0];
            if (name === bindingName) {
                return createValueBinding(inferPythonAssignmentType(assignmentNode, bindingName));
            }
        }
    }

    return undefined;
}

function inferPythonAssignmentType(
    assignmentNode: Parser.SyntaxNode,
    fallbackName: string,
    ghostContext?: GhostBindingContext
) {
    const leftNode = assignmentNode.childForFieldName('left') ?? assignmentNode.namedChildren[0] ?? null;
    const rightNode = assignmentNode.childForFieldName('right') ?? assignmentNode.namedChildren[1] ?? null;
    const explicitTypeNode = assignmentNode.namedChildren.find((node) => node.type === 'type') ?? null;

    if (explicitTypeNode) {
        return normalizeTypeText(explicitTypeNode.text);
    }

    return inferPythonValueType(rightNode, fallbackName, ghostContext, leftNode);
}

function inferPythonValueType(
    valueNode: Parser.SyntaxNode | null,
    fallbackName: string,
    ghostContext?: GhostBindingContext,
    leftNode?: Parser.SyntaxNode | null
) {
    if (!valueNode) {
        return guessBindingTypeFromName(fallbackName);
    }

    if (valueNode.type === 'dictionary') {
        const fields: string[] = [];
        for (const pair of valueNode.namedChildren.filter((node) => node.type === 'pair')) {
            const key = pair.namedChildren[0]?.text.replace(/^['"]|['"]$/g, '') ?? '';
            const val = pair.namedChildren[1] ?? null;
            if (key) {
                fields.push(`${key}: ${inferPythonValueType(val, key, ghostContext)}`);
            }
        }
        return fields.length > 0 ? `{ ${fields.join('; ')} }` : 'dict';
    }

    if (valueNode.type === 'list' || valueNode.type === 'tuple') {
        return 'list';
    }

    if (valueNode.type === 'string') {
        return 'str';
    }

    if (valueNode.type === 'integer' || valueNode.type === 'float') {
        return 'number';
    }

    if (valueNode.type === 'true' || valueNode.type === 'false') {
        return 'bool';
    }

    if (valueNode.type === 'identifier') {
        const binding = ghostContext?.importedBindings.get(valueNode.text) ?? ghostContext?.moduleBindings.get(valueNode.text);
        return resolveBindingValueType(binding, valueNode.text);
    }

    if (valueNode.type === 'attribute') {
        const rootName = getNameText(valueNode.namedChildren[0] ?? null);
        const propertyName = getNameText(valueNode.namedChildren[1] ?? null);
        const binding = ghostContext?.importedBindings.get(rootName) ?? ghostContext?.moduleBindings.get(rootName);
        return binding?.typeName === 'module'
            ? guessBindingTypeFromName(propertyName || rootName || fallbackName)
            : resolveBindingValueType(binding, rootName || fallbackName);
    }

    if (valueNode.type === 'call') {
        const callee = valueNode.namedChildren[0] ?? null;
        const calleeName = getNameText(callee);
        const binding = calleeName
            ? ghostContext?.importedBindings.get(calleeName) ?? ghostContext?.moduleBindings.get(calleeName)
            : undefined;
        return resolveBindingValueType(binding, calleeName || fallbackName);
    }

    if (leftNode?.type === 'attribute') {
        const propertyName = getNameText(leftNode.namedChildren[1] ?? null);
        if (propertyName) {
            return guessBindingTypeFromName(propertyName);
        }
    }

    return guessBindingTypeFromName(fallbackName);
}

function buildGoGhostContext(rootNode: Parser.SyntaxNode, filePath: string, parsedFiles: ParsedSourceFile[]) {
    return {
        importedBindings: collectGoImportedBindings(rootNode, filePath, parsedFiles),
        moduleBindings: collectGoModuleBindings(rootNode)
    };
}

function collectGoImportedBindings(
    rootNode: Parser.SyntaxNode,
    _filePath: string,
    _parsedFiles: ParsedSourceFile[]
) {
    const bindings = new Map<string, BindingInfo>();

    for (const importDeclaration of rootNode.descendantsOfType('import_declaration')) {
        for (const importSpec of importDeclaration.descendantsOfType('import_spec')) {
            const aliasNode = importSpec.namedChildren.find((node) => node.type === 'package_identifier');
            const moduleNode = importSpec.namedChildren.find(
                (node) => node.type === 'interpreted_string_literal' || node.type === 'raw_string_literal'
            );
            const modulePath = stripQuotedLiteral(moduleNode?.text ?? '');
            const localName = aliasNode?.text || modulePath.split('/').pop() || '';
            if (!localName || localName === '_' || localName === '.') {
                continue;
            }

            bindings.set(localName, {
                typeName: 'module'
            });
        }
    }

    return bindings;
}

function collectGoModuleBindings(rootNode: Parser.SyntaxNode) {
    const bindings = new Map<string, BindingInfo>();

    for (const child of rootNode.namedChildren) {
        if (child.type === 'function_declaration') {
            const localName = getNameText(child.childForFieldName('name'));
            if (localName) {
                bindings.set(localName, createCallableBinding(localName, extractGoReturnType(child)));
            }
            continue;
        }

        if (child.type === 'type_declaration') {
            for (const typeSpec of child.namedChildren.filter((node) => node.type === 'type_spec')) {
                const localName = getNameText(typeSpec.namedChildren.find((node) => node.type === 'type_identifier') ?? null);
                if (localName) {
                    bindings.set(localName, createValueBinding(localName));
                }
            }
            continue;
        }
    }

    for (const child of rootNode.namedChildren) {
        if (child.type !== 'var_declaration' && child.type !== 'const_declaration') {
            continue;
        }

        for (const specNode of child.namedChildren.filter((node) => node.type === 'var_spec' || node.type === 'const_spec')) {
            const nameNodes = specNode.namedChildren.filter((node) => node.type === 'identifier');
            if (nameNodes.length === 0) {
                continue;
            }

            const typeName = inferGoBindingType(specNode, nameNodes[0]?.text ?? 'unknown', bindings);
            for (const nameNode of nameNodes) {
                bindings.set(nameNode.text, createValueBinding(typeName));
            }
        }
    }

    return bindings;
}

function collectGoStructPropertyTypes(rootNode: Parser.SyntaxNode, receiverType: string) {
    const propertyTypes = new Map<string, string>();
    if (!receiverType) {
        return propertyTypes;
    }

    for (const typeDeclaration of rootNode.namedChildren.filter((node) => node.type === 'type_declaration')) {
        for (const typeSpec of typeDeclaration.namedChildren.filter((node) => node.type === 'type_spec')) {
            const typeName = getNameText(typeSpec.namedChildren.find((node) => node.type === 'type_identifier') ?? null);
            if (typeName !== receiverType) {
                continue;
            }

            const structNode = typeSpec.namedChildren.find((node) => node.type === 'struct_type');
            const fieldList = structNode?.namedChildren.find((node) => node.type === 'field_declaration_list') ?? null;
            if (!fieldList) {
                continue;
            }

            for (const fieldNode of fieldList.namedChildren.filter((node) => node.type === 'field_declaration')) {
                const fieldNames = fieldNode.namedChildren.filter((node) => node.type === 'field_identifier');
                const typeNode = [...fieldNode.namedChildren]
                    .reverse()
                    .find((node) => node.type !== 'field_identifier');
                const typeNameText = normalizeTypeText(typeNode?.text ?? 'unknown');
                for (const fieldName of fieldNames) {
                    propertyTypes.set(fieldName.text, typeNameText);
                }
            }
        }
    }

    return propertyTypes;
}

function collectGoGhostDemand(
    executableNode: Parser.SyntaxNode,
    ghostContext: GhostBindingContext,
    classPropertyTypes = new Map<string, string>(),
    receiverBindingName = ''
) {
    const ghostStates = new Map<string, { typeName: string; read: boolean; write: boolean }>();
    const selfNames = receiverBindingName ? [receiverBindingName] : [];

    for (const reference of scanTreeSitterGhostReferences(executableNode, {
        localDeclarationNodes: ['short_var_declaration', 'var_spec', 'const_spec', 'range_clause'],
        memberExpressionNodes: ['selector_expression'],
        functionBodyNodes: ['block'],
        selfNames
    })) {
        if (reference.kind === 'self') {
            const propertyName = reference.propertyName ?? reference.rootName;
            const typeName = classPropertyTypes.get(propertyName) ?? 'unknown';
            registerGhostState(ghostStates, reference.label, typeName, reference.mode);
            continue;
        }

        const binding = ghostContext.importedBindings.get(reference.rootName) ?? ghostContext.moduleBindings.get(reference.rootName);
        if (!binding) {
            continue;
        }

        registerGhostState(ghostStates, reference.label, binding.typeName, reference.mode);
    }

    return Array.from(ghostStates.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([label, state]) => {
            if (state.read && state.write) {
                return `[Ghost:ReadWrite] ${state.typeName} (${label})`;
            }
            if (state.write) {
                return `[Ghost:Write] ${state.typeName} (${label})`;
            }
            return `[Ghost:Read] ${state.typeName} (${label})`;
        });
}

function inferGoBindingType(specNode: Parser.SyntaxNode, fallbackName: string, bindings?: Map<string, BindingInfo>) {
    const namedChildren = specNode.namedChildren;
    const explicitTypeNode = namedChildren.find(
        (node) =>
            node.type !== 'identifier' &&
            node.type !== 'expression_list' &&
            node.type !== 'interpreted_string_literal' &&
            node.type !== 'raw_string_literal'
    );
    if (explicitTypeNode) {
        return normalizeTypeText(explicitTypeNode.text);
    }

    const expressionList = namedChildren.find((node) => node.type === 'expression_list') ?? null;
    const valueNode = expressionList?.namedChildren[0] ?? null;
    if (!valueNode) {
        return guessBindingTypeFromName(fallbackName);
    }

    if (valueNode.type === 'composite_literal') {
        return normalizeTypeText(valueNode.namedChildren[0]?.text ?? fallbackName);
    }

    if (valueNode.type === 'call_expression') {
        const calleeName = getNameText(valueNode.namedChildren[0] ?? null) || fallbackName;
        return resolveBindingValueType(bindings?.get(calleeName), calleeName);
    }

    if (valueNode.type === 'identifier') {
        return resolveBindingValueType(bindings?.get(valueNode.text), valueNode.text);
    }

    if (valueNode.type === 'selector_expression') {
        const rootName = getNameText(valueNode.namedChildren[0] ?? null);
        const propertyName = getNameText(valueNode.namedChildren[1] ?? null);
        const binding = rootName ? bindings?.get(rootName) : undefined;
        return binding?.typeName === 'module'
            ? guessBindingTypeFromName(propertyName || rootName || fallbackName)
            : resolveBindingValueType(binding, propertyName || rootName || fallbackName);
    }

    return guessBindingTypeFromName(fallbackName);
}

function extractGoReceiverBindingName(receiverNode: Parser.SyntaxNode | null) {
    if (!receiverNode) {
        return '';
    }

    const match = receiverNode.text.replace(/[()]/g, '').trim().match(/^([A-Za-z_]\w*)\b/);
    return match?.[1] ?? '';
}

function collectGoNodes(
    rootNode: Parser.SyntaxNode,
    filePath: string,
    sourcePath: string,
    category: string,
    config: TriadConfig,
    parsedFiles: ParsedSourceFile[]
) {
    if (config.parser.scanMode === 'capability' || config.parser.scanMode === 'module' || config.parser.scanMode === 'domain') {
        return collectGoCapabilityNodes(rootNode, filePath, sourcePath, category, config, parsedFiles);
    }

    return collectGoLeafNodes(rootNode, filePath, sourcePath, category, parsedFiles);
}

function collectGoLeafNodes(
    rootNode: Parser.SyntaxNode,
    filePath: string,
    sourcePath: string,
    category: string,
    parsedFiles: ParsedSourceFile[]
) {
    const triadGraph: TriadNode[] = [];
    const moduleName = toPascalCase(path.basename(sourcePath).replace(/\.go$/, ''));
    const ghostContext = buildGoGhostContext(rootNode, filePath, parsedFiles);

    for (const node of rootNode.namedChildren) {
        if (node.type === 'method_declaration') {
            const receiver = node.childForFieldName('receiver') ?? node.namedChildren[0];
            const receiverType = extractGoReceiverType(receiver);
            const methodName = getNameText(node.childForFieldName('name'));
            if (!receiverType || !methodName) {
                continue;
            }

            const receiverBindingName = extractGoReceiverBindingName(receiver);
            const classPropertyTypes = collectGoStructPropertyTypes(rootNode, receiverType);
            const ghostDemand = collectGoGhostDemand(node, ghostContext, classPropertyTypes, receiverBindingName);
            triadGraph.push(
                createTriadNode(
                    `${receiverType}.${methodName}`,
                    category,
                    sourcePath,
                    mergeDemandEntries(parseGoParametersAst(node.childForFieldName('parameters')), ghostDemand),
                    [extractGoReturnType(node)]
                )
            );
            continue;
        }

        if (node.type === 'function_declaration') {
            const functionName = getNameText(node.childForFieldName('name'));
            if (!functionName) {
                continue;
            }

            const ghostDemand = collectGoGhostDemand(node, ghostContext);
            triadGraph.push(
                createTriadNode(
                    `${moduleName}.${functionName}`,
                    category,
                    sourcePath,
                    mergeDemandEntries(parseGoParametersAst(node.childForFieldName('parameters')), ghostDemand),
                    [extractGoReturnType(node)]
                )
            );
        }
    }

    return triadGraph;
}

function collectGoCapabilityNodes(
    rootNode: Parser.SyntaxNode,
    filePath: string,
    sourcePath: string,
    category: string,
    config: TriadConfig,
    parsedFiles: ParsedSourceFile[]
) {
    const triadGraph: TriadNode[] = [];
    const moduleName = toPascalCase(path.basename(sourcePath).replace(/\.go$/, ''));
    const ghostContext = buildGoGhostContext(rootNode, filePath, parsedFiles);
    const methodsByReceiver = new Map<string, GoExecutableRecord[]>();
    const topLevelRecords: GoExecutableRecord[] = [];

    for (const node of rootNode.namedChildren) {
        if (node.type === 'method_declaration') {
            const receiver = node.childForFieldName('receiver') ?? node.namedChildren[0];
            const receiverType = extractGoReceiverType(receiver);
            const methodName = getNameText(node.childForFieldName('name'));
            if (!receiverType || !methodName) {
                continue;
            }

            const receiverBindingName = extractGoReceiverBindingName(receiver);
            const classPropertyTypes = collectGoStructPropertyTypes(rootNode, receiverType);
            const ghostDemand = collectGoGhostDemand(node, ghostContext, classPropertyTypes, receiverBindingName);
            const record: GoExecutableRecord = {
                name: methodName,
                demand: mergeDemandEntries(parseGoParametersAst(node.childForFieldName('parameters')), ghostDemand),
                answer: [normalizeGenericContractType(extractGoReturnType(node))]
            };
            const bucket = methodsByReceiver.get(receiverType) ?? [];
            bucket.push(record);
            methodsByReceiver.set(receiverType, bucket);
            continue;
        }

        if (node.type === 'function_declaration') {
            const functionName = getNameText(node.childForFieldName('name'));
            if (!functionName) {
                continue;
            }

            const ghostDemand = collectGoGhostDemand(node, ghostContext);
            topLevelRecords.push({
                name: functionName,
                demand: mergeDemandEntries(parseGoParametersAst(node.childForFieldName('parameters')), ghostDemand),
                answer: [normalizeGenericContractType(extractGoReturnType(node))]
            });
        }
    }

    for (const [receiverType, records] of methodsByReceiver.entries()) {
        if (isSuppressedCapabilityContainerName(receiverType, config)) {
            continue;
        }

        const promotable = records.filter((record) => !isGoNoiseCapability(record.name, config, sourcePath, record));
        if (promotable.length === 0) {
            continue;
        }

        const entrypoint = promotable.find((record) => isGoPrimaryCapabilityMethod(record.name, config));
        if (entrypoint && shouldPromoteGoCapability(entrypoint.name, sourcePath, receiverType, config, entrypoint)) {
            const foldedRecords = getFoldableCapabilityRecords(records, promotable, config, new Set<string>());
            triadGraph.push(
                createTriadNode(
                    `${receiverType}.${entrypoint.name}`,
                    category,
                    sourcePath,
                    mergeCapabilityDemand(foldedRecords.map((record) => record.demand)),
                    mergeCapabilityAnswer(foldedRecords.map((record) => record.answer)),
                    `execute ${receiverType} capability pipeline`,
                    buildFoldedLeafIds(receiverType, foldedRecords)
                )
            );
            continue;
        }

        const capabilityMethods = promotable.filter((record) => shouldPromoteGoCapability(record.name, sourcePath, receiverType, config, record));
        if (capabilityMethods.length > 0) {
            triadGraph.push(
                ...capabilityMethods.map((record) =>
                    createTriadNode(
                        `${receiverType}.${record.name}`,
                        category,
                        sourcePath,
                        record.demand,
                        record.answer,
                        `execute ${receiverType}.${record.name} capability`
                    )
                )
            );
            continue;
        }

        triadGraph.push(
            createTriadNode(
                `${receiverType}.capability`,
                category,
                sourcePath,
                mergeCapabilityDemand(getFoldableCapabilityRecords(records, promotable, config, new Set<string>()).map((record) => record.demand)),
                mergeCapabilityAnswer(getFoldableCapabilityRecords(records, promotable, config, new Set<string>()).map((record) => record.answer)),
                `execute ${receiverType} aggregate capability`,
                buildFoldedLeafIds(receiverType, getFoldableCapabilityRecords(records, promotable, config, new Set<string>()))
            )
        );
    }

    const promotableTopLevel = topLevelRecords.filter((record) => !isGoNoiseCapability(record.name, config, sourcePath, record));
    const promotedTopLevel = promotableTopLevel.filter((record) => shouldPromoteGoCapability(record.name, sourcePath, undefined, config, record));
    for (const record of promotedTopLevel) {
        triadGraph.push(
            createTriadNode(
                `${moduleName}.${record.name}`,
                category,
                sourcePath,
                record.demand,
                record.answer,
                `execute ${moduleName}.${record.name} capability`
            )
        );
    }

    if (triadGraph.length === 0 && promotableTopLevel.length > 0) {
        triadGraph.push(
            createTriadNode(
                `${moduleName}.module_pipeline`,
                category,
                sourcePath,
                mergeCapabilityDemand(promotableTopLevel.map((record) => record.demand)),
                mergeCapabilityAnswer(promotableTopLevel.map((record) => record.answer)),
                `execute ${moduleName} module capability`
            )
        );
    }

    return triadGraph;
}

function buildRustGhostContext(rootNode: Parser.SyntaxNode, filePath: string, parsedFiles: ParsedSourceFile[]) {
    return {
        importedBindings: collectRustImportedBindings(rootNode, filePath, parsedFiles),
        moduleBindings: collectRustModuleBindings(rootNode)
    };
}

function collectRustImportedBindings(
    rootNode: Parser.SyntaxNode,
    filePath: string,
    parsedFiles: ParsedSourceFile[]
) {
    const bindings = new Map<string, BindingInfo>();

    for (const useDeclaration of rootNode.descendantsOfType('use_declaration')) {
        for (const binding of collectRustUseBindings(useDeclaration, filePath, parsedFiles)) {
            bindings.set(binding.localName, {
                typeName: binding.typeName,
                callableReturnType: binding.callableReturnType
            });
        }
    }

    return bindings;
}

function collectRustUseBindings(
    node: Parser.SyntaxNode,
    currentFilePath: string,
    parsedFiles: ParsedSourceFile[],
    inheritedPrefix = ''
): Array<{ localName: string; typeName: string; callableReturnType?: string }> {
    if (node.type === 'use_as_clause') {
        const aliasNode = node.namedChildren[node.namedChildren.length - 1] ?? null;
        const importedNode = node.namedChildren[0] ?? null;
        const localName = getNameText(aliasNode);
        const importedPath = inheritedPrefix ? `${inheritedPrefix}::${importedNode?.text ?? ''}` : importedNode?.text ?? '';
        if (!localName) {
            return [];
        }

        return [resolveRustImportedBinding(importedPath, localName, currentFilePath, parsedFiles)];
    }

    if (node.type === 'scoped_use_list') {
        const prefixNode = node.namedChildren.find((child) => child.type !== 'use_list') ?? null;
        const useListNode = node.namedChildren.find((child) => child.type === 'use_list') ?? null;
        const nextPrefix = inheritedPrefix
            ? `${inheritedPrefix}::${prefixNode?.text ?? ''}`
            : prefixNode?.text ?? '';
        return useListNode ? useListNode.namedChildren.flatMap((child) => collectRustUseBindings(child, currentFilePath, parsedFiles, nextPrefix)) : [];
    }

    if (node.type === 'use_list') {
        return node.namedChildren.flatMap((child) => collectRustUseBindings(child, currentFilePath, parsedFiles, inheritedPrefix));
    }

    if (node.type === 'scoped_identifier') {
        if (node.parent?.type === 'use_as_clause' || node.parent?.type === 'scoped_use_list') {
            return [];
        }

        const fullPath = inheritedPrefix ? `${inheritedPrefix}::${node.text}` : node.text;
        const localName = getRustPathBindingName(fullPath);
        return localName ? [resolveRustImportedBinding(fullPath, localName, currentFilePath, parsedFiles)] : [];
    }

    if (
        (node.type === 'identifier' || node.type === 'crate' || node.type === 'self' || node.type === 'super') &&
        (node.parent?.type === 'use_declaration' || node.parent?.type === 'use_list')
    ) {
        const fullPath = inheritedPrefix ? `${inheritedPrefix}::${node.text}` : node.text;
        return [resolveRustImportedBinding(fullPath, getNameText(node) || node.text, currentFilePath, parsedFiles)];
    }

    return node.namedChildren.flatMap((child) => collectRustUseBindings(child, currentFilePath, parsedFiles, inheritedPrefix));
}

function collectRustModuleBindings(rootNode: Parser.SyntaxNode) {
    const bindings = new Map<string, BindingInfo>();

    for (const child of rootNode.namedChildren) {
        if (child.type === 'function_item') {
            const localName = getNameText(child.childForFieldName('name'));
            if (localName) {
                bindings.set(localName, createCallableBinding(localName, extractRustReturnType(child)));
            }
            continue;
        }

        if (child.type === 'struct_item' || child.type === 'enum_item' || child.type === 'trait_item' || child.type === 'type_item') {
            const localName = getFirstNamedChildText(child, ['type_identifier']);
            if (localName) {
                bindings.set(localName, createValueBinding(localName));
            }
            continue;
        }

        if (child.type !== 'static_item' && child.type !== 'const_item') {
            continue;
        }

        const localName = getNameText(child.childForFieldName('name') ?? child.namedChildren.find((node) => node.type === 'identifier') ?? null);
        if (!localName) {
            continue;
        }

        const explicitType = child.childForFieldName('type') ?? child.namedChildren.find((node) => node.type.endsWith('_type')) ?? null;
        bindings.set(localName, createValueBinding(explicitType?.text ?? guessBindingTypeFromName(localName)));
    }

    return bindings;
}

function resolveRustImportedBinding(
    importPath: string,
    localName: string,
    currentFilePath: string,
    parsedFiles: ParsedSourceFile[]
) {
    const bindingName = getRustPathBindingName(importPath) || localName;
    const targetFile = resolveRustImportedParsedFile(currentFilePath, importPath, parsedFiles);
    const binding = targetFile ? lookupRustExportedBindingInfo(targetFile.rootNode, bindingName) : undefined;

    return {
        localName,
        typeName: binding?.typeName ?? guessBindingTypeFromName(bindingName || localName),
        callableReturnType: binding?.callableReturnType
    };
}

function resolveRustImportedParsedFile(
    currentFilePath: string,
    importPath: string,
    parsedFiles: ParsedSourceFile[]
) {
    if (!importPath) {
        return undefined;
    }

    const segments = importPath.split('::').filter(Boolean);
    if (segments.length < 2) {
        return undefined;
    }

    const crateRoot = findRustCrateRoot(currentFilePath);
    const head = segments[0];
    const moduleSegments = segments.slice(1, -1);

    let baseDir = path.dirname(currentFilePath);
    if (head === 'crate') {
        baseDir = crateRoot;
    } else if (head === 'super') {
        baseDir = path.dirname(path.dirname(currentFilePath));
    } else if (head === 'self') {
        baseDir = path.dirname(currentFilePath);
    } else {
        return undefined;
    }

    const candidates = moduleSegments.length === 0
        ? [path.join(crateRoot, 'lib.rs'), path.join(crateRoot, 'main.rs')].map((candidate) => path.normalize(candidate))
        : [
            `${path.join(baseDir, ...moduleSegments)}.rs`,
            path.join(baseDir, ...moduleSegments, 'mod.rs')
        ].map((candidate) => path.normalize(candidate));

    return parsedFiles.find((entry) => candidates.includes(path.normalize(entry.filePath)));
}

function findRustCrateRoot(currentFilePath: string) {
    let currentDir = path.dirname(currentFilePath);
    while (currentDir && currentDir !== path.dirname(currentDir)) {
        if (path.basename(currentDir) === 'src') {
            return currentDir;
        }
        currentDir = path.dirname(currentDir);
    }

    return path.dirname(currentFilePath);
}

function getRustPathBindingName(importPath: string) {
    const segments = importPath.split('::').filter(Boolean);
    return segments[segments.length - 1] ?? '';
}

function lookupRustExportedBindingInfo(rootNode: Parser.SyntaxNode, bindingName: string): BindingInfo | undefined {
    for (const child of rootNode.namedChildren) {
        if (child.type === 'function_item') {
            const localName = getNameText(child.childForFieldName('name'));
            if (localName === bindingName) {
                return createCallableBinding(localName, extractRustReturnType(child));
            }
            continue;
        }

        if (child.type === 'struct_item' || child.type === 'enum_item' || child.type === 'trait_item' || child.type === 'type_item') {
            const localName = getFirstNamedChildText(child, ['type_identifier']);
            if (localName === bindingName) {
                return createValueBinding(localName);
            }
            continue;
        }

        if (child.type === 'static_item' || child.type === 'const_item') {
            const localName = getNameText(child.childForFieldName('name') ?? child.namedChildren.find((node) => node.type === 'identifier') ?? null);
            if (localName === bindingName) {
                const explicitType = child.childForFieldName('type') ?? child.namedChildren.find((node) => node.type.endsWith('_type')) ?? null;
                return createValueBinding(explicitType?.text ?? localName);
            }
        }
    }

    return undefined;
}

function collectRustStructPropertyTypes(rootNode: Parser.SyntaxNode, implType: string) {
    const propertyTypes = new Map<string, string>();
    if (!implType) {
        return propertyTypes;
    }

    for (const structNode of rootNode.namedChildren.filter((node) => node.type === 'struct_item')) {
        const typeName = getFirstNamedChildText(structNode, ['type_identifier']);
        if (typeName !== implType) {
            continue;
        }

        const fieldList = structNode.namedChildren.find((node) => node.type === 'field_declaration_list') ?? null;
        if (!fieldList) {
            continue;
        }

        for (const fieldNode of fieldList.namedChildren.filter((node) => node.type === 'field_declaration')) {
            const fieldName = getNameText(fieldNode.namedChildren.find((node) => node.type === 'field_identifier') ?? null);
            const typeNode = [...fieldNode.namedChildren]
                .reverse()
                .find((node) => node.type !== 'field_identifier');
            if (!fieldName) {
                continue;
            }

            propertyTypes.set(fieldName, normalizeTypeText(typeNode?.text ?? 'unknown'));
        }
    }

    return propertyTypes;
}

function collectRustGhostDemand(
    executableNode: Parser.SyntaxNode,
    ghostContext: GhostBindingContext,
    classPropertyTypes = new Map<string, string>()
) {
    const ghostStates = new Map<string, { typeName: string; read: boolean; write: boolean }>();

    for (const reference of scanTreeSitterGhostReferences(executableNode, {
        localDeclarationNodes: ['let_declaration'],
        memberExpressionNodes: ['field_expression'],
        functionBodyNodes: ['block'],
        selfNames: ['self']
    })) {
        if (reference.kind === 'self') {
            const propertyName = reference.propertyName ?? reference.rootName;
            const typeName = classPropertyTypes.get(propertyName) ?? 'unknown';
            registerGhostState(ghostStates, reference.label, typeName, reference.mode);
            continue;
        }

        const binding = ghostContext.importedBindings.get(reference.rootName) ?? ghostContext.moduleBindings.get(reference.rootName);
        if (!binding) {
            continue;
        }

        registerGhostState(ghostStates, reference.label, binding.typeName, reference.mode);
    }

    return Array.from(ghostStates.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([label, state]) => {
            if (state.read && state.write) {
                return `[Ghost:ReadWrite] ${state.typeName} (${label})`;
            }
            if (state.write) {
                return `[Ghost:Write] ${state.typeName} (${label})`;
            }
            return `[Ghost:Read] ${state.typeName} (${label})`;
        });
}

function collectRustNodes(
    rootNode: Parser.SyntaxNode,
    filePath: string,
    sourcePath: string,
    category: string,
    config: TriadConfig,
    parsedFiles: ParsedSourceFile[]
) {
    if (config.parser.scanMode === 'capability' || config.parser.scanMode === 'module' || config.parser.scanMode === 'domain') {
        return collectRustCapabilityNodes(rootNode, filePath, sourcePath, category, config, parsedFiles);
    }

    return collectRustLeafNodes(rootNode, filePath, sourcePath, category, parsedFiles);
}

function collectRustLeafNodes(
    rootNode: Parser.SyntaxNode,
    filePath: string,
    sourcePath: string,
    category: string,
    parsedFiles: ParsedSourceFile[]
) {
    const triadGraph: TriadNode[] = [];
    const moduleName = toPascalCase(path.basename(filePath).replace(/\.rs$/, ''));
    const ghostContext = buildRustGhostContext(rootNode, filePath, parsedFiles);

    for (const node of rootNode.namedChildren) {
        if (node.type === 'impl_item') {
            const implType = getFirstNamedChildText(node, ['type_identifier', 'primitive_type']);
            const declarationList = node.childForFieldName('body') ?? node.namedChildren.find((child) => child.type === 'declaration_list');
            if (!implType || !declarationList) {
                continue;
            }

            const classPropertyTypes = collectRustStructPropertyTypes(rootNode, implType);
            for (const functionNode of declarationList.namedChildren.filter((child) => child.type === 'function_item')) {
                const functionName = getNameText(functionNode.childForFieldName('name'));
                if (!functionName) {
                    continue;
                }

                const ghostDemand = collectRustGhostDemand(functionNode, ghostContext, classPropertyTypes);
                triadGraph.push(
                    createTriadNode(
                        `${implType}.${functionName}`,
                        category,
                        sourcePath,
                        mergeDemandEntries(parseRustParametersAst(functionNode.childForFieldName('parameters')), ghostDemand),
                        [extractRustReturnType(functionNode)]
                    )
                );
            }
            continue;
        }

        if (node.type === 'function_item') {
            const functionName = getNameText(node.childForFieldName('name'));
            if (!functionName) {
                continue;
            }

            const ghostDemand = collectRustGhostDemand(node, ghostContext);
            triadGraph.push(
                createTriadNode(
                    `${moduleName}.${functionName}`,
                    category,
                    sourcePath,
                    mergeDemandEntries(parseRustParametersAst(node.childForFieldName('parameters')), ghostDemand),
                    [extractRustReturnType(node)]
                )
            );
        }
    }

    return triadGraph;
}

function buildCppGhostContext(rootNode: Parser.SyntaxNode, filePath: string, parsedFiles: ParsedSourceFile[]) {
    return {
        importedBindings: collectCppImportedBindings(rootNode, filePath, parsedFiles),
        moduleBindings: collectCppModuleBindings(rootNode)
    };
}

function collectCppImportedBindings(
    rootNode: Parser.SyntaxNode,
    filePath: string,
    parsedFiles: ParsedSourceFile[]
) {
    const bindings = new Map<string, BindingInfo>();

    for (const includeNode of rootNode.descendantsOfType('preproc_include')) {
        const includePath = includeNode.namedChildren.find((child) => child.type === 'string_literal')?.namedChildren[0]?.text ?? '';
        if (!includePath) {
            continue;
        }

        const targetFile = resolveIncludedParsedFile(filePath, includePath, parsedFiles);
        if (!targetFile) {
            continue;
        }

        for (const [name, binding] of collectCppModuleBindings(targetFile.rootNode).entries()) {
            if (!bindings.has(name)) {
                bindings.set(name, binding);
            }
        }
    }

    return bindings;
}

function collectCppModuleBindings(rootNode: Parser.SyntaxNode) {
    const bindings = new Map<string, BindingInfo>();

    for (const child of rootNode.namedChildren) {
        if (child.type === 'declaration') {
            const typeNode = child.namedChildren.find(
                (node) => node.type === 'type_identifier' || node.type.endsWith('_type') || node.type === 'primitive_type'
            );
            const localName = getNameText(
                child.namedChildren.find((node) => node.type === 'identifier' || node.type === 'field_identifier') ?? null
            );
            if (localName) {
                bindings.set(localName, createValueBinding(typeNode?.text ?? guessBindingTypeFromName(localName)));
            }
            continue;
        }

        if (child.type === 'function_definition') {
            const declarator = child.childForFieldName('declarator') ?? child.namedChildren.find((node) => node.type === 'function_declarator');
            const nameNode =
                declarator?.childForFieldName('declarator') ??
                declarator?.childForFieldName('name') ??
                declarator?.namedChildren.find((node) => node.type === 'identifier' || node.type === 'qualified_identifier') ??
                null;
            const localName = getNameText(nameNode);
            if (localName) {
                bindings.set(localName, createCallableBinding(localName, extractCppReturnType(child)));
            }
            continue;
        }

        if (child.type === 'class_specifier' || child.type === 'struct_specifier') {
            const localName = getFirstNamedChildText(child, ['type_identifier']);
            if (localName) {
                bindings.set(localName, createValueBinding(localName));
            }
        }
    }

    return bindings;
}

function collectCppClassPropertyTypes(classNode: Parser.SyntaxNode) {
    const propertyTypes = new Map<string, string>();
    const body = classNode.childForFieldName('body') ?? classNode.namedChildren.find((child) => child.type === 'field_declaration_list');
    if (!body) {
        return propertyTypes;
    }

    for (const field of body.namedChildren.filter((child) => child.type === 'field_declaration')) {
        const declarator = field.descendantsOfType('function_declarator')[0];
        if (declarator) {
            continue;
        }

        const typeNode = field.namedChildren.find(
            (node) => node.type === 'type_identifier' || node.type.endsWith('_type') || node.type === 'primitive_type'
        );
        const typeName = normalizeTypeText(typeNode?.text ?? 'unknown');
        for (const fieldNameNode of field.namedChildren.filter((node) => node.type === 'field_identifier')) {
            propertyTypes.set(fieldNameNode.text, typeName);
        }
    }

    return propertyTypes;
}

function collectCppGhostDemand(
    executableNode: Parser.SyntaxNode,
    ghostContext: GhostBindingContext,
    classPropertyTypes = new Map<string, string>()
) {
    const ghostStates = new Map<string, { typeName: string; read: boolean; write: boolean }>();

    for (const reference of scanTreeSitterGhostReferences(executableNode, {
        localDeclarationNodes: ['declaration', 'init_declarator', 'for_range_loop'],
        memberExpressionNodes: ['field_expression', 'qualified_identifier'],
        functionBodyNodes: ['compound_statement'],
        selfNames: ['this']
    })) {
        if (reference.kind === 'self') {
            const propertyName = reference.propertyName ?? reference.rootName;
            const typeName = classPropertyTypes.get(propertyName) ?? 'unknown';
            registerGhostState(ghostStates, reference.label, typeName, reference.mode);
            continue;
        }

        const selfTypeName = classPropertyTypes.get(reference.rootName);
        if (selfTypeName) {
            registerGhostState(ghostStates, reference.label, selfTypeName, reference.mode);
            continue;
        }

        const binding = ghostContext.importedBindings.get(reference.rootName) ?? ghostContext.moduleBindings.get(reference.rootName);
        if (!binding) {
            continue;
        }

        registerGhostState(ghostStates, reference.label, binding.typeName, reference.mode);
    }

    return Array.from(ghostStates.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([label, state]) => {
            if (state.read && state.write) {
                return `[Ghost:ReadWrite] ${state.typeName} (${label})`;
            }
            if (state.write) {
                return `[Ghost:Write] ${state.typeName} (${label})`;
            }
            return `[Ghost:Read] ${state.typeName} (${label})`;
        });
}

function collectCppNodes(
    rootNode: Parser.SyntaxNode,
    filePath: string,
    sourcePath: string,
    category: string,
    config: TriadConfig,
    parsedFiles: ParsedSourceFile[]
) {
    if (config.parser.scanMode === 'capability' || config.parser.scanMode === 'module' || config.parser.scanMode === 'domain') {
        return collectCppCapabilityNodes(rootNode, filePath, sourcePath, category, config, parsedFiles);
    }

    return collectCppLeafNodes(rootNode, filePath, sourcePath, category, parsedFiles);
}

function collectCppLeafNodes(
    rootNode: Parser.SyntaxNode,
    filePath: string,
    sourcePath: string,
    category: string,
    parsedFiles: ParsedSourceFile[]
) {
    const triadGraph: TriadNode[] = [];
    const moduleName = toPascalCase(path.basename(filePath).replace(/\.(cpp|cc|cxx|hpp|hh|h)$/i, ''));
    const ghostContext = buildCppGhostContext(rootNode, filePath, parsedFiles);

    for (const node of rootNode.namedChildren) {
        if (node.type === 'class_specifier' || node.type === 'struct_specifier') {
            const className = getFirstNamedChildText(node, ['type_identifier']);
            const body = node.childForFieldName('body') ?? node.namedChildren.find((child) => child.type === 'field_declaration_list');
            if (!className || !body) {
                continue;
            }

            const classPropertyTypes = collectCppClassPropertyTypes(node);
            for (const memberNode of body.namedChildren.filter((child) => child.type === 'field_declaration' || child.type === 'function_definition')) {
                const declarator =
                    memberNode.type === 'function_definition'
                        ? memberNode.childForFieldName('declarator') ?? memberNode.namedChildren.find((child) => child.type === 'function_declarator')
                        : memberNode.descendantsOfType('function_declarator')[0];
                const methodName = getNameText(declarator?.childForFieldName('declarator') ?? declarator?.childForFieldName('name') ?? declarator?.namedChildren[0]);
                if (!declarator || !methodName || methodName === className || methodName === `~${className}`) {
                    continue;
                }

                const functionNode =
                    memberNode.type === 'function_definition'
                        ? memberNode
                        : memberNode.namedChildren.find((child) => child.type === 'function_definition') ?? declarator.parent?.parent ?? memberNode;
                const ghostDemand = collectCppGhostDemand(functionNode, ghostContext, classPropertyTypes);
                triadGraph.push(
                    createTriadNode(
                        `${className}.${methodName}`,
                        category,
                        sourcePath,
                        mergeDemandEntries(parseCppParametersAst(
                            declarator.childForFieldName('parameters') ??
                                declarator.namedChildren.find((child) => child.type === 'parameter_list') ??
                                null
                        ), ghostDemand),
                        [extractCppReturnType(memberNode)]
                    )
                );
            }
            continue;
        }

        if (node.type === 'function_definition') {
            const declarator = node.childForFieldName('declarator') ?? node.namedChildren.find((child) => child.type === 'function_declarator');
            if (!declarator) {
                continue;
            }

            const nameNode =
                declarator.childForFieldName('declarator') ??
                declarator.childForFieldName('name') ??
                declarator.namedChildren.find((child) => child.type === 'qualified_identifier' || child.type === 'identifier');
            const qualifiedNode = nameNode?.type === 'qualified_identifier' ? nameNode : null;
            const functionName = getNameText(qualifiedNode ? qualifiedNode.namedChildren[qualifiedNode.namedChildren.length - 1] : nameNode);
            const ownerName = qualifiedNode ? getFirstNamedChildText(qualifiedNode, ['namespace_identifier', 'type_identifier']) : moduleName;
            if (!functionName || !ownerName) {
                continue;
            }

            const ghostDemand = collectCppGhostDemand(node, ghostContext);
            triadGraph.push(
                createTriadNode(
                    `${ownerName}.${functionName}`,
                    category,
                    sourcePath,
                    mergeDemandEntries(parseCppParametersAst(
                        declarator.childForFieldName('parameters') ??
                            declarator.namedChildren.find((child) => child.type === 'parameter_list') ??
                            null
                    ), ghostDemand),
                    [extractCppReturnType(node)]
                )
            );
        }
    }

    return triadGraph;
}

function buildJavaGhostContext(rootNode: Parser.SyntaxNode, filePath: string, parsedFiles: ParsedSourceFile[]) {
    return {
        importedBindings: collectJavaImportedBindings(rootNode, filePath, parsedFiles),
        moduleBindings: collectJavaModuleBindings(rootNode)
    };
}

function collectJavaImportedBindings(
    rootNode: Parser.SyntaxNode,
    _filePath: string,
    parsedFiles: ParsedSourceFile[]
) {
    const bindings = new Map<string, BindingInfo>();

    for (const importNode of rootNode.descendantsOfType('import_declaration')) {
        const scopedNode = importNode.namedChildren.find((node) => node.type === 'scoped_identifier' || node.type === 'identifier');
        const importPath = scopedNode?.text ?? '';
        const localName = getScopedPathTail(importPath, '.');
        if (!localName) {
            continue;
        }

        bindings.set(localName, resolveJavaImportedBindingInfo(importPath, parsedFiles, localName));
    }

    return bindings;
}

function collectJavaModuleBindings(rootNode: Parser.SyntaxNode) {
    const bindings = new Map<string, BindingInfo>();

    for (const classNode of rootNode.namedChildren.filter((node) => node.type === 'class_declaration')) {
        const className = getNameText(classNode.childForFieldName('name'));
        if (!className) {
            continue;
        }

        bindings.set(className, createValueBinding(className));
        const classBody = classNode.childForFieldName('body');
        if (!classBody) {
            continue;
        }

        for (const child of classBody.namedChildren) {
            if (child.type === 'field_declaration') {
                const typeNode = child.childForFieldName('type') ?? child.namedChildren.find((node) => node.type.endsWith('_type')) ?? null;
                const typeName = normalizeTypeText(typeNode?.text ?? 'unknown');
                for (const declarator of child.namedChildren.filter((node) => node.type === 'variable_declarator')) {
                    const localName = getNameText(declarator.childForFieldName('name') ?? declarator.namedChildren[0] ?? null);
                    if (localName) {
                        bindings.set(localName, createValueBinding(typeName));
                    }
                }
                continue;
            }

            if (child.type === 'method_declaration') {
                const localName = getNameText(child.childForFieldName('name'));
                if (localName) {
                    bindings.set(localName, createCallableBinding(localName, normalizeTypeText(child.childForFieldName('type')?.text ?? 'unknown')));
                }
            }
        }
    }

    return bindings;
}

function collectJavaClassPropertyTypes(classNode: Parser.SyntaxNode) {
    const propertyTypes = new Map<string, string>();
    const classBody = classNode.childForFieldName('body');
    if (!classBody) {
        return propertyTypes;
    }

    for (const child of classBody.namedChildren.filter((node) => node.type === 'field_declaration')) {
        const typeNode = child.childForFieldName('type') ?? child.namedChildren.find((node) => node.type.endsWith('_type')) ?? null;
        const typeName = normalizeTypeText(typeNode?.text ?? 'unknown');
        for (const declarator of child.namedChildren.filter((node) => node.type === 'variable_declarator')) {
            const propertyName = getNameText(declarator.childForFieldName('name') ?? declarator.namedChildren[0] ?? null);
            if (propertyName) {
                propertyTypes.set(propertyName, typeName);
            }
        }
    }

    return propertyTypes;
}

function collectJavaGhostDemand(
    executableNode: Parser.SyntaxNode,
    ghostContext: GhostBindingContext,
    classPropertyTypes = new Map<string, string>()
) {
    const ghostStates = new Map<string, { typeName: string; read: boolean; write: boolean }>();

    for (const reference of scanTreeSitterGhostReferences(executableNode, {
        localDeclarationNodes: ['local_variable_declaration', 'variable_declarator', 'catch_formal_parameter'],
        memberExpressionNodes: ['field_access', 'method_invocation'],
        functionBodyNodes: ['block'],
        selfNames: ['this']
    })) {
        if (reference.kind === 'self') {
            const propertyName = reference.propertyName ?? reference.rootName;
            const typeName = classPropertyTypes.get(propertyName) ?? 'unknown';
            registerGhostState(ghostStates, reference.label, typeName, reference.mode);
            continue;
        }

        const selfTypeName = classPropertyTypes.get(reference.rootName);
        if (selfTypeName) {
            registerGhostState(ghostStates, reference.label, selfTypeName, reference.mode);
            continue;
        }

        const binding = ghostContext.importedBindings.get(reference.rootName) ?? ghostContext.moduleBindings.get(reference.rootName);
        if (!binding) {
            continue;
        }

        registerGhostState(ghostStates, reference.label, binding.typeName, reference.mode);
    }

    return Array.from(ghostStates.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([label, state]) => {
            if (state.read && state.write) {
                return `[Ghost:ReadWrite] ${state.typeName} (${label})`;
            }
            if (state.write) {
                return `[Ghost:Write] ${state.typeName} (${label})`;
            }
            return `[Ghost:Read] ${state.typeName} (${label})`;
        });
}

function collectJavaNodes(
    rootNode: Parser.SyntaxNode,
    filePath: string,
    sourcePath: string,
    category: string,
    config: TriadConfig,
    parsedFiles: ParsedSourceFile[]
) {
    if (config.parser.scanMode === 'capability' || config.parser.scanMode === 'module' || config.parser.scanMode === 'domain') {
        return collectJavaCapabilityNodes(rootNode, filePath, sourcePath, category, config, parsedFiles);
    }

    return collectJavaLeafNodes(rootNode, filePath, sourcePath, category, parsedFiles);
}

function collectJavaLeafNodes(
    rootNode: Parser.SyntaxNode,
    filePath: string,
    sourcePath: string,
    category: string,
    parsedFiles: ParsedSourceFile[]
) {
    const triadGraph: TriadNode[] = [];
    const ghostContext = buildJavaGhostContext(rootNode, filePath, parsedFiles);

    for (const classNode of rootNode.namedChildren.filter((node) => node.type === 'class_declaration')) {
        const className = getNameText(classNode.childForFieldName('name'));
        const classBody = classNode.childForFieldName('body');
        if (!className || !classBody) {
            continue;
        }

        const classPropertyTypes = collectJavaClassPropertyTypes(classNode);
        for (const methodNode of classBody.namedChildren.filter((child) => child.type === 'method_declaration')) {
            const methodName = getNameText(methodNode.childForFieldName('name'));
            if (!methodName) {
                continue;
            }

            const ghostDemand = collectJavaGhostDemand(methodNode, ghostContext, classPropertyTypes);
            triadGraph.push(
                createTriadNode(
                    `${className}.${methodName}`,
                    category,
                    sourcePath,
                    mergeDemandEntries(parseJavaParametersAst(methodNode.childForFieldName('parameters')), ghostDemand),
                    [normalizeGenericContractType(methodNode.childForFieldName('type')?.text ?? 'void')]
                )
            );
        }
    }

    return triadGraph;
}

function collectCppCapabilityNodes(
    rootNode: Parser.SyntaxNode,
    filePath: string,
    sourcePath: string,
    category: string,
    config: TriadConfig,
    parsedFiles: ParsedSourceFile[]
) {
    const triadGraph: TriadNode[] = [];
    const moduleName = toPascalCase(path.basename(filePath).replace(/\.(cpp|cc|cxx|hpp|hh|h)$/i, ''));
    const ghostContext = buildCppGhostContext(rootNode, filePath, parsedFiles);
    const classRecords = new Map<string, CppExecutableRecord[]>();
    const topLevelRecords: CppExecutableRecord[] = [];

    for (const node of rootNode.namedChildren) {
        if (node.type === 'class_specifier' || node.type === 'struct_specifier') {
            const className = getFirstNamedChildText(node, ['type_identifier']);
            const body = node.childForFieldName('body') ?? node.namedChildren.find((child) => child.type === 'field_declaration_list');
            if (!className || !body) {
                continue;
            }

            const classPropertyTypes = collectCppClassPropertyTypes(node);
            for (const memberNode of body.namedChildren.filter((child) => child.type === 'field_declaration' || child.type === 'function_definition')) {
                const declarator =
                    memberNode.type === 'function_definition'
                        ? memberNode.childForFieldName('declarator') ?? memberNode.namedChildren.find((child) => child.type === 'function_declarator')
                        : memberNode.descendantsOfType('function_declarator')[0];
                const methodName = getNameText(
                    declarator?.childForFieldName('declarator') ?? declarator?.childForFieldName('name') ?? declarator?.namedChildren[0]
                );
                if (!declarator || !methodName || methodName === className || methodName === `~${className}`) {
                    continue;
                }

                const functionNode =
                    memberNode.type === 'function_definition'
                        ? memberNode
                        : memberNode.namedChildren.find((child) => child.type === 'function_definition') ?? declarator.parent?.parent ?? memberNode;
                const ghostDemand = collectCppGhostDemand(functionNode, ghostContext, classPropertyTypes);
                const record: CppExecutableRecord = {
                    name: methodName,
                    demand: mergeDemandEntries(
                        parseCppParametersAst(
                            declarator.childForFieldName('parameters') ??
                                declarator.namedChildren.find((child) => child.type === 'parameter_list') ??
                                null
                        ),
                        ghostDemand
                    ),
                    answer: [normalizeGenericContractType(extractCppReturnType(memberNode))]
                };
                const bucket = classRecords.get(className) ?? [];
                bucket.push(record);
                classRecords.set(className, bucket);
            }
            continue;
        }

        if (node.type === 'function_definition') {
            const declarator = node.childForFieldName('declarator') ?? node.namedChildren.find((child) => child.type === 'function_declarator');
            if (!declarator) {
                continue;
            }

            const nameNode =
                declarator.childForFieldName('declarator') ??
                declarator.childForFieldName('name') ??
                declarator.namedChildren.find((child) => child.type === 'qualified_identifier' || child.type === 'identifier');
            const qualifiedNode = nameNode?.type === 'qualified_identifier' ? nameNode : null;
            const functionName = getNameText(qualifiedNode ? qualifiedNode.namedChildren[qualifiedNode.namedChildren.length - 1] : nameNode);
            const ownerName = qualifiedNode ? getFirstNamedChildText(qualifiedNode, ['namespace_identifier', 'type_identifier']) : moduleName;
            if (!functionName || !ownerName) {
                continue;
            }

            const ghostDemand = collectCppGhostDemand(node, ghostContext);
            topLevelRecords.push({
                name: functionName,
                ownerName,
                demand: mergeDemandEntries(
                    parseCppParametersAst(
                        declarator.childForFieldName('parameters') ??
                            declarator.namedChildren.find((child) => child.type === 'parameter_list') ??
                            null
                    ),
                    ghostDemand
                ),
                answer: [normalizeGenericContractType(extractCppReturnType(node))]
            });
        }
    }

    for (const [className, records] of classRecords.entries()) {
        if (isSuppressedCapabilityContainerName(className, config)) {
            continue;
        }

        const promotable = records.filter((record) => !isCppNoiseCapability(record.name, config, sourcePath, record));
        if (promotable.length === 0) {
            continue;
        }

        const entrypoint = promotable.find((record) => isCppPrimaryCapabilityMethod(record.name, config));
        if (entrypoint && shouldPromoteCppCapability(entrypoint.name, sourcePath, className, config, entrypoint)) {
            const foldedRecords = getFoldableCapabilityRecords(records, promotable, config, CPP_MAGIC_METHODS);
            triadGraph.push(
                createTriadNode(
                    `${className}.${entrypoint.name}`,
                    category,
                    sourcePath,
                    mergeCapabilityDemand(foldedRecords.map((record) => record.demand)),
                    mergeCapabilityAnswer(foldedRecords.map((record) => record.answer)),
                    `execute ${className} capability pipeline`,
                    buildFoldedLeafIds(className, foldedRecords)
                )
            );
            continue;
        }

        const capabilityMethods = promotable.filter((record) => shouldPromoteCppCapability(record.name, sourcePath, className, config, record));
        if (capabilityMethods.length > 0) {
            triadGraph.push(
                ...capabilityMethods.map((record) =>
                    createTriadNode(
                        `${className}.${record.name}`,
                        category,
                        sourcePath,
                        record.demand,
                        record.answer,
                        `execute ${className}.${record.name} capability`
                    )
                )
            );
            continue;
        }

        triadGraph.push(
            createTriadNode(
                `${className}.capability`,
                category,
                sourcePath,
                mergeCapabilityDemand(getFoldableCapabilityRecords(records, promotable, config, CPP_MAGIC_METHODS).map((record) => record.demand)),
                mergeCapabilityAnswer(getFoldableCapabilityRecords(records, promotable, config, CPP_MAGIC_METHODS).map((record) => record.answer)),
                `execute ${className} aggregate capability`,
                buildFoldedLeafIds(className, getFoldableCapabilityRecords(records, promotable, config, CPP_MAGIC_METHODS))
            )
        );
    }

    const promotableTopLevel = topLevelRecords.filter((record) => !isCppNoiseCapability(record.name, config, sourcePath, record));
    const promotedTopLevel = promotableTopLevel.filter(
        (record) =>
            (!record.ownerName || !isSuppressedCapabilityContainerName(record.ownerName, config)) &&
            shouldPromoteCppCapability(record.name, sourcePath, record.ownerName, config, record)
    );
    for (const record of promotedTopLevel) {
        triadGraph.push(
            createTriadNode(
                `${record.ownerName ?? moduleName}.${record.name}`,
                category,
                sourcePath,
                record.demand,
                record.answer,
                `execute ${(record.ownerName ?? moduleName)}.${record.name} capability`
            )
        );
    }

    if (triadGraph.length === 0 && promotableTopLevel.length > 0) {
        triadGraph.push(
            createTriadNode(
                `${moduleName}.module_pipeline`,
                category,
                sourcePath,
                mergeCapabilityDemand(promotableTopLevel.map((record) => record.demand)),
                mergeCapabilityAnswer(promotableTopLevel.map((record) => record.answer)),
                `execute ${moduleName} module capability`
            )
        );
    }

    return triadGraph;
}

function collectRustCapabilityNodes(
    rootNode: Parser.SyntaxNode,
    filePath: string,
    sourcePath: string,
    category: string,
    config: TriadConfig,
    parsedFiles: ParsedSourceFile[]
) {
    const triadGraph: TriadNode[] = [];
    const moduleName = toPascalCase(path.basename(filePath).replace(/\.rs$/, ''));
    const ghostContext = buildRustGhostContext(rootNode, filePath, parsedFiles);
    const implRecords = new Map<string, RustExecutableRecord[]>();
    const topLevelRecords: RustExecutableRecord[] = [];

    for (const node of rootNode.namedChildren) {
        if (node.type === 'impl_item') {
            const implType = getFirstNamedChildText(node, ['type_identifier', 'primitive_type']);
            const declarationList = node.childForFieldName('body') ?? node.namedChildren.find((child) => child.type === 'declaration_list');
            if (!implType || !declarationList) {
                continue;
            }

            const classPropertyTypes = collectRustStructPropertyTypes(rootNode, implType);
            for (const functionNode of declarationList.namedChildren.filter((child) => child.type === 'function_item')) {
                const functionName = getNameText(functionNode.childForFieldName('name'));
                if (!functionName) {
                    continue;
                }

                const ghostDemand = collectRustGhostDemand(functionNode, ghostContext, classPropertyTypes);
                const record: RustExecutableRecord = {
                    name: functionName,
                    demand: mergeDemandEntries(parseRustParametersAst(functionNode.childForFieldName('parameters')), ghostDemand),
                    answer: [normalizeGenericContractType(extractRustReturnType(functionNode))]
                };
                const bucket = implRecords.get(implType) ?? [];
                bucket.push(record);
                implRecords.set(implType, bucket);
            }
            continue;
        }

        if (node.type === 'function_item') {
            const functionName = getNameText(node.childForFieldName('name'));
            if (!functionName) {
                continue;
            }

            const ghostDemand = collectRustGhostDemand(node, ghostContext);
            topLevelRecords.push({
                name: functionName,
                demand: mergeDemandEntries(parseRustParametersAst(node.childForFieldName('parameters')), ghostDemand),
                answer: [normalizeGenericContractType(extractRustReturnType(node))]
            });
        }
    }

    for (const [implType, records] of implRecords.entries()) {
        if (isSuppressedCapabilityContainerName(implType, config)) {
            continue;
        }

        const promotable = records.filter((record) => !isRustNoiseCapability(record.name, config, sourcePath, record));
        if (promotable.length === 0) {
            continue;
        }

        const entrypoint = promotable.find((record) => isRustPrimaryCapabilityMethod(record.name, config));
        if (entrypoint && shouldPromoteRustCapability(entrypoint.name, sourcePath, implType, config, entrypoint)) {
            const foldedRecords = getFoldableCapabilityRecords(records, promotable, config, new Set<string>());
            triadGraph.push(
                createTriadNode(
                    `${implType}.${entrypoint.name}`,
                    category,
                    sourcePath,
                    mergeCapabilityDemand(foldedRecords.map((record) => record.demand)),
                    mergeCapabilityAnswer(foldedRecords.map((record) => record.answer)),
                    `execute ${implType} capability pipeline`,
                    buildFoldedLeafIds(implType, foldedRecords)
                )
            );
            continue;
        }

        const capabilityMethods = promotable.filter((record) => shouldPromoteRustCapability(record.name, sourcePath, implType, config, record));
        if (capabilityMethods.length > 0) {
            triadGraph.push(
                ...capabilityMethods.map((record) =>
                    createTriadNode(
                        `${implType}.${record.name}`,
                        category,
                        sourcePath,
                        record.demand,
                        record.answer,
                        `execute ${implType}.${record.name} capability`
                    )
                )
            );
            continue;
        }

        triadGraph.push(
            createTriadNode(
                `${implType}.capability`,
                category,
                sourcePath,
                mergeCapabilityDemand(getFoldableCapabilityRecords(records, promotable, config, new Set<string>()).map((record) => record.demand)),
                mergeCapabilityAnswer(getFoldableCapabilityRecords(records, promotable, config, new Set<string>()).map((record) => record.answer)),
                `execute ${implType} aggregate capability`,
                buildFoldedLeafIds(implType, getFoldableCapabilityRecords(records, promotable, config, new Set<string>()))
            )
        );
    }

    const promotableTopLevel = topLevelRecords.filter((record) => !isRustNoiseCapability(record.name, config, sourcePath, record));
    const promotedTopLevel = promotableTopLevel.filter((record) => shouldPromoteRustCapability(record.name, sourcePath, undefined, config, record));
    for (const record of promotedTopLevel) {
        triadGraph.push(
            createTriadNode(
                `${moduleName}.${record.name}`,
                category,
                sourcePath,
                record.demand,
                record.answer,
                `execute ${moduleName}.${record.name} capability`
            )
        );
    }

    if (triadGraph.length === 0 && promotableTopLevel.length > 0) {
        triadGraph.push(
            createTriadNode(
                `${moduleName}.module_pipeline`,
                category,
                sourcePath,
                mergeCapabilityDemand(promotableTopLevel.map((record) => record.demand)),
                mergeCapabilityAnswer(promotableTopLevel.map((record) => record.answer)),
                `execute ${moduleName} module capability`
            )
        );
    }

    return triadGraph;
}

function collectJavaCapabilityNodes(
    rootNode: Parser.SyntaxNode,
    filePath: string,
    sourcePath: string,
    category: string,
    config: TriadConfig,
    parsedFiles: ParsedSourceFile[]
) {
    const triadGraph: TriadNode[] = [];
    const ghostContext = buildJavaGhostContext(rootNode, filePath, parsedFiles);

    for (const classNode of rootNode.namedChildren.filter((node) => node.type === 'class_declaration')) {
        const className = getNameText(classNode.childForFieldName('name'));
        const classBody = classNode.childForFieldName('body');
        if (!className || !classBody) {
            continue;
        }

        const classPropertyTypes = collectJavaClassPropertyTypes(classNode);
        const records = classBody.namedChildren
            .filter((child) => child.type === 'method_declaration')
            .map((methodNode) => buildJavaExecutableRecord(methodNode, ghostContext, classPropertyTypes))
            .filter((record) => !isJavaNoiseCapability(record.name, config, sourcePath, record));

        if (records.length === 0) {
            continue;
        }

        const entrypoint = records.find((record) => isJavaPrimaryCapabilityMethod(record.name, config));
        if (entrypoint && shouldPromoteJavaCapability(entrypoint.name, sourcePath, className, config, entrypoint)) {
            const foldedRecords = getFoldableCapabilityRecords(records, records, config, JAVA_MAGIC_METHODS);
            triadGraph.push(
                createTriadNode(
                    `${className}.${entrypoint.name}`,
                    category,
                    sourcePath,
                    mergeCapabilityDemand(foldedRecords.map((record) => record.demand)),
                    mergeCapabilityAnswer(foldedRecords.map((record) => record.answer)),
                    `execute ${className} capability pipeline`,
                    buildFoldedLeafIds(className, foldedRecords)
                )
            );
            continue;
        }

        const capabilityMethods = records.filter((record) => shouldPromoteJavaCapability(record.name, sourcePath, className, config, record));
        if (capabilityMethods.length > 0) {
            triadGraph.push(
                ...capabilityMethods.map((record) =>
                    createTriadNode(
                        `${className}.${record.name}`,
                        category,
                        sourcePath,
                        record.demand,
                        record.answer,
                        `execute ${className}.${record.name} capability`
                    )
                )
            );
            continue;
        }

        triadGraph.push(
            createTriadNode(
                `${className}.capability`,
                category,
                sourcePath,
                mergeCapabilityDemand(getFoldableCapabilityRecords(records, records, config, JAVA_MAGIC_METHODS).map((record) => record.demand)),
                mergeCapabilityAnswer(getFoldableCapabilityRecords(records, records, config, JAVA_MAGIC_METHODS).map((record) => record.answer)),
                isJavaCapabilityContainer(className)
                    ? `execute ${className} aggregate capability`
                    : `execute ${className} class capability`,
                buildFoldedLeafIds(className, getFoldableCapabilityRecords(records, records, config, JAVA_MAGIC_METHODS))
            )
        );
    }

    return triadGraph;
}

type JavaExecutableRecord = {
    name: string;
    demand: string[];
    answer: string[];
};

type GoExecutableRecord = {
    name: string;
    demand: string[];
    answer: string[];
};

type RustExecutableRecord = {
    name: string;
    demand: string[];
    answer: string[];
};

type CppExecutableRecord = {
    name: string;
    demand: string[];
    answer: string[];
    ownerName?: string;
};

function buildJavaExecutableRecord(
    executableNode: Parser.SyntaxNode,
    ghostContext: GhostBindingContext,
    classPropertyTypes: Map<string, string>
): JavaExecutableRecord {
    const name = getNameText(executableNode.childForFieldName('name')) ?? 'execute';
    const ghostDemand = collectJavaGhostDemand(executableNode, ghostContext, classPropertyTypes);
    return {
        name,
        demand: mergeDemandEntries(parseJavaParametersAst(executableNode.childForFieldName('parameters')), ghostDemand),
        answer: [normalizeGenericContractType(executableNode.childForFieldName('type')?.text ?? 'void')]
    };
}

function collectSourceFiles(language: TriadLanguage, targetDir: string, config: TriadConfig) {
    const files: string[] = [];
    const includeSourcePath = createSourcePathFilter(targetDir, config);
    const scanScope = describeSourceScanScope(targetDir, config);

    if (scanScope.mode === 'scoped') {
        console.log(chalk.gray(`   - [TreeSitter] 扫描作用域：${scanScope.patterns.join(', ')}`));
    } else {
        console.log(chalk.gray('   - [TreeSitter] 未发现前后端功能目录，回退到全项目源码扫描。'));
    }

    walk(targetDir, (filePath) => {
        const relativePath = path.relative(targetDir, filePath);
        if (!includeSourcePath(relativePath)) {
            return;
        }

        if (filePath.endsWith('.d.ts') || path.basename(filePath).endsWith('types.ts')) {
            return;
        }

        if (language === 'go' && filePath.endsWith('_test.go')) {
            return;
        }

        if (FILE_PATTERNS[language].test(filePath)) {
            files.push(filePath);
        }
    });
    return files.sort();
}

function walk(currentPath: string, visit: (filePath: string) => void) {
    if (!fs.existsSync(currentPath)) {
        return;
    }

    let stat: fs.Stats;
    try {
        stat = fs.statSync(currentPath);
    } catch (error: any) {
        if (isIgnorableFsError(error)) {
            return;
        }
        throw error;
    }
    if (stat.isFile()) {
        try {
            visit(currentPath);
        } catch (error: any) {
            if (isIgnorableFsError(error)) {
                return;
            }
            throw error;
        }
        return;
    }

    if (
        shouldSkipWalkPath(normalizePath(currentPath)) ||
        shouldSkipWalkPath(path.basename(currentPath)) ||
        path.basename(currentPath) === 'target'
    ) {
        return;
    }

    let entries: string[];
    try {
        entries = fs.readdirSync(currentPath);
    } catch (error: any) {
        if (isIgnorableFsError(error)) {
            return;
        }
        throw error;
    }

    for (const entry of entries) {
        walk(path.join(currentPath, entry), visit);
    }
}

function parseTsParameters(parametersNode: Parser.SyntaxNode | null) {
    if (!parametersNode) {
        return ['None'];
    }

    const demand = parametersNode.namedChildren.map((child, index) => {
        if (child.type === 'identifier') {
            return `${normalizeGenericContractType('unknown')} (${child.text})`;
        }

        const nameNode = child.childForFieldName('pattern') ?? child.childForFieldName('name') ?? child.namedChildren[0];
        const typeNode = child.childForFieldName('type');
        const name = getNameText(nameNode) ?? `input${index + 1}`;
        const typeName = normalizeGenericContractType(typeNode?.text.replace(/^:\s*/, '') ?? 'unknown');
        return `${typeName} (${name})`;
    });

    return demand.length > 0 ? demand : ['None'];
}

function parseJsParameters(parametersNode: Parser.SyntaxNode | null) {
    if (!parametersNode) {
        return ['None'];
    }

    const demand = parametersNode.namedChildren.map(
        (child, index) => `${normalizeGenericContractType('unknown')} (${getNameText(child) ?? `input${index + 1}`})`
    );
    return demand.length > 0 ? demand : ['None'];
}

function parsePythonParametersAst(parametersNode: Parser.SyntaxNode | null) {
    if (!parametersNode) {
        return ['None'];
    }

    const demand = parametersNode.namedChildren
        .map((child, index) => {
            const rawText = child.text.replace(/=.*/, '').trim();
            if (!rawText || rawText === 'self' || rawText === 'cls') {
                return '';
            }

            const normalized = rawText.replace(/^\*+/, '');
            const parts = normalized.split(':');
            const name = parts[0]?.trim() || `input${index + 1}`;
            const typeName = normalizePythonContractType(parts[1] ?? 'unknown');
            return `${typeName} (${name})`;
        })
        .filter(Boolean);

    return demand.length > 0 ? demand : ['None'];
}

function parseGoParametersAst(parametersNode: Parser.SyntaxNode | null) {
    if (!parametersNode) {
        return ['None'];
    }

    const demand: string[] = [];
    for (const child of parametersNode.namedChildren.filter((node) => node.type === 'parameter_declaration')) {
        const identifiers = child.namedChildren.filter((node) => node.type === 'identifier');
        const typeNode = child.namedChildren[child.namedChildren.length - 1];
        const typeName = normalizeGenericContractType(typeNode?.text ?? 'unknown');
        if (identifiers.length === 0) {
            demand.push(`${typeName} (input${demand.length + 1})`);
            continue;
        }

        for (const identifier of identifiers) {
            demand.push(`${typeName} (${identifier.text})`);
        }
    }

    return demand.length > 0 ? demand : ['None'];
}

function parseRustParametersAst(parametersNode: Parser.SyntaxNode | null) {
    if (!parametersNode) {
        return ['None'];
    }

    const demand = parametersNode.namedChildren
        .map((child, index) => {
            const rawText = child.text.trim();
            if (!rawText || rawText === 'self' || rawText === '&self' || rawText === '&mut self') {
                return '';
            }

            const parts = rawText.split(':');
            const name = parts[0]?.trim().replace(/^mut\s+/, '') || `input${index + 1}`;
            const typeName = normalizeGenericContractType(parts[1] ?? 'unknown');
            return `${typeName} (${name})`;
        })
        .filter(Boolean);

    return demand.length > 0 ? demand : ['None'];
}

function parseCppParametersAst(parametersNode: Parser.SyntaxNode | null) {
    if (!parametersNode) {
        return ['None'];
    }

    const demand = parametersNode.namedChildren
        .filter((child) => child.type === 'parameter_declaration')
        .map((child, index) => {
            const tokens = child.text.replace(/=.*/, '').trim().split(/\s+/).filter(Boolean);
            if (tokens.length >= 2) {
                const name = tokens[tokens.length - 1].replace(/^[*&]+/, '');
                const typeName = normalizeGenericContractType(tokens.slice(0, -1).join(' '));
                return `${typeName} (${name})`;
            }

            return `${normalizeGenericContractType(child.text)} (input${index + 1})`;
        });

    return demand.length > 0 ? demand : ['None'];
}

function parseJavaParametersAst(parametersNode: Parser.SyntaxNode | null) {
    if (!parametersNode) {
        return ['None'];
    }

    const demand = parametersNode.namedChildren
        .filter((child) => child.type === 'formal_parameter' || child.type === 'spread_parameter')
        .map((child, index) => {
            const rawText = child.text.replace(/@[\w.]+(?:\([^)]*\))?\s*/g, '').trim();
            const tokens = rawText.split(/\s+/).filter(Boolean);
            if (tokens.length >= 2) {
                const name = tokens[tokens.length - 1];
                const typeName = normalizeGenericContractType(tokens.slice(0, -1).join(' '));
                return `${typeName} (${name})`;
            }

            return `${normalizeGenericContractType('unknown')} (input${index + 1})`;
        });

    return demand.length > 0 ? demand : ['None'];
}

function extractPythonReturnType(functionNode: Parser.SyntaxNode) {
    const parametersNode = functionNode.childForFieldName('parameters');
    const blockNode = functionNode.childForFieldName('body');
    const namedChildren = functionNode.namedChildren;
    const parametersIndex = parametersNode ? namedChildren.findIndex((child) => child.id === parametersNode.id) : -1;
    const returnNode =
        parametersIndex >= 0
            ? namedChildren.find((child, index) => index > parametersIndex && (!blockNode || child.id !== blockNode.id))
            : null;
    return normalizePythonContractType(returnNode?.text ?? 'void');
}

function extractGoReturnType(functionNode: Parser.SyntaxNode) {
    const blockNode = functionNode.childForFieldName('body') ?? functionNode.namedChildren[functionNode.namedChildren.length - 1];
    const candidate = [...functionNode.namedChildren]
        .reverse()
        .find((child) => !blockNode || child.id !== blockNode.id && child.type !== 'parameter_list' && child.type !== 'identifier' && child.type !== 'field_identifier');
    return normalizeGenericContractType(candidate?.text ?? 'void');
}

function extractRustReturnType(functionNode: Parser.SyntaxNode) {
    const blockNode = functionNode.childForFieldName('body');
    const parametersNode = functionNode.childForFieldName('parameters');
    const candidate = functionNode.namedChildren.find(
        (child) => child.id !== blockNode?.id && child.id !== parametersNode?.id && child.type !== 'identifier' && child.type !== 'visibility_modifier'
    );
    return normalizeGenericContractType(candidate?.text ?? 'void');
}

function extractCppReturnType(node: Parser.SyntaxNode) {
    const declarator = node.childForFieldName('declarator') ?? node.namedChildren.find((child) => child.type === 'function_declarator');
    const candidates = node.namedChildren.filter((child) => child.id !== declarator?.id && child.type !== 'compound_statement' && child.type !== 'field_declaration_list');
    return normalizeGenericContractType(candidates.map((child) => child.text).join(' ').trim() || 'void');
}

function extractGoReceiverType(receiverNode: Parser.SyntaxNode | null) {
    if (!receiverNode) {
        return '';
    }

    const receiverText = receiverNode.text.replace(/[()]/g, '').trim();
    const match = receiverText.match(/(?:[A-Za-z_]\w*\s+)?\*?([A-Za-z_]\w*)$/);
    return match?.[1] ?? '';
}

function resolveIncludedParsedFile(
    currentFilePath: string,
    includePath: string,
    parsedFiles: ParsedSourceFile[]
) {
    const normalizedInclude = path.normalize(includePath);
    const directCandidate = path.normalize(path.resolve(path.dirname(currentFilePath), normalizedInclude));
    return parsedFiles.find((entry) => {
        const normalized = path.normalize(entry.filePath);
        return normalized === directCandidate || normalized.endsWith(normalizedInclude);
    });
}

function resolveJavaImportedBindingInfo(importPath: string, parsedFiles: ParsedSourceFile[], fallbackName: string) {
    if (!importPath) {
        return createValueBinding(fallbackName);
    }

    const segments = importPath.split('.').filter(Boolean);
    if (segments.length === 0) {
        return createValueBinding(fallbackName);
    }

    const directClass = resolveJavaClassImport(parsedFiles, segments);
    if (directClass) {
        return directClass.binding;
    }

    if (segments.length >= 2) {
        const staticMember = resolveJavaStaticImport(parsedFiles, segments);
        if (staticMember) {
            return staticMember;
        }
    }

    return createValueBinding(fallbackName);
}

function resolveJavaClassImport(parsedFiles: ParsedSourceFile[], segments: string[]) {
    const className = segments[segments.length - 1] ?? '';
    const packageName = segments.slice(0, -1).join('.');
    const targetFile = parsedFiles.find((entry) => {
        return getJavaPackageName(entry.rootNode) === packageName && hasJavaClassNamed(entry.rootNode, className);
    });

    if (!targetFile) {
        return undefined;
    }

    return {
        targetFile,
        binding: createValueBinding(className)
    };
}

function resolveJavaStaticImport(parsedFiles: ParsedSourceFile[], segments: string[]) {
    const memberName = segments[segments.length - 1] ?? '';
    const ownerClassName = segments[segments.length - 2] ?? '';
    const packageName = segments.slice(0, -2).join('.');
    const targetFile = parsedFiles.find((entry) => {
        return getJavaPackageName(entry.rootNode) === packageName && hasJavaClassNamed(entry.rootNode, ownerClassName);
    });

    if (!targetFile) {
        return undefined;
    }

    return lookupJavaStaticMemberBinding(targetFile.rootNode, ownerClassName, memberName) ?? createValueBinding(memberName);
}

function lookupJavaStaticMemberBinding(rootNode: Parser.SyntaxNode, className: string, memberName: string): BindingInfo | undefined {
    const classNode = rootNode.namedChildren.find(
        (node) => node.type === 'class_declaration' && getNameText(node.childForFieldName('name')) === className
    );
    const classBody = classNode?.childForFieldName('body');
    if (!classBody) {
        return undefined;
    }

    for (const child of classBody.namedChildren) {
        if (child.type === 'field_declaration') {
            const typeNode = child.childForFieldName('type') ?? child.namedChildren.find((node) => node.type.endsWith('_type')) ?? null;
            const typeName = normalizeTypeText(typeNode?.text ?? 'unknown');
            for (const declarator of child.namedChildren.filter((node) => node.type === 'variable_declarator')) {
                const localName = getNameText(declarator.childForFieldName('name') ?? declarator.namedChildren[0] ?? null);
                if (localName === memberName) {
                    return createValueBinding(typeName);
                }
            }
        }

        if (child.type === 'method_declaration') {
            const localName = getNameText(child.childForFieldName('name'));
            if (localName === memberName) {
                return createCallableBinding(localName, normalizeTypeText(child.childForFieldName('type')?.text ?? 'unknown'));
            }
        }
    }

    return undefined;
}

function getJavaPackageName(rootNode: Parser.SyntaxNode) {
    const packageNode = rootNode.namedChildren.find((node) => node.type === 'package_declaration');
    const scopedNode = packageNode?.namedChildren.find((node) => node.type === 'scoped_identifier' || node.type === 'identifier');
    return scopedNode?.text ?? '';
}

function hasJavaClassNamed(rootNode: Parser.SyntaxNode, className: string) {
    return rootNode.namedChildren.some(
        (node) => node.type === 'class_declaration' && getNameText(node.childForFieldName('name')) === className
    );
}

function getScopedPathTail(value: string, separator: string) {
    const parts = value.split(separator).filter(Boolean);
    return parts[parts.length - 1] ?? '';
}

function stripQuotedLiteral(value: string) {
    return value.replace(/^['"`]|['"`]$/g, '');
}

function buildFoldedLeafIds(ownerName: string, records: Array<{ name?: string }>) {
    return Array.from(
        new Set(
            records
                .map((record) => record.name?.trim())
                .filter((name): name is string => Boolean(name))
                .map((name) => `${ownerName}.${name}`)
        )
    );
}

function getFoldableCapabilityRecords<T extends { name?: string }>(
    records: T[],
    promotable: T[],
    config: TriadConfig,
    magicMethods: Set<string>
) {
    if (!config.parser.foldHelpersIntoOwner) {
        return promotable;
    }

    return records.filter((record) => {
        const name = record.name?.trim() ?? '';
        return Boolean(name) && !isMagicCapabilityName(name, magicMethods, config);
    });
}

function createTriadNode(
    nodeId: string,
    category: string,
    sourcePath: string,
    demand: string[],
    answer: string[],
    problem?: string,
    foldedLeaves: string[] = []
): TriadNode {
    const methodName = nodeId.split('.').pop() ?? 'execute';
    const governedContracts = applyGhostDemandGovernance(nodeId, sourcePath, demand, answer, ACTIVE_PARSER_CONFIG);
    const promotionReasons = derivePromotionEvidenceReasons(methodName, sourcePath, nodeId.split('.').slice(0, -1).join('.'), demand, answer, []);
    const evidence =
        governedContracts.ghostReads.length > 0 || promotionReasons.length > 0
            ? {
                  ...(governedContracts.ghostReads.length > 0
                      ? {
                            ghostReads: governedContracts.ghostReads
                        }
                      : {}),
                  ...(promotionReasons.length > 0
                      ? {
                            promotionReasons
                        }
                      : {})
              }
            : undefined;
    return {
        nodeId,
        category,
        sourcePath,
        fission: {
            problem: deriveCapabilityProblem(nodeId, sourcePath, demand, answer, problem ?? `execute ${methodName} flow`),
            demand: governedContracts.demand.length > 0 ? governedContracts.demand : ['None'],
            answer: answer.length > 0 ? answer : ['void'],
            evidence
        },
        topology: foldedLeaves.length > 0 ? { foldedLeaves } : undefined
    };
}

export function applyGhostDemandGovernance(
    nodeId: string,
    sourcePath: string,
    demand: string[],
    answer: string[],
    config?: TriadConfig
) {
    const normalizedDemand = demand.length > 0 ? demand.map((entry) => String(entry ?? '').trim()).filter(Boolean) : [];
    const nonGhostDemand = normalizedDemand.filter((entry) => !isGhostDemandEntry(entry) && !/^none$/i.test(entry));
    const ghostPolicy = resolveGhostPolicyForSourcePath(sourcePath, config ?? ACTIVE_PARSER_CONFIG);
    const ghostRecords = normalizedDemand
        .filter((entry) => isGhostDemandEntry(entry))
        .map((entry) => {
            const parsed = parseGhostDemandEntry(entry);
            const score = scoreGhostDemand(parsed, nodeId, sourcePath);
            return {
                ...parsed,
                raw: entry,
                score
            };
        })
        .sort((left, right) => right.score - left.score);

    const keepGhostInDemand =
        ghostPolicy.includeInDemand && shouldKeepGhostInDemand(nodeId, sourcePath, nonGhostDemand, answer);
    const keptGhostRecords = keepGhostInDemand
        ? ghostRecords.filter((entry) => entry.score >= ghostPolicy.minConfidence).slice(0, ghostPolicy.topK)
        : [];
    const keptGhostSet = new Set(keptGhostRecords.map((entry) => entry.raw));
    const governedDemand = dedupeStringEntries([...nonGhostDemand, ...keptGhostRecords.map((entry) => entry.raw)]);

    return {
        demand: governedDemand.length > 0 ? governedDemand : ['None'],
        ghostReads: ghostRecords.map((entry) => ({
            raw: entry.raw,
            mode: entry.mode,
            target: entry.target,
            valueType: entry.valueType,
            retainedInDemand: keptGhostSet.has(entry.raw),
            score: entry.score
        }))
    };
}

function resolveGhostPolicyForSourcePath(sourcePath: string, config?: TriadConfig) {
    const language = detectSourceLanguageFromPath(sourcePath);
    const policyByLanguage = config?.parser.ghostPolicyByLanguage ?? {};
    const fallback = policyByLanguage.default ?? DEFAULT_GHOST_POLICY;
    const languagePolicy = language ? policyByLanguage[language] : undefined;
    return {
        includeInDemand: languagePolicy?.includeInDemand ?? fallback.includeInDemand ?? DEFAULT_GHOST_POLICY.includeInDemand,
        topK: Math.max(0, languagePolicy?.topK ?? fallback.topK ?? DEFAULT_GHOST_POLICY.topK),
        minConfidence: Math.max(0, languagePolicy?.minConfidence ?? fallback.minConfidence ?? DEFAULT_GHOST_POLICY.minConfidence)
    };
}

function detectSourceLanguageFromPath(sourcePath: string): TriadLanguage | undefined {
    const normalized = normalizePath(String(sourcePath ?? '').toLowerCase());
    if (/\.(ts|tsx|mts|cts)$/.test(normalized)) return 'typescript';
    if (/\.(js|jsx|mjs|cjs)$/.test(normalized)) return 'javascript';
    if (/\.py$/.test(normalized)) return 'python';
    if (/\.go$/.test(normalized)) return 'go';
    if (/\.rs$/.test(normalized)) return 'rust';
    if (/\.(cc|cpp|cxx|hpp|hh|h)$/.test(normalized)) return 'cpp';
    if (/\.java$/.test(normalized)) return 'java';
    return undefined;
}

function deriveCapabilityProblem(
    nodeId: string,
    sourcePath: string,
    demand: string[],
    answer: string[],
    rawProblem: string
) {
    if (!isLowSemanticProblem(rawProblem)) {
        return rawProblem;
    }

    const nodeParts = nodeId.split('.').filter(Boolean);
    const methodName = nodeParts[nodeParts.length - 1] ?? 'capability';
    const ownerName = nodeParts.length > 1 ? nodeParts.slice(0, -1).join(' ') : '';
    const capabilityType = inferCapabilityProblemType(nodeId, sourcePath, methodName);
    const verb = inferCapabilityProblemVerb(methodName, rawProblem);
    const subject = buildCapabilityProblemSubject(ownerName, methodName, sourcePath, demand, answer);
    const prefix = isLowSemanticSubject(subject, methodName, sourcePath) ? '[low_semantic_name] ' : '';
    return `${prefix}${capabilityType} Capability: ${verb} ${subject}`;
}

function shouldKeepGhostInDemand(nodeId: string, sourcePath: string, demand: string[], answer: string[]) {
    const signalText = `${nodeId} ${sourcePath}`;
    const hasRuntimeSemanticSignal =
        /(workflow|pipeline|stage|step|node|service|task|worker|queue|scheduler|handler|controller|api|route|event|consumer)/i.test(
            signalText
        ) && !/(types?|schema|dto|entity|model)(\/|$)/i.test(sourcePath);

    const hasMeaningfulContracts = [...demand, ...answer]
        .map((entry) => extractContractTypeText(entry))
        .filter((entry): entry is string => Boolean(entry))
        .some((entry) => !isGenericContractType(entry));

    return hasRuntimeSemanticSignal && hasMeaningfulContracts;
}

function isGhostDemandEntry(entry: string) {
    return /^\[Ghost:[^\]]+\]/i.test(String(entry ?? '').trim());
}

function parseGhostDemandEntry(entry: string) {
    const raw = String(entry ?? '').trim();
    const match = raw.match(/^\[Ghost:(ReadWrite|Read)\]\s*(.*?)\s*\(([^()]+)\)\s*$/i);
    if (!match) {
        return {
            mode: 'read' as const,
            valueType: 'unknown',
            target: raw.replace(/^\[Ghost:[^\]]+\]\s*/i, '') || 'unknown'
        };
    }

    return {
        mode: match[1].toLowerCase() === 'readwrite' ? ('read_write' as const) : ('read' as const),
        valueType: normalizeTypeText(match[2] || 'unknown'),
        target: String(match[3] ?? '').trim() || 'unknown'
    };
}

function scoreGhostDemand(
    ghost: {
        mode: 'read' | 'read_write';
        valueType: string;
        target: string;
    },
    nodeId: string,
    sourcePath: string
) {
    let score = 0;
    if (ghost.mode === 'read_write') score += 2;
    if (!isGenericContractType(ghost.valueType) && !isUnknownLikeType(ghost.valueType)) score += 3;
    if (isRuntimeResourceTarget(ghost.target)) score += 2;
    if (/(service|workflow|worker|task|queue|api|route|handler|controller)/i.test(`${nodeId} ${sourcePath}`)) score += 1;
    if (/^(self|this|ctx|context|state|data)$/i.test(ghost.target)) score -= 2;
    if (isUnknownLikeType(ghost.valueType)) score -= 1;
    return score;
}

function isRuntimeResourceTarget(value: string) {
    return /(redis|cache|db|database|session|postgres|mysql|mongo|minio|s3|queue|worker|task|workflow|pipeline|event|topic|client|http|api|tool|model|provider)/i.test(
        String(value ?? '')
    );
}

function isUnknownLikeType(value: string) {
    return /^(unknown|any|none|null|undefined|module|object|dict|map|list|array|json)$/i.test(
        String(value ?? '').trim()
    );
}

function dedupeStringEntries(entries: string[]) {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const entry of entries) {
        const normalized = String(entry ?? '').trim();
        if (!normalized || seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        result.push(normalized);
    }
    return result;
}

function isLowSemanticProblem(value: string) {
    const normalized = String(value ?? '').trim().toLowerCase();
    return (
        !normalized ||
        /^execute\s+.+\s+(flow|capability|pipeline)$/.test(normalized) ||
        /^execute\s+.+\s+(aggregate|module|class)\s+capability$/.test(normalized) ||
        /^aggregate\s+(module|domain)\s+capability\s+for\s+/.test(normalized)
    );
}

function inferCapabilityProblemType(nodeId: string, sourcePath: string, methodName: string) {
    const text = `${nodeId} ${sourcePath} ${methodName}`.toLowerCase();
    if (/(api|route|endpoint|controller|handler|command|consumer|rpc|webhook)/.test(text)) return 'Interface';
    if (/(workflow|pipeline|orchestrat|stage|sync|plan|apply|dispatch|handoff|protocol)/.test(text)) return 'Workflow';
    if (/(adapter|gateway|repository|storage|database|db|queue|client|filesystem|network|model)/.test(text)) {
        return 'Adapter';
    }
    if (/(policy|rule|guard|auth|permission|decide|resolver|router|validator)/.test(text)) return 'Policy';
    if (/(worker|job|tool|agent|operator|kernel|execute|runner|runtime|healing)/.test(text)) return 'Execution';
    if (/(service|usecase|manager|domain)/.test(text)) return 'Service';
    return 'System';
}

function inferCapabilityProblemVerb(methodName: string, rawProblem: string) {
    const name = methodName.toLowerCase();
    if (/^(handle|process|dispatch|consume|receive)/.test(name)) return 'Handle';
    if (/^(plan|prepare|draft|protocol)/.test(name) || /\bplan\b/i.test(rawProblem)) return 'Plan';
    if (/^(apply|commit|write|save|persist|upsert|generate|create)/.test(name)) return 'Produce';
    if (/^(sync|watch|heal|recover|rollback|restore)/.test(name)) return 'Coordinate';
    if (/^(detect|analyze|diagnose|calculate|resolve|scan|parse|read|load)/.test(name)) return 'Analyze';
    if (/^(execute|run|invoke|call)/.test(name)) return 'Run';
    return 'Provide';
}

function buildCapabilityProblemSubject(
    ownerName: string,
    methodName: string,
    sourcePath: string,
    demand: string[],
    answer: string[]
) {
    const ownerTokens = tokenizeSemanticName(ownerName);
    const methodTokens = tokenizeSemanticName(methodName);
    const sourceTokens = tokenizeSemanticName(getSemanticSourcePathTail(sourcePath));
    const contractTokens = tokenizeSemanticName(getFirstDomainContractName([...answer, ...demand]));
    const tokens = dedupeSemanticTokens([
        ...ownerTokens,
        ...methodTokens.filter((token) => !GENERIC_METHOD_TOKENS.has(token)),
        ...sourceTokens.filter((token) => !GENERIC_SOURCE_TOKENS.has(token)).slice(0, 2),
        ...contractTokens.slice(0, 2)
    ]).filter((token) => !GENERIC_SUBJECT_TOKENS.has(token));

    if (tokens.length === 0) {
        return toHumanCapabilityName(methodName || ownerName || getSemanticSourcePathTail(sourcePath) || 'capability');
    }

    return toHumanCapabilityName(tokens.join(' '));
}

function isLowSemanticSubject(subject: string, methodName: string, sourcePath: string) {
    const tokens = tokenizeSemanticName(`${subject} ${getSemanticSourcePathTail(sourcePath)}`);
    const meaningfulTokens = tokens.filter((token) => !GENERIC_SUBJECT_TOKENS.has(token));
    return meaningfulTokens.length <= 1 && GENERIC_METHOD_TOKENS.has(methodName.toLowerCase());
}

const GENERIC_METHOD_TOKENS = new Set([
    'execute',
    'run',
    'handle',
    'process',
    'dispatch',
    'apply',
    'invoke',
    'call',
    'capability',
    'pipeline',
    'flow'
]);

const GENERIC_SOURCE_TOKENS = new Set(['index', 'main', 'src', 'lib', 'core', 'app', 'server', 'client']);

const GENERIC_SUBJECT_TOKENS = new Set([
    'module',
    'domain',
    'capability',
    'pipeline',
    'flow',
    'aggregate',
    'class',
    'function',
    'method',
    'index',
    'main'
]);

function tokenizeSemanticName(value: string) {
    return String(value ?? '')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_\-./\\:]+/g, ' ')
        .split(/\s+/)
        .map((token) => token.trim().toLowerCase())
        .filter(Boolean);
}

function dedupeSemanticTokens(tokens: string[]) {
    const seen = new Set<string>();
    return tokens.filter((token) => {
        if (seen.has(token)) {
            return false;
        }
        seen.add(token);
        return true;
    });
}

function getSemanticSourcePathTail(sourcePath: string) {
    const normalized = normalizePath(String(sourcePath ?? '').trim()).replace(/\.[^.\/]+$/, '');
    const parts = normalized.split('/').filter(Boolean);
    return parts.slice(-2).join(' ');
}

function getFirstDomainContractName(contracts: string[]) {
    return (
        contracts
            .map((contract) => String(contract ?? '').replace(/^\[[^\]]+\]\s*/, '').split(/[<(]/)[0].trim())
            .find((contract) => contract && !/^(none|void|unknown|\[generic\])/i.test(contract)) ?? ''
    );
}

function toHumanCapabilityName(value: string) {
    const text = tokenizeSemanticName(value)
        .filter((token) => token.length > 0)
        .join(' ');
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Capability';
}

function dedupeNodes(nodes: TriadNode[]) {
    const seen = new Set<string>();
    return nodes.filter((node) => {
        const key = [node.nodeId, normalizePath(node.sourcePath).toLowerCase(), String(node.category ?? '').toLowerCase()].join('::');
        if (seen.has(key)) {
            return false;
        }

        seen.add(key);
        return true;
    });
}

function aggregateNodesForScanMode(nodes: TriadNode[], config: TriadConfig) {
    if (config.parser.scanMode === 'module') {
        return buildAggregatedNodes(nodes, config, 'module');
    }

    if (config.parser.scanMode === 'domain') {
        return buildAggregatedNodes(nodes, config, 'domain');
    }

    return nodes;
}

function buildAggregatedNodes(nodes: TriadNode[], config: TriadConfig, level: 'module' | 'domain') {
    const producersByContract = new Map<string, Set<string>>();
    const consumersByContract = new Map<string, Set<string>>();
    const grouped = new Map<
        string,
        {
            nodeId: string;
            category: string;
            sourcePath: string;
            members: TriadNode[];
        }
    >();

    for (const node of nodes) {
        for (const answer of node.fission.answer ?? []) {
            const key = normalizeAggregationContractKey(answer, false, config);
            if (!key) continue;
            ensureStringSet(producersByContract, key).add(node.nodeId);
        }

        for (const demand of node.fission.demand ?? []) {
            const key = normalizeAggregationContractKey(demand, true, config);
            if (!key) continue;
            ensureStringSet(consumersByContract, key).add(node.nodeId);
        }
    }

    for (const node of nodes) {
        const groupId = level === 'module' ? getModuleAggregateId(node) : getDomainAggregateId(node, config);
        const aggregate =
            grouped.get(groupId) ??
            {
                nodeId: groupId,
                category: node.category,
                sourcePath: level === 'module' ? normalizeModuleSourcePath(node.sourcePath) : deriveDomainSourcePath(node, config),
                members: []
            };
        aggregate.members.push(node);
        grouped.set(groupId, aggregate);
    }

    return Array.from(grouped.values()).map((group) =>
        buildAggregateNode(group, producersByContract, consumersByContract, config, level)
    );
}

function buildAggregateNode(
    group: { nodeId: string; category: string; sourcePath: string; members: TriadNode[] },
    producersByContract: Map<string, Set<string>>,
    consumersByContract: Map<string, Set<string>>,
    config: TriadConfig,
    level: 'module' | 'domain'
): TriadNode {
    const memberIds = new Set(group.members.map((member) => member.nodeId));
    const demandByKey = new Map<string, string>();
    const answerByKey = new Map<string, string>();

    for (const member of group.members) {
        for (const demand of member.fission.demand ?? []) {
            const raw = String(demand ?? '').trim();
            if (!raw || /^none$/i.test(raw)) {
                continue;
            }

            const isGhostDemand = /^\[Ghost/i.test(raw);
            const key = normalizeAggregationContractKey(raw, true, config);
            if (!key && !isGhostDemand) {
                continue;
            }

            const resolvedKey = key ?? `ghost:${raw}`;
            const internalProducers = key
                ? Array.from(producersByContract.get(key) ?? []).some((producerId) => memberIds.has(producerId))
                : false;
            if (!internalProducers) {
                if (!demandByKey.has(resolvedKey)) {
                    demandByKey.set(resolvedKey, raw);
                }
            }
        }

        for (const answer of member.fission.answer ?? []) {
            const raw = String(answer ?? '').trim();
            if (!raw || /^void$/i.test(raw)) {
                continue;
            }

            const key = normalizeAggregationContractKey(raw, false, config);
            if (!key) {
                continue;
            }

            const consumers = Array.from(consumersByContract.get(key) ?? []);
            const hasExternalConsumer = consumers.some((consumerId) => !memberIds.has(consumerId));
            if (hasExternalConsumer || consumers.length === 0) {
                if (!answerByKey.has(key)) {
                    answerByKey.set(key, raw);
                }
            }
        }
    }

    const problem = deriveCapabilityProblem(
        group.nodeId,
        group.sourcePath,
        Array.from(demandByKey.values()),
        Array.from(answerByKey.values()),
        level === 'module'
            ? `aggregate module capability for ${group.sourcePath}`
            : `aggregate domain capability for ${group.sourcePath || group.nodeId}`
    );

    return {
        nodeId: group.nodeId,
        category: group.category,
        sourcePath: group.sourcePath,
        fission: {
            problem,
            demand: demandByKey.size > 0 ? Array.from(demandByKey.values()).sort() : ['None'],
            answer: answerByKey.size > 0 ? Array.from(answerByKey.values()).sort() : ['void']
        }
    };
}

function getModuleAggregateId(node: TriadNode) {
    const normalized = normalizeModuleSourcePath(node.sourcePath);
    return `Module.${normalized.replace(/\//g, '.')}`;
}

function normalizeModuleSourcePath(sourcePath: string) {
    return normalizePath(String(sourcePath ?? '').trim()).replace(/\.[^.\/]+$/, '').replace(/^\.?\//, '') || 'root';
}

function getDomainAggregateId(node: TriadNode, config: TriadConfig) {
    const domainPath = deriveDomainPath(node, config);
    return `Domain.${domainPath.replace(/\//g, '.')}`;
}

function deriveDomainSourcePath(node: TriadNode, config: TriadConfig) {
    return deriveDomainPath(node, config);
}

function deriveDomainPath(node: TriadNode, config: TriadConfig) {
    const sourcePath = normalizePath(String(node.sourcePath ?? '').trim()).replace(/^\.?\//, '');
    const normalized = sourcePath.toLowerCase();
    const categoryPatterns = (config.categories[node.category as keyof typeof config.categories] ?? [])
        .map((pattern) => normalizePath(pattern).replace(/^\.?\//, '').toLowerCase())
        .sort((left, right) => right.length - left.length);

    for (const pattern of categoryPatterns) {
        if (!pattern) continue;
        if (normalized === pattern || normalized.startsWith(`${pattern}/`)) {
            const remainder = sourcePath.slice(pattern.length).replace(/^\/+/, '');
            const firstSegment = remainder.split('/').filter(Boolean)[0];
            return firstSegment ? `${node.category}/${firstSegment}` : `${node.category}`;
        }
    }

    const parts = sourcePath.split('/').filter(Boolean);
    if (parts.length === 0) {
        return node.category;
    }

    return parts.length > 1 ? `${node.category}/${parts[0]}` : `${node.category}`;
}

function normalizeAggregationContractKey(entry: string, isDemand: boolean, config: TriadConfig) {
    const raw = String(entry ?? '').trim();
    if (!raw) return null;
    if (isDemand && /^\[Ghost/i.test(raw)) return null;

    const extracted = extractContractTypeText(raw);
    if (!extracted) {
        return null;
    }

    return isIgnoredContractType(extracted, config)
        ? null
        : extracted
              .replace(/^typing\./i, '')
              .replace(/\s+/g, ' ')
              .replace(/\s*([<>{}()[\]|,:=&?])\s*/g, '$1');
}

function ensureStringSet(map: Map<string, Set<string>>, key: string) {
    const existing = map.get(key);
    if (existing) {
        return existing;
    }

    const created = new Set<string>();
    map.set(key, created);
    return created;
}

function normalizeTypeText(value: string) {
    const normalized = value.trim().replace(/\s+/g, ' ');
    return normalized || 'unknown';
}

function normalizeGenericContractType(value: string) {
    const normalized = normalizeTypeText(value.replace(/^:\s*/, ''));
    return isGenericContractType(normalized) ? `[Generic] ${normalized}` : normalized;
}

function normalizePythonContractType(value: string) {
    const normalized = normalizeTypeText(value.replace(/^:\s*/, ''));
    return isGenericContractType(normalized) ? `[Generic] ${normalized}` : normalized;
}

function isGenericContractType(value: string) {
    const compact = value
        .trim()
        .toLowerCase()
        .replace(/^typing\./g, '')
        .replace(/\s+/g, '');

    return (
        compact === 'str' ||
        compact === 'string' ||
        compact === 'std::string' ||
        compact === 'String'.toLowerCase() ||
        compact === 'int' ||
        compact === 'integer' ||
        compact === 'long' ||
        compact === 'short' ||
        compact === 'byte' ||
        compact === 'usize' ||
        compact === 'isize' ||
        compact === 'u8' ||
        compact === 'u16' ||
        compact === 'u32' ||
        compact === 'u64' ||
        compact === 'u128' ||
        compact === 'i8' ||
        compact === 'i16' ||
        compact === 'i32' ||
        compact === 'i64' ||
        compact === 'i128' ||
        compact === 'bool' ||
        compact === 'boolean' ||
        compact === 'number' ||
        compact === 'float' ||
        compact === 'double' ||
        compact === 'f32' ||
        compact === 'f64' ||
        compact === 'bigint' ||
        compact === 'symbol' ||
        compact === 'dict' ||
        compact === 'list' ||
        compact === 'vec' ||
        compact === 'set' ||
        compact === 'tuple' ||
        compact === 'any' ||
        compact === 'unknown' ||
        compact === 'object' ||
        compact === 'dict[str,any]' ||
        compact === 'record<string,any>' ||
        compact === 'record<string,unknown>' ||
        compact === 'map<string,any>' ||
        compact === 'map<string,unknown>' ||
        compact === 'map<string,object>' ||
        compact === 'mapping[str,any]' ||
        compact === 'list[any]' ||
        compact === 'array<any>' ||
        compact === 'array<unknown>' ||
        compact === 'sequence[any]'
    );
}

function hasModifier(node: Parser.SyntaxNode, modifiers: string[]) {
    const modifierSet = new Set(modifiers);
    return node.namedChildren.some((child) => child.type.includes('modifier') && modifierSet.has(child.text.trim()));
}

function hasNearbyTriadTag(source: string, nodeStartIndex: number, config: TriadConfig) {
    const prefix = source.slice(Math.max(0, nodeStartIndex - 600), nodeStartIndex);
    const supportedTags = [
        config.parser.jsDocTags.triadNode,
        config.parser.jsDocTags.leftBranch,
        config.parser.jsDocTags.rightBranch
    ];
    return supportedTags.some((tag) => prefix.includes(`@${tag}`));
}

function toPascalCase(value: string) {
    return value
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');
}

function getNameText(node: Parser.SyntaxNode | null | undefined): string {
    if (!node) {
        return '';
    }

    if (node.type === 'identifier' || node.type.endsWith('_identifier') || node.type === 'property_identifier') {
        return node.text;
    }

    return node.namedChildren.length > 0 ? getNameText(node.namedChildren[node.namedChildren.length - 1]) : node.text;
}

function getFirstNamedChildText(node: Parser.SyntaxNode, candidateTypes: string[]) {
    const target = node.namedChildren.find((child) => candidateTypes.includes(child.type));
    return target?.text ?? '';
}
