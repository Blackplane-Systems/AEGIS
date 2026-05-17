import {
  NetworkActionPlan,
  NetworkFinding,
  NetworkIntelligenceSnapshot,
  RouteRecommendation,
} from './network-intelligence';
import { NetworkTopologySnapshot } from './network-map';

/** Dashboard render input assembled by the gateway API. */
export interface GatewayDashboardModel {
  readonly health: Record<string, unknown>;
  readonly topology: NetworkTopologySnapshot;
  readonly intelligence: NetworkIntelligenceSnapshot;
}

/** Renders the built-in dependency-free operator dashboard. */
export function renderGatewayDashboard(model: GatewayDashboardModel): string {
  const digest = model.intelligence.topologyDigest;
  const highestFindings = model.intelligence.findings.slice(-8).reverse();
  const latestActions = model.intelligence.actions.slice(-8).reverse();
  const recommendations = model.intelligence.recommendations.slice(0, 8);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AEGIS Gateway Console</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f7f8fb;
      --panel: #ffffff;
      --panel-strong: #f1f4f8;
      --ink: #17202a;
      --muted: #5f6b7a;
      --border: #d8e0ea;
      --accent: #0969da;
      --good: #157347;
      --warn: #a15c00;
      --bad: #b42318;
      --shadow: 0 12px 30px rgba(18, 38, 63, 0.08);
      font-family:
        Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0d1117;
        --panel: #161b22;
        --panel-strong: #1f2630;
        --ink: #e6edf3;
        --muted: #9da7b3;
        --border: #30363d;
        --accent: #58a6ff;
        --shadow: 0 12px 30px rgba(0, 0, 0, 0.28);
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
    }
    header {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      align-items: flex-start;
      padding: 24px 32px 16px;
      border-bottom: 1px solid var(--border);
      background: var(--panel);
      position: sticky;
      top: 0;
      z-index: 2;
    }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: 22px; line-height: 1.2; letter-spacing: 0; }
    h2 { font-size: 16px; line-height: 1.3; margin-bottom: 12px; }
    h3 { font-size: 13px; line-height: 1.3; margin-bottom: 8px; color: var(--muted); }
    code {
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
      font-size: 12px;
    }
    main {
      padding: 24px 32px 40px;
      display: grid;
      gap: 20px;
    }
    .subtle { color: var(--muted); font-size: 13px; margin-top: 6px; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 14px;
    }
    .wide-grid {
      display: grid;
      grid-template-columns: 1.2fr 0.8fr;
      gap: 20px;
      align-items: start;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      box-shadow: var(--shadow);
      padding: 16px;
      min-width: 0;
    }
    .metric {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      min-height: 96px;
    }
    .metric .value { font-size: 26px; font-weight: 700; line-height: 1; margin-top: 12px; }
    .metric .label { color: var(--muted); font-size: 12px; text-transform: uppercase; }
    .table-wrap { overflow-x: auto; }
    table { border-collapse: collapse; width: 100%; min-width: 680px; }
    th, td {
      text-align: left;
      padding: 10px 8px;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
      font-size: 13px;
    }
    th { color: var(--muted); font-weight: 600; background: var(--panel-strong); }
    .pill {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 3px 8px;
      border-radius: 999px;
      background: var(--panel-strong);
      border: 1px solid var(--border);
      color: var(--ink);
      font-size: 12px;
      white-space: nowrap;
    }
    .good { color: var(--good); }
    .warn { color: var(--warn); }
    .bad { color: var(--bad); }
    .flow {
      display: grid;
      gap: 10px;
      grid-template-columns: repeat(5, minmax(110px, 1fr));
      align-items: stretch;
    }
    .flow .step {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      background: var(--panel-strong);
      min-height: 86px;
      position: relative;
    }
    .flow .step:not(:last-child)::after {
      content: ">";
      position: absolute;
      right: -13px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--muted);
      font-weight: 700;
    }
    .node-list {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 10px;
    }
    .node {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px;
      background: var(--panel-strong);
      min-width: 0;
    }
    .node strong { display: block; overflow-wrap: anywhere; }
    .actions {
      display: grid;
      gap: 10px;
    }
    .action {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      background: var(--panel-strong);
    }
    .action .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 8px;
    }
    @media (max-width: 980px) {
      header { position: static; padding: 20px; }
      main { padding: 20px; }
      .grid, .wide-grid, .flow { grid-template-columns: 1fr; }
      .flow .step:not(:last-child)::after { display: none; }
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>AEGIS Gateway Console</h1>
      <p class="subtle">Headless APIs and the built-in UI read from the same runtime state.</p>
    </div>
    <div>
      <span class="pill">${escapeHtml(String(model.health.runMode ?? 'unknown'))}</span>
      <span class="pill">${escapeHtml(String(model.health.mode ?? 'unknown'))}</span>
      <span class="pill">${escapeHtml(model.intelligence.mode)}</span>
    </div>
  </header>
  <main>
    <section class="grid">
      ${metricCard('Nodes', digest.nodes)}
      ${metricCard('Routes', digest.routes)}
      ${metricCard('Findings', model.intelligence.findings.length)}
      ${metricCard('Actions', model.intelligence.actions.length)}
      ${metricCard('Readiness', Number(model.health.readinessScore ?? 0))}
    </section>

    <section class="panel">
      <h2>Runtime Flow</h2>
      <div class="flow">
        ${flowStep('Ingress', 'IoT, fieldbus, OT, building automation, wireless mesh, and control-plane signals')}
        ${flowStep('Normalize', 'Direct, aggregator, and industrial gateway payloads become canonical events')}
        ${flowStep('Learn', 'Latency, loss, reconnects, routing, segments, identity paths')}
        ${flowStep('Decide', 'Route score, blocker class, safe fanout and throttling')}
        ${flowStep('Act', 'Local-first hold, probe, throttle, alert, and operator APIs')}
      </div>
    </section>

    <section class="wide-grid">
      <div class="panel">
        <h2>Topology</h2>
        <div class="node-list">
          ${model.topology.nodes.map(renderNode).join('')}
        </div>
      </div>
      <div class="panel">
        <h2>Reachability</h2>
        <table>
          <tbody>
            ${reachabilityRow('Reachable', digest.reachable, 'good')}
            ${reachabilityRow('Degraded', digest.degraded, 'warn')}
            ${reachabilityRow('Unreachable', digest.unreachable, 'bad')}
            ${reachabilityRow('Unknown', digest.unknown, '')}
          </tbody>
        </table>
      </div>
    </section>

    <section class="wide-grid">
      <div class="panel">
        <h2>Route Recommendations</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Destination</th>
                <th>Selected next hop</th>
                <th>Protocol</th>
                <th>Score</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              ${recommendations.map(renderRecommendation).join('') || emptyRow(5, 'No route recommendations yet')}
            </tbody>
          </table>
        </div>
      </div>
      <div class="panel">
        <h2>Learned Baselines</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Key</th><th>Samples</th><th>Latency EWMA</th><th>Loss EWMA</th><th>Score</th></tr>
            </thead>
            <tbody>
              ${
                model.intelligence.baselines
                  .slice(0, 8)
                  .map(
                    (baseline) => `<tr>
                      <td><code>${escapeHtml(baseline.key)}</code></td>
                      <td>${baseline.samples}</td>
                      <td>${formatNumber(baseline.ewmaLatencyMs)} ms</td>
                      <td>${formatPercent(baseline.ewmaPacketLossRatio)}</td>
                      <td>${formatPercent(baseline.routeScore)}</td>
                    </tr>`,
                  )
                  .join('') || emptyRow(5, 'No network baselines yet')
              }
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="wide-grid">
      <div class="panel">
        <h2>Recent Findings</h2>
        <div class="actions">
          ${highestFindings.map(renderFinding).join('') || '<p class="subtle">No findings yet.</p>'}
        </div>
      </div>
      <div class="panel">
        <h2>Recent Actions</h2>
        <div class="actions">
          ${latestActions.map(renderAction).join('') || '<p class="subtle">No actions yet.</p>'}
        </div>
      </div>
    </section>
  </main>
</body>
</html>`;
}

function metricCard(label: string, value: number): string {
  return `<div class="metric"><div class="label">${escapeHtml(label)}</div><div class="value">${value}</div></div>`;
}

function flowStep(title: string, body: string): string {
  return `<div class="step"><h3>${escapeHtml(title)}</h3><p class="subtle">${escapeHtml(body)}</p></div>`;
}

function reachabilityRow(label: string, value: number, cls: string): string {
  return `<tr><th>${escapeHtml(label)}</th><td class="${cls}">${value}</td></tr>`;
}

function renderNode(node: NetworkTopologySnapshot['nodes'][number]): string {
  const className =
    node.reachability === 'REACHABLE'
      ? 'good'
      : node.reachability === 'UNREACHABLE'
        ? 'bad'
        : node.reachability === 'DEGRADED'
          ? 'warn'
          : '';
  return `<div class="node">
    <strong>${escapeHtml(node.id)}</strong>
    <span class="subtle">${escapeHtml(node.kind)} ${node.segmentId === undefined ? '' : `on ${escapeHtml(node.segmentId)}`}</span>
    <div><span class="pill ${className}">${escapeHtml(node.reachability)}</span></div>
  </div>`;
}

function renderRecommendation(recommendation: RouteRecommendation): string {
  const best = recommendation.alternatives[0];
  return `<tr>
    <td><code>${escapeHtml(recommendation.destination)}</code></td>
    <td>${escapeHtml(recommendation.selected.nextHop)}</td>
    <td>${escapeHtml(recommendation.selected.protocol)}</td>
    <td>${best === undefined ? '-' : formatPercent(best.score)}</td>
    <td>${escapeHtml(recommendation.reason)}</td>
  </tr>`;
}

function renderFinding(finding: NetworkFinding): string {
  return `<div class="action">
    <div class="meta">
      <span class="pill">${escapeHtml(finding.type)}</span>
      <span class="pill ${severityClass(finding.severity)}">${escapeHtml(finding.severity)}</span>
    </div>
    <strong>${escapeHtml(finding.key)}</strong>
    <p class="subtle">${escapeHtml(finding.message)}</p>
  </div>`;
}

function renderAction(action: NetworkActionPlan): string {
  return `<div class="action">
    <div class="meta">
      <span class="pill">${escapeHtml(action.type)}</span>
      <span class="pill">${escapeHtml(action.status)}</span>
      <span class="pill ${severityClass(action.severity)}">${escapeHtml(action.severity)}</span>
    </div>
    <strong>${escapeHtml(action.target)}</strong>
    <p class="subtle">${escapeHtml(action.reason)}</p>
  </div>`;
}

function severityClass(severity: string): string {
  if (severity === 'CRITICAL' || severity === 'HIGH') {
    return 'bad';
  }
  if (severity === 'MEDIUM') {
    return 'warn';
  }
  return 'good';
}

function emptyRow(columns: number, text: string): string {
  return `<tr><td colspan="${columns}" class="subtle">${escapeHtml(text)}</td></tr>`;
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : '-';
}

function formatPercent(value: number): string {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '-';
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
