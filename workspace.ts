import * as path from 'path';

export interface WorkspacePaths {
    projectRoot: string;
    triadDir: string;
    agentsFile: string;
    skillsFile: string;
    cacheDir: string;
    syncCacheFile: string;
    snapshotDir: string;
    snapshotIndexFile: string;
    agentRulesFile: string;
    selfBootstrapFile: string;
    selfBootstrapProtocolFile: string;
    cursorRulesDir: string;
    cursorRuleFile: string;
    configFile: string;
    mapFile: string;
    leafMapFile: string;
    runtimeMapFile: string;
    runtimeVisualizerFile: string;
    runtimeDiagnosticsFile: string;
    sessionBootstrapShellFile: string;
    sessionBootstrapPs1File: string;
    sessionBootstrapCmdFile: string;
    bootstrapVerifyFile: string;
    governPolicyFile: string;
    governReportFile: string;
    governAuditFile: string;
    governFixesFile: string;
    viewMapFile: string;
    viewMapDiagnosticsFile: string;
    verifyBaselineFile: string;
    trendFile: string;
    trendReportFile: string;
    draftFile: string;
    macroSplitFile: string;
    mesoSplitFile: string;
    microSplitFile: string;
    approvedProtocolFile: string;
    visualizerFile: string;
    triadSpecFile: string;
    promptFile: string;
    protocolTaskFile: string;
    macroPromptFile: string;
    mesoPromptFile: string;
    microPromptFile: string;
    pipelinePromptFile: string;
    implementationPromptFile: string;
    handoffPromptFile: string;
    masterPromptFile: string;
    runtimeErrorFile: string;
    healingReportFile: string;
    healingPromptFile: string;
    renormalizeProtocolFile: string;
    renormalizeReportFile: string;
    renormalizeTaskFile: string;
    renormalizePreviewProtocolFile: string;
    renormalizeVisualizerFile: string;
    convergeTaskFile: string;
    lastApplyFilesFile: string;
    demandFile: string;
}

export interface ImplementationHandoffInput {
    userDemand: string;
    approvedProtocolJson: string;
    triadMapJson: string;
    changedFiles: Array<{
        path: string;
        content: string;
    }>;
}

export function getWorkspacePaths(projectRoot: string): WorkspacePaths {
    const triadDir = path.join(projectRoot, '.triadmind');

    return {
        projectRoot,
        triadDir,
        agentsFile: path.join(projectRoot, 'AGENTS.md'),
        skillsFile: path.join(projectRoot, 'skills.md'),
        cacheDir: path.join(triadDir, 'cache'),
        syncCacheFile: path.join(triadDir, 'cache', 'sync-manifest.json'),
        snapshotDir: path.join(triadDir, 'snapshots'),
        snapshotIndexFile: path.join(triadDir, 'snapshots', 'index.json'),
        agentRulesFile: path.join(triadDir, 'agent-rules.md'),
        selfBootstrapFile: path.join(triadDir, 'self-bootstrap.md'),
        selfBootstrapProtocolFile: path.join(triadDir, 'self-bootstrap-protocol.json'),
        cursorRulesDir: path.join(projectRoot, '.cursor', 'rules'),
        cursorRuleFile: path.join(projectRoot, '.cursor', 'rules', 'triadmind.mdc'),
        configFile: path.join(triadDir, 'config.json'),
        mapFile: path.join(triadDir, 'triad-map.json'),
        leafMapFile: path.join(triadDir, 'leaf-map.json'),
        runtimeMapFile: path.join(triadDir, 'runtime-map.json'),
        runtimeVisualizerFile: path.join(triadDir, 'runtime-visualizer.html'),
        runtimeDiagnosticsFile: path.join(triadDir, 'runtime-diagnostics.json'),
        sessionBootstrapShellFile: path.join(triadDir, 'session-bootstrap.sh'),
        sessionBootstrapPs1File: path.join(triadDir, 'session-bootstrap.ps1'),
        sessionBootstrapCmdFile: path.join(triadDir, 'session-bootstrap.cmd'),
        bootstrapVerifyFile: path.join(triadDir, 'bootstrap-verify.json'),
        governPolicyFile: path.join(triadDir, 'govern-policy.json'),
        governReportFile: path.join(triadDir, 'govern-report.json'),
        governAuditFile: path.join(triadDir, 'govern-audit.log'),
        governFixesFile: path.join(triadDir, 'govern-fixes.patch'),
        viewMapFile: path.join(triadDir, 'view-map.json'),
        viewMapDiagnosticsFile: path.join(triadDir, 'view-map-diagnostics.json'),
        verifyBaselineFile: path.join(triadDir, 'verify-baseline.json'),
        trendFile: path.join(triadDir, 'trend.json'),
        trendReportFile: path.join(triadDir, 'trend-report.md'),
        draftFile: path.join(triadDir, 'draft-protocol.json'),
        macroSplitFile: path.join(triadDir, 'macro-split.json'),
        mesoSplitFile: path.join(triadDir, 'meso-split.json'),
        microSplitFile: path.join(triadDir, 'micro-split.json'),
        approvedProtocolFile: path.join(triadDir, 'last-approved-protocol.json'),
        visualizerFile: path.join(triadDir, 'visualizer.html'),
        triadSpecFile: path.join(triadDir, 'triad.md'),
        promptFile: path.join(triadDir, 'upgrade-prompt.md'),
        protocolTaskFile: path.join(triadDir, 'protocol-task.md'),
        macroPromptFile: path.join(triadDir, 'macro-split.md'),
        mesoPromptFile: path.join(triadDir, 'meso-split.md'),
        microPromptFile: path.join(triadDir, 'micro-split.md'),
        pipelinePromptFile: path.join(triadDir, 'multi-pass-pipeline.md'),
        implementationPromptFile: path.join(triadDir, 'implementation-prompt.md'),
        handoffPromptFile: path.join(triadDir, 'implementation-handoff.md'),
        masterPromptFile: path.join(triadDir, 'master-prompt.md'),
        runtimeErrorFile: path.join(triadDir, 'runtime-error.log'),
        healingReportFile: path.join(triadDir, 'healing-report.json'),
        healingPromptFile: path.join(triadDir, 'healing-prompt.md'),
        renormalizeProtocolFile: path.join(triadDir, 'renormalize-protocol.json'),
        renormalizeReportFile: path.join(triadDir, 'renormalize-report.md'),
        renormalizeTaskFile: path.join(triadDir, 'renormalize-task.md'),
        renormalizePreviewProtocolFile: path.join(triadDir, 'renormalize-preview-protocol.json'),
        renormalizeVisualizerFile: path.join(triadDir, 'renormalize-visualizer.html'),
        convergeTaskFile: path.join(triadDir, 'converge-task.md'),
        lastApplyFilesFile: path.join(triadDir, 'last-apply-files.json'),
        demandFile: path.join(triadDir, 'latest-demand.txt')
    };
}

export function normalizePath(input: string) {
    return input.replace(/\\/g, '/');
}
