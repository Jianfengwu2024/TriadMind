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

    for (const filePath of files) {
        const source = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
        const sourcePath = normalizePath(path.relative(targetDir, filePath));
        const tree = parseSourceFile(parser, source, sourcePath);
        const category = resolveCategoryFromConfig(sourcePath, config);

        triadGraph.push(...collectLanguageNodes(language, tree.rootNode, source, filePath, sourcePath, category, config));
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
    config: TriadConfig
) {
    switch (language) {
        case 'typescript':
            return collectTypeScriptNodes(rootNode, source, filePath, sourcePath, category, config);
        case 'javascript':
            return collectJavaScriptNodes(rootNode, source, filePath, sourcePath, category, config);
        case 'python':
            return collectPythonNodes(rootNode, sourcePath, category);
        case 'go':
            return collectGoNodes(rootNode, sourcePath, category);
        case 'rust':
            return collectRustNodes(rootNode, filePath, sourcePath, category);
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
    config: TriadConfig
) {
    const triadGraph: TriadNode[] = [];

    for (const classNode of rootNode.descendantsOfType('class_declaration')) {
        const className = getNameText(classNode.childForFieldName('name'));
        const classBody = classNode.childForFieldName('body');
        if (!className || !classBody) {
            continue;
        }

        const classHasTriadTag = hasNearbyTriadTag(source, classNode.startIndex, config);
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

            triadGraph.push(
                createTriadNode(
                    `${className}.${methodName}`,
                    category,
                    sourcePath,
                    parseTsParameters(methodNode.childForFieldName('parameters')),
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

        triadGraph.push(
            createTriadNode(
                `${moduleName}.${functionName}`,
                category,
                sourcePath,
                parseTsParameters(fnNode.childForFieldName('parameters')),
                [normalizeTypeText(fnNode.childForFieldName('return_type')?.text.replace(/^:\s*/, '') ?? 'void')]
            )
        );
    }

    return triadGraph;
}

function collectJavaScriptNodes(
    rootNode: Parser.SyntaxNode,
    source: string,
    filePath: string,
    sourcePath: string,
    category: string,
    config: TriadConfig
) {
    const triadGraph: TriadNode[] = [];
    const moduleName = toPascalCase(path.basename(filePath).replace(/\.(jsx?|mjs|cjs)$/, ''));

    for (const classNode of rootNode.namedChildren.filter((node) => node.type === 'class_declaration')) {
        const className = getNameText(classNode.childForFieldName('name'));
        const classBody = classNode.childForFieldName('body');
        if (!className || !classBody) {
            continue;
        }

        for (const methodNode of classBody.namedChildren.filter((node) => node.type === 'method_definition')) {
            const methodName = getNameText(methodNode.childForFieldName('name'));
            if (!methodName || methodName === 'constructor') {
                continue;
            }

            triadGraph.push(
                createTriadNode(
                    `${className}.${methodName}`,
                    category,
                    sourcePath,
                    parseJsParameters(methodNode.childForFieldName('parameters')),
                    ['unknown']
                )
            );
        }
    }

    const topLevelNodes = config.parser.includeUntaggedExports ? rootNode.namedChildren : rootNode.namedChildren.filter((node) => node.type === 'export_statement');
    for (const topLevelNode of topLevelNodes) {
        if (topLevelNode.type === 'export_statement') {
            triadGraph.push(...collectJavaScriptExportNode(topLevelNode, moduleName, category, sourcePath));
            continue;
        }

        if (topLevelNode.type === 'function_declaration') {
            const functionName = getNameText(topLevelNode.childForFieldName('name'));
            if (functionName) {
                triadGraph.push(
                    createTriadNode(
                        `${moduleName}.${functionName}`,
                        category,
                        sourcePath,
                        parseJsParameters(topLevelNode.childForFieldName('parameters')),
                        ['unknown']
                    )
                );
            }
            continue;
        }

        if (topLevelNode.type === 'lexical_declaration' || topLevelNode.type === 'variable_declaration') {
            triadGraph.push(...collectJavaScriptVariableFunctions(topLevelNode, moduleName, category, sourcePath));
        }
    }

    return triadGraph;
}

function collectJavaScriptExportNode(
    exportNode: Parser.SyntaxNode,
    moduleName: string,
    category: string,
    sourcePath: string
) {
    const triadGraph: TriadNode[] = [];
    const functionNode = exportNode.namedChildren.find((node) => node.type === 'function_declaration');
    if (functionNode) {
        const functionName = getNameText(functionNode.childForFieldName('name'));
        if (functionName) {
            triadGraph.push(
                createTriadNode(
                    `${moduleName}.${functionName}`,
                    category,
                    sourcePath,
                    parseJsParameters(functionNode.childForFieldName('parameters')),
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
        triadGraph.push(...collectJavaScriptVariableFunctions(declarationNode, moduleName, category, sourcePath));
    }

    return triadGraph;
}

function collectJavaScriptVariableFunctions(
    declarationNode: Parser.SyntaxNode,
    moduleName: string,
    category: string,
    sourcePath: string
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

        triadGraph.push(
            createTriadNode(
                `${moduleName}.${functionName}`,
                category,
                sourcePath,
                parseJsParameters(valueNode.childForFieldName('parameters')),
                ['unknown']
            )
        );
    }

    return triadGraph;
}

function collectPythonNodes(rootNode: Parser.SyntaxNode, sourcePath: string, category: string) {
    const triadGraph: TriadNode[] = [];
    const moduleName = toPascalCase(path.basename(sourcePath).replace(/\.py$/, ''));

    for (const node of rootNode.namedChildren) {
        if (node.type === 'class_definition') {
            const className = getNameText(node.childForFieldName('name'));
            const classBody = node.childForFieldName('body');
            if (!className || !classBody) {
                continue;
            }

            for (const methodNode of classBody.namedChildren.filter((child) => child.type === 'function_definition')) {
                const methodName = getNameText(methodNode.childForFieldName('name'));
                if (!methodName || methodName === '__init__') {
                    continue;
                }

                triadGraph.push(
                    createTriadNode(
                        `${className}.${methodName}`,
                        category,
                        sourcePath,
                        parsePythonParametersAst(methodNode.childForFieldName('parameters')),
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

            triadGraph.push(
                createTriadNode(
                    `${moduleName}.${functionName}`,
                    category,
                    sourcePath,
                    parsePythonParametersAst(node.childForFieldName('parameters')),
                    [extractPythonReturnType(node)]
                )
            );
        }
    }

    return triadGraph;
}

function collectGoNodes(rootNode: Parser.SyntaxNode, sourcePath: string, category: string) {
    const triadGraph: TriadNode[] = [];
    const moduleName = toPascalCase(path.basename(sourcePath).replace(/\.go$/, ''));

    for (const node of rootNode.namedChildren) {
        if (node.type === 'method_declaration') {
            const receiver = node.childForFieldName('receiver') ?? node.namedChildren[0];
            const receiverType = extractGoReceiverType(receiver);
            const methodName = getNameText(node.childForFieldName('name'));
            if (!receiverType || !methodName) {
                continue;
            }

            triadGraph.push(
                createTriadNode(
                    `${receiverType}.${methodName}`,
                    category,
                    sourcePath,
                    parseGoParametersAst(node.childForFieldName('parameters')),
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

            triadGraph.push(
                createTriadNode(
                    `${moduleName}.${functionName}`,
                    category,
                    sourcePath,
                    parseGoParametersAst(node.childForFieldName('parameters')),
                    [extractGoReturnType(node)]
                )
            );
        }
    }

    return triadGraph;
}

function collectRustNodes(rootNode: Parser.SyntaxNode, filePath: string, sourcePath: string, category: string) {
    const triadGraph: TriadNode[] = [];
    const moduleName = toPascalCase(path.basename(filePath).replace(/\.rs$/, ''));

    for (const node of rootNode.namedChildren) {
        if (node.type === 'impl_item') {
            const implType = getFirstNamedChildText(node, ['type_identifier', 'primitive_type']);
            const declarationList = node.childForFieldName('body') ?? node.namedChildren.find((child) => child.type === 'declaration_list');
            if (!implType || !declarationList) {
                continue;
            }

            for (const functionNode of declarationList.namedChildren.filter((child) => child.type === 'function_item')) {
                const functionName = getNameText(functionNode.childForFieldName('name'));
                if (!functionName) {
                    continue;
                }

                triadGraph.push(
                    createTriadNode(
                        `${implType}.${functionName}`,
                        category,
                        sourcePath,
                        parseRustParametersAst(functionNode.childForFieldName('parameters')),
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

            triadGraph.push(
                createTriadNode(
                    `${moduleName}.${functionName}`,
                    category,
                    sourcePath,
                    parseRustParametersAst(node.childForFieldName('parameters')),
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

function createTriadNode(nodeId: string, category: string, sourcePath: string, demand: string[], answer: string[]): TriadNode {
    const methodName = nodeId.split('.').pop() ?? 'execute';
    return {
        nodeId,
        category,
        sourcePath,
        fission: {
            problem: `鎵ц ${methodName} 娴佺▼`,
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
