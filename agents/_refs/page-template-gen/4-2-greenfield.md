# 4.2 新建路径（greenfield · React/Next.js）

> page-template-gen 4.2 路径详细规范。何时 Read：[TECH_FE] `模式: greenfield` 时；mixed 中分发到 greenfield 子页面时。

## 目标

新增页面/路由，按 4-A/4-B/4-C 三阶段产 Next.js App Router TSX 骨架 + 子组件骨架 + 完成 page.tsx 装配。

## React/Next.js 规范

| 约定项 | 规则 |
|---|---|
| 文件单位 | `page.tsx`（路由入口）/ `ComponentName.tsx`（组件） |
| Layout | 项目实际 layout（读 code-baseline M1 确认，不假设） |
| 样式 | Tailwind class + `.map()` |
| 组件声明 | `export default function` 或 `'use client'` + `export function` |
| 占位符 | `<div className="border border-dashed border-white/50" data-placeholder="ComponentName" data-node-id="x:xxx" />` |

## 执行

### 阶段 4-A：page-skeleton

> **Framework 适配门禁（必须先做）**：读 [CODE_BASELINE] M1.framework：
> - `framework=react+next` / `react+vite` / 其他 React 变体 → 调用 `m0-template-gen` skill 产 React TSX 入口文件（默认 `page.tsx` / `<route>.tsx`，由 baseline M2 路由约定决定）
> - `framework=react-native` / `svelte` / `vue` / `flutter` / 其他 → **不调 m0-template-gen**（m0 是 React-only），由 page-template-gen 按各框架约定自行产对应入口文件（如 RN → `Screen.tsx`、Svelte → `+page.svelte`、Vue → `index.vue` 由专门 Vue 子模板处理，待补）
> - m0-template-gen 已于 2026-05-03 从 Vue 版改造为 React 版；Vue 项目支持待后续重新引入 Vue 子模板

1. **React 项目（M1.framework=react+next / react+vite / 其他 React 变体）**：调用 `m0-template-gen` skill 产 React TSX
2. **非 React 框架项目**：按 [CODE_BASELINE] M1 + M2 路由约定，由 page-template-gen 直接产入口文件（如 React Native → `src/screens/<Name>Screen.tsx`、Svelte → `src/routes/+page.svelte`）；Vue 项目暂无 m0 支持，需调度方手动补对应骨架（待后续 Vue 子模板回填）
3. 如设计稿有全屏背景图：调用 `get-background-img` skill 拿 URL → 按 framework 写入背景样式（React 走 `style={{ backgroundImage: 'url(...)' }}`；Vue 走 `:style` 绑定；RN 走 `ImageBackground` 组件）
4. Bash 校验：`grep -c 'data-placeholder' <入口文件>` 必须 ≥ §4.2 组件类条目数（每个 NW-* 在入口文件都有 placeholder 锚点；资产类按需附加，不强校验上限）
5. 产出 `.claude/docs/placeholder-list.md`，**仅记录资产类占位**（图标 / 插画 / 占位图等需要人工补图的非代码资产）；组件类不进 placeholder-list（由 4-B 直接产骨架文件 + 4-C 替换）

### 阶段 4-B：component-skeleton

> 同 4.1 改造路径"步骤 2"——参考主索引"通用规则 / 'use client' 4 条件判定 / partial success fallback / nw_components 状态表写入"节。

对每个 status=`不存在，需新建` 的 NW-*：

1. 按 NW-* loop **单次单文件** Write NW-name.tsx 骨架（结构 + design token → Tailwind + import + props 类型 + 函数体留 `// TODO step5` 占位）
2. 判定 'use client' 4 条件，写入 nw_components 状态表 `is_client` 字段
3. 产骨架失败 → partial success fallback（写 status=`skeleton-failed` + failure_reason；不抛主流程）
4. 产骨架成功 → 写入 nw_components 状态表 status=`ok`

### 阶段 4-C：收尾 aggregator

> 完整规则见主索引"通用规则 / 4-C 收尾 aggregator"节——本节只是同 spec 的简短指引，不要重复 4 步。

**一句话**：调 `[PAGE_AGGREGATOR]` 脚本，输入 page.tsx + nw_components manifest JSON + page-self-client 判定，脚本一次完成"placeholder 替换 / import 批量 / 'use client' OR 聚合 / 双校验"；脚本退 0 = 通过，非 0 = fail-fast。

LLM 在本阶段的全部职责：
1. 把 [TEMPLATE_SUMMARY] nw_components 状态表转成 manifest JSON（含 import_path 由 [CODE_BASELINE] M2 alias 派生）
2. 按 4 条件判 page.tsx 自身是否 client（脚本不判这个）
3. 调脚本，读 stderr 输出
4. 失败时按错误信息修 manifest / page.tsx 后重跑脚本（不要自己 Edit 兜底）
