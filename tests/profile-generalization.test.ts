import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runTreeSitterParser } from '../treeSitterParser';
import { loadTriadConfig } from '../config';
import { runCoverage } from '../coverage';
import { getWorkspacePaths } from '../workspace';

function writeJson(targetPath: string, value: unknown) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, JSON.stringify(value, null, 2), 'utf-8');
}

function writeText(root: string, relativePath: string, content: string) {
    const targetPath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content, 'utf-8');
}

test('profile-driven parser promotes capabilities for custom conversation/http/shell structure', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'triadmind-profile-parser-'));
    const triadDir = path.join(root, '.triadmind');

    writeJson(path.join(triadDir, 'config.json'), {
        schemaVersion: '1.1',
        architecture: {
            language: 'python',
            parserEngine: 'tree-sitter',
            adapter: '@triadmind/plugin-python'
        },
        categories: {
            dialogue_core: ['flows/dialogue', 'toolbelt/functions'],
            web_surface: ['surface/http'],
            shell_ops: ['ops/shell'],
            shared: ['shared']
        },
        parser: {
            scanCategories: ['dialogue_core', 'web_surface', 'shell_ops']
        }
    });

    writeJson(path.join(triadDir, 'profile.json'), {
        schemaVersion: '1.0',
        scanScopes: [
            { name: 'conversation', kind: 'agent', match: { pathPrefixes: ['flows/dialogue', 'toolbelt/functions'] } },
            { name: 'http', kind: 'api', match: { pathPrefixes: ['surface/http'] } },
            { name: 'shell', kind: 'cli', match: { pathPrefixes: ['ops/shell'] } }
        ]
    });

    writeText(
        root,
        'flows/dialogue/orchestrator.py',
        `
def prepare_conversation_turn(turn: ConversationTurn) -> AssistantReply:
    return turn
`
    );
    writeText(
        root,
        'toolbelt/functions/router.py',
        `
class ToolRouter:
    def dispatch_tool(self, request: ToolRequest) -> ToolResult:
        return request
`
    );
    writeText(
        root,
        'surface/http/chat_routes.py',
        `
@router.post("/reply")
def create_reply(command: ReplyCommand) -> ReplyResult:
    return command
`
    );
    writeText(
        root,
        'ops/shell/console.py',
        `
def main(command: ShellCommand) -> int:
    return 0
`
    );

    const paths = getWorkspacePaths(root);
    const config = loadTriadConfig(paths);
    runTreeSitterParser('python', root, paths.mapFile, config);
    const triadMap = JSON.parse(fs.readFileSync(paths.mapFile, 'utf-8')) as Array<{
        nodeId: string;
        category: string;
        sourcePath: string;
    }>;

    const ids = triadMap.map((node) => `${node.category}:${node.nodeId}`).sort();
    assert.deepEqual(ids, [
        'dialogue_core:Orchestrator.prepare_conversation_turn',
        'dialogue_core:ToolRouter.dispatch_tool',
        'shell_ops:Console.main',
        'web_surface:ChatRoutes.create_reply'
    ]);
});

test('profile-driven coverage uses custom categories and roots without repository-specific assumptions', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'triadmind-profile-coverage-'));
    const triadDir = path.join(root, '.triadmind');

    writeJson(path.join(triadDir, 'config.json'), {
        schemaVersion: '1.1',
        architecture: {
            language: 'python',
            parserEngine: 'tree-sitter',
            adapter: '@triadmind/plugin-python'
        },
        categories: {
            interaction_core: ['runtime/conversations'],
            service_surface: ['delivery/rest'],
            terminal_lane: ['interfaces/commands'],
            shared: ['shared']
        },
        parser: {
            scanCategories: ['interaction_core', 'service_surface', 'terminal_lane']
        }
    });

    writeJson(path.join(triadDir, 'profile.json'), {
        schemaVersion: '1.0',
        scanScopes: [
            { name: 'interaction', kind: 'agent', match: { pathPrefixes: ['runtime/conversations'] } },
            { name: 'rest', kind: 'api', match: { pathPrefixes: ['delivery/rest'] } },
            { name: 'terminal', kind: 'cli', match: { pathPrefixes: ['interfaces/commands'] } }
        ]
    });

    writeText(root, 'runtime/conversations/planner.py', 'def dispatch_turn(turn: TurnRequest) -> TurnResult:\n    return turn\n');
    writeText(root, 'delivery/rest/reply.py', 'def handle_reply(request: ReplyRequest) -> ReplyResult:\n    return request\n');
    writeText(root, 'interfaces/commands/main.py', 'def main(command: ShellCommand) -> int:\n    return 0\n');

    writeJson(path.join(triadDir, 'triad-map.json'), [
        {
            nodeId: 'Planner.dispatch_turn',
            category: 'interaction_core',
            sourcePath: 'runtime/conversations/planner.py',
            fission: { problem: 'planner', demand: ['TurnRequest (turn)'], answer: ['TurnResult'] }
        }
    ]);

    writeJson(path.join(triadDir, 'runtime-map.json'), {
        schemaVersion: '1.0',
        project: 'profile-coverage',
        generatedAt: new Date().toISOString(),
        view: 'full',
        nodes: [
            {
                id: 'Http.reply',
                type: 'ApiRoute',
                label: 'reply',
                sourcePath: 'delivery/rest/reply.py',
                category: 'service_surface'
            },
            {
                id: 'Cli.main',
                type: 'CliCommand',
                label: 'main',
                sourcePath: 'interfaces/commands/main.py',
                category: 'terminal_lane'
            }
        ],
        edges: []
    });

    const report = runCoverage(getWorkspacePaths(root));
    assert.equal(report.byCategory.interaction_core.combinedCoverage, 1);
    assert.equal(report.byCategory.service_surface.runtimeCoverage, 1);
    assert.equal(report.byCategory.terminal_lane.runtimeCoverage, 1);
    assert.deepEqual(report.byRoot['runtime/conversations'].coveredSamples, ['runtime/conversations/planner.py']);
});
