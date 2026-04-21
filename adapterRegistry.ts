import { loadTriadConfig, TriadLanguage } from './config';
import { createTypeScriptAdapter } from './typescriptAdapter';
import { LanguageAdapter } from './languageAdapter';
import { WorkspacePaths, getWorkspacePaths } from './workspace';

const adapterRegistry = new Map<TriadLanguage, LanguageAdapter>();

const plannedAdapters: LanguageAdapter[] = [
    createPlannedAdapter('python', 'Python', '@triadmind/plugin-python'),
    createPlannedAdapter('go', 'Go', '@triadmind/plugin-go'),
    createPlannedAdapter('rust', 'Rust', '@triadmind/plugin-rust')
];

registerAdapter(createTypeScriptAdapter());
plannedAdapters.forEach((adapter) => registerAdapter(adapter));

/**
 * TriadMind 自动生成骨架
 * 职责：执行 registerAdapter 流程
 */
export function registerAdapter(adapter: LanguageAdapter): void {
    const existing = adapterRegistry.get(adapter.language);

    if (existing?.status === 'stable' && adapter.status !== 'stable') {
        throw new Error(`Cannot replace stable ${adapter.language} adapter with non-stable implementation`);
    }

    adapterRegistry.set(adapter.language, adapter);
}

/**
 * TriadMind 自动生成骨架
 * 职责：执行 resolveAdapter 流程
 */
export function resolveAdapter(pathsOrProjectRoot: WorkspacePaths | string): LanguageAdapter {
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

/**
 * TriadMind 自动生成骨架
 * 职责：执行 getAvailableAdapters 流程
 */
export function getAvailableAdapters(): LanguageAdapter[] {
    return Array.from(adapterRegistry.values());
}

function createPlannedAdapter(language: TriadLanguage, displayName: string, adapterPackage: string): LanguageAdapter {
    const fail = () => {
        throw new Error(`${displayName} adapter is planned but not implemented yet`);
    };

    return {
        language,
        displayName,
        parserEngine: 'tree-sitter',
        adapterPackage,
        status: 'planned',
        readTopologyIR: fail,
        parseTopology: fail,
        applyUpgradeProtocol: fail,
        supportsRuntimeHealing: true
    };
}
