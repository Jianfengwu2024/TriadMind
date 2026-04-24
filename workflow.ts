import * as fs from 'fs';
import * as path from 'path';
import { ensureTriadConfig } from './config';
import { ensureGovernPolicyFile } from './governPolicy';
import { analyzeWorkspaceStage } from './stage';
import { getWorkspacePaths, ImplementationHandoffInput, normalizePath, WorkspacePaths } from './workspace';
import {
    buildMacroPromptShape,
    buildMesoPromptShape,
    buildMicroPromptShape,
    buildTriadSpecDocument,
    createDraftProtocolTemplate,
    createMacroSplitSeed,
    createMesoSplitSeed,
    createMicroSplitSeed,
    getImplementationExecutionWorkflowLines,
    getImplementationHandoffRuleLines,
    getMasterPromptExpectedBehaviorLines,
    getMasterPromptImplementationPhaseLines,
    getMasterPromptProtocolPhaseLines,
    getMasterPromptStageRouterLines,
    getProtocolOutputContractLines
} from './workflowRightBranch';

export { getWorkspacePaths, type WorkspacePaths, type ImplementationHandoffInput } from './workspace';

/**
 * @LeftBranch
 */
export function ensureTriadSpec(paths: WorkspacePaths, force = false) {
    fs.mkdirSync(paths.triadDir, { recursive: true });
    ensureTriadConfig(paths);
    ensureGovernPolicyFile(paths);

    if (force || !fs.existsSync(paths.triadSpecFile)) {
        fs.writeFileSync(paths.triadSpecFile, buildTriadSpec(paths.projectRoot), 'utf-8');
    }
}

/**
 * @LeftBranch
 */
export function createDraftTemplate(paths: WorkspacePaths, userDemand = '', force = false) {
    fs.mkdirSync(paths.triadDir, { recursive: true });

    if (!force && fs.existsSync(paths.draftFile)) {
        return;
    }

    fs.writeFileSync(
        paths.draftFile,
        JSON.stringify(createDraftProtocolTemplate(paths.projectRoot, paths.mapFile, userDemand), null, 2),
        'utf-8'
    );
}

/**
 * @LeftBranch
 */
export function writePromptPacket(paths: WorkspacePaths, userDemand: string) {
    ensureTriadSpec(paths, true);

    if (!fs.existsSync(paths.mapFile)) {
        throw new Error(`Cannot find triad-map.json: ${paths.mapFile}`);
    }

    const normalizedDemand = userDemand.trim();
    const previousDemand = safeRead(paths.demandFile);
    const shouldResetArtifacts = previousDemand.length > 0 && previousDemand !== normalizedDemand;

    createDraftTemplate(paths, userDemand, shouldResetArtifacts);
    ensureMultiPassTemplates(paths, userDemand, { resetArtifacts: shouldResetArtifacts });

    const protocolPrompt = buildProtocolPrompt(paths, userDemand);
    const implementationPrompt = buildImplementationPrompt(paths, userDemand);
    const pipelinePrompt = buildPipelinePrompt(paths, userDemand);

    fs.writeFileSync(paths.promptFile, protocolPrompt, 'utf-8');
    fs.writeFileSync(paths.protocolTaskFile, protocolPrompt, 'utf-8');
    fs.writeFileSync(paths.pipelinePromptFile, pipelinePrompt, 'utf-8');
    fs.writeFileSync(paths.implementationPromptFile, implementationPrompt, 'utf-8');
    fs.writeFileSync(paths.demandFile, normalizedDemand, 'utf-8');

    writeMasterPrompt(paths);
}

/**
 * @LeftBranch
 */
export function resetPipelineArtifacts(paths: WorkspacePaths, userDemand: string) {
    fs.writeFileSync(paths.macroSplitFile, JSON.stringify(createMacroSplitSeed(userDemand), null, 2), 'utf-8');
    fs.writeFileSync(paths.mesoSplitFile, JSON.stringify(createMesoSplitSeed(), null, 2), 'utf-8');
    fs.writeFileSync(paths.microSplitFile, JSON.stringify(createMicroSplitSeed(), null, 2), 'utf-8');
}

/**
 * @LeftBranch
 */
export function ensurePipelineArtifactSeeds(paths: WorkspacePaths, userDemand: string) {
    writeJsonSeedIfMissing(paths.macroSplitFile, createMacroSplitSeed(userDemand));
    writeJsonSeedIfMissing(paths.mesoSplitFile, createMesoSplitSeed());
    writeJsonSeedIfMissing(paths.microSplitFile, createMicroSplitSeed());
}

/**
 * @LeftBranch
 */
export function buildProtocolPrompt(paths: WorkspacePaths, userDemand: string) {
    const triadSpec = fs.readFileSync(paths.triadSpecFile, 'utf-8').trim();
    const configJson = safeRead(paths.configFile);
    const mapJson = fs.readFileSync(paths.mapFile, 'utf-8').trim();
    const macroJson = safeRead(paths.macroSplitFile);
    const mesoJson = safeRead(paths.mesoSplitFile);
    const microJson = safeRead(paths.microSplitFile);

    return [
        '[System]',
        triadSpec,
        '',
        '[Context: Project Root]',
        normalizePath(paths.projectRoot),
        '',
        '[Context: Triad Map Path]',
        normalizePath(paths.mapFile),
        '',
        '[Context: Triad Config JSON]',
        '```json',
        configJson || '{}',
        '```',
        '',
        '[Context: Triad Map JSON]',
        '```json',
        mapJson,
        '```',
        '',
        '[Context: Macro Split JSON]',
        '```json',
        macroJson || '{}',
        '```',
        '',
        '[Context: Meso Split JSON]',
        '```json',
        mesoJson || '{}',
        '```',
        '',
        '[Context: Micro Split JSON]',
        '```json',
        microJson || '{}',
        '```',
        '',
        '[User Demand]',
        JSON.stringify(userDemand.trim()),
        '',
        '[Output Contract]',
        ...getProtocolOutputContractLines()
    ].join('\n');
}

/**
 * @LeftBranch
 */
export function buildImplementationPrompt(paths: WorkspacePaths, userDemand: string) {
    const triadSpec = fs.readFileSync(paths.triadSpecFile, 'utf-8').trim();
    const configJson = safeRead(paths.configFile);
    const mapJson = fs.readFileSync(paths.mapFile, 'utf-8').trim();

    return [
        '[System]',
        '你是一个严格遵守顶点三元法的软件实现助手。',
        '在真正写代码之前，你必须先完成一个内置子任务：生成拓扑升级协议。',
        '协议生成不是独立流程，而是实现流程的第一阶段。',
        '',
        '[Triad Spec]',
        triadSpec,
        '',
        '[Project Root]',
        normalizePath(paths.projectRoot),
        '',
        '[Triad Map Path]',
        normalizePath(paths.mapFile),
        '',
        '[Triad Config JSON]',
        '```json',
        configJson || '{}',
        '```',
        '',
        '[Triad Map JSON]',
        '```json',
        mapJson,
        '```',
        '',
        '[User Demand]',
        JSON.stringify(userDemand.trim()),
        '',
        '[Execution Workflow]',
        ...getImplementationExecutionWorkflowLines(),
        '',
        '[Output Rules]',
        '先给出 Macro / Meso / Micro 三轮拆分结果。',
        '再给出 `draft-protocol.json` 的严格 JSON 内容。',
        '再给出简洁实现计划。',
        '如果当前就在编码环境中工作，应先把协议写入 `.triadmind/draft-protocol.json`。',
        '如果协议尚未确认，就停在协议阶段，不要跳过 visualizer 审核。'
    ].join('\n');
}

/**
 * @LeftBranch
 */
export function buildPipelinePrompt(paths: WorkspacePaths, userDemand: string) {
    const triadSpec = fs.readFileSync(paths.triadSpecFile, 'utf-8').trim();
    const mapJson = fs.readFileSync(paths.mapFile, 'utf-8').trim();

    return [
        '[System]',
        '你是 TriadMind 的多轮推演调度器。',
        '你不能一次性直接想出最终协议；你必须按 Macro-Split、Meso-Split、Micro-Split 三轮顺序推演。',
        '',
        '[Triad Spec]',
        triadSpec,
        '',
        '[Project Root]',
        normalizePath(paths.projectRoot),
        '',
        '[Triad Map JSON]',
        '```json',
        mapJson,
        '```',
        '',
        '[User Demand]',
        JSON.stringify(userDemand.trim()),
        '',
        '[Pass 1: Macro-Split]',
        `把需求切成：挂载点、左分支（子功能）、右分支（编排 / 配置）。结果写入 ${normalizePath(paths.macroSplitFile)}。`,
        '',
        '[Pass 2: Meso-Split]',
        `基于 Macro 结果，把子功能切成类与数据管道。结果写入 ${normalizePath(paths.mesoSplitFile)}。`,
        '',
        '[Pass 3: Micro-Split]',
        `基于 Meso 结果，把类切成属性 / 状态和方法 / 动作，并明确 demand / answer。结果写入 ${normalizePath(paths.microSplitFile)}。`,
        '',
        '[Final Protocol]',
        `把三轮结果折叠进 ${normalizePath(paths.draftFile)}，并提供可 apply 的 \`actions\`。`,
        '',
        '[Rules]',
        '每一轮都必须继承上一轮，不能跳步。',
        '如果上层拆分不稳定，就不能进入下层。',
        '最终协议必须包含 `macroSplit`、`mesoSplit`、`microSplit`、`actions`。'
    ].join('\n');
}

/**
 * @LeftBranch
 */
export function writeImplementationHandoff(paths: WorkspacePaths, input: ImplementationHandoffInput) {
    const triadSpec = fs.readFileSync(paths.triadSpecFile, 'utf-8').trim();
    const prompt = buildImplementationHandoffPrompt(paths, triadSpec, input);

    fs.writeFileSync(paths.handoffPromptFile, prompt, 'utf-8');
    fs.writeFileSync(
        paths.lastApplyFilesFile,
        JSON.stringify(
            {
                generatedAt: new Date().toISOString(),
                files: input.changedFiles.map((file) => file.path)
            },
            null,
            2
        ),
        'utf-8'
    );

    writeMasterPrompt(paths);
}

/**
 * @LeftBranch
 */
export function writeMasterPrompt(paths: WorkspacePaths) {
    ensureTriadSpec(paths, true);
    fs.writeFileSync(paths.masterPromptFile, buildMasterPrompt(paths), 'utf-8');
}

/**
 * @LeftBranch
 */
export function buildMasterPrompt(paths: WorkspacePaths) {
    const triadSpec = safeRead(paths.triadSpecFile);
    const triadConfig = safeRead(paths.configFile);
    const triadMap = safeRead(paths.mapFile);
    const latestDemand = safeRead(paths.demandFile);
    const draftProtocol = safeRead(paths.draftFile);
    const macroSplit = safeRead(paths.macroSplitFile);
    const mesoSplit = safeRead(paths.mesoSplitFile);
    const microSplit = safeRead(paths.microSplitFile);
    const pipelinePrompt = safeRead(paths.pipelinePromptFile);
    const approvedProtocol = safeRead(paths.approvedProtocolFile);
    const handoffPrompt = safeRead(paths.handoffPromptFile);
    const applyFilesManifest = safeRead(paths.lastApplyFilesFile);
    const changedFiles = readChangedFiles(paths);
    const stage = analyzeWorkspaceStage({
        latestDemand,
        draftProtocol,
        macroSplit,
        mesoSplit,
        microSplit,
        approvedProtocol
    });

    const changedFilesSection =
        changedFiles.length === 0
            ? '当前没有记录到最近一次 apply 直接涉及的骨架文件。'
            : changedFiles
                  .map((file: string) => {
                      const fullPath = path.join(paths.projectRoot, file);
                      const content = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf-8').trim() : '';
                      return [`[Changed File] ${normalizePath(file)}`, '```ts', content, '```'].join('\n');
                  })
                  .join('\n\n');

    return [
        '[System]',
        '你是 TriadMind 工作流的统一入口助手。',
        '你必须先判断当前所处阶段，再决定是继续协议规划，还是进入批准后的实现阶段。',
        '协议没有被确认前，不允许直接跳过 visualizer 去写最终实现。',
        '',
        '[Current Stage]',
        stage.currentStage,
        '',
        '[Triad Spec]',
        triadSpec || '未找到 triad.md',
        '',
        '[Project Root]',
        normalizePath(paths.projectRoot),
        '',
        '[Triad Config JSON]',
        '```json',
        triadConfig || '{}',
        '```',
        '',
        '[Latest User Demand]',
        latestDemand ? JSON.stringify(latestDemand.trim()) : '""',
        '',
        '[Triad Map JSON]',
        '```json',
        triadMap || '[]',
        '```',
        '',
        '[Draft Protocol JSON]',
        '```json',
        draftProtocol || '{}',
        '```',
        '',
        '[Macro Split JSON]',
        '```json',
        macroSplit || '{}',
        '```',
        '',
        '[Meso Split JSON]',
        '```json',
        mesoSplit || '{}',
        '```',
        '',
        '[Micro Split JSON]',
        '```json',
        microSplit || '{}',
        '```',
        '',
        '[Approved Protocol JSON]',
        '```json',
        approvedProtocol || '{}',
        '```',
        '',
        '[Last Apply Files]',
        '```json',
        applyFilesManifest || '{"files":[]}',
        '```',
        '',
        '[Changed Skeleton Files]',
        changedFilesSection,
        '',
        '[Stage Router]',
        ...getMasterPromptStageRouterLines(),
        '',
        '[Protocol Phase Rules]',
        ...getMasterPromptProtocolPhaseLines(),
        '',
        '[Implementation Phase Rules]',
        ...getMasterPromptImplementationPhaseLines(),
        '',
        '[Multi-pass Pipeline Prompt]',
        pipelinePrompt || '当前尚未生成 multi-pass-pipeline.md',
        '',
        '[Handoff Prompt]',
        handoffPrompt || '当前尚未生成 implementation-handoff.md',
        '',
        '[Expected Behavior]',
        ...getMasterPromptExpectedBehaviorLines()
    ].join('\n');
}

/**
 * @LeftBranch
 */
export function buildImplementationHandoffPrompt(
    paths: WorkspacePaths,
    triadSpec: string,
    input: ImplementationHandoffInput
) {
    const changedFilesSection =
        input.changedFiles.length === 0
            ? '当前没有检测到本轮 apply 直接涉及的骨架文件，请优先从 `last-approved-protocol.json` 对应的节点文件开始实现。'
            : input.changedFiles
                  .map((file: { path: string; content: string }) =>
                      [`[Skeleton File] ${file.path}`, '```ts', file.content.trim(), '```'].join('\n')
                  )
                  .join('\n\n');

    return [
        '[System]',
        '你现在处于顶点三元法工作流的第二阶段：协议已通过审核，骨架代码已落地。',
        '你的任务不再是重新设计拓扑，而是在已批准拓扑内，基于骨架代码完成具体实现。',
        '',
        '[Triad Spec]',
        triadSpec,
        '',
        '[Project Root]',
        normalizePath(paths.projectRoot),
        '',
        '[User Demand]',
        JSON.stringify(input.userDemand.trim()),
        '',
        '[Approved Protocol JSON]',
        '```json',
        input.approvedProtocolJson.trim(),
        '```',
        '',
        '[Updated Triad Map JSON]',
        '```json',
        input.triadMapJson.trim(),
        '```',
        '',
        '[Skeleton Files]',
        changedFilesSection,
        '',
        '[Implementation Rules]',
        ...getImplementationHandoffRuleLines(),
        '',
        '[Expected Output]',
        '先给出简洁实现计划。',
        '然后基于现有骨架代码完成实现。',
        '完成后总结修改了哪些文件，以及这些修改如何对应已批准协议。'
    ].join('\n');
}

function buildTriadSpec(projectRoot: string) {
    return buildTriadSpecDocument(path.basename(projectRoot));
}

/**
 * @LeftBranch
 */
export function ensureMultiPassTemplates(
    paths: WorkspacePaths,
    userDemand: string,
    options: { resetArtifacts?: boolean } = {}
) {
    if (options.resetArtifacts) {
        resetPipelineArtifacts(paths, userDemand);
    } else {
        ensurePipelineArtifactSeeds(paths, userDemand);
    }

    fs.writeFileSync(paths.macroPromptFile, buildMacroPrompt(paths, userDemand), 'utf-8');
    fs.writeFileSync(paths.mesoPromptFile, buildMesoPrompt(paths, userDemand), 'utf-8');
    fs.writeFileSync(paths.microPromptFile, buildMicroPrompt(paths, userDemand), 'utf-8');
}

/**
 * @LeftBranch
 */
export function buildMacroPrompt(paths: WorkspacePaths, userDemand: string) {
    return buildMacroPromptShape(paths, userDemand);
}

/**
 * @LeftBranch
 */
export function buildMesoPrompt(paths: WorkspacePaths, userDemand: string) {
    return buildMesoPromptShape(paths, userDemand);
}

/**
 * @LeftBranch
 */
export function buildMicroPrompt(paths: WorkspacePaths, userDemand: string) {
    return buildMicroPromptShape(paths, userDemand);
}

function readChangedFiles(paths: WorkspacePaths) {
    if (!fs.existsSync(paths.lastApplyFilesFile)) {
        return [] as string[];
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(paths.lastApplyFilesFile, 'utf-8'));
        return Array.isArray(parsed.files)
            ? parsed.files.filter((item: unknown): item is string => typeof item === 'string')
            : [];
    } catch {
        return [];
    }
}

function safeRead(filePath: string) {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8').trim() : '';
}

function writeJsonSeedIfMissing(filePath: string, seed: unknown) {
    if (fs.existsSync(filePath)) {
        return;
    }

    fs.writeFileSync(filePath, JSON.stringify(seed, null, 2), 'utf-8');
}
