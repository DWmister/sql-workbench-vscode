# 表结构字段排序实现调研

## 当前实现

- `src/schema/tableDetailsPanel.ts` 在生成 Webview HTML 时把 `details.columns` 直接渲染为表格行。
- `ColumnInfo` 已包含 `name`、完整行信息和 `ordinal`，数据库定义顺序无需额外计算。
- Webview 客户端已有统一点击事件分发，可在不增加扩展宿主消息和数据库请求的情况下处理排序。
- 每次切换表都会重新设置整个 Webview HTML，因此排序状态自然重置为原始顺序。

## 推荐实现边界

- 默认按 `ordinal` 对应的原始顺序展示。
- 首版只把 Name 表头做成排序按钮，状态循环为原始、升序、降序。
- 排序对象是整行 `ColumnInfo`，字段属性不会错位。
- 字段名比较忽略大小写，同名时按原始位置稳定排序。
- 使用 `aria-sort` 和可见方向符号表达状态。

## 验证入口

- `scripts/verify-workflows.js` 维护跨版本累计回归基线，并包含 `verifyTableDetailsWebview` 和轻量 DOM harness。
- 扩展 harness 后可直接执行 Webview 客户端脚本，验证三态排序、整行一致性和无宿主消息。
- 现有 DDL 加载、复制、刷新、重试断言继续作为兼容回归。

## 风险

- 如果首版同时开放所有表头排序，需要分别定义空值、布尔值、类型和默认值的比较规则，产品与测试范围会明显扩大。
- 直接修改初始 HTML 行顺序会丢失恢复原序依据；应保留初始顺序或显式记录原始索引。
