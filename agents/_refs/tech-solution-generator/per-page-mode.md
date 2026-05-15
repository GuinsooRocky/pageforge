# Per-page Mode 判定（详细规范）

> tech-solution-generator 步骤 2.0 的展开。何时 Read：开始 Phase 1 步骤 2 写 [TECH_FE] 时。

## 2.0.1 Page enumeration（页面枚举算法）

读 [CLARIFY_FE] §11 `pages: []` 列表（如有）作为 source of truth；若 §11 未显式列出，则从 §12 NW-*/RU-* 条目的 `计划路径` / `insert_into` 字段反向归集页面（按路由前缀分组，去重）。

**枚举要求**：
1. 每个页面必须能定位到一个明确的路由文件路径（如 `<source_root>/app/[locale]/profile/[id]/page.tsx`），路径取自 [CODE_BASELINE] M1/M2 推断的框架路由约定
2. 同一路由文件下的多个组件改动归为同一 page，**不重复枚举**
3. 跨页共用组件（layout / 全局 nav）归为虚拟 `shared` page

## 2.0.2 page_id 生成规则

`page_id` 由路由 path segment 派生，遵循以下确定性规则：

| 路由示例 | page_id |
|---------|---------|
| `/profile/[id]` | `page-profile` |
| `/chat/[character_id]` | `page-chat` |
| `/(dashboard)/discover` | `page-discover` |
| `/settings/notifications` | `page-settings-notifications` |
| 跨页共享 layout / nav | `shared` |

**规则**：
- 取路由 path segment 拼接 kebab-case，前缀 `page-`
- 动态段（`[id]` / `[...slug]`）**忽略**（不参与 id 生成）
- route group `(xxx)` **忽略**
- 跨页共用一律 `shared`
- 长度截断到 ≤ 30 字符（超长取头部 segment + tail 段哈希后 6 位）

## 2.0.3 per-page mode 探测

对每个枚举出的页面（不含 `shared`）：

1. 从 [CODE_BASELINE] M1 / M2 推断该页面预期路由路径
2. Bash `ls <预期路径> 2>/dev/null && echo EXISTS || echo NOT_FOUND` 判定：
   - `EXISTS` → 该页面 `mode: brownfield`
   - `NOT_FOUND` → 该页面 `mode: greenfield`

## 2.0.4 顶层 `模式:` 汇总

| 全部页面情况 | tech-fe 顶层 `模式:` | 是否输出 `pages:` |
|---|---|---|
| 全部 brownfield | `brownfield`（向后兼容）| 否 |
| 全部 greenfield | `greenfield`（向后兼容）| 否 |
| 页数 ≥ 2 且既有 brownfield 又有 greenfield | `mixed` | 是，逐页列出 |

`mixed` 严格定义：**页数 ≥ 2 且既有 brownfield 又有 greenfield 才允许**。单页面（不论结果是 brownfield 或 greenfield）一律走单值模式，不写 `pages:`。
