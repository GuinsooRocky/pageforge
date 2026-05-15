# §F1 / §F2 Failure 处理

> 主 Agent 调度遇错 / 决定要不要问用户时按需 Read。§F1 给总览矩阵，§F2 给 partial success 兜底链路。
> 主入口：[`../SKILL.md`](../SKILL.md)

## §F1 Failure & confirmation matrix

主 Agent 调度时遇错 / 决定要不要问用户时，从本表一处定位，**不再回到各 step 段翻**。各 step 段不再重复 Failure semantics 描述。

| step | sub-agent | 失败语义 | 主 Agent 重试 | 人工确认时机 |
|------|-----------|---------|---------------|--------------|
| 0    | project-baseliner（A）+ prd-api-fetcher（B） | A = fail-fast / B = best-effort（仅 [API] 缺失允许继续；核心 [ORIGIN_PRD] 缺失等同 fail-fast） | A/B 任一可恢复错误（socket / timeout）→ 主 Agent 自动重试 1 次；二次仍失败按本行裁定 | 无 |
| 0.5  | 主 Agent 自检（无 sub-agent） | 用户拒切片 + PRD ≥ 2000 行 → 警告允许继续，记 plan "已知风险"；PRD < 800 行未声明切片意图 → 完全跳过零开销 | - | 仅当 PRD 超阈值时必须（AskUserQuestion 切 scope） |
| 1    | prd-clarifier | fail-fast（无 [CLARIFY_FE] 产物 = step 失败）| - | **必须等**（用户回答 §9 待澄清问题） |
| 2    | visual-analyzer | fail-fast | - | 无 |
| 3    | tech-solution-generator | fail-fast（§4.0 Footprint Extract 脚本调用失败 fail-fast，禁退化为 LLM 自由扫源码） | - | 无 |
| 4    | page-template-gen | partial success（4-B 单 NW-* 失败不抛主流程，写 status=skeleton-failed，详见 §F2） | - | 无 |
| 5    | page-logic-gen | postcondition fail-fast（5-C grep `TODO step5` 残留 ≠ 登记数 → 中止） | - | 无 |

## §F2 partial success 兜底链路

```
step 4-B 产单个 NW-* 失败
  ↓
  写 placeholder div 到 page.tsx + TODO 注释
  写 nw_components 表 status=skeleton-failed + failure_reason
  不 fail-fast 主流程，继续处理下一个 NW-*
  ↓
step 4-C 收尾 aggregator
  ├─ status=ok：替换 page.tsx 里 <div data-placeholder="X" /> → <X /> + import
  ├─ status=skeleton-failed：保留 placeholder div 不替换
  └─ OR 聚合所有 status=ok 的 is_client → page.tsx 顶部 'use client'
  ↓
step 5-B component-logic
  ├─ status=ok：按 NW-* loop 填业务逻辑
  └─ status=skeleton-failed：整组跳过，[LOGIC_SUMMARY] 登记复跑入口
  ↓
step 5-C postcondition
  └─ grep TODO step5 仅校验 status=ok 的文件；不等 → fail-fast
```

**复跑入口**：[LOGIC_SUMMARY] 末尾的 "复跑指引" 段告诉用户怎么手动重跑——只对 nw_components.status=`skeleton-failed` 的 NW-* 重跑 step 4-B + step 5-B，不重跑全流程。重跑成功后改 status=`ok`，再重跑一次 step 4-C 收尾 + step 5-C postcondition 即可。
