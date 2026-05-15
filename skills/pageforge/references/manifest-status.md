# §M1 [MANIFEST] status 受控集合

> 跨 agent dispatch 用的 `status` 字段全集 + producer ownership + lifecycle 不变量。
> 主入口：[`../SKILL.md`](../SKILL.md)。权威 JSON Schema：[`../schemas/manifest-status.schema.json`](../schemas/manifest-status.schema.json)。

[MANIFEST] 里每个组件的 `status` 字段是受控字符串集合，跨 agent 通过它做 dispatch。**所有合法值 + producer ownership**：

> **权威定义（new0.0.4 起）**：`[SCHEMAS_DIR]manifest-status.schema.json` 是本枚举的 single source of truth。schema-validator.mjs 从该文件加载；sub-agent prompt 可直接引用该路径替代手抄。下表是人类可读的镜像，**改本表必须同步那个 JSON 文件**。

| status 值 | 含义 | Producer | 写入时机 |
|-----------|------|---------|---------|
| `不存在，需新建` | 组件不存在，需新建独立文件 | visual-analyzer | step 2 阶段 4 |
| `复用现有` | 直接 import 现有组件，零改动 | visual-analyzer | step 2 阶段 4 |
| `figma_node_missing` | Figma 命中失败，跳过 token 提取 | visual-analyzer | step 2 阶段 4 |
| `待 step 3 确认` | 中间态，必须由 Phase 2 升级到下方 4 个值之一 | visual-analyzer | step 2（仅作为中间态） |
| `内联复用` | 不新建独立文件，按 inline_usage 在调用方内联 | tech-solution-generator | step 3 Phase 2 (E 类探测) |
| `内联重写` | brownfield 最小改造判定命中：不为该 NW-* 抽组件名，所有逻辑就地写在宿主组件内 | tech-solution-generator | step 3 Phase 1 步骤 2.0.5 |
| `已有可复用` | 路径已存在且可直接复用 | tech-solution-generator | step 3 Phase 2 (D 类探测) |
| `已有需改造` | 路径已存在但需修改 | tech-solution-generator | step 3 Phase 2 (D 类探测) |
| `同功能已有` | 路径不存在但找到同功能文件 | tech-solution-generator | step 3 Phase 2 (D 类探测) |

## §M1.1 不变量（lifecycle invariant）
- step 3 Phase 2 完成后，[MANIFEST] 中**禁止**残留 `待 step 3 确认` 值——所有中间态必须升级为终态值
- step 4/5 消费方遇到 `待 step 3 确认` 必须 **fail-fast**：报错并中止，提示"upstream Phase 2 未完成 status 升级"

## §M1.2 Unknown status 处理（fail-fast 但带恢复提示）
- step 4 (page-template-gen) dispatch 时遇到不在上表的 status 值 → 报错并中止，错误信息附"已知 status 全集见 pageforge/references/manifest-status.md §M1；建议默认值：`不存在，需新建`"
- 不允许下游 agent 静默落到 default 分支（容易丢组件）
