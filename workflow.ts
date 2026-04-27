import * as fs from 'fs';
import * as path from 'path';
import { ensureTriadConfig } from './config';
import { ensureGovernPolicyFile } from './governPolicy';
import { analyzeWorkspaceStage } from './stage';
import { readTriadizationConfirmation, TriadizationReport, writeTriadizationArtifacts } from './triadization';
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
    getProtocolOutputContractLines,
    TriadizationFocusSeed
} from './workflowRightBranch';

export { getWorkspacePaths, type WorkspacePaths, type ImplementationHandoffInput } from './workspace';

type PromptTriadizationFocusContext = TriadizationFocusSeed & {
    proposalId: string;
    diagnosis: string[];
    confirmed: boolean;
    confirmationSource?: string;
};

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
    const triadizationReport = writeTriadizationArtifacts(paths);
    ensureMultiPassTemplates(paths, userDemand, {
        resetArtifacts: shouldResetArtifacts,
        triadizationFocus: getTriadizationFocusSeed(triadizationReport)
    });

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
    resetPipelineArtifactsWithFocus(
        paths,
        userDemand,
        getTriadizationFocusSeedFromContext(resolveTriadizationFocusContext(paths))
    );
}

/**
 * @LeftBranch
 */
export function ensurePipelineArtifactSeeds(paths: WorkspacePaths, userDemand: string) {
    ensurePipelineArtifactSeedsWithFocus(
        paths,
        userDemand,
        getTriadizationFocusSeedFromContext(resolveTriadizationFocusContext(paths))
    );
}

/**
 * @LeftBranch
 */
export function buildProtocolPrompt(paths: WorkspacePaths, userDemand: string) {
    const triadSpec = fs.readFileSync(paths.triadSpecFile, 'utf-8').trim();
    const configJson = safeRead(paths.configFile);
    const mapJson = fs.readFileSync(paths.mapFile, 'utf-8').trim();
    const triadizationReportJson = safeRead(paths.triadizationReportFile);
    const triadizationFocus = resolveTriadizationFocusContext(paths, triadizationReportJson);
    const stage = analyzePromptStage(paths, userDemand, triadizationReportJson);
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
        '[Context: Triadization Report JSON]',
        '```json',
        triadizationReportJson || '{}',
        '```',
        '',
        '[Context: Triadization Focus]',
        ...buildTriadizationFocusSummaryLines(triadizationFocus),
        '',
        '[Context: Triadization Focus JSON]',
        '```json',
        buildTriadizationFocusJson(triadizationFocus),
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
        '[Triadization Focus Rules]',
        ...buildTriadizationFocusRuleLines(triadizationFocus),
        '',
        '[Triadization Focus Gate]',
        ...buildTriadizationFocusGateLines(stage),
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
    const triadizationReportJson = safeRead(paths.triadizationReportFile);
    const triadizationFocus = resolveTriadizationFocusContext(paths, triadizationReportJson);
    const stage = analyzePromptStage(paths, userDemand, triadizationReportJson);
    const triadizationTask = safeRead(paths.triadizationTaskFile);

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
        '[Triadization Report JSON]',
        '```json',
        triadizationReportJson || '{}',
        '```',
        '',
        '[Triadization Task]',
        triadizationTask || '当前尚未生成 triadization-task.md',
        '',
        '[Triadization Focus]',
        ...buildTriadizationFocusSummaryLines(triadizationFocus),
        '',
        '[User Demand]',
        JSON.stringify(userDemand.trim()),
        '',
        '[Execution Workflow]',
        ...getImplementationExecutionWorkflowLines(),
        '',
        '[Triadization Focus Rules]',
        ...buildTriadizationFocusRuleLines(triadizationFocus),
        '',
        '[Triadization Focus Gate]',
        ...buildTriadizationFocusGateLines(stage),
        '',
        '[Output Rules]',
        '先指出当前建议三元化的节点，以及推荐动作是 aggregate / split / renormalize 中的哪一种。',
        '先确认这个建议，再进入 Macro / Meso / Micro 三轮拆分。',
        'Macro / Meso / Micro 三轮结果必须显式保留同一个 `triadizationFocus` 与 `recommendedOperation`，不能静默切换。',
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
    const triadizationReportJson = safeRead(paths.triadizationReportFile);
    const triadizationFocus = resolveTriadizationFocusContext(paths, triadizationReportJson);
    const stage = analyzePromptStage(paths, userDemand, triadizationReportJson);
    const triadizationTask = safeRead(paths.triadizationTaskFile);

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
        '[Triadization Report JSON]',
        '```json',
        triadizationReportJson || '{}',
        '```',
        '',
        '[Triadization Task]',
        triadizationTask || '当前尚未生成 triadization-task.md',
        '',
        '[Triadization Focus]',
        ...buildTriadizationFocusSummaryLines(triadizationFocus),
        '',
        '[User Demand]',
        JSON.stringify(userDemand.trim()),
        '',
        '[Pass 0: Triadization Diagnosis]',
        '先指出当前建议三元化的节点，以及推荐动作是 aggregate / split / renormalize 中的哪一种。',
        '先确认该建议，再进入 Macro-Split。',
        '',
        '[Pass 1: Macro-Split]',
        `把需求切成：挂载点、左分支（子功能）、右分支（编排 / 配置）。结果写入 ${normalizePath(paths.macroSplitFile)}。`,
        '输出必须显式填写 `triadizationFocus` 与 `recommendedOperation`，并与当前 focus 保持一致。',
        '',
        '[Pass 2: Meso-Split]',
        `基于 Macro 结果，把子功能切成类与数据管道。结果写入 ${normalizePath(paths.mesoSplitFile)}。`,
        '输出必须继续沿用同一个 `triadizationFocus` 与 `recommendedOperation`，不得漂移。',
        '',
        '[Pass 3: Micro-Split]',
        `基于 Meso 结果，把类切成属性 / 状态和方法 / 动作，并明确 demand / answer。结果写入 ${normalizePath(paths.microSplitFile)}。`,
        '输出必须继续沿用同一个 `triadizationFocus` 与 `recommendedOperation`，并把类级左右分支对齐到该 focus。',
        '',
        '[Final Protocol]',
        `把三轮结果折叠进 ${normalizePath(paths.draftFile)}，并提供可 apply 的 \`actions\`。`,
        '',
        '[Triadization Focus Rules]',
        ...buildTriadizationFocusRuleLines(triadizationFocus),
        '',
        '[Triadization Focus Gate]',
        ...buildTriadizationFocusGateLines(stage),
        '',
        '[Rules]',
        '每一轮都必须继承上一轮，不能跳步。',
        '如果上层拆分不稳定，就不能进入下层。',
        '如果发现需要切换到其他节点或其他动作，必须先停止当前推演并返回 triadization 确认。',
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
    const triadizationReport = safeRead(paths.triadizationReportFile);
    const triadizationTask = safeRead(paths.triadizationTaskFile);
    const pipelinePrompt = safeRead(paths.pipelinePromptFile);
    const approvedProtocol = safeRead(paths.approvedProtocolFile);
    const handoffPrompt = safeRead(paths.handoffPromptFile);
    const applyFilesManifest = safeRead(paths.lastApplyFilesFile);
    const changedFiles = readChangedFiles(paths);
    const triadizationFocus = resolveTriadizationFocusContext(paths, triadizationReport);
    const stage = analyzeWorkspaceStage({
        latestDemand,
        draftProtocol,
        macroSplit,
        mesoSplit,
        microSplit,
        approvedProtocol,
        triadizationReport
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
        '[Triadization Report JSON]',
        '```json',
        triadizationReport || '{}',
        '```',
        '',
        '[Triadization Task]',
        triadizationTask || '当前尚未生成 triadization-task.md',
        '',
        '[Triadization Focus]',
        ...buildTriadizationFocusSummaryLines(triadizationFocus),
        '',
        '[Triadization Focus Rules]',
        ...buildTriadizationFocusRuleLines(triadizationFocus),
        '',
        '[Triadization Focus Gate]',
        ...buildTriadizationFocusGateLines(stage),
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
    options: { resetArtifacts?: boolean; triadizationFocus?: TriadizationFocusSeed } = {}
) {
    const triadizationFocus =
        options.triadizationFocus ?? getTriadizationFocusSeedFromContext(resolveTriadizationFocusContext(paths));
    if (options.resetArtifacts) {
        resetPipelineArtifactsWithFocus(paths, userDemand, triadizationFocus);
    } else {
        ensurePipelineArtifactSeedsWithFocus(paths, userDemand, triadizationFocus);
    }

    fs.writeFileSync(paths.macroPromptFile, buildMacroPrompt(paths, userDemand), 'utf-8');
    fs.writeFileSync(paths.mesoPromptFile, buildMesoPrompt(paths, userDemand), 'utf-8');
    fs.writeFileSync(paths.microPromptFile, buildMicroPrompt(paths, userDemand), 'utf-8');
}

/**
 * @LeftBranch
 */
export function buildMacroPrompt(paths: WorkspacePaths, userDemand: string) {
    const triadizationFocus = resolveTriadizationFocusContext(paths);
    return [
        buildMacroPromptShape(paths, userDemand),
        '',
        '[Triadization Focus]',
        ...buildTriadizationFocusSummaryLines(triadizationFocus),
        '',
        '[Focus Rules]',
        ...buildTriadizationFocusRuleLines(triadizationFocus),
        '',
        '[Required Output Notes]',
        ...buildTriadizationFocusOutputLines(
            triadizationFocus,
            'Macro-Split 必须围绕同一个挂载点候选来展开，不要把 focus 偷偷换成别的节点。'
        )
    ].join('\n');
}

/**
 * @LeftBranch
 */
export function buildMesoPrompt(paths: WorkspacePaths, userDemand: string) {
    const triadizationFocus = resolveTriadizationFocusContext(paths);
    return [
        buildMesoPromptShape(paths, userDemand),
        '',
        '[Triadization Focus]',
        ...buildTriadizationFocusSummaryLines(triadizationFocus),
        '',
        '[Focus Rules]',
        ...buildTriadizationFocusRuleLines(triadizationFocus),
        '',
        '[Required Output Notes]',
        ...buildTriadizationFocusOutputLines(
            triadizationFocus,
            'Meso-Split 中的类与数据管道必须解释为同一 triadization focus 服务，而不是横向扩题。'
        )
    ].join('\n');
}

/**
 * @LeftBranch
 */
export function buildMicroPrompt(paths: WorkspacePaths, userDemand: string) {
    const triadizationFocus = resolveTriadizationFocusContext(paths);
    return [
        buildMicroPromptShape(paths, userDemand),
        '',
        '[Triadization Focus]',
        ...buildTriadizationFocusSummaryLines(triadizationFocus),
        '',
        '[Focus Rules]',
        ...buildTriadizationFocusRuleLines(triadizationFocus),
        '',
        '[Required Output Notes]',
        ...buildTriadizationFocusOutputLines(
            triadizationFocus,
            'Micro-Split 中的静态右支与动态左支必须共同完成同一 triadization focus，不能拆成无关职责。'
        )
    ].join('\n');
}

function resetPipelineArtifactsWithFocus(
    paths: WorkspacePaths,
    userDemand: string,
    triadizationFocus?: TriadizationFocusSeed
) {
    fs.writeFileSync(
        paths.macroSplitFile,
        JSON.stringify(createMacroSplitSeed(userDemand, triadizationFocus), null, 2),
        'utf-8'
    );
    fs.writeFileSync(
        paths.mesoSplitFile,
        JSON.stringify(createMesoSplitSeed(triadizationFocus), null, 2),
        'utf-8'
    );
    fs.writeFileSync(
        paths.microSplitFile,
        JSON.stringify(createMicroSplitSeed(triadizationFocus), null, 2),
        'utf-8'
    );
}

function ensurePipelineArtifactSeedsWithFocus(
    paths: WorkspacePaths,
    userDemand: string,
    triadizationFocus?: TriadizationFocusSeed
) {
    writeJsonSeedIfMissing(paths.macroSplitFile, createMacroSplitSeed(userDemand, triadizationFocus));
    writeJsonSeedIfMissing(paths.mesoSplitFile, createMesoSplitSeed(triadizationFocus));
    writeJsonSeedIfMissing(paths.microSplitFile, createMicroSplitSeed(triadizationFocus));
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

function analyzePromptStage(
    paths: WorkspacePaths,
    userDemand: string,
    triadizationReportJson = safeRead(paths.triadizationReportFile)
) {
    return analyzeWorkspaceStage({
        latestDemand: userDemand.trim(),
        draftProtocol: safeRead(paths.draftFile),
        macroSplit: safeRead(paths.macroSplitFile),
        mesoSplit: safeRead(paths.mesoSplitFile),
        microSplit: safeRead(paths.microSplitFile),
        approvedProtocol: safeRead(paths.approvedProtocolFile),
        triadizationReport: triadizationReportJson
    });
}

function safeRead(filePath: string) {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8').trim() : '';
}

function safeParseJson<T>(content: string): T | undefined {
    if (!content.trim()) {
        return undefined;
    }

    try {
        return JSON.parse(content) as T;
    } catch {
        return undefined;
    }
}

function getTriadizationFocusSeed(report?: TriadizationReport): TriadizationFocusSeed | undefined {
    const proposal = report?.primaryProposal;
    if (!proposal) {
        return undefined;
    }

    return {
        triadizationFocus: proposal.targetNodeId,
        recommendedOperation: proposal.recommendedOperation
    };
}

function getTriadizationFocusSeedFromContext(
    context?: PromptTriadizationFocusContext
): TriadizationFocusSeed | undefined {
    if (!context) {
        return undefined;
    }

    return {
        triadizationFocus: context.triadizationFocus,
        recommendedOperation: context.recommendedOperation
    };
}

function resolveTriadizationFocusContext(
    paths: WorkspacePaths,
    triadizationReportJson = safeRead(paths.triadizationReportFile)
) {
    const report = safeParseJson<TriadizationReport>(triadizationReportJson);
    const proposal = report?.primaryProposal;
    if (!proposal || typeof proposal.targetNodeId !== 'string' || typeof proposal.recommendedOperation !== 'string') {
        return undefined;
    }

    const confirmation = readTriadizationConfirmation(paths);
    const confirmed = confirmation?.proposalId === proposal.proposalId;

    return {
        proposalId: proposal.proposalId,
        triadizationFocus: proposal.targetNodeId,
        recommendedOperation: proposal.recommendedOperation,
        diagnosis: Array.isArray(proposal.diagnosis)
            ? proposal.diagnosis.map((item) => String(item).trim()).filter(Boolean)
            : [],
        confirmed,
        confirmationSource: confirmed ? confirmation?.source : undefined
    } satisfies PromptTriadizationFocusContext;
}

function buildTriadizationFocusSummaryLines(context?: PromptTriadizationFocusContext) {
    if (!context) {
        return ['状态：未检测到 triadization focus。', '请先运行 triadmind triadize，并确认当前顶点三元化焦点。'];
    }

    return [
        context.confirmed
            ? `状态：已确认（来源：${context.confirmationSource ?? 'unknown'}）`
            : '状态：主提案已生成，但尚未确认。',
        `焦点：${context.triadizationFocus} -> ${context.recommendedOperation}`,
        `诊断：${context.diagnosis.join(', ') || 'none'}`
    ];
}

function buildTriadizationFocusJson(context?: PromptTriadizationFocusContext) {
    if (!context) {
        return JSON.stringify(
            {
                triadizationFocus: '',
                recommendedOperation: '',
                confirmed: false,
                diagnosis: []
            },
            null,
            2
        );
    }

    return JSON.stringify(
        {
            triadizationFocus: context.triadizationFocus,
            recommendedOperation: context.recommendedOperation,
            confirmed: context.confirmed,
            diagnosis: context.diagnosis
        },
        null,
        2
    );
}

function buildTriadizationFocusRuleLines(context?: PromptTriadizationFocusContext) {
    if (!context) {
        return [
            '没有明确 triadization focus 时，不要擅自生成新的 Macro / Meso / Micro / Protocol 结果。',
            '先回到 triadization 对话，确认当前节点与 recommendedOperation。'
        ];
    }

    const exactFocus = `\`${context.triadizationFocus}\` -> \`${context.recommendedOperation}\``;
    const lines = [
        `后续 Macro / Meso / Micro / Protocol 必须显式引用当前 focus ${exactFocus}。`,
        `不得把焦点切换到其他节点，不得把动作从 \`${context.recommendedOperation}\` 静默改成别的操作。`,
        '如果发现必须切换节点或动作，先停止当前推演，返回 triadization 对话重新确认。'
    ];

    if (context.confirmed) {
        lines.push('由于该 focus 已确认，后续三轮拆分应把它当作本轮唯一有效演进主线。');
    } else {
        lines.push('由于该 focus 尚未确认，后续拆分只能作为围绕该主提案的候选方案，不能当作已批准事实。');
    }

    return lines;
}

function buildTriadizationFocusGateLines(stage: ReturnType<typeof analyzeWorkspaceStage>) {
    const lines = [`status: ${stage.triadizationFocusGateStatus}`];

    if (stage.triadizationFocusGateKind) {
        lines.push(`failureKind: ${stage.triadizationFocusGateKind}`);
    }
    if (stage.triadizationFocusGateSummary) {
        lines.push(`summary: ${stage.triadizationFocusGateSummary}`);
    }
    if (stage.triadizationFocusGateRepairTarget) {
        lines.push(`repairTarget: ${stage.triadizationFocusGateRepairTarget}`);
    }

    stage.triadizationFocusGateDetails.slice(0, 4).forEach((detail, index) => {
        lines.push(`detail${index + 1}: ${detail}`);
    });

    return lines;
}

function buildTriadizationFocusOutputLines(
    context: PromptTriadizationFocusContext | undefined,
    stageSpecificRule: string
) {
    const lines = ['输出 JSON 必须显式包含 `triadizationFocus` 与 `recommendedOperation`。', stageSpecificRule];
    if (!context) {
        lines.push('如果当前没有 focus，就保持这两个字段为空字符串，并先回到 triadization 诊断阶段。');
        return lines;
    }

    lines.push(`其中 \`triadizationFocus\` 必须等于 \`${context.triadizationFocus}\`。`);
    lines.push(`其中 \`recommendedOperation\` 必须等于 \`${context.recommendedOperation}\`。`);
    return lines;
}

function writeJsonSeedIfMissing(filePath: string, seed: unknown) {
    if (fs.existsSync(filePath)) {
        return;
    }

    fs.writeFileSync(filePath, JSON.stringify(seed, null, 2), 'utf-8');
}
