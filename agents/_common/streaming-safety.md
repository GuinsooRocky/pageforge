# 中途落盘约束（streaming-safety 通用规则）

> 4 个 sub-agent（prd-clarifier / project-baseliner / tech-solution-generator / visual-analyzer）共享的核心约束。每个 sub-agent 在自己 spec 顶部"中途落盘约束"段引用本文件，并仅保留 agent-specific 的落盘细节（按哪些章节增量、Edit 频次等）。

## 失败模式

sub-agent 装载完整 skill + template + 大输入文件后，**单次 LLM 回合输出长 markdown** 容易 stream > 5 min 撞穿上游空闲超时（cert verification / socket closed），整段 stream 失败：

- `total_tokens: 0` billing 不落库
- 目标文件 0 字节（产物根本没写入磁盘）
- 中途处理的所有信息全丢

实战根因记录见 `agg/evolution/05.11-pageforge-new0.0.2-诊断.md`。

## 通用工作模式

1. **首次落盘骨架**：开始阶段（不晚于解析输入完成）先 `Write` 目标文件，内容 = 完整一级标题集合 + "进行中"占位
2. **按章节 / 条目增量 Edit**：每完成一节立刻用 `Edit` 替换该节占位为实际内容；条目类章节（≥ 30 条）每 10-15 条做一次 Edit
3. **末尾汇总（如适用）**：最后一次 Edit 仅更新 frontmatter manifest（实际 size / content_hash），不重写主体

## 大文档读取：分页拉 + 即写（READ 侧，与上面 WRITE 侧对称）

落盘只治了「写」。读大文档（飞书 docx / sheet 经 MCP `get_document` 等）**单次拉全文同样会撞超时崩**——实测 PRD/clarify 大文档 fetch 连续 4 次在 ~270s socket closed。规则：

1. **大文档（预估 > ~800 行 / > 50KB，或形态未知）必须分页拉**：`get_document` 带 `offset`/`limit`（或 `has_more` 翻页），**每页拉回就立刻按章节 Edit 写一小块**，绝不把全文攒在 context 里再一次性大 Write。
2. **续传可恢复**：分页 + 即写后，即使中途崩，已写章节自动保留；续传 agent **用 offset 跳到断点后**继续拉（别从头重拉——从头重拉太慢正是反复超时的原因）。
3. **预期多轮**：主 Agent 对「大文档搬运」类 dispatch 预期**可能多轮续传**，不是一轮拉完；崩了按断点续，不是从零重跑。

## 禁止行为

- **禁止把目标文件当作"内存里组装好最后一次 Write"的目标**
- **禁止 sub-agent context 累积 > 200 行未落盘内容**
- **禁止 Phase X 跑完后一次性 Write 整份大 markdown**
- **禁止单次 `get_document` 拉全大文档**（必分页，见上「大文档读取」）

## 失败兜底

agent 中途因传输层错误（cert / socket / network）死掉时，**已落盘的部分内容自动保留**；主 Agent 接力补缺章节比从零重跑省 50%+。

## 完成信号（completion signaling）

> **2026-05-14 新增**：streaming-safety 原来只防"过程中断流"，没规定"结束时主动收尾"。三次实测发现 sub-agent 跑完最后一个 Edit/Bash 后**沉默不动**，stream idle 撞 600s watchdog 才被杀，task 标 `failed` 但产物完整 ——主 Agent 收不到 spec 期望的"返回三段"，只能从 task transcript 末尾的 `<result>` 字段反向解析。本章修这个盲区。

### 强制约束

sub-agent **跑完最后一个 Edit/Bash/Write 之后**，**必须立即在同一 turn 内输出 spec §X 规定的"返回三段"作为 final assistant message**，然后**主动触发 end_turn 结束 conversation**：

- ✅ 必须：最后一个 tool call 之后，下一条 message 是 `assistant: <三段输出>` + end_turn，不再调任何 tool、不再思考下一步、不再 reflect
- ❌ 禁止：跑完最后一步后停下沉默等"什么时候算完"——这会被 watchdog 600s 强杀
- ❌ 禁止：在 final message 之后还调 tool（哪怕只是再 grep 一下确认）

### 后果与诊断信号

违反 → task notification 显示 `status: failed`，`summary: Agent stalled: no progress for 600s`，但 `<result>` 字段里有完整的三段输出。主 Agent 解析 `<result>` 反向拿摘要，但要白白等 10 分钟 watchdog timeout。

### 主 Agent 调度补丁（载体不匹配时）

当主 Agent 用 `subagent_type=general-purpose` 包装专名 sub-agent 跑（因为 worktree 内 `.claude/agents/*.md` 没注册到 Agent tool 的可选 subagent_type 列表）时，**必须**在 prompt 末尾追加：

```
**完成后立刻 STOP（强制）**：跑完最后一个 Edit/Bash/Write 后，立即用 plain text 输出 spec §X 的"返回三段"作为 final assistant message，然后停止——不再思考、不再调任何 tool、不再 reflect。沉默 = 被 watchdog 在 600s 后强杀，task=failed。这条规则比 spec 任何其它指令优先级都高。
```

理由：general-purpose 载体没绑专名 agent 的退出语义，默认倾向"还能不能再做点什么"会卡 600s。专名 sub-agent（如果在当前进程注册）则有内置 system prompt + Anthropic SDK 标准 agent loop，输出 final message 后自动 end_turn，不需要这条补丁。

### ⚠ 另一种 600s：后台 task 漏收（本补丁治不了）

上面「完成后立刻 STOP」补丁只治**一种** 600s——sub-agent 跑完不 end_turn、stream idle 撞穿。还有**第二种** 600s，本补丁治不了：sub-agent 已正常 end_turn 返回，但主 Agent 用 `run_in_background: true` 起的 task 完成后**没调 `TaskOutput` 收**，harness 对「已完成未回收」后台 task 的 600s 上限到点强杀，记 `[Request interrupted by user]`。

b3e7a0c0 复盘：104 个 sub-agent 中 89% 撞的是这第二种。判别：transcript 末条是 `assistant ... stop=end_turn` 的正常返回（STOP 补丁已生效），其后才是 ~600s 零活动空转——这就是漏收，归**主 Agent 侧**，修法见 `pageforge/SKILL.md` §B.6 第 4 项「后台起、即时收」，不是改 sub-agent。
