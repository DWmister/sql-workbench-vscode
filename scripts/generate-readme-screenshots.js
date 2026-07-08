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
    title: 'Read-only schema inspector',
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
];

fs.mkdirSync(imageDir, { recursive: true });

for (const screenshot of screenshots) {
  const htmlPath = path.join(tmpDir, `${screenshot.name}.html`);
  const imagePath = path.join(imageDir, `${screenshot.name}.png`);

  fs.writeFileSync(htmlPath, screenshot.html);
  const chromeArgs = [
    '--headless=new',
    '--disable-gpu',
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
    `--user-data-dir=${path.join(tmpDir, `${screenshot.name}-profile`)}`,
    `--window-size=${screenshot.width},${screenshot.height}`,
    `--screenshot=${imagePath}`,
    `file://${htmlPath}`,
  ];

  try {
    execFileSync(chromePath, chromeArgs, {
      stdio: 'ignore',
      timeout: 20_000,
    });
  } catch (error) {
    if (!fs.existsSync(imagePath)) {
      throw error;
    }
  }

  const stat = fs.statSync(imagePath);
  if (stat.size < 10_000) {
    throw new Error(`${screenshot.name}.png looks too small (${stat.size} bytes).`);
  }
}

console.log(`Generated ${screenshots.length} screenshots in ${path.relative(repoRoot, imageDir)}`);

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
          <label class="req">名称</label><input value="qa-bi-dwd">
          <label class="req">分组</label><input value="sr">
        </div>
        <div class="section">
          <h2>快捷连接</h2>
          <div class="grid">
            <label>连接字符串</label>
            <textarea class="wide">mysql://root:password@127.0.0.1:3306/qa_bi_dwd?name=qa-bi-dwd&group=sr</textarea>
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
            <label class="req">用户名</label><input value="root">
            <label>密码</label><input value="••••••••">
            <label class="req">数据库</label><input class="wide" value="qa_bi_dwd">
          </div>
        </div>
        <div class="btns"><span class="btn">测试连接</span><span class="btn primary">保存</span><span class="btn">关闭</span></div>
      </div>
    </div>
  </div>`;
}

function renderSchemaView() {
  const rows = [
    ['id', 'varchar(65533)', '65533', '主键id', 'NO', 'YES'],
    ['std_show_id', 'varchar(65533)', '65533', '标准演出id', 'YES', 'NO'],
    ['supplier_id', 'varchar(65533)', '65533', '节目供应商id', 'YES', 'NO'],
    ['biz_code', 'varchar(65533)', '65533', '业务编码(来源)', 'YES', 'NO'],
    ['show_name', 'varchar(65533)', '65533', '演出名称', 'YES', 'NO'],
    ['is_show_sponsor', 'tinyint(1)', '1', '冠名是否展示', 'YES', 'NO'],
    ['poster_url', 'varchar(65533)', '65533', '海报图', 'YES', 'NO'],
  ];

  return `<div class="vscode">
    ${renderSidebar('schema')}
    <div class="content">
      <div class="tabbar"><div class="tab">biz_show</div></div>
      <div class="toolbar"><strong>qa_bi_dwd.biz_show</strong><span class="muted">45 columns</span><span class="badge">Read-only schema view</span></div>
      <div class="grid" style="padding:16px;">
        <label>Connection</label><strong>sr</strong>
        <label>Database</label><strong>qa_bi_dwd</strong>
      </div>
      <table>
        <thead><tr><th>Name</th><th>Type</th><th>Length</th><th>Comment</th><th>Nullable</th><th>Primary Key</th></tr></thead>
        <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
    </div>
  </div>`;
}

function renderCompletionView() {
  const suggestions = [
    ['◈', 'id', '主键id', 'varchar(65533)'],
    ['◈', 'identity_required_type', '购买此演出身份证使用类型', 'int(11)'],
    ['◈', 'invoice_type', '发票类型：1、电子票；2、纸质票', 'int(11)'],
    ['◈', 'is_deleted', '是否删除', 'tinyint(1)'],
    ['◈', 'is_free', '是否免费', 'tinyint(1)'],
    ['◈', 'is_show_sponsor', '冠名是否展示', 'tinyint(1)'],
    ['◈', 'show_name', '演出名称', 'varchar(65533)'],
  ];

  return `<div class="vscode">
    ${renderSidebar('completion')}
    <div class="content">
      <div class="tabbar"><div class="tab">s.sql</div></div>
      <div class="editor">
        ${codeLine(1, '<span class="kw">select</span> <span class="id">bs</span>.i <span class="kw">from</span> <span class="table-name">biz_show</span> bs')}
        ${codeLine(2, '<span class="kw">where</span>')}
        ${codeLine(3, '  <span class="id">bs</span>.is_del')}
        ${codeLine(4, '<span class="kw">limit</span> <span class="num">10</span>;')}
        <div class="suggest">
          ${suggestions.map((row, index) => `<div class="suggest-row ${index === 0 ? 'active' : ''}"><span>${row[0]}</span><strong>${escapeHtml(row[1])}</strong><span class="comment">${escapeHtml(row[2])}</span><span class="type">${escapeHtml(row[3])}</span></div>`).join('')}
        </div>
      </div>
    </div>
  </div>`;
}

function renderSidebar(active = '') {
  const tableClass = active === 'schema' ? 'tree-row indent-2 active' : 'tree-row indent-2';
  return `<aside class="sidebar">
    <div class="sidebar-title"><span>Database</span><span>＋ ⟳</span></div>
    <div class="tree-row">▾ 📁 sr</div>
    <div class="tree-row indent-1">▾ 🐬 qa_bi_dwd</div>
    <div class="tree-row indent-2">▾ Tables</div>
    <div class="${tableClass}">▸ ▦ biz_show</div>
    <div class="tree-row indent-2">▸ ▦ biz_user</div>
    <div class="tree-row indent-2">▸ ▦ tm_order</div>
    <div class="tree-row indent-2">▸ ▦ tc_order</div>
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
