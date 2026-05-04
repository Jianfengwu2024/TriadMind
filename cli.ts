#!/usr/bin/env node
import { Command } from 'commander';
import inquirer from 'inquirer';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import chalk from 'chalk';
import { getAvailableAdapters, resolveAdapter } from './adapter';
import { loadTriadConfig, TriadLanguage, TriadScanMode } from './config';
import { generateDashboard } from './visualizer';
import { assertProtocolShape, readJsonFile, readTriadMap, UpgradeProtocol } from './protocol';
import { prepareHealingArtifacts } from './healing';
import { installAlwaysOnRules } from './rules';
import { collectProtocolSnapshotFiles, createSnapshot, listSnapshots, restoreSnapshot } from './snapshot';
import { syncTriadMap, syncTriadMapWithOptions, watchTriadMap } from './sync';
import { writeSelfBootstrapProtocol, writeSelfBootstrapReport } from './bootstrap';
import {
    BootstrapDoctorReport,
    BootstrapScaffoldInitResult,
    BootstrapScaffoldService
} from './bootstrapScaffoldService';
import { calculateBlastRadius, detectCycles, detectTopologicalDrift, generateRenormalizeProtocol } from './analyzer';
import { LanguageAdapter } from './languageAdapter';
import {
    TriadizationConfirmationSource,
    TriadizationReport,
    hasConfirmedTriadization,
    readTriadizationConfirmation,
    writeTriadizationArtifacts,
    writeTriadizationConfirmation
} from './triadization';
import {
    createDraftTemplate,
    ensureTriadSpec,
    getWorkspacePaths,
    writeMasterPrompt,
    writeImplementationHandoff,
    writePromptPacket
} from './workflow';
import { normalizePath } from './workspace';
import { extractRuntimeTopology } from './runtime/extractRuntimeTopology';
import { normalizeRuntimeView } from './runtime/filterRuntimeMapByView';
import { writeRuntimeMapArtifacts } from './runtime/runtimeMapWriter';
import { generateRuntimeDashboard } from './runtime/runtimeVisualizer';
import { formatGovernReport, runGovern } from './govern';
import { formatCoverageReport, runCoverage } from './coverage';
import { formatVerifyReport, runTopologyVerify } from './verify';
import { generateTrendArtifacts } from './trend';
import { formatDreamReport, loadLatestDreamReport, runDreamAnalysis } from './dream';
import { tickDreamAutoRun } from './dreamScheduler';
import { generateDreamDashboard } from './dreamVisualizer';
import { getDreamDaemonStatus, runDreamDaemonLoop, startDreamDaemon, stopDreamDaemon } from './dreamDaemon';
import { writeViewMapArtifacts } from './viewMap';

const program = new Command();
const BLAST_RADIUS_WARNING_THRESHOLD = 5;
const bootstrapScaffoldService = new BootstrapScaffoldService();

interface ILanguageAdapter {
    applyProtocol(protocol: any, projectRoot: string): void;
}

type CliLanguageAdapter = ILanguageAdapter & {
    language: TriadLanguage;
    displayName: string;
    consumeChangedFiles(): string[];
};

type DashboardView = 'architecture' | 'leaf';

interface DashboardCliOptions {
    view?: string;
    showIsolated?: boolean;
    fullContractEdges?: boolean;
}

interface DreamRunCliOptions {
    mode?: string;
    force?: boolean;
    maxProposals?: string;
    minConfidence?: string;
    visualize?: boolean;
    theme?: string;
    json?: boolean;
}

interface ExecuteApplyOptions {
    source: TriadizationConfirmationSource;
    autoConfirmTriadization?: boolean;
    triadizationReport?: TriadizationReport;
}

program.name('triadmind').description('TriadMind：顶点三元法驱动的项目拓扑规划与骨架生成工具').version('1.2.0');

program
    .command('init')
    .description('初始化目标项目的 `.triadmind` 工作区，并重新生成 `triad-map.json`')
    .option('--skip-bootstrap', 'Skip session bootstrap scaffold generation')
    .action(async (options: { skipBootstrap?: boolean }) => {
        const paths = getWorkspacePaths(process.cwd());
        const previousMap = readCurrentTriadMap(paths);

        console.log(chalk.cyan('🧭 [TriadMind] 正在初始化工作区...'));
        ensureTriadSpec(paths);
        if (!options.skipBootstrap) {
            const bootstrapResult = bootstrapScaffoldService.init(paths, {
                nonInteractive: true,
                triadmindCommand: resolveBootstrapCliCommand(paths)
            });
            reportBootstrapInitResult(paths, bootstrapResult);
        }
        syncProjectTopology(paths, true);
        writeTriadizationArtifacts(paths);
        const runtimeResult = await writeRuntimeTopologyArtifacts(paths, {}, true);
        const viewMapResult = writeViewMapArtifactsBestEffort(paths);
        assertNoTopologicalDegradation(paths, previousMap, 'init');
        installAlwaysOnRules(paths);
        writeMasterPrompt(paths);
        reportRuntimeArtifactStatus(paths, runtimeResult);
        reportViewMapStatus(paths, viewMapResult);
        runAutoDreamAfterCommand(paths, 'init');

        console.log(chalk.green(`✅ triad-map 已同步到 ${paths.mapFile}`));
        console.log(chalk.green(`✅ triad.md 已写入 ${paths.triadSpecFile}`));
        console.log(chalk.green(`✅ master-prompt 已写入 ${paths.masterPromptFile}`));
    });

const bootstrapCommand = program
    .command('bootstrap')
    .description('Session bootstrap scaffolding for AGENTS/skills/bootstrap scripts');

bootstrapCommand
    .command('init')
    .description('Create or update TriadMind session bootstrap files')
    .option('--force', 'Overwrite scaffold files that already exist')
    .option('--non-interactive', 'Run without interactive prompts')
    .action((options: { force?: boolean; nonInteractive?: boolean }) => {
        const paths = getWorkspacePaths(process.cwd());
        ensureTriadSpec(paths);
        const result = bootstrapScaffoldService.init(paths, {
            force: Boolean(options.force),
            nonInteractive: Boolean(options.nonInteractive),
            triadmindCommand: resolveBootstrapCliCommand(paths)
        });
        reportBootstrapInitResult(paths, result);
    });

bootstrapCommand
    .command('doctor')
    .description('Check bootstrap scaffold health and template freshness')
    .option('--json', 'Emit machine-readable JSON report')
    .action((options: { json?: boolean }) => {
        const paths = getWorkspacePaths(process.cwd());
        ensureTriadSpec(paths);
        const report = bootstrapScaffoldService.doctor(paths, {
            triadmindCommand: resolveBootstrapCliCommand(paths)
        });
        if (options.json) {
            console.log(JSON.stringify(report, null, 2));
        } else {
            console.log(formatBootstrapDoctorReport(report));
        }
        if (!report.passed) {
            process.exitCode = 1;
        }
    });

program
    .command('prepare [demand...]')
    .description('生成 `triad.md`、协议提示词与实现提示词，供当前对话中的大模型使用')
    .option('-d, --demand <text>', '显式传入用户需求文本')
    .action((demandParts: string[], options: { demand?: string }) => {
        const demand = resolveDemand(demandParts, options.demand);
        const paths = getWorkspacePaths(process.cwd());

        if (!demand) {
            console.log(chalk.red('❌ 请提供需求文本，例如：triadmind prepare "前端新增导出 CSV 按钮"'));
            process.exitCode = 1;
            return;
        }

        console.log(chalk.cyan('🧠 [TriadMind] 正在封装协议规划提示词...'));
        prepareWorkspace(paths, demand);

        console.log(chalk.green(`✅ 升级提示词已写入 ${paths.promptFile}`));
        console.log(chalk.green(`✅ 协议子任务提示词已写入 ${paths.protocolTaskFile}`));
        console.log(chalk.green(`✅ 多轮拆分总提示词已写入 ${paths.pipelinePromptFile}`));
        console.log(chalk.green(`✅ 实现总提示词已写入 ${paths.implementationPromptFile}`));
        console.log(chalk.green(`✅ 最新需求已写入 ${paths.demandFile}`));
        console.log(chalk.yellow(`➡️ 请将 AI 返回的严格 JSON 保存到 ${paths.draftFile}`));
    });

program
    .command('prompt [demand...]')
    .description('别名：同 `prepare`')
    .option('-d, --demand <text>', '显式传入用户需求文本')
    .action((demandParts: string[], options: { demand?: string }) => {
        const demand = resolveDemand(demandParts, options.demand);
        const paths = getWorkspacePaths(process.cwd());

        if (!demand) {
            console.log(chalk.red('❌ 请提供需求文本，例如：triadmind prompt "前端新增导出 CSV 按钮"'));
            process.exitCode = 1;
            return;
        }

        prepareWorkspace(paths, demand);
        console.log(chalk.green(`✅ 提示词已写入 ${paths.promptFile}`));
    });

program
    .command('protocol [demand...]')
    .description('生成最终 `draft-protocol.json` 的协议提示词')
    .option('-d, --demand <text>', '显式传入用户需求文本')
    .action((demandParts: string[], options: { demand?: string }) => {
        const paths = getWorkspacePaths(process.cwd());
        const demand = resolveDemand(demandParts, options.demand, paths);

        if (!demand) {
            console.log(chalk.red('❌ 请提供需求文本，或先执行一次 prepare / pipeline 保存 `latest-demand.txt`'));
            process.exitCode = 1;
            return;
        }

        console.log(chalk.cyan('📜 [TriadMind] 正在生成协议提示词...'));
        prepareWorkspace(paths, demand);
        console.log(chalk.green(`✅ 协议子任务提示词已写入 ${paths.protocolTaskFile}`));
        console.log(chalk.green(`✅ 协议规划提示词已写入 ${paths.promptFile}`));
        console.log(chalk.yellow(`➡️ 将 ${paths.protocolTaskFile} 发给当前对话中的大模型，生成最终 draft-protocol.json`));
        console.log(chalk.yellow(`➡️ 然后把返回的 JSON 保存到 ${paths.draftFile}`));
    });

program
    .command('pipeline [demand...]')
    .description('生成 Macro / Meso / Micro 多轮拆分工作流文件')
    .option('-d, --demand <text>', '显式传入用户需求文本')
    .action((demandParts: string[], options: { demand?: string }) => {
        const paths = getWorkspacePaths(process.cwd());
        const demand = resolveDemand(demandParts, options.demand, paths);

        if (!demand) {
            console.log(chalk.red('❌ 请提供需求文本，或先执行一次 prepare 保存 `latest-demand.txt`'));
            process.exitCode = 1;
            return;
        }

        console.log(chalk.cyan('🔁 [TriadMind] 正在生成多轮推演流水线...'));
        prepareWorkspace(paths, demand);

        console.log(chalk.green(`✅ Macro 提示词：${paths.macroPromptFile}`));
        console.log(chalk.green(`✅ Meso 提示词：${paths.mesoPromptFile}`));
        console.log(chalk.green(`✅ Micro 提示词：${paths.microPromptFile}`));
        console.log(chalk.green(`✅ 流水线总提示词：${paths.pipelinePromptFile}`));
        console.log(chalk.green(`✅ Macro 中间态：${paths.macroSplitFile}`));
        console.log(chalk.green(`✅ Meso 中间态：${paths.mesoSplitFile}`));
        console.log(chalk.green(`✅ Micro 中间态：${paths.microSplitFile}`));
        console.log(chalk.yellow('➡️ 推荐顺序：Macro → Meso → Micro → draft-protocol.json'));
        console.log(chalk.yellow(`➡️ 单文件入口仍然是 ${paths.masterPromptFile}`));
    });

program
    .command('macro [demand...]')
    .description('生成并展示 Macro-Split 提示词')
    .option('-d, --demand <text>', '显式传入用户需求文本')
    .action((demandParts: string[], options: { demand?: string }) => {
        printPassPrompt('macro', demandParts, options.demand);
    });

program
    .command('meso [demand...]')
    .description('生成并展示 Meso-Split 提示词')
    .option('-d, --demand <text>', '显式传入用户需求文本')
    .action((demandParts: string[], options: { demand?: string }) => {
        printPassPrompt('meso', demandParts, options.demand);
    });

program
    .command('micro [demand...]')
    .description('生成并展示 Micro-Split 提示词')
    .option('-d, --demand <text>', '显式传入用户需求文本')
    .action((demandParts: string[], options: { demand?: string }) => {
        printPassPrompt('micro', demandParts, options.demand);
    });

program
    .command('sync')
    .description('Incrementally synchronize triad-map using cached file hashes')
    .option('--force', 'Force a full triad-map rebuild')
    .option('--scan-mode <leaf|capability|module|domain>', 'Temporarily override parser scan mode for this sync')
    .action(async (options: { force?: boolean; scanMode?: string }) => {
        const paths = getWorkspacePaths(process.cwd());
        ensureTriadSpec(paths);
        syncProjectTopology(paths, Boolean(options.force), normalizeScanModeOption(options.scanMode));
        writeTriadizationArtifacts(paths);
        const runtimeResult = await writeRuntimeTopologyArtifacts(paths, {}, true);
        const viewMapResult = writeViewMapArtifactsBestEffort(paths);
        reportRuntimeArtifactStatus(paths, runtimeResult);
        reportViewMapStatus(paths, viewMapResult);
        runAutoDreamAfterCommand(paths, 'sync');
        console.log(chalk.green(`✅ Runtime map written: ${paths.runtimeMapFile}`));
        console.log(chalk.green(`✅ Runtime diagnostics written: ${paths.runtimeDiagnosticsFile}`));
    });

program
    .command('watch')
    .description('Watch source files and keep triad-map synchronized')
    .action(async () => {
        const paths = getWorkspacePaths(process.cwd());
        ensureTriadSpec(paths);
        watchTriadMap(paths);
    });

program
    .command('runtime')
    .description('Extract runtime topology: frontend/API/service/workflow/worker/resource graph')
    .option('--visualize', 'Generate runtime-visualizer.html after extraction')
    .option('--view <workflow|request-flow|resources|events|infra|full>', 'Runtime topology view', 'full')
    .option('--include-frontend', 'Enable frontend API call extraction')
    .option('--include-infra', 'Enable docker/env/deployment extraction')
    .option('--framework <name>', 'Hint framework extractor, e.g. fastapi, express, celery')
    .option('--interactive', 'Generate interactive runtime topology visualizer', true)
    .option('--layout <leaf-force|dagre>', 'Runtime visualizer layout (legacy "force" maps to leaf-force)', 'leaf-force')
    .option('--trace-depth <n>', 'Default runtime trace depth', '2')
    .option('--max-render-edges <n>', 'Optional runtime visualizer edge cap (default: no cap)')
    .option('--hide-isolated', 'Hide isolated runtime nodes in the visualizer')
    .option('--theme <leaf-like|runtime-dark>', 'Runtime visualizer theme', 'leaf-like')
    .action(async (options: {
        visualize?: boolean;
        view?: string;
        includeFrontend?: boolean;
        includeInfra?: boolean;
        framework?: string;
        interactive?: boolean;
        layout?: string;
        traceDepth?: string;
        maxRenderEdges?: string;
        hideIsolated?: boolean;
        theme?: string;
    }) => {
        const paths = getWorkspacePaths(process.cwd());
        ensureTriadSpec(paths);

        const config = loadTriadConfig(paths);
        if (!config.runtime.enabled) {
            console.log(chalk.red('❌ Runtime topology extraction is disabled in `.triadmind/config.json`.'));
            process.exitCode = 1;
            return;
        }

        await writeRuntimeTopologyArtifacts(paths, {
            view: normalizeRuntimeView(options.view, config.runtime.defaultView),
            includeFrontend: options.includeFrontend ?? config.runtime.includeFrontend,
            includeInfra: options.includeInfra ?? config.runtime.includeInfra,
            frameworkHint: options.framework
        });
        const viewMapResult = writeViewMapArtifactsBestEffort(paths);

        console.log(chalk.green(`✅ Runtime map written: ${paths.runtimeMapFile}`));
        console.log(chalk.green(`✅ Runtime diagnostics written: ${paths.runtimeDiagnosticsFile}`));
        reportViewMapStatus(paths, viewMapResult);
        runAutoDreamAfterCommand(paths, 'runtime');

        if (options.visualize) {
            generateRuntimeDashboard(paths.runtimeMapFile, paths.runtimeVisualizerFile, {
                interactive: options.interactive !== false,
                layout: options.layout === 'dagre' ? 'dagre' : 'leaf-force',
                traceDepth: normalizePositiveCliInteger(options.traceDepth, 2),
                maxRenderEdges: parseOptionalPositiveCliInteger(options.maxRenderEdges),
                hideIsolated: Boolean(options.hideIsolated),
                theme: options.theme === 'runtime-dark' ? 'runtime-dark' : 'leaf-like'
            });
            console.log(chalk.green(`✅ Runtime visualizer written: ${paths.runtimeVisualizerFile}`));
        }
    });

program
    .command('coverage')
    .description('Measure triad/runtime/combined topology coverage by category root')
    .option('--json', 'Emit machine-readable coverage JSON report')
    .action((options: { json?: boolean }) => {
        const paths = getWorkspacePaths(process.cwd());
        ensureTriadSpec(paths);
        const report = runCoverage(paths);

        if (options.json) {
            console.log(JSON.stringify(report, null, 2));
        } else {
            console.log(formatCoverageReport(report));
            console.log(chalk.gray(`[TriadMind] coverage report written: ${paths.coverageReportFile}`));
        }
    });

program
    .command('verify')
    .description(
        'Verify topology quality gates (diagnostics, execute-like ratio, ghost ratio, runtime rendering consistency)'
    )
    .option('--json', 'Emit machine-readable JSON report')
    .option('--strict', 'Exit with code 1 when any configured check fails')
    .option(
        '--baseline <path>',
        'Baseline file for runtime unmatched route threshold (default: .triadmind/verify-baseline.json)'
    )
    .option('--update-baseline', 'Write current runtime_unmatched_route_count into baseline file')
    .option('--max-execute-like-ratio <n>', 'Threshold for execute-like capability ratio (default: 0.10)')
    .option('--max-ghost-ratio <n>', 'Threshold for ghost demand node ratio (default: 0.40)')
    .option('--max-unmatched-routes <n>', 'Threshold for runtime unmatched frontend routes (default: baseline + 10%)')
    .option('--max-render-edges <n>', 'Optional edge cap used only for rendered edge consistency check')
    .action(
        (options: {
            json?: boolean;
            strict?: boolean;
            baseline?: string;
            updateBaseline?: boolean;
            maxExecuteLikeRatio?: string;
            maxGhostRatio?: string;
            maxUnmatchedRoutes?: string;
            maxRenderEdges?: string;
        }) => {
            const paths = getWorkspacePaths(process.cwd());
            ensureTriadSpec(paths);
            const report = runTopologyVerify(paths, {
                strict: Boolean(options.strict),
                baselinePath: options.baseline,
                updateBaseline: Boolean(options.updateBaseline),
                maxExecuteLikeRatio: parseOptionalRatioCliNumber(options.maxExecuteLikeRatio),
                maxGhostRatio: parseOptionalRatioCliNumber(options.maxGhostRatio),
                maxUnmatchedRouteCount: parseOptionalNonNegativeCliInteger(options.maxUnmatchedRoutes),
                maxRenderEdges: parseOptionalPositiveCliInteger(options.maxRenderEdges)
            });

            if (options.json) {
                console.log(JSON.stringify(report, null, 2));
            } else {
                console.log(formatVerifyReport(report));
                if (report.baseline) {
                    console.log(chalk.gray(`[TriadMind] verify baseline: ${report.baseline.path}`));
                }
            }
            runAutoDreamAfterCommand(paths, 'verify');

            if (options.strict && !report.passed) {
                process.exitCode = 1;
            }
        }
    );

const governCommand = program
    .command('govern')
    .description('Hard-gate governance workflow (fail-closed checks, CI gates, fix planning)');

governCommand
    .command('check')
    .description('Run hard governance checks using policy rules and emit govern artifacts')
    .option('--policy <path>', 'Govern policy file path (default: .triadmind/govern-policy.json)')
    .option('--json', 'Emit machine-readable govern report JSON')
    .action((options: { policy?: string; json?: boolean }) => {
        const paths = getWorkspacePaths(process.cwd());
        ensureTriadSpec(paths);
        const result = runGovern(paths, {
            mode: 'check',
            policyPath: options.policy
        });

        if (options.json) {
            console.log(JSON.stringify(result.report, null, 2));
        } else {
            console.log(formatGovernReport(result.report));
        }
        runAutoDreamAfterCommand(paths, 'govern');

        if (result.exitCode !== 0) {
            process.exitCode = result.exitCode;
        }
    });

governCommand
    .command('ci')
    .description('CI fail-fast gate: run hard governance checks without interactive flow')
    .option('--policy <path>', 'Govern policy file path (default: .triadmind/govern-policy.json)')
    .option('--json', 'Emit machine-readable govern report JSON')
    .action((options: { policy?: string; json?: boolean }) => {
        const paths = getWorkspacePaths(process.cwd());
        ensureTriadSpec(paths);
        const result = runGovern(paths, {
            mode: 'ci',
            policyPath: options.policy
        });

        if (options.json) {
            console.log(JSON.stringify(result.report, null, 2));
        } else {
            console.log(formatGovernReport(result.report));
        }
        runAutoDreamAfterCommand(paths, 'govern');

        if (result.exitCode !== 0) {
            process.exitCode = result.exitCode;
        }
    });

governCommand
    .command('fix')
    .description('Generate govern fix patch plan under hard policy constraints')
    .option('--policy <path>', 'Govern policy file path (default: .triadmind/govern-policy.json)')
    .option('--llm <provider:model>', 'LLM backend descriptor for fix planning')
    .option('--max-iterations <n>', 'Max fix iterations for future auto-fix backends', '3')
    .option('--dry-run', 'Only emit govern-fixes.patch without applying any fix')
    .option('--json', 'Emit machine-readable govern report JSON')
    .action(
        (options: { policy?: string; llm?: string; maxIterations?: string; dryRun?: boolean; json?: boolean }) => {
            const paths = getWorkspacePaths(process.cwd());
            ensureTriadSpec(paths);
            const result = runGovern(paths, {
                mode: 'fix',
                policyPath: options.policy,
                llm: options.llm,
                maxIterations: normalizePositiveCliInteger(options.maxIterations, 3),
                dryRun: Boolean(options.dryRun)
            });

            if (options.json) {
                console.log(JSON.stringify(result.report, null, 2));
            } else {
                console.log(formatGovernReport(result.report));
            }
            runAutoDreamAfterCommand(paths, 'govern');

            if (result.exitCode !== 0) {
                process.exitCode = result.exitCode;
            }
        }
    );

program
    .command('trend')
    .description('Generate architecture drift trend artifacts (trend.json + trend-report.md)')
    .option('--window <n>', 'Maximum snapshots kept in trend history', '26')
    .option('--max-edge-diff <n>', 'Max added/removed edge rows kept in report', '50')
    .option('--json', 'Emit machine-readable trend report JSON')
    .action((options: { window?: string; maxEdgeDiff?: string; json?: boolean }) => {
        const paths = getWorkspacePaths(process.cwd());
        ensureTriadSpec(paths);
        const result = generateTrendArtifacts(paths, {
            historyWindow: normalizePositiveCliInteger(options.window, 26),
            maxEdgeDiff: normalizePositiveCliInteger(options.maxEdgeDiff, 50)
        });
        runAutoDreamAfterCommand(paths, 'trend');

        if (options.json) {
            console.log(
                JSON.stringify(
                    {
                        trendFile: paths.trendFile,
                        trendReportFile: paths.trendReportFile,
                        report: result.report
                    },
                    null,
                    2
                )
            );
            return;
        }

        console.log(chalk.green(`✅ Trend history written: ${paths.trendFile}`));
        console.log(chalk.green(`✅ Trend report written: ${paths.trendReportFile}`));
        result.report.summary.forEach((entry) => console.log(chalk.gray(`   - ${entry}`)));
    });

const dreamCommand = program
    .command('dream')
    .description('Run idle-style architecture dreaming and governance proposal generation')
    .addHelpText(
        'after',
        '\nDefault behavior: `triadmind dream` is equivalent to `triadmind dream run`.\nYou can pass run flags directly, e.g. `triadmind dream --json`.'
    );

dreamCommand
    .command('run')
    .description('Analyze topology drift and emit dream proposals/artifacts')
    .option('--mode <manual|idle>', 'Dream run mode', 'manual')
    .option('--force', 'Ignore idle gate or dream.enabled=false and run immediately')
    .option('--max-proposals <n>', 'Maximum number of dream proposals to keep')
    .option('--min-confidence <n>', 'Minimum confidence threshold for retained proposals (0-1)')
    .option('--visualize', 'Generate dream-visualizer.html after dream run')
    .option('--theme <leaf-like|runtime-dark>', 'Dream visualizer theme', 'leaf-like')
    .option('--json', 'Emit machine-readable dream report JSON')
    .action(async (options: DreamRunCliOptions) => {
        await executeDreamRun(options);
    });

dreamCommand
    .command('auto')
    .description('Record one activity tick and execute auto-dream when gates pass')
    .option('--trigger <name>', 'Auto trigger source label', 'manual')
    .option('--force', 'Bypass gate checks and force auto-dream execution')
    .option('--json', 'Emit machine-readable auto tick result JSON')
    .action(async (options: { trigger?: string; force?: boolean; json?: boolean }) => {
        const paths = getWorkspacePaths(process.cwd());
        ensureTriadSpec(paths);

        const result = await tickDreamAutoRun(paths, {
            trigger: String(options.trigger ?? 'manual'),
            force: Boolean(options.force)
        });

        if (options.json) {
            console.log(JSON.stringify(result, null, 2));
            return;
        }

        const color =
            result.status === 'run' ? chalk.green : result.status === 'error' ? chalk.red : chalk.gray;
        console.log(
            color(
                `[TriadMind] dream auto ${result.status}: trigger=${result.trigger}, reason=${result.reason}, pending=${result.pendingEvents}, lock=${result.lock}`
            )
        );
        if (result.error) {
            console.log(chalk.yellow(`[TriadMind] dream auto error: ${result.error}`));
        }
    });

dreamCommand
    .command('review')
    .description('Read the latest dream report from workspace artifacts')
    .option('--json', 'Emit machine-readable dream report JSON')
    .action((options: { json?: boolean }) => {
        const paths = getWorkspacePaths(process.cwd());
        ensureTriadSpec(paths);

        const report = loadLatestDreamReport(paths);
        if (!report) {
            console.log(chalk.red(`❌ No dream report found: ${paths.dreamReportFile}`));
            process.exitCode = 1;
            return;
        }

        if (options.json) {
            console.log(JSON.stringify(report, null, 2));
            return;
        }

        console.log(formatDreamReport(report));
    });

dreamCommand
    .command('visualize')
    .description('Generate dream governance dashboard html from latest dream report')
    .option('--theme <leaf-like|runtime-dark>', 'Dream visualizer theme', 'leaf-like')
    .option('--open', 'Open generated html in browser')
    .option('--json', 'Emit machine-readable result')
    .action(async (options: { theme?: string; open?: boolean; json?: boolean }) => {
        const paths = getWorkspacePaths(process.cwd());
        ensureTriadSpec(paths);

        const report = loadLatestDreamReport(paths);
        if (!report) {
            console.log(chalk.red(`❌ No dream report found: ${paths.dreamReportFile}`));
            process.exitCode = 1;
            return;
        }

        generateDreamDashboard(report, paths.dreamVisualizerFile, {
            theme: options.theme === 'runtime-dark' ? 'runtime-dark' : 'leaf-like'
        });

        if (options.open) {
            try {
                await openFile(paths.dreamVisualizerFile);
            } catch (error: any) {
                console.log(chalk.yellow(`ℹ️ Failed to open dream visualizer: ${error?.message ?? String(error)}`));
            }
        }

        if (options.json) {
            console.log(
                JSON.stringify(
                    {
                        dreamReportFile: paths.dreamReportFile,
                        dreamVisualizerFile: paths.dreamVisualizerFile
                    },
                    null,
                    2
                )
            );
            return;
        }

        console.log(chalk.green(`✅ Dream visualizer written: ${paths.dreamVisualizerFile}`));
    });

const dreamDaemonCommand = dreamCommand
    .command('daemon')
    .description('Dream daemon lifecycle: background idle run loop');

dreamDaemonCommand
    .command('start')
    .description('Start dream daemon in background')
    .option('--interval-seconds <n>', 'Daemon loop interval in seconds')
    .option('--max-ticks <n>', 'Max daemon ticks before auto-exit (0 = infinite)')
    .option('--json', 'Emit machine-readable daemon start result')
    .action((options: { intervalSeconds?: string; maxTicks?: string; json?: boolean }) => {
        const paths = getWorkspacePaths(process.cwd());
        ensureTriadSpec(paths);

        const result = startDreamDaemon(paths, {
            intervalSeconds: parseOptionalPositiveCliInteger(options.intervalSeconds),
            maxTicks: parseOptionalNonNegativeCliInteger(options.maxTicks)
        });

        if (options.json) {
            console.log(JSON.stringify(result, null, 2));
            return;
        }

        const color =
            result.status === 'started'
                ? chalk.green
                : result.status === 'already_running'
                  ? chalk.yellow
                  : chalk.red;
        console.log(color(`[TriadMind] ${result.message}`));
    });

dreamDaemonCommand
    .command('stop')
    .description('Stop dream daemon')
    .option('--json', 'Emit machine-readable daemon stop result')
    .action((options: { json?: boolean }) => {
        const paths = getWorkspacePaths(process.cwd());
        ensureTriadSpec(paths);

        const result = stopDreamDaemon(paths);
        if (options.json) {
            console.log(JSON.stringify(result, null, 2));
            return;
        }

        const color =
            result.status === 'stopped'
                ? chalk.green
                : result.status === 'not_running'
                  ? chalk.gray
                  : chalk.red;
        console.log(color(`[TriadMind] ${result.message}`));
    });

dreamDaemonCommand
    .command('status')
    .description('Show dream daemon status')
    .option('--json', 'Emit machine-readable daemon status')
    .action((options: { json?: boolean }) => {
        const paths = getWorkspacePaths(process.cwd());
        ensureTriadSpec(paths);

        const status = getDreamDaemonStatus(paths);
        if (options.json) {
            console.log(
                JSON.stringify(
                    {
                        running: status.running,
                        pid: status.pid,
                        state: status.state
                    },
                    null,
                    2
                )
            );
            return;
        }

        const color = status.running ? chalk.green : chalk.gray;
        console.log(
            color(
                `[TriadMind] dream daemon running=${status.running} pid=${status.pid ?? '-'} ticks=${status.state.ticks} last=${status.state.lastStatus ?? '-'}`
            )
        );
    });

dreamCommand
    .command('daemon-loop')
    .description('Internal dream daemon loop command (do not invoke directly)')
    .option('--interval-seconds <n>', 'Daemon loop interval in seconds', '180')
    .option('--max-ticks <n>', 'Max daemon ticks before auto-exit (0=infinite)', '0')
    .action(async (options: { intervalSeconds?: string; maxTicks?: string }) => {
        const paths = getWorkspacePaths(process.cwd());
        ensureTriadSpec(paths);

        await runDreamDaemonLoop(paths, {
            intervalSeconds: normalizePositiveCliInteger(options.intervalSeconds, 180),
            maxTicks: parseOptionalNonNegativeCliInteger(options.maxTicks) ?? 0
        });
    });

program
    .command('view-map')
    .description('Generate cross-view mapping artifacts (runtime ↔ capability ↔ leaf)')
    .option('--max-candidates <n>', 'Max capability candidates retained per runtime node', '3')
    .option('--json', 'Emit machine-readable view-map JSON payload')
    .action((options: { maxCandidates?: string; json?: boolean }) => {
        const paths = getWorkspacePaths(process.cwd());
        ensureTriadSpec(paths);
        const viewMap = writeViewMapArtifacts(paths, {
            maxCandidatesPerRuntimeNode: normalizePositiveCliInteger(options.maxCandidates, 3)
        });
        reportViewMapStatus(paths, {
            recovered: false,
            viewMap
        });
        if (options.json) {
            console.log(JSON.stringify(viewMap, null, 2));
        }
    });

program
    .command('renormalize')
    .description('Detect cyclic dependencies and emit a language-agnostic renormalization protocol')
    .option('--deep', 'Reserve recursive fanout convergence and emit a TODO governance task')
    .action((options: { deep?: boolean }) => {
        if (options.deep) {
            executeConvergePlaceholder(getWorkspacePaths(process.cwd()));
            return;
        }

        const paths = getWorkspacePaths(process.cwd());
        const config = loadTriadConfig(paths);
        const renormalizeProtocolFile = path.join(paths.triadDir, 'renormalize-protocol.json');
        const analyzerOptions = {
            ignoreGenericContracts: config.parser.ignoreGenericContracts,
            genericContractIgnoreList: config.parser.genericContractIgnoreList
        };

        ensureTriadSpec(paths);
        if (!fs.existsSync(paths.mapFile)) {
            syncProjectTopology(paths, true);
        }

        const map = readCurrentTriadMap(paths);
        const cycles = detectCycles(map, analyzerOptions);

        if (cycles.length === 0) {
            console.log(chalk.green('✅ No cyclic dependencies found; renormalization is not required.'));
            if (fs.existsSync(renormalizeProtocolFile)) {
                fs.unlinkSync(renormalizeProtocolFile);
            }
            return;
        }

        const protocol = generateRenormalizeProtocol(map, cycles, analyzerOptions);
        fs.writeFileSync(renormalizeProtocolFile, JSON.stringify(protocol, null, 2), 'utf-8');

        console.log(chalk.yellow(`⚠️ Detected ${cycles.length} cyclic component(s).`));
        cycles.forEach((cycle, index) => {
            console.log(chalk.yellow(`   ${index + 1}. ${cycle.join(' -> ')}`));
        });
        console.log(chalk.green(`✅ Renormalization protocol written: ${renormalizeProtocolFile}`));
    });

program
    .command('converge')
    .description('Reserve iterative recursive renormalization for high-fanout nodes and emit a TODO governance task')
    .action(async () => {
        executeConvergePlaceholder(getWorkspacePaths(process.cwd()));
    });

program
    .command('triadize')
    .description('Analyze current topology and emit triadization diagnosis / task artifacts')
    .option('--json', 'Emit machine-readable triadization report JSON')
    .option('--confirm', 'Record the current primary triadization proposal as confirmed')
    .action(async (options: { json?: boolean; confirm?: boolean }) => {
        const paths = getWorkspacePaths(process.cwd());
        ensureTriadSpec(paths);

        if (!fs.existsSync(paths.mapFile)) {
            syncProjectTopology(paths);
        }

        const report = writeTriadizationArtifacts(paths);
        reportTriadizationStatus(paths, report);

        if (options.confirm) {
            const confirmed = await ensureTriadizationConfirmation(paths, report, 'triadize', false);
            if (!confirmed) {
                console.log(chalk.red('🛑 已取消三元化确认，未记录 confirmation。'));
                process.exitCode = 1;
                return;
            }
        }

        if (options.json) {
            console.log(JSON.stringify(report, null, 2));
        }
    });

program
    .command('plan')
    .description('读取 `draft-protocol.json`，生成 `visualizer.html`，并在确认后落地骨架代码')
    .option('--apply', '跳过交互确认，直接执行 apply')
    .option('--no-open', '仅生成 `visualizer.html`，不自动打开浏览器')
    .option('--view <architecture|leaf>', 'Set initial visualizer view')
    .option('--show-isolated', 'Show isolated capability nodes in architecture view')
    .option('--full-contract-edges', 'Disable visualizer contract-edge capping')
    .action(async (options: { apply?: boolean; open?: boolean } & DashboardCliOptions) => {
        const paths = getWorkspacePaths(process.cwd());

        console.log(chalk.cyan('🗺️ [TriadMind] 正在准备拓扑升级演化视图...'));

        ensureTriadSpec(paths);

        if (!fs.existsSync(paths.mapFile)) {
            console.log(chalk.yellow('ℹ️ `triad-map.json` 不存在，先执行一次自动扫描。'));
            syncProjectTopology(paths);
        }

        const triadizationReport = writeTriadizationArtifacts(paths);
        reportTriadizationStatus(paths, triadizationReport);

        if (!fs.existsSync(paths.draftFile)) {
            createDraftTemplate(paths);
            console.log(chalk.yellow(`📝 未找到 draft-protocol.json，已生成模板：${paths.draftFile}`));
            console.log(chalk.yellow(`➡️ 请先参考 ${paths.triadizationReportFile} / ${paths.triadizationTaskFile}，与 AI 助手确认本轮三元化焦点后再生成协议。`));
            console.log(chalk.yellow(`➡️ 请先用 ${paths.promptFile} 让 AI 生成协议，然后重试。`));
            return;
        }

        let protocol: UpgradeProtocol;
        try {
            protocol = validateDraftProtocol(paths);
        } catch (error: any) {
            console.log(chalk.red(`Draft protocol validation failed: ${error.message}`));
            process.exitCode = 1;
            return;
        }

        warnBlastRadiusIfNeeded(paths, protocol);

        generateDashboard(paths.mapFile, paths.draftFile, paths.visualizerFile, toDashboardOptions(options));
        console.log(chalk.green(`✅ 演化视图已生成：${paths.visualizerFile}`));
        runAutoDreamAfterCommand(paths, 'plan');

        if (options.open !== false) {
            try {
                await openFile(paths.visualizerFile);
            } catch (error: any) {
                console.log(chalk.yellow(`📝 自动打开浏览器失败：${error.message}`));
            }
        }

        if (options.open === false && !options.apply) {
            return;
        }

        let shouldApply = Boolean(options.apply);
        if (!shouldApply) {
            const answer = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'confirm',
                    message: buildTriadizationConfirmationMessage(triadizationReport),
                    default: false
                }
            ]);

            shouldApply = answer.confirm;
        }

        if (!shouldApply) {
            console.log(chalk.red('🛑 已取消 apply，代码未修改。'));
            return;
        }

        await executeApply(paths.projectRoot, {
            source: 'plan',
            autoConfirmTriadization: Boolean(options.apply),
            triadizationReport
        });
    });

program
    .command('auto [demand...]')
    .description('生成“实现总提示词”，把协议规划当作实现前的内置子任务')
    .option('-d, --demand <text>', '显式传入用户需求文本')
    .action((demandParts: string[], options: { demand?: string }) => {
        const paths = getWorkspacePaths(process.cwd());
        const demand = resolveDemand(demandParts, options.demand, paths);

        if (!demand) {
            console.log(chalk.red('❌ 请提供需求文本，或先执行一次 prepare 保存 `latest-demand.txt`'));
            process.exitCode = 1;
            return;
        }

        console.log(chalk.cyan('🧠 [TriadMind] 正在生成实现总提示词...'));
        prepareWorkspace(paths, demand);
        console.log(chalk.green(`✅ 实现总提示词已写入 ${paths.implementationPromptFile}`));
        console.log(chalk.yellow(`➡️ 将 ${paths.implementationPromptFile} 作为当前对话的工作提示词使用`));
        console.log(chalk.yellow('➡️ 模型会先完成 Macro → Meso → Micro → draft-protocol.json，再进入 visualizer 审核与后续实现'));
    });

program
    .command('invoke [demand...]')
    .description('供 AI 助手静默触发的一键入口；兼容 `@triadmind <需求>` 输入')
    .option('-d, --demand <text>', '显式传入用户需求文本')
    .option('--apply', '如果 `draft-protocol.json` 已完备，则直接静默执行 plan/apply')
    .option('--view <architecture|leaf>', 'Set initial visualizer view when --apply generates review graph')
    .option('--show-isolated', 'Show isolated capability nodes in architecture view')
    .option('--full-contract-edges', 'Disable visualizer contract-edge capping')
    .action(async (demandParts: string[], options: { demand?: string; apply?: boolean } & DashboardCliOptions) => {
        const paths = getWorkspacePaths(process.cwd());
        const rawDemand = resolveDemand(demandParts, options.demand, paths);
        const demand = normalizeInvokeDemand(rawDemand);

        if (!demand) {
            console.log(chalk.red('❌ 请提供需求文本，例如：triadmind invoke "@triadmind 前端新增导出 CSV 按钮"'));
            process.exitCode = 1;
            return;
        }

        console.log(chalk.cyan('🤖 [TriadMind] 正在准备静默调用入口...'));
        if (isConvergeDirective(demand)) {
            executeConvergePlaceholder(paths);
            return;
        }

        prepareWorkspace(paths, demand);
        installAlwaysOnRules(paths);
        const triadizationReport = writeTriadizationArtifacts(paths);

        console.log(chalk.green(`✅ 静默入口已准备：${paths.implementationPromptFile}`));
        console.log(chalk.green(`✅ 协议任务文件：${paths.protocolTaskFile}`));
        console.log(chalk.green(`✅ 协议落盘位置：${paths.draftFile}`));
        reportTriadizationStatus(paths, triadizationReport);

        if (!options.apply) {
            console.log(chalk.yellow('➡️ AI 助手应读取 implementation-prompt.md，静默完成 Macro/Meso/Micro/Protocol。'));
            console.log(chalk.yellow('➡️ 协议保存后，再执行 `npm run invoke -- --apply` 或 `npm run plan -- --no-open --apply`。'));
            return;
        }

        let protocol: UpgradeProtocol;
        try {
            protocol = validateDraftProtocol(paths);
        } catch (error: any) {
            console.log(chalk.red(`❌ 当前 draft-protocol.json 尚不能落地：${error.message}`));
            console.log(chalk.yellow(`➡️ 请先让 AI 助手把完整协议写入 ${paths.draftFile}，然后重试 \`invoke --apply\``));
            process.exitCode = 1;
            return;
        }

        warnBlastRadiusIfNeeded(paths, protocol);

        generateDashboard(paths.mapFile, paths.draftFile, paths.visualizerFile, toDashboardOptions(options));
        console.log(chalk.green(`✅ 静默审核图已生成：${paths.visualizerFile}`));
        await executeApply(paths.projectRoot, {
            source: 'invoke',
            autoConfirmTriadization: true,
            triadizationReport
        });
    });

program
    .command('apply')
    .description('直接执行 `draft-protocol.json`，生成 / 更新骨架并刷新 `triad-map.json`')
    .action(async () => {
        const paths = getWorkspacePaths(process.cwd());

        if (!fs.existsSync(paths.draftFile)) {
            console.log(chalk.red(`❌ 未找到协议文件：${paths.draftFile}`));
            process.exitCode = 1;
            return;
        }

        await executeApply(paths.projectRoot, {
            source: 'apply'
        });
    });

program
    .command('handoff')
    .description('基于已批准协议、最新 triad-map 与骨架文件，生成第二阶段实现提示词')
    .action(() => {
        const paths = getWorkspacePaths(process.cwd());

        if (!fs.existsSync(paths.approvedProtocolFile)) {
            console.log(chalk.red(`❌ 未找到已批准协议：${paths.approvedProtocolFile}`));
            console.log(chalk.yellow('➡️ 请先执行一次 `triadmind apply`，或手动准备 `last-approved-protocol.json`'));
            process.exitCode = 1;
            return;
        }

        if (!fs.existsSync(paths.mapFile)) {
            console.log(chalk.red(`❌ 未找到 triad-map.json：${paths.mapFile}`));
            process.exitCode = 1;
            return;
        }

        writeHandoffPrompt(paths.projectRoot);
        console.log(chalk.green(`✅ 第二阶段实现提示词已写入 ${paths.handoffPromptFile}`));
        console.log(chalk.yellow(`➡️ 将 ${paths.handoffPromptFile} 发给当前实现阶段的 AI 助手即可`));
    });

program
    .command('master')
    .description('重建统一入口 `master-prompt.md`')
    .action(() => {
        const paths = getWorkspacePaths(process.cwd());
        ensureTriadSpec(paths);
        if (!fs.existsSync(paths.mapFile)) {
            syncProjectTopology(paths);
        }

        writeMasterPrompt(paths);
        console.log(chalk.green(`✅ 主提示词已写入 ${paths.masterPromptFile}`));
    });

program
    .command('rules')
    .description('Install always-on TriadMind rules for AGENTS.md and Cursor')
    .action(() => {
        const paths = getWorkspacePaths(process.cwd());
        ensureTriadSpec(paths);
        installAlwaysOnRules(paths);
        console.log(chalk.green(`✅ Always-on rules written: ${paths.agentRulesFile}`));
        console.log(chalk.green(`✅ Cursor rule written: ${paths.cursorRuleFile}`));
    });

program
    .command('self')
    .description('Bootstrap triadmind-core with its own TriadMind topology protocol and self-architecture report')
    .action(() => {
        const paths = getWorkspacePaths(process.cwd());
        ensureTriadSpec(paths);
        syncProjectTopology(paths, true);

        const protocol = writeSelfBootstrapProtocol(paths);
        validateDraftProtocol(paths);
        generateDashboard(paths.mapFile, paths.draftFile, paths.visualizerFile);
        const reportPath = writeSelfBootstrapReport(paths);
        writeMasterPrompt(paths);
        installAlwaysOnRules(paths);

        console.log(chalk.green(`✅ Self-bootstrap report written: ${reportPath}`));
        console.log(chalk.green(`✅ Self-bootstrap protocol written: ${paths.selfBootstrapProtocolFile}`));
        console.log(chalk.green(`✅ Review graph written: ${paths.visualizerFile}`));
        console.log(chalk.yellow(`➡️ Reused ${protocol.actions.length} existing TriadMind vertices; no source files were changed.`));
    });

program
    .command('adapters')
    .description('Show TriadMind adapter registry and current project adapter')
    .action(() => {
        const paths = getWorkspacePaths(process.cwd());
        ensureTriadSpec(paths);

        console.log(chalk.cyan('🧩 [TriadMind] Available language adapters'));
        for (const adapter of getAvailableAdapters()) {
            const marker = adapter.status === 'stable' ? chalk.green('stable') : chalk.yellow('planned');
            console.log(
                `- ${adapter.displayName} (${adapter.language}) | parser=${adapter.parserEngine} | package=${adapter.adapterPackage} | ${marker}`
            );
        }

        try {
            const current = resolveAdapter(paths);
            console.log(chalk.green(`✅ Current project adapter: ${current.displayName} (${current.language})`));
        } catch (error: any) {
            console.log(chalk.yellow(`ℹ️ Current project adapter status: ${error.message}`));
        }
    });

program
    .command('heal [errorFile]')
    .description('Generate runtime healing diagnosis and prompt from an error trace')
    .option('-m, --message <text>', 'Inline runtime error text')
    .option('-r, --retries <count>', 'Current auto-retry count', '0')
    .action((errorFile: string | undefined, options: { message?: string; retries?: string }) => {
        const paths = getWorkspacePaths(process.cwd());
        ensureTriadSpec(paths);

        if (!fs.existsSync(paths.mapFile)) {
            syncProjectTopology(paths);
        }

        let errorText = '';
        try {
            errorText = resolveHealingInput(paths, errorFile, options.message);
        } catch (error: any) {
            console.log(chalk.red(`❌ ${error.message}`));
            process.exitCode = 1;
            return;
        }

        if (!errorText) {
            console.log(chalk.red(`❌ Please provide runtime error text, or write it into ${paths.runtimeErrorFile}`));
            process.exitCode = 1;
            return;
        }

        const retryCount = Number.parseInt(options.retries ?? '0', 10);
        const { diagnosis } = prepareHealingArtifacts(paths, errorText, Number.isFinite(retryCount) ? retryCount : 0);

        console.log(chalk.green(`✅ Healing report written: ${paths.healingReportFile}`));
        console.log(chalk.green(`✅ Healing prompt written: ${paths.healingPromptFile}`));
        console.log(chalk.green(`✅ Runtime error snapshot written: ${paths.runtimeErrorFile}`));
        console.log(chalk.yellow(`➡️ Matched node: ${diagnosis.matchedNodeId ?? 'unresolved'}`));
        console.log(chalk.yellow(`➡️ Diagnosis: ${diagnosis.diagnosis}, action=${diagnosis.suggestedAction}`));
        if (diagnosis.requiresHumanApproval) {
            console.log(chalk.yellow('➡️ Human approval is recommended before applying contract-impacting repairs.'));
        }
    });

program
    .command('snapshots')
    .description('List TriadMind manual safety snapshots')
    .action(() => {
        const paths = getWorkspacePaths(process.cwd());
        const snapshots = listSnapshots(paths);

        if (snapshots.length === 0) {
            console.log(chalk.yellow('No TriadMind snapshots found.'));
            return;
        }

        snapshots.forEach((snapshot) => {
            console.log(`${snapshot.id} | ${snapshot.createdAt} | ${snapshot.label}`);
        });
    });

program
    .command('snapshot [label]')
    .description('Create a manual snapshot of key TriadMind workspace files')
    .action((label?: string) => {
        const paths = getWorkspacePaths(process.cwd());
        ensureTriadSpec(paths);
        const snapshot = createSnapshot(paths, label ?? 'manual', collectManualSnapshotFiles(paths));
        console.log(chalk.green(`✅ Snapshot created: ${snapshot.id}`));
    });

program
    .command('rollback [snapshotId]')
    .description('Restore a TriadMind safety snapshot; defaults to the latest snapshot')
    .action((snapshotId?: string) => {
        const paths = getWorkspacePaths(process.cwd());
        try {
            const snapshot = restoreSnapshot(paths, snapshotId);
            console.log(chalk.green(`✅ Snapshot restored: ${snapshot.id}`));
        } catch (error: any) {
            console.log(chalk.red(`❌ Rollback failed: ${error.message}`));
            process.exitCode = 1;
        }
    });

function printPassPrompt(stage: 'macro' | 'meso' | 'micro', demandParts: string[], optionDemand?: string) {
    const paths = getWorkspacePaths(process.cwd());
    const demand = resolveDemand(demandParts, optionDemand, paths);

    if (!demand) {
        console.log(chalk.red('❌ 请提供需求文本，或先执行一次 prepare / pipeline 保存 `latest-demand.txt`'));
        process.exitCode = 1;
        return;
    }

    prepareWorkspace(paths, demand);

    const mapping = {
        macro: {
            prompt: paths.macroPromptFile,
            output: paths.macroSplitFile,
            label: 'Macro-Split'
        },
        meso: {
            prompt: paths.mesoPromptFile,
            output: paths.mesoSplitFile,
            label: 'Meso-Split'
        },
        micro: {
            prompt: paths.microPromptFile,
            output: paths.microSplitFile,
            label: 'Micro-Split'
        }
    } as const;

    const current = mapping[stage];
    console.log(chalk.cyan(`🧩 [TriadMind] 正在准备 ${current.label} 提示词...`));
    console.log(chalk.green(`✅ 提示词文件：${current.prompt}`));
    console.log(chalk.green(`✅ 结果文件：${current.output}`));
    console.log(chalk.yellow(`➡️ 将 ${current.prompt} 发给当前对话中的大模型，并把 JSON 结果写回 ${current.output}`));
    console.log(chalk.yellow(`➡️ 完成后继续下一轮，最终汇总到 ${paths.draftFile}`));
}

async function executeApply(projectRoot: string, options: ExecuteApplyOptions) {
    const paths = getWorkspacePaths(projectRoot);

    try {
        if (!fs.existsSync(paths.mapFile)) {
            syncProjectTopology(paths);
        }

        const triadizationReport = options.triadizationReport ?? writeTriadizationArtifacts(paths);
        reportTriadizationStatus(paths, triadizationReport);
        const confirmed = await ensureTriadizationConfirmation(
            paths,
            triadizationReport,
            options.source,
            Boolean(options.autoConfirmTriadization)
        );
        if (!confirmed) {
            console.log(chalk.red('🛑 三元化演进方案尚未确认，已取消 apply。'));
            return;
        }

        const previousMap = readCurrentTriadMap(paths);
        const protocol = validateDraftProtocol(paths);
        const snapshot = createSnapshot(paths, 'before-apply', collectProtocolSnapshotFiles(paths, protocol));
        console.log(chalk.gray(`   - [Snapshot] created ${snapshot.id}`));
        console.log(chalk.cyan('🛠️ [TriadMind] 正在执行协议并生成骨架代码...'));
        const approvedProtocolJson = JSON.stringify(protocol, null, 2);
        fs.writeFileSync(paths.approvedProtocolFile, approvedProtocolJson, 'utf-8');

        const result = dispatchProtocolApply(projectRoot, protocol);
        syncProjectTopology(paths, true);
        assertNoTopologicalDegradation(paths, previousMap, 'apply');
        writeHandoffPrompt(projectRoot, result.changedFiles, approvedProtocolJson);
        runAutoDreamAfterCommand(paths, 'apply');

        if (fs.existsSync(paths.draftFile)) {
            fs.unlinkSync(paths.draftFile);
        }

        console.log(chalk.green(`✅ 骨架生成完成，triad-map 已更新：${paths.mapFile}`));
        console.log(chalk.green(`✅ 第二阶段实现提示词已写入 ${paths.handoffPromptFile}`));
    } catch (error: any) {
        console.log(chalk.red(`❌ Apply 失败：${error.message}`));
        process.exitCode = 1;
    }
}

function syncProjectTopology(paths: ReturnType<typeof getWorkspacePaths>, force = false, scanMode?: TriadScanMode) {
    return scanMode ? syncTriadMapWithOptions(paths, { force, scanMode }) : syncTriadMap(paths, force);
}

async function writeRuntimeTopologyArtifacts(
    paths: ReturnType<typeof getWorkspacePaths>,
    options: {
        view?: ReturnType<typeof normalizeRuntimeView>;
        includeFrontend?: boolean;
        includeInfra?: boolean;
        frameworkHint?: string;
    },
    bestEffort = true
) {
    try {
        const runtimeMap = await extractRuntimeTopology(paths.projectRoot, options);
        writeRuntimeMapArtifacts(runtimeMap, paths.runtimeMapFile, paths.runtimeDiagnosticsFile);
        return { runtimeMap, recovered: false };
    } catch (error: any) {
        if (!bestEffort) {
            throw error;
        }

        const runtimeMap = {
            schemaVersion: '1.0' as const,
            project: path.basename(paths.projectRoot),
            generatedAt: new Date().toISOString(),
            view: options.view,
            nodes: [],
            edges: [],
            diagnostics: [
                {
                    level: 'error' as const,
                    code: 'RUNTIME_BEST_EFFORT_FAILURE',
                    extractor: 'RuntimeOrchestrator',
                    message: error?.message ? String(error.message) : String(error)
                }
            ]
        };
        writeRuntimeMapArtifacts(runtimeMap, paths.runtimeMapFile, paths.runtimeDiagnosticsFile);
        return { runtimeMap, recovered: true };
    }
}

function writeViewMapArtifactsBestEffort(
    paths: ReturnType<typeof getWorkspacePaths>,
    options: { maxCandidatesPerRuntimeNode?: number } = {}
) {
    try {
        const viewMap = writeViewMapArtifacts(paths, options);
        return { viewMap, recovered: false };
    } catch (error: any) {
        const fallbackViewMap = {
            schemaVersion: '1.0' as const,
            project: path.basename(paths.projectRoot),
            generatedAt: new Date().toISOString(),
            stats: {
                runtimeNodes: 0,
                capabilityNodes: 0,
                leafNodes: 0,
                linkCount: 0,
                runtimeMatchedNodes: 0,
                runtimeUnmatchedNodes: 0,
                runtimeMatchRate: 0,
                capabilityMatchedNodes: 0,
                capabilityUnmatchedNodes: 0,
                capabilityLeafMatchRate: 0,
                leafMatchedNodes: 0,
                leafUnmatchedNodes: 0,
                leafCapabilityMatchRate: 0,
                runtimeToCapabilityLinkCount: 0,
                capabilityToLeafLinkCount: 0,
                runtimeToLeafLinkCount: 0,
                endToEndTraceableRuntimeNodes: 0,
                endToEndTraceabilityRate: 0
            },
            links: [],
            diagnostics: [
                {
                    level: 'error' as const,
                    code: 'VIEW_MAP_BEST_EFFORT_FAILURE',
                    message: error?.message ? String(error.message) : String(error)
                }
            ]
        };
        fs.mkdirSync(path.dirname(paths.viewMapFile), { recursive: true });
        fs.writeFileSync(paths.viewMapFile, JSON.stringify(fallbackViewMap, null, 2), 'utf-8');
        fs.writeFileSync(paths.viewMapDiagnosticsFile, JSON.stringify(fallbackViewMap.diagnostics, null, 2), 'utf-8');
        return { viewMap: fallbackViewMap, recovered: true };
    }
}

function reportRuntimeArtifactStatus(
    paths: ReturnType<typeof getWorkspacePaths>,
    result: {
        runtimeMap: {
            diagnostics?: Array<{ code?: string; level: 'info' | 'warning' | 'error'; message: string }>;
        };
        recovered: boolean;
    }
) {
    const diagnostics = result.runtimeMap.diagnostics ?? [];
    const permissionSkips = diagnostics.filter((diagnostic) => diagnostic.code === 'RUNTIME_PERMISSION_SKIPPED').length;
    const extractorErrors = diagnostics.filter((diagnostic) => diagnostic.code === 'RUNTIME_EXTRACTOR_FAILED').length;

    if (permissionSkips > 0) {
        console.log(chalk.yellow(`[TriadMind] runtime extraction skipped ${permissionSkips} paths due to permission restrictions`));
    }
    if (extractorErrors > 0) {
        console.log(chalk.yellow(`[TriadMind] runtime extraction recorded ${extractorErrors} extractor error diagnostics`));
    }
    if (result.recovered) {
        console.log(chalk.yellow('[TriadMind] runtime extraction degraded to diagnostics-only mode'));
    }

    console.log(chalk.green(`✅ Runtime map written: ${paths.runtimeMapFile}`));
    console.log(chalk.green(`✅ Runtime diagnostics written: ${paths.runtimeDiagnosticsFile}`));
}

function reportViewMapStatus(
    paths: ReturnType<typeof getWorkspacePaths>,
    result: {
        recovered: boolean;
        viewMap: {
            stats?: {
                linkCount?: number;
                runtimeMatchRate?: number;
                capabilityLeafMatchRate?: number;
                endToEndTraceabilityRate?: number;
            };
            diagnostics?: Array<{ code?: string; level: 'info' | 'warning' | 'error'; message: string }>;
        };
    }
) {
    const diagnostics = result.viewMap.diagnostics ?? [];
    const missingFileWarnings = diagnostics.filter(
        (item) =>
            item.code === 'VIEW_MAP_MISSING_RUNTIME_MAP' ||
            item.code === 'VIEW_MAP_MISSING_LEAF_MAP' ||
            item.code === 'VIEW_MAP_MISSING_TRIAD_MAP'
    ).length;
    if (missingFileWarnings > 0) {
        console.log(
            chalk.yellow(`[TriadMind] view-map generation detected ${missingFileWarnings} missing prerequisite file warning(s)`)
        );
    }
    if (result.recovered) {
        console.log(chalk.yellow('[TriadMind] view-map generation degraded to diagnostics-only mode'));
    }
    console.log(
        chalk.green(
            `✅ View map written: ${paths.viewMapFile} (links=${result.viewMap.stats?.linkCount ?? 0}, runtime=${(
                result.viewMap.stats?.runtimeMatchRate ?? 0
            ).toFixed(3)}, capabilityLeaf=${(result.viewMap.stats?.capabilityLeafMatchRate ?? 0).toFixed(3)}, e2e=${(
                result.viewMap.stats?.endToEndTraceabilityRate ?? 0
            ).toFixed(3)})`
        )
    );
    console.log(chalk.green(`✅ View map diagnostics written: ${paths.viewMapDiagnosticsFile}`));
}

function reportTriadizationStatus(paths: ReturnType<typeof getWorkspacePaths>, report: TriadizationReport) {
    if (!report.primaryProposal) {
        console.log(chalk.yellow('[TriadMind] 当前未发现明确的三元化提案。'));
        console.log(chalk.green(`✅ Triadization report written: ${paths.triadizationReportFile}`));
        console.log(chalk.green(`✅ Triadization task written: ${paths.triadizationTaskFile}`));
        return;
    }

    const proposal = report.primaryProposal;
    console.log(
        chalk.cyan(
            `[TriadMind] triadization focus: ${proposal.targetNodeId} -> ${proposal.recommendedOperation} (${proposal.diagnosis.join(', ')})`
        )
    );
    console.log(chalk.gray(`   - rationale: ${proposal.rationale}`));
    if (proposal.blastRadius.impactedNodeCount > 0) {
        console.log(
            chalk.gray(
                `   - blast radius: ${proposal.blastRadius.impactedNodeCount} downstream node(s) (${proposal.blastRadius.impactedNodeIds
                    .slice(0, 8)
                    .join(', ')})`
            )
        );
    }
    console.log(chalk.green(`✅ Triadization report written: ${paths.triadizationReportFile}`));
    console.log(chalk.green(`✅ Triadization task written: ${paths.triadizationTaskFile}`));
}

function reportBootstrapInitResult(paths: ReturnType<typeof getWorkspacePaths>, result: BootstrapScaffoldInitResult) {
    const created = result.files.filter((item) => item.action === 'created').length;
    const updated = result.files.filter((item) => item.action === 'updated').length;
    const skipped = result.files.filter((item) => item.action === 'skipped').length;
    console.log(
        chalk.green(
            `[TriadMind] bootstrap init complete: created=${created}, updated=${updated}, skipped=${skipped}`
        )
    );
    result.files.forEach((item) => {
        const marker =
            item.action === 'created'
                ? chalk.green('+')
                : item.action === 'updated'
                  ? chalk.yellow('~')
                  : chalk.gray('=');
        console.log(chalk.gray(`   ${marker} ${item.key}: ${item.path}`));
    });
    console.log(chalk.green(`[TriadMind] session verify output target: ${paths.bootstrapVerifyFile}`));
}

function buildTriadizationConfirmationMessage(report: TriadizationReport) {
    const proposal = report.primaryProposal;
    if (!proposal) {
        return '未检测到明确的三元化提案，仍继续当前协议落地吗？';
    }

    return `确认本轮先对 ${proposal.targetNodeId} 执行 ${proposal.recommendedOperation}（${proposal.diagnosis.join(', ')}），再继续协议 / 骨架演进吗？`;
}

async function ensureTriadizationConfirmation(
    paths: ReturnType<typeof getWorkspacePaths>,
    report: TriadizationReport,
    source: TriadizationConfirmationSource,
    autoConfirm = false
) {
    if (!report.primaryProposal) {
        return true;
    }

    if (hasConfirmedTriadization(paths, report)) {
        return true;
    }

    let confirmed = autoConfirm;
    if (!confirmed) {
        const answer = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'confirm',
                message: buildTriadizationConfirmationMessage(report),
                default: false
            }
        ]);
        confirmed = answer.confirm;
    }

    if (!confirmed) {
        return false;
    }

    writeTriadizationConfirmation(paths, report, source);
    return true;
}

function runAutoDreamAfterCommand(paths: ReturnType<typeof getWorkspacePaths>, trigger: string) {
    void tickDreamAutoRun(paths, { trigger })
        .then((result) => {
        if (result.status === 'run') {
            console.log(
                chalk.gray(
                    `[TriadMind] dream auto run complete: trigger=${trigger}, pending=${result.pendingEvents}, lock=${result.lock}`
                )
            );
            return;
        }
        if (result.status === 'error') {
            console.log(
                chalk.yellow(
                    `[TriadMind] dream auto run failed: trigger=${trigger}, reason=${result.reason}, error=${result.error ?? 'unknown'}`
                )
            );
        }
        })
        .catch((error: any) => {
            console.log(
                chalk.yellow(
                    `[TriadMind] dream auto trigger crashed: trigger=${trigger}, error=${error?.message ? String(error.message) : String(error)}`
                )
            );
        });
}

async function executeDreamRun(options: DreamRunCliOptions) {
    const paths = getWorkspacePaths(process.cwd());
    ensureTriadSpec(paths);

    const result = await runDreamAnalysis(paths, {
        mode: options.mode === 'idle' ? 'idle' : 'manual',
        force: Boolean(options.force),
        maxProposals: parseOptionalPositiveCliInteger(options.maxProposals),
        minConfidence: parseOptionalRatioCliNumber(options.minConfidence)
    });

    if (options.visualize) {
        generateDreamDashboard(result.report, paths.dreamVisualizerFile, {
            theme: options.theme === 'runtime-dark' ? 'runtime-dark' : 'leaf-like'
        });
    }

    if (options.json) {
        console.log(JSON.stringify(result.report, null, 2));
        return;
    }

    console.log(formatDreamReport(result.report));
    console.log(chalk.green(`✅ Dream report written: ${result.artifacts.reportFile}`));
    console.log(chalk.green(`✅ Dream diagnostics written: ${result.artifacts.diagnosticsFile}`));
    console.log(chalk.green(`✅ Dream proposals written: ${result.artifacts.proposalsFile}`));
    if (options.visualize) {
        console.log(chalk.green(`✅ Dream visualizer written: ${paths.dreamVisualizerFile}`));
    }
}

function formatBootstrapDoctorReport(report: BootstrapDoctorReport) {
    const summary = report.passed ? 'PASS' : 'FAIL';
    const lines = [
        `TriadMind Bootstrap Doctor (${summary})`,
        `generatedAt=${report.generatedAt}`,
        `pass=${report.summary.passCount}, fail=${report.summary.failCount}`
    ];
    for (const file of report.files) {
        const icon = file.status === 'pass' ? 'PASS' : 'FAIL';
        lines.push(`[${icon}] ${file.key} | ${file.message}`);
        if (file.recommendedAction) {
            lines.push(`   action: ${file.recommendedAction}`);
        }
    }
    return lines.join('\n');
}

function resolveBootstrapCliCommand(paths: ReturnType<typeof getWorkspacePaths>) {
    const invokedScript = path.resolve(process.argv[1] ?? '');
    const projectCliTs = path.join(paths.projectRoot, 'cli.ts');
    const projectCliJs = path.join(paths.projectRoot, 'dist', 'cli.js');

    if (invokedScript && normalizePath(invokedScript) === normalizePath(projectCliTs) && fs.existsSync(projectCliTs)) {
        return 'node --import tsx cli.ts';
    }

    if (invokedScript && normalizePath(invokedScript) === normalizePath(projectCliJs) && fs.existsSync(projectCliJs)) {
        return 'node dist/cli.js';
    }

    return 'triadmind';
}

function readCurrentTriadMap(paths: ReturnType<typeof getWorkspacePaths>) {
    return fs.existsSync(paths.mapFile) ? readTriadMap(paths.mapFile) : [];
}

function toDashboardOptions(options: DashboardCliOptions) {
    return {
        defaultView: normalizeDashboardView(options.view),
        showIsolatedCapabilities: options.showIsolated,
        fullContractEdges: options.fullContractEdges
    };
}

function normalizeDashboardView(value?: string): DashboardView | undefined {
    if (value === 'architecture' || value === 'leaf') {
        return value;
    }

    return undefined;
}

function normalizeScanModeOption(value?: string): TriadScanMode | undefined {
    if (value === 'leaf' || value === 'capability' || value === 'module' || value === 'domain') {
        return value;
    }
    return undefined;
}

function normalizePositiveCliInteger(value: string | undefined, fallback: number) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
    }
    return fallback;
}

function parseOptionalPositiveCliInteger(value: string | undefined) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
    }
    return undefined;
}

function parseOptionalNonNegativeCliInteger(value: string | undefined) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
        return parsed;
    }
    return undefined;
}

function parseOptionalRatioCliNumber(value: string | undefined) {
    const parsed = Number.parseFloat(String(value ?? ''));
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
        return parsed;
    }
    return undefined;
}

function sniffProjectLanguage(projectRoot: string): TriadLanguage {
    if (fs.existsSync(path.join(projectRoot, 'tsconfig.json'))) {
        return 'typescript';
    }

    if (
        fs.existsSync(path.join(projectRoot, 'requirements.txt')) ||
        fs.existsSync(path.join(projectRoot, 'pyproject.toml'))
    ) {
        return 'python';
    }

    if (fs.existsSync(path.join(projectRoot, 'go.mod'))) {
        return 'go';
    }

    return loadTriadConfig(getWorkspacePaths(projectRoot)).architecture.language;
}

function resolveStableAdapter(language: TriadLanguage): LanguageAdapter {
    const adapters = getAvailableAdapters().filter((adapter) => adapter.language === language);
    const stableAdapter = adapters.find((adapter) => adapter.status === 'stable');
    const adapter = stableAdapter ?? adapters[0];

    if (!adapter) {
        throw new Error(`No language adapter registered for ${language}`);
    }

    return adapter;
}

function createCliLanguageAdapter(language: TriadLanguage): CliLanguageAdapter {
    const adapter = resolveStableAdapter(language);
    let changedFiles: string[] = [];

    return {
        language,
        displayName: adapter.displayName,
        applyProtocol(protocol: any, projectRoot: string) {
            const paths = getWorkspacePaths(projectRoot);
            const approvedProtocolPath = paths.approvedProtocolFile;
            fs.writeFileSync(approvedProtocolPath, JSON.stringify(protocol, null, 2), 'utf-8');
            changedFiles = adapter.applyUpgradeProtocol(projectRoot, approvedProtocolPath).changedFiles;
        },
        consumeChangedFiles() {
            const current = changedFiles;
            changedFiles = [];
            return current;
        }
    };
}

function dispatchProtocolApply(projectRoot: string, protocol: UpgradeProtocol) {
    const detectedLanguage = sniffProjectLanguage(projectRoot);
    const adapter = createCliLanguageAdapter(detectedLanguage);
    console.log(chalk.gray(`   - [Adapter] detected ${detectedLanguage} -> ${adapter.displayName}`));
    adapter.applyProtocol(protocol, projectRoot);

    return {
        language: detectedLanguage,
        changedFiles: adapter.consumeChangedFiles()
    };
}

function assertNoTopologicalDegradation(
    paths: ReturnType<typeof getWorkspacePaths>,
    previousMap: any[],
    lifecycle: 'init' | 'apply'
) {
    const config = loadTriadConfig(paths);
    const drift = detectTopologicalDrift(previousMap, readCurrentTriadMap(paths), {
        ignoreGenericContracts: config.parser.ignoreGenericContracts,
        genericContractIgnoreList: config.parser.genericContractIgnoreList
    });
    if (!drift.isDegraded) {
        return;
    }

    throw new Error(`[${lifecycle}] topological drift detected: ${drift.summary.join(' ')}`);
}

function warnBlastRadiusIfNeeded(paths: ReturnType<typeof getWorkspacePaths>, protocol: UpgradeProtocol) {
    const currentMap = readCurrentTriadMap(paths);
    if (currentMap.length === 0) {
        return;
    }

    const config = loadTriadConfig(paths);
    const currentNodeMap = new Map(currentMap.map((node) => [node.nodeId, node]));
    const impactedNodeIds = new Set<string>();
    const hotspots: string[] = [];

    for (const action of protocol.actions) {
        if (action.op !== 'modify') {
            continue;
        }

        const currentNode = currentNodeMap.get(action.nodeId);
        if (!currentNode) {
            continue;
        }

        const isContractChange = hasContractChange(currentNode, action.fission);
        const impacted = calculateBlastRadius(currentMap, action.nodeId, isContractChange, {
            ignoreGenericContracts: config.parser.ignoreGenericContracts,
            genericContractIgnoreList: config.parser.genericContractIgnoreList
        });
        impacted.forEach((nodeId) => impactedNodeIds.add(nodeId));

        if (isContractChange && impacted.length > 0) {
            hotspots.push(`${action.nodeId} -> ${impacted.length}`);
        }
    }

    if (impactedNodeIds.size < BLAST_RADIUS_WARNING_THRESHOLD) {
        return;
    }

    console.log(
        chalk.yellow(
            `⚠️ Blast radius warning: ${impactedNodeIds.size} downstream nodes may be affected (${Array.from(impactedNodeIds)
                .sort()
                .slice(0, 8)
                .join(', ')}).`
        )
    );

    if (hotspots.length > 0) {
        console.log(chalk.yellow(`   - contract hotspots: ${hotspots.join('; ')}`));
    }
}

function hasContractChange(
    currentNode: { fission: { demand: string[]; answer: string[] } },
    nextFission: { demand: string[]; answer: string[] }
) {
    const normalizeEntries = (entries: string[]) => entries.map((entry) => entry.trim()).filter(Boolean);

    return (
        JSON.stringify(normalizeEntries(currentNode.fission.demand)) !== JSON.stringify(normalizeEntries(nextFission.demand)) ||
        JSON.stringify(normalizeEntries(currentNode.fission.answer)) !== JSON.stringify(normalizeEntries(nextFission.answer))
    );
}

function resolveHealingInput(paths: ReturnType<typeof getWorkspacePaths>, errorFile?: string, inlineMessage?: string) {
    if (inlineMessage?.trim()) {
        return inlineMessage.trim();
    }

    if (errorFile?.trim()) {
        const candidate = path.isAbsolute(errorFile) ? errorFile : path.join(paths.projectRoot, errorFile);
        if (!fs.existsSync(candidate)) {
            throw new Error(`Healing input file not found: ${candidate}`);
        }

        return fs.readFileSync(candidate, 'utf-8').replace(/^\uFEFF/, '').trim();
    }

    if (fs.existsSync(paths.runtimeErrorFile)) {
        return fs.readFileSync(paths.runtimeErrorFile, 'utf-8').replace(/^\uFEFF/, '').trim();
    }

    return '';
}

function collectManualSnapshotFiles(paths: ReturnType<typeof getWorkspacePaths>) {
    return [
        path.relative(paths.projectRoot, paths.configFile),
        path.relative(paths.projectRoot, paths.mapFile),
        path.relative(paths.projectRoot, paths.draftFile),
        path.relative(paths.projectRoot, paths.approvedProtocolFile),
        path.relative(paths.projectRoot, paths.handoffPromptFile),
        path.relative(paths.projectRoot, paths.healingReportFile),
        path.relative(paths.projectRoot, paths.healingPromptFile),
        path.relative(paths.projectRoot, paths.runtimeErrorFile)
    ];
}

function validateDraftProtocol(paths: ReturnType<typeof getWorkspacePaths>) {
    let protocol: UpgradeProtocol;

    try {
        protocol = readJsonFile<UpgradeProtocol>(paths.draftFile);
    } catch (error: any) {
        throw new Error(`Invalid JSON in ${paths.draftFile}: ${error.message}`);
    }

    const existingNodes = readTriadMap(paths.mapFile);
    const config = loadTriadConfig(paths);
    const expectedTriadizationFocus = resolveExpectedTriadizationFocus(paths);
    const parsedProtocol = assertProtocolShape(protocol, {
        existingNodes,
        minConfidence: config.protocol.minConfidence,
        requireConfidence: config.protocol.requireConfidence,
        expectedTriadizationFocus
    });
    assertTriadizationFocusGate(paths);
    return parsedProtocol;
}

function assertTriadizationFocusGate(paths: ReturnType<typeof getWorkspacePaths>) {
    const report = runTopologyVerify(paths);
    const failedChecks = report.checks.filter(
        (check) =>
            (check.key === 'protocol_focus_alignment' || check.key === 'triad_focus_closure') &&
            check.status === 'fail'
    );

    if (failedChecks.length === 0) {
        return;
    }

    const detail = failedChecks.map((check) => `${check.key}: ${check.detail}`).join('; ');
    throw new Error(
        `Triadization focus gate failed: ${detail}. Please realign draft-protocol.json and micro-split.json around the same triadization focus before plan/apply.`
    );
}

function resolveExpectedTriadizationFocus(paths: ReturnType<typeof getWorkspacePaths>) {
    if (fs.existsSync(paths.triadizationReportFile)) {
        try {
            const report = readJsonFile<TriadizationReport>(paths.triadizationReportFile);
            const proposal = report?.primaryProposal;
            if (proposal && typeof proposal.targetNodeId === 'string' && typeof proposal.recommendedOperation === 'string') {
                return {
                    triadizationFocus: proposal.targetNodeId,
                    recommendedOperation: proposal.recommendedOperation
                };
            }
        } catch {
            // ignore malformed report and fall through to confirmation
        }
    }

    const confirmation = readTriadizationConfirmation(paths);
    if (!confirmation) {
        return undefined;
    }

    return {
        triadizationFocus: confirmation.targetNodeId,
        recommendedOperation: confirmation.recommendedOperation
    };
}

function prepareWorkspace(paths: ReturnType<typeof getWorkspacePaths>, demand: string) {
    ensureTriadSpec(paths);
    syncProjectTopology(paths);
    createDraftTemplate(paths, demand);
    writePromptPacket(paths, demand);
}

function writeHandoffPrompt(projectRoot: string, changedFiles?: string[], approvedProtocolJson?: string) {
    const paths = getWorkspacePaths(projectRoot);
    const demand = fs.existsSync(paths.demandFile) ? fs.readFileSync(paths.demandFile, 'utf-8') : '';
    const protocolJson =
        approvedProtocolJson ??
        (fs.existsSync(paths.approvedProtocolFile) ? fs.readFileSync(paths.approvedProtocolFile, 'utf-8') : '');
    const triadMapJson = fs.readFileSync(paths.mapFile, 'utf-8');
    const trackedFiles =
        changedFiles ??
        (fs.existsSync(paths.lastApplyFilesFile)
            ? JSON.parse(fs.readFileSync(paths.lastApplyFilesFile, 'utf-8')).files ?? []
            : []);

    const filePayload = trackedFiles
        .filter((filePath: string) => typeof filePath === 'string' && filePath.trim())
        .map((filePath: string) => ({
            path: filePath,
            content: fs.existsSync(path.join(projectRoot, filePath))
                ? fs.readFileSync(path.join(projectRoot, filePath), 'utf-8')
                : ''
        }));

    writeImplementationHandoff(paths, {
        userDemand: demand,
        approvedProtocolJson: protocolJson,
        triadMapJson,
        changedFiles: filePayload
    });
}

function resolveDemand(
    demandParts: string[],
    optionDemand?: string,
    paths?: ReturnType<typeof getWorkspacePaths>
) {
    const fromArgs = demandParts.join(' ').trim();
    if (optionDemand?.trim()) {
        return optionDemand.trim();
    }

    if (fromArgs) {
        return fromArgs;
    }

    if (paths?.demandFile && fs.existsSync(paths.demandFile)) {
        return fs.readFileSync(paths.demandFile, 'utf-8').trim();
    }

    return '';
}

function normalizeInvokeDemand(value: string) {
    return value.trim().replace(/^@?triadmind(?:\s*[:：-]\s*|\s+)/i, '').trim();
}

function isConvergeDirective(value: string) {
    const normalized = value.trim().toLowerCase();
    return normalized === 'converge' || normalized === 'renormalize --deep' || normalized === '@triadmind converge';
}

function executeConvergePlaceholder(paths: ReturnType<typeof getWorkspacePaths>) {
    ensureTriadSpec(paths);
    if (!fs.existsSync(paths.mapFile)) {
        syncProjectTopology(paths, true);
    }

    const map = readCurrentTriadMap(paths);
    const overloadedNodes = detectHighFanoutNodes(map, 3);
    fs.writeFileSync(paths.convergeTaskFile, buildConvergeTask(paths, overloadedNodes), 'utf-8');

    console.log(chalk.yellow('Recursive renormalization is reserved as a TODO and is not implemented yet.'));
    console.log(chalk.green(`Convergence task written: ${paths.convergeTaskFile}`));

    if (overloadedNodes.length > 0) {
        console.log(chalk.yellow(`Detected ${overloadedNodes.length} high-fanout node(s) worth future convergence review.`));
    } else {
        console.log(chalk.green('No current node crosses the default high-fanout threshold (>= 3 downstreams).'));
    }
}

function detectHighFanoutNodes(map: any[], threshold: number) {
    const answerProducers = new Map<string, string[]>();
    const downstreamByNode = new Map<string, Set<string>>();

    for (const node of Array.isArray(map) ? map : []) {
        const nodeId = typeof node?.nodeId === 'string' ? node.nodeId.trim() : '';
        if (!nodeId) {
            continue;
        }

        const answers = Array.isArray(node?.fission?.answer) ? node.fission.answer : [];
        for (const answer of answers) {
            const answerKey = normalizeContractKey(answer);
            if (!answerKey) {
                continue;
            }

            const producers = answerProducers.get(answerKey) ?? [];
            producers.push(nodeId);
            answerProducers.set(answerKey, producers);
        }
    }

    for (const node of Array.isArray(map) ? map : []) {
        const consumerNodeId = typeof node?.nodeId === 'string' ? node.nodeId.trim() : '';
        if (!consumerNodeId) {
            continue;
        }

        const demands = Array.isArray(node?.fission?.demand) ? node.fission.demand : [];
        for (const demand of demands) {
            const demandKey = normalizeContractKey(demand);
            if (!demandKey) {
                continue;
            }

            const producers = answerProducers.get(demandKey) ?? [];
            for (const producerNodeId of producers) {
                if (producerNodeId === consumerNodeId) {
                    continue;
                }

                const downstreams = downstreamByNode.get(producerNodeId) ?? new Set<string>();
                downstreams.add(consumerNodeId);
                downstreamByNode.set(producerNodeId, downstreams);
            }
        }
    }

    return Array.from(downstreamByNode.entries())
        .map(([nodeId, downstreams]) => ({
            nodeId,
            downstreamNodeIds: Array.from(downstreams).sort(),
            downstreamCount: downstreams.size
        }))
        .filter((entry) => entry.downstreamCount >= threshold)
        .sort((left, right) => right.downstreamCount - left.downstreamCount || left.nodeId.localeCompare(right.nodeId));
}

function normalizeContractKey(contract: unknown) {
    if (typeof contract !== 'string') {
        return '';
    }

    const trimmed = contract.trim();
    if (!trimmed || /^none$/i.test(trimmed)) {
        return '';
    }

    const ghostPrefixMatch = trimmed.match(/^\[Ghost:[^\]]+\]\s*(.+)$/i);
    const withoutGhostPrefix = ghostPrefixMatch ? ghostPrefixMatch[1].trim() : trimmed;
    const signatureMatch = withoutGhostPrefix.match(/^(.+?)\s*\(/);
    return (signatureMatch ? signatureMatch[1] : withoutGhostPrefix).trim();
}

function buildConvergeTask(
    paths: ReturnType<typeof getWorkspacePaths>,
    overloadedNodes: Array<{ nodeId: string; downstreamNodeIds: string[]; downstreamCount: number }>
) {
    const overloadSection =
        overloadedNodes.length > 0
            ? overloadedNodes
                  .map(
                      (entry, index) =>
                          `${index + 1}. ${entry.nodeId} -> ${entry.downstreamCount} downstream(s)\n   - ${entry.downstreamNodeIds.join('\n   - ')}`
                  )
                  .join('\n')
            : 'None. No current node exceeds the default threshold of 3 downstream nodes.';

    return [
        '# Recursive Renormalization TODO',
        '',
        'Status: reserved capability only. This workflow is not implemented yet.',
        '',
        '## Why this file exists',
        '',
        'TriadMind currently supports cycle-based renormalization, but it does not yet support iterative branch repartition for single nodes with high downstream fanout.',
        '',
        '## Reserved trigger',
        '',
        '- `@triadmind renormalize --deep`',
        '- `@triadmind converge`',
        '',
        '## Intended future behavior',
        '',
        '- Detect nodes whose downstream fanout is greater than or equal to 3',
        '- Renormalize from outermost layer to innermost layer',
        '- Recompute `blast radius / cycles / drift` after every round',
        '- Stop only when topology stabilizes into explicit left/right branch structure',
        '',
        '## Current workspace snapshot',
        '',
        `- Project root: ${paths.projectRoot.replace(/\\/g, '/')}`,
        `- Triad map: ${paths.mapFile.replace(/\\/g, '/')}`,
        '- Threshold: 3 downstream nodes',
        '',
        '## Current high-fanout candidates',
        '',
        overloadSection,
        '',
        '## Suggested governance loop',
        '',
        '1. Select only the current outermost overloaded nodes',
        '2. Emit branch repartition protocol for that layer',
        '3. Refresh triad-map after the patch',
        '4. Recalculate drift and blast radius',
        '5. Repeat until no overloaded layer remains'
    ].join('\n');
}

async function openFile(filePath: string) {
    const command =
        process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args =
        process.platform === 'win32' ? ['/c', 'start', '', filePath] : [filePath];

    const child = spawn(command, args, {
        detached: true,
        stdio: 'ignore'
    });

    child.unref();
}

function normalizeDreamDefaultSubcommandArgv(argv: string[]) {
    if (!Array.isArray(argv) || argv.length < 3) {
        return argv;
    }

    const normalized = [...argv];
    const dreamIndex = normalized.findIndex((value, index) => index >= 2 && value === 'dream');
    if (dreamIndex < 0) {
        return normalized;
    }

    const nextToken = normalized[dreamIndex + 1];
    if (!nextToken) {
        normalized.splice(dreamIndex + 1, 0, 'run');
        return normalized;
    }

    const explicitSubcommands = new Set(['run', 'auto', 'review', 'visualize', 'daemon', 'daemon-loop', 'help']);
    if (explicitSubcommands.has(nextToken) || nextToken === '-h' || nextToken === '--help') {
        return normalized;
    }

    if (nextToken.startsWith('-')) {
        normalized.splice(dreamIndex + 1, 0, 'run');
    }

    return normalized;
}

program.parse(normalizeDreamDefaultSubcommandArgv(process.argv));
