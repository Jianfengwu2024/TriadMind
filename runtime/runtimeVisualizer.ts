import * as fs from 'fs';
import * as path from 'path';
import { RuntimeMap } from './types';

export interface RuntimeDashboardOptions {
    title?: string;
}

export function generateRuntimeDashboard(runtimeMapPath: string, outputPath: string, options: RuntimeDashboardOptions = {}) {
    const startedAt = Date.now();
    const runtimeMap = JSON.parse(fs.readFileSync(runtimeMapPath, 'utf-8')) as RuntimeMap;
    const html = renderRuntimeDashboard(runtimeMap, options.title ?? `TriadMind Runtime Topology - ${runtimeMap.project}`);

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, html, 'utf-8');
    console.log(
        `[TriadMind] Runtime visualizer mode: lightweight flow fallback view=${runtimeMap.view ?? 'full'} nodes=${runtimeMap.nodes.length} edges=${runtimeMap.edges.length} diagnostics=${(runtimeMap.diagnostics ?? []).length}`
    );
    console.log(`[TriadMind] Runtime dashboard generated in ${Date.now() - startedAt}ms`);
}

function renderRuntimeDashboard(runtimeMap: RuntimeMap, title: string) {
    const payload = JSON.stringify(runtimeMap).replace(/</g, '\\u003c');
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, Segoe UI, Arial, sans-serif; }
    body { margin: 0; background: #0b1020; color: #dbe3f3; }
    .app { display: grid; grid-template-columns: 1fr 360px; min-height: 100vh; }
    .main { padding: 20px; overflow: auto; }
    .sidebar { border-left: 1px solid #26314f; padding: 20px; background: #121a2f; overflow: auto; }
    .summary { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
    .chip { background: #16213b; padding: 8px 12px; border-radius: 999px; font-size: 12px; }
    .lanes { display: grid; grid-template-columns: repeat(6, minmax(180px, 1fr)); gap: 16px; }
    .lane { background: #10182c; border: 1px solid #26314f; border-radius: 14px; padding: 12px; }
    .lane h3 { margin: 0 0 12px; font-size: 14px; }
    .node { display: block; width: 100%; text-align: left; margin: 0 0 8px; background: #18233f; border: 1px solid #2b3d68; color: #edf3ff; border-radius: 10px; padding: 10px; cursor: pointer; }
    .node small { display: block; color: #94a7cc; margin-top: 4px; }
    .muted { color: #8fa2c6; }
    .edge { padding: 8px 0; border-bottom: 1px solid #26314f; font-size: 13px; }
    .edge-type { display: inline-block; min-width: 84px; color: #87b6ff; }
    pre { white-space: pre-wrap; word-break: break-word; background: #0d1426; border-radius: 10px; padding: 12px; }
    @media (max-width: 1200px) { .app { grid-template-columns: 1fr; } .sidebar { border-left: none; border-top: 1px solid #26314f; } .lanes { grid-template-columns: repeat(2, minmax(180px, 1fr)); } }
  </style>
</head>
<body>
  <div class="app">
    <div class="main">
      <h1>${escapeHtml(runtimeMap.project)} runtime topology</h1>
      <div class="summary">
        <div class="chip">view: ${escapeHtml(runtimeMap.view ?? 'full')}</div>
        <div class="chip">nodes: ${runtimeMap.nodes.length}</div>
        <div class="chip">edges: ${runtimeMap.edges.length}</div>
        <div class="chip">diagnostics: ${(runtimeMap.diagnostics ?? []).length}</div>
      </div>
      <div id="lanes" class="lanes"></div>
    </div>
    <aside class="sidebar">
      <h2 id="detail-title">Select a node</h2>
      <div id="detail-body" class="muted">Click any node to inspect source, metadata, evidence, and edges.</div>
    </aside>
  </div>
  <script>
    const runtimeMap = ${payload};
    const lanes = [
      { key: 'Frontend', types: ['FrontendEntry', 'FrontendComponent'] },
      { key: 'API', types: ['ApiRoute', 'CliCommand', 'RpcEndpoint'] },
      { key: 'Service', types: ['Service', 'Workflow', 'WorkflowNode', 'WorkflowEdge'] },
      { key: 'Worker', types: ['Worker', 'Task', 'Queue', 'Scheduler', 'MessageProducer', 'EventConsumer'] },
      { key: 'Resources', types: ['DataStore', 'ObjectStore', 'Cache', 'FileSystem', 'Config', 'Secret'] },
      { key: 'External', types: ['ExternalApi', 'ExternalTool', 'ModelProvider', 'Kernel', 'Plugin', 'UnknownRuntime'] }
    ];
    const edgeColors = { calls:'#5bc0eb', invokes:'#9bc53d', enqueues:'#f25f5c', reads:'#ffe066', writes:'#ff9f1c', caches:'#c77dff', executes:'#2ec4b6', contains:'#6c8ef5', connects:'#8d99ae' };
    const lanesEl = document.getElementById('lanes');
    const detailTitle = document.getElementById('detail-title');
    const detailBody = document.getElementById('detail-body');
    const edgesByNode = new Map();
    for (const edge of runtimeMap.edges) {
      if (!edgesByNode.has(edge.from)) edgesByNode.set(edge.from, { outgoing: [], incoming: [] });
      if (!edgesByNode.has(edge.to)) edgesByNode.set(edge.to, { outgoing: [], incoming: [] });
      edgesByNode.get(edge.from).outgoing.push(edge);
      edgesByNode.get(edge.to).incoming.push(edge);
    }
    function render() {
      lanesEl.innerHTML = '';
      for (const lane of lanes) {
        const nodes = runtimeMap.nodes.filter(node => lane.types.includes(node.type));
        if (!nodes.length) continue;
        const section = document.createElement('section');
        section.className = 'lane';
        section.innerHTML = '<h3>' + lane.key + ' <span class="muted">(' + nodes.length + ')</span></h3>';
        for (const node of nodes) {
          const button = document.createElement('button');
          button.className = 'node';
          button.innerHTML = '<strong>' + escapeHtml(node.label) + '</strong><small>' + escapeHtml(node.type) + '</small>';
          button.onclick = () => showNode(node);
          section.appendChild(button);
        }
        lanesEl.appendChild(section);
      }
    }
    function showNode(node) {
      const io = edgesByNode.get(node.id) || { incoming: [], outgoing: [] };
      detailTitle.textContent = node.label;
      const details = [
        '<div><strong>Type:</strong> ' + escapeHtml(node.type) + '</div>',
        '<div><strong>Source:</strong> ' + escapeHtml(node.sourcePath || '-') + '</div>',
        '<div><strong>Framework:</strong> ' + escapeHtml(node.framework || '-') + '</div>',
        '<h3>Metadata</h3><pre>' + escapeHtml(JSON.stringify(node.metadata || {}, null, 2)) + '</pre>',
        '<h3>Evidence</h3><pre>' + escapeHtml(JSON.stringify(node.evidence || [], null, 2)) + '</pre>',
        '<h3>Outgoing</h3>' + renderEdges(io.outgoing),
        '<h3>Incoming</h3>' + renderEdges(io.incoming)
      ];
      detailBody.innerHTML = details.join('');
    }
    function renderEdges(edges) {
      if (!edges.length) return '<div class="muted">None</div>';
      return edges.map(edge => '<div class="edge"><span class="edge-type" style="color:' + (edgeColors[edge.type] || '#9ab') + '">' + escapeHtml(edge.type) + '</span>' + escapeHtml(edge.from + ' → ' + edge.to) + '</div>').join('');
    }
    function escapeHtml(value) {
      return String(value).replace(/[&<>"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[char]));
    }
    render();
  </script>
</body>
</html>`;
}

function escapeHtml(value: string) {
    return value.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char] ?? char));
}
