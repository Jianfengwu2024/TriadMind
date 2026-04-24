import * as fs from 'fs';
import * as path from 'path';
import { WorkspacePaths, normalizePath } from './workspace';

const START_MARKER = '<!-- TRIADMIND_RULES_START -->';
const END_MARKER = '<!-- TRIADMIND_RULES_END -->';
const BOOTSTRAP_TEMPLATE_VERSION = '1.0';

type BootstrapTemplateKey =
    | 'agentsManagedBlock'
    | 'skills'
    | 'sessionBootstrapShell'
    | 'sessionBootstrapPs1'
    | 'sessionBootstrapCmd';

interface BootstrapTemplateSet {
    agentsManagedBlock: string;
    skills: string;
    sessionBootstrapShell: string;
    sessionBootstrapPs1: string;
    sessionBootstrapCmd: string;
}

export interface BootstrapScaffoldInitOptions {
    force?: boolean;
    nonInteractive?: boolean;
    triadmindCommand?: string;
}

export interface BootstrapScaffoldFileResult {
    key: 'AGENTS.md' | 'skills.md' | 'session-bootstrap.sh' | 'session-bootstrap.ps1' | 'session-bootstrap.cmd';
    path: string;
    action: 'created' | 'updated' | 'skipped';
    existed: boolean;
    changed: boolean;
    executable: boolean;
    note?: string;
}

export interface BootstrapScaffoldInitResult {
    schemaVersion: '1.0';
    generatedAt: string;
    force: boolean;
    nonInteractive: boolean;
    files: BootstrapScaffoldFileResult[];
}

export interface BootstrapDoctorFileStatus {
    key: 'AGENTS.md' | 'skills.md' | 'session-bootstrap.sh' | 'session-bootstrap.ps1' | 'session-bootstrap.cmd';
    path: string;
    exists: boolean;
    upToDate: boolean;
    executable: boolean;
    status: 'pass' | 'fail';
    message: string;
    recommendedAction?: string;
    version?: string;
}

export interface BootstrapDoctorReport {
    schemaVersion: '1.0';
    generatedAt: string;
    passed: boolean;
    files: BootstrapDoctorFileStatus[];
    summary: {
        passCount: number;
        failCount: number;
    };
}

export class BootstrapScaffoldService {
    init(paths: WorkspacePaths, options: BootstrapScaffoldInitOptions = {}): BootstrapScaffoldInitResult {
        const templates = loadBootstrapTemplates({
            triadmindCommand: normalizeCliCommand(options.triadmindCommand)
        });

        fs.mkdirSync(paths.triadDir, { recursive: true });

        const results: BootstrapScaffoldFileResult[] = [];
        results.push(this.upsertAgentsFile(paths, templates.agentsManagedBlock));
        results.push(
            writeTemplateFile(paths.skillsFile, templates.skills, {
                force: Boolean(options.force),
                key: 'skills.md',
                projectRoot: paths.projectRoot
            })
        );
        results.push(
            writeTemplateFile(paths.sessionBootstrapShellFile, templates.sessionBootstrapShell, {
                force: Boolean(options.force),
                key: 'session-bootstrap.sh',
                executable: true,
                projectRoot: paths.projectRoot
            })
        );
        results.push(
            writeTemplateFile(paths.sessionBootstrapPs1File, templates.sessionBootstrapPs1, {
                force: Boolean(options.force),
                key: 'session-bootstrap.ps1',
                projectRoot: paths.projectRoot
            })
        );
        results.push(
            writeTemplateFile(paths.sessionBootstrapCmdFile, templates.sessionBootstrapCmd, {
                force: Boolean(options.force),
                key: 'session-bootstrap.cmd',
                projectRoot: paths.projectRoot
            })
        );

        return {
            schemaVersion: '1.0',
            generatedAt: new Date().toISOString(),
            force: Boolean(options.force),
            nonInteractive: Boolean(options.nonInteractive),
            files: results
        };
    }

    doctor(paths: WorkspacePaths, options: Pick<BootstrapScaffoldInitOptions, 'triadmindCommand'> = {}): BootstrapDoctorReport {
        const templates = loadBootstrapTemplates({
            triadmindCommand: normalizeCliCommand(options.triadmindCommand)
        });

        const statuses: BootstrapDoctorFileStatus[] = [];
        statuses.push(this.inspectAgents(paths, templates.agentsManagedBlock));
        statuses.push(inspectTemplateFile(paths.skillsFile, templates.skills, 'skills.md', { projectRoot: paths.projectRoot }));
        statuses.push(
            inspectTemplateFile(paths.sessionBootstrapShellFile, templates.sessionBootstrapShell, 'session-bootstrap.sh', {
                requireExecutable: true,
                projectRoot: paths.projectRoot
            })
        );
        statuses.push(
            inspectTemplateFile(paths.sessionBootstrapPs1File, templates.sessionBootstrapPs1, 'session-bootstrap.ps1', {
                projectRoot: paths.projectRoot
            })
        );
        statuses.push(
            inspectTemplateFile(paths.sessionBootstrapCmdFile, templates.sessionBootstrapCmd, 'session-bootstrap.cmd', {
                projectRoot: paths.projectRoot
            })
        );

        const passCount = statuses.filter((status) => status.status === 'pass').length;
        const failCount = statuses.length - passCount;
        return {
            schemaVersion: '1.0',
            generatedAt: new Date().toISOString(),
            passed: failCount === 0,
            files: statuses,
            summary: {
                passCount,
                failCount
            }
        };
    }

    private upsertAgentsFile(paths: WorkspacePaths, managedBlock: string): BootstrapScaffoldFileResult {
        const targetPath = paths.agentsFile;
        const existed = fs.existsSync(targetPath);
        const existing = existed ? fs.readFileSync(targetPath, 'utf-8') : '';
        const next = upsertManagedRulesBlock(existing, managedBlock);

        if (normalizeLineEndings(existing) === normalizeLineEndings(next)) {
            return {
                key: 'AGENTS.md',
                path: normalizePath(path.relative(paths.projectRoot, targetPath)),
                action: 'skipped',
                existed,
                changed: false,
                executable: false
            };
        }

        fs.writeFileSync(targetPath, next, 'utf-8');
        return {
            key: 'AGENTS.md',
            path: normalizePath(path.relative(paths.projectRoot, targetPath)),
            action: existed ? 'updated' : 'created',
            existed,
            changed: true,
            executable: false
        };
    }

    private inspectAgents(paths: WorkspacePaths, managedBlock: string): BootstrapDoctorFileStatus {
        const targetPath = paths.agentsFile;
        const relativePath = toProjectRelativePath(paths.projectRoot, targetPath);
        if (!fs.existsSync(targetPath)) {
            return {
                key: 'AGENTS.md',
                path: relativePath,
                exists: false,
                upToDate: false,
                executable: false,
                status: 'fail',
                message: 'AGENTS.md is missing',
                recommendedAction: 'Run `triadmind bootstrap init`.'
            };
        }

        const content = fs.readFileSync(targetPath, 'utf-8');
        const currentBlock = extractManagedRulesBlock(content);
        if (!currentBlock) {
            return {
                key: 'AGENTS.md',
                path: relativePath,
                exists: true,
                upToDate: false,
                executable: false,
                status: 'fail',
                message: 'Managed rules block is missing in AGENTS.md',
                recommendedAction: 'Run `triadmind bootstrap init` to insert the managed rules block.'
            };
        }

        const upToDate = normalizeLineEndings(currentBlock) === normalizeLineEndings(managedBlock.trim());
        return {
            key: 'AGENTS.md',
            path: relativePath,
            exists: true,
            upToDate,
            executable: false,
            status: upToDate ? 'pass' : 'fail',
            message: upToDate ? 'Managed rules block is present and up to date' : 'Managed rules block is outdated',
            recommendedAction: upToDate ? undefined : 'Run `triadmind bootstrap init`.',
            version: extractBootstrapVersion(currentBlock)
        };
    }
}

function writeTemplateFile(
    targetPath: string,
    content: string,
    options: {
        force: boolean;
        key: BootstrapScaffoldFileResult['key'];
        executable?: boolean;
        projectRoot: string;
    }
): BootstrapScaffoldFileResult {
    const existed = fs.existsSync(targetPath);
    const relativePath = toProjectRelativePath(options.projectRoot, targetPath);
    const shouldSkip = existed && !options.force;
    const existing = existed ? fs.readFileSync(targetPath, 'utf-8') : '';

    if (shouldSkip) {
        return {
            key: options.key,
            path: relativePath,
            action: 'skipped',
            existed,
            changed: false,
            executable: Boolean(options.executable)
        };
    }

    if (existed && normalizeLineEndings(existing) === normalizeLineEndings(content)) {
        ensureExecutable(targetPath, Boolean(options.executable));
        return {
            key: options.key,
            path: relativePath,
            action: 'skipped',
            existed,
            changed: false,
            executable: Boolean(options.executable),
            note: 'Template content already up to date'
        };
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content, 'utf-8');
    ensureExecutable(targetPath, Boolean(options.executable));

    return {
        key: options.key,
        path: relativePath,
        action: existed ? 'updated' : 'created',
        existed,
        changed: true,
        executable: Boolean(options.executable)
    };
}

function inspectTemplateFile(
    targetPath: string,
    expectedContent: string,
    key: BootstrapDoctorFileStatus['key'],
    options: {
        requireExecutable?: boolean;
        projectRoot?: string;
    } = {}
): BootstrapDoctorFileStatus {
    const resolvedPath = options.projectRoot
        ? toProjectRelativePath(options.projectRoot, targetPath)
        : normalizePath(targetPath);
    if (!fs.existsSync(targetPath)) {
        return {
            key,
            path: resolvedPath,
            exists: false,
            upToDate: false,
            executable: false,
            status: 'fail',
            message: `${key} is missing`,
            recommendedAction: 'Run `triadmind bootstrap init`.'
        };
    }

    const current = fs.readFileSync(targetPath, 'utf-8');
    const upToDate = normalizeLineEndings(current) === normalizeLineEndings(expectedContent);
    const executable = !options.requireExecutable || hasExecutableBit(targetPath);
    const status = upToDate && executable ? 'pass' : 'fail';
    const parts: string[] = [];
    if (!upToDate) {
        parts.push('template content is outdated');
    }
    if (!executable) {
        parts.push('missing executable permission');
    }

    return {
        key,
        path: resolvedPath,
        exists: true,
        upToDate,
        executable,
        status,
        message: status === 'pass' ? 'Template is present and up to date' : parts.join('; '),
        recommendedAction:
            status === 'pass'
                ? undefined
                : options.requireExecutable && !executable && upToDate
                  ? `Run \`chmod +x ${normalizePath(targetPath)}\`.`
                  : 'Run `triadmind bootstrap init --force`.',
        version: extractBootstrapVersion(current)
    };
}

function toProjectRelativePath(projectRoot: string, targetPath: string) {
    return normalizePath(path.relative(projectRoot, targetPath));
}

function upsertManagedRulesBlock(existing: string, managedBlock: string) {
    const current = String(existing ?? '');
    const block = managedBlock.trim();
    const pattern = new RegExp(`${escapeRegExp(START_MARKER)}[\\s\\S]*?${escapeRegExp(END_MARKER)}`, 'm');

    if (pattern.test(current)) {
        const replaced = current.replace(pattern, block);
        return replaced.endsWith('\n') ? replaced : `${replaced}\n`;
    }

    const normalized = current.trimEnd();
    const next = normalized ? `${normalized}\n\n${block}\n` : `${block}\n`;
    return next;
}

function extractManagedRulesBlock(content: string) {
    const pattern = new RegExp(`${escapeRegExp(START_MARKER)}[\\s\\S]*?${escapeRegExp(END_MARKER)}`, 'm');
    const match = content.match(pattern);
    return match?.[0]?.trim();
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeLineEndings(content: string) {
    return String(content ?? '').replace(/\r\n/g, '\n').trim();
}

function hasExecutableBit(targetPath: string) {
    if (process.platform === 'win32') {
        return true;
    }

    try {
        const stat = fs.statSync(targetPath);
        return Boolean(stat.mode & 0o111);
    } catch {
        return false;
    }
}

function ensureExecutable(targetPath: string, required: boolean) {
    if (!required || process.platform === 'win32' || !fs.existsSync(targetPath)) {
        return;
    }

    try {
        const stat = fs.statSync(targetPath);
        if ((stat.mode & 0o111) === 0o111) {
            return;
        }
        fs.chmodSync(targetPath, 0o755);
    } catch {
        // ignore chmod failures and let doctor surface this later
    }
}

function normalizeCliCommand(value: string | undefined) {
    const normalized = String(value ?? '').trim();
    return normalized.length > 0 ? normalized : 'triadmind';
}

function extractBootstrapVersion(content: string) {
    const match = String(content ?? '').match(/BOOTSTRAP_VERSION[:=]\s*([0-9.]+)/i);
    return match?.[1] ?? BOOTSTRAP_TEMPLATE_VERSION;
}

function loadBootstrapTemplates(options: { triadmindCommand: string }): BootstrapTemplateSet {
    const variables = {
        BOOTSTRAP_VERSION: BOOTSTRAP_TEMPLATE_VERSION,
        TRIADMIND_COMMAND: options.triadmindCommand
    };
    return {
        agentsManagedBlock: renderTemplate(loadBootstrapTemplateFile('agentsManagedBlock'), variables).trim(),
        skills: renderTemplate(loadBootstrapTemplateFile('skills'), variables),
        sessionBootstrapShell: renderTemplate(loadBootstrapTemplateFile('sessionBootstrapShell'), variables),
        sessionBootstrapPs1: renderTemplate(loadBootstrapTemplateFile('sessionBootstrapPs1'), variables),
        sessionBootstrapCmd: renderTemplate(loadBootstrapTemplateFile('sessionBootstrapCmd'), variables)
    };
}

function loadBootstrapTemplateFile(key: BootstrapTemplateKey) {
    const filenameByKey: Record<BootstrapTemplateKey, string> = {
        agentsManagedBlock: 'agents-managed-block.md',
        skills: 'skills.md',
        sessionBootstrapShell: 'session-bootstrap.sh',
        sessionBootstrapPs1: 'session-bootstrap.ps1',
        sessionBootstrapCmd: 'session-bootstrap.cmd'
    };

    const filename = filenameByKey[key];
    const candidates = [
        path.join(__dirname, 'templates', 'bootstrap', filename),
        path.join(__dirname, '..', 'templates', 'bootstrap', filename)
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return fs.readFileSync(candidate, 'utf-8');
        }
    }

    throw new Error(`Bootstrap template file not found: ${filename}`);
}

function renderTemplate(content: string, variables: Record<string, string>) {
    let rendered = String(content ?? '');
    for (const [key, value] of Object.entries(variables)) {
        const pattern = new RegExp(`{{\\s*${escapeRegExp(key)}\\s*}}`, 'g');
        rendered = rendered.replace(pattern, value);
    }
    return rendered;
}
