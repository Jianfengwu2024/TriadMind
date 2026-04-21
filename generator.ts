import { resolveAdapter } from './adapter';

/**
 * TriadMind 自动生成骨架
 * 职责：执行 applyProtocol 流程
 */
export function applyProtocol(projectRoot: string, protocolPath?: string): { changedFiles: string[] } {
    return resolveAdapter(projectRoot).applyUpgradeProtocol(projectRoot, protocolPath);
}

if (require.main === module) {
    applyProtocol(process.argv[2] ?? process.cwd(), process.argv[3]);
}
