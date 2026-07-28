# v0.3.0 AI Native Preview — Implementation Plan

## Phase 0: Version and roadmap

- [x] 将 package、lock、README 徽章和 CHANGELOG 升级为 0.3.0。
- [x] 更新中英文 README 的 AI Native Preview 定位、BYOK 和安全边界。
- [x] 更新竞品分析与 HTML 路线图：AI 从 v1.5 前移到 v0.3.0，原 v0.3 事项重新排期。
- [x] 执行版本一致性检查、类型检查、累计回归和 VSIX 打包。

## Phase 1: Model adapter and configuration

- [x] 增加 Base URL、模型、SecretStorage API Key 配置和首次使用引导。
- [x] 实现 OpenAI-compatible SSE/tool-call 适配、取消、超时和脱敏错误。
- [x] 覆盖认证、限流、流分片、工具参数和中断测试。

## Phase 2: Superseded read-only execution experiment

- [x] 曾实现只读分类、驱动保护和审批协议；在发布前评审中决定整体移除，最终产品不保留 Agent 执行。

## Phase 3: Agent runtime and tools

- [x] 实现单连接会话、上下文预算、Schema 工具和结构化 SQL 草稿。
- [x] 实现 workspaceState 会话恢复与敏感数据排除。
- [x] 确保工具结果和模型请求从不包含查询结果值。

## Phase 4: AI Explain and sidebar

- [x] 增加 Agent Chat WebviewView、流式消息、取消、配置和历史 UI。
- [x] 扩展 SQL CodeLens，增加固定 URI/range 的 `AI Explain`。
- [x] 增加选区优先、当前语句回退的命令面板入口。
- [x] 实现 SQL 草稿、插入/打开编辑器和错误修复流程。

## Phase 5: Verification and release

- [x] 更新累计验证并增加 `scripts/verify-ai-workflows.js`，覆盖模型适配、隐私、安全和 Webview 行为。
- [x] 运行 `npm run check` 和 `npm run verify`。
- [x] 检查公开 diff 不含凭据、连接串、内部端点或真实业务标识。
- [x] 构建 `sql-workbench-vscode-0.3.0.vsix`，检查包内无开发任务材料和 `s.sql`。

## Phase 6: Pre-release UX correction

- [x] 在发布准备期间保持任务未提交状态，并禁止 Trellis/AI 在未授权时提交。
- [x] 新增独立 AI 配置 WebviewPanel，覆盖 Key 保留/替换/删除和 Model ID 防错说明。
- [x] 将可见名称统一调整为 Agent Chat。
- [x] 实现 Enter 发送、Shift+Enter 换行和输入法组合保护。
- [x] 移除 Review & run、审批协议、Agent 专用 QueryRunner 执行与结果分页路径。
- [x] Insert/Open 后刷新 SQL CodeLens，并补充回归测试。
- [x] 在发布准备阶段将版本路线文档切换为当时的预发布状态。
- [x] 运行类型检查、累计验证、公开仓库预检和 VSIX 内容检查；保持全部修改未提交。

## Phase 7: Conversation timeline correction

- [x] 将消息和 SQL 草稿投影为按 `createdAt` 排序的统一时间线，稳定处理相同时间戳。
- [x] 保持流式回应位于时间线末尾，并在状态/流更新后滚动到最新内容。
- [x] 增加“历史草稿不得出现在新解释之后”的回归测试。
- [x] 重新执行类型检查、累计验证、公开仓库预检和 VSIX 内容检查；保持全部修改未提交。

## Phase 8: SQL Explain custom instructions

- [x] 新增全局 `sqlWorkbench.ai.explainInstructions` 设置、4000 字符校验与配置存储。
- [x] 在独立配置页增加多行 Explain Instructions，保持严格消息解码和 Key 不回传边界。
- [x] 仅在 SQL Explain 的固定基础要求与 SQL 之间追加非空说明，普通 Agent Chat 不受影响。
- [x] 增加空值、trim、长度、配置往返、Prompt 顺序和安全边界回归测试。
- [x] 更新 0.3.0 文档，执行类型检查、累计验证、公开预检与 VSIX 内容检查；保持未暂存、未提交。

## Phase 9: Release audit corrections

- [x] 修复连接凭据脱敏：覆盖 API Key、已保存数据库密码与连接串，并避免误改普通 SQL 标识符和值。
- [x] 将最近的宿主 SQL 草稿作为受预算限制的后续对话参考上下文，保证最新用户消息仍位于模型历史末尾。
- [x] 统一 Webview 与严格协议的 8000 字符输入限制。
- [x] SQL Explain 仅持久化简洁的用户可见请求；未配置模型时不创建失败会话。
- [x] 同步公开文档与类型安全规范，并补充针对性回归测试。

## Phase 10: Release-ready documentation

- [x] 将双语 README、CHANGELOG、竞品分析和 HTML 路线图统一为 v0.3.0 正式发布口径。
- [x] 更新 README 截图，展示 Agent Chat、SQL Explain、编辑器执行边界、模型配置和 Explain Instructions。
- [x] 使用通用示例数据重新生成全部公开截图，避免暴露内部数据库标识。

## Rollback Points

- Phase 0 可独立回退版本和路线文档。
- 模型适配层、Agent Runtime 和 UI 必须通过独立模块注册，可通过移除贡献点整体禁用。
- 普通 SQL 执行接口不得依赖 Agent；Agent 不保留任何 QueryRunner 执行入口。
