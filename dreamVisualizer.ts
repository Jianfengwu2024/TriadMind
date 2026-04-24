import * as fs from 'fs';
import * as path from 'path';
import { DreamReport } from './dream';

export interface DreamDashboardOptions {
    theme?: 'leaf-like' | 'runtime-dark';
    title?: string;
}

export function generateDreamDashboard(report: DreamReport, outputFilePath: string, options: DreamDashboardOptions = {}) {
    fs.mkdirSync(path.dirname(outputFilePath), { recursive: true });
    const html = renderDreamDashboardHtml(report, options);
    fs.writeFileSync(outputFilePath, html, 'utf-8');
}

export function generateDreamDashboardFromFile(
    reportFilePath: string,
    outputFilePath: string,
    options: DreamDashboardOptions = {}
) {
    const report = readDreamReport(reportFilePath);
    generateDreamDashboard(report, outputFilePath, options);
}

function readDreamReport(reportFilePath: string) {
    const raw = fs.readFileSync(reportFilePath, 'utf-8').replace(/^\uFEFF/, '');
    return JSON.parse(raw) as DreamReport;
}

function renderDreamDashboardHtml(report: DreamReport, options: DreamDashboardOptions) {
    const theme = options.theme === 'runtime-dark' ? 'runtime-dark' : 'leaf-like';
    const payload = JSON.stringify(report);
    const title = escapeHtml(options.title ?? `TriadMind Dream Dashboard - ${report.project}`);
    const background = theme === 'runtime-dark' ? '#0f172a' : '#f5f7fb';
    const cardBg = theme === 'runtime-dark' ? '#111827' : '#ffffff';
    const textPrimary = theme === 'runtime-dark' ? '#e5e7eb' : '#111827';
    const textSecondary = theme === 'runtime-dark' ? '#9ca3af' : '#4b5563';
    const border = theme === 'runtime-dark' ? '#1f2937' : '#e5e7eb';
    const accent = theme === 'runtime-dark' ? '#38bdf8' : '#2563eb';
    const warning = '#f59e0b';
    const error = '#ef4444';
    const success = '#10b981';

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    :root {
      --bg: ${background};
      --card-bg: ${cardBg};
      --text-primary: ${textPrimary};
      --text-secondary: ${textSecondary};
      --border: ${border};
      --accent: ${accent};
      --warning: ${warning};
      --error: ${error};
      --success: ${success};
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text-primary);
    }
    .layout {
      display: grid;
      grid-template-columns: 340px 1fr;
      min-height: 100vh;
    }
    .sidebar {
      border-right: 1px solid var(--border);
      padding: 16px;
      background: var(--card-bg);
    }
    .main {
      padding: 16px;
      display: grid;
      grid-template-rows: auto auto 1fr;
      gap: 12px;
    }
    .title {
      font-size: 18px;
      font-weight: 700;
      margin: 0 0 8px 0;
    }
    .meta {
      font-size: 12px;
      color: var(--text-secondary);
      margin-bottom: 14px;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-bottom: 12px;
    }
    .metric-card {
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px;
      background: var(--bg);
    }
    .metric-key {
      font-size: 11px;
      color: var(--text-secondary);
      margin-bottom: 4px;
    }
    .metric-value {
      font-size: 18px;
      font-weight: 700;
    }
    .summary {
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px;
      margin-bottom: 12px;
      background: var(--bg);
      font-size: 12px;
      line-height: 1.5;
    }
    .summary li { margin: 6px 0; }
    .toolbar {
      display: flex;
      gap: 8px;
      align-items: center;
      border: 1px solid var(--border);
      background: var(--card-bg);
      border-radius: 10px;
      padding: 8px;
    }
    input[type="search"] {
      flex: 1;
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text-primary);
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 12px;
    }
    button {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--card-bg);
      color: var(--text-primary);
      padding: 8px 10px;
      font-size: 12px;
      cursor: pointer;
    }
    button.active {
      border-color: var(--accent);
      color: var(--accent);
    }
    .panel-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      min-height: 0;
    }
    .panel {
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--card-bg);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .panel-header {
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
      font-size: 13px;
      font-weight: 700;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .panel-body {
      overflow: auto;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .item {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px;
      background: var(--bg);
      cursor: pointer;
    }
    .item:hover { border-color: var(--accent); }
    .item-title {
      font-size: 12px;
      font-weight: 700;
      margin-bottom: 6px;
    }
    .item-meta {
      font-size: 11px;
      color: var(--text-secondary);
      margin-bottom: 6px;
    }
    .badge {
      display: inline-block;
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 999px;
      border: 1px solid var(--border);
      margin-right: 4px;
    }
    .severity-warning { color: var(--warning); border-color: var(--warning); }
    .severity-error { color: var(--error); border-color: var(--error); }
    .severity-info { color: var(--accent); border-color: var(--accent); }
    .priority-high { color: var(--error); border-color: var(--error); }
    .priority-medium { color: var(--warning); border-color: var(--warning); }
    .priority-low { color: var(--success); border-color: var(--success); }
    .detail {
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--card-bg);
      padding: 12px;
      font-size: 12px;
      line-height: 1.5;
    }
    .detail h4 {
      margin: 0 0 8px 0;
      font-size: 13px;
    }
    .detail ul { margin: 8px 0 0 18px; }
    .detail li { margin: 6px 0; }
    .muted { color: var(--text-secondary); }
    .hidden { display: none !important; }
    @media (max-width: 1100px) {
      .layout { grid-template-columns: 1fr; }
      .sidebar { border-right: none; border-bottom: 1px solid var(--border); }
      .panel-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="layout">
    <aside class="sidebar">
      <h1 class="title">Dream Governance</h1>
      <div class="meta" id="meta"></div>
      <div class="metrics" id="metrics"></div>
      <ul class="summary" id="summary"></ul>
      <div class="detail" id="detail">
        <h4>Details</h4>
        <div class="muted">Select a finding or proposal to inspect evidence and actions.</div>
      </div>
    </aside>
    <main class="main">
      <div class="toolbar">
        <input id="search" type="search" placeholder="Search findings/proposals by id/title/metric..." />
        <button id="tab-findings" class="active">Findings</button>
        <button id="tab-proposals">Proposals</button>
        <button id="reset">Reset</button>
      </div>
      <div class="panel-grid">
        <section id="panel-findings" class="panel">
          <div class="panel-header"><span>Findings</span><span id="count-findings">0</span></div>
          <div id="findings-list" class="panel-body"></div>
        </section>
        <section id="panel-proposals" class="panel hidden">
          <div class="panel-header"><span>Proposals</span><span id="count-proposals">0</span></div>
          <div id="proposals-list" class="panel-body"></div>
        </section>
      </div>
    </main>
  </div>

  <script>
    const report = ${payload};
    const state = {
      tab: 'findings',
      query: ''
    };

    const metaEl = document.getElementById('meta');
    const metricsEl = document.getElementById('metrics');
    const summaryEl = document.getElementById('summary');
    const detailEl = document.getElementById('detail');
    const findingsListEl = document.getElementById('findings-list');
    const proposalsListEl = document.getElementById('proposals-list');
    const countFindingsEl = document.getElementById('count-findings');
    const countProposalsEl = document.getElementById('count-proposals');
    const panelFindingsEl = document.getElementById('panel-findings');
    const panelProposalsEl = document.getElementById('panel-proposals');
    const tabFindingsEl = document.getElementById('tab-findings');
    const tabProposalsEl = document.getElementById('tab-proposals');
    const searchEl = document.getElementById('search');
    const resetEl = document.getElementById('reset');

    function renderMeta() {
      metaEl.textContent = \`project=\${report.project} | generatedAt=\${report.generatedAt} | mode=\${report.mode} | skipped=\${report.skipped}\`;
    }

    function renderMetrics() {
      const items = [
        ['execute_like_ratio', Number(report.metrics.execute_like_ratio || 0).toFixed(3)],
        ['ghost_ratio', Number(report.metrics.ghost_ratio || 0).toFixed(3)],
        ['unmatched_routes', String(report.metrics.runtime_unmatched_route_count || 0)],
        ['diagnostics_no_code', String(report.metrics.diagnostics_no_code || 0)],
        ['runtime_edges', String(report.metrics.runtime_edges || 0)],
        ['rendered_edges_ok', String(Boolean(report.metrics.rendered_edges_consistency))]
      ];
      metricsEl.innerHTML = items.map(([k,v]) => \`
        <div class="metric-card">
          <div class="metric-key">\${escapeHtml(k)}</div>
          <div class="metric-value">\${escapeHtml(v)}</div>
        </div>
      \`).join('');
    }

    function renderSummary() {
      summaryEl.innerHTML = (report.summary || []).map((item) => \`<li>\${escapeHtml(String(item))}</li>\`).join('');
    }

    function findingMatches(item, query) {
      const text = [item.id, item.title, item.metric, item.description].filter(Boolean).join(' ').toLowerCase();
      return text.includes(query);
    }

    function proposalMatches(item, query) {
      const text = [item.id, item.title, item.objective, item.expectedOutcome].filter(Boolean).join(' ').toLowerCase();
      return text.includes(query);
    }

    function renderFindings() {
      const query = state.query.toLowerCase().trim();
      const list = (report.findings || []).filter((item) => !query || findingMatches(item, query));
      countFindingsEl.textContent = String(list.length);
      findingsListEl.innerHTML = list.map((item, idx) => \`
        <article class="item" data-kind="finding" data-index="\${idx}">
          <div class="item-title">\${escapeHtml(item.title || item.id)}</div>
          <div class="item-meta">
            <span class="badge severity-\${escapeHtml(item.severity || 'info')}">\${escapeHtml(item.severity || 'info')}</span>
            <span class="badge">\${escapeHtml(item.id || 'unknown')}</span>
            <span class="badge">confidence=\${escapeHtml(Number(item.confidence || 0).toFixed(2))}</span>
          </div>
          <div class="muted">\${escapeHtml(item.description || '')}</div>
        </article>
      \`).join('');

      Array.from(findingsListEl.querySelectorAll('.item')).forEach((el, visualIndex) => {
        el.addEventListener('click', () => {
          const item = list[visualIndex];
          if (!item) return;
          renderDetailForFinding(item);
        });
      });
    }

    function renderProposals() {
      const query = state.query.toLowerCase().trim();
      const list = (report.proposals || []).filter((item) => !query || proposalMatches(item, query));
      countProposalsEl.textContent = String(list.length);
      proposalsListEl.innerHTML = list.map((item, idx) => \`
        <article class="item" data-kind="proposal" data-index="\${idx}">
          <div class="item-title">\${escapeHtml(item.title || item.id)}</div>
          <div class="item-meta">
            <span class="badge priority-\${escapeHtml(item.priority || 'low')}">\${escapeHtml(item.priority || 'low')}</span>
            <span class="badge">\${escapeHtml(item.id || 'unknown')}</span>
            <span class="badge">confidence=\${escapeHtml(Number(item.confidence || 0).toFixed(2))}</span>
          </div>
          <div class="muted">\${escapeHtml(item.objective || '')}</div>
        </article>
      \`).join('');

      Array.from(proposalsListEl.querySelectorAll('.item')).forEach((el, visualIndex) => {
        el.addEventListener('click', () => {
          const item = list[visualIndex];
          if (!item) return;
          renderDetailForProposal(item);
        });
      });
    }

    function renderDetailForFinding(item) {
      detailEl.innerHTML = \`
        <h4>Finding: \${escapeHtml(item.title || item.id)}</h4>
        <div><strong>ID:</strong> \${escapeHtml(item.id || '')}</div>
        <div><strong>Severity:</strong> \${escapeHtml(item.severity || '')}</div>
        <div><strong>Metric:</strong> \${escapeHtml(item.metric || '-')}</div>
        <div><strong>Confidence:</strong> \${escapeHtml(Number(item.confidence || 0).toFixed(2))}</div>
        <div style="margin-top:8px;">\${escapeHtml(item.description || '')}</div>
        <h4 style="margin-top:12px;">Evidence</h4>
        <ul>\${(item.evidence || []).map((ev) => \`<li>\${escapeHtml(ev.key || '')}: \${escapeHtml(ev.value || '')}\${ev.sourcePath ? ' @ ' + escapeHtml(ev.sourcePath) : ''}</li>\`).join('') || '<li class="muted">No evidence</li>'}</ul>
      \`;
    }

    function renderDetailForProposal(item) {
      detailEl.innerHTML = \`
        <h4>Proposal: \${escapeHtml(item.title || item.id)}</h4>
        <div><strong>ID:</strong> \${escapeHtml(item.id || '')}</div>
        <div><strong>Priority:</strong> \${escapeHtml(item.priority || '')}</div>
        <div><strong>Confidence:</strong> \${escapeHtml(Number(item.confidence || 0).toFixed(2))}</div>
        <div style="margin-top:8px;"><strong>Objective:</strong> \${escapeHtml(item.objective || '')}</div>
        <div style="margin-top:6px;"><strong>Expected:</strong> \${escapeHtml(item.expectedOutcome || '')}</div>
        <h4 style="margin-top:12px;">Actions</h4>
        <ul>\${(item.actions || []).map((action) => \`<li>\${escapeHtml(action)}</li>\`).join('') || '<li class="muted">No actions</li>'}</ul>
        <h4 style="margin-top:12px;">Linked Findings</h4>
        <ul>\${(item.linkedFindings || []).map((id) => \`<li>\${escapeHtml(id)}</li>\`).join('') || '<li class="muted">None</li>'}</ul>
      \`;
    }

    function applyTabState() {
      const isFindings = state.tab === 'findings';
      panelFindingsEl.classList.toggle('hidden', !isFindings);
      panelProposalsEl.classList.toggle('hidden', isFindings);
      tabFindingsEl.classList.toggle('active', isFindings);
      tabProposalsEl.classList.toggle('active', !isFindings);
    }

    function renderAll() {
      renderMeta();
      renderMetrics();
      renderSummary();
      renderFindings();
      renderProposals();
      applyTabState();
    }

    function escapeHtml(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    tabFindingsEl.addEventListener('click', () => {
      state.tab = 'findings';
      applyTabState();
    });

    tabProposalsEl.addEventListener('click', () => {
      state.tab = 'proposals';
      applyTabState();
    });

    searchEl.addEventListener('input', () => {
      state.query = String(searchEl.value || '');
      renderFindings();
      renderProposals();
    });

    resetEl.addEventListener('click', () => {
      state.query = '';
      state.tab = 'findings';
      searchEl.value = '';
      detailEl.innerHTML = '<h4>Details</h4><div class="muted">Select a finding or proposal to inspect evidence and actions.</div>';
      renderAll();
    });

    renderAll();
  </script>
</body>
</html>`;
}

function escapeHtml(value: string) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
