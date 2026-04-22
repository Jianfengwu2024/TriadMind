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
import { TriadConfig, TriadLanguage, resolveCategoryFromConfig, shouldExcludeSourcePath } from './config';
import { scanTreeSitterGhostReferences, TreeSitterGhostAccessMode } from './treeSitterGhostScanner';
import { normalizePath } from './workspace';

interface TriadNode {
    nodeId: string;
    category: string;
    sourcePath: string;
    fission: {
        problem: string;
        demand: string[];
        answer: string[];
    };
}

interface ParsedSourceFile {
    filePath: string;
    sourcePath: string;
    source: string;
    rootNode: Parser.SyntaxNode;
}

interface BindingInfo {
    typeName: string;
}

interface GhostBindingContext {
    importedBindings: Map<string, BindingInfo>;
    moduleBindings: Map<string, BindingInfo>;
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

export function runTreeSitterParser(
    language: TriadLanguage,
    targetDir: string,
    outputPath: string,
    config: TriadConfig
) {
    console.log(chalk.gray(`   - [Parser] scanning ${language} via tree-sitter...`));

    const parser = new Parser();
    parser.setLanguage(TREE_SITTER_LANGUAGES[language]);

    const triadGraph: TriadNode[] = [];
    const files = collectSourceFiles(language, targetDir, config);
    const parsedFiles: ParsedSourceFile[] = [];

    for (const filePath of files) {
        const source = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
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
        triadGraph.push(
            ...collectLanguageNodes(
                language,
                parsedFile.rootNode,
                parsedFile.source,
                parsedFile.filePath,
                parsedFile.sourcePath,
                category,
                config,
                parsedFiles
            )
        );
    }

    const deduped = dedupeNodes(triadGraph).sort((left, right) => left.nodeId.localeCompare(right.nodeId));
    fs.writeFileSync(outputPath, JSON.stringify(deduped, null, 2), 'utf-8');
    console.log(chalk.gray(`   - [Parser] tree-sitter scan complete, extracted ${deduped.length} leaf nodes.`));
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
            return collectPythonNodes(rootNode, filePath, sourcePath, category, parsedFiles);
        case 'go':
            return collectGoNodes(rootNode, filePath, sourcePath, category, parsedFiles);
        case 'rust':
            return collectRustNodes(rootNode, filePath, sourcePath, category, parsedFiles);
        case 'cpp':
            return collectCppNodes(rootNode, filePath, sourcePath, category);
        case 'java':
            return collectJavaNodes(rootNode, sourcePath, category);
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
    const triadGraph: TriadNode[] = [];
    const ghostContext = buildGhostBindingContext(rootNode, filePath, parsedFiles);

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
                    [normalizeTypeText(methodNode.childForFieldName('return_type')?.text.replace(/^:\s*/, '') ?? 'void')]
                )
            );
        }
    }

    const moduleName = toPascalCase(path.basename(filePath).replace(/\.(tsx?|mts|cts)$/, ''));
    for (const exportNode of rootNode.descendantsOfType('export_statement')) {
        const fnNode = exportNode.namedChildren.find((node) => node.type === 'function_declaration');
        if (!fnNode) {
            continue;
        }

        const functionName = getNameText(fnNode.childForFieldName('name'));
        if (!functionName) {
            continue;
        }

        if (!config.parser.includeUntaggedExports && !hasNearbyTriadTag(source, exportNode.startIndex, config)) {
            continue;
        }

        const ghostDemand = collectTypeScriptGhostDemand(fnNode, ghostContext);
        triadGraph.push(
            createTriadNode(
                `${moduleName}.${functionName}`,
                category,
                sourcePath,
                mergeDemandEntries(parseTsParameters(fnNode.childForFieldName('parameters')), ghostDemand),
                [normalizeTypeText(fnNode.childForFieldName('return_type')?.text.replace(/^:\s*/, '') ?? 'void')]
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
                    bindings.set(localName, {
                        typeName: resolveImportedBindingType(targetFile, 'default', localName)
                    });
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

                        bindings.set(localName, {
                            typeName: resolveImportedBindingType(targetFile, importedName, localName)
                        });
                    }
                    continue;
                }

                if (child.type === 'namespace_import') {
                    const localName = getFirstNamedChildText(child, ['identifier']);
                    if (localName) {
                        bindings.set(localName, {
                            typeName: 'module'
                        });
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

                bindings.set(localName, {
                    typeName: inferTypeScriptDeclaratorType(declarator, localName)
                });
            }
            continue;
        }

        if (declarationNode.type === 'function_declaration') {
            const localName = getNameText(declarationNode.childForFieldName('name'));
            if (localName) {
                bindings.set(localName, {
                    typeName: localName
                });
            }
            continue;
        }

        if (declarationNode.type === 'class_declaration') {
            const localName = getNameText(declarationNode.childForFieldName('name'));
            if (localName) {
                bindings.set(localName, {
                    typeName: localName
                });
            }
            continue;
        }

        if (declarationNode.type === 'enum_declaration') {
            const localName = getNameText(declarationNode.childForFieldName('name'));
            if (localName) {
                bindings.set(localName, {
                    typeName: localName
                });
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

function resolveImportedBindingType(
    targetFile: ParsedSourceFile | undefined,
    importedName: string,
    localName: string
) {
    if (!targetFile) {
        return guessBindingTypeFromName(importedName || localName);
    }

    const exportedType = lookupExportedBindingType(targetFile.rootNode, importedName || localName);
    return exportedType || guessBindingTypeFromName(importedName || localName);
}

function lookupExportedBindingType(rootNode: Parser.SyntaxNode, bindingName: string) {
    for (const child of rootNode.namedChildren.filter((node) => node.type === 'export_statement')) {
        const declarationNode = child.namedChildren[0];
        if (!declarationNode) {
            continue;
        }

        if (declarationNode.type === 'class_declaration') {
            const name = getNameText(declarationNode.childForFieldName('name'));
            if (name === bindingName) {
                return bindingName;
            }
        }

        if (declarationNode.type === 'function_declaration') {
            const name = getNameText(declarationNode.childForFieldName('name'));
            if (name === bindingName) {
                return bindingName;
            }
        }

        if (declarationNode.type === 'lexical_declaration' || declarationNode.type === 'variable_declaration') {
            for (const declarator of declarationNode.namedChildren.filter((node) => node.type === 'variable_declarator')) {
                const nameNode = declarator.childForFieldName('name') ?? declarator.namedChildren[0];
                const localName = extractBindingNames(nameNode)[0];
                if (localName === bindingName) {
                    return inferTypeScriptDeclaratorType(declarator, bindingName);
                }
            }
        }
    }

    return '';
}

function inferTypeScriptDeclaratorType(declarator: Parser.SyntaxNode, fallbackName: string) {
    const explicitType = normalizeTypeAnnotationNode(
        declarator.childForFieldName('type') ?? declarator.namedChildren.find((node) => node.type === 'type_annotation') ?? null
    );
    if (explicitType && explicitType !== 'unknown') {
        return explicitType;
    }

    const valueNode = declarator.childForFieldName('value') ?? declarator.namedChildren[1] ?? null;
    return inferTypeScriptValueType(valueNode, fallbackName);
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
        return inferTypeScriptObjectType(valueNode);
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

    if (valueNode.type === 'new_expression') {
        const constructorNode = valueNode.namedChildren.find(
            (node) => node.type === 'identifier' || node.type === 'type_identifier' || node.type === 'member_expression'
        );
        return normalizeTypeText(getNameText(constructorNode) || fallbackName);
    }

    return guessBindingTypeFromName(fallbackName);
}

function inferTypeScriptObjectType(objectNode: Parser.SyntaxNode) {
    const fields: string[] = [];

    for (const child of objectNode.namedChildren) {
        if (child.type === 'pair') {
            const keyNode = child.namedChildren[0];
            const valueNode = child.namedChildren[1] ?? null;
            const key = getNameText(keyNode);
            if (!key) {
                continue;
            }

            fields.push(`${key}: ${inferTypeScriptValueType(valueNode, key)}`);
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

    const topLevelNodes = config.parser.includeUntaggedExports ? rootNode.namedChildren : rootNode.namedChildren.filter((node) => node.type === 'export_statement');
    for (const topLevelNode of topLevelNodes) {
        if (topLevelNode.type === 'export_statement') {
            triadGraph.push(...collectJavaScriptExportNode(topLevelNode, moduleName, category, sourcePath, ghostContext));
            continue;
        }

        if (topLevelNode.type === 'function_declaration') {
            const functionName = getNameText(topLevelNode.childForFieldName('name'));
            if (functionName) {
                const ghostDemand = collectTypeScriptGhostDemand(topLevelNode, ghostContext);
                triadGraph.push(
                    createTriadNode(
                        `${moduleName}.${functionName}`,
                        category,
                        sourcePath,
                        mergeDemandEntries(parseJsParameters(topLevelNode.childForFieldName('parameters')), ghostDemand),
                        ['unknown']
                    )
                );
            }
            continue;
        }

        if (topLevelNode.type === 'lexical_declaration' || topLevelNode.type === 'variable_declaration') {
            triadGraph.push(...collectJavaScriptVariableFunctions(topLevelNode, moduleName, category, sourcePath, ghostContext));
        }
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
                    bindings.set(localName, {
                        typeName: resolveJavaScriptImportedBindingType(targetFile, 'default', localName)
                    });
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

                        bindings.set(localName, {
                            typeName: resolveJavaScriptImportedBindingType(targetFile, importedName, localName)
                        });
                    }
                    continue;
                }

                if (child.type === 'namespace_import') {
                    const localName = getFirstNamedChildText(child, ['identifier']);
                    if (localName) {
                        bindings.set(localName, {
                            typeName: 'module'
                        });
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
            bindings.set(localName, {
                typeName: resolveJavaScriptImportedBindingType(targetFile, localName, localName)
            });
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

                bindings.set(localName, {
                    typeName: inferJavaScriptDeclaratorType(declarator, localName)
                });
            }
            continue;
        }

        if (declarationNode.type === 'function_declaration') {
            const localName = getNameText(declarationNode.childForFieldName('name'));
            if (localName) {
                bindings.set(localName, {
                    typeName: localName
                });
            }
            continue;
        }

        if (declarationNode.type === 'class_declaration') {
            const localName = getNameText(declarationNode.childForFieldName('name'));
            if (localName) {
                bindings.set(localName, {
                    typeName: localName
                });
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

function collectJavaScriptExportNode(
    exportNode: Parser.SyntaxNode,
    moduleName: string,
    category: string,
    sourcePath: string,
    ghostContext: GhostBindingContext
) {
    const triadGraph: TriadNode[] = [];
    const functionNode = exportNode.namedChildren.find((node) => node.type === 'function_declaration');
    if (functionNode) {
        const functionName = getNameText(functionNode.childForFieldName('name'));
        if (functionName) {
            const ghostDemand = collectTypeScriptGhostDemand(functionNode, ghostContext);
            triadGraph.push(
                createTriadNode(
                    `${moduleName}.${functionName}`,
                    category,
                    sourcePath,
                    mergeDemandEntries(parseJsParameters(functionNode.childForFieldName('parameters')), ghostDemand),
                    ['unknown']
                )
            );
        }
        return triadGraph;
    }

    const declarationNode = exportNode.namedChildren.find(
        (node) => node.type === 'lexical_declaration' || node.type === 'variable_declaration'
    );
    if (declarationNode) {
        triadGraph.push(...collectJavaScriptVariableFunctions(declarationNode, moduleName, category, sourcePath, ghostContext));
    }

    return triadGraph;
}

function collectJavaScriptVariableFunctions(
    declarationNode: Parser.SyntaxNode,
    moduleName: string,
    category: string,
    sourcePath: string,
    ghostContext: GhostBindingContext
) {
    const triadGraph: TriadNode[] = [];

    for (const declarator of declarationNode.namedChildren.filter((node) => node.type === 'variable_declarator')) {
        const nameNode = declarator.childForFieldName('name');
        const valueNode = declarator.childForFieldName('value');
        const functionName = getNameText(nameNode);

        if (!functionName || !valueNode) {
            continue;
        }

        if (valueNode.type !== 'arrow_function' && valueNode.type !== 'function') {
            continue;
        }

        const ghostDemand = collectTypeScriptGhostDemand(valueNode, ghostContext);
        triadGraph.push(
            createTriadNode(
                `${moduleName}.${functionName}`,
                category,
                sourcePath,
                mergeDemandEntries(parseJsParameters(valueNode.childForFieldName('parameters')), ghostDemand),
                ['unknown']
            )
        );
    }

    return triadGraph;
}

function resolveJavaScriptImportedBindingType(
    targetFile: ParsedSourceFile | undefined,
    importedName: string,
    localName: string
) {
    if (!targetFile) {
        return guessBindingTypeFromName(importedName || localName);
    }

    const exportedType = lookupJavaScriptExportedBindingType(targetFile.rootNode, importedName || localName);
    return exportedType || guessBindingTypeFromName(importedName || localName);
}

function lookupJavaScriptExportedBindingType(rootNode: Parser.SyntaxNode, bindingName: string) {
    for (const child of rootNode.namedChildren.filter((node) => node.type === 'export_statement')) {
        const declarationNode = child.namedChildren[0];
        if (!declarationNode) {
            continue;
        }

        if (declarationNode.type === 'class_declaration') {
            const name = getNameText(declarationNode.childForFieldName('name'));
            if (name === bindingName || bindingName === 'default') {
                return name || bindingName;
            }
        }

        if (declarationNode.type === 'function_declaration') {
            const name = getNameText(declarationNode.childForFieldName('name'));
            if (name === bindingName || bindingName === 'default') {
                return name || bindingName;
            }
        }

        if (declarationNode.type === 'lexical_declaration' || declarationNode.type === 'variable_declaration') {
            for (const declarator of declarationNode.namedChildren.filter((node) => node.type === 'variable_declarator')) {
                const nameNode = declarator.childForFieldName('name') ?? declarator.namedChildren[0];
                const localName = extractBindingNames(nameNode)[0];
                if (localName === bindingName || bindingName === 'default') {
                    return inferJavaScriptDeclaratorType(declarator, localName || bindingName);
                }
            }
        }
    }

    return '';
}

function inferJavaScriptDeclaratorType(declarator: Parser.SyntaxNode, fallbackName: string) {
    const valueNode = declarator.childForFieldName('value') ?? declarator.namedChildren[1] ?? null;
    return inferJavaScriptValueType(valueNode, fallbackName);
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
    parsedFiles: ParsedSourceFile[]
) {
    const triadGraph: TriadNode[] = [];
    const moduleName = toPascalCase(path.basename(sourcePath).replace(/\.py$/, ''));
    const ghostContext = buildPythonGhostContext(rootNode, filePath, parsedFiles);

    for (const node of rootNode.namedChildren) {
        if (node.type === 'class_definition') {
            const className = getNameText(node.childForFieldName('name'));
            const classBody = node.childForFieldName('body');
            if (!className || !classBody) {
                continue;
            }

            const classPropertyTypes = collectPythonClassPropertyTypes(node, ghostContext);
            for (const methodNode of classBody.namedChildren.filter((child) => child.type === 'function_definition')) {
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

        if (node.type === 'function_definition') {
            const functionName = getNameText(node.childForFieldName('name'));
            if (!functionName || functionName.startsWith('_')) {
                continue;
            }

            const ghostDemand = collectPythonGhostDemand(node, ghostContext);
            triadGraph.push(
                createTriadNode(
                    `${moduleName}.${functionName}`,
                    category,
                    sourcePath,
                    mergeDemandEntries(parsePythonParametersAst(node.childForFieldName('parameters')), ghostDemand),
                    [extractPythonReturnType(node)]
                )
            );
        }
    }

    return triadGraph;
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
        const importedNodes = importFrom.namedChildren.filter((node, index) => node.type === 'dotted_name' && index > 0);

        for (const importedNode of importedNodes) {
            const localName = importedNode.text;
            if (!localName) {
                continue;
            }

            bindings.set(localName, {
                typeName: resolvePythonImportedBindingType(targetFile, localName)
            });
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

                bindings.set(localName, {
                    typeName: 'module'
                });
                continue;
            }

            if (child.type === 'dotted_name') {
                const localName = child.text.split('.').pop() ?? '';
                if (!localName) {
                    continue;
                }

                bindings.set(localName, {
                    typeName: 'module'
                });
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
                bindings.set(localName, { typeName: localName });
            }
            continue;
        }

        if (child.type === 'class_definition') {
            const localName = getNameText(child.childForFieldName('name'));
            if (localName) {
                bindings.set(localName, { typeName: localName });
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

            bindings.set(localName, {
                typeName: inferPythonAssignmentType(assignmentNode, localName)
            });
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

function resolvePythonImportedBindingType(targetFile: ParsedSourceFile | undefined, bindingName: string) {
    if (!targetFile) {
        return guessBindingTypeFromName(bindingName);
    }

    const exportedType = lookupPythonExportedBindingType(targetFile.rootNode, bindingName);
    return exportedType || guessBindingTypeFromName(bindingName);
}

function lookupPythonExportedBindingType(rootNode: Parser.SyntaxNode, bindingName: string) {
    for (const child of rootNode.namedChildren) {
        if (child.type === 'class_definition') {
            const name = getNameText(child.childForFieldName('name'));
            if (name === bindingName) {
                return name;
            }
            continue;
        }

        if (child.type === 'function_definition') {
            const name = getNameText(child.childForFieldName('name'));
            if (name === bindingName) {
                return name;
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
                return inferPythonAssignmentType(assignmentNode, bindingName);
            }
        }
    }

    return '';
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
        return binding?.typeName ?? guessBindingTypeFromName(valueNode.text);
    }

    if (valueNode.type === 'attribute') {
        const rootName = getNameText(valueNode.namedChildren[0] ?? null);
        const binding = ghostContext?.importedBindings.get(rootName) ?? ghostContext?.moduleBindings.get(rootName);
        return binding?.typeName ?? guessBindingTypeFromName(rootName || fallbackName);
    }

    if (valueNode.type === 'call') {
        const callee = valueNode.namedChildren[0] ?? null;
        return guessBindingTypeFromName(getNameText(callee) || fallbackName);
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
                bindings.set(localName, { typeName: localName });
            }
            continue;
        }

        if (child.type === 'type_declaration') {
            for (const typeSpec of child.namedChildren.filter((node) => node.type === 'type_spec')) {
                const localName = getNameText(typeSpec.namedChildren.find((node) => node.type === 'type_identifier') ?? null);
                if (localName) {
                    bindings.set(localName, { typeName: localName });
                }
            }
            continue;
        }

        if (child.type !== 'var_declaration' && child.type !== 'const_declaration') {
            continue;
        }

        for (const specNode of child.namedChildren.filter((node) => node.type === 'var_spec' || node.type === 'const_spec')) {
            const nameNodes = specNode.namedChildren.filter((node) => node.type === 'identifier');
            if (nameNodes.length === 0) {
                continue;
            }

            const typeName = inferGoBindingType(specNode, nameNodes[0]?.text ?? 'unknown');
            for (const nameNode of nameNodes) {
                bindings.set(nameNode.text, { typeName });
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

function inferGoBindingType(specNode: Parser.SyntaxNode, fallbackName: string) {
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
        return guessBindingTypeFromName(getNameText(valueNode.namedChildren[0] ?? null) || fallbackName);
    }

    if (valueNode.type === 'identifier') {
        return guessBindingTypeFromName(valueNode.text);
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

function buildRustGhostContext(rootNode: Parser.SyntaxNode, filePath: string, parsedFiles: ParsedSourceFile[]) {
    return {
        importedBindings: collectRustImportedBindings(rootNode, filePath, parsedFiles),
        moduleBindings: collectRustModuleBindings(rootNode)
    };
}

function collectRustImportedBindings(
    rootNode: Parser.SyntaxNode,
    _filePath: string,
    _parsedFiles: ParsedSourceFile[]
) {
    const bindings = new Map<string, BindingInfo>();

    for (const useDeclaration of rootNode.descendantsOfType('use_declaration')) {
        for (const binding of collectRustUseBindings(useDeclaration)) {
            bindings.set(binding.localName, {
                typeName: binding.typeName
            });
        }
    }

    return bindings;
}

function collectRustUseBindings(node: Parser.SyntaxNode): Array<{ localName: string; typeName: string }> {
    if (node.type === 'use_as_clause') {
        const aliasNode = node.namedChildren[node.namedChildren.length - 1] ?? null;
        const importedNode = node.namedChildren[0] ?? null;
        const localName = getNameText(aliasNode);
        const importedName = getNameText(importedNode);
        if (!localName) {
            return [];
        }

        return [{ localName, typeName: guessBindingTypeFromName(importedName || localName) }];
    }

    if (node.type === 'scoped_use_list') {
        const useListNode = node.namedChildren.find((child) => child.type === 'use_list') ?? null;
        return useListNode ? useListNode.namedChildren.flatMap((child) => collectRustUseBindings(child)) : [];
    }

    if (node.type === 'use_list') {
        return node.namedChildren.flatMap((child) => collectRustUseBindings(child));
    }

    if (node.type === 'scoped_identifier') {
        if (node.parent?.type === 'use_as_clause') {
            return [];
        }

        const localName = getNameText(node);
        return localName ? [{ localName, typeName: guessBindingTypeFromName(localName) }] : [];
    }

    if (node.type === 'identifier' && (node.parent?.type === 'use_declaration' || node.parent?.type === 'use_list')) {
        return [{ localName: node.text, typeName: guessBindingTypeFromName(node.text) }];
    }

    return node.namedChildren.flatMap((child) => collectRustUseBindings(child));
}

function collectRustModuleBindings(rootNode: Parser.SyntaxNode) {
    const bindings = new Map<string, BindingInfo>();

    for (const child of rootNode.namedChildren) {
        if (child.type === 'function_item') {
            const localName = getNameText(child.childForFieldName('name'));
            if (localName) {
                bindings.set(localName, { typeName: localName });
            }
            continue;
        }

        if (child.type === 'struct_item' || child.type === 'enum_item' || child.type === 'trait_item' || child.type === 'type_item') {
            const localName = getFirstNamedChildText(child, ['type_identifier']);
            if (localName) {
                bindings.set(localName, { typeName: localName });
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
        bindings.set(localName, {
            typeName: normalizeTypeText(explicitType?.text ?? guessBindingTypeFromName(localName))
        });
    }

    return bindings;
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

function collectCppNodes(rootNode: Parser.SyntaxNode, filePath: string, sourcePath: string, category: string) {
    const triadGraph: TriadNode[] = [];
    const moduleName = toPascalCase(path.basename(filePath).replace(/\.(cpp|cc|cxx|hpp|hh|h)$/i, ''));

    for (const node of rootNode.namedChildren) {
        if (node.type === 'class_specifier' || node.type === 'struct_specifier') {
            const className = getFirstNamedChildText(node, ['type_identifier']);
            const body = node.childForFieldName('body') ?? node.namedChildren.find((child) => child.type === 'field_declaration_list');
            if (!className || !body) {
                continue;
            }

            for (const field of body.namedChildren.filter((child) => child.type === 'field_declaration')) {
                const declarator = field.descendantsOfType('function_declarator')[0];
                const methodName = getNameText(declarator?.childForFieldName('declarator') ?? declarator?.childForFieldName('name') ?? declarator?.namedChildren[0]);
                if (!declarator || !methodName || methodName === className || methodName === `~${className}`) {
                    continue;
                }

                triadGraph.push(
                    createTriadNode(
                        `${className}.${methodName}`,
                        category,
                        sourcePath,
                        parseCppParametersAst(
                            declarator.childForFieldName('parameters') ??
                                declarator.namedChildren.find((child) => child.type === 'parameter_list') ??
                                null
                        ),
                        [extractCppReturnType(field)]
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

            triadGraph.push(
                createTriadNode(
                    `${ownerName}.${functionName}`,
                    category,
                    sourcePath,
                    parseCppParametersAst(
                        declarator.childForFieldName('parameters') ??
                            declarator.namedChildren.find((child) => child.type === 'parameter_list') ??
                            null
                    ),
                    [extractCppReturnType(node)]
                )
            );
        }
    }

    return triadGraph;
}

function collectJavaNodes(rootNode: Parser.SyntaxNode, sourcePath: string, category: string) {
    const triadGraph: TriadNode[] = [];

    for (const classNode of rootNode.namedChildren.filter((node) => node.type === 'class_declaration')) {
        const className = getNameText(classNode.childForFieldName('name'));
        const classBody = classNode.childForFieldName('body');
        if (!className || !classBody) {
            continue;
        }

        for (const methodNode of classBody.namedChildren.filter((child) => child.type === 'method_declaration')) {
            const methodName = getNameText(methodNode.childForFieldName('name'));
            if (!methodName) {
                continue;
            }

            triadGraph.push(
                createTriadNode(
                    `${className}.${methodName}`,
                    category,
                    sourcePath,
                    parseJavaParametersAst(methodNode.childForFieldName('parameters')),
                    [normalizeTypeText(methodNode.childForFieldName('type')?.text ?? 'void')]
                )
            );
        }
    }

    return triadGraph;
}

function collectSourceFiles(language: TriadLanguage, targetDir: string, config: TriadConfig) {
    const files: string[] = [];
    walk(targetDir, (filePath) => {
        const relativePath = path.relative(targetDir, filePath);
        if (shouldExcludeSourcePath(relativePath, config)) {
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

    const stat = fs.statSync(currentPath);
    if (stat.isFile()) {
        visit(currentPath);
        return;
    }

    const basename = path.basename(currentPath);
    if (basename === '.git' || basename === '.triadmind' || basename === 'node_modules' || basename === 'target') {
        return;
    }

    for (const entry of fs.readdirSync(currentPath)) {
        walk(path.join(currentPath, entry), visit);
    }
}

function parseTsParameters(parametersNode: Parser.SyntaxNode | null) {
    if (!parametersNode) {
        return ['None'];
    }

    const demand = parametersNode.namedChildren.map((child, index) => {
        if (child.type === 'identifier') {
            return `unknown (${child.text})`;
        }

        const nameNode = child.childForFieldName('pattern') ?? child.childForFieldName('name') ?? child.namedChildren[0];
        const typeNode = child.childForFieldName('type');
        const name = getNameText(nameNode) ?? `input${index + 1}`;
        const typeName = normalizeTypeText(typeNode?.text.replace(/^:\s*/, '') ?? 'unknown');
        return `${typeName} (${name})`;
    });

    return demand.length > 0 ? demand : ['None'];
}

function parseJsParameters(parametersNode: Parser.SyntaxNode | null) {
    if (!parametersNode) {
        return ['None'];
    }

    const demand = parametersNode.namedChildren.map((child, index) => `unknown (${getNameText(child) ?? `input${index + 1}`})`);
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
            const typeName = normalizeTypeText(parts[1] ?? 'unknown');
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
        const typeName = normalizeTypeText(typeNode?.text ?? 'unknown');
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
            const typeName = normalizeTypeText(parts[1] ?? 'unknown');
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
                const typeName = normalizeTypeText(tokens.slice(0, -1).join(' '));
                return `${typeName} (${name})`;
            }

            return `${normalizeTypeText(child.text)} (input${index + 1})`;
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
                const typeName = normalizeTypeText(tokens.slice(0, -1).join(' '));
                return `${typeName} (${name})`;
            }

            return `unknown (input${index + 1})`;
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
    return normalizeTypeText(returnNode?.text ?? 'void');
}

function extractGoReturnType(functionNode: Parser.SyntaxNode) {
    const blockNode = functionNode.childForFieldName('body') ?? functionNode.namedChildren[functionNode.namedChildren.length - 1];
    const candidate = [...functionNode.namedChildren]
        .reverse()
        .find((child) => !blockNode || child.id !== blockNode.id && child.type !== 'parameter_list' && child.type !== 'identifier' && child.type !== 'field_identifier');
    return normalizeTypeText(candidate?.text ?? 'void');
}

function extractRustReturnType(functionNode: Parser.SyntaxNode) {
    const blockNode = functionNode.childForFieldName('body');
    const parametersNode = functionNode.childForFieldName('parameters');
    const candidate = functionNode.namedChildren.find(
        (child) => child.id !== blockNode?.id && child.id !== parametersNode?.id && child.type !== 'identifier' && child.type !== 'visibility_modifier'
    );
    return normalizeTypeText(candidate?.text ?? 'void');
}

function extractCppReturnType(node: Parser.SyntaxNode) {
    const declarator = node.childForFieldName('declarator') ?? node.namedChildren.find((child) => child.type === 'function_declarator');
    const candidates = node.namedChildren.filter((child) => child.id !== declarator?.id && child.type !== 'compound_statement' && child.type !== 'field_declaration_list');
    return normalizeTypeText(candidates.map((child) => child.text).join(' ').trim() || 'void');
}

function extractGoReceiverType(receiverNode: Parser.SyntaxNode | null) {
    if (!receiverNode) {
        return '';
    }

    const receiverText = receiverNode.text.replace(/[()]/g, '').trim();
    const match = receiverText.match(/(?:[A-Za-z_]\w*\s+)?\*?([A-Za-z_]\w*)$/);
    return match?.[1] ?? '';
}

function stripQuotedLiteral(value: string) {
    return value.replace(/^['"`]|['"`]$/g, '');
}

function createTriadNode(nodeId: string, category: string, sourcePath: string, demand: string[], answer: string[]): TriadNode {
    const methodName = nodeId.split('.').pop() ?? 'execute';
    return {
        nodeId,
        category,
        sourcePath,
        fission: {
            problem: `execute ${methodName} flow`,
            demand: demand.length > 0 ? demand : ['None'],
            answer: answer.length > 0 ? answer : ['void']
        }
    };
}

function dedupeNodes(nodes: TriadNode[]) {
    const seen = new Set<string>();
    return nodes.filter((node) => {
        if (seen.has(node.nodeId)) {
            return false;
        }

        seen.add(node.nodeId);
        return true;
    });
}

function normalizeTypeText(value: string) {
    const normalized = value.trim().replace(/\s+/g, ' ');
    return normalized || 'unknown';
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
