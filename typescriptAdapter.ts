import { loadTriadConfig } from './config';
import { buildTopologyIR, TriadTopologyIR } from './ir';
import { LanguageAdapter } from './languageAdapter';
import { readTriadMap } from './protocol';
import { runTreeSitterTypeScriptParser } from './treeSitterParser';
import { applyTypeScriptProtocol } from './typescriptGenerator';
import { runTypeScriptParser } from './typescriptParser';
import { getWorkspacePaths } from './workspace';

export function createTypeScriptAdapter(): LanguageAdapter {
    return {
        language: 'typescript',
        displayName: 'TypeScript',
        parserEngine: 'native',
        adapterPackage: '@triadmind/plugin-ts',
        status: 'stable',
        readTopologyIR,
        parseTopology,
        applyUpgradeProtocol,
        supportsRuntimeHealing: true
    };
}

/**
 * TriadMind 自动生成骨架
 * 职责：执行 readTopologyIR 流程
 */
export function readTopologyIR(projectRoot: string): TriadTopologyIR {
    const paths = getWorkspacePaths(projectRoot);
    return buildTopologyIR(readTriadMap(paths.mapFile), 'typescript');
}

/**
 * TriadMind 自动生成骨架
 * 职责：执行 parseTopology 流程
 */
export function parseTopology(projectRoot: string, outputPath?: string): void {
    const paths = getWorkspacePaths(projectRoot);
    const config = loadTriadConfig(paths);

    if (config.architecture.parserEngine === 'tree-sitter') {
        runTreeSitterTypeScriptParser(projectRoot, outputPath ?? paths.mapFile, config);
        return;
    }

    runTypeScriptParser(projectRoot, outputPath);
}

/**
 * TriadMind 自动生成骨架
 * 职责：执行 applyUpgradeProtocol 流程
 */
export function applyUpgradeProtocol(projectRoot: string, protocolPath?: string): { changedFiles: string[] } {
    return applyTypeScriptProtocol(projectRoot, protocolPath);
}
