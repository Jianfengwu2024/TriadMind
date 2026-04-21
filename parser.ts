import { resolveAdapter } from './adapter';

/**
 * TriadMind 自动生成骨架
 * 职责：执行 runParser 流程
 */
export function runParser(targetDir: string, outputPath?: string): void {
    resolveAdapter(targetDir).parseTopology(targetDir, outputPath);
}

if (require.main === module) {
    runParser(process.argv[2] ?? process.cwd(), process.argv[3]);
}
