# Bug Analysis: MySQL 兼容协议结果字段注释未显示

## 1. Root Cause Category

- **Category**: B / D / E — 跨层契约、测试覆盖缺口与隐式假设。
- **Specific Cause**: 实际验证的 `5.1.0` MySQL 协议兼容数据库能查询 `information_schema`，但结果字段包不保证提供标准 MySQL 的 `schema/orgTable/orgName`。前两轮修复始终假设驱动来源元数据存在，因此真实结果列在注释查询前就被全部跳过。

## 2. Why the First Implementation Failed

1. 只查看了 `FieldPacket.d.ts`，没有核对驱动解析器 `lib/packets/column_definition.js` 的真实输出。
2. 测试 mock 按实现假设构造 `db`，与实现互相证明，未模拟真实运行时 `schema`。
3. 类型检查无法发现问题，因为 `db` 和 `schema` 在声明中都合法且可选。
4. 第一轮修复只解决了“是否发出注释查询”，没有验证真实注释查询返回行到 Map 的完整映射。
5. 第二轮仍只围绕标准 MySQL `FieldPacket` 修补，没有先核对实际服务类型、端口与协议兼容差异。

## 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
|---|---|---|---|
| P0 | Architecture | 统一通过 `getMysqlFieldSchema` 读取 `schema || db` | DONE |
| P0 | Test Coverage | MySQL 字段 fixture 只提供真实运行时 `schema` | DONE |
| P0 | Query Contract | `information_schema` 投影使用稳定显式别名 | DONE |
| P0 | Test Coverage | 注释行 fixture 只提供显式别名键 | DONE |
| P0 | Compatibility | 驱动来源缺失时按执行 SQL 的投影位置与表别名解析来源 | DONE |
| P0 | Test Coverage | 使用通用多表四列、重复 `document_type` 和空来源字段 fixture | DONE |
| P0 | Test Coverage | 覆盖 `SELECT DISTINCT 别名.字段`，确保选择修饰符不会被误判为表达式 | DONE |
| P1 | Documentation | 在结果列元数据 code-spec 中记录真实驱动契约 | DONE |
| P1 | Code Review | 驱动元数据功能必须同时核对声明文件和运行时解析代码 | DONE |

## 4. Systematic Expansion

- **Similar Issues**: 其他 MySQL 协议实现也可能只兼容查询语法，不兼容标准字段来源元数据；PostgreSQL 的 OID/列号同样必须以真实服务验证。
- **Design Improvement**: 来源解析统一为“驱动元数据优先、SQL 投影回退”，表达式和歧义列保持无注释。
- **Compatibility Boundary**: SQL 投影回退需要先移除标准选择修饰符（`DISTINCT`、`DISTINCTROW`、`ALL`），再判断是否为简单字段来源；不能把这些修饰符误判成计算表达式。
- **Process Improvement**: 第三方驱动边界测试必须覆盖实际服务类型和协议兼容层，不能只用标准驱动 mock 自证。

## 5. Knowledge Capture

- [x] 更新 `.trellis/spec/frontend/type-safety.md`。
- [x] 更新驱动 mock，使其匹配 `mysql2` 的真实 `ColumnDefinition`。
- [x] 将根因与预防机制保存在当前任务 research 目录。
- [x] 增加 StarRocks/MySQL 兼容协议的 SQL 投影来源契约与回归测试。
