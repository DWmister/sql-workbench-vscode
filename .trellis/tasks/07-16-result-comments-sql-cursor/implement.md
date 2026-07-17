# 实施计划：结果字段注释与 SQL 光标执行边界

## 实施步骤

1. 扩展 `QueryColumn` 可选 comment 契约。
2. 在查询执行层增加 MySQL 字段来源去重、批量注释查询和失败降级；标准驱动来源优先，StarRocks/MySQL 协议兼容结果缺少来源元数据时按简单 SQL 投影的别名与位置回退，并覆盖普通查询与分页查询。
3. 在查询执行层增加 PostgreSQL OID/列号去重、批量注释查询和失败降级，并覆盖普通查询与分页查询。
4. 更新结果表头 HTML/CSS：两行展示、长注释截断、完整 title；保持导出列名不变。
5. 修改 `findStatementAtOffset` 的语句间隔策略，保留前置注释归下一条的现有范围语义。
6. 增加驱动元数据、失败降级、结果表头和光标边界回归验证。
7. 同步版本、README 徽章、CHANGELOG 与 `0.2.x` 路线图，并将版本/VSIX、路线校验、开源仓库敏感信息预检和 VSIX 文件清单预检规则写入 `AGENTS.md`。
8. 运行完整验证后生成并检查与当前版本一致的 VSIX；MySQL 真实运行时修复后的最终版本为 `0.2.6`。

## 验证命令

- `npm run check`
- `npm run verify:v0.2`
- `git diff --check`
- `npx --yes @vscode/vsce package`
- `unzip -l sql-workbench-vscode-0.2.6.vsix`

## 重点测试场景

- MySQL/PostgreSQL 真实字段、有别名真实字段、表达式字段和空注释。
- StarRocks/MySQL 协议兼容结果字段缺少来源元数据时，多表投影按位置区分重复标签；单表 `SELECT *` 可映射，歧义通配符或表达式不猜测。
- MySQL 协议兼容结果的 `SELECT DISTINCT 别名.字段` 仍可映射字段来源和注释。
- 注释系统目录查询抛错时原结果仍返回。
- 分页首页与后续页都携带注释。
- 表头显示字段名和注释，导出仍使用原字段名。
- 光标位于分号、分号后换行/空格、下一条 SQL 首字符和下一条前置注释。
- 文档开头、文档结尾、字符串及注释内分号。
- 发布前审查暂存内容：无真实凭据、私有地址、连接串或内部数据库标识；路线图在中英文 README 与看板中一致。

## 风险与回滚点

- `src/query/runner.ts`：额外元数据查询不能污染行结果或超时语义。
- `src/results/resultViewPanel.ts`：Webview 字符串转义与表头布局。
- `src/query/sqlParser.ts`：边界必须只改变范围间纯空白归属。
- `scripts/verify-v0.2.js`：驱动 mock 需要区分业务 SQL 与注释元数据 SQL。

如出现性能或兼容问题，可先关闭辅助注释查询而保留 `QueryColumn.comment` 和 UI 的可选渲染；光标边界修改可独立回退。
