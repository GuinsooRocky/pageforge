# 中途落盘约束（streaming-safety 通用规则）

> 4 个 sub-agent（prd-clarifier / project-baseliner / tech-solution-generator / visual-analyzer）共享的核心约束。每个 sub-agent 在自己 spec 顶部"中途落盘约束"段引用本文件，并仅保留 agent-specific 的落盘细节（按哪些章节增量、Edit 频次等）。

## 失败模式

sub-agent 装载完整 skill + template + 大输入文件后，**单次 LLM 回合输出长 markdown** 容易 stream > 5 min 撞穿上游空闲超时（cert verification / socket closed），整段 stream 失败：

- `total_tokens: 0` billing 不落库
- 目标文件 0 字节（产物根本没写入磁盘）
- 中途处理的所有信息全丢

实战根因记录见 `agg/evolution/05.11-fe-workflow-new0.0.2-诊断.md`。

## 通用工作模式

1. **首次落盘骨架**：开始阶段（不晚于解析输入完成）先 `Write` 目标文件，内容 = 完整一级标题集合 + "进行中"占位
2. **按章节 / 条目增量 Edit**：每完成一节立刻用 `Edit` 替换该节占位为实际内容；条目类章节（≥ 30 条）每 10-15 条做一次 Edit
3. **末尾汇总（如适用）**：最后一次 Edit 仅更新 frontmatter manifest（实际 size / content_hash），不重写主体

## 禁止行为

- **禁止把目标文件当作"内存里组装好最后一次 Write"的目标**
- **禁止 sub-agent context 累积 > 200 行未落盘内容**
- **禁止 Phase X 跑完后一次性 Write 整份大 markdown**

## 失败兜底

agent 中途因传输层错误（cert / socket / network）死掉时，**已落盘的部分内容自动保留**；主 Agent 接力补缺章节比从零重跑省 50%+。
