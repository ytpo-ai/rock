# Rock UI 规范

> 适用范围：`packages/rock/**` 下所有用户可见 UI（控制台面板、会话视图、设置页）的开发与评审。
> 定位：本文件是 DSH 既有设计系统的 **Rock 应用层约定**，只补充「Rock 怎么用」，不重复 DSH 规则；具体规则一律以 `.agents/skills/dsh-client-ui-ux/SKILL.md` 及其 references 为准。

## 1. 核心原则

1. **复用优先，不自造**：任何 UI 需求先到 `packages/client/ui-primitives`（组件目录见其 `README.md#component-catalog`）找现成组件，禁止裸写 `<table>` / `<select>` / `<input>` / `<button>` 等原生控件拼界面。
2. **token 优先，不发明数值**：颜色、材质、圆角、间距、字号一律用 `--dsw-*` design token 与主题排版角色，禁止手写十六进制色值、自定字号/圆角。参考 `docs/web-styling.md`、`docs/ui-radius.md`。
3. **不 Figma-first**：不做「先出设计稿再开发」的流程。品味来自「正确复用设计系统 + 遵守规则」，而非凭空设计；需要差异化审美时叠加 `frontend-design` 技能。
4. **明暗双主题 + 状态完整**：所有 UI 覆盖 light/dark 两主题，以及 loading（skeleton）/ empty / error（retry）/ disabled / focus 状态。

## 2. 设计系统来源

| 资产 | 位置 | 用途 |
|---|---|---|
| 组件库 | `packages/client/ui-primitives` | Button/Switch/SegmentedControl/Checkbox/Input/Menu/Tag/StateDot/Modal/Toast/Tooltip/Pill/DisclosureRow/AnimatedRows…（零 Cordis、主题感知） |
| 设计 token | `--dsw-*`（`docs/web-styling.md`） | 颜色/材质/间距/圆角 |
| 排版尺度 | `docs/web-styling.md` + `dsh-client-ui-ux` | 13px 行/细节字号；feature CSS font-weight ≤500 |
| 设计与评审 skill | `.agents/skills/dsh-client-ui-ux/SKILL.md` | 对齐/间距/图标/几何/交互规则（**主入口**） |

## 3. 开发流程（无 Figma，5 步）

1. **选参考基准**：以 DSH「插件管理（Plugins）」页为全页参考（standard full-page reference）。
2. **组件映射**：每个面板需求 → 找现成 primitive；确无匹配再谈扩展，且优先把视觉差异提炼成 prop，不复制组件。
3. **token 化**：全部用 `--dsw-*` + 排版角色，不发明尺寸/颜色。
4. **状态 + 双主题**：补齐 loading/empty/error/disabled/focus，明暗两主题各过一遍。
5. **评审**：按 `dsh-client-ui-ux` 最小检查项自查；门面面板叠加 `frontend-design`；无障碍/UX 合规审计用 `web-design-guidelines`。

## 4. 反馈与交互约定

- 瞬时成功/失败 → 全局 `Toast`；失败保留可见数据（删除失败保留该行）。
- 面板内失败 → in-place 提示 + 重试；仅空面板居中全幅错误态。
- 列表加载 → skeleton；页级加载 → 居中 spinner；同一页面仅一种加载处理。
- 破坏性操作（删除等）→ `Modal` / `RiskConfirmation` 二次确认，禁止裸按钮直删。
- 中文文案：句末不加「。」，一句话优先，避免中英混杂。

## 5. Rock 面板组件映射（速查）

| 场景 | 用 | 不用 |
|---|---|---|
| 状态 / 来源标记 | `Tag`（8 色板）、`StateDot`（done/warning/error/idle/ongoing） | 纯文本 / 自绘圆点 |
| 下拉选择 / 绑定 | `Menu` + `MenuItemButton`（`disabledReason` 承载禁用原因） | 裸 `<select>` |
| 列表 | `AnimatedRows` + `DisclosureRow` / 卡片（13px 行高） | 裸 `<table>` |
| 视图 / 筛选切换 | `Pill` / `SegmentedControl` / `SegmentedTabs` | 手写 tab |
| 删除等破坏性操作 | `Button(ghost/outline)` + `Modal`/`RiskConfirmation` | 裸 `<button>` 直删 |
| 详情 / 长文 | `DisclosureRow` / `HoverCard` / `DetailDocument` / `Tooltip` | 整段平铺 |
| 反馈 | `Toast`（瞬时）+ in-place 错误 retry | alert / 静默失败 |
| 加载 | skeleton / `TextShimmer` | 白屏 / 无态 |

## 6. 与 DSH 规则的关系

本文件是 Rock 对 DSH 设计系统的**应用约定**；凡 DSH 已定义的规则（对齐/间距/图标/几何/交互/圆角/响应式/文案 locale），一律以 DSH 的 skill 与文档为准，本文件不重复、不冲突。
