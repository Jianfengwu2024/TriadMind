import { Command } from 'commander';
import inquirer from 'inquirer';
import open from 'open';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { getAvailableAdapters, resolveAdapter } from './adapter';
import { loadTriadConfig } from './config';
import { generateDashboard } from './visualizer';
import { assertProtocolShape, readJsonFile, readTriadMap, UpgradeProtocol } from './protocol';
import { prepareHealingArtifacts } from './healing';
import { installAlwaysOnRules } from './rules';
import { collectProtocolSnapshotFiles, createSnapshot, listSnapshots, restoreSnapshot } from './snapshot';
import { syncTriadMap, watchTriadMap } from './sync';
import { writeSelfBootstrapProtocol, writeSelfBootstrapReport } from './bootstrap';
import {
    createDraftTemplate,
    ensureTriadSpec,
    getWorkspacePaths,
    writeMasterPrompt,
    writeImplementationHandoff,
    writePromptPacket
} from './workflow';

const program = new Command();

program.name('triadmind').description('TriadMind：顶点三元法驱动的项目拓扑规划与骨架生成工具').version('1.2.0');

program
    .command('init')
    .description('初始化目标项目的 `.triadmind` 工作区，并重新生成 `triad-map.json`')
    .action(() => {
        const paths = getWorkspacePaths(process.cwd());

        console.log(chalk.cyan('🧭 [TriadMind] 正在初始化工作区...'));
        ensureTriadSpec(paths);
        syncProjectTopology(paths, true);
        installAlwaysOnRules(paths);
        writeMasterPrompt(paths);

        console.log(chalk.green(`✅ triad-map 已同步到 ${paths.mapFile}`));
        console.log(chalk.green(`✅ triad.md 已写入 ${paths.triadSpecFile}`));
        console.log(chalk.green(`✅ master-prompt 已写入 ${paths.masterPromptFile}`));
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
    .action((options: { force?: boolean }) => {
        const paths = getWorkspacePaths(process.cwd());
        ensureTriadSpec(paths);
        syncProjectTopology(paths, Boolean(options.force));
    });

program
    .command('watch')
    .description('Watch source files and keep triad-map synchronized')
    .action(() => {
        const paths = getWorkspacePaths(process.cwd());
        ensureTriadSpec(paths);
        watchTriadMap(paths);
    });

program
    .command('plan')
    .description('读取 `draft-protocol.json`，生成 `visualizer.html`，并在确认后落地骨架代码')
    .option('--apply', '跳过交互确认，直接执行 apply')
    .option('--no-open', '仅生成 `visualizer.html`，不自动打开浏览器')
    .action(async (options: { apply?: boolean; open?: boolean }) => {
        const paths = getWorkspacePaths(process.cwd());

        console.log(chalk.cyan('🗺️ [TriadMind] 正在准备拓扑升级演化视图...'));

        ensureTriadSpec(paths);

        if (!fs.existsSync(paths.mapFile)) {
            console.log(chalk.yellow('ℹ️ `triad-map.json` 不存在，先执行一次自动扫描。'));
            syncProjectTopology(paths);
        }

        if (!fs.existsSync(paths.draftFile)) {
            createDraftTemplate(paths);
            console.log(chalk.yellow(`📝 未找到 draft-protocol.json，已生成模板：${paths.draftFile}`));
            console.log(chalk.yellow(`➡️ 请先用 ${paths.promptFile} 让 AI 生成协议，然后重试。`));
            return;
        }

        try {
            validateDraftProtocol(paths);
        } catch (error: any) {
            console.log(chalk.red(`Draft protocol validation failed: ${error.message}`));
            process.exitCode = 1;
            return;
        }

        generateDashboard(paths.mapFile, paths.draftFile, paths.visualizerFile);
        console.log(chalk.green(`✅ 演化视图已生成：${paths.visualizerFile}`));

        if (options.open !== false) {
            try {
                await open(paths.visualizerFile);
            } catch (error: any) {
                console.log(chalk.yellow(`📝 自动打开浏览器失败：${error.message}`));
            }
        }

        let shouldApply = Boolean(options.apply);
        if (!shouldApply) {
            const answer = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'confirm',
                    message: '确认当前拓扑挂载点正确，并开始生成 / 更新骨架代码吗？',
                    default: false
                }
            ]);

            shouldApply = answer.confirm;
        }

        if (!shouldApply) {
            console.log(chalk.red('🛑 已取消 apply，代码未修改。'));
            return;
        }

        executeApply(paths.projectRoot);
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
    .command('apply')
    .description('直接执行 `draft-protocol.json`，生成 / 更新骨架并刷新 `triad-map.json`')
    .action(() => {
        const paths = getWorkspacePaths(process.cwd());

        if (!fs.existsSync(paths.draftFile)) {
            console.log(chalk.red(`❌ 未找到协议文件：${paths.draftFile}`));
            process.exitCode = 1;
            return;
        }

        executeApply(paths.projectRoot);
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

function executeApply(projectRoot: string) {
    const paths = getWorkspacePaths(projectRoot);

    try {
        if (!fs.existsSync(paths.mapFile)) {
            syncProjectTopology(paths);
        }

        const protocol = validateDraftProtocol(paths);
        const snapshot = createSnapshot(paths, 'before-apply', collectProtocolSnapshotFiles(paths, protocol));
        console.log(chalk.gray(`   - [Snapshot] created ${snapshot.id}`));
        console.log(chalk.cyan('🛠️ [TriadMind] 正在执行协议并生成骨架代码...'));
        const approvedProtocolJson = JSON.stringify(protocol, null, 2);
        fs.writeFileSync(paths.approvedProtocolFile, approvedProtocolJson, 'utf-8');

        const result = applyUpgradeProtocol(projectRoot, paths.draftFile);
        syncProjectTopology(paths, true);
        writeHandoffPrompt(projectRoot, result.changedFiles, approvedProtocolJson);

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

function syncProjectTopology(paths: ReturnType<typeof getWorkspacePaths>, force = false) {
    return syncTriadMap(paths, force);
}

function applyUpgradeProtocol(projectRoot: string, protocolPath?: string) {
    const adapter = resolveAdapter(projectRoot);
    return adapter.applyUpgradeProtocol(projectRoot, protocolPath);
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
    return assertProtocolShape(protocol, {
        existingNodes,
        minConfidence: config.protocol.minConfidence,
        requireConfidence: config.protocol.requireConfidence
    });
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

program.parse(process.argv);
