# Database Client 竞品功能拆解与路线图

调研对象：

- 官网：https://database-client.com/
- 文档：https://database-client.com/docs
- VS Code Marketplace：
  - https://marketplace.visualstudio.com/items?itemName=cweijan.vscode-mysql-client2
  - https://marketplace.visualstudio.com/items?itemName=cweijan.vscode-database-client2
- 早期源码参考：https://github.com/cweijan/vscode-database-client

目标：参考 Database Client 的产品形态，实现我们自己的 VS Code 数据库插件。不做付费墙设计，竞品 Premium 能力在我们的产品中按优先级逐步免费实现。

## 1. 竞品定位

Database Client 不是单一 SQL 插件，而是一个集成在 VS Code 内的轻量数据库 IDE + 运维面板：

- Database 面板：SQL 数据库连接、Schema 树、表数据、SQL 查询、表设计、备份。
- Service 面板：Redis、MongoDB、ElasticSearch、Kafka、RabbitMQ、SSH、SFTP、Docker、S3、FTP、WebDAV 等。
- Webview 工作区：数据网格、表设计器、ER 图、Mock 数据、Manager 仪表盘等。
- 编辑器能力：SQL 语言贡献、补全、CodeLens、Hover DDL、变量、查询历史、Notebook。

竞品商业策略是免费版保留核心可用性，但把“高频效率增强”和“规模化连接能力”放入 Premium。我们的差异点应是：核心开发体验完整免费、隐私本地优先、可扩展数据源架构、清晰的工程质量。

## 2. 竞品功能拆解表

| 模块 | Database Client 功能 | 免费 / Premium 边界 | 用户价值 | 实现复杂度 | 我们的策略 |
| --- | --- | --- | --- | --- | --- |
| 连接管理 | Database / Service 双面板，连接树、分组、排序、缓存、导入导出配置 | 免费每个面板 3 个连接；Premium 无限连接、工作空间级连接、云同步 | 高频入口，决定插件是否可日常使用 | 中 | MVP 必做。无限连接默认免费；工作空间级连接放 v0.2 |
| SQL 数据源 | MySQL、PostgreSQL、SQLite、SQL Server、Oracle、DuckDB、ClickHouse、Snowflake 等 | 基础连接免费 | 覆盖主流开发场景 | 高 | MVP 先 MySQL/PostgreSQL/SQLite，完整版扩展到 SQL Server、DuckDB、ClickHouse |
| NoSQL / 服务 | Redis、MongoDB、ElasticSearch、Kafka、RabbitMQ、Neo4j、etcd、Zookeeper、Loki | 基础连接计入 Service 限制 | 一站式管理全栈数据组件 | 高 | v1.0 后分批实现，先 Redis/MongoDB |
| SQL 编辑器 | SQL 补全、片段、CodeLens Run、格式化、多语句执行、状态栏切换连接 | 基础免费 | 查询效率核心 | 中 | MVP 必做当前语句/选区执行、状态栏连接绑定、片段、历史；补全逐步增强 |
| SQL 变量 | `:name` / `$name` 占位，执行时输入或变量面板配置 | 免费 | 方便复用查询脚本 | 中 | v0.2 做轻量版本 |
| 查询结果 | Webview 数据网格、分页、多标签、刷新、自动刷新 | 基础免费 | 数据查看的核心体验 | 高 | MVP 必做分页表格、查询结果、错误展示 |
| 行内编辑 | 双击单元格修改，保存回数据库，长文本弹窗编辑 | 免费 | 替代外部数据库客户端 | 高 | v0.2 做 MySQL/PostgreSQL/SQLite 单表编辑 |
| 导出 | CSV、JSON、SQL、Markdown；复制为 CSV | Premium | 数据迁移、排查、报表临时导出 | 中 | v0.2 免费实现 CSV/JSON；v1.0 实现 SQL/Markdown |
| JSON 结果视图 | 查询结果以 JSON 模式展示 | Premium | 文档/JSON 字段查看方便 | 低 | v0.2 实现 |
| 表设计器 | 可视化列、索引、外键、DDL 预览与执行 | 基础免费；结构对比执行 Premium | 降低 DDL 操作门槛 | 高 | v1.0 做 MySQL/PostgreSQL；MVP 仅展示 DDL |
| DDL Hover / 跳转 | 表名 Hover 完整 DDL，Ctrl+Click 打开定义 | Premium 完整能力 | SQL 阅读与 Schema 探索效率 | 中 | v0.2 做 Hover 简版；v1.0 做定义跳转 |
| ER 图 | 自动布局表与外键关系、缩放、小地图、导出图片 | Premium 完整使用 | 理解复杂库结构 | 高 | v1.0 实现基础 ER；v1.5 增强交互与导出 |
| Mock 数据 | 表界面配置规则或 `mock.json` 生成测试数据 | Premium | 快速造数 | 中 | v1.0 实现规则化生成，使用 faker 类库 |
| 结构对比 | 比较两个数据库 / Schema 差异，生成迁移 SQL | Premium 执行 | 迁移和环境同步 | 高 | v1.5 实现，优先只生成 SQL，不自动执行 |
| 备份 / 导入 | Dump Struct/Data、Import SQL，优先调用 `mysqldump` / `pg_dump` | 右键 Dump 免费；网格导出 Premium | 迁移和备份 | 中 | v0.2 支持 SQL 文件执行；v1.0 支持 dump/restore |
| SSH | SSH 终端、SFTP 文件树、端口转发、服务器监控 | 终端和浏览免费；自动同步/隐藏文件 Premium | 数据库跳板机与远程运维 | 高 | v1.5 做 SSH 隧道；完整 SSH/SFTP 放后续 |
| HTTP/SOCKS 代理 | 连接经代理访问 | Premium | 企业网络/跳板场景 | 中 | v1.5 实现 |
| Docker | 容器/镜像管理、日志、终端、Stats、Compose、网络卷 | Service 连接限制 | 本地开发环境管理 | 高 | v2.0，可作为独立扩展包 |
| 云同步 | Database Client 服务端加密保存连接配置 | Premium | 多机同步 | 高，且涉及账号/安全 | 不做中心化账号；优先支持 VS Code Settings Sync + 本地加密导入导出 |
| AI 助手 | `@dbclient` Chat participant，列库表、执行查询 | 官网新版功能 | 降低查询门槛 | 中 | v1.5，可接 VS Code LM API，默认只读 |
| 遥测 | 匿名使用数据，可关闭 | 免费 / 付费均有 | 产品分析 | 低 | 默认不启用遥测；如需要必须显式开关 |

## 3. 我们的 MVP 范围

MVP 目标：先做到“开发者愿意日常用来连库、查表、跑 SQL、看结果”，不要一开始追求全家桶。

### v0.1 MVP

必须包含：

- VS Code Activity Bar：一个 Database 面板。
- 连接管理：
  - 新增、编辑、删除连接。
  - 分组。
  - 本地持久化。
  - 不限制连接数量。
- 数据源：
  - MySQL / MariaDB。
  - PostgreSQL。
  - SQLite。
- Schema 树：
  - 连接、数据库 / Schema、表、视图、列。
  - 展开表节点直接显示所有列，包含字段名和类型。
  - 点击表节点后，右侧打开表结构详情页，默认展示所有列信息。
  - 表结构详情页只读，不提供列编辑、删除、重命名等 GUI 写操作。
  - 刷新元数据缓存。
- SQL 编辑器：
  - SQL 写在 VS Code 原生 `.sql` 编辑器中，不放在插件私有编辑器里。
  - 从连接树 **Open Query** 时创建或打开 `.sql` 文档，并自动绑定当前连接。
  - 对已有 `.sql` 文件，通过状态栏 `DB: 连接名 / database` 绑定或切换连接。
  - 状态栏点击后弹出 QuickPick，支持搜索连接，并标注当前连接。
  - 打开绑定连接的 Query。
  - 执行选区或当前语句。
  - 执行全部语句。
  - 基础 SQL snippet：`sel`、`ins`、`upd`、`del`、`joi`。
  - 基础 SQL 提示：关键字、片段、当前连接下的表名和字段名。
  - 无 `WHERE` 的 UPDATE / DELETE 二次确认。
- 结果视图：
  - Webview 表格展示，只读。
  - 服务端分页。
  - 错误信息、执行耗时、影响行数。
  - 复制单元格 / 行。
- 表数据浏览：
  - 点击表打开 `SELECT * LIMIT n`。
  - 默认 limit 设置。
- 查询历史：
  - 本地记录 SQL、连接、耗时、时间。
  - 从历史重新打开。
- 写操作边界：
  - MVP 不支持结果表格内直接编辑值。
  - MVP 不支持列信息页内直接编辑、删除、重命名列。
  - 所有数据修改和结构修改都必须通过 SQL 执行。

暂不包含：

- 行内编辑。
- 表设计器。
- ER 图。
- SSH / Docker / Redis / MongoDB。
- 云同步账号体系。

### v0.2 增强版

目标：把竞品 Premium 中最常用、实现成本可控的能力免费化。

- 行内编辑：
  - 单表主键识别。
  - 单元格编辑、保存、回滚。
  - JSON / long text 弹窗编辑。
- 导出：
  - CSV。
  - JSON。
  - 当前页 / 全量查询结果。
- JSON 结果视图。
- SQL 变量：
  - 执行时填写变量。
  - 工作区变量配置。
- Workspace 级连接：
  - `.vscode/dbclient.json` 或类似文件。
  - 支持敏感字段不入库，走 SecretStorage。
- DDL Hover 简版：
  - 表名 Hover 展示列、主键、索引摘要。
- SQL 文件关联：
  - CodeLens Run。
  - 更强的连接关联恢复，例如跨窗口恢复、移动文件后的提示。

## 4. 完整版路线图

### v1.0 数据库 IDE

目标：覆盖传统数据库客户端核心能力。

- 表设计器：
  - MySQL / PostgreSQL / SQLite。
  - 列、索引、主键、外键。
  - DDL 预览，用户确认后执行。
- ER 图基础版：
  - 基于外键自动生成。
  - 自动布局、缩放、拖动。
  - 表节点跳转数据视图。
- Mock 数据：
  - faker 规则。
  - 按表列类型推荐规则。
  - 生成 INSERT 或直接写入。
- 备份与导入：
  - SQL 文件执行。
  - 调用 `mysqldump` / `pg_dump`。
  - Dump Struct / Dump Data。
- 更多 SQL 数据源：
  - SQL Server。
  - DuckDB。
  - ClickHouse。
- Redis 基础管理：
  - key 树、TTL、value 查看编辑。
  - 命令终端。

### v1.5 高级生产力

目标：实现竞品 Premium 中偏高级但高价值的能力。

- DDL 跳转定义。
- 完整 DDL Hover。
- ER 图导出图片。
- Schema 文档生成 Markdown。
- 结构对比：
  - 先只比较并生成迁移 SQL。
  - 默认不自动执行。
- SSH 隧道：
  - 连接配置内嵌 SSH tunnel。
  - 本地端口自动分配与释放。
- HTTP / SOCKS 代理。
- MongoDB 基础管理：
  - 数据库、集合、文档查看编辑。
  - JSON 查询。
- AI 助手只读版：
  - 列出连接、库、表、字段。
  - 生成 SQL 草稿。
  - 执行查询必须用户确认。

### v2.0 全栈 Service 面板

目标：追赶竞品的一站式运维面板，但保持插件边界清晰。

- Service 面板：
  - Redis、MongoDB、ElasticSearch、Kafka、RabbitMQ、SSH、Docker、S3。
- SSH / SFTP：
  - 终端。
  - SFTP 文件树。
  - 上传下载。
  - 保存后自动同步。
- Docker：
  - 容器列表、启动、停止、重启。
  - 日志流。
  - exec shell。
  - stats。
- ElasticSearch：
  - Index / Mapping 管理。
  - DSL 查询。
- Kafka：
  - Topic / Consumer Group。
  - 生产和消费消息。
- 本地加密同步替代：
  - 加密导出包。
  - Git 友好的 workspace 配置。
  - 可选接入用户自己的 S3 / WebDAV 存储，而不是我们的中心化云。

## 5. 推荐技术架构

### 扩展主进程

- TypeScript + VS Code Extension API。
- `package.json` 贡献：
  - Activity Bar。
  - TreeView。
  - commands。
  - SQL language / snippets。
  - configuration。
  - custom editor / webview view。
- 连接密码使用 `vscode.SecretStorage`。
- 非敏感配置使用 globalState / workspaceState / workspace 文件。

### 数据源适配层

设计统一接口：

```ts
interface DatabaseDriver {
  testConnection(config: ConnectionConfig): Promise<void>;
  listDatabases(): Promise<DatabaseNode[]>;
  listSchemas(database: string): Promise<SchemaNode[]>;
  listTables(scope: Scope): Promise<TableNode[]>;
  listColumns(table: TableRef): Promise<ColumnMeta[]>;
  query(sql: string, options: QueryOptions): Promise<QueryResult>;
  pageTable(table: TableRef, page: PageOptions): Promise<QueryResult>;
  updateCell?(change: CellChange): Promise<void>;
  getDDL?(target: DbObjectRef): Promise<string>;
}
```

优先选择成熟库：

- MySQL / MariaDB：`mysql2`
- PostgreSQL：`pg`
- SQLite：`better-sqlite3` 或 `sqlite`
- SQL Server：`tedious`
- Redis：`ioredis`
- MongoDB：`mongodb`
- SSH：`ssh2`
- SQL 格式化：`sql-formatter`
- Mock：`@faker-js/faker`

### Webview UI

- 推荐 React / Vue 均可，关键是表格性能。
- 数据表格必须支持虚拟滚动或分页渲染。
- Webview 与 Extension Host 使用 message RPC。
- 大结果集不要一次性 postMessage 全量数据。

### 安全策略

- 默认不上传连接信息。
- 密码、私钥、token 进入 `SecretStorage`。
- 生产危险 SQL 做确认：
  - 无 WHERE 的 UPDATE / DELETE。
  - DROP / TRUNCATE。
  - 批量 DDL。
- AI 功能默认只读，执行前必须确认。

## 6. 任务拆分建议

第一阶段建议拆成 8 个可并行模块：

| 模块 | 产出 | 优先级 |
| --- | --- | --- |
| Extension Shell | Activity Bar、TreeView、命令注册、设置项 | P0 |
| Connection Store | 连接 CRUD、SecretStorage、本地持久化 | P0 |
| Driver Core | MySQL/PostgreSQL/SQLite 适配接口 | P0 |
| Schema Explorer | 元数据加载、缓存、刷新、树节点 | P0 |
| SQL Runner | SQL 编辑器、执行选区/当前语句、历史 | P0 |
| Result Webview | 表格、分页、错误状态、复制 | P0 |
| Export | CSV/JSON 导出 | P1 |
| Editable Grid | 主键识别、行内编辑、保存 | P1 |

## 7. 产品差异化方向

- 免费完整：不做连接数量限制，不把 ER/导出/Mock 这类生产力能力放到付费墙。
- 本地优先：不要求注册账号，不上传连接配置。
- 安全透明：所有敏感字段进入 SecretStorage，危险 SQL 强确认。
- 插件化数据源：每个 Driver 独立，后续能按需安装或懒加载。
- 开发者体验优先：启动快、查询快、错误信息清楚，比“支持 40+ 数据源”更重要。

## 8. 初始里程碑

| 时间段 | 目标 | 验收标准 |
| --- | --- | --- |
| 第 1 周 | Extension Shell + 连接管理 | 能新增 MySQL/PostgreSQL/SQLite 连接并显示在树中 |
| 第 2 周 | Schema Explorer | 能展开库、表、列，支持刷新缓存 |
| 第 3 周 | SQL Runner | 能打开 Query、执行 SQL、展示结果和错误 |
| 第 4 周 | Result Webview | 分页表格、复制、查询历史可用 |
| 第 5 周 | 导出 + 体验打磨 | CSV/JSON 导出、设置项、危险 SQL 确认 |
| 第 6 周 | MVP 验收 | 使用真实数据库完成连接、查表、查询、导出、历史回放 |

MVP 成功标准：用户可以卸载普通 SQL 查询插件，用我们的插件完成日常 80% 的查库工作。
