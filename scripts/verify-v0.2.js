const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const Module = require('module');

const repoRoot = path.resolve(__dirname, '..');
const outDir = path.join(repoRoot, 'out');
let vscodeMock = createVscodeMock();
const originalLoad = Module._load;

Module._load = function loadWithVscodeMock(request, parent, isMain) {
  if (request === 'vscode') {
    return vscodeMock;
  }

  return originalLoad.call(this, request, parent, isMain);
};

const { createQueryRunner } = require(path.join(outDir, 'query', 'runner'));
const { ConnectionStore } = require(path.join(outDir, 'connection', 'connectionStore'));
const { WorkspaceConnectionStore } = require(path.join(outDir, 'connection', 'workspaceConnectionStore'));
const { createSchemaInspector } = require(path.join(outDir, 'schema', 'inspector'));
const { findStatementAtOffset, getSqlStatementRanges, splitSqlStatements } = require(path.join(outDir, 'query', 'sqlParser'));
const { findDangerousSqlStatements } = require(path.join(outDir, 'query', 'sqlSafety'));
const { compileSqlVariables, getSqlVariableNames } = require(path.join(outDir, 'query', 'sqlVariables'));
const { registerSqlCodeLensProvider } = require(path.join(outDir, 'query', 'sqlCodeLensProvider'));
const { registerSqlHoverProvider } = require(path.join(outDir, 'completion', 'sqlHoverProvider'));
const { __connectionFormPanelTestHooks } = require(path.join(outDir, 'connection', 'connectionFormPanel'));
const { __resultViewPanelTestHooks } = require(path.join(outDir, 'results', 'resultViewPanel'));
const { TableDetailsPanel, __tableDetailsPanelTestHooks } = require(path.join(outDir, 'schema', 'tableDetailsPanel'));
const { ActiveConnectionState } = require(path.join(outDir, 'connection', 'activeConnectionState'));

async function main() {
  verifySqlParser();
  verifySqlVariables();
  verifyDangerousSqlDetection();
  verifyProductText();
  verifyPanelPlacement();
  verifyCodeLensProvider();
  await verifyHoverProvider();
  verifyResultExportSerializers();
  await verifyDriverPageConnectionLifecycle();
  await verifyDriverTableDdl();
  await verifyDocumentBindingRestore();
  await verifyConnectionSecrets();
  await verifyWorkspaceConnections();
  await verifySqliteReadOnlyResults();
  verifyConnectionFormRendering();
  await verifyTableDetailsPanel();
  verifyTableDetailsWebview();
  verifyResultWebviewBehavior();
  verifyResultWebviewScript();

  console.log('v0.2 verification ok');
}

function verifyProductText() {
  const checkedFiles = [
    path.join(repoRoot, 'src', 'extension.ts'),
    path.join(repoRoot, 'README.md'),
    path.join(repoRoot, 'README_CN.md'),
    path.join(repoRoot, 'CHANGELOG.md'),
    path.join(repoRoot, 'database-client-competitive-analysis.md'),
    path.join(repoRoot, 'docs', 'blogs', 'codex-vibe-coding-sql-workbench.md'),
  ];
  const stalePatterns = [
    /Guarded result-cell editing/u,
    /guarded single-cell saves/u,
    /受保护的单元格编辑/u,
    /保存受保护的单格/u,
    /updateCell/u,
    /Editable Grid/u,
    /MVP 先不要/u,
    /暂时拿掉/u,
  ];

  for (const file of checkedFiles) {
    const text = fs.readFileSync(file, 'utf8');
    for (const pattern of stalePatterns) {
      assert.ok(!pattern.test(text), `${path.relative(repoRoot, file)} contains stale v0.1 boundary text: ${pattern}`);
    }
  }
}

function verifyPanelPlacement() {
  const resultPanel = fs.readFileSync(path.join(repoRoot, 'src', 'results', 'resultViewPanel.ts'), 'utf8');
  const tablePanel = fs.readFileSync(path.join(repoRoot, 'src', 'schema', 'tableDetailsPanel.ts'), 'utf8');
  assert.ok(resultPanel.includes('vscode.ViewColumn.Active'));
  assert.ok(tablePanel.includes('vscode.ViewColumn.Active'));
  assert.ok(!resultPanel.includes('vscode.ViewColumn.Beside'));
  assert.ok(!tablePanel.includes('vscode.ViewColumn.Beside'));
}

async function verifyWorkspaceConnections() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sql-workbench-ws-'));
  try {
    writeWorkspaceConnections(workspaceRoot, {
      version: 1,
      connections: [
        {
          id: 'local-sqlite',
          name: 'Local SQLite',
          type: 'sqlite',
          group: 'Local',
          path: 'data/app.sqlite',
        },
      ],
    });

    vscodeMock.workspace.workspaceFolders = [toWorkspaceFolder(workspaceRoot)];
    vscodeMock.window.messages = [];
    const [connection] = await new WorkspaceConnectionStore().list();
    assert.ok(connection.id.startsWith('workspace-'));
    assert.strictEqual(connection.name, 'Local SQLite');
    assert.strictEqual(connection.group, 'Workspace / Local');
    assert.strictEqual(connection.readonly, true);
    assert.strictEqual(connection.path, path.join(workspaceRoot, 'data', 'app.sqlite'));

    writeWorkspaceConnections(workspaceRoot, {
      version: 1,
      connections: [
        {
          id: 'bad',
          name: 'Bad',
          type: 'mysql',
          host: '127.0.0.1',
          password: 'secret',
        },
        {
          id: 'still-good',
          name: 'Still Good',
          type: 'sqlite',
          path: 'data/second.sqlite',
        },
      ],
    });
    const mixed = await new WorkspaceConnectionStore().list();
    assert.strictEqual(mixed.length, 1);
    assert.strictEqual(mixed[0].name, 'Still Good');
    assert.ok(vscodeMock.window.messages.some((message) => message.includes('sensitive fields: password')));
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    vscodeMock.workspace.workspaceFolders = [];
    vscodeMock.window.messages = [];
  }
}

function writeWorkspaceConnections(root, content) {
  const file = path.join(root, '.vscode', 'sql-workbench.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(content), 'utf8');
}

function toWorkspaceFolder(root) {
  return {
    uri: vscodeMock.Uri.file(root),
    name: path.basename(root),
    index: 0,
  };
}

function verifySqlParser() {
  const sql = [
    "SELECT ';' AS semicolon;",
    "-- comment ;",
    'SELECT 2;',
  ].join('\n');
  const statements = splitSqlStatements(sql);

  assert.strictEqual(statements.length, 2);
  assert.strictEqual(statements[0], "SELECT ';' AS semicolon");
  assert.ok(statements[1].includes('SELECT 2'));

  const ranges = getSqlStatementRanges(sql);
  assert.strictEqual(ranges.length, 2);
  assert.strictEqual(sql.slice(ranges[0].start, ranges[0].end), "SELECT ';' AS semicolon");

  const secondOffset = sql.indexOf('SELECT 2');
  const second = findStatementAtOffset(sql, secondOffset);
  assert.strictEqual(sql.slice(second.start, second.end).includes('SELECT 2'), true);
}

function verifySqlVariables() {
  const sql = [
    "SELECT :name, $age, ':ignored', col::int",
    'FROM users',
    'WHERE id = $1 AND status = :status;',
  ].join('\n');

  assert.deepStrictEqual(getSqlVariableNames(sql), ['name', 'age', 'status']);

  const mysql = compileSqlVariables(sql, { name: 'Ada', age: 37, status: 'active' }, 'mysql');
  assert.ok(mysql.sql.includes('SELECT ?, ?'));
  assert.ok(mysql.sql.includes('status = ?'));
  assert.deepStrictEqual(mysql.params, ['Ada', 37, 'active']);

  const postgres = compileSqlVariables(sql, { name: 'Ada', age: 37, status: 'active' }, 'postgresql');
  assert.ok(postgres.sql.includes('SELECT $1, $2'));
  assert.ok(postgres.sql.includes('status = $3'));
  assert.deepStrictEqual(postgres.params, ['Ada', 37, 'active']);
}

function verifyDangerousSqlDetection() {
  assert.strictEqual(findDangerousSqlStatements("UPDATE users SET name = 'where';").length, 1);
  assert.strictEqual(findDangerousSqlStatements("DELETE FROM logs WHERE id = 1;").length, 0);
  assert.strictEqual(findDangerousSqlStatements("SELECT 'delete from x';").length, 0);
}

function verifyCodeLensProvider() {
  vscodeMock.languages.codeLensProviders = [];
  registerSqlCodeLensProvider();

  assert.strictEqual(vscodeMock.languages.codeLensProviders.length, 1);
  const provider = vscodeMock.languages.codeLensProviders[0].provider;
  const document = createTextDocument([
    'SELECT 1;',
    "SELECT ';' AS semicolon;",
  ].join('\n'));
  const lenses = provider.provideCodeLenses(document);

  assert.strictEqual(lenses.length, 2);
  assert.strictEqual(lenses[0].command.title, 'Run Statement');
  assert.strictEqual(lenses[1].command.title, 'Run Statement #2');
  assert.strictEqual(lenses[0].command.command, 'sqlWorkbench.query.runStatementAtRange');
  assert.strictEqual(lenses[0].command.arguments[0], document.uri);
  assert.ok(lenses[0].command.arguments[1] instanceof vscodeMock.Range);
}

async function verifyHoverProvider() {
  vscodeMock.languages.hoverProviders = [];
  const connection = {
    id: 'hover-connection',
    name: 'Hover Connection',
    type: 'postgresql',
    group: 'Verify',
  };
  const table = {
    connection,
    schema: 'public',
    name: 'users',
    type: 'table',
  };
  const schemaInspector = {
    async listTables() {
      return [table];
    },
    async getTableDetails() {
      return {
        ...table,
        columns: [
          { name: 'id', type: 'integer', nullable: false, primaryKey: true },
          { name: 'email', type: 'text', nullable: false, primaryKey: false },
        ],
        indexes: [
          { name: 'idx_users_email', columns: ['email'], unique: true },
        ],
      };
    },
  };

  registerSqlHoverProvider({
    async resolveConnection() {
      return connection;
    },
    schemaInspector,
  });

  assert.strictEqual(vscodeMock.languages.hoverProviders.length, 1);
  const provider = vscodeMock.languages.hoverProviders[0].provider;
  const document = createTextDocument('SELECT * FROM public.users WHERE id = 1');
  const hover = await provider.provideHover(
    document,
    document.positionAt(document.getText().indexOf('users') + 1),
  );

  assert.ok(hover instanceof vscodeMock.Hover);
  assert.ok(hover.contents.value.includes('Primary key'));
  assert.ok(hover.contents.value.includes('idx_users_email'));
  assert.ok(hover.contents.value.includes('email'));
}

function verifyResultExportSerializers() {
  const display = __resultViewPanelTestHooks.toDisplayResult({
    sql: 'SELECT * FROM items',
    columns: [
      { name: 'id', type: 'integer' },
      { name: 'note', type: 'text' },
      { name: 'enabled', type: 'boolean' },
      { name: 'payload', type: 'blob' },
    ],
    rows: [
      [1, '=SUM(1,1)', true, Uint8Array.from([1, 2, 3])],
      [2, 'line one\n"quoted", line two', null, '-not-a-formula'],
    ],
    rowCount: 2,
    elapsedMs: 3,
  });

  const firstPage = __resultViewPanelTestHooks.sliceDisplayResult(display, 1, 1);
  assert.strictEqual(firstPage.values.length, 1);

  const csv = __resultViewPanelTestHooks.toCsv(display);
  assert.ok(csv.startsWith('id,note,enabled,payload\n'));
  assert.ok(csv.includes("1,\"'=SUM(1,1)\",true,<BLOB 3 bytes>"));
  assert.ok(csv.includes('"line one\n""quoted"", line two"'));
  assert.ok(csv.includes("'-not-a-formula"));

  const json = JSON.parse(__resultViewPanelTestHooks.toJson(display));
  assert.deepStrictEqual(json[0], {
    id: 1,
    note: '=SUM(1,1)',
    enabled: true,
    payload: { type: 'blob', bytes: 3 },
  });
  assert.strictEqual(json[1].enabled, null);

  const xlsx = __resultViewPanelTestHooks.toExportBuffer(display, 'xlsx');
  assert.strictEqual(xlsx.readUInt32LE(0), 0x04034b50);
  assert.ok(xlsx.includes(Buffer.from('xl/worksheets/sheet1.xml')));
  assert.ok(xlsx.includes(Buffer.from('line one')));

  vscodeMock.workspace.workspaceFolders = [];
  assert.strictEqual(__resultViewPanelTestHooks.getExportDefaultUri('result.csv'), undefined);
  vscodeMock.workspace.workspaceFolders = [toWorkspaceFolder('/tmp/sql-workbench-export')];
  assert.strictEqual(
    __resultViewPanelTestHooks.getExportDefaultUri('result.csv').fsPath,
    path.join('/tmp/sql-workbench-export', 'result.csv'),
  );
  vscodeMock.workspace.workspaceFolders = [];
}

function verifyConnectionFormRendering() {
  const webview = { cspSource: 'vscode-webview-test' };
  const addHtml = __connectionFormPanelTestHooks.renderConnectionFormHtml(webview);
  assert.ok(addHtml.includes('const initial = null;'));
  assert.ok(addHtml.includes('<h1>连接至服务</h1>'));

  const editHtml = __connectionFormPanelTestHooks.renderConnectionFormHtml(webview, {
    id: 'edit-me',
    name: 'Prod <Main>',
    type: 'postgresql',
    group: 'Ops',
    host: 'db.local',
    port: 5432,
    database: 'app',
    username: 'postgres',
  });
  assert.ok(editHtml.includes('<h1>编辑连接</h1>'));
  assert.ok(editHtml.includes('留空保留现有密码'));
  assert.ok(editHtml.includes('Prod \\u003cMain>'));
}


async function verifyDriverPageConnectionLifecycle() {
  const mysqlModule = require('mysql2/promise');
  const pgModule = require('pg');
  const originalCreateConnection = mysqlModule.createConnection;
  const originalClient = pgModule.Client;
  let mysqlEnded = false;
  let pgEnded = false;

  try {
    mysqlModule.createConnection = async () => ({
      async query(query) {
        await Promise.resolve();
        if (mysqlEnded) {
          throw new Error('mysql query ran after end');
        }

        return [
          [{ id: 2, name: 'Grace', meta: { ok: true } }],
          [{ name: 'id', type: 3 }, { name: 'name', type: 253 }, { name: 'meta', type: 245 }],
        ];
      },
      async end() {
        mysqlEnded = true;
      },
    });

    pgModule.Client = class FakePageClient {
      async connect() {}

      async query(sql) {
        await Promise.resolve();
        if (pgEnded) {
          throw new Error('postgres query ran after end');
        }

        return {
          rows: [{ id: 2, name: 'Grace', meta: { ok: true } }],
          fields: [{ name: 'id', dataTypeID: 23 }, { name: 'name', dataTypeID: 25 }, { name: 'meta', dataTypeID: 3802 }],
          rowCount: 1,
        };
      }

      async end() {
        pgEnded = true;
      }
    };

    const runner = createQueryRunner();
    const mysqlPage = await runner.fetchPage({
      id: 'mysql-page',
      name: 'MySQL Page',
      type: 'mysql',
      group: 'Verify',
      host: '127.0.0.1',
      database: 'app',
      username: 'root',
    }, {
      sql: 'SELECT * FROM users',
      page: 2,
      pageSize: 10,
      totalRows: 25,
    });
    assert.strictEqual(mysqlPage.error, undefined);
    assert.deepStrictEqual(mysqlPage.rows[0], [2, 'Grace', '{"ok":true}']);
    assert.strictEqual(mysqlPage.columns[2].type, 'json');
    assert.strictEqual(mysqlEnded, true);

    const pgPage = await runner.fetchPage({
      id: 'pg-page',
      name: 'PostgreSQL Page',
      type: 'postgresql',
      group: 'Verify',
      host: '127.0.0.1',
      database: 'app',
      username: 'postgres',
    }, {
      sql: 'SELECT * FROM users',
      page: 2,
      pageSize: 10,
      totalRows: 25,
    });
    assert.strictEqual(pgPage.error, undefined);
    assert.deepStrictEqual(pgPage.rows[0], [2, 'Grace', '{"ok":true}']);
    assert.strictEqual(pgPage.columns[2].type, 'jsonb');
    assert.strictEqual(pgEnded, true);
  } finally {
    mysqlModule.createConnection = originalCreateConnection;
    pgModule.Client = originalClient;
  }
}

async function verifyDriverTableDdl() {
  const mysqlModule = require('mysql2/promise');
  const pgModule = require('pg');
  const originalCreateConnection = mysqlModule.createConnection;
  const originalClient = pgModule.Client;
  const mysqlQueries = [];
  const pgQueries = [];
  let mysqlEnded = false;
  let pgEnded = false;

  try {
    mysqlModule.createConnection = async () => ({
      async query(sql) {
        mysqlQueries.push(sql);
        return [[{
          Table: 'order`items',
          'Create Table': 'CREATE TABLE `order``items` (`id` bigint NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB',
        }]];
      },
      async end() {
        mysqlEnded = true;
      },
    });

    pgModule.Client = class FakeDdlClient {
      async connect() {}

      async query(sql, params) {
        pgQueries.push({ sql: String(sql), params });
        const text = String(sql);
        if (text.includes('c.oid::text AS oid')) {
          return {
            rows: [{
              oid: '42',
              relation_kind: 'r',
              is_partition: false,
              relation_options: ['fillfactor=80'],
              tablespace: null,
              table_comment: "Customer's orders",
              partition_key: null,
              parent_schema: null,
              parent_name: null,
              partition_bound: null,
            }],
          };
        }
        if (text.includes('FROM pg_attribute attribute')) {
          return {
            rows: [
              {
                name: 'id',
                type: 'bigint',
                not_null: true,
                identity_kind: 'd',
                generated_kind: '',
                default_value: null,
                collation: null,
                comment: 'Primary id',
              },
              {
                name: 'display_name',
                type: 'text',
                not_null: false,
                identity_kind: '',
                generated_kind: '',
                default_value: "'unknown'::text",
                collation: null,
                comment: null,
              },
            ],
          };
        }
        if (text.includes('FROM pg_constraint constraint_definition')) {
          return {
            rows: [{ name: 'order"items_pkey', definition: 'PRIMARY KEY (id)' }],
          };
        }
        if (text.includes('FROM pg_index table_index')) {
          return {
            rows: [{ definition: 'CREATE INDEX order_items_name_idx ON "team""a"."order""items" USING btree (display_name)' }],
          };
        }
        throw new Error(`Unexpected PostgreSQL DDL query: ${text}`);
      }

      async end() {
        pgEnded = true;
      }
    };

    const inspector = createSchemaInspector();
    const mysqlDdl = await inspector.getTableDdl({
      connection: {
        id: 'mysql-ddl',
        name: 'MySQL DDL',
        type: 'mysql',
        group: 'Verify',
        host: '127.0.0.1',
        database: 'team`a',
        username: 'root',
      },
      schema: 'team`a',
      name: 'order`items',
    });
    assert.strictEqual(mysqlQueries[0], 'SHOW CREATE TABLE `team``a`.`order``items`;');
    assert.ok(mysqlDdl.endsWith('ENGINE=InnoDB;'));
    assert.strictEqual(mysqlEnded, true);

    const postgresqlDdl = await inspector.getTableDdl({
      connection: {
        id: 'pg-ddl',
        name: 'PostgreSQL DDL',
        type: 'postgresql',
        group: 'Verify',
        host: '127.0.0.1',
        database: 'app',
        username: 'postgres',
      },
      schema: 'team"a',
      name: 'order"items',
    });
    assert.ok(postgresqlDdl.includes('CREATE TABLE "team""a"."order""items"'));
    assert.ok(postgresqlDdl.includes('"id" bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL'));
    assert.ok(postgresqlDdl.includes('CONSTRAINT "order""items_pkey" PRIMARY KEY (id)'));
    assert.strictEqual((postgresqlDdl.match(/PRIMARY KEY/g) ?? []).length, 1);
    assert.ok(postgresqlDdl.includes('CREATE INDEX order_items_name_idx'));
    assert.ok(postgresqlDdl.includes("COMMENT ON TABLE \"team\"\"a\".\"order\"\"items\" IS 'Customer''s orders';"));
    assert.ok(postgresqlDdl.includes('COMMENT ON COLUMN "team""a"."order""items"."id" IS \'Primary id\';'));
    assert.deepStrictEqual(pgQueries[0].params, ['team"a', 'order"items']);
    assert.strictEqual(pgEnded, true);
  } finally {
    mysqlModule.createConnection = originalCreateConnection;
    pgModule.Client = originalClient;
  }
}

async function verifyDocumentBindingRestore() {
  const connection = {
    id: 'binding-connection',
    name: 'Binding Connection',
    type: 'sqlite',
    group: 'Verify',
    path: '/tmp/binding.sqlite',
  };
  const context = {
    globalState: createMemento(),
    workspaceState: createMemento(),
  };
  const registry = {
    async get(id) {
      return id === connection.id ? connection : undefined;
    },
    async list() {
      return [connection];
    },
  };
  const originalSql = [
    'SELECT id, name, created_at',
    'FROM users',
    'WHERE created_at >= :start_date',
    'ORDER BY created_at DESC;',
  ].join('\n');
  const original = createTextDocument(originalSql, '/tmp/sql-workbench-original.sql');
  const state = new ActiveConnectionState(context, registry);

  await state.set(connection.id, original);
  assert.strictEqual(state.getId(original), connection.id);

  await state.set(undefined, original);
  assert.strictEqual(state.getId(original), undefined);

  await state.set(connection.id, original);
  const restoredState = new ActiveConnectionState(context, registry);
  const moved = createTextDocument(originalSql.replace(/\n/g, '\r\n'), '/tmp/sql-workbench-moved.sql');

  vscodeMock.window.nextInformationMessage = 'Restore Connection';
  const restored = await restoredState.restoreDocumentBinding(moved);
  assert.strictEqual(restored.name, connection.name);
  assert.strictEqual(restoredState.getId(moved), connection.id);
  assert.ok(vscodeMock.window.infoMessages.some((message) => message.includes('/tmp/sql-workbench-original.sql')));
}

async function verifyConnectionSecrets() {
  const globalState = createMemento();
  const secrets = createSecretStorage();
  const store = new ConnectionStore(globalState, secrets);

  const connection = await store.create({
    id: 'secret-pg',
    name: 'Secret PostgreSQL',
    type: 'postgresql',
    group: 'Verify',
    host: '127.0.0.1',
    database: 'app',
    username: 'postgres',
  }, 'super-secret');

  const storedState = globalState.get('databaseClient.connections');
  assert.strictEqual(storedState.connections.length, 1);
  assert.strictEqual(storedState.connections[0].id, connection.id);
  assert.strictEqual('password' in storedState.connections[0], false);
  assert.strictEqual(await store.getPassword(connection.id), 'super-secret');
  assert.strictEqual(secrets.values.get(`databaseClient.connection.${connection.id}.password`), 'super-secret');

  await store.delete(connection.id);
  assert.strictEqual(await store.getPassword(connection.id), undefined);
}

async function verifySqliteReadOnlyResults() {
  const dbPath = path.join(os.tmpdir(), `sql-workbench-v02-${process.pid}.sqlite`);
  fs.rmSync(dbPath, { force: true });

  try {
    const runner = createQueryRunner();
    const connection = {
      id: 'sqlite-v02',
      name: 'SQLite v0.2',
      type: 'sqlite',
      group: 'Verify',
      path: dbPath,
    };

    await runner.execute(connection, [
      'CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, qty INTEGER);',
      'CREATE UNIQUE INDEX idx_items_name ON items (name);',
      "INSERT INTO items (name, qty) VALUES ('apple', 3);",
    ].join('\n'));

    const inspector = createSchemaInspector();
    const details = await inspector.getTableDetails({ connection, name: 'items' });
    assert.strictEqual(details.columns.find((column) => column.name === 'id').primaryKey, true);
    assert.ok(details.indexes.some((index) =>
      index.name === 'idx_items_name'
      && index.unique
      && index.columns.join(',') === 'name',
    ));
    const ddl = await inspector.getTableDdl({ connection, name: 'items' });
    assert.ok(ddl.includes('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, qty INTEGER);'));
    assert.ok(ddl.includes('CREATE UNIQUE INDEX idx_items_name ON items (name);'));

    const [page] = await runner.execute(connection, 'SELECT * FROM items');
    assert.deepStrictEqual(page.rows[0], [1, 'apple', 3]);
    assert.strictEqual('editable' in page, false);
    assert.strictEqual('updateCell' in runner, false);
  } finally {
    fs.rmSync(dbPath, { force: true });
  }
}

async function verifyTableDetailsPanel() {
  const originalCreateWebviewPanel = vscodeMock.window.createWebviewPanel;
  const originalEnv = vscodeMock.env;
  const postedMessages = [];
  const clipboardValues = [];
  let panelDisposed = false;
  let loadCount = 0;
  let resolveOldDdl;

  const webview = {
    cspSource: 'vscode-webview://verify',
    html: '',
    async postMessage(message) {
      postedMessages.push(message);
      return true;
    },
    onDidReceiveMessage() {
      return { dispose() {} };
    },
  };
  const webviewPanel = {
    webview,
    title: '',
    reveal() {},
    onDidDispose(listener) {
      this.disposeListener = listener;
      return { dispose() {} };
    },
    dispose() {
      panelDisposed = true;
      this.disposeListener?.();
    },
  };

  vscodeMock.window.createWebviewPanel = () => webviewPanel;
  vscodeMock.env = {
    clipboard: {
      async writeText(value) {
        clipboardValues.push(value);
      },
    },
  };

  try {
    const connection = {
      id: 'panel-sqlite',
      name: 'Panel SQLite',
      type: 'sqlite',
      group: 'Verify',
      path: '/tmp/panel.sqlite',
    };
    const details = createTableDetails(connection, 'items');
    const panel = new TableDetailsPanel(vscodeMock.Uri.file('/extension'), {
      loadDdl(table) {
        loadCount += 1;
        if (table.name === 'old_table') {
          return new Promise((resolve) => {
            resolveOldDdl = resolve;
          });
        }
        return Promise.resolve(`CREATE TABLE ${table.name} (id INTEGER);`);
      },
    });

    panel.show(details);
    assert.ok(webview.html.includes('data-tab="columns"'));
    assert.ok(webview.html.includes('data-tab="ddl"'));
    assert.ok(!webview.html.includes('CREATE TABLE items'));

    await panel.handleMessage({ type: 'loadDdl', force: false });
    assert.strictEqual(loadCount, 1);
    assert.ok(postedMessages.some((message) => message.status === 'loaded' && message.ddl.includes('items')));
    assert.ok(postedMessages.some((message) =>
      message.status === 'loaded'
      && message.ddlHtml.includes('sql-keyword')
      && message.ddlHtml.includes('sql-type'),
    ));

    await panel.handleMessage({ type: 'loadDdl', force: false });
    assert.strictEqual(loadCount, 1);
    await panel.handleMessage({ type: 'loadDdl', force: true });
    assert.strictEqual(loadCount, 2);
    await panel.handleMessage({ type: 'copyDdl' });
    assert.deepStrictEqual(clipboardValues, ['CREATE TABLE items (id INTEGER);']);

    panel.show(createTableDetails(connection, 'old_table'));
    const oldRequest = panel.handleMessage({ type: 'loadDdl', force: true });
    panel.show(createTableDetails(connection, 'new_table'));
    await panel.handleMessage({ type: 'loadDdl', force: true });
    resolveOldDdl('CREATE TABLE old_table (id INTEGER);');
    await oldRequest;

    assert.ok(postedMessages.some((message) => message.status === 'loaded' && message.ddl?.includes('new_table')));
    assert.ok(!postedMessages.some((message) => message.status === 'loaded' && message.ddl?.includes('old_table')));
    panel.dispose();
    assert.strictEqual(panelDisposed, true);
  } finally {
    vscodeMock.window.createWebviewPanel = originalCreateWebviewPanel;
    vscodeMock.env = originalEnv;
  }
}

function verifyTableDetailsWebview() {
  const details = createTableDetails({
    id: 'table-webview',
    name: 'Webview Connection',
    type: 'sqlite',
    group: 'Verify',
    path: '/tmp/webview.sqlite',
  }, '<unsafe-table>');
  const html = __tableDetailsPanelTestHooks.renderTableDetailsHtml(
    { cspSource: 'vscode-webview://verify' },
    details,
  );
  assert.ok(html.includes('&lt;unsafe-table&gt;'));
  assert.ok(!html.includes('<unsafe-table>'));
  assert.ok(html.includes("script-src 'nonce-"));
  assert.ok(html.includes('tab-icon-columns'));
  assert.ok(html.includes('tab-icon-ddl'));

  const unsafeDdl = [
    'CREATE TABLE `<unsafe>` (',
    '  "id" BIGINT NOT NULL,',
    "  name VARCHAR(42) DEFAULT 'x<y'",
    '); -- table comment',
  ].join('\n');
  const highlightedDdl = __tableDetailsPanelTestHooks.highlightSql(unsafeDdl);
  assert.ok(highlightedDdl.includes('<span class="sql-keyword">CREATE</span>'));
  assert.ok(highlightedDdl.includes('<span class="sql-type">VARCHAR</span>'));
  assert.ok(highlightedDdl.includes('<span class="sql-number">42</span>'));
  assert.ok(highlightedDdl.includes('<span class="sql-string">&#39;x&lt;y&#39;</span>'));
  assert.ok(highlightedDdl.includes('<span class="sql-comment">-- table comment</span>'));
  assert.ok(highlightedDdl.includes('`&lt;unsafe&gt;`'));
  assert.ok(!highlightedDdl.includes('<unsafe>'));

  const harness = createTableDetailsDomHarness();
  vm.createContext(harness.context);
  vm.runInContext(__tableDetailsPanelTestHooks.getClientScript(), harness.context);

  harness.click(harness.elements.ddlTab);
  assertJsonEqual(harness.messages.shift(), { type: 'loadDdl', force: false });
  assert.strictEqual(harness.elements.ddlPanel.hidden, false);
  assert.strictEqual(harness.elements.columnsPanel.hidden, true);

  harness.emitMessage({
    type: 'ddlState',
    status: 'loaded',
    ddl: unsafeDdl,
    ddlHtml: highlightedDdl,
  });
  assert.strictEqual(harness.elements.ddlCode.innerHTML, highlightedDdl);
  assert.ok(!harness.elements.ddlCode.innerHTML.includes('<unsafe>'));
  assert.strictEqual(harness.elements.ddlCode.hidden, false);
  assert.strictEqual(harness.elements.ddlToolbar.hidden, false);

  harness.click(harness.elements.copyAction);
  assertJsonEqual(harness.messages.shift(), { type: 'copyDdl' });
  harness.click(harness.elements.refreshAction);
  assertJsonEqual(harness.messages.shift(), { type: 'loadDdl', force: true });

  harness.emitMessage({ type: 'ddlState', status: 'error', message: 'DDL unavailable' });
  assert.strictEqual(harness.elements.ddlState.children[0].textContent, 'DDL unavailable');
  const retry = harness.elements.ddlState.children[1];
  harness.click(retry);
  assertJsonEqual(harness.messages.shift(), { type: 'loadDdl', force: true });
}

function createTableDetails(connection, name) {
  return {
    connection,
    name,
    columns: [{
      name: 'id',
      type: 'INTEGER',
      nullable: false,
      primaryKey: true,
      ordinal: 0,
    }],
  };
}

function verifyResultWebviewScript() {
  const code = fs.readFileSync(path.join(outDir, 'results', 'resultViewPanel.js'), 'utf8');
  const context = {
    exports: {},
    module: { exports: {} },
    require(name) {
      if (name === 'vscode') {
        return {
          workspace: {
            getConfiguration() {
              return { get() { return 10; } };
            },
          },
          window: {},
          ViewColumn: { Active: -1, Beside: 2 },
          Uri: { file(value) { return value; } },
        };
      }

      return require(name);
    },
    Buffer,
    console,
    setTimeout,
  };

  vm.createContext(context);
  vm.runInContext(`${code}\nexports.__script = getClientScript();`, context);
  new Function(context.exports.__script);
  assert.ok(!context.exports.__script.includes('updateCell'));
  assert.ok(!context.exports.__script.includes('Edit Cell Value'));
  assert.ok(!context.exports.__script.includes('modal-save'));
  assert.ok(!context.exports.__script.includes('modal-revert'));
}

function verifyResultWebviewBehavior() {
  const dom = createWebviewDomHarness();
  const vscodeMessages = [];
  const context = {
    acquireVsCodeApi() {
      return {
        postMessage(message) {
          vscodeMessages.push(message);
        },
      };
    },
    window: dom.window,
    document: dom.document,
    JSON,
    Number,
    String,
    Math,
  };
  vm.createContext(context);
  vm.runInContext(__resultViewPanelTestHooks.getClientScript(), context);

  assertJsonEqual(vscodeMessages.shift(), { type: 'ready' });

  dom.emitWindowMessage({
    type: 'results',
    payload: createWebviewPayload(),
  });
  assert.ok(dom.query('[data-body="0"]').innerHTML.includes('<table>'));

  dom.click({ action: 'json', index: '0' });
  assert.ok(dom.query('[data-body="0"]').innerHTML.includes('json-view'));
  assert.ok(
    dom.query('[data-body="0"]').innerHTML.includes('&quot;meta&quot;')
      && dom.query('[data-body="0"]').innerHTML.includes('\\&quot;ok\\&quot;'),
    dom.query('[data-body="0"]').innerHTML,
  );

  assert.ok(dom.query('[data-body="0"]').innerHTML.includes('⇩ 导出'));
  assert.ok(!dom.query('[data-body="0"]').innerHTML.includes('CSV Page'));

  dom.click({ action: 'export-open', index: '0' });
  assert.ok(dom.document.body.lastInsertedHtml.includes('导出选项'));
  assert.ok(dom.document.body.lastInsertedHtml.includes('XLSX'));

  dom.click({ action: 'export-format', format: 'xlsx' });
  dom.click({ action: 'export-scope', scope: 'all' });
  dom.click({ action: 'export-confirm' });
  assertJsonEqual(vscodeMessages.pop(), {
    type: 'exportResult',
    payload: {
      resultIndex: 0,
      format: 'xlsx',
      scope: 'all',
      page: 1,
      pageSize: 10,
    },
  });

  const largePayload = createWebviewPayload();
  largePayload.results[0].rowCount = 50001;
  largePayload.results[0].pagination = {
    mode: 'server',
    sourceSql: 'SELECT * FROM items',
    page: 1,
    pageSize: 10,
    totalRows: 50001,
  };
  dom.emitWindowMessage({
    type: 'results',
    payload: largePayload,
  });
  dom.click({ action: 'export-open', index: '0' });
  assert.ok(dom.document.body.lastInsertedHtml.includes('数据量过大'));
  assert.ok(dom.document.body.lastInsertedHtml.includes('disabled'));

  dom.click({ action: 'table', index: '0' });
  const resultBody = dom.query('[data-body="0"]').innerHTML;
  assert.strictEqual((resultBody.match(/data-action="view-cell"/gu) ?? []).length, 1);

  dom.click({ action: 'view-cell', index: '0', row: '0', column: '1' });
  assert.ok(dom.document.body.lastInsertedHtml.includes('View Cell Value'));
  assert.ok(dom.document.body.lastInsertedHtml.includes('&quot;ok&quot;'));
  assert.ok(dom.document.body.lastInsertedHtml.includes(' readonly>'));
  assert.ok(dom.document.body.lastInsertedHtml.includes('data-action="modal-format">Format</button>'));
  assert.ok(dom.document.body.lastInsertedHtml.includes('data-action="modal-copy">Copy</button>'));
  assert.ok(dom.document.body.lastInsertedHtml.includes('data-action="modal-close">Close</button>'));
  assert.ok(!dom.document.body.lastInsertedHtml.includes('modal-save'));
  assert.ok(!dom.document.body.lastInsertedHtml.includes('modal-revert'));
  assert.ok(!dom.document.body.lastInsertedHtml.includes('Edit Cell Value'));

  const viewer = dom.document.getElementById('cell-viewer');
  dom.click({ action: 'modal-format' });
  assert.strictEqual(viewer.value, '{\n  "ok": true\n}');

  dom.click({ action: 'modal-close' });
  dom.click({ action: 'view-cell', index: '0', row: '0', column: '2' });
  assert.strictEqual(dom.document.getElementById('cell-modal'), undefined);
}

function createWebviewPayload() {
  return {
    connectionName: 'Verify',
    elapsedMs: 4,
    hasError: false,
    pageSize: 10,
    resultCount: 1,
    totalRows: 1,
    results: [
      {
        sql: 'SELECT * FROM items',
        columns: [
          { name: 'id', type: 'integer' },
          { name: 'meta', type: 'json' },
          { name: 'json_like_text', type: 'text' },
        ],
        rows: [
          ['1', '{"ok":true}', '{"text":true}'],
        ],
        values: [
          [1, '{"ok":true}', '{"text":true}'],
        ],
        rowCount: 1,
        elapsedMs: 4,
        connectionId: 'webview-connection',
      },
    ],
  };
}

function createTableDetailsDomHarness() {
  const listeners = {};
  const messages = [];

  function createElement(id, dataset = {}) {
    const classes = new Set();
    return {
      id,
      dataset,
      hidden: false,
      textContent: '',
      innerHTML: '',
      children: [],
      style: {},
      attributes: {},
      className: '',
      classList: {
        toggle(name, force) {
          if (force) classes.add(name);
          else classes.delete(name);
        },
        contains(name) {
          return classes.has(name);
        },
      },
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
      append(...children) {
        this.children.push(...children);
      },
      closest(selector) {
        if (selector === '[data-tab]' && this.dataset.tab) return this;
        if (selector === '[data-action]' && this.dataset.action) return this;
        return undefined;
      },
    };
  }

  const elements = {
    columnsTab: createElement('columns-tab', { tab: 'columns' }),
    ddlTab: createElement('ddl-tab', { tab: 'ddl' }),
    columnsPanel: createElement('columns-panel'),
    ddlPanel: createElement('ddl-panel'),
    ddlState: createElement('ddl-state'),
    ddlCode: createElement('ddl-code'),
    ddlToolbar: createElement('ddl-toolbar'),
    copyAction: createElement('copy-action', { action: 'copy' }),
    refreshAction: createElement('refresh-action', { action: 'refresh' }),
  };
  elements.ddlPanel.hidden = true;
  elements.ddlCode.hidden = true;
  elements.ddlToolbar.hidden = true;

  const byId = new Map([
    ['columns-panel', elements.columnsPanel],
    ['ddl-panel', elements.ddlPanel],
    ['ddl-state', elements.ddlState],
    ['ddl-code', elements.ddlCode],
    ['ddl-toolbar', elements.ddlToolbar],
  ]);
  const document = {
    addEventListener(type, listener) {
      listeners[type] = listener;
    },
    querySelectorAll(selector) {
      return selector === '[data-tab]' ? [elements.columnsTab, elements.ddlTab] : [];
    },
    querySelector(selector) {
      return selector === '[data-action="copy"]' ? elements.copyAction : undefined;
    },
    getElementById(id) {
      return byId.get(id);
    },
    createElement(id) {
      return createElement(id);
    },
  };
  const window = {
    addEventListener(type, listener) {
      if (type === 'message') listeners.message = listener;
    },
    setTimeout(callback) {
      callback();
    },
  };

  return {
    messages,
    elements,
    context: {
      acquireVsCodeApi() {
        return {
          postMessage(message) {
            messages.push(message);
          },
        };
      },
      document,
      window,
      Boolean,
      String,
    },
    click(element) {
      listeners.click({ target: element });
    },
    emitMessage(data) {
      listeners.message({ data });
    },
  };
}

function createWebviewDomHarness() {
  const elements = new Map();
  const listeners = {
    windowMessage: undefined,
    click: undefined,
    keydown: undefined,
  };
  const modal = {
    removed: false,
    remove() {
      this.removed = true;
    },
  };
  let activeModalId;
  const viewer = {
    value: '',
    select() {},
    focus() {},
  };
  const modalStatus = {
    textContent: '',
    className: '',
  };

  function getElement(id) {
    if (!elements.has(id)) {
      elements.set(id, { id, innerHTML: '', textContent: '' });
    }
    return elements.get(id);
  }

  const document = {
    body: {
      lastInsertedHtml: '',
      insertAdjacentHTML(_position, html) {
        this.lastInsertedHtml = html;
        const idMatch = html.match(/id="([^"]+)"/u);
        activeModalId = idMatch ? idMatch[1] : undefined;
        viewer.value = decodeHtml(readTextareaValue(html));
        modal.removed = false;
      },
    },
    addEventListener(type, listener) {
      listeners[type] = listener;
    },
    getElementById(id) {
      if (id === 'cell-modal' || id === 'export-modal') {
        return activeModalId === id && !modal.removed ? modal : undefined;
      }
      if (id === 'cell-viewer') {
        return viewer;
      }
      if (id === 'modal-status') {
        return modalStatus;
      }
      return getElement(id);
    },
    querySelector(selector) {
      return getElement(selector);
    },
    execCommand() {
      return true;
    },
  };
  const window = {
    addEventListener(type, listener) {
      if (type === 'message') {
        listeners.windowMessage = listener;
      }
    },
  };

  return {
    document,
    window,
    query(selector) {
      return getElement(selector);
    },
    emitWindowMessage(data) {
      listeners.windowMessage({ data });
    },
    click(dataset) {
      listeners.click({
        target: {
          closest(selector) {
            return selector === 'button[data-action]' ? { dataset } : undefined;
          },
        },
      });
    },
  };
}

function readTextareaValue(html) {
  const match = html.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/u);
  return match ? match[1] : '';
}

function decodeHtml(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function assertJsonEqual(actual, expected) {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(actual)), expected);
}

function createTextDocument(text, filePath = path.join(os.tmpdir(), 'verify.sql'), languageId = 'sql') {
  return {
    uri: vscodeMock.Uri.file(filePath),
    languageId,
    getText(range) {
      if (!range) {
        return text;
      }
      return text.slice(offsetAt(text, range.start), offsetAt(text, range.end));
    },
    positionAt(offset) {
      return positionAt(text, offset);
    },
    getWordRangeAtPosition(position, regex) {
      const offset = offsetAt(text, position);
      const pattern = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        if (start <= offset && offset <= end) {
          return new vscodeMock.Range(positionAt(text, start), positionAt(text, end));
        }
        if (match[0].length === 0) {
          pattern.lastIndex += 1;
        }
      }
      return undefined;
    },
  };
}

function positionAt(text, offset) {
  const bounded = Math.max(0, Math.min(offset, text.length));
  const before = text.slice(0, bounded).split('\n');
  return new vscodeMock.Position(before.length - 1, before[before.length - 1].length);
}

function offsetAt(text, position) {
  const lines = text.split('\n');
  let offset = 0;
  for (let line = 0; line < Math.min(position.line, lines.length); line += 1) {
    offset += lines[line].length + 1;
  }
  return offset + position.character;
}

function createMemento() {
  const values = new Map();

  return {
    get(key, defaultValue) {
      return values.has(key) ? values.get(key) : defaultValue;
    },
    async update(key, value) {
      if (value === undefined) {
        values.delete(key);
      } else {
        values.set(key, value);
      }
    },
  };
}

function createSecretStorage() {
  const values = new Map();

  return {
    values,
    async get(key) {
      return values.get(key);
    },
    async store(key, value) {
      values.set(key, value);
    },
    async delete(key) {
      values.delete(key);
    },
  };
}

function createVscodeMock() {
  return {
    Uri: {
      file(value) {
        return {
          scheme: 'file',
          fsPath: value,
          path: value,
          toString() {
            return `file://${value}`;
          },
        };
      },
      parse(value) {
        if (value.startsWith('file://')) {
          return this.file(value.slice('file://'.length));
        }

        return {
          scheme: value.split(':')[0] || 'file',
          fsPath: value,
          path: value,
          toString() {
            return value;
          },
        };
      },
      joinPath(base, ...segments) {
        const root = base.fsPath || base.path || String(base);
        return this.file(path.join(root, ...segments));
      },
    },
    workspace: {
      workspaceFolders: [],
      fs: {
        async readFile(uri) {
          return fs.promises.readFile(uri.fsPath);
        },
      },
      getConfiguration() {
        return { get() { return 10; } };
      },
    },
    languages: {
      codeLensProviders: [],
      hoverProviders: [],
      registerCodeLensProvider(selector, provider) {
        this.codeLensProviders.push({ selector, provider });
        return { dispose() {} };
      },
      registerHoverProvider(selector, provider) {
        this.hoverProviders.push({ selector, provider });
        return { dispose() {} };
      },
    },
    window: {
      messages: [],
      infoMessages: [],
      nextInformationMessage: undefined,
      showInformationMessage(message) {
        this.infoMessages.push(message);
        const selected = this.nextInformationMessage;
        this.nextInformationMessage = undefined;
        return Promise.resolve(selected);
      },
      showWarningMessage(message) {
        this.messages.push(message);
        return Promise.resolve(undefined);
      },
    },
    Position: class Position {
      constructor(line, character) {
        this.line = line;
        this.character = character;
      }
    },
    Range: class Range {
      constructor(startLineOrPosition, startCharacterOrPosition, endLine, endCharacter) {
        if (typeof startLineOrPosition === 'number') {
          this.start = new vscodeMock.Position(startLineOrPosition, startCharacterOrPosition);
          this.end = new vscodeMock.Position(endLine, endCharacter);
        } else {
          this.start = startLineOrPosition;
          this.end = startCharacterOrPosition;
        }
      }
    },
    CodeLens: class CodeLens {
      constructor(range, command) {
        this.range = range;
        this.command = command;
      }
    },
    Hover: class Hover {
      constructor(contents, range) {
        this.contents = contents;
        this.range = range;
      }
    },
    MarkdownString: class MarkdownString {
      constructor(value = '') {
        this.value = value;
        this.isTrusted = false;
      }

      appendMarkdown(value) {
        this.value += value;
      }
    },
    ViewColumn: { Active: -1, Beside: 2 },
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
