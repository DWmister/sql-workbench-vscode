# SQL Workbench

面向 VS Code 的 SQL 优先数据库工作台。

SQL Workbench 把数据库操作留在编辑器内：在普通 `.sql` 文件里写 SQL，从状态栏切换当前连接，查看表结构元数据，并直接执行语句，不做付费墙设计。

[English](README.md) • [Repository](https://github.com/DWmister/sql-workbench-vscode)

![Version](https://img.shields.io/badge/version-0.2.2-2ea44f)
![VS Code](https://img.shields.io/badge/VS%20Code-1.90%2B-007ACC)
![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6)
![Databases](https://img.shields.io/badge/MySQL%20%7C%20PostgreSQL%20%7C%20SQLite-supported-2ea44f)
![License](https://img.shields.io/badge/license-MIT-2ea44f)

![连接配置页](docs/images/connection-form.png)

## 为什么做 SQL Workbench？

| 能力 | 改善点 |
| --- | --- |
| SQL 优先编辑 | SQL 保持在 VS Code 原生编辑器中，格式化、片段、搜索、Git 和快捷键都按熟悉方式工作。 |
| SQL 文件连接绑定 | 可通过状态栏或树命令把 SQL 文件绑定到连接；文件移动后若内容指纹匹配旧绑定，会提示恢复连接。 |
| 只读表属性 | 点击表后查看字段，并按需加载可复制、可刷新的迁移级 DDL，不开放结构写入。 |
| 按别名收敛的字段提示 | `bs.` 只提示别名 `bs` 指向表的字段，并在列表中显示字段注释和类型。 |
| DDL Hover 预览 | 鼠标悬停 SQL 表名时查看字段、主键和索引摘要。 |
| CodeLens 执行入口 | 直接从 SQL 语句上方的 CodeLens 执行单条语句，不需要移动光标。 |
| SQL 变量 | 使用 `:name` 或 `$name` 变量，执行前确认变量值，并可通过 `sqlWorkbench.variables` 预填默认值。 |
| 危险 SQL 确认 | 执行没有真实 `WHERE` 条件的 `UPDATE` 或 `DELETE` 前二次确认。 |
| 查询结果导出 | 打开导出弹框，选择 CSV、JSON 或 XLSX，并导出当前页或全量分页结果。 |
| 只读 JSON 单元格查看 | JSON/JSONB 列可在只读弹窗中查看，仅提供 Format、Copy、Close。 |
| 永久编辑边界 | 查询结果和表属性在所有版本中都保持只读；数据和结构修改只能通过 SQL。 |

## 效果图

### 只读表属性与 DDL

![只读表属性与 DDL](docs/images/schema-view.png)

### 按别名收敛的 SQL 提示

![按别名收敛的 SQL 提示](docs/images/sql-completion.png)

## 功能

- 支持 MySQL/MariaDB、PostgreSQL、SQLite 连接配置。
- VS Code 活动栏内的分组数据库树。
- Webview 连接配置页，支持新增、编辑和测试连接。
- 快捷连接字符串，例如 `mysql://root:password@127.0.0.1:3306/app?name=prod&group=sr`。
- 个人连接元数据存入扩展 `globalState`；workspace 连接元数据可放在 `.vscode/sql-workbench.json`。
- 密码不会从 workspace 文件读取，只保存在本机 VS Code `SecretStorage`。
- SQL 文件连接绑定，支持状态栏、QuickPick 切换，以及基于内容指纹的移动文件恢复提示。
- SQL 关键字、常用函数、表名、字段名片段与补全；关键字和函数统一使用大写插入。
- SQL 表名 Hover 摘要，展示字段、主键和索引。
- `.sql` 编辑器内的逐语句 CodeLens 执行入口。
- SQL 变量支持执行前输入，并从 `sqlWorkbench.variables` 读取工作区默认值。
- 没有真实 `WHERE` 条件的 `UPDATE` 和 `DELETE` 会触发危险 SQL 二次确认。
- macOS 使用 `Cmd+Enter`，Windows/Linux 使用 `Ctrl+Enter` 执行当前 SQL 语句。
- 查询结果 webview 支持带语法颜色的已执行 SQL、表格/JSON 模式、分页、CSV/JSON/XLSX 导出，以及只读 JSON/JSONB 单元格查看。
- 只读结构树：连接 -> 表 -> 字段。
- 在当前编辑栏打开只读表属性，提供 Columns 与按需加载的 DDL 页签。

## 快速开始

```bash
# 安装依赖。
npm install

# 只做 TypeScript 类型检查，不写入构建产物。
npm run check

# 编译扩展源码到 out/。
npm run compile

# 本地启动：
# 用 VS Code 打开当前目录，按 F5，进入 Extension Development Host。
```

扩展启动后：

1. 打开 `Database` 活动栏视图。
2. 点击 `Add Connection`。
3. 填写表单，或粘贴快捷连接字符串。
4. 点击 `Test Connection`，再点击 `Save`。
5. 打开或创建 `.sql` 文件，用 `Cmd+Enter` 或 `Ctrl+Enter` 执行当前语句。

## 快捷连接字符串

示例：

```text
mysql://root:password@127.0.0.1:3306/app?name=local-mysql&group=local
postgresql://postgres:password@127.0.0.1:5432/app?name=local-pg&group=local
sqlite:///Users/me/database.sqlite?name=local-sqlite&group=local
```

支持协议：

- `mysql://`
- `mariadb://`
- `postgresql://`
- `postgres://`
- `sqlite://`

## Workspace 连接

团队可以在 `.vscode/sql-workbench.json` 共享不含敏感字段的连接配置：

```json
{
  "version": 1,
  "connections": [
    {
      "id": "local-pg",
      "name": "Local PostgreSQL",
      "type": "postgresql",
      "group": "Local",
      "host": "127.0.0.1",
      "port": 5432,
      "database": "app",
      "username": "postgres",
      "readonly": true
    }
  ]
}
```

不要写入 `password`、`privateKey` 或 `token` 字段。扩展会跳过包含敏感字段的 workspace 连接，并继续加载同文件中的其他有效连接；每个开发者首次使用时在本机输入凭据，并保存到 VS Code `SecretStorage`。

## 版本规则

当前增强版版本线：`0.2.x`。

- 增强版修复和小优化：更新 patch 版本，例如 `0.2.1`。
- 完整版之前的较大功能更新：更新 minor 版本，例如 `0.3.0`。
- 完整版实现后：更新 major 版本到 `1.0.0`。

## 本地验证

```bash
# 类型检查。
npm run check

# 构建 VS Code 运行所需的 out/ 产物。
npm run compile

# 运行 v0.2 核心工作流验证。
# 覆盖 SQL 解析/语句范围、变量、危险 SQL 检测、workspace 连接/SecretStorage、
# 结果导出序列化、DDL Hover、CodeLens、SQL 文件绑定恢复、
# MySQL/PostgreSQL 分页路径、SQLite 结构元数据、只读 JSON 单元格查看
# 和 webview 行为/脚本语法。
npm run verify:v0.2

# UI 调整后重新生成 README 截图。
npm run screenshots

# 打包本地 VSIX，用于安装验证或发版前检查。
npx --yes @vscode/vsce package

# 可选：如果 Chrome 不在默认路径，手动指定可执行文件。
CHROME_PATH="/path/to/chrome" npm run screenshots
```

## 实现方式

1. 个人连接信息通过 `ConnectionStore` 保存和编辑；workspace 连接从 `.vscode/sql-workbench.json` 只读加载。
2. SQL 执行按数据库类型分发：
   - SQLite 使用 `sql.js`。
   - MySQL/MariaDB 使用 `mysql2`。
   - PostgreSQL 使用 `pg`。
3. 表结构元数据通过数据库专用 inspector 读取。
4. SQL 补全会解析当前语句，从 `FROM` 和 `JOIN` 中识别表别名，并把字段提示收敛到匹配表。
5. SQL 文件连接绑定存入 workspace state；执行、CodeLens、补全和 Hover 都优先使用当前文档绑定，再回退到默认连接。已保存 SQL 文件还会记录内容指纹，移动或重命名后可提示恢复旧绑定。
6. SQL 变量在执行前收集，并通过数据库 driver 参数绑定；变量值不会拼接进原始 SQL 字符串。
7. 危险 SQL 检测会忽略字符串、引用标识符和注释，再对无 `WHERE` 的 `UPDATE` / `DELETE` 弹确认。
8. SQL CodeLens 使用与快捷键执行相同的语句解析器，因此字符串或注释中的分号不会错误切分语句。
9. SQL Hover 使用绑定连接的结构元数据展示轻量表摘要，不生成完整 DDL。
10. 表属性只在打开 DDL 页签时加载完整结构；MySQL 使用 `SHOW CREATE TABLE`，SQLite 读取 `sqlite_schema`，PostgreSQL 从系统目录重建迁移级 DDL。
11. SQL Results 和 Table Properties 在当前编辑栏打开，不再默认创建分栏。
12. 结果导出由扩展宿主在 VS Code 保存对话框确认后写入文件；webview 不获得文件系统写权限。
13. 仅 JSON/JSONB 类型列提供只读单元格弹窗；其他类型保持普通单元格，后续只按需增加只读查看器。

## 编辑边界

查询结果和表属性在所有版本中都保持只读。插件不会加入结果单元格编辑功能；所有数据和结构变更都必须编写并执行 SQL。后续可以为更多数据类型增加只读查看器，但查看器不会提供保存或修改操作。

## 路线图

- **所有版本：** 查询结果和表属性永久只读，数据与结构修改只能通过 SQL；新增单元格查看器时也只提供只读能力。
- `0.1.x`：MVP 查询闭环、SQL 提示优化、连接表单体验打磨。
- `0.2.x`：CSV/JSON/XLSX 结果导出、JSON 结果视图、SQL 变量、危险 SQL 确认、workspace 连接、SQL 文件连接绑定、更完整的连接编辑、DDL Hover 与表属性完整 DDL、CodeLens 执行入口和高频 Premium 能力增强。
- `0.2.x`：插件级自定义执行快捷键配置。
- `0.2.x`：通过 bundling 优化 VSIX 体积。
- `0.2.x`：更完整的连接编辑和导入/导出。
- `0.3.x`：查询历史和结果工作流优化。
- `1.0.0`：完整计划功能集。

## FAQ

### 可以执行写操作吗？

可以，但只能通过 SQL 执行。查询结果和表属性页面不会直接写入数据库。

### SQL 文件存在哪里？

SQL 文件就是工作区里的普通 `.sql` 文件。扩展不要求使用专有查询文档格式。

### 密码如何保存？

密码存入 VS Code `SecretStorage`。个人连接元数据存入扩展 `globalState`；workspace 连接元数据可提交为 `.vscode/sql-workbench.json`，但不能包含敏感字段。

### 可以编辑已保存连接吗？

可以。个人连接会使用创建连接时同一个 webview 表单编辑。密码字段留空会保留已有密码；输入新密码才会替换 SecretStorage 中保存的密码。Workspace 连接只读，需要修改 `.vscode/sql-workbench.json`。
