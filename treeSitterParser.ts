import Parser = require('tree-sitter');
import TypeScript = require('tree-sitter-typescript');
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { TriadConfig, resolveCategoryFromConfig, shouldExcludeSourcePath } from './config';
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

export function runTreeSitterTypeScriptParser(targetDir: string, outputPath: string, config: TriadConfig) {
    console.log(chalk.gray('   - [Parser] scanning TypeScript via tree-sitter...'));

    const parser = new Parser();
    parser.setLanguage(TypeScript.typescript);

    const triadGraph: TriadNode[] = [];
    const files = collectTypeScriptFiles(targetDir, config);

    for (const filePath of files) {
        const source = fs.readFileSync(filePath, 'utf-8');
        const tree = parser.parse(source);
        const sourcePath = normalizePath(path.relative(targetDir, filePath));
        const category = resolveCategoryFromConfig(sourcePath, config);

        collectClassNodes(tree.rootNode, source, category, sourcePath, triadGraph, config);
        collectModuleFunctionNodes(tree.rootNode, source, filePath, category, sourcePath, triadGraph, config);
    }

    triadGraph.sort((left, right) => left.nodeId.localeCompare(right.nodeId));
    fs.writeFileSync(outputPath, JSON.stringify(triadGraph, null, 2), 'utf-8');
    console.log(chalk.gray(`   - [Parser] tree-sitter scan complete, extracted ${triadGraph.length} leaf nodes.`));
}

function collectClassNodes(
    rootNode: Parser.SyntaxNode,
    source: string,
    category: string,
    sourcePath: string,
    triadGraph: TriadNode[],
    config: TriadConfig
) {
    for (const classNode of rootNode.descendantsOfType('class_declaration')) {
        const className = classNode.childForFieldName('name')?.text;
        const classBody = classNode.childForFieldName('body');
        if (!className || !classBody) {
            continue;
        }

        const classHasTriadTag = hasNearbyTriadTag(source, classNode.startIndex, config);

        for (const methodNode of classBody.namedChildren.filter((node) => node.type === 'method_definition')) {
            const methodName = methodNode.childForFieldName('name')?.text;
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

            const demand = parseParameters(methodNode.childForFieldName('parameters'));
            const answer = parseReturnType(methodNode.childForFieldName('return_type'));

            triadGraph.push({
                nodeId: `${className}.${methodName}`,
                category,
                sourcePath,
                fission: {
                    problem: `执行 ${methodName} 流程`,
                    demand,
                    answer: [answer]
                }
            });
        }
    }
}

function collectModuleFunctionNodes(
    rootNode: Parser.SyntaxNode,
    source: string,
    filePath: string,
    category: string,
    sourcePath: string,
    triadGraph: TriadNode[],
    config: TriadConfig
) {
    const moduleName = toPascalCase(path.basename(filePath).replace(/\.(tsx?|mts|cts)$/, ''));

    for (const exportNode of rootNode.descendantsOfType('export_statement')) {
        const fnNode = exportNode.namedChildren.find((node) => node.type === 'function_declaration');
        if (!fnNode) {
            continue;
        }

        const functionName = fnNode.childForFieldName('name')?.text;
        if (!functionName) {
            continue;
        }

        if (!config.parser.includeUntaggedExports && !hasNearbyTriadTag(source, exportNode.startIndex, config)) {
            continue;
        }

        triadGraph.push({
            nodeId: `${moduleName}.${functionName}`,
            category,
            sourcePath,
            fission: {
                problem: `执行 ${functionName} 流程`,
                demand: parseParameters(fnNode.childForFieldName('parameters')),
                answer: [parseReturnType(fnNode.childForFieldName('return_type'))]
            }
        });
    }
}

function collectTypeScriptFiles(targetDir: string, config: TriadConfig) {
    const files: string[] = [];
    walk(targetDir, (filePath) => {
        const relativePath = path.relative(targetDir, filePath);
        if (shouldExcludeSourcePath(relativePath, config)) {
            return;
        }

        if (filePath.endsWith('.d.ts') || path.basename(filePath).endsWith('types.ts')) {
            return;
        }

        if (/\.(ts|tsx|mts|cts)$/.test(filePath)) {
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

    for (const entry of fs.readdirSync(currentPath)) {
        walk(path.join(currentPath, entry), visit);
    }
}

function parseParameters(parametersNode: Parser.SyntaxNode | null) {
    if (!parametersNode) {
        return ['None'];
    }

    const demand = parametersNode.namedChildren
        .filter((child) => child.type === 'required_parameter' || child.type === 'optional_parameter')
        .map((child, index) => {
            const name = child.childForFieldName('pattern')?.text ?? child.namedChildren[0]?.text ?? `input${index + 1}`;
            const typeNode = child.childForFieldName('type');
            const typeName = normalizeTypeText(typeNode?.text.replace(/^:\s*/, '') ?? 'unknown');
            return `${typeName} (${name})`;
        });

    return demand.length > 0 ? demand : ['None'];
}

function parseReturnType(returnNode: Parser.SyntaxNode | null) {
    return normalizeTypeText(returnNode?.text.replace(/^:\s*/, '') ?? 'void');
}

function normalizeTypeText(value: string) {
    return value.trim() || 'unknown';
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
