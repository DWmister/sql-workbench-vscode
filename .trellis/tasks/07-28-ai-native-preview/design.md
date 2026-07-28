# v0.3.0 AI Native Preview — Technical Design

## Architecture

- `Agent Chat WebviewView`：侧边栏会话、流式输出和 SQL 草稿。
- `AI Configuration WebviewPanel`：统一编辑 Base URL、精确 Model ID 和 SecretStorage API Key。
- `Agent Runtime`：管理提示、工具循环、会话状态、取消和上下文预算。
- `OpenAI-compatible Adapter`：在 Extension Host 内调用用户配置的 `/chat/completions`，处理 SSE 和 tool calls。
- `Agent Tools`：封装当前 SQL、Schema 搜索、表详情和结构化 SQL 草稿。

模型适配层不监听端口、不转发请求到 SQL Workbench 服务，也不持有中心化账号或密钥。

## Public Contributions

- View：`sqlWorkbench.aiAgent`
- Commands：
  - `sqlWorkbench.ai.configure`
  - `sqlWorkbench.ai.explainSql`
  - `sqlWorkbench.ai.newConversation`
  - `sqlWorkbench.ai.clearHistory`
- Settings：
  - `sqlWorkbench.ai.baseUrl`
  - `sqlWorkbench.ai.model`
  - `sqlWorkbench.ai.explainInstructions`
- SecretStorage：`sqlWorkbench.ai.apiKey`

## Data Flow

### Explain SQL

1. CodeLens 传递文档 URI 和语句范围。
2. Extension Host 重新读取固定范围的 SQL。
3. Runtime 把固定 Explain 要求、可选附加说明和 SQL 发送给模型；模型仅在需要时通过受限工具搜索并加载相关 Schema 元数据。
4. 模型适配层发送 SQL、方言和经过投影/脱敏的相关 Schema。
5. 流式解释进入 Agent 侧边栏；不调用 QueryRunner。
6. Extension Host 把持久化消息与 SQL 草稿按 `createdAt` 投影为统一时间线；流式回应始终追加在时间线末尾，Webview 更新后滚动到最新内容。
7. Runtime 在固定 Explain 要求之后、SQL 标签之前追加最多 4000 字符的全局 Explain Instructions；空值不改变现有 Prompt。
8. 会话仅保存简洁的用户可见 Explain 请求；固定模型要求保持内部化。

### Generate and Open

1. 用户在绑定单一连接的 Agent 会话中描述需求。
2. Agent 通过受限工具搜索和描述 Schema。
3. 模型必须通过结构化 SQL 草稿工具返回候选 SQL。
4. 后续用户消息会把最近的宿主 SQL 草稿按时间顺序作为参考数据加入模型上下文，并与普通消息共用上下文预算。
5. SQL 草稿只显示 `Insert` 和 `Open`。
6. Extension Host 从会话状态解析草稿 SQL，插入/打开到绑定相同连接的 SQL 文档。
7. CodeLens Provider 刷新，使新草稿及时显示 `Run Statement` 与 `AI Explain`。
8. 用户如需执行，必须在 `.sql` 编辑器中使用现有查询命令。

### Configure Model

1. 命令或侧边栏齿轮打开独立 WebviewPanel。
2. Extension Host 只向 Webview 发送 Base URL、Model ID、Explain Instructions 和 `hasApiKey`，绝不发送已保存 Key。
3. Webview 提交 Base URL、Model ID、Explain Instructions、可选新 Key 和显式删除 Key 标志。
4. Extension Host 严格解码消息，校验 Explain Instructions 长度，保留/替换/删除 SecretStorage Key 后保存全局配置。
5. 保存成功后关闭页面，Agent Chat 重新读取配置状态。

## Security Boundaries

- 远程 Base URL 必须为 HTTPS；仅 loopback 地址允许 HTTP 和空 Key。
- API Key 只从 SecretStorage 读取，不进入设置、日志、Webview 或持久化会话。
- 自动上下文在发送与持久化前移除连接串、结构化 host/port/username/path、API Key 和当前连接已保存的数据库密码；脱敏不得用无限制子串替换破坏普通 SQL。
- Agent Webview 消息只携带会话/草稿 ID；SQL 始终从 Extension Host 会话状态解析。
- Agent Runtime 不持有 QueryRunner，也不暴露执行工具；所有 SQL 必须经过编辑器现有执行入口。
- 配置 Webview 不接收已保存 API Key，只接收 `hasApiKey` 状态。
- Explain Instructions 是普通全局设置，但不能覆盖固定 System Prompt，也不能引入 QueryRunner 或其他执行工具。
- 模型工具循环设最大 8 步，可取消并有总超时。

## Persistence

- `workspaceState` 保存最多 20 个会话。
- 持久化已脱敏的用户可见文本、助手文本、SQL 草稿、工具摘要和时间戳；固定 Explain 模型指令不作为用户消息显示或保存。
- 不持久化结果行、完整 Schema 工具输出、请求头或 API Key。

## Compatibility and Rollback

- AI 功能没有配置时保持禁用/引导状态，现有命令不依赖模型。
- QueryRunner 只保留编辑器现有执行入口，Agent 不依赖 QueryRunner。
- 若 AI Preview 出现问题，可隐藏 AI View 与 CodeLens，不影响连接、查询和结果功能。
