# [TECH_FE] 文档 schema 模板（详细）

> tech-solution-generator 步骤 2 写入 [TECH_FE] 时使用的完整 schema。何时 Read：完成步骤 1+2.0+2.1 后，开始 Write [TECH_FE] 时。

```markdown
---
baseline_version: {来自 CODE_BASELINE frontmatter}
模式: brownfield   # 或 greenfield / mixed
# 仅当 模式: mixed 时输出 pages 列表：
# pages:
#   - id: page-chat
#     name: 聊天页
#     mode: brownfield
#     path: <source_root>/app/[locale]/(dashboard)/chat/[character_id]/page.tsx
#   - id: page-discover
#     name: 发现页
#     mode: greenfield
#     path: <source_root>/app/[locale]/(dashboard)/discover/page.tsx
生成时间: {日期}
---

# 技术方案

## §1 需求概述
{简短总结本次迭代目标，1~3 句}

## §2 交互说明
{来自 CLARIFY_FE §10，列出关键交互规则，不复制整篇}

## §3 接口使用
| 接口 | 用途 | 请求参数说明 |
{来自 API，只列本次涉及的接口}

## §4 组件清单

> mixed 模式下，§4.1 ~ §4.5 每张表必须额外含 `page_id` 列（值取自顶层 `pages[].id`，跨 page 共用条目填 `shared`）；非 mixed 模式可省略。
>
> **`shared` 归属统一规则**（page-template-gen 4.M 遵守）：page_id == `shared` 的条目一律按 **brownfield 路径** 处理（在 step 4 走 4.1 外科手术；不产 NW-* 骨架，不进 nw_components 状态表）。理由：跨 page 共用组件多为全局 layout / 已有共享件，新建场景极少；若实际需要新建跨页共享组件，tech-solution-generator 把它落到具体某个 page_id 并附备注，不要标 shared。

### §4.0 现有足迹基线（brownfield 强制；greenfield 留空"无现有代码"）

> 来源：step 2.1 Footprint Extract。每个被改文件一行（多文件 → 多 block）。
> §5 逻辑方案、§4.4 删除清单、§4.6 删除授权清单都必须基于本节展开。
> 实际提取内容由 [CODE_BASELINE] 探测到的项目资产决定（组件库前缀 / 埋点 hook 名 / 响应式 hook 名 / 暗色模式模式等）。

**Example**（仅作格式演示；下方具体值取自一个虚构 onlychat-like 项目，实际项目从 [CODE_BASELINE] 读）：

```
文件：<绝对路径>
- 组件库引用：[ButtonV2, MobileDrawer, Toast]   # 完整列出（来自 [CODE_BASELINE] M4）
- 埋点调用：[tl('interest-tag-select') @L412, tc('interest-tag-btn') @L488, TrackButtonClick('tag_info') @L386]   # hook 名来自 [CODE_BASELINE] M5
- i18n key：[interest_tag_label, interest_tag_add, interest_tag_add_full, max_tags_tips]   # 共同前缀：interest_tag_*
- 业务过滤：[排除 'image' / 'target' / 'crushon_*' tags（L353-360）]
- 响应式策略：CSS-breakpoint（sm:flex / sm:hidden 出现 14 处，无 JS-detect hook）
- 暗色模式：Tailwind dark:bg-* / dark:text-* / dark:border-* 共 23 处
```

### §4.1 改动现有组件
| 组件名 | 文件路径 | 改动内容 | 来源编号 | page_id |

### §4.2 新建文件清单
| 文件路径 | 职责 | 来源编号（NW-xxx）| page_id |

### §4.3 改动现有文件
| 文件路径 | 改动类型 | 插入点描述 | 来源编号 | page_id |

### §4.4 删除清单
| 文件路径 | 删除原因 | page_id |

### §4.5 复用现有（不改）
| 组件名 | import 路径 | 来源编号（RU-xxx）| page_id |

### §4.6 足迹删除授权清单（brownfield 强制；删除任何 §4.0 列出的足迹必须在此登记）

| 被删除足迹 | 类别 | 所在文件 | [CLARIFY_FE] 授权段号 | 授权摘录 |
|----------|------|---------|---------------------|---------|

> **硬规则**：§4.0 列出但 §4.6 未登记的足迹，在 step 4/5 写代码时**必须保留**（继承到新代码 / 不删 import / 不删埋点 / 不删过滤逻辑 / 不漏 dark: class）。
> **埋点例外**：埋点类足迹一律不可删除（即使 [CLARIFY_FE] 说改），表里不允许出现 `类别 = 埋点调用` 的行。需要新增 event 时通过 §8 走加法。
> 空表保留表头，写一行 `（无授权删除项）`。

## §5 逻辑方案
{按 NW-* 编号逐条，描述：触发时机 / 数据流 / 状态管理 / 依赖 hook / 边界条件}
{只写 WHY & 约束，不写代码示例}

> **brownfield 强制**：每条 NW-\* / 改动条目必须显式说明它如何继承 §4.0 现有足迹（组件库组件用哪个、保留哪些埋点、复用哪些 i18n key、保留哪些过滤逻辑、响应式策略沿用哪种、暗色模式 class 怎么覆盖）。如不继承某条足迹，必须在 §4.6 已登记授权。

## §6 i18n
i18n 改动策略遵循 [CODE_BASELINE] M9（如有 add-only / mutable 约束）；M9 未声明则参考 [CLARIFY_FE] §14 项目级偏好（缺省按"先复用后新增"）。

**强制流程：先 grep 复用，后新增 key**

每条要的文案，必须先按文案值 grep [CODE_BASELINE].M7.locale_files 查现有 key 命中情况（精确等值或子串匹配），命中即复用，不命中才新加。**禁止凭命名直觉直接新加 key**——同义文案（如 "Done" / "Confirm" / "Manage" / "Cancel" 这类高频词）通常项目里已有对应 key。

执行步骤：
1. 列出本次需求需要的所有文案 → 「文案需求清单」
2. 对每条文案，按 [CODE_BASELINE].M7.locale_files 路径 grep 文案值（默认基准 locale，如 en.json）
3. 命中现有 key → 标 `复用 {key}`；不命中 → 标 `需新加 {建议 key 名}`
4. 命名规则参考 [CODE_BASELINE].M7.key_convention_doc，避免在新 key 名里塞中缀（`_btn_` `_drawer_` 等）破坏项目命名风格

**i18n 决策表**（必填，表头不可省略）：

| 文案 | 现有 key 命中？ | 决策 | 来源 |
|---|---|---|---|
| "Done" | ✅ `done` | 复用 `done` | grep en.json |
| "Manage" | ✅ `manage` | 复用 `manage` | grep en.json |
| "Confirm" | ✅ `confirm` | 复用 `confirm` | grep en.json |
| "Add interest tags" | ❌ 未命中 | 新加 `interest_tag_add_full` | 命名遵 §M7 约定 |

新增 key 清单（仅含上表中"需新加"项）：
| key | 默认值（英文）| 用途 |

## §7 AB 实验 / 灰度
{如无则留"本次迭代无 AB 实验"}

## §8 埋点
**本次迭代不改动埋点**

## §9 待探测问题（Q-T* 列表）
{逐条列出"实现时需确认但无法仅靠 PRD 判断"的技术问题}
{格式：}

### Q-T1：{问题简述}
**类型**：A / B / C
- 涉及：{组件 / hook / 路径 / 常量}
- 如果答案是 X：{影响分支 1}；如果是 Y：{影响分支 2}
```

> §9 Q-T\* 类型定义（供 Phase 2 使用）：
> - A：组件 props 形状 / 文件路径 / 常量是否存在 → 纯 grep 可查清
> - B：跨文件流程链 / hook 调用路径 → grep + Read + 推理
> - C：mobile 视口 / 键盘交互 / 浏览器兼容 → 需 dev server 实测，留 Phase 2 标记
>
> D（存在性检查）和 E（复用必要性）不是 PRD 层面的问题，不列入 §9。Phase 2 步骤 4/5 对所有 §4.2 条目系统性执行。
