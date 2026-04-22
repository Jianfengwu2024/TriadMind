import {
    ClassDeclaration,
    FunctionDeclaration,
    MethodDeclaration,
    Node,
    Project,
    SourceFile,
    SyntaxKind
} from 'ts-morph';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { getWorkspacePaths, normalizePath } from './workspace';
import { loadTriadConfig, resolveCategoryFromConfig, shouldExcludeSourcePath, TriadConfig } from './config';

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

type GhostAccessMode = 'read' | 'write' | 'readwrite';

interface GhostDependency {
    typeName: string;
    read: boolean;
    write: boolean;
}

const BUILTIN_GLOBALS = new Set([
    'Array',
    'Boolean',
    'Date',
    'Error',
    'Intl',
    'JSON',
    'Map',
    'Math',
    'Number',
    'Object',
    'Promise',
    'Reflect',
    'RegExp',
    'Set',
    'String',
    'Symbol',
    'WeakMap',
    'WeakSet',
    'console',
    'document',
    'globalThis',
    'process',
    'window'
]);

/**
 * TriadMind 自动生成骨架
 * 职责：执行 TypeScript parser 流程
 */
export function runTypeScriptParser(targetDir: string, outputPath?: string): void {
    console.log(chalk.gray('   - [Parser] 正在扫描 TypeScript AST，回写项目拓扑地图...'));

    const tsConfigFilePath = path.join(targetDir, 'tsconfig.json');
    if (!fs.existsSync(tsConfigFilePath)) {
        throw new Error(`目标目录下缺少 tsconfig.json：${tsConfigFilePath}`);
    }

    const triadDir = path.join(targetDir, '.triadmind');
    fs.mkdirSync(triadDir, { recursive: true });
    const workspacePaths = getWorkspacePaths(targetDir);
    const config = loadTriadConfig(workspacePaths);

    const resolvedOutputPath = outputPath ?? path.join(triadDir, 'triad-map.json');

    const project = new Project({
        tsConfigFilePath
    });

    const triadGraph: TriadNode[] = [];
    const sourceFiles = project
        .getSourceFiles()
        .filter(
            (file) =>
                !file.getFilePath().endsWith('.d.ts') &&
                !file.getBaseName().endsWith('types.ts') &&
                !shouldExcludeSourcePath(path.relative(targetDir, file.getFilePath()), config)
        );

    for (const sourceFile of sourceFiles) {
        const filePath = sourceFile.getFilePath();
        const sourcePath = normalizePath(path.relative(targetDir, filePath));
        const category = resolveCategoryFromConfig(sourcePath, config);

        collectClassMethodNodes(sourceFile, category, sourcePath, triadGraph, config);
        collectExportedFunctionNodes(sourceFile, category, sourcePath, triadGraph, config);
    }

    triadGraph.sort((left, right) => left.nodeId.localeCompare(right.nodeId));
    fs.writeFileSync(resolvedOutputPath, JSON.stringify(triadGraph, null, 2), 'utf-8');
    console.log(chalk.gray(`   - [Parser] 扫描完成，共抽取 ${triadGraph.length} 个叶节点。`));
}

function collectClassMethodNodes(
    sourceFile: SourceFile,
    category: string,
    sourcePath: string,
    triadGraph: TriadNode[],
    config: TriadConfig
) {
    for (const cls of sourceFile.getClasses()) {
        const className = cls.getName();
        if (!className) {
            continue;
        }

        const classHasTriadTag = hasTriadTag(cls, config);

        for (const method of cls.getMethods()) {
            if (method.getName() === 'constructor') {
                continue;
            }

            const scope = method.getScope();
            if (scope === 'private' || scope === 'protected') {
                continue;
            }

            if (!config.parser.includeUntaggedExports && !classHasTriadTag && !hasTriadTag(method, config)) {
                continue;
            }

            const demand = method.getParameters().map((parameter) => {
                const typeName = parameter.getTypeNode()?.getText() ?? 'unknown';
                return `${typeName} (${parameter.getName()})`;
            });
            const ghostDemand = collectGhostDependencies(method, cls);
            const answer = method.getReturnTypeNode()?.getText() ?? method.getReturnType().getText(method);
            const mergedDemand = mergeDemandEntries(demand, ghostDemand);

            triadGraph.push({
                nodeId: `${className}.${method.getName()}`,
                category,
                sourcePath,
                fission: {
                    problem: `执行 ${method.getName()} 流程`,
                    demand: mergedDemand.length > 0 ? mergedDemand : ['None'],
                    answer: [answer]
                }
            });
        }
    }
}

function collectExportedFunctionNodes(
    sourceFile: SourceFile,
    category: string,
    sourcePath: string,
    triadGraph: TriadNode[],
    config: TriadConfig
) {
    const moduleName = toPascalCase(sourceFile.getBaseNameWithoutExtension());

    for (const fn of sourceFile.getFunctions()) {
        const functionName = fn.getName();
        if (!functionName || !fn.isExported()) {
            continue;
        }

        if (!config.parser.includeUntaggedExports && !hasTriadTag(fn, config)) {
            continue;
        }

        const demand = fn.getParameters().map((parameter) => {
            const typeName = parameter.getTypeNode()?.getText() ?? 'unknown';
            return `${typeName} (${parameter.getName()})`;
        });
        const ghostDemand = collectGhostDependencies(fn);
        const answer = fn.getReturnTypeNode()?.getText() ?? fn.getReturnType().getText(fn);
        const mergedDemand = mergeDemandEntries(demand, ghostDemand);

        triadGraph.push({
            nodeId: `${moduleName}.${functionName}`,
            category,
            sourcePath,
            fission: {
                problem: `执行 ${functionName} 流程`,
                demand: mergedDemand.length > 0 ? mergedDemand : ['None'],
                answer: [answer]
            }
        });
    }
}

function collectGhostDependencies(executable: MethodDeclaration | FunctionDeclaration, cls?: ClassDeclaration) {
    const body = executable.getBody();
    if (!body) {
        return [];
    }

    const localNames = new Set(executable.getParameters().map((parameter) => parameter.getName()));
    const ghostMap = new Map<string, GhostDependency>();

    body.forEachDescendant((node) => {
        const declaredName = getDeclaredName(node);
        if (declaredName) {
            localNames.add(declaredName);
        }
    });

    body.forEachDescendant((node) => {
        if (cls && Node.isPropertyAccessExpression(node)) {
            const thisGhost = extractThisGhost(node, cls);
            if (thisGhost) {
                registerGhost(ghostMap, thisGhost.label, thisGhost.typeName, getGhostAccessMode(node));
                return;
            }
        }

        if (!Node.isIdentifier(node)) {
            return;
        }

        const name = node.getText();
        if (!name || localNames.has(name) || BUILTIN_GLOBALS.has(name)) {
            return;
        }

        if (isDeclarationName(node) || isPropertyNamePosition(node)) {
            return;
        }

        const ghost = resolveIdentifierGhost(node, body);
        if (!ghost) {
            return;
        }

        registerGhost(ghostMap, ghost.label, ghost.typeName, getGhostAccessMode(node));
    });

    return Array.from(ghostMap.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([label, ghost]) => {
            if (ghost.read && ghost.write) {
                return `[Ghost:ReadWrite] ${ghost.typeName} (${label})`;
            }
            if (ghost.write) {
                return `[Ghost:Write] ${ghost.typeName} (${label})`;
            }
            return `[Ghost:Read] ${ghost.typeName} (${label})`;
        });
}

function getDeclaredName(node: Node) {
    if (
        Node.isVariableDeclaration(node) ||
        Node.isBindingElement(node) ||
        Node.isParameterDeclaration(node) ||
        Node.isFunctionDeclaration(node) ||
        Node.isClassDeclaration(node) ||
        Node.isEnumDeclaration(node)
    ) {
        return node.getName?.() ?? '';
    }

    return '';
}

function resolveIdentifierGhost(node: Node, body: Node) {
    if (!Node.isIdentifier(node)) {
        return null;
    }

    const definitions = node.getDefinitions();
    if (definitions.length === 0) {
        return null;
    }

    const definitionNode = getDefinitionDeclarationNode(definitions[0].getNode());
    if (
        Node.isImportSpecifier(definitionNode) ||
        Node.isNamespaceImport(definitionNode) ||
        Node.isImportClause(definitionNode)
    ) {
        return {
            label: normalizeImportedGhostLabel(node),
            typeName: normalizeTypeName(node.getType().getText(node) || 'unknown')
        };
    }

    if (!isExternalDefinition(definitionNode, body)) {
        return null;
    }

    if (
        Node.isVariableDeclaration(definitionNode) ||
        Node.isFunctionDeclaration(definitionNode) ||
        Node.isClassDeclaration(definitionNode) ||
        Node.isEnumDeclaration(definitionNode)
    ) {
        return {
            label: node.getText(),
            typeName: normalizeTypeName(node.getType().getText(node) || 'unknown')
        };
    }

    return null;
}

function getDefinitionDeclarationNode(node: Node) {
    let current = node;

    while (Node.isIdentifier(current) && current.getParent()) {
        const parent = current.getParentOrThrow();
        if (
            Node.isImportSpecifier(parent) ||
            Node.isNamespaceImport(parent) ||
            Node.isImportClause(parent) ||
            Node.isVariableDeclaration(parent) ||
            Node.isFunctionDeclaration(parent) ||
            Node.isClassDeclaration(parent) ||
            Node.isEnumDeclaration(parent) ||
            Node.isPropertyDeclaration(parent)
        ) {
            return parent;
        }
        current = parent;
    }

    return current;
}

function extractThisGhost(node: Node, cls: ClassDeclaration) {
    if (!Node.isPropertyAccessExpression(node)) {
        return null;
    }

    const rootAccess = getRootThisPropertyAccess(node);
    if (!rootAccess) {
        return null;
    }

    const propertyName = rootAccess.getName();
    const propertyDecl = cls.getProperty(propertyName);
    const typeName = normalizeTypeName(
        propertyDecl?.getTypeNode()?.getText() ??
            propertyDecl?.getType().getText(propertyDecl) ??
            node.getType().getText(node) ??
            'unknown'
    );

    return {
        label: `this.${propertyName}`,
        typeName
    };
}

function getRootThisPropertyAccess(node: Node) {
    if (!Node.isPropertyAccessExpression(node)) {
        return null;
    }

    let current = node;
    while (Node.isPropertyAccessExpression(current)) {
        const expression = current.getExpression();
        if (Node.isThisExpression(expression)) {
            return current;
        }
        if (!Node.isPropertyAccessExpression(expression)) {
            return null;
        }
        current = expression;
    }

    return null;
}

function normalizeImportedGhostLabel(node: Node) {
    if (!Node.isIdentifier(node)) {
        return '';
    }

    return node.getText();
}

function isExternalDefinition(definitionNode: Node, body: Node) {
    if (definitionNode.getSourceFile().getFilePath() !== body.getSourceFile().getFilePath()) {
        return true;
    }

    return definitionNode.getStart() < body.getStart() || definitionNode.getEnd() > body.getEnd();
}

function registerGhost(
    ghostMap: Map<string, GhostDependency>,
    label: string,
    typeName: string,
    mode: GhostAccessMode
) {
    if (!label) {
        return;
    }

    const current = ghostMap.get(label) ?? {
        typeName: normalizeTypeName(typeName),
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
        current.typeName = normalizeTypeName(typeName);
    }

    ghostMap.set(label, current);
}

function getGhostAccessMode(node: Node): GhostAccessMode {
    const target = getAccessTarget(node);
    const parent = target.getParent();
    if (!parent) {
        return 'read';
    }

    if (Node.isBinaryExpression(parent) && parent.getLeft() === target) {
        switch (parent.getOperatorToken().getKind()) {
            case SyntaxKind.EqualsToken:
                return 'write';
            case SyntaxKind.PlusEqualsToken:
            case SyntaxKind.MinusEqualsToken:
            case SyntaxKind.AsteriskEqualsToken:
            case SyntaxKind.AsteriskAsteriskEqualsToken:
            case SyntaxKind.SlashEqualsToken:
            case SyntaxKind.PercentEqualsToken:
            case SyntaxKind.AmpersandEqualsToken:
            case SyntaxKind.BarEqualsToken:
            case SyntaxKind.CaretEqualsToken:
            case SyntaxKind.LessThanLessThanEqualsToken:
            case SyntaxKind.GreaterThanGreaterThanEqualsToken:
            case SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken:
                return 'readwrite';
        }
    }

    if (Node.isPrefixUnaryExpression(parent) && parent.getOperand() === target) {
        const operator = parent.getOperatorToken();
        if (operator === SyntaxKind.PlusPlusToken || operator === SyntaxKind.MinusMinusToken) {
            return 'readwrite';
        }
    }

    if (Node.isPostfixUnaryExpression(parent) && parent.getOperand() === target) {
        const operator = parent.getOperatorToken();
        if (operator === SyntaxKind.PlusPlusToken || operator === SyntaxKind.MinusMinusToken) {
            return 'readwrite';
        }
    }

    return 'read';
}

function getAccessTarget(node: Node) {
    let current = node;

    while (true) {
        const parent = current.getParent();
        if (!parent) {
            return current;
        }

        if (
            (Node.isPropertyAccessExpression(parent) || Node.isElementAccessExpression(parent)) &&
            parent.getExpression() === current
        ) {
            current = parent;
            continue;
        }

        if (
            Node.isParenthesizedExpression(parent) ||
            Node.isNonNullExpression(parent) ||
            Node.isAsExpression(parent) ||
            Node.isTypeAssertion(parent)
        ) {
            current = parent;
            continue;
        }

        return current;
    }
}

function isDeclarationName(node: Node) {
    if (!Node.isIdentifier(node)) {
        return false;
    }

    const parent = node.getParent();
    if (!parent) {
        return false;
    }

    return (
        (Node.isVariableDeclaration(parent) && parent.getNameNode() === node) ||
        (Node.isBindingElement(parent) && parent.getNameNode() === node) ||
        (Node.isParameterDeclaration(parent) && parent.getNameNode() === node) ||
        (Node.isFunctionDeclaration(parent) && parent.getNameNode() === node) ||
        (Node.isMethodDeclaration(parent) && parent.getNameNode() === node) ||
        (Node.isClassDeclaration(parent) && parent.getNameNode() === node) ||
        (Node.isPropertyDeclaration(parent) && parent.getNameNode() === node) ||
        (Node.isEnumDeclaration(parent) && parent.getNameNode() === node) ||
        (Node.isImportSpecifier(parent) && parent.getNameNode() === node) ||
        (Node.isNamespaceImport(parent) && parent.getNameNode() === node) ||
        (Node.isImportClause(parent) && parent.getDefaultImport() === node)
    );
}

function isPropertyNamePosition(node: Node) {
    if (!Node.isIdentifier(node)) {
        return false;
    }

    const parent = node.getParent();
    return (
        (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === node) ||
        (Node.isPropertyAssignment(parent) && parent.getNameNode() === node) ||
        (Node.isPropertyDeclaration(parent) && parent.getNameNode() === node)
    );
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

function normalizeTypeName(value: string) {
    const normalized = value.trim().replace(/\s+/g, ' ');
    return normalized || 'unknown';
}

function toPascalCase(value: string) {
    return value
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');
}

function hasTriadTag(node: { getJsDocs(): Array<{ getTags(): Array<{ getTagName(): string }> }> }, config: TriadConfig) {
    const supportedTags = new Set([
        config.parser.jsDocTags.triadNode,
        config.parser.jsDocTags.leftBranch,
        config.parser.jsDocTags.rightBranch
    ]);

    return node
        .getJsDocs()
        .flatMap((doc) => doc.getTags())
        .some((tag) => supportedTags.has(tag.getTagName()));
}
