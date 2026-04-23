import { TriadConfig, TriadLanguage, TriadParserEngine } from './config';
import { TriadTopologyIR } from './ir';

export interface LanguageAdapter {
    language: TriadLanguage;
    displayName: string;
    parserEngine: TriadParserEngine;
    adapterPackage: string;
    status: 'stable' | 'planned';
    readTopologyIR(projectRoot: string): TriadTopologyIR;
    parseTopology(projectRoot: string, outputPath?: string, configOverride?: TriadConfig): void;
    applyUpgradeProtocol(projectRoot: string, protocolPath?: string): { changedFiles: string[] };
    supportsRuntimeHealing: boolean;
}

export type TriadLanguageAdapter = LanguageAdapter;
