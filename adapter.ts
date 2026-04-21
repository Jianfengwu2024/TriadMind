import { loadTriadConfig, TriadLanguage, TriadParserEngine } from './config';
import { applyProtocol } from './generator';
import { buildTopologyIR, TriadTopologyIR } from './ir';
import { runParser } from './parser';
import { readTriadMap } from './protocol';
import { runTreeSitterTypeScriptParser } from './treeSitterParser';
import { WorkspacePaths, getWorkspacePaths } from './workspace';

export interface TriadLanguageAdapter {
    language: TriadLanguage;
    displayName: string;
    parserEngine: TriadParserEngine;
    adapterPackage: string;
    status: 'stable' | 'planned';
    readTopologyIR(projectRoot: string): TriadTopologyIR;
    parseTopology(projectRoot: string, outputPath?: string): void;
    applyUpgradeProtocol(projectRoot: string, protocolPath?: string): { changedFiles: string[] };
    supportsRuntimeHealing: boolean;
}

const typescriptAdapter: TriadLanguageAdapter = {
    language: 'typescript',
    displayName: 'TypeScript',
    parserEngine: 'native',
    adapterPackage: '@triadmind/plugin-ts',
    status: 'stable',
    readTopologyIR(projectRoot) {
        const paths = getWorkspacePaths(projectRoot);
        return buildTopologyIR(readTriadMap(paths.mapFile), 'typescript');
    },
    parseTopology(projectRoot, outputPath) {
        const paths = getWorkspacePaths(projectRoot);
        const config = loadTriadConfig(paths);
        if (config.architecture.parserEngine === 'tree-sitter') {
            runTreeSitterTypeScriptParser(projectRoot, outputPath ?? paths.mapFile, config);
            return;
        }

        runParser(projectRoot, outputPath);
    },
    applyUpgradeProtocol(projectRoot, protocolPath) {
        return applyProtocol(projectRoot, protocolPath);
    },
    supportsRuntimeHealing: true
};

const plannedAdapters: TriadLanguageAdapter[] = [
    {
        language: 'python',
        displayName: 'Python',
        parserEngine: 'tree-sitter',
        adapterPackage: '@triadmind/plugin-python',
        status: 'planned',
        readTopologyIR() {
            throw new Error('Python adapter is planned but not implemented yet');
        },
        parseTopology() {
            throw new Error('Python adapter is planned but not implemented yet');
        },
        applyUpgradeProtocol() {
            throw new Error('Python adapter is planned but not implemented yet');
        },
        supportsRuntimeHealing: true
    },
    {
        language: 'go',
        displayName: 'Go',
        parserEngine: 'tree-sitter',
        adapterPackage: '@triadmind/plugin-go',
        status: 'planned',
        readTopologyIR() {
            throw new Error('Go adapter is planned but not implemented yet');
        },
        parseTopology() {
            throw new Error('Go adapter is planned but not implemented yet');
        },
        applyUpgradeProtocol() {
            throw new Error('Go adapter is planned but not implemented yet');
        },
        supportsRuntimeHealing: true
    },
    {
        language: 'rust',
        displayName: 'Rust',
        parserEngine: 'tree-sitter',
        adapterPackage: '@triadmind/plugin-rust',
        status: 'planned',
        readTopologyIR() {
            throw new Error('Rust adapter is planned but not implemented yet');
        },
        parseTopology() {
            throw new Error('Rust adapter is planned but not implemented yet');
        },
        applyUpgradeProtocol() {
            throw new Error('Rust adapter is planned but not implemented yet');
        },
        supportsRuntimeHealing: true
    }
];

const adapterRegistry = new Map<TriadLanguage, TriadLanguageAdapter>(
    [typescriptAdapter, ...plannedAdapters].map((adapter) => [adapter.language, adapter])
);

export function getAvailableAdapters() {
    return Array.from(adapterRegistry.values());
}

export function resolveAdapter(pathsOrProjectRoot: WorkspacePaths | string) {
    const paths = typeof pathsOrProjectRoot === 'string' ? getWorkspacePaths(pathsOrProjectRoot) : pathsOrProjectRoot;
    const config = loadTriadConfig(paths);
    const adapter = adapterRegistry.get(config.architecture.language);

    if (!adapter) {
        throw new Error(`Unsupported TriadMind language adapter: ${config.architecture.language}`);
    }

    if (adapter.status !== 'stable') {
        throw new Error(
            `${adapter.displayName} adapter is not implemented yet. Planned package: ${adapter.adapterPackage}`
        );
    }

    return adapter;
}
