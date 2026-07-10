# Database Client 竞品功能拆解与路线图

调研对象：

- 官网：https://database-client.com/
- 文档：https://database-client.com/docs
- VS Code Marketplace：
  - https://marketplace.visualstudio.com/items?itemName=cweijan.vscode-mysql-client2
  - https://marketplace.visualstudio.com/items?itemName=cweijan.vscode-database-client2
- 早期源码参考：https://github.com/cweijan/vscode-database-client

目标：参考 Database Client 的产品形态，实现我们自己的 VS Code 数据库插件。不做付费墙设计，竞品 Premium 能力在我们的产品中按优先级逐步免费实现。

## 0. 实施校准（2026-07-10）

路线图最初是竞品调研后的规划稿，v0.1 和 v0.2 实施过程中已经根据稳定性、数据安全和真实使用反馈做过取舍。以下内容以当前代码和发布记录为准。

状态说明：

- **已交付**：已经进入对应版本。
- **超出计划**：原路线图未要求，但已经完成。
- **后移**：仍有价值，调整到后续版本。
- **取消**：明确不进入任何版本。

### v0.1 原计划与实际交付

| 能力 | 原计划 | 实际状态 | 路线图处理 |
| --- | --- | --- | --- |
| 数据源与连接 | MySQL / MariaDB、PostgreSQL、SQLite，连接 CRUD、分组和本地持久化 | **已交付**三类数据源、分组连接树、连接测试、本地连接与 SecretStorage | 保持为 v0.1 基线 |
| SQL 查询闭环 | 原生 `.sql`、连接绑定、当前语句或选区执行、只读结果 | **已交付**，支持状态栏和 QuickPick 切换活动连接 | 保持为 v0.1 基线 |
| Schema Explorer | 数据库 / Schema / 表 / 视图 / 列完整层级 | v0.1 实际先交付连接、表、列的只读浏览 | 完整层级和视图节点后移到 v0.3.x |
| 表数据浏览 | 点击表自动打开 `SELECT * LIMIT n` | 未进入 v0.1；当前点击表打开只读表属性 | 不规划独立 Data 页签，表数据继续通过 SQL 查看 |
| 查询历史 | 本地记录并可重新打开 | 未进入 v0.1 | 后移到 v0.3.x |
| 危险 SQL 确认 | 无 `WHERE` 的 UPDATE / DELETE 二次确认 | 在 v0.2 完成，并扩展 DROP / TRUNCATE 等识别 | 归档到 v0.2 |

### v0.2 原计划与实际交付

| 能力 | 原计划 | 实际状态 | 路线图处理 |
| --- | --- | --- | --- |
| 结果导出 | CSV、JSON，当前页 / 全部数据 | **超出计划**：增加 XLSX、导出弹框、范围选择、全量上限和提示 | v0.2 记为 CSV / JSON / XLSX 完整交付 |
| JSON 结果 | JSON 结果视图 | **已交付** Table / JSON 切换 | 保持为 v0.2 基线 |
| 单元格查看 | 长文本或 JSON 查看，曾考虑编辑 | **调整**为仅 JSON / JSONB 类型可打开只读查看器，只保留 Format、Copy、Close | 结果单元格编辑永久取消 |
| SQL 编辑效率 | SQL 变量、CodeLens、连接恢复 | **超出计划**：增加每文件连接绑定、文件移动/重命名指纹恢复、完整个人连接编辑 | 作为 v0.2 核心交付 |
| Workspace 连接 | 可共享非敏感连接配置 | **已交付** `.vscode/sql-workbench.json`，敏感字段不入库并由 SecretStorage 补齐 | 保持为 v0.2 基线 |
| 表结构信息 | DDL Hover 简版 | **超出计划**：表属性增加 Columns / DDL，支持三类数据库完整 DDL、语法着色、复制、刷新、重试 | 完整表 DDL 归档到 v0.2；Hover 保持轻量摘要 |
| 页面布局 | 未明确 | **超出计划**：SQL Results 与 Table Properties 都在当前编辑栏打开 | 固化为默认交互 |
| 稳定性 | 未单列 | 修复翻页连接关闭、导出只读文件系统、连接表单空值等问题 | 归档为 v0.2 稳定性优化 |

### 固化的产品边界

- 所有版本都不支持在结果网格中直接编辑或保存单元格；修改数据必须显式执行 SQL。
- 表属性面板保持只读；未来的表设计或结构对比只能生成 DDL 到 SQL 编辑器，由用户审阅后执行。
- ER 图延后到 v1.5，当前阶段先集中投入 SQL 编辑效率、结果查看、导出和表属性工作流。
- 表详情不增加独立 Data 页签，查看表数据继续使用 SQL 查询。

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
| SQL 编辑器 | SQL 补全、片段、CodeLens Run、格式化、多语句执行、状态栏切换连接 | 基础免费 | 查询效率核心 | 中 | v0.1 完成查询闭环；v0.2 增加变量、CodeLens、每文件绑定和恢复；历史后移到 v0.3.x |
| SQL 变量 | `:name` / `$name` 占位，执行时输入或变量面板配置 | 免费 | 方便复用查询脚本 | 中 | v0.2 做轻量版本 |
| 查询结果 | Webview 数据网格、分页、多标签、刷新、自动刷新 | 基础免费 | 数据查看的核心体验 | 高 | MVP 必做分页表格、查询结果、错误展示 |
| 行内编辑 | 双击单元格修改，保存回数据库，长文本弹窗编辑 | 免费 | 替代外部数据库客户端 | 高 | 永久不做结果单元格编辑；JSON/JSONB 仅提供只读 Format/Copy/Close 查看器 |
| 导出 | CSV、JSON、SQL、Markdown；复制为 CSV | Premium | 数据迁移、排查、报表临时导出 | 中 | v0.2 已免费实现 CSV/JSON/XLSX；SQL/Markdown 后续按需求评估 |
| JSON 结果视图 | 查询结果以 JSON 模式展示 | Premium | 文档/JSON 字段查看方便 | 低 | v0.2 实现 |
| 表设计器 | 可视化列、索引、外键、DDL 预览与执行 | 基础免费；结构对比执行 Premium | 降低 DDL 操作门槛 | 高 | 后续只做 DDL 生成与预览，不提供绕过 SQL 编辑器的直接保存 |
| DDL Hover / 跳转 | 表名 Hover 完整 DDL，Ctrl+Click 打开定义 | Premium 完整能力 | SQL 阅读与 Schema 探索效率 | 中 | v0.2 做 Hover 简版；v1.0 做定义跳转 |
| ER 图 | 自动布局表与外键关系、缩放、小地图、导出图片 | Premium 完整使用 | 理解复杂库结构 | 高 | v1.5 实现，当前阶段先投入 SQL、结果查看和表属性工作流 |
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

实际交付：

- VS Code Activity Bar：一个 Database 面板。
- 连接管理：
  - 新增、测试、删除连接。
  - 分组。
  - 本地持久化。
  - 密码进入 SecretStorage。
  - 不限制连接数量。
- 数据源：
  - MySQL / MariaDB。
  - PostgreSQL。
  - SQLite。
- Schema 树：
  - 连接、表、列的只读浏览。
  - 展开表节点直接显示所有列，包含字段名和类型。
  - 点击表节点后，在当前编辑栏打开表结构详情页，默认展示所有列信息。
  - 表结构详情页只读，不提供列编辑、删除、重命名等 GUI 写操作。
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
- 结果视图：
  - Webview 表格展示，只读。
  - 服务端分页。
  - 错误信息、执行耗时、影响行数。
- 写操作边界：
  - 所有版本都不支持结果表格内直接编辑值。
  - 表属性页始终只读，不直接编辑、删除、重命名列。
  - 所有数据修改和结构修改都必须通过 SQL 执行。

暂不包含：

- 结果单元格编辑（永久不包含）。
- 表设计器。
- ER 图（延后到 v1.5）。
- SSH / Docker / Redis / MongoDB。
- 云同步账号体系。

从原 v0.1 计划后移或调整：

- 查询历史后移到 v0.3.x。
- 完整 Database / Schema / View 层级后移到 v0.3.x。
- 点击表不直接浏览数据，改为打开只读表属性；数据继续通过 SQL 查询。
- 危险 SQL 二次确认随 v0.2 交付。

### v0.2 增强版

目标：把竞品 Premium 中最常用、实现成本可控的能力免费化。

- 只读单元格查看：
  - JSON / JSONB 类型弹窗查看。
  - 仅提供 Format、Copy、Close。
  - 后续可增加更多类型的只读查看器，但不增加保存入口。
- 导出：
  - CSV。
  - JSON。
  - XLSX。
  - 当前页 / 全量查询结果。
  - 导出弹框统一选择格式与范围；数据量超过上限时禁用全量并显示原因。
- JSON 结果视图。
- SQL 变量：
  - 执行时填写变量。
  - 工作区变量配置。
- Workspace 级连接：
  - `.vscode/sql-workbench.json`。
  - 支持敏感字段不入库，走 SecretStorage。
- 连接管理：
  - 个人连接支持完整编辑。
  - 编辑时未填写新密码则保留原密码。
- DDL Hover 简版：
  - 表名 Hover 展示列、主键、索引摘要。
- 表属性 DDL：
  - Columns / DDL 两个页签并配套图标。
  - MySQL、PostgreSQL、SQLite 按需加载完整单表 DDL。
  - 支持主题适配的语法着色、复制、刷新和失败重试。
  - 快速切换表时丢弃过期响应。
- SQL 文件关联：
  - CodeLens Run。
  - 每个 SQL 文件独立绑定连接。
  - 通过文件指纹恢复移动或重命名后的绑定。
- 安全与稳定性：
  - 危险 SQL 二次确认。
  - SQL Results 与 Table Properties 默认在当前编辑栏打开。
  - 修复数据库翻页连接生命周期、导出路径和连接表单空值问题。

## 4. 完整版路线图

### v1.0 数据库 IDE

目标：覆盖传统数据库客户端核心能力。

- DDL 辅助编辑器：
  - MySQL / PostgreSQL / SQLite。
  - 列、索引、主键、外键。
  - 生成 DDL 并打开到 SQL 编辑器，用户审阅后手动执行。
- Mock 数据：
  - faker 规则。
  - 按表列类型推荐规则。
  - 生成 INSERT 到 SQL 编辑器，不直接写入数据库。
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
- Schema 文档生成 Markdown。
- ER 图：
  - 根据主外键关系生成表关系图。
  - 支持自动布局、缩放、小地图和表节点跳转。
  - 支持导出图片。
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

当前实现把查询和 Schema 元数据拆成两个轻量接口，避免补全和 Hover 意外触发完整 DDL 查询：

```ts
interface QueryRunner {
  execute(connection: ConnectionConfig, query: QueryInput, options?: QueryExecutionOptions): Promise<QueryResult[]>;
  fetchPage(connection: ConnectionConfig, request: QueryPageRequest, options?: QueryExecutionOptions): Promise<QueryResult>;
}

interface SchemaInspector {
  listTables(connection: ConnectionConfig): Promise<TableInfo[]>;
  getTableDetails(table: TableInfo): Promise<TableDetails>;
  getTableDdl(table: TableInfo): Promise<string>;
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

当前模块状态与后续优先级：

| 模块 | 产出 | 优先级 |
| --- | --- | --- |
| Extension Shell | Activity Bar、TreeView、命令注册、设置项 | P0 |
| Connection Store | 连接 CRUD、SecretStorage、本地持久化 | P0 |
| Driver Core | MySQL/PostgreSQL/SQLite 适配接口 | P0 |
| Schema Explorer | 元数据加载、缓存、刷新、树节点 | P0 |
| SQL Runner | SQL 编辑器、执行选区/当前语句、连接绑定；历史在 v0.3.x 补充 | P0 |
| Result Webview | 表格、分页、错误状态、复制 | P0 |
| Export | CSV/JSON/XLSX 导出，格式与范围弹框 | P1 |
| JSON Cell Viewer | JSON/JSONB 只读查看、格式化、复制 | P1 |
| Table Properties | Columns、完整 DDL、复制、刷新、重试 | P1 |
| History & Schema Depth | 查询历史、完整 Schema/View 层级 | P2 |
| ER Diagram | 主外键关系、自动布局、导航与图片导出 | P3（v1.5） |

## 7. 产品差异化方向

- 免费完整：不做连接数量限制，不把导出、Workspace 连接、完整 DDL、Mock 等生产力能力放到付费墙。
- 本地优先：不要求注册账号，不上传连接配置。
- 安全透明：所有敏感字段进入 SecretStorage，危险 SQL 强确认。
- 插件化数据源：每个 Driver 独立，后续能按需安装或懒加载。
- 开发者体验优先：启动快、查询快、错误信息清楚，比“支持 40+ 数据源”更重要。

## 8. 版本里程碑

| 版本 | 状态 | 验收结果 / 下一步 |
| --- | --- | --- |
| v0.1 | 已完成 | 三类数据库连接、只读 Schema、原生 SQL 执行、分页结果组成最小查询闭环 |
| v0.2 | 已完成 | 导出、变量、Workspace 连接、CodeLens、绑定恢复、完整表 DDL、只读 JSON 查看器和安全确认进入主线 |
| v0.2.x | 收尾 | 自定义执行快捷键、连接配置导入导出、依赖裁剪和 VSIX 体积优化 |
| v0.3.x | 下一阶段 | 查询历史、完整 Schema/View 层级、结果查看效率和错误恢复继续增强 |
| v1.0+ | 长期 | DDL 生成辅助、备份恢复、ER 图、更多数据源、结构对比、远程连接与 Service 面板 |

当前成功标准：开发者可以使用插件完成连接、查结构、执行 SQL、分页查看、JSON 检查和 CSV/JSON/XLSX 导出；任何数据或结构修改都通过可见 SQL 完成。
