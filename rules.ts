import * as fs from 'fs';
import * as path from 'path';
import { normalizePath, WorkspacePaths } from './workspace';

const START_MARKER = '<!-- TRIADMIND_RULES_START -->';
const END_MARKER = '<!-- TRIADMIND_RULES_END -->';

export function installAlwaysOnRules(paths: WorkspacePaths) {
    fs.mkdirSync(paths.triadDir, { recursive: true });
    fs.mkdirSync(paths.cursorRulesDir, { recursive: true });

    const agentRules = buildAgentRules(paths);
    fs.writeFileSync(paths.agentRulesFile, agentRules, 'utf-8');
    upsertAgentsMd(paths.agentsFile, agentRules);
    fs.writeFileSync(paths.cursorRuleFile, buildCursorRule(paths), 'utf-8');
}

function buildAgentRules(paths: WorkspacePaths) {
    return [
        START_MARKER,
        '# TriadMind Always-On Rules',
        '',
        `- Before answering architecture questions, read \`${normalizePath(path.relative(paths.projectRoot, paths.mapFile))}\`.`,
        `- Before generating or modifying code, read \`${normalizePath(path.relative(paths.projectRoot, paths.configFile))}\` and \`${normalizePath(path.relative(paths.projectRoot, paths.masterPromptFile))}\`.`,
        '- Do not jump straight into implementation when a topology upgrade is required.',
        '- Prefer the TriadMind sequence: Macro -> Meso -> Micro -> draft-protocol -> visualizer -> apply -> handoff.',
        '- If the user message starts with `@triadmind`, treat it as a TriadMind directive.',
        '- If the body is a control command like `init`, `macro`, `meso`, `micro`, `finalize`, `plan`, `apply`, `renormalize`, `heal`, or `handoff`, route to the matching TriadMind lifecycle action.',
        '- Otherwise, treat it as a silent topology-upgrade demand: run the full protocol workflow first, then continue to apply and handoff.',
        '- Use `reuse` first, then `modify`, and only use `create_child` when the current leaf node cannot safely absorb the new responsibility.',
        '- If a runtime error occurs, prefer generating a repair protocol via `.triadmind/healing-prompt.md` instead of ad-hoc code edits.',
        END_MARKER,
        ''
    ].join('\n');
}

function buildCursorRule(paths: WorkspacePaths) {
    return `---
description: TriadMind always-on architecture guard
alwaysApply: true
---

Before answering architecture questions, read \`${normalizePath(path.relative(paths.projectRoot, paths.mapFile))}\`.
Before generating or changing code, read \`${normalizePath(path.relative(paths.projectRoot, paths.configFile))}\` and \`${normalizePath(path.relative(paths.projectRoot, paths.masterPromptFile))}\`.
When a feature changes topology, do not skip protocol design. Follow:
Macro -> Meso -> Micro -> draft-protocol -> visualizer -> apply -> handoff.
If the user message starts with \`@triadmind\`, treat it as a TriadMind directive.
If it is a control command like \`init\`, \`macro\`, \`meso\`, \`micro\`, \`finalize\`, \`plan\`, \`apply\`, \`renormalize\`, \`heal\`, or \`handoff\`, route to that lifecycle action.
Otherwise, treat it as a silent topology-upgrade demand, complete the protocol workflow first, then continue to apply and handoff.
Prefer \`reuse\`, then \`modify\`, and only then \`create_child\`.
`;
}

function upsertAgentsMd(agentsPath: string, triadRules: string) {
    const existing = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, 'utf-8') : '';
    const normalized = stripExistingRules(existing).trimEnd();
    const next = normalized ? `${normalized}\n\n${triadRules}` : triadRules;
    fs.writeFileSync(agentsPath, next, 'utf-8');
}

function stripExistingRules(content: string) {
    const pattern = new RegExp(`${START_MARKER}[\\s\\S]*?${END_MARKER}\\n?`, 'g');
    return content.replace(pattern, '').trim();
}
