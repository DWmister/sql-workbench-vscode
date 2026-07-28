const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const imageDir = path.join(repoRoot, 'docs', 'images');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sql-workbench-shots-'));

const chromePath = process.env.CHROME_PATH
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const screenshots = [
  {
    name: 'connection-form',
    title: 'Connection form',
    width: 1440,
    height: 900,
    html: renderPage(renderConnectionForm()),
  },
  {
    name: 'schema-view',
    title: 'Read-only table properties and DDL',
    width: 1440,
    height: 900,
    html: renderPage(renderSchemaView()),
  },
  {
    name: 'sql-completion',
    title: 'Alias-aware SQL completion',
    width: 1440,
    height: 900,
    html: renderPage(renderCompletionView()),
  },
  {
    name: 'agent-chat',
    title: 'Agent Chat and SQL Explain',
    width: 1440,
    height: 900,
    html: renderPage(renderAgentChatView()),
  },
  {
    name: 'ai-configuration',
    title: 'OpenAI-compatible model configuration',
    width: 1440,
    height: 900,
    html: renderPage(renderAiConfiguration()),
  },
];
const requestedNames = process.argv.slice(2);
const selectedScreenshots = requestedNames.length === 0
  ? screenshots
  : screenshots.filter((screenshot) => requestedNames.includes(screenshot.name));

if (selectedScreenshots.length !== (requestedNames.length || screenshots.length)) {
  const available = screenshots.map((screenshot) => screenshot.name).join(', ');
  throw new Error(`Unknown screenshot name. Available screenshots: ${available}`);
}

fs.mkdirSync(imageDir, { recursive: true });

for (const screenshot of selectedScreenshots) {
  const htmlPath = path.join(tmpDir, `${screenshot.name}.html`);
  const imagePath = path.join(imageDir, `${screenshot.name}.png`);
  const generatedImagePath = path.join(tmpDir, `${screenshot.name}.png`);

  fs.writeFileSync(htmlPath, screenshot.html);
  const chromeArgs = [
    '--headless=new',
    '--no-sandbox',
    '--hide-scrollbars',
    '--no-first-run',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-sync',
    '--disable-features=OptimizationHints,MediaRouter,Translate',
    '--metrics-recording-only',
    '--no-default-browser-check',
    '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=1500',
    `--user-data-dir=${path.join(tmpDir, `${screenshot.name}-profile`)}`,
    `--window-size=${screenshot.width},${screenshot.height}`,
    `--screenshot=${generatedImagePath}`,
    `file://${htmlPath}`,
  ];

  try {
    execFileSync(chromePath, chromeArgs, {
      stdio: 'ignore',
      timeout: 8_000,
    });
  } catch (error) {
    if (!fs.existsSync(generatedImagePath)) {
      throw error;
    }
  }

  const stat = fs.statSync(generatedImagePath);
  if (stat.size < 10_000) {
    throw new Error(`${screenshot.name}.png looks too small (${stat.size} bytes).`);
  }
  fs.copyFileSync(generatedImagePath, imagePath);
}

console.log(`Generated ${selectedScreenshots.length} screenshot${selectedScreenshots.length === 1 ? '' : 's'} in ${path.relative(repoRoot, imageDir)}`);

function renderPage(content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root {
      color-scheme: dark;
      --bg: #11161d;
      --panel: #151b23;
      --panel-soft: #1b222c;
      --border: #303946;
      --text: #c9d1d9;
      --muted: #8b949e;
      --accent: #58a6ff;
      --green: #7ee787;
      --orange: #f97316;
      --yellow: #facc15;
      --blue: #3b82f6;
      --danger: #ff7b72;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--text);
      background: var(--bg);
      font: 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .frame {
      width: 100vw;
      height: 100vh;
      padding: 24px;
      background: linear-gradient(180deg, #0f141b 0%, #11161d 100%);
    }
    .window {
      width: 100%;
      height: 100%;
      border: 1px solid #252f3b;
      background: #10151b;
      overflow: hidden;
      box-shadow: 0 28px 80px rgba(0,0,0,0.38);
    }
    .vscode {
      display: grid;
      grid-template-columns: 330px 1fr;
      height: 100%;
    }
    .sidebar {
      border-right: 1px solid var(--border);
      background: #141a21;
      padding: 18px 14px;
    }
    .sidebar-title {
      display: flex;
      justify-content: space-between;
      color: #aab3bf;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      margin-bottom: 18px;
    }
    .tree-row {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 25px;
      color: #b7c0cc;
      white-space: nowrap;
    }
    .tree-row.active {
      margin-left: -8px;
      margin-right: -8px;
      padding-left: 8px;
      background: #2b3442;
    }
    .indent-1 { padding-left: 18px; }
    .indent-2 { padding-left: 36px; }
    .indent-3 { padding-left: 54px; }
    .muted { color: var(--muted); }
    .content {
      min-width: 0;
      background: #11161d;
    }
    .tabbar {
      display: flex;
      height: 42px;
      border-bottom: 1px solid var(--border);
      background: #0f141a;
    }
    .tab {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 16px;
      border-right: 1px solid var(--border);
      border-top: 2px solid #58a6ff;
      background: #151b23;
      font-weight: 600;
    }
    .logo {
      position: relative;
      width: 48px;
      height: 42px;
      flex: none;
    }
    .logo span {
      position: absolute;
      width: 28px;
      height: 34px;
      border-radius: 9px 9px 6px 6px;
      opacity: 0.94;
    }
    .logo .a { left: 0; top: 8px; background: var(--orange); }
    .logo .b { left: 10px; top: 2px; background: var(--yellow); }
    .logo .c { left: 20px; top: 0; background: var(--blue); }
    .main {
      padding: 28px 34px;
    }
    h1 {
      margin: 0;
      font-size: 26px;
      font-weight: 700;
      letter-spacing: 0;
    }
    h2 {
      margin: 0 0 12px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    input, textarea {
      width: 100%;
      border: 1px solid transparent;
      border-radius: 4px;
      color: var(--text);
      background: #1c222b;
      padding: 8px 10px;
      font: inherit;
    }
    textarea { min-height: 58px; resize: none; }
    label { color: var(--muted); }
    label.req:before { content: "*"; color: var(--danger); margin-right: 5px; }
    .grid {
      display: grid;
      grid-template-columns: 130px minmax(220px, 1fr) 130px minmax(220px, 1fr);
      gap: 14px 18px;
      align-items: center;
      max-width: 960px;
    }
    .wide { grid-column: span 3; }
    .section {
      margin-top: 22px;
      padding-top: 18px;
      border-top: 1px solid var(--border);
    }
    .tabs {
      display: flex;
      gap: 18px;
      flex-wrap: wrap;
    }
    .tabs span {
      color: var(--muted);
      padding-bottom: 7px;
      border-bottom: 2px solid transparent;
    }
    .tabs .active {
      color: var(--text);
      border-color: var(--accent);
    }
    .shot-tab-icon {
      display: inline-block;
      width: 18px;
      font: 700 13px "SFMono-Regular", Consolas, monospace;
      text-align: center;
    }
    .shot-tab-icon.columns { color: #65b7f3; }
    .shot-tab-icon.ddl { color: #c586c0; font-size: 11px; }
    .btns {
      display: flex;
      justify-content: center;
      gap: 10px;
      margin-top: 28px;
      max-width: 960px;
    }
    .btn {
      height: 34px;
      min-width: 86px;
      padding: 0 14px;
      border: 0;
      border-radius: 4px;
      color: #fff;
      background: #475569;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .btn.primary { background: #2563eb; }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 12px;
      height: 46px;
      padding: 0 16px;
      border-bottom: 1px solid var(--border);
    }
    .badge {
      margin-left: auto;
      border: 1px solid var(--border);
      border-radius: 999px;
      color: var(--muted);
      padding: 3px 10px;
    }
    table {
      width: calc(100% - 32px);
      margin: 16px;
      border-collapse: collapse;
      table-layout: fixed;
      border: 1px solid var(--border);
    }
    th, td {
      padding: 9px 11px;
      border-right: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
      text-align: left;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    th {
      color: #d8dee9;
      background: #1a212a;
      font-weight: 700;
    }
    .editor {
      position: relative;
      height: calc(100% - 42px);
      padding: 28px 0;
      font: 16px "SFMono-Regular", Consolas, monospace;
      line-height: 1.65;
      background: #10151b;
    }
    .line {
      display: grid;
      grid-template-columns: 54px 1fr;
      min-height: 28px;
    }
    .ln {
      color: #65707e;
      text-align: right;
      padding-right: 16px;
    }
    .code { white-space: pre; }
    .kw { color: #c678dd; }
    .id { color: #e5c07b; }
    .num { color: #d19a66; }
    .table-name { color: #98c379; }
    .suggest {
      position: absolute;
      left: 170px;
      top: 72px;
      width: 620px;
      border: 1px solid #2f3947;
      border-radius: 8px;
      overflow: hidden;
      background: #1d242e;
      box-shadow: 0 16px 44px rgba(0,0,0,0.45);
    }
    .suggest-row {
      display: grid;
      grid-template-columns: 24px minmax(160px, 1fr) minmax(210px, 1fr) 130px;
      gap: 8px;
      align-items: center;
      height: 30px;
      padding: 0 10px;
      border-bottom: 1px solid rgba(255,255,255,0.03);
    }
    .suggest-row.active { background: #2f3b4c; }
    .type { color: #d8dee9; text-align: right; }
    .comment { color: #aab3bf; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .agent-layout {
      display: grid;
      grid-template-columns: 300px 410px minmax(0, 1fr);
      height: 100%;
    }
    .agent-panel {
      display: flex;
      min-width: 0;
      flex-direction: column;
      border-right: 1px solid var(--border);
      background: #141a21;
    }
    .agent-panel-title {
      display: flex;
      justify-content: space-between;
      padding: 16px 14px 10px;
      color: #aab3bf;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: .04em;
      text-transform: uppercase;
    }
    .agent-header {
      padding: 10px 14px 12px;
      border-bottom: 1px solid var(--border);
    }
    .agent-brand {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
    }
    .agent-brand strong { font-size: 14px; }
    .agent-status {
      padding: 3px 9px;
      border-radius: 999px;
      color: #fff;
      background: #287aa4;
    }
    .agent-toolbar {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 34px 34px;
      gap: 6px;
    }
    .agent-select, .agent-icon-button {
      height: 34px;
      border: 1px solid #3b82a6;
      color: var(--text);
      background: #171d24;
    }
    .agent-select { padding: 0 10px; }
    .agent-icon-button {
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
    }
    .agent-connection {
      margin-top: 9px;
      color: var(--muted);
    }
    .agent-messages {
      flex: 1;
      min-height: 0;
      padding: 12px 14px;
      overflow: hidden;
    }
    .chat-message {
      margin-bottom: 12px;
      padding: 10px 11px;
      border: 1px solid var(--border);
      border-radius: 5px;
      background: #10151b;
    }
    .chat-message.user { border-color: #2f81b7; }
    .chat-role {
      margin-bottom: 5px;
      color: var(--muted);
      font-size: 10px;
      letter-spacing: .06em;
      text-transform: uppercase;
    }
    .chat-message p { margin: 0; line-height: 1.55; }
    .agent-draft {
      margin-top: 10px;
      padding: 10px;
      border-left: 3px solid var(--accent);
      background: #222831;
    }
    .agent-draft-head {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    .agent-draft pre {
      margin: 0 0 9px;
      color: #d7dee8;
      font: 12px/1.55 "SFMono-Regular", Consolas, monospace;
      white-space: pre-wrap;
    }
    .draft-actions { display: flex; gap: 7px; }
    .draft-actions .btn { min-width: 64px; height: 29px; }
    .agent-composer {
      padding: 11px 14px 13px;
      border-top: 1px solid var(--border);
    }
    .agent-composer textarea {
      min-height: 74px;
      padding: 9px;
      border: 1px solid var(--border);
      background: #11171e;
    }
    .composer-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-top: 7px;
      color: var(--muted);
      font-size: 10px;
    }
    .editor-codelens {
      height: 22px;
      margin-left: 54px;
      color: #8f98a5;
      font: 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .editor-codelens b { color: #6db8ed; font-weight: 500; }
    .config-layout {
      display: grid;
      grid-template-columns: 300px minmax(0, 1fr);
      height: 100%;
    }
    .config-main {
      min-width: 0;
      background: #11161d;
    }
    .config-form {
      max-width: 820px;
      padding: 34px 44px;
    }
    .config-form h1 { margin-bottom: 8px; }
    .config-lead {
      margin: 0 0 26px;
      color: var(--muted);
    }
    .config-field { margin-bottom: 20px; }
    .config-field label {
      display: block;
      margin-bottom: 7px;
      color: var(--text);
      font-weight: 650;
    }
    .config-field input, .config-field textarea {
      border-color: var(--border);
      background: #1a212a;
    }
    .config-field textarea { min-height: 105px; }
    .config-help {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      margin: 7px 0 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
    }
    .config-help strong { color: #d8dee9; }
    .secret-badge {
      margin-left: 7px;
      padding: 2px 7px;
      border-radius: 999px;
      color: #fff;
      background: #287aa4;
      font-size: 10px;
      font-weight: 500;
    }
  </style>
</head>
<body>
  <div class="frame"><div class="window">${content}</div></div>
</body>
</html>`;
}

function renderConnectionForm() {
  return `<div class="vscode">
    ${renderSidebar()}
    <div class="content">
      <div class="tabbar"><div class="tab">Add Connection</div></div>
      <div class="main">
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:26px;">
          <div class="logo"><span class="a"></span><span class="b"></span><span class="c"></span></div>
          <h1>连接至服务</h1>
        </div>
        <div class="grid">
          <label class="req">名称</label><input value="local-mysql">
          <label class="req">分组</label><input value="Development">
        </div>
        <div class="section">
          <h2>快捷连接</h2>
          <div class="grid">
            <label>连接字符串</label>
            <textarea class="wide">mysql://developer:••••••••@127.0.0.1:3306/app_db?name=local-mysql&amp;group=Development</textarea>
            <div></div><div><span class="btn">解析</span></div>
          </div>
        </div>
        <div class="section">
          <h2>服务类型</h2>
          <div class="tabs"><span class="active">MySQL / MariaDB</span><span>PostgreSQL</span><span>SQLite</span></div>
        </div>
        <div class="section">
          <h2>配置</h2>
          <div class="grid">
            <label class="req">主机名</label><input value="127.0.0.1">
            <label class="req">端口</label><input value="3306">
            <label class="req">用户名</label><input value="developer">
            <label>密码</label><input value="••••••••">
            <label class="req">数据库</label><input class="wide" value="app_db">
          </div>
        </div>
        <div class="btns"><span class="btn">测试连接</span><span class="btn primary">保存</span><span class="btn">关闭</span></div>
      </div>
    </div>
  </div>`;
}

function renderSchemaView() {
  const ddl = [
    '<span class="kw">CREATE TABLE</span> <span class="table-name">`orders`</span> (',
    '  <span class="id">`id`</span> bigint NOT NULL AUTO_INCREMENT COMMENT <span class="table-name">\'Order ID\'</span>,',
    '  <span class="id">`customer_id`</span> bigint NOT NULL COMMENT <span class="table-name">\'Customer ID\'</span>,',
    '  <span class="id">`status`</span> varchar(<span class="num">32</span>) NOT NULL COMMENT <span class="table-name">\'Order status\'</span>,',
    '  <span class="id">`total_amount`</span> decimal(<span class="num">12</span>, <span class="num">2</span>) NOT NULL COMMENT <span class="table-name">\'Order total\'</span>,',
    '  <span class="id">`placed_at`</span> datetime NOT NULL COMMENT <span class="table-name">\'Placed time\'</span>,',
    '  <span class="id">`created_at`</span> datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,',
    '  <span class="kw">PRIMARY KEY</span> (<span class="id">`id`</span>),',
    '  <span class="kw">KEY</span> <span class="id">`idx_orders_customer_placed`</span> (<span class="id">`customer_id`</span>, <span class="id">`placed_at`</span>)',
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT=<span class="table-name">\'Customer orders\'</span>;',
  ];

  return `<div class="vscode">
    ${renderSidebar('schema')}
    <div class="content">
      <div class="tabbar"><div class="tab">orders</div></div>
      <div class="toolbar"><strong>app_db.orders</strong><span class="muted">7 columns</span><span class="badge">Read-only properties</span></div>
      <div class="grid" style="padding:12px 16px 8px;">
        <label>Connection</label><strong>local-mysql</strong>
        <label>Database</label><strong>app_db</strong>
      </div>
      <div style="display:flex;align-items:center;border-bottom:1px solid var(--border);padding:0 16px;">
        <div class="tabs" style="height:40px;align-items:flex-end;"><span><b class="shot-tab-icon columns">▤</b> Columns</span><span class="active"><b class="shot-tab-icon ddl">{}</b> DDL</span></div>
        <div style="margin-left:auto;display:flex;gap:8px;"><span class="btn" style="height:28px;min-width:70px;">Copy</span><span class="btn" style="height:28px;min-width:76px;">Refresh</span></div>
      </div>
      <div class="editor" style="height:calc(100% - 182px);padding-top:22px;">
        ${ddl.map((line, index) => codeLine(index + 1, line)).join('')}
      </div>
    </div>
  </div>`;
}

function renderCompletionView() {
  const suggestions = [
    ['◈', 'id', 'Order ID', 'bigint'],
    ['◈', 'customer_id', 'Customer ID', 'bigint'],
    ['◈', 'status', 'Order status', 'varchar(32)'],
    ['◈', 'total_amount', 'Order total', 'decimal(12,2)'],
    ['◈', 'placed_at', 'Placed time', 'datetime'],
    ['◈', 'created_at', 'Created time', 'datetime'],
  ];

  return `<div class="vscode">
    ${renderSidebar('completion')}
    <div class="content">
      <div class="tabbar"><div class="tab">s.sql</div></div>
      <div class="editor">
        ${codeLine(1, '<span class="kw">select</span> <span class="id">o</span>.i <span class="kw">from</span> <span class="table-name">orders</span> o')}
        ${codeLine(2, '<span class="kw">where</span>')}
        ${codeLine(3, '  <span class="id">o</span>.')}
        ${codeLine(4, '<span class="kw">limit</span> <span class="num">10</span>;')}
        <div class="suggest">
          ${suggestions.map((row, index) => `<div class="suggest-row ${index === 0 ? 'active' : ''}"><span>${row[0]}</span><strong>${escapeHtml(row[1])}</strong><span class="comment">${escapeHtml(row[2])}</span><span class="type">${escapeHtml(row[3])}</span></div>`).join('')}
        </div>
      </div>
    </div>
  </div>`;
}

function renderAgentChatView() {
  const sqlLines = [
    '<span class="kw">SELECT</span>',
    '  <span class="id">c</span>.<span class="id">id</span> <span class="kw">AS</span> customer_id,',
    '  <span class="id">c</span>.<span class="id">full_name</span>,',
    '  COUNT(<span class="id">o</span>.<span class="id">id</span>) <span class="kw">AS</span> order_count,',
    '  COALESCE(SUM(<span class="id">o</span>.<span class="id">total_amount</span>), <span class="num">0</span>) <span class="kw">AS</span> total_amount',
    '<span class="kw">FROM</span> <span class="table-name">customers</span> <span class="id">c</span>',
    '<span class="kw">LEFT JOIN</span> <span class="table-name">orders</span> <span class="id">o</span> <span class="kw">ON</span> <span class="id">o</span>.<span class="id">customer_id</span> = <span class="id">c</span>.<span class="id">id</span>',
    '  <span class="kw">AND</span> <span class="id">o</span>.<span class="id">placed_at</span> &gt;= <span class="table-name">:start_time</span>',
    '  <span class="kw">AND</span> <span class="id">o</span>.<span class="id">placed_at</span> &lt; <span class="table-name">:end_time</span>',
    '<span class="kw">GROUP BY</span> <span class="id">c</span>.<span class="id">id</span>, <span class="id">c</span>.<span class="id">full_name</span>;',
  ];
  const draftSql = `SELECT
  c.id AS customer_id,
  c.full_name,
  COUNT(o.id) AS order_count,
  COALESCE(SUM(o.total_amount), 0) AS total_amount
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
GROUP BY c.id, c.full_name;`;

  return `<div class="agent-layout">
    ${renderSidebar()}
    <section class="agent-panel">
      <div class="agent-panel-title"><span>Agent Chat</span><span>＋ ⚙</span></div>
      <div class="agent-header">
        <div class="agent-brand"><strong>Schema-aware Chat</strong><span class="agent-status">Ready</span></div>
        <div class="agent-toolbar">
          <div class="agent-select">Customer order summary⌄</div>
          <div class="agent-icon-button">＋</div>
          <div class="agent-icon-button">⚙</div>
        </div>
        <div class="agent-connection">local-mysql · app_db</div>
      </div>
      <div class="agent-messages">
        <article class="chat-message user">
          <div class="chat-role">You</div>
          <p>Explain the current SQL and check whether its indexes are appropriate.</p>
        </article>
        <article class="chat-message">
          <div class="chat-role">Agent</div>
          <p>This query summarizes each customer's order count and total amount for a time range. The LEFT JOIN retains customers with no matching orders.</p>
          <p style="margin-top:7px;color:var(--muted);">Index review: <code>orders(customer_id, placed_at)</code> supports the join and range filter. No SQL was executed.</p>
        </article>
        <section class="agent-draft">
          <div class="agent-draft-head"><strong>Customer order summary</strong><span class="muted">review in editor</span></div>
          <pre>${escapeHtml(draftSql)}</pre>
          <div class="draft-actions"><span class="btn">Insert</span><span class="btn">Open</span></div>
        </section>
      </div>
      <div class="agent-composer">
        <textarea placeholder="Ask about the active database, generate SQL, or paste an error to fix…"></textarea>
        <div class="composer-meta"><span>Enter to send · Shift+Enter for a new line</span><span class="btn primary" style="height:30px;min-width:58px;">Send</span></div>
      </div>
    </section>
    <section class="content">
      <div class="tabbar"><div class="tab">customer-orders.sql</div></div>
      <div class="editor">
        <div class="editor-codelens">Run Statement&nbsp; | &nbsp;<b>AI Explain</b></div>
        ${sqlLines.map((line, index) => codeLine(index + 1, line)).join('')}
      </div>
    </section>
  </div>`;
}

function renderAiConfiguration() {
  const explainInstructions = 'Respond in Chinese, explain step by step, and focus on indexes and full-table scans.';
  return `<div class="config-layout">
    ${renderSidebar()}
    <section class="config-main">
      <div class="tabbar"><div class="tab">Configure Agent Chat</div></div>
      <main class="config-form">
        <h1>Configure Agent Chat</h1>
        <p class="config-lead">Connect directly to your OpenAI-compatible API. SQL Workbench does not proxy or host the model service.</p>
        <div class="config-field">
          <label>API Base URL</label>
          <input value="https://api.example.com/v1">
          <p class="config-help"><span>Enter the provider's OpenAI-compatible base URL. Remote URLs must use HTTPS.</span></p>
        </div>
        <div class="config-field">
          <label>Model ID</label>
          <input value="example-model">
          <p class="config-help"><span><strong>Use the exact model name accepted by the API, not the provider or product name.</strong> Copy the current ID from your provider's model list or API error.</span></p>
        </div>
        <div class="config-field">
          <label>Explain Instructions</label>
          <textarea>${escapeHtml(explainInstructions)}</textarea>
          <p class="config-help"><span>Optional preferences for SQL Explain only. Fixed safety requirements and the no-execution boundary cannot be overridden.</span><span>${explainInstructions.length} / 4000</span></p>
        </div>
        <div class="config-field">
          <label>API Key <span class="secret-badge">Saved in VS Code SecretStorage</span></label>
          <input type="password" placeholder="Leave blank to keep the saved key">
          <p class="config-help"><span>The existing key is never sent to this page. Leave blank to keep it, or enter a new key to replace it.</span></p>
        </div>
        <div class="draft-actions"><span class="btn primary">Save</span><span class="btn">Cancel</span></div>
      </main>
    </section>
  </div>`;
}

function renderSidebar(active = '') {
  const tableClass = active === 'schema' ? 'tree-row indent-2 active' : 'tree-row indent-2';
  return `<aside class="sidebar">
    <div class="sidebar-title"><span>Database</span><span>＋ ⟳</span></div>
    <div class="tree-row">▾ 📁 Development</div>
    <div class="tree-row indent-1">▾ 🐬 local-mysql</div>
    <div class="tree-row indent-2">▾ Tables</div>
    <div class="${tableClass}">▸ ▦ orders</div>
    <div class="tree-row indent-2">▸ ▦ customers</div>
    <div class="tree-row indent-2">▸ ▦ products</div>
  </aside>`;
}

function codeLine(number, html) {
  return `<div class="line"><div class="ln">${number}</div><div class="code">${html}</div></div>`;
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
