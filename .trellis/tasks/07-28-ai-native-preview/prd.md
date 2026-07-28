# v0.3.0 AI Native Preview

## Goal

把 SQL Workbench 从传统数据库插件升级为面向开发者的 Schema-aware Agent。首版以 Agent Chat 侧边栏和语句级 `AI Explain` CodeLens 为核心，在保留现有 SQL-first、安全透明边界的前提下，完成自然语言生成 SQL、理解现有 SQL、修复或优化 SQL，并把所有执行操作留在 `.sql` 编辑器中。

## Background

- 当前版本为 0.2.7，已经具备 MySQL/MariaDB、PostgreSQL、SQLite 连接、Schema 元数据、SQL 解析、逐语句 CodeLens、查询执行、分页结果和危险 SQL 确认。
- 旧路线图把只读 AI 助手放在 v1.5；本任务确认从 v0.3.0 开始把 AI Native Preview 调整为产品主线。
- 模型通过 BYOK 直接接入用户配置的 OpenAI-compatible API。SQL Workbench 不提供或代理托管模型服务。
- 第一目标用户是熟悉基本 SQL 的开发者和工程师。

## Requirements

### R1. BYOK 模型接入

- 插件内实现 OpenAI-compatible 模型适配层，而不是服务端模型网关。
- 用户配置 Base URL 和模型名；API Key 仅保存到 VS Code `SecretStorage`。
- 模型请求从插件直接发送到用户配置的 API，SQL Workbench 不代理、托管或记录请求。
- 未配置 BYOK 时，现有数据库工作台能力必须继续正常工作。

### R2. Agent Chat 主界面

- 在 SQL Workbench Activity Bar 下增加 Agent Chat 侧边栏。
- 一个会话只绑定一个活动连接；不支持跨连接查询或联合分析。
- Agent 可按需读取相关表、字段、类型、注释和索引，但不得发送连接地址、用户名、路径、凭据或连接串。
- 对话历史保存在 `workspaceState`；不保存 API Key、查询结果行或完整 Schema 快照。
- 后续消息可引用最近生成的 SQL 草稿；草稿作为受统一上下文预算限制的参考数据提供给模型。

### R3. 理解现有 SQL

- 每条 SQL 的现有 Run CodeLens 旁增加 `AI Explain`。
- CodeLens 必须绑定文档 URI 和精确语句范围，不能因点击前光标移动而解释错误语句。
- 命令面板提供同等入口：优先解释选区，没有选区时解释光标所在语句。
- SQL Explain 不执行 SQL，也不读取或发送查询结果。
- 解释至少包括整体用途、表和字段、JOIN、筛选、聚合、排序、分页、子查询、预期结果结构、写入影响、风险和可选优化。

### R4. SQL 生成、修复与优化

- Agent 可结合相关 Schema 生成 SQL 草稿，并根据数据库错误修复 SQL。
- SQL 草稿提供插入当前编辑器和新建 SQL 文件操作。
- 插入或新建的 SQL 文档必须及时显示 `Run Statement` 与 `AI Explain` CodeLens。
- INSERT、UPDATE、DELETE、DDL 和只读查询都只能生成、解释并插入/打开到编辑器，不能由 Agent 执行。

### R5. SQL 执行边界

- Agent Chat 不提供 `Review & run`、审批执行或任何其他直接执行入口。
- SQL 草稿只提供 `Insert` 和 `Open`；执行必须发生在 `.sql` 编辑器中，由用户使用现有 `Run Statement`。
- Agent Runtime、Webview 消息协议和 QueryRunner 不保留 Agent 专用执行能力。
- 现有编辑器 SQL 安全确认、结果页和导出行为保持不变。

### R6. 数据隐私

- v0.3.0 不把任何查询结果行或单元格值发送给模型。
- Agent 不自动接收执行结果元数据；用户可自行粘贴错误文本请求修复。
- Schema 注释和用户粘贴的数据库错误按不可信数据处理，不能改变提示规则或工具权限。
- 连接串、API Key 和当前连接已保存的数据库密码必须在模型请求和会话持久化前脱敏；普通 SQL 标识符、端口同值条件和密码字段赋值不能被误改。

### R7. 模型配置体验

- 配置和编辑 OpenAI-compatible API 必须在独立 Webview 页面中完成，不使用逐项弹框。
- 页面展示 Base URL、精确 Model ID 和 API Key 状态；编辑时留空 Key 默认保留现有 SecretStorage 值，并可显式删除。
- Model ID 字段必须说明它是服务商 API 接受的精确模型名而不是品牌名，并提供防错示例。
- Base URL 和模型名继续保存到 VS Code Settings，API Key 继续只保存到 SecretStorage。

### R8. 交互与命名

- 用户可按 Enter 发送消息，按 Shift+Enter 换行；输入法组合输入期间不得误发送。
- 用户可继续点击 Send 按钮发送。
- 对用户可见的侧边栏名称从 `AI Agent` 调整为 `Agent Chat`；内部稳定 ID 无需迁移。
- 消息和 SQL 草稿必须按创建时间组成统一时间线；SQL Explain 的最新回应不能被历史草稿排到上方。
- 新回应开始、流式更新和完成后，聊天区必须定位到最新内容。

### R9. 版本与路线

- 新修改版本从 0.2.7 升级为 0.3.0。
- README、README_CN、CHANGELOG、竞品分析和 HTML 路线图必须以 v0.3.0 正式发布口径描述 AI Native Preview。
- 原 v0.3.x 查询历史、Schema/View 深度和结果工作流增强重新排到 AI Preview 之后。

### R10. SQL Explain 自定义附加说明

- 配置页提供全局 `Explain Instructions` 多行字段，用于定制语言、输出格式和关注重点。
- 附加说明最大 4000 字符；清空保存恢复现有默认 Explain 行为。
- 固定 Explain 基础要求与 System Prompt 安全边界不可编辑，附加说明不得为 Agent 增加 SQL 执行能力。
- 附加说明保存到 VS Code 全局 Settings，不进入 SecretStorage，仅用于 `AI Explain`，不影响普通 Agent Chat 对话。
- Explain 请求顺序固定为基础要求、可选附加说明、`<sql_to_explain>` SQL。

## Acceptance Criteria

- [x] AC1：用户可通过语句 CodeLens 或命令面板解释现有 SQL，且不会执行 SQL 或发送结果值。
- [x] AC2：用户可在单一活动连接上下文中生成、修复和优化 Schema-aware SQL。
- [x] AC3：Agent Chat 没有任何直接执行 SQL 的按钮、消息或 Extension Host 路径。
- [x] AC4：草稿 Insert/Open 后进入 SQL 文档，并显示 `Run Statement` 与 `AI Explain` CodeLens。
- [x] AC5：模型请求不包含连接敏感字段、API Key 或查询结果值。
- [x] AC6：会话可在 workspace 中恢复，但持久化数据不包含密钥、结果行或完整 Schema。
- [x] AC7：配置/编辑模型在独立 Webview 页面完成，Model ID 有明确防错说明，Key 可保留/替换/删除。
- [x] AC8：Enter 发送、Shift+Enter 换行，输入法组合输入不误发送。
- [x] AC9：用户界面统一使用 `Agent Chat`，内部稳定 ID 保持兼容。
- [x] AC10：未配置 AI 时现有连接、编辑、执行、结果和导出行为无回归。
- [x] AC11：版本、双语文档、路线图和最终 VSIX 全部一致为正式发布口径的 0.3.0。
- [x] AC12：消息与 SQL 草稿按时间顺序显示，SQL Explain 的新回应位于历史草稿之后并自动滚动到最新位置。
- [x] AC13：全局 Explain Instructions 可保存、清空和应用于 SQL Explain，且固定安全约束、普通 Agent Chat 与密钥隔离边界保持不变。
- [x] AC14：连接凭据与连接串不进入请求或持久化，正常 SQL 不被脱敏误伤，后续消息可读取最近草稿，Webview 与协议共享输入限制，Explain 历史不展示内部固定 Prompt。

## Out of Scope

- 查询结果总结、图表或数据洞察。
- VS Code LM API、Chat Participant、MCP 或 SQL Workbench 托管模型服务。
- 多模型配置、跨连接查询、Embedding/RAG。
- Agent 执行任何 SQL，包括只读查询。
- 通用查询历史、事务回滚助手和结果单元格编辑。
