# 技术设计：连接展示主机全部数据库

## 状态

这是对已完成 `0.2.4` 实现的追溯性设计记录。业务代码已经存在于当前暂存区，本文件用于固化边界和数据流。

## 数据流

```text
持久化主机连接
  -> DatabaseConnectionTreeItem
  -> SchemaInspector.listDatabases(connection)
  -> DatabaseCatalogTreeItem({ ...connection, database })
  -> DatabaseTablesTreeItem(派生连接)
  -> SchemaInspector.listTables(派生连接)
  -> TableInfo.connection 保留所选 database
  -> 列、表属性与 DDL 查询继续使用同一连接上下文
```

## 分层职责

### 连接表单

`src/connection/connectionFormPanel.ts` 负责入口校验和文案：服务端连接不再校验 database 必填；`cleanDraft` 继续把空字符串规范化为 `undefined`。SQLite 的 path 校验保持不变。

### 元数据读取

`src/schema/inspector.ts` 统一拥有数据库枚举能力：

- MySQL/MariaDB 使用 `SHOW DATABASES`，结果仍受服务端账号权限控制。
- PostgreSQL 查询 `pg_database`，排除模板库，并通过 `has_database_privilege(..., 'CONNECT')` 过滤不可连接数据库。
- SQLite 返回空数据库列表，因为文件本身就是连接目标，不增加 catalog 层。

### 数据库树

`src/tree/databaseTreeProvider.ts` 根据连接类型决定层级：

- MySQL/PostgreSQL：Connection -> Database -> Tables -> Table -> Column。
- SQLite：Connection -> Tables -> Table -> Column。

数据库节点通过展开运算生成带 database 的派生连接，只用于当前树分支。原连接对象和持久化配置不变。

`src/tree/treeItems.ts` 将 database 纳入数据库、Tables、表和列节点 ID，确保同一连接下的同名对象不会产生 ID 冲突。

## 兼容性

- 已有连接如果填写 database，该字段仍保留，并继续作为直接 SQL 执行与补全的默认上下文。
- 数据库树不再只展示默认 database，而是始终枚举账号可访问数据库。
- 密码仍从既有 SecretStorage 路径读取，不进入树节点或持久化派生对象。
- 数据库枚举失败只渲染当前节点的错误子项，不阻断整个 TreeDataProvider。

## 取舍

- 不把枚举结果写入连接存储，避免一个主机连接膨胀成多个重复配置。
- 不在本任务中增加 Views、Functions、Procedures 层级，先保持现有 Tables 浏览能力。
- 不缓存数据库列表，沿用树节点按展开加载、手动刷新重新读取的模式，优先保证权限变化后的正确性。

## 回滚点

若数据库枚举导致兼容性问题，可回退 `SchemaInspector.listDatabases`、`DatabaseCatalogTreeItem` 和 TreeProvider 的 catalog 分支，同时恢复表单 database 必填校验；连接存储格式无需迁移。
