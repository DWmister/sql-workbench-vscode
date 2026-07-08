# SQL Workbench

面向 VS Code 的 SQL 优先数据库工作台。

SQL Workbench 把数据库操作留在编辑器内：在普通 `.sql` 文件里写 SQL，从状态栏切换当前连接，查看表结构元数据，并直接执行语句，不做付费墙设计。

[English](README.md) • [Repository](https://github.com/DWmister/sql-workbench-vscode)

![Version](https://img.shields.io/badge/version-0.1.0-2ea44f)
![VS Code](https://img.shields.io/badge/VS%20Code-1.90%2B-007ACC)
![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6)
![Databases](https://img.shields.io/badge/MySQL%20%7C%20PostgreSQL%20%7C%20SQLite-supported-2ea44f)
![License](https://img.shields.io/badge/license-UNLICENSED-lightgrey)

![连接配置页](docs/images/connection-form.png)

## 为什么做 SQL Workbench？

| 能力 | 改善点 |
| --- | --- |
| SQL 优先编辑 | SQL 保持在 VS Code 原生编辑器中，格式化、片段、搜索、Git 和快捷键都按熟悉方式工作。 |
| 当前连接切换 | 可通过状态栏或树命令切换当前数据库连接。 |
| 只读表结构查看 | 点击表后查看字段、类型、长度、注释、是否可空和主键信息，避免 UI 误改数据或结构。 |
| 按别名收敛的字段提示 | `bs.` 只提示别名 `bs` 指向表的字段，并在列表中显示字段注释和类型。 |
| 清晰的 MVP 边界 | 结果表格和结构面板只读；数据和结构变更必须通过 SQL 完成。 |

## 效果图

### 只读表结构查看

![只读表结构查看](docs/images/schema-view.png)

### 按别名收敛的 SQL 提示

![按别名收敛的 SQL 提示](docs/images/sql-completion.png)

## MVP 功能

- 支持 MySQL/MariaDB、PostgreSQL、SQLite 连接配置。
- VS Code 活动栏内的分组数据库树。
- Webview 连接配置页，支持保存和测试连接。
- 快捷连接字符串，例如 `mysql://root:password@127.0.0.1:3306/app?name=prod&group=sr`。
- 密码存入 VS Code `SecretStorage`；普通连接元数据存入扩展 `globalState`。
- 状态栏当前连接和 QuickPick 切换。
- SQL 关键字、表名、字段名片段与补全。
- macOS 使用 `Cmd+Enter`，Windows/Linux 使用 `Ctrl+Enter` 执行当前 SQL 语句。
- 查询结果只读 webview。
- 只读结构树：连接 -> 表 -> 字段。
- 在编辑器旁打开只读表字段详情。

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

## 版本规则

当前 MVP 版本线：`0.1.x`。

- MVP 修复和小优化：更新 patch 版本，例如 `0.1.1`。
- 完整版之前的较大功能更新：更新 minor 版本，例如 `0.2.0`。
- 完整版实现后：更新 major 版本到 `1.0.0`。

## 本地验证

```bash
# 类型检查。
npm run check

# 构建 VS Code 运行所需的 out/ 产物。
npm run compile

# UI 调整后重新生成 README 截图。
npm run screenshots

# 打包本地 VSIX，用于安装验证或发版前检查。
npx --yes @vscode/vsce package

# 可选：如果 Chrome 不在默认路径，手动指定可执行文件。
CHROME_PATH="/path/to/chrome" npm run screenshots
```

## 实现方式

1. 连接信息通过 `ConnectionStore` 保存。
2. SQL 执行按数据库类型分发：
   - SQLite 使用 `sql.js`。
   - MySQL/MariaDB 使用 `mysql2`。
   - PostgreSQL 使用 `pg`。
3. 表结构元数据通过数据库专用 inspector 读取。
4. SQL 补全会解析当前语句，从 `FROM` 和 `JOIN` 中识别表别名，并把字段提示收敛到匹配表。
5. 结果和结构面板都以只读 webview 渲染。

## MVP 边界

MVP 不支持通过 UI 编辑结果单元格、编辑字段或删除结构对象。这些操作必须通过 SQL 完成。等只读 SQL 工作流稳定后，再评估带保护机制的 GUI 编辑。

## 路线图

- `0.1.x`：MVP 修复、SQL 提示优化、连接表单体验打磨。
- `0.2.x`：插件级自定义执行快捷键配置。
- `0.2.x`：通过 bundling 优化 VSIX 体积。
- `0.2.x`：更完整的连接编辑和导入/导出。
- `0.3.x`：查询历史和结果导出优化。
- `1.0.0`：完整计划功能集。

## FAQ

### 可以执行写操作吗？

可以。写操作通过 SQL 执行支持。MVP 不提供结果单元格或结构对象的 UI 编辑入口。

### SQL 文件存在哪里？

SQL 文件就是工作区里的普通 `.sql` 文件。扩展不要求使用专有查询文档格式。

### 密码如何保存？

密码存入 VS Code `SecretStorage`。普通连接元数据存入扩展 `globalState`。
