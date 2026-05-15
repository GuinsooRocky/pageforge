# pageforge scripts

跨项目通用源码扫描脚本，给 pageforge step 3（§4.0 现有足迹基线）提供"确定性程序提取"能力，把"枚举"工作从 LLM 拿走，让 LLM 专注于"理解和判断"。

> **设计原则**：脚本本身禁止 hardcode 项目特定资产名（组件 / hook / track 函数 / i18n 函数 / 灰度框架）；项目特定参数从 [CODE_BASELINE] 读取，缺失时用合理默认值（覆盖大部分 React/Next.js 项目）。
>
> **pageforge 单一职责 = 生码**。本目录脚本只服务于"生码必经的数据提取"（如 §4.0 现有足迹基线），**不做** typecheck / lint / baseline diff / 静态分析 / 评估打分——这些是项目级 CI / pre-commit / IDE 的职责，跨项目假设性强不该入 spec。

## 文件结构

```
.claude/skills/pageforge/scripts/
├── README.md                       本文件
├── lib/
│   └── extract.mjs                 共享提取逻辑（6+1 类提取函数 + 配置加载）
├── footprint-extractor.mjs         源码 → 结构化 footprint.json（step 3 §2.1 调用）
├── d-class-prober.mjs              §4.2 新建路径存在性 + 同功能候选枚举（step 3 Phase 2 步骤 5 调用）
├── page-aggregator.mjs             4-C 收尾：placeholder 替换 + import 批量 + 'use client' 聚合 + 双校验（step 4 调用）
└── schema-validator.mjs            sub-agent return 前 Postcondition 自检（step 2/3/4 schema 受控集合 + 关键不变量校验）
```

零外部依赖，纯 node 内置 fs / child_process + 系统 grep 实现。直接 `node .../<script>.mjs` 即可跑。

## d-class-prober.mjs 用法

```bash
node d-class-prober.mjs \
  --input items.json \
  --source-root /abs/path/to/project/src \
  [--output result.json] \
  [--include tsx,ts,jsx,js]
```

输入 `items.json`：

```json
[
  { "nw_id": "NW-001", "plan_path": "/abs/path.tsx", "keywords": ["TooltipV2", "tooltip-v2"] }
]
```

输出 `result.json`：

```json
{
  "results": [
    { "nw_id": "NW-001", "plan_path": "...",
      "exists": true|false,
      "candidates": [{ "path": "...", "matches": 3 }, ...]
    }
  ],
  "stats": { "total": N, "exists": N, "with_candidates": N, "no_match": N }
}
```

LLM 读 JSON 后按 4 个 manifest status（`已有可复用` / `已有需改造` / `同功能已有` / `不存在，需新建`）做最终归类——脚本不做语义判断，只枚举事实。

> **分工边界**：脚本只跑 `fs.existsSync` + `grep -r -l "<keyword>"`，确定性 100%，跨 NW-* 不漏；"现有文件能直接 import 用 vs 需改造"这种语义判断只能由 LLM 做（要读文件内容评估）。

## 提取的 6+1 类信息

| 类别 | 提取方式 | 解决的 LLM 失败模式 |
|------|---------|------------------|
| **imports** | regex 匹配 `import ... from '...'` | LLM 漏列 import 路径 |
| **tracking_calls** | regex 匹配项目埋点函数调用 | LLM 漏埋点 |
| **i18n_keys** | regex 抽 `t('xxx')` 等 key（dedup）| LLM 漏 key |
| **business_filters** | regex 抽 .filter / .includes / .some / .find / intersection | LLM 漏业务过滤 |
| **responsive** | hooks（useScreenTypeStore 等）+ CSS breakpoint（md/lg）| LLM 漏响应式策略 |
| **dark_mode** | regex 抽 `dark:[\w-/...]+` 类 | LLM 漏 dark class |
| **rollout** *(bonus)* | regex 抽 useGradualRollout / ROLLOUT_TOPIC | LLM 漏灰度 |

每条带行号 + 上下文 snippet。

## 用法

```bash
node .claude/skills/pageforge/scripts/footprint-extractor.mjs \
  --files <p1>,<p2>,... \
  [--baseline <path/to/code-baseline.md>] \
  [--output footprint.json]
```

### 参数

- `--files`（必填）：逗号分隔，绝对或相对路径
- `--baseline`（可选）：[CODE_BASELINE] markdown 路径，用于读项目特定配置；缺失则用默认配置
- `--output`（可选）：输出 JSON 路径（默认 `footprint.json` 当前目录）

### 在 pageforge 中的集成点

**step 3 tech-solution-generator §4.0 现有足迹基线**：
1. step 3 phase 1 步骤 2.1 Footprint Extract：先调本脚本，把 [TECH_FE] §4.3 改动文件列表传入
2. 拿到 footprint.json 后，LLM 直接读 JSON 写 §4.0（六类按格式填表）
3. LLM 不再"扫源码"，只负责"填表 + 业务理解判断"

### 输出 schema

```json
{
  "summary": {
    "total_files": <n>,
    "total_imports": <n>,
    "total_tracking_calls": <n>,
    "total_i18n_keys": <n>,
    "total_business_filters": <n>,
    "total_dark_classes": <n>,
    "total_rollout_hits": <n>,
    "responsive_strategies": [{"file": "...", "strategy": "js-detect|css-breakpoint|mixed|none"}]
  },
  "config_used": { /* 实际生效的配置 */ },
  "files": [
    {
      "path": "<absolute path>",
      "imports": [{"line": <n>, "from": "...", "named": ["X","Y"], "default": "Z|null", "is_component_lib": <bool>}],
      "tracking_calls": [{"line": <n>, "call": "TrackButtonClick", "first_arg": "tag_info|null"}],
      "i18n_keys": [{"line": <n>, "call": "t|tl|tc", "key": "interest"}],
      "business_filters": [{"line": <n>, "pattern": "array_filter|array_includes|...", "snippet": "..."}],
      "responsive": {"js_hooks": [...], "css_breakpoint_count": <n>, "css_breakpoint_distinct": [...], "strategy": "..."},
      "dark_mode": [{"line": <n>, "class": "dark:bg-..."}],
      "rollout": [{"line": <n>, "match": "useGradualRollout|ROLLOUT_TOPIC.xxx"}]
    }
  ]
}
```

## 跨项目通用配置（从 [CODE_BASELINE] 读）

脚本会尝试从 [CODE_BASELINE] markdown 中匹配以下字段（任意 case，下划线/空格随便）：

| [CODE_BASELINE] 字段 | 默认值 | 影响哪类提取 |
|-------------------|------|------------|
| `tracking_function_names` | `[]`（**空数组**——项目自创埋点函数必须显式提供，缺则不抓）| tracking_calls |
| `i18n_function_names` | `['t']`（i18n 标准函数；项目用其他名时覆盖）| i18n_keys |
| `component_lib_prefixes` | `['@/components/']`（通用 monorepo 别名） | imports.is_component_lib 标记 |
| `rollout_hook_pattern` | `'use\\w*FeatureFlag\\w*\|use\\w*ABTest\\w*\|use\\w*Rollout\\w*'`（通用 GrowthBook/LaunchDarkly/Statsig 语义） | rollout |
| `dark_mode_pattern` | `'tailwind-dark-class'`（默认 Tailwind；`'theme-context'` 用 useTheme/themeMode）| dark_mode |

字段写法示例（baseline markdown 中任意一行）：

```markdown
- tracking_function_names: ['TrackButtonClick', 'TrackWithParams', 'tl', 'tc', 'Track']
- i18n_function_names: ['t', 'tl', 'tc']
- component_lib_prefixes: ['@/components/CoUI/', '@/components/']
- dark_mode_pattern: 'tailwind-dark-class'
```

如果 [CODE_BASELINE] 没这些字段，脚本会用默认值——大部分 React/Next.js 项目能直接跑通。code-baseliner skill 后续可以扩展把这些字段写入 baseline。

## 不该做的事（设计边界）

以下事情**不属于**本脚本职责：

| 不该做 | 原因 | 该归谁 |
|--------|-----|--------|
| typecheck（tsc / flow）| 跨项目假设性强（不是每个项目都用 TS）；首次启动慢；与生码无直接关联 | 项目级 CI / pre-commit / IDE |
| lint / format | 同上 | 同上 |
| baseline diff（vs main / develop）| 真实生码场景下"生成代码 vs baseline diff"逻辑反转——生成代码本来就该跟 baseline 不一样（改造 / 重构）| 不该自动化；如需评估 pageforge 改造效果，单独写评估脚本不入 spec |
| 静态分析 / 复杂度 / 圈复杂度 | 同 typecheck | CI / SonarQube 等 |

如果你想加新脚本到这个目录，先问：**"这个工具是不是生码必经的数据提取？"** 不是 → 不要加。

## page-aggregator.mjs 用法

```bash
node page-aggregator.mjs \
  --page <page.tsx 绝对路径> \
  --manifest <nw_components.json> \
  [--page-self-client true|false] \
  [--dry-run]
```

输入 `nw_components.json`：

```json
[
  {
    "nw_id": "NW-001",
    "name": "TooltipV2",
    "import_path": "@/components/TooltipV2",
    "status": "ok",
    "is_client": true
  },
  {
    "nw_id": "NW-002",
    "name": "FailedComp",
    "import_path": "...",
    "status": "skeleton-failed",
    "is_client": false
  }
]
```

脚本动作：
1. 替换 status=`ok` 的 `<div data-placeholder="<nw_id>" ... />` → `<Name />`
2. 在 import 块末尾批量 append `import { Name } from '<import_path>';`（重复的不再加）
3. OR 聚合：任一 status=ok 的 `is_client=true` 或 `--page-self-client=true` → 顶部加 `'use client';`（已存在则保留）
4. 双校验：替换计数 == status=ok 计数 / 残留 placeholder 计数 == status=skeleton-failed 计数；任一不等 → exit 2

输出（stderr）：
```
✅ page-aggregator: replaced 10 / added 10 import / 'use client' added / retained 2 skeleton-failed
   initial placeholders=12, after-replace remaining=2 (== skeleton-failed count ✓)
```

> **分工边界**：脚本不判 page.tsx 自身是否需要 'use client'（这要 LLM 按 4 条件判定 page 自己用了 hooks/事件/浏览器 API），LLM 通过 `--page-self-client` flag 告知；脚本只做 OR 聚合 + 替换 + 校验。

## schema-validator.mjs 用法

**Postcondition 自检模式**——由 sub-agent 在 return 给主 Agent 之前调用，发现 schema 违规自己改完再校验，pass 才 return。**主 Agent 不直接调用本脚本**。

```bash
# step 2 visual-analyzer return 前
node schema-validator.mjs --step 2 --manifest <component-manifest.md 路径>

# step 3 tech-solution-generator return 前
node schema-validator.mjs --step 3 --manifest <component-manifest.md> --tech-fe <tech-fe.md>

# step 4 page-template-gen return 前
node schema-validator.mjs --step 4 --template-summary <template-gen-summary.md>
```

### 校验项（覆盖最常见漂移）

| step | 校验项 | 出错原因示例 |
|---|---|---|
| 2 | manifest 每行 status 在 8 个枚举内 | LLM 自创 `已存在` |
| 3 | step 2 全部 + 不允许残留 `待 step 3 确认` + tech-fe `模式:` 合法 + mixed 时 pages 非空且 ≥ 2 项 | Phase 2 漏升级中间态 / mixed 写错 |
| 4 | template-summary 含 `## nw_components 状态表` + 5 列 + status ∈ {ok, skeleton-failed} + path 绝对路径 + is_client ∈ {true, false, -} | 4-B loop 写错列数 / 用相对路径 |

### 输出

**Pass**：
- exit 0
- stdout 输出 `validator-pass-token: step<N>-<8字符 hash>`
- stderr 输出 `✅ schema-validator step <N> PASS (...)`

**Fail**：
- exit 2
- stderr 列出每条违规（含 rule / 行号 / 当前值 / 修复 hint）

### Sub-agent 自检循环（spec 强制）

每个目标 sub-agent（visual-analyzer / tech-solution-generator / page-template-gen）在 return 前必须：

1. 调脚本
2. exit 0 → 把 stdout 的 `validator-pass-token` 复制到 return summary 末尾
3. exit 2 → 按 stderr hint 自己 Edit 修产物文件 → 回到 1
4. 最多重试 3 次；3 次仍 fail → return error summary 让主 Agent 决定回滚

### 跟其他脚本的关系

| 脚本 | 角色 |
|---|---|
| footprint-extractor / d-class-prober / page-aggregator | **替代 LLM 干活**（脚本做枚举 / 替换） |
| **schema-validator** | **不替代干活，给 LLM 加红绿灯**（产物 schema 校验） |

零外部依赖，纯 node 内置 fs/regex 实现。

> **历史脚本回退记录**：原 `figma-node-matcher.mjs`（5-06 引入，5-07 删除）尝试用 token-set Jaccard + 中英关键词扩展替代 LLM 做 NW-* ↔ Figma 节点 fuzzy 匹配。回归测试发现该脚本在"NW-* 功能命名 vs Figma page-state 命名"跨语义维度场景下命中率 < 20%，LLM 仍需二次纠偏 → token 没省下反而多一轮算法回路。验证了"fuzzy 算法天然不胜任跨命名维度的语义映射"，相关工作还给 LLM 直接决策。详见 `agg/evolution/5-07-figma-node-matcher-removal.md`。新增脚本前先问"工作适合脚本（确定性提取/校验）还是 LLM（语义理解/跨域映射）"。
