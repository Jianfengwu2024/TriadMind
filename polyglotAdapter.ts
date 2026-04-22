import * as fs from 'fs';
import * as path from 'path';
import {
    createSourcePathFilter,
    describeSourceScanScope,
    loadTriadConfig,
    resolveCategoryFromConfig,
    TriadConfig,
    TriadLanguage
} from './config';
import { buildTopologyIR, TriadTopologyIR } from './ir';
import { LanguageAdapter } from './languageAdapter';
import {
    assertProtocolShape,
    CreateChildAction,
    ModifyAction,
    parseDemandEntry,
    parseNodeRef,
    parseReturnType,
    readJsonFile,
    readTriadMap,
    TriadCategory,
    TriadNodeDefinition,
    UpgradeProtocol
} from './protocol';
import { getWorkspacePaths, normalizePath } from './workspace';
import { runTreeSitterParser } from './treeSitterParser';

type PolyglotLanguage = 'javascript' | 'python' | 'go' | 'rust' | 'cpp' | 'java';
type PolyglotAction = CreateChildAction | ModifyAction;

interface LanguageDescriptor {
    language: PolyglotLanguage;
    displayName: string;
    adapterPackage: string;
    extension: string;
    filePatterns: RegExp;
}

interface NodeLocationMap {
    [nodeId: string]: string;
}

const DESCRIPTORS: Record<PolyglotLanguage, LanguageDescriptor> = {
    javascript: {
        language: 'javascript',
        displayName: 'JavaScript',
        adapterPackage: '@triadmind/plugin-js',
        extension: '.js',
        filePatterns: /\.(js|jsx|mjs|cjs)$/i
    },
    python: {
        language: 'python',
        displayName: 'Python',
        adapterPackage: '@triadmind/plugin-python',
        extension: '.py',
        filePatterns: /\.py$/i
    },
    go: {
        language: 'go',
        displayName: 'Go',
        adapterPackage: '@triadmind/plugin-go',
        extension: '.go',
        filePatterns: /\.go$/i
    },
    rust: {
        language: 'rust',
        displayName: 'Rust',
        adapterPackage: '@triadmind/plugin-rust',
        extension: '.rs',
        filePatterns: /\.rs$/i
    },
    cpp: {
        language: 'cpp',
        displayName: 'C++',
        adapterPackage: '@triadmind/plugin-cpp',
        extension: '.cpp',
        filePatterns: /\.(cpp|cc|cxx|hpp|hh|h)$/i
    },
    java: {
        language: 'java',
        displayName: 'Java',
        adapterPackage: '@triadmind/plugin-java',
        extension: '.java',
        filePatterns: /\.java$/i
    }
};

export function createJavaScriptAdapter(): LanguageAdapter {
    return createPolyglotAdapter(DESCRIPTORS.javascript);
}

export function createPythonAdapter(): LanguageAdapter {
    return createPolyglotAdapter(DESCRIPTORS.python);
}

export function createGoAdapter(): LanguageAdapter {
    return createPolyglotAdapter(DESCRIPTORS.go);
}

export function createRustAdapter(): LanguageAdapter {
    return createPolyglotAdapter(DESCRIPTORS.rust);
}

export function createCppAdapter(): LanguageAdapter {
    return createPolyglotAdapter(DESCRIPTORS.cpp);
}

export function createJavaAdapter(): LanguageAdapter {
    return createPolyglotAdapter(DESCRIPTORS.java);
}

function createPolyglotAdapter(descriptor: LanguageDescriptor): LanguageAdapter {
    return {
        language: descriptor.language,
        displayName: descriptor.displayName,
        parserEngine: 'tree-sitter',
        adapterPackage: descriptor.adapterPackage,
        status: 'stable',
        readTopologyIR: (projectRoot) => readPolyglotTopologyIR(descriptor.language, projectRoot),
        parseTopology: (projectRoot, outputPath) => runPolyglotParser(descriptor.language, projectRoot, outputPath),
        applyUpgradeProtocol: (projectRoot, protocolPath) =>
            applyPolyglotProtocol(descriptor.language, projectRoot, protocolPath),
        supportsRuntimeHealing: true
    };
}

function readPolyglotTopologyIR(language: PolyglotLanguage, projectRoot: string): TriadTopologyIR {
    const paths = getWorkspacePaths(projectRoot);
    return buildTopologyIR(readTriadMap(paths.mapFile), language);
}

function runPolyglotParser(language: PolyglotLanguage, projectRoot: string, outputPath?: string): void {
    const paths = getWorkspacePaths(projectRoot);
    const config = loadTriadConfig(paths);
    if (config.architecture.parserEngine !== 'native') {
        runTreeSitterParser(language, projectRoot, outputPath ?? paths.mapFile, config);
        return;
    }

    const descriptor = DESCRIPTORS[language];
    const nodes: TriadNodeDefinition[] = [];
    const targetOutput = outputPath ?? paths.mapFile;
    const includeSourcePath = createSourcePathFilter(projectRoot, config);
    const scanScope = describeSourceScanScope(projectRoot, config);

    if (scanScope.mode === 'scoped') {
        console.log(`   - [Polyglot] scan scope: ${scanScope.patterns.join(', ')}`);
    } else {
        console.log('   - [Polyglot] frontend/backend feature roots not found; falling back to all source files.');
    }

    walkProject(projectRoot, (absolutePath) => {
        const sourcePath = normalizePath(path.relative(projectRoot, absolutePath));
        if (!descriptor.filePatterns.test(absolutePath) || !includeSourcePath(sourcePath)) {
            return;
        }

        if (language === 'go' && sourcePath.endsWith('_test.go')) {
            return;
        }

        const category = resolveCategoryFromConfig(sourcePath, config);
        const content = fs.readFileSync(absolutePath, 'utf-8').replace(/^\uFEFF/, '');
        nodes.push(...parsePolyglotFile(language, content, sourcePath, category, config));
    });

    nodes.sort((left, right) => left.nodeId.localeCompare(right.nodeId));
    fs.mkdirSync(path.dirname(targetOutput), { recursive: true });
    fs.writeFileSync(targetOutput, JSON.stringify(nodes, null, 2), 'utf-8');
}

function applyPolyglotProtocol(
    language: PolyglotLanguage,
    projectRoot: string,
    protocolPath?: string
): { changedFiles: string[] } {
    const resolvedProjectRoot = path.resolve(projectRoot);
    const paths = getWorkspacePaths(resolvedProjectRoot);
    const resolvedProtocolPath = protocolPath ?? paths.draftFile;

    if (!fs.existsSync(resolvedProtocolPath)) {
        throw new Error(`Cannot find protocol file: ${resolvedProtocolPath}`);
    }

    const protocol = readJsonFile<UpgradeProtocol>(resolvedProtocolPath);
    const existingNodes = readTriadMap(paths.mapFile);
    const config = loadTriadConfig(paths);
    assertProtocolShape(protocol, {
        existingNodes,
        minConfidence: config.protocol.minConfidence,
        requireConfidence: config.protocol.requireConfidence
    });

    const nodeLocations = loadNodeLocations(resolvedProjectRoot);
    const changedFiles = new Set<string>();

    for (const action of protocol.actions) {
        if (action.op === 'reuse') {
            continue;
        }

        const node =
            action.op === 'create_child'
                ? action.node
                : {
                      nodeId: action.nodeId,
                      category: action.category,
                      sourcePath: action.sourcePath,
                      fission: action.fission
                  };

        const filePath = upsertPolyglotNode(language, resolvedProjectRoot, node, nodeLocations, action);
        changedFiles.add(normalizePath(path.relative(resolvedProjectRoot, filePath)));
    }

    return {
        changedFiles: Array.from(changedFiles).sort()
    };
}

function parsePolyglotFile(
    language: PolyglotLanguage,
    content: string,
    sourcePath: string,
    category: TriadCategory,
    config: TriadConfig
) {
    switch (language) {
        case 'javascript':
            return parseJavaScriptFile(content, sourcePath, category, config);
        case 'python':
            return parsePythonFile(content, sourcePath, category, config);
        case 'go':
            return parseGoFile(content, sourcePath, category);
        case 'rust':
            return parseRustFile(content, sourcePath, category);
        case 'cpp':
            return parseCppFile(content, sourcePath, category);
        case 'java':
            return parseJavaFile(content, sourcePath, category);
    }
}

function createNode(
    nodeId: string,
    category: TriadCategory,
    sourcePath: string,
    demand: string[],
    answer: string[]
): TriadNodeDefinition {
    const ref = parseNodeRef(nodeId, category);
    return {
        nodeId,
        category,
        sourcePath,
        fission: {
            problem: `执行 ${ref.methodName} 流程`,
            demand: demand.length > 0 ? demand : ['None'],
            answer: answer.length > 0 ? answer : ['void']
        }
    };
}

function walkProject(currentPath: string, visit: (filePath: string) => void) {
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
        walkProject(path.join(currentPath, entry), visit);
    }
}

function loadNodeLocations(projectRoot: string) {
    const candidates = [path.join(projectRoot, '.triadmind', 'triad-map.json'), path.join(projectRoot, 'triad-map.json')];

    for (const candidate of candidates) {
        if (!fs.existsSync(candidate)) {
            continue;
        }

        try {
            const nodes = JSON.parse(fs.readFileSync(candidate, 'utf-8')) as Array<{ nodeId?: string; sourcePath?: string }>;
            return nodes.reduce<NodeLocationMap>((result, item) => {
                if (item.nodeId && item.sourcePath) {
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

function splitArguments(value: string) {
    const parts: string[] = [];
    let current = '';
    let depth = 0;

    for (const char of value) {
        if (char === ',' && depth === 0) {
            if (current.trim()) {
                parts.push(current.trim());
            }
            current = '';
            continue;
        }

        if (char === '<' || char === '(' || char === '[' || char === '{') {
            depth += 1;
        } else if (char === '>' || char === ')' || char === ']' || char === '}') {
            depth = Math.max(0, depth - 1);
        }

        current += char;
    }

    if (current.trim()) {
        parts.push(current.trim());
    }

    return parts;
}

function toPascalCase(value: string) {
    return value
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');
}

function toSnakeCase(value: string) {
    return value
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[^A-Za-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase();
}

function parseJavaScriptFile(
    content: string,
    sourcePath: string,
    category: TriadCategory,
    config: TriadConfig
): TriadNodeDefinition[] {
    const nodes: TriadNodeDefinition[] = [];
    const moduleName = toPascalCase(path.basename(sourcePath, path.extname(sourcePath)));
    const classRegex = /(?:export\s+default\s+|export\s+)?class\s+([A-Za-z_]\w*)\s*\{/gm;
    const functionRegex = /(?:export\s+)?function\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/gm;
    const arrowRegex =
        /(?:export\s+)?(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/gm;

    for (const classMatch of content.matchAll(classRegex)) {
        const className = classMatch[1];
        const body = sliceBraceBody(content, classMatch.index ?? 0);
        if (!body) {
            continue;
        }

        const methodRegex = /(?:async\s+)?([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{/gm;
        for (const methodMatch of body.matchAll(methodRegex)) {
            const methodName = methodMatch[1];
            if (methodName === 'constructor' || methodName.startsWith('#')) {
                continue;
            }

            nodes.push(
                createNode(
                    `${className}.${methodName}`,
                    category,
                    sourcePath,
                    parseJavaScriptParameters(methodMatch[2]),
                    ['unknown']
                )
            );
        }
    }

    for (const match of content.matchAll(functionRegex)) {
        const functionName = match[1];
        if (!config.parser.includeUntaggedExports && !/^export\s+/.test(match[0])) {
            continue;
        }

        nodes.push(
            createNode(
                `${moduleName}.${functionName}`,
                category,
                sourcePath,
                parseJavaScriptParameters(match[2]),
                ['unknown']
            )
        );
    }

    for (const match of content.matchAll(arrowRegex)) {
        const functionName = match[1];
        if (!config.parser.includeUntaggedExports && !/^export\s+/.test(match[0])) {
            continue;
        }

        nodes.push(
            createNode(
                `${moduleName}.${functionName}`,
                category,
                sourcePath,
                parseJavaScriptParameters(match[2]),
                ['unknown']
            )
        );
    }

    return dedupeNodes(nodes);
}

function parseJavaFile(content: string, sourcePath: string, category: TriadCategory): TriadNodeDefinition[] {
    const nodes: TriadNodeDefinition[] = [];
    const classRegex = /(?:public\s+)?class\s+([A-Za-z_]\w*)\b[^{]*\{/gm;

    for (const classMatch of content.matchAll(classRegex)) {
        const className = classMatch[1];
        const body = sliceBraceBody(content, classMatch.index ?? 0);
        if (!body) {
            continue;
        }

        const methodRegex =
            /(?:(?:public|protected|private)\s+)?(?:(?:static|final|abstract|synchronized)\s+)*([A-Za-z_<>\[\], ?]+?)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{/gm;

        for (const methodMatch of body.matchAll(methodRegex)) {
            const returnType = sanitizeType(
                methodMatch[1]
                    .replace(/^(?:\s*(?:public|protected|private|static|final|abstract|synchronized)\s+)+/g, '')
                    .trim()
            );
            const methodName = methodMatch[2];

            if (methodName === className) {
                continue;
            }

            nodes.push(
                createNode(
                    `${className}.${methodName}`,
                    category,
                    sourcePath,
                    parseJavaParameters(methodMatch[3]),
                    [returnType]
                )
            );
        }
    }

    return dedupeNodes(nodes);
}

function parsePythonFile(
    content: string,
    sourcePath: string,
    category: TriadCategory,
    config: TriadConfig
): TriadNodeDefinition[] {
    const nodes: TriadNodeDefinition[] = [];
    const moduleName = toPascalCase(path.basename(sourcePath, path.extname(sourcePath)));
    const lines = content.split(/\r?\n/);
    let currentClass: { name: string; indent: number } | null = null;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        const indent = line.length - line.trimStart().length;
        if (currentClass && indent <= currentClass.indent && !trimmed.startsWith('@')) {
            currentClass = null;
        }

        const classMatch = trimmed.match(/^class\s+([A-Za-z_]\w*)\s*(?:\([^)]*\))?\s*:/);
        if (classMatch) {
            currentClass = { name: classMatch[1], indent };
            continue;
        }

        const functionMatch = trimmed.match(/^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:->\s*([^:]+))?\s*:/);
        if (!functionMatch) {
            continue;
        }

        const functionName = functionMatch[1];
        if (functionName.startsWith('_') || functionName === '__init__') {
            continue;
        }

        const demand = parsePythonParameters(functionMatch[2]);
        const answer = [sanitizeType(functionMatch[3] ?? 'None')];

        if (currentClass && indent > currentClass.indent) {
            nodes.push(createNode(`${currentClass.name}.${functionName}`, category, sourcePath, demand, answer));
            continue;
        }

        if (!config.parser.includeUntaggedExports && functionName.startsWith('_')) {
            continue;
        }

        nodes.push(createNode(`${moduleName}.${functionName}`, category, sourcePath, demand, answer));
    }

    return nodes;
}

function parseGoFile(content: string, sourcePath: string, category: TriadCategory): TriadNodeDefinition[] {
    const nodes: TriadNodeDefinition[] = [];
    const moduleName = toPascalCase(path.basename(sourcePath, '.go'));
    const methodRegex =
        /^func\s*\(\s*[_A-Za-z]\w*\s+\*?([A-Za-z_]\w*)\s*\)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:\(([^)]*)\)|([^{\s]+))?/gm;
    const functionRegex = /^func\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:\(([^)]*)\)|([^{\s]+))?/gm;

    for (const match of content.matchAll(methodRegex)) {
        nodes.push(
            createNode(
                `${match[1]}.${match[2]}`,
                category,
                sourcePath,
                parseGoParameters(match[3]),
                [sanitizeType(match[4] || match[5] || 'void')]
            )
        );
    }

    for (const match of content.matchAll(functionRegex)) {
        const functionName = match[1];
        if (functionName.includes('.')) {
            continue;
        }

        nodes.push(
            createNode(
                `${moduleName}.${functionName}`,
                category,
                sourcePath,
                parseGoParameters(match[2]),
                [sanitizeType(match[3] || match[4] || 'void')]
            )
        );
    }

    return dedupeNodes(nodes);
}

function parseRustFile(content: string, sourcePath: string, category: TriadCategory): TriadNodeDefinition[] {
    const nodes: TriadNodeDefinition[] = [];
    const moduleName = toPascalCase(path.basename(sourcePath, '.rs'));
    const lines = content.split(/\r?\n/);
    let currentImpl: { name: string; depth: number } | null = null;
    let braceDepth = 0;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }

        const implMatch = trimmed.match(/^impl(?:<[^>]+>)?\s+([A-Za-z_]\w*)[^{]*\{/);
        if (implMatch) {
            currentImpl = { name: implMatch[1], depth: braceDepth + countChar(trimmed, '{') - countChar(trimmed, '}') };
        }

        const functionMatch = trimmed.match(/^(?:pub\s+)?fn\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:->\s*([^{]+))?/);
        if (functionMatch) {
            const demand = parseRustParameters(functionMatch[2]);
            const answer = [sanitizeType(functionMatch[3] ?? '()')];
            if (currentImpl) {
                nodes.push(createNode(`${currentImpl.name}.${functionMatch[1]}`, category, sourcePath, demand, answer));
            } else {
                nodes.push(createNode(`${moduleName}.${functionMatch[1]}`, category, sourcePath, demand, answer));
            }
        }

        braceDepth += countChar(trimmed, '{');
        braceDepth -= countChar(trimmed, '}');
        if (currentImpl && braceDepth < currentImpl.depth) {
            currentImpl = null;
        }
    }

    return dedupeNodes(nodes);
}

function parseCppFile(content: string, sourcePath: string, category: TriadCategory): TriadNodeDefinition[] {
    const nodes: TriadNodeDefinition[] = [];
    const moduleName = toPascalCase(path.basename(sourcePath, path.extname(sourcePath)));
    const lines = content.split(/\r?\n/);
    let currentClass: { name: string; depth: number } | null = null;
    let braceDepth = 0;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//')) {
            braceDepth += countChar(trimmed, '{');
            braceDepth -= countChar(trimmed, '}');
            continue;
        }

        const classMatch = trimmed.match(/^(?:class|struct)\s+([A-Za-z_]\w*)\b[^;{]*\{/);
        if (classMatch) {
            currentClass = { name: classMatch[1], depth: braceDepth + countChar(trimmed, '{') - countChar(trimmed, '}') };
        }

        const scopedMatch = trimmed.match(/^(.+?)\s+([A-Za-z_]\w*)::([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:const)?\s*(?:->\s*([^{]+))?\s*\{/);
        if (scopedMatch) {
            nodes.push(
                createNode(
                    `${scopedMatch[2]}.${scopedMatch[3]}`,
                    category,
                    sourcePath,
                    parseCppParameters(scopedMatch[4]),
                    [sanitizeType(scopedMatch[5] || scopedMatch[1])]
                )
            );
        } else {
            const inlineMatch = trimmed.match(/^(.+?)\s+([A-Za-z_]\w*)\s*\(([^;{}]*)\)\s*(?:const)?\s*(?:->\s*([^{;]+))?\s*(?:\{|;)/);
            if (inlineMatch) {
                const methodName = inlineMatch[2];
                if (methodName !== 'if' && methodName !== 'for' && methodName !== 'while' && methodName !== 'switch') {
                    const answer = [sanitizeType(inlineMatch[4] || inlineMatch[1])];
                    const demand = parseCppParameters(inlineMatch[3]);
                    if (currentClass && methodName !== currentClass.name && methodName !== `~${currentClass.name}`) {
                        nodes.push(createNode(`${currentClass.name}.${methodName}`, category, sourcePath, demand, answer));
                    } else if (!currentClass) {
                        nodes.push(createNode(`${moduleName}.${methodName}`, category, sourcePath, demand, answer));
                    }
                }
            }
        }

        braceDepth += countChar(trimmed, '{');
        braceDepth -= countChar(trimmed, '}');
        if (currentClass && braceDepth < currentClass.depth) {
            currentClass = null;
        }
    }

    return dedupeNodes(nodes);
}

function parsePythonParameters(paramsText: string) {
    return splitArguments(paramsText)
        .map((segment) => segment.replace(/=.*/, '').trim())
        .filter((segment) => segment && segment !== 'self' && segment !== 'cls')
        .map((segment, index) => {
            const normalized = segment.replace(/^\*+/, '');
            const parts = normalized.split(':');
            const name = parts[0]?.trim() || `input${index + 1}`;
            const typeName = sanitizeType(parts[1] ?? 'unknown');
            return `${typeName} (${name})`;
        });
}

function parseJavaScriptParameters(paramsText: string) {
    return splitArguments(paramsText)
        .map((segment) => segment.replace(/=.*/, '').trim())
        .filter(Boolean)
        .map((segment, index) => {
            const normalized = segment.replace(/^[.{\[\]\s]+|[}\]]+$/g, '').trim();
            const name = normalized || `input${index + 1}`;
            return `unknown (${name})`;
        });
}

function parseGoParameters(paramsText: string) {
    return splitArguments(paramsText)
        .map((segment) => segment.trim())
        .filter(Boolean)
        .map((segment, index) => {
            const tokens = segment.split(/\s+/).filter(Boolean);
            if (tokens.length >= 2) {
                return `${sanitizeType(tokens.slice(1).join(' '))} (${tokens[0]})`;
            }

            return `unknown (${tokens[0] ?? `input${index + 1}`})`;
        });
}

function parseJavaParameters(paramsText: string) {
    return splitArguments(paramsText)
        .map((segment) => segment.replace(/@[\w.]+(?:\([^)]*\))?\s*/g, '').trim())
        .filter(Boolean)
        .map((segment, index) => {
            const tokens = segment.split(/\s+/).filter(Boolean);
            if (tokens.length >= 2) {
                const name = tokens[tokens.length - 1];
                const typeName = sanitizeType(tokens.slice(0, -1).join(' '));
                return `${typeName} (${name})`;
            }

            return `unknown (${tokens[0] ?? `input${index + 1}`})`;
        });
}

function parseRustParameters(paramsText: string) {
    return splitArguments(paramsText)
        .map((segment) => segment.trim())
        .filter((segment) => segment && segment !== 'self' && segment !== '&self' && segment !== '&mut self')
        .map((segment, index) => {
            const parts = segment.split(':');
            const name = parts[0]?.trim() || `input${index + 1}`;
            const typeName = sanitizeType(parts[1] ?? 'unknown');
            return `${typeName} (${name})`;
        });
}

function parseCppParameters(paramsText: string) {
    return splitArguments(paramsText)
        .map((segment) => segment.replace(/=.*/, '').trim())
        .filter(Boolean)
        .map((segment, index) => {
            const tokens = segment.split(/\s+/).filter(Boolean);
            if (tokens.length >= 2) {
                const name = tokens[tokens.length - 1].replace(/^[*&]+/, '');
                const typeName = sanitizeType(tokens.slice(0, -1).join(' '));
                return `${typeName} (${name})`;
            }

            return `${sanitizeType(segment)} (input${index + 1})`;
        });
}

function sanitizeType(value: string) {
    const normalized = value.trim().replace(/\s+/g, ' ');
    if (!normalized || normalized === 'None' || normalized === '()') {
        return 'void';
    }

    return normalized;
}

function dedupeNodes(nodes: TriadNodeDefinition[]) {
    const seen = new Set<string>();
    return nodes.filter((node) => {
        if (seen.has(node.nodeId)) {
            return false;
        }

        seen.add(node.nodeId);
        return true;
    });
}

function countChar(value: string, target: string) {
    let count = 0;
    for (const char of value) {
        if (char === target) {
            count += 1;
        }
    }
    return count;
}

function sliceBraceBody(content: string, startIndex: number) {
    const braceIndex = content.indexOf('{', startIndex);
    const block = locateBraceBlock(content, braceIndex);
    if (!block) {
        return '';
    }

    return content.slice(braceIndex + 1, block.end);
}

function upsertPolyglotNode(
    language: PolyglotLanguage,
    projectRoot: string,
    node: TriadNodeDefinition,
    nodeLocations: NodeLocationMap,
    action: PolyglotAction
) {
    const ref = parseNodeRef(node.nodeId, node.category);
    const filePath = resolvePolyglotSourcePath(language, projectRoot, ref, node, nodeLocations, action);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const existingContent = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
    const nextContent = buildUpdatedSource(language, filePath, existingContent, node, action);
    fs.writeFileSync(filePath, ensureTrailingNewline(nextContent), 'utf-8');
    return filePath;
}

function resolvePolyglotSourcePath(
    language: PolyglotLanguage,
    projectRoot: string,
    ref: ReturnType<typeof parseNodeRef>,
    node: TriadNodeDefinition,
    nodeLocations: NodeLocationMap,
    action: PolyglotAction
) {
    const relativeSource =
        node.sourcePath || nodeLocations[node.nodeId] || ('parentNodeId' in action ? nodeLocations[action.parentNodeId] : undefined);

    if (relativeSource) {
        return path.isAbsolute(relativeSource) ? relativeSource : path.join(projectRoot, relativeSource);
    }

    const category = node.category ?? 'core';
    const rootCandidates = [
        path.join(projectRoot, 'src', category),
        path.join(projectRoot, category),
        path.join(projectRoot, 'src'),
        projectRoot
    ];
    const baseDir = rootCandidates.find((candidate) => fs.existsSync(candidate)) ?? rootCandidates[0];
    const stem = language === 'rust' ? toSnakeCase(ref.className) : ref.className;
    const extension = DESCRIPTORS[language].extension;
    return path.join(baseDir, `${stem}${extension}`);
}

function buildUpdatedSource(
    language: PolyglotLanguage,
    filePath: string,
    existingContent: string,
    node: TriadNodeDefinition,
    action: PolyglotAction
) {
    switch (language) {
        case 'javascript':
            return upsertJavaScriptSource(filePath, existingContent, node, action);
        case 'python':
            return upsertPythonSource(filePath, existingContent, node, action);
        case 'go':
            return upsertGoSource(filePath, existingContent, node);
        case 'rust':
            return upsertRustSource(filePath, existingContent, node);
        case 'cpp':
            return upsertCppSource(filePath, existingContent, node);
        case 'java':
            return upsertJavaSource(filePath, existingContent, node);
    }
}

function upsertPythonSource(
    filePath: string,
    existingContent: string,
    node: TriadNodeDefinition,
    action: PolyglotAction
) {
    const ref = parseNodeRef(node.nodeId, node.category);
    const params = buildPythonParameters(node.fission.demand, false);
    const returnType = parseReturnType(node.fission.answer[0] ?? 'void');
    const functionSignature = `def ${ref.methodName}(${params})${buildPythonReturn(returnType)}:`;
    const classSignature = `def ${ref.methodName}(self${params ? `, ${params}` : ''})${buildPythonReturn(returnType)}:`;
    const topLevel = shouldUseTopLevel(filePath, existingContent, ref, 'python', action);

    if (topLevel) {
        return upsertTopLevelFunction(
            existingContent,
            new RegExp(`(^|\\n)def\\s+${escapeRegExp(ref.methodName)}\\s*\\([^\\n]*`, 'm'),
            buildPythonFunctionBlock(functionSignature, node)
        );
    }

    return upsertPythonClassMethod(existingContent, ref.className, ref.methodName, buildPythonMethodBlock(classSignature, node));
}

function upsertJavaScriptSource(
    filePath: string,
    existingContent: string,
    node: TriadNodeDefinition,
    action: PolyglotAction
) {
    const ref = parseNodeRef(node.nodeId, node.category);
    const params = buildJavaScriptParameters(node.fission.demand);
    const topLevel = shouldUseTopLevel(filePath, existingContent, ref, 'javascript', action);
    const exportPrefix = /\bexport\s+(?:default\s+)?(?:function|const|class)\b/.test(existingContent) ? 'export ' : '';

    if (topLevel) {
        return upsertTopLevelFunction(
            existingContent,
            new RegExp(`(^|\\n)(?:export\\s+)?function\\s+${escapeRegExp(ref.methodName)}\\s*\\([^\\n]*`, 'm'),
            buildJavaScriptFunctionBlock(`${exportPrefix}function ${ref.methodName}(${params}) {`, node)
        );
    }

    return upsertJavaScriptClassMethod(
        existingContent,
        ref.className,
        ref.methodName,
        buildJavaScriptMethodBlock(`${ref.methodName}(${params}) {`, node)
    );
}

function upsertGoSource(filePath: string, existingContent: string, node: TriadNodeDefinition) {
    const ref = parseNodeRef(node.nodeId, node.category);
    const params = buildGoParameters(node.fission.demand);
    const returnType = buildGoReturn(parseReturnType(node.fission.answer[0] ?? 'void'));
    const packageName = matchOrDefault(existingContent.match(/^\s*package\s+([A-Za-z_]\w*)/m)?.[1], 'main');
    let content = existingContent.trim() ? existingContent : `package ${packageName}\n`;

    if (shouldUseTopLevel(filePath, existingContent, ref, 'go')) {
        return upsertTopLevelFunction(
            content,
            new RegExp(`(^|\\n)func\\s+${escapeRegExp(ref.methodName)}\\s*\\([^\\n]*`, 'm'),
            buildGoFunctionBlock(`func ${ref.methodName}(${params})${returnType} {`, node)
        );
    }

    if (!new RegExp(`\\btype\\s+${escapeRegExp(ref.className)}\\s+struct\\b`).test(content)) {
        content = ensureSeparated(content, `type ${ref.className} struct {\n}\n`);
    }

    return upsertTopLevelFunction(
        content,
        new RegExp(`(^|\\n)func\\s*\\(\\s*[A-Za-z_]\\w*\\s+\\*?${escapeRegExp(ref.className)}\\s*\\)\\s+${escapeRegExp(ref.methodName)}\\s*\\([^\\n]*`, 'm'),
        buildGoFunctionBlock(`func (receiver *${ref.className}) ${ref.methodName}(${params})${returnType} {`, node)
    );
}

function upsertRustSource(filePath: string, existingContent: string, node: TriadNodeDefinition) {
    const ref = parseNodeRef(node.nodeId, node.category);
    const params = buildRustParameters(node.fission.demand, false);
    const methodParams = buildRustParameters(node.fission.demand, true);
    const returnType = buildRustReturn(parseReturnType(node.fission.answer[0] ?? 'void'));
    let content = existingContent;

    if (shouldUseTopLevel(filePath, existingContent, ref, 'rust')) {
        return upsertTopLevelFunction(
            content,
            new RegExp(`(^|\\n)(?:pub\\s+)?fn\\s+${escapeRegExp(ref.methodName)}\\s*\\([^\\n]*`, 'm'),
            buildRustFunctionBlock(`pub fn ${ref.methodName}(${params})${returnType} {`, node)
        );
    }

    if (!new RegExp(`\\b(?:pub\\s+)?struct\\s+${escapeRegExp(ref.className)}\\b`).test(content)) {
        content = ensureSeparated(content, `pub struct ${ref.className};\n`);
    }

    const implBlock = `impl ${ref.className} {\n${indentBlock(
        buildRustFunctionBlock(`pub fn ${ref.methodName}(${methodParams})${returnType} {`, node),
        4
    )}\n}\n`;

    if (!new RegExp(`\\bimpl\\s+${escapeRegExp(ref.className)}\\b`).test(content)) {
        return ensureSeparated(content, implBlock);
    }

    return insertIntoRustImpl(
        content,
        ref.className,
        ref.methodName,
        buildRustFunctionBlock(`pub fn ${ref.methodName}(${methodParams})${returnType} {`, node)
    );
}

function upsertCppSource(filePath: string, existingContent: string, node: TriadNodeDefinition) {
    const ref = parseNodeRef(node.nodeId, node.category);
    const params = buildCppParameters(node.fission.demand);
    const returnType = buildCppReturn(parseReturnType(node.fission.answer[0] ?? 'void'));
    let content = ensureCppIncludes(existingContent);

    if (shouldUseTopLevel(filePath, existingContent, ref, 'cpp')) {
        return upsertTopLevelFunction(
            content,
            new RegExp(`(^|\\n)(?:auto|[A-Za-z_:][^\\n{;]*)\\s+${escapeRegExp(ref.methodName)}\\s*\\([^\\n]*`, 'm'),
            buildCppFunctionBlock(`auto ${ref.methodName}(${params}) -> ${returnType} {`, node)
        );
    }

    if (!new RegExp(`\\b(?:class|struct)\\s+${escapeRegExp(ref.className)}\\b`).test(content)) {
        content = ensureSeparated(content, `class ${ref.className} {\npublic:\n    auto ${ref.methodName}(${params}) -> ${returnType};\n};\n`);
    } else if (!new RegExp(`\\b${escapeRegExp(ref.methodName)}\\s*\\(`).test(extractCppClassBlock(content, ref.className))) {
        content = insertIntoCppClass(content, ref.className, `auto ${ref.methodName}(${params}) -> ${returnType};`);
    }

    return upsertTopLevelFunction(
        content,
        new RegExp(`(^|\\n)(?:auto|[A-Za-z_:][^\\n{;]*)\\s+${escapeRegExp(ref.className)}::${escapeRegExp(ref.methodName)}\\s*\\([^\\n]*`, 'm'),
        buildCppFunctionBlock(`auto ${ref.className}::${ref.methodName}(${params}) -> ${returnType} {`, node)
    );
}

function upsertJavaSource(filePath: string, existingContent: string, node: TriadNodeDefinition) {
    const ref = parseNodeRef(node.nodeId, node.category);
    const params = buildJavaParameters(node.fission.demand);
    const returnType = buildJavaReturn(parseReturnType(node.fission.answer[0] ?? 'void'));
    const methodBlock = buildJavaFunctionBlock(`public ${returnType} ${ref.methodName}(${params}) {`, node);
    const classPattern = new RegExp(`(?:public\\s+)?class\\s+${escapeRegExp(ref.className)}\\b[^\\n]*\\{`, 'm');
    const contentWithImports = ensureJavaImports(existingContent, node);

    if (!classPattern.test(contentWithImports)) {
        return ensureSeparated(contentWithImports, `public class ${ref.className} {\n${indentBlock(methodBlock, 4)}\n}\n`);
    }

    const methodPattern = new RegExp(`\\b${escapeRegExp(ref.methodName)}\\s*\\(`, 'm');
    const classBlock = sliceBraceBody(contentWithImports, classPattern.exec(contentWithImports)?.index ?? 0);
    if (methodPattern.test(classBlock)) {
        return replaceSignatureLine(
            contentWithImports,
            new RegExp(`(^|\\n)\\s*(?:public|protected|private)?\\s*(?:static\\s+)?[A-Za-z_<>, ?\\[\\]]+\\s+${escapeRegExp(ref.methodName)}\\s*\\([^\\n]*`, 'm'),
            `    ${firstLine(methodBlock).trimStart()}`
        );
    }

    return insertIntoBraceBlock(contentWithImports, classPattern, `\n${indentBlock(methodBlock, 4)}\n`);
}

function shouldUseTopLevel(
    filePath: string,
    content: string,
    ref: ReturnType<typeof parseNodeRef>,
    language: PolyglotLanguage,
    action?: PolyglotAction
) {
    if (language === 'python' && new RegExp(`(^|\\n)class\\s+${escapeRegExp(ref.className)}\\b`, 'm').test(content)) {
        return false;
    }
    if (language === 'javascript' && new RegExp(`(^|\\n)(?:export\\s+default\\s+|export\\s+)?class\\s+${escapeRegExp(ref.className)}\\b`, 'm').test(content)) {
        return false;
    }
    if (language === 'go' && new RegExp(`\\btype\\s+${escapeRegExp(ref.className)}\\s+struct\\b`).test(content)) {
        return false;
    }
    if (language === 'rust' && new RegExp(`\\bimpl\\s+${escapeRegExp(ref.className)}\\b`).test(content)) {
        return false;
    }
    if (language === 'cpp' && new RegExp(`\\b(?:class|struct)\\s+${escapeRegExp(ref.className)}\\b`).test(content)) {
        return false;
    }
    if (language === 'java' && new RegExp(`\\b(?:public\\s+)?class\\s+${escapeRegExp(ref.className)}\\b`).test(content)) {
        return false;
    }

    const stem = path.basename(filePath, path.extname(filePath));
    const stemPascal = toPascalCase(stem);
    if (stemPascal === ref.className || ['main', 'index', 'lib', 'mod'].includes(stem.toLowerCase())) {
        return true;
    }

    if (language === 'go' || language === 'rust') {
        return true;
    }

    if (language === 'java') {
        return false;
    }

    return action?.op === 'modify' ? !content.trim() : false;
}

function upsertTopLevelFunction(content: string, signaturePattern: RegExp, block: string) {
    if (signaturePattern.test(content)) {
        return replaceSignatureLine(content, signaturePattern, firstLine(block));
    }

    return ensureSeparated(content, block);
}

function upsertPythonClassMethod(content: string, className: string, methodName: string, block: string) {
    const classPattern = new RegExp(`(^|\\n)class\\s+${escapeRegExp(className)}\\b[^\\n]*:`, 'm');
    if (!classPattern.test(content)) {
        return ensureSeparated(content, `class ${className}:\n${indentBlock(block, 4)}\n`);
    }

    const methodPattern = new RegExp(`(^|\\n)\\s+def\\s+${escapeRegExp(methodName)}\\s*\\([^\\n]*`, 'm');
    if (methodPattern.test(content)) {
        return replaceSignatureLine(content, methodPattern, `    ${firstLine(block).trimStart()}`);
    }

    return insertIntoIndentedBlock(content, classPattern, `\n${indentBlock(block, 4)}\n`);
}

function upsertJavaScriptClassMethod(content: string, className: string, methodName: string, block: string) {
    const classPattern = new RegExp(`(^|\\n)(?:export\\s+default\\s+|export\\s+)?class\\s+${escapeRegExp(className)}\\b[^\\n]*\\{`, 'm');
    if (!classPattern.test(content)) {
        return ensureSeparated(content, `class ${className} {\n${indentBlock(block, 4)}\n}\n`);
    }

    const classBody = sliceBraceBody(content, classPattern.exec(content)?.index ?? 0);
    if (new RegExp(`\\b${escapeRegExp(methodName)}\\s*\\(`, 'm').test(classBody)) {
        return replaceSignatureLine(
            content,
            new RegExp(`(^|\\n)\\s*(?:async\\s+)?${escapeRegExp(methodName)}\\s*\\([^\\n]*`, 'm'),
            `    ${firstLine(block).trimStart()}`
        );
    }

    return insertIntoBraceBlock(content, classPattern, `\n${indentBlock(block, 4)}\n`);
}

function insertIntoRustImpl(content: string, className: string, methodName: string, functionBlock: string) {
    const implPattern = new RegExp(`impl\\s+${escapeRegExp(className)}\\b[^\\n]*\\{`, 'm');
    const existingPattern = new RegExp(`\\bfn\\s+${escapeRegExp(methodName)}\\b`);
    if (existingPattern.test(content)) {
        return content;
    }

    return insertIntoBraceBlock(content, implPattern, `\n${indentBlock(functionBlock, 4)}\n`);
}

function insertIntoCppClass(content: string, className: string, declaration: string) {
    const classPattern = new RegExp(`(?:class|struct)\\s+${escapeRegExp(className)}\\b[^\\n]*\\{`, 'm');
    return insertIntoBraceBlock(content, classPattern, `\n    ${declaration}\n`);
}

function extractCppClassBlock(content: string, className: string) {
    const classPattern = new RegExp(`(?:class|struct)\\s+${escapeRegExp(className)}\\b[^\\n]*\\{`, 'm');
    const match = classPattern.exec(content);
    if (!match || match.index < 0) {
        return '';
    }

    const block = locateBraceBlock(content, match.index + match[0].length - 1);
    return block ? content.slice(block.start, block.end + 1) : '';
}

function buildPythonFunctionBlock(signature: string, node: TriadNodeDefinition) {
    return [
        signature,
        `    """TriadMind generated vertex: ${node.nodeId}`,
        `    Responsibility: ${node.fission.problem}`,
        '    """',
        `    raise NotImplementedError(${JSON.stringify(`TODO ${node.nodeId}`)})`
    ].join('\n');
}

function buildPythonMethodBlock(signature: string, node: TriadNodeDefinition) {
    return buildPythonFunctionBlock(signature, node);
}

function buildJavaScriptFunctionBlock(signature: string, node: TriadNodeDefinition) {
    return [signature, `    throw new Error(${JSON.stringify(`TODO ${node.nodeId}: ${node.fission.problem}`)});`, '}'].join('\n');
}

function buildJavaScriptMethodBlock(signature: string, node: TriadNodeDefinition) {
    return buildJavaScriptFunctionBlock(signature, node);
}

function buildGoFunctionBlock(signature: string, node: TriadNodeDefinition) {
    return [signature, `    panic(${JSON.stringify(`TODO ${node.nodeId}: ${node.fission.problem}`)})`, '}'].join('\n');
}

function buildRustFunctionBlock(signature: string, node: TriadNodeDefinition) {
    return [signature, `    todo!(${JSON.stringify(`${node.nodeId}: ${node.fission.problem}`)});`, '}'].join('\n');
}

function buildCppFunctionBlock(signature: string, node: TriadNodeDefinition) {
    return [signature, `    throw std::runtime_error(${JSON.stringify(`TODO ${node.nodeId}: ${node.fission.problem}`)});`, '}'].join('\n');
}

function buildJavaFunctionBlock(signature: string, node: TriadNodeDefinition) {
    return [
        signature,
        `    throw new UnsupportedOperationException(${JSON.stringify(`TODO ${node.nodeId}: ${node.fission.problem}`)});`,
        '}'
    ].join('\n');
}

function buildPythonParameters(demand: string[], includeSelf: boolean) {
    const params = buildNamedParameters(demand, ': ', false);
    if (includeSelf) {
        return params;
    }
    return params;
}

function buildJavaScriptParameters(demand: string[]) {
    return buildNamedParameters(demand, '', false, true);
}

function buildGoParameters(demand: string[]) {
    return buildNamedParameters(demand, ' ', false);
}

function buildRustParameters(demand: string[], includeReceiver: boolean) {
    const params = buildNamedParameters(demand, ': ', false);
    if (includeReceiver) {
        return params ? `&self, ${params}` : '&self';
    }
    return params;
}

function buildCppParameters(demand: string[]) {
    return buildNamedParameters(demand, ' ', true);
}

function buildJavaParameters(demand: string[]) {
    return buildNamedParameters(demand, ' ', true);
}

function buildNamedParameters(demand: string[], delimiter: string, typeFirst: boolean, namesOnly = false) {
    return demand
        .map((entry, index) => parseDemandEntry(entry, index))
        .filter((value): value is NonNullable<ReturnType<typeof parseDemandEntry>> => Boolean(value))
        .map((value, index) =>
            namesOnly
                ? `${value.name || `input${index + 1}`}`
                : typeFirst
                ? `${normalizeParameterType(value.type)}${delimiter}${value.name || `input${index + 1}`}`
                : `${value.name || `input${index + 1}`}${delimiter}${normalizeParameterType(value.type)}`
        )
        .join(', ');
}

function buildPythonReturn(returnType: string) {
    return returnType && returnType !== 'void' ? ` -> ${normalizeParameterType(returnType)}` : '';
}

function buildGoReturn(returnType: string) {
    return returnType && returnType !== 'void' ? ` ${normalizeParameterType(returnType)}` : '';
}

function buildRustReturn(returnType: string) {
    return returnType && returnType !== 'void' ? ` -> ${normalizeParameterType(returnType)}` : '';
}

function buildCppReturn(returnType: string) {
    return normalizeParameterType(returnType || 'void');
}

function buildJavaReturn(returnType: string) {
    return normalizeParameterType(returnType || 'void');
}

function normalizeParameterType(typeText: string) {
    return sanitizeType(typeText || 'unknown');
}

function ensureCppIncludes(content: string) {
    let next = content;
    if (!/#include\s+<stdexcept>/.test(next)) {
        next = `#include <stdexcept>\n${next}`;
    }
    return next;
}

function ensureJavaImports(content: string, node: TriadNodeDefinition) {
    const imports = new Set<string>();
    const knownImports: Record<string, string> = {
        List: 'java.util.List',
        Map: 'java.util.Map',
        Set: 'java.util.Set',
        Optional: 'java.util.Optional'
    };

    const registerType = (typeText: string) => {
        for (const [shortName, fullName] of Object.entries(knownImports)) {
            if (new RegExp(`\\b${shortName}\\b`).test(typeText)) {
                imports.add(fullName);
            }
        }
    };

    node.fission.demand.forEach((entry, index) => {
        const parsed = parseDemandEntry(entry, index);
        if (parsed) {
            registerType(parsed.type);
        }
    });
    registerType(parseReturnType(node.fission.answer[0] ?? 'void'));

    let next = content;
    for (const fullName of Array.from(imports).sort()) {
        const importLine = `import ${fullName};`;
        if (next.includes(importLine)) {
            continue;
        }

        const packageMatch = next.match(/^\s*package\s+[A-Za-z0-9_.]+\s*;\s*/m);
        if (packageMatch && typeof packageMatch.index === 'number') {
            const insertAt = packageMatch.index + packageMatch[0].length;
            next = `${next.slice(0, insertAt)}\n${importLine}${next.slice(insertAt)}`;
            continue;
        }

        next = next.trimStart() ? `${importLine}\n${next}` : `${importLine}\n`;
    }

    return next;
}

function replaceSignatureLine(content: string, pattern: RegExp, signatureLine: string) {
    const match = pattern.exec(content);
    if (!match || match.index < 0) {
        return content;
    }

    const start = match.index + (match[1] ? match[1].length : 0);
    const lineEnd = content.indexOf('\n', start);
    const end = lineEnd === -1 ? content.length : lineEnd;
    return `${content.slice(0, start)}${signatureLine}${content.slice(end)}`;
}

function insertIntoIndentedBlock(content: string, startPattern: RegExp, insertion: string) {
    const match = startPattern.exec(content);
    if (!match || match.index < 0) {
        return ensureSeparated(content, insertion.trim());
    }

    const startIndex = match.index + match[0].length;
    const lines = content.split('\n');
    let offset = 0;
    const targetLineIndex = content.slice(0, startIndex).split('\n').length - 1;
    const classIndent = lines[targetLineIndex].length - lines[targetLineIndex].trimStart().length;

    for (let index = 0; index < targetLineIndex + 1; index += 1) {
        offset += lines[index].length + 1;
    }

    let insertAt = content.length;
    let runningOffset = offset;
    for (let index = targetLineIndex + 1; index < lines.length; index += 1) {
        const line = lines[index];
        const trimmed = line.trim();
        const indent = line.length - line.trimStart().length;
        if (trimmed && indent <= classIndent) {
            insertAt = runningOffset - 1;
            break;
        }
        runningOffset += line.length + 1;
    }

    return `${content.slice(0, insertAt)}${insertion}${content.slice(insertAt)}`;
}

function insertIntoBraceBlock(content: string, startPattern: RegExp, insertion: string) {
    const match = startPattern.exec(content);
    if (!match || match.index < 0) {
        return ensureSeparated(content, insertion.trim());
    }

    const braceIndex = content.indexOf('{', match.index);
    const block = locateBraceBlock(content, braceIndex);
    if (!block) {
        return ensureSeparated(content, insertion.trim());
    }

    return `${content.slice(0, block.end)}${insertion}${content.slice(block.end)}`;
}

function locateBraceBlock(content: string, braceIndex: number) {
    if (braceIndex < 0 || content[braceIndex] !== '{') {
        return null;
    }

    let depth = 0;
    for (let index = braceIndex; index < content.length; index += 1) {
        if (content[index] === '{') {
            depth += 1;
        } else if (content[index] === '}') {
            depth -= 1;
            if (depth === 0) {
                return { start: braceIndex, end: index };
            }
        }
    }

    return null;
}

function ensureSeparated(content: string, block: string) {
    const trimmed = content.trimEnd();
    if (!trimmed) {
        return block;
    }

    return `${trimmed}\n\n${block}`;
}

function indentBlock(content: string, spaces: number) {
    const indent = ' '.repeat(spaces);
    return content
        .split('\n')
        .map((line) => (line ? `${indent}${line}` : line))
        .join('\n');
}

function ensureTrailingNewline(content: string) {
    return content.endsWith('\n') ? content : `${content}\n`;
}

function firstLine(content: string) {
    return content.split('\n')[0] ?? content;
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchOrDefault(value: string | undefined, fallback: string) {
    return value && value.trim() ? value.trim() : fallback;
}
