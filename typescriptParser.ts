import { Project, SourceFile } from 'ts-morph';
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

            const answer = method.getReturnTypeNode()?.getText() ?? method.getReturnType().getText(method);

            triadGraph.push({
                nodeId: `${className}.${method.getName()}`,
                category,
                sourcePath,
                fission: {
                    problem: `执行 ${method.getName()} 流程`,
                    demand: demand.length > 0 ? demand : ['None'],
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

        const answer = fn.getReturnTypeNode()?.getText() ?? fn.getReturnType().getText(fn);

        triadGraph.push({
            nodeId: `${moduleName}.${functionName}`,
            category,
            sourcePath,
            fission: {
                problem: `执行 ${functionName} 流程`,
                demand: demand.length > 0 ? demand : ['None'],
                answer: [answer]
            }
        });
    }
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
