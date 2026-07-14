# 实施与验收记录：连接展示主机全部数据库

## 状态说明

该功能在创建本 Trellis 任务前已经完成并进入暂存区。以下清单记录实际实现顺序和最终验证范围，不再重复修改业务代码。

## 已完成实现

- [x] 移除 MySQL/PostgreSQL 的 database 必填校验，并更新表单标签与占位提示。
- [x] 在 `SchemaInspector` 增加统一的 `listDatabases` 合约。
- [x] 实现 MySQL/MariaDB `SHOW DATABASES` 枚举。
- [x] 实现 PostgreSQL 可连接非模板数据库枚举。
- [x] 增加 Database catalog 树节点及 Connection -> Database -> Tables 层级。
- [x] 将 database 纳入 Tables、表和列节点 ID。
- [x] 保留 SQLite 的 Connection -> Tables 层级和 path 必填规则。
- [x] 增加表单、驱动枚举、树上下文传递自动验证。
- [x] 同步中英文 README、CHANGELOG 和 `0.2.4` 包版本。

## 验证计划

1. 运行 TypeScript 编译，验证 `SchemaInspector` 合约及树节点类型完整。
2. 运行 `scripts/verify-v0.2.js`，验证：
   - 数据库表单字段可选；
   - MySQL/PostgreSQL 数据库枚举结果；
   - 数据库节点展开后把 database 传入 Tables 与 TableInfo；
   - SQLite 树结构不变。
3. 运行差异检查，确认任务文件之外未产生新的非预期改动。

## 重点人工验收

- 使用数据库字段为空的 MySQL 连接，展开连接后应看到当前账号可见的全部数据库。
- 使用数据库字段为空的 PostgreSQL 连接，展开连接后应看到当前账号有 `CONNECT` 权限的非模板数据库。
- 展开两个数据库的 Tables，确认表数据分别来自对应数据库。
- 编辑已有填写默认数据库的连接，确认字段仍保留且直接 SQL 执行行为未被清除。

## 风险文件与回滚

- `src/schema/inspector.ts`：驱动差异与权限过滤。
- `src/tree/databaseTreeProvider.ts`：树层级路由和错误展示。
- `src/tree/treeItems.ts`：稳定节点 ID。
- `src/connection/connectionFormPanel.ts`：入口校验兼容性。

这些改动不迁移持久化数据，回滚时可按上述文件恢复旧分支，不需要转换连接配置。
