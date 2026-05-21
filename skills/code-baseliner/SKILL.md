---
name: code-baseliner
description: 扫目标项目仓库，输出「项目字典」到 [CODE_BASELINE]——技术栈 / 组件库索引 / 状态管理资产 / 接口资产 / i18n 约定 / 灰度框架 / 设计 tokens / 项目硬规则。作为 pageforge 后续所有 step 的"项目知识翻译表"。设计跨项目通用：通过 package.json + CLAUDE.md 自动推断项目类型，不假设任何具体目录结构。在 pageforge 的 step 0 被调度。
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
metadata:
  category: frontend-development
  scope: project-level
---

# Code Baseliner

把"项目知识"从"流程知识"中独立出来——产出一份项目字典 [CODE_BASELINE]，让后续 step 通过这份字典翻译"抽象需求 → 项目实现"。

## 核心原则

1. **不假设目录结构**：不写死 `src/atomStore/` `src/components/CoUI/` 等具体路径；通过 package.json + 顶层 CLAUDE.md 推断框架，再按框架决定扫描策略
2. **语义索引而非路径索引**：组件按 `tooltip / toast / modal / button / ...` 等语义标签分类，路径只是其中一个字段
3. **只产地图不产细节**：本 skill 只回答"X 类组件叫什么、在哪"；具体 props / 用法由下游 step 自己 grep 详情
4. **增量优先**：基于现有 baseline.md 头部的 manifest 做文件级 size+mtime 比对，仅重扫变化字段；不依赖 git commit / 时间窗
5. **baseline 跟随 git**：baseline 文件期望 commit 进项目（如 `.claude/docs/code-baseline.md`），主分支为合作演进快照——新分支拉取时自动继承一份"够用的旧快照"，跑 step 0 增量补差即得最新

## 输入

- **PROJECT_ROOT**（必）：目标项目根路径（绝对路径）
- **SCOPE_HINT**（可选）：本次需求大致涉及的语义清单（如 `["tooltip", "toast", "modal"]`）；不传则做全域扫描
- **TARGET_OUTPUT**（默认 `${PROJECT_ROOT}/.claude/docs/code-baseline.md`）

## 产物目录规范

- [CODE_BASELINE] = `.claude/docs/code-baseline.md`

## Workflow

### Stage 0: 增量探测（前置）

**目标**：决定本次跑哪些字段需要重扫、哪些可以直接复用上次结果。

任务：
1. Read `${TARGET_OUTPUT}`（默认 `.claude/docs/code-baseline.md`）
   - 不存在 → 标记 `mode = full-scan`，所有字段都需重扫，跳到 Stage 1
   - 存在 → 解析头部 frontmatter 拿到 manifest
2. 对 manifest 里每个字段的 `scanned_files: [{ path, size, content_hash }]`：
   - 对每个文件 `stat` 拿当前 size，size 变了 → 该字段标 `dirty`（不必算 hash）
   - size 一致 → 用 `shasum -a 256 <path> | cut -c1-16` 或 `git hash-object <path>`（项目在 git 内时优先 git hash-object，更快）算前 16 位 hash；与 manifest 里的 `content_hash` 比对
   - hash 不一致 → 该字段标 `dirty`
   - 文件被删 / 路径不存在 → 该字段标 `dirty`
   - 全部一致 → 该字段标 `clean`

> 不再依赖 mtime（git checkout 会刷新 mtime 但内容未变，纯 mtime 判据会让 fresh checkout 全字段 dirty）。`content_hash` 只算 16 位前缀，碰撞概率可忽略，速度足够快。
3. 如果 SCOPE_HINT 存在，scope 内的字段强制标 `dirty`（即便文件没变也重扫一次以确保新增文件被发现）
4. 输出本次跑的 plan：
   - `dirty_fields`: 需要重扫的字段清单
   - `clean_fields`: 直接复用上次结果的字段清单

**特殊情况**：
- 整体 baseline.md 不存在 → `mode = full-scan`，所有字段全扫
- baseline.md 存在但 frontmatter manifest 缺失（手写过 / 旧版本）→ 退化到 full-scan + 警告
- 用户显式声明 `force_full = true` → 跳过 Stage 0，全扫

### Stage 1: 项目类型探测

任务：
1. Read `${PROJECT_ROOT}/package.json` → 拿 dependencies / devDependencies
2. Read `${PROJECT_ROOT}/CLAUDE.md`（如存在）→ 拿项目自描述
3. Read `${PROJECT_ROOT}/.claude/CLAUDE.md`（如存在）
4. Glob `${PROJECT_ROOT}/.claude/rules/*.md` → 项目硬规则清单

产物（中间，不落盘）：
- framework: `next` / `nuxt` / `vite-react` / `vite-vue` / `react-native` / 其他
- state_lib: `jotai` / `zustand` / `redux` / `pinia` / `vuex` / 其他 / 无
- styling: `tailwind` / `css-modules` / `styled-components` / `unocss` / 其他
- api_style: `trpc` / `grpc` / `rest` / `graphql` / 混合
- i18n_lib: `i18next` / `next-intl` / `vue-i18n` / 其他 / 无
- monorepo: `pnpm-workspace` / `turbo` / `nx` / 单包

> 以下 Stage 1-3 仅对 `dirty_fields` 内的字段执行；`clean_fields` 直接从上次 baseline.md 拷贝过来。

### Stage 2: 组件库索引

按预设语义标签清单扫描：

```
SEMANTIC_TAGS = [
  "tooltip", "popover", "toast", "modal", "dialog", "alert", "drawer", "sheet",
  "button", "icon", "input", "select", "checkbox", "radio", "switch", "slider",
  "form", "loading", "skeleton", "empty", "avatar", "tag", "card", "list"
]
```

对每个语义：
1. Glob 按框架推断的源码目录（Stage 1 结果）：
   - Next.js: `src/components/**` `src/app/**/components/**`
   - Vue: `src/components/**` `src/views/**/components/**`
   - 通用：`src/components/**` `packages/*/src/components/**`
2. Grep 文件名包含语义标签（大小写不敏感）的 .tsx/.jsx/.vue 文件
3. 过滤"独立组件"（含 `export default` 或 `export const Xxx`）
4. 对命中文件 grep 关键 prop/能力线索（onceKey / variant / placement / ...）

输出每个语义的索引条目：

```yaml
tooltip:
  - path: <相对项目根路径>
    file_type: tsx
    export_name: TooltipV2
    capability_hints: ["onceKey", "controlled"]
```

如果 SCOPE_HINT 给了，仅扫 hint 内的语义；否则全扫。

### Stage 3: 状态管理 / 接口 / i18n / 灰度 / 设计 tokens

按 Stage 1 探测到的栈分别 grep：

| 探测项 | 关键 grep | 产出字段 |
|---|---|---|
| 全局 atom (Jotai) | `atomWithStorage\(` `atom\(` 在 `*store*` 文件 | `state.global_atoms[]` |
| Store (Zustand) | `create\(` 含 `useStore` 模式 | `state.stores[]` |
| Pinia | `defineStore\(` | `state.stores[]` |
| tRPC | `createTRPCRouter\(` `appRouter` | `interfaces.trpc[]` |
| gRPC generated | Glob `**/generated/grpc/**` | `interfaces.grpc[]` |
| REST API | Glob `src/api/**` `src/services/**` | `interfaces.rest[]` |
| i18n locale 目录 | Glob `**/locales/*.json` `**/i18n/*` | `i18n.source` |
| AB 框架 | Grep `useGradualRollout` `useABTest` `useFeatureFlag` | `rollout.framework` |
| Design tokens | Read `tailwind.config.*` / Glob `theme/**` / `styles/tokens*` | `design_tokens.source` |
| LocalStorage 常量 | Glob `**/localStorageKey*` `**/constants/storage*` | `state.storage_keys[]` |

### Stage 4: 写出 [CODE_BASELINE]

合并产物：
- `dirty_fields` 用本轮新扫描结果
- `clean_fields` 用上次 baseline.md 的旧内容（直接拷贝）
- 头部 frontmatter 重写：每个字段的 `scanned_files` 必须更新到本次实际扫到的文件清单 + 当前 size/content_hash

按下方 schema 写 `.claude/docs/code-baseline.md`。

## [CODE_BASELINE] 输出 Schema（标准 / 跨项目通用）

每个字段三态标记：`present`（有且已识别）/ `absent`（探测后确认无）/ `partial`（部分识别，附补 TODO）。

文件以 YAML frontmatter 开头（用于增量探测），其后是人类可读 markdown 内容。

> `baseline_version` 字段语义：`0` = greenfield-empty 占位（package.json 不存在，全新仓未初始化）；`>= 1` = 有内容的扫描结果（值 = 历次扫描累计版本号）。下游 agent 判 brownfield 必须同时校验 `baseline_version >= 1` 且 `framework != greenfield-empty`。

```markdown
---
baseline_version: 1
generated_at: <ISO timestamp>
last_scan_mode: <full-scan | incremental>
project_root: <绝对路径，Stage 0 用 Bash `pwd` 获取；禁止写相对路径>
scope: <full | hinted: [tooltip, toast, ...]>
manifest:
  M1_meta:
    scanned_files:
      - { path: package.json, size: 1234, content_hash: "a1b2c3d4e5f60708" }
    status: present
  M2_dirs:
    scanned_files:
      - { path: <source_root_dir>, size: 0, content_hash: "<dir-omit>" }
      - { path: .claude/rules, size: 0, content_hash: "<dir-omit>" }
    status: present
  M3_design_tokens:
    scanned_files:
      - { path: tailwind.config.ts, size: ..., content_hash: "..." }
    status: present
  M4_tooltip:
    # 以下仅示例（占位），实际值由扫描产出
    scanned_files:
      - { path: <path/to/XxxTooltip.tsx>, size: ..., content_hash: "..." }
    status: present
  M4_toast:
    scanned_files: [...]
    status: present
  M4_<其他语义>:
    ...
  M5_state:
    scanned_files: [...]
    status: present
  M6_api:
    scanned_files: [...]
    status: present
  M7_i18n:
    scanned_files: [...]
    status: present
  M8_rollout:
    scanned_files: [...]
    status: absent
  M9_rules:
    scanned_files: [...]
    status: present
---

# Project Code Baseline

> 由 code-baseliner skill 在 <timestamp> 自动生成
> 项目根：<PROJECT_ROOT>
> Scope：<full | hinted: [tooltip, toast, ...]>

## M1 项目元信息（必有）

- framework: <next | nuxt | vite-react | vite-vue | react-native | flutter | unknown>
- framework_version: <semver>
- language: <typescript | javascript | dart | ...>
- package_manager: <pnpm | npm | yarn | bun | ...>
- monorepo: <pnpm-workspace | turbo | nx | none>

## M2 目录约定（必有）

- source_root: <绝对路径，= PROJECT_ROOT + "/" + 探测到的相对目录名，如 `/Users/foo/bar/src`>
- component_root: <绝对路径，同上规则>
- rules_root: <按候选路径列表探测；命中的列出>
  - `.claude/rules/` ✅ / ❌
  - `docs/conventions/` ✅ / ❌
  - `CONVENTIONS.md` ✅ / ❌
  - `CONTRIBUTING.md` ✅ / ❌

### M2 归置约定（必探；下游 step 4 按此放新文件，不要全塞一棵树）

扫现有源码，归纳"不同类型的文件落在哪个目录"，写成 `placement_convention`：

- `modal_dir`: 弹窗 / 对话框归置目录（探测既有弹窗文件落在哪 —— 如 `components/Modal/` 独立目录，还是和业务组件混放）
- `hook_dir`: 自定义 hook 归置目录（如 `hooks/` 根，还是 `hooks/<feature>/` 按功能分子目录）
- `util_dir`: 工具函数归置目录（如 `utils/<feature>/`）
- `store_split`: 状态 store 是单文件还是按场景拆多文件（探测既有 store 文件数 / 命名）
- `feature_layout`: 单个 feature 的组件是扁平放一个目录，还是嵌套子目录

> 探测方法：对既有同类 feature（找一个体量相近的现有功能模块）做 `ls` + `glob`，归纳它的文件分布。下游 page-template-gen 按此约定决定新文件落点。

### M2 命名约定（必探）

扫既有源码归纳 `naming_convention`：

- `dialog_suffix`: 弹窗组件文件名后缀（`XxxModal.tsx` / `XxxDialog.tsx` / 其他 —— 取项目多数派）
- `endpoint_split`: 双端组件如何拆（`.mobile.tsx` / `.pc.tsx` 文件名后缀约定 / `XxxMobile.tsx` 驼峰 / 子目录分 / 纯 CSS 媒体查询不拆 —— 取项目多数派）
- `component_case`: 组件文件名大小写（PascalCase / kebab-case）

> 根因：不探测命名约定会导致生成的弹窗用错后缀、双端拆分方式与项目不一致。

### M2 brownfield 改造阈值（可选；缺省走默认值）

### M2 brownfield 改造阈值（可选；缺省走默认值）

供 tech-solution-generator step 3 Phase 1 步骤 2.0.5「最小改造判定」消费。项目方可在此声明覆盖默认：

- `inline_rewrite_loc_threshold`: <number>（默认 `300`；改造范围 LOC 上限，越过此线即使单一调用方也允许抽 NW-*）
- `inline_rewrite_caller_count`: <number>（默认 `1`；调用方数量上限，越过此线必须抽 NW-* 实现复用）

> 不写这两个字段 = 接受默认值。项目方按工程文化调（如组件克制项目用 500 / 1，激进抽象项目用 100 / 1）。

## M3 设计系统资产（可选 / 三态）

status: present | absent | partial

- tokens_source: <tailwind.config.ts | theme/colors.ts | absent>
- color_namespace: <如 `--neutral-colors-*` / 不存在>
- typography_namespace: <...>
- spacing_namespace: <...>
- radius_namespace: <...>

## M4 组件库索引（可选 / 按语义分类）

每个语义独立三态。语义清单可由调用方扩展。

### tooltip / popover

status: present | absent | partial

| path | export | capability_hints |
|---|---|---|
| <path/to/XxxTooltip.tsx> | <XxxTooltip>（以下仅示例） | ... |

### toast / 通知

status: present | absent | partial

| path | api | rules_path |
|---|---|---|
| ... | ... | ... |

### modal / dialog / alert / drawer / sheet

status: ...

### button / input / form / select / ...

status: ...

> 默认语义清单：`tooltip popover toast modal dialog alert drawer sheet button icon input select checkbox radio switch slider form loading skeleton empty avatar tag card list`

## M5 状态管理资产（可选）

status: present | absent | partial

- state_lib: <jotai | zustand | pinia | redux | mobx | absent>
- global_stores:

  | name | path | 用途（推测） |
  |---|---|---|

- persistence_keys:（如果有 atomWithStorage / localStorage 常量集中文件）

  | key_name | source_file |
  |---|---|

## M6 接口资产（可选）

status: present | absent | partial

- api_style: <trpc | grpc | rest | graphql | mixed | absent>
- entry_paths: [<列表>]
- existing_namespaces:

  | namespace_or_router | path |
  |---|---|

> **api_style 探测规则**（按 package.json 依赖匹配，命中即标）：
> - `@trpc/server` 或 `@trpc/client` 存在 → `trpc`
> - `graphql` 或 `@apollo/client` 或 `urql` 或 `@graphql-codegen/*` 存在 → `graphql`
> - `@grpc/grpc-js` 或 `@connectrpc/connect` 或 `grpc-web` 或 `protobufjs` 存在 → `grpc`
> - 同时命中两种以上 → `mixed`
> - 仅命中 `axios` / `ky` / `swr` / `@tanstack/react-query` 等 HTTP 客户端而无上述特征 → `rest`
> - 全部都没命中 → `absent`
>
> 下游消费方（如 api-doc-gen）按本字段选择对应 template-{rest,trpc,graphql,grpc}.md。

## M7 i18n 资产（可选）

status: present | absent | partial

- i18n_lib: <i18next | next-intl | vue-i18n | absent>
- locale_files: [<绝对路径数组，下游 grep 直接消费；如 `[/Users/foo/bar/src/i18n/en.json, ...]`>]
- baseline_locale: <作为「先 grep 复用」基准的 locale 文件，通常是 en.json，绝对路径>
- key_convention_doc: <项目里描述 key 命名规则的文档路径；本字段只**引用**该路径，不抄写规则内容>

> tech-solution-generator §6 i18n 决策表强制按 `baseline_locale` 做文案值 grep；`locale_files` 数组用于 step 5 / step 6 i18n-update 时同步全 locale。

## M8 灰度 / AB 资产（可选）

status: present | absent | partial

- entry_hook_or_function: <hook 或函数名 + 路径>
- example_usage_path: <如有示例文件路径>

## M9 项目级硬规则（可选 / 索引而非内容）

status: present | absent | partial

| 规则文件路径 | 一句话主旨（可选，仅当文件头明确写了主旨时填）|
|---|---|

> 注意：本字段仅做**索引**——下游 step 需要规则细节时自己 Read 该文件，不在 baseline 里复述规则内容。
```

## 错误处理

- **package.json 不存在**：提示这不是 Node 项目，halt
- **CLAUDE.md 不存在**：跳过 Stage 1.2，仅靠 package.json + grep 推断
- **未识别框架**：framework = "unknown"，仍输出 baseline，由用户手动修
- **某语义 0 命中**：在 baseline 中标 `<no implementation found>`，提示下游 step 该语义需要新建

## Best Practices

1. **首次跑慢，之后增量**：第一次扫一个项目可能涉及上千文件 grep；之后基于 manifest 仅重扫文件 size/mtime 变化的字段，绝大多数字段秒级复用
2. **baseline commit 进项目**：`.claude/docs/code-baseline.md` 期望被 git 追踪，主分支为合作演进快照；新分支天然继承一份"够用的旧快照"，跑 step 0 增量补差即得最新
3. **SCOPE_HINT 收紧**：pageforge step 1 拿到 PRD 后可以先粗略提取语义关键词（tooltip / toast / mic ...），传给本 skill 强制重扫这几个字段以确保新增文件被发现
4. **不深挖**：本 skill 不读组件源码细节；如果下游需要某组件具体 props，下游自己 Read 该 path
5. **不修代码**：本 skill 仅产出 markdown 文档，禁止编辑任何业务代码

## Example

```
User: 给 onlychat 项目跑 baseline，scope hint = [tooltip, toast, modal, audio]
Skill:
  - PROJECT_ROOT = /Users/lengmo/Desktop/cmm/onlychat-agg-tuning
  - 探测 → next 13 / jotai / tailwind+css-modules / trpc+grpc / next-intl
  - 扫 4 个语义 + state + interfaces + tokens + rules
  - 输出 .claude/docs/code-baseline.md
```
