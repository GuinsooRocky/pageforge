# Phase 2 — 实现层探测（详细规范）

> tech-solution-generator Phase 2 的展开。何时 Read：Phase 1 完成 [TECH_FE] 写入后，立即开始执行探测。

Phase 1 写完 [TECH_FE] 后，**立即继续**执行探测，不等人工确认。

---

## 步骤 3：A/B/C 类探测（§9 Q-T* 逐条）

对每条 Q-T\*，根据类型执行：

### A 类 — 纯 grep

```bash
grep -r "关键词" "$PROJECT_SRC" --include="*.tsx" --include="*.ts" -l
```

回填格式（Edit [TECH_FE] §9 对应 Q 下追加）：
```
#### 探测结果（step 3）
✅ 已查清：{文件路径}:{行号} — {关键发现}
```

### B 类 — grep + Read + 推理

先 grep 找文件，再 Read 读关键段落，给出证据链：
```
#### 探测结果（step 3）
✅ 已查清：
- {文件A}:{行号} → {说明}
- {文件B}:{行号} → {说明}
⚠️ 风险：{如有暗坑则记录}
```

### C 类 — 留 dev server 实测

```
#### 探测结果（step 3）
⏸️ 留 step 4 实测：{原因}
```

---

## 步骤 4：E 类探测（§4.2 新建清单逐条复用必要性检查）

对每个 NW-\* 新建文件，判断是否真的需要新建文件，还是直接内联使用现有组件：

### 检查方式

1. 读 [MANIFEST] 里该组件的 `wraps` 字段（step 2 已标注它包装了哪个现有组件）
   - **`wraps` 字段非空** → 读 [CODE_BASELINE] M4 确认被包装组件 props，进第 3 步判断表
   - **`wraps` 字段为空 / 不存在** → **不能直接判 `需新建文件`**。`wraps` 空只代表 step 2 visual-analyzer 没标出复用关系，**不代表项目里没有现成组件**。必须先做第 2 步主动复用扫描：
     - **判断该 NW-* 是不是"通用能力型"**（编辑器 / 输入框 / 弹窗 / 抽屉 / 工具栏 / 图标 / chip / tooltip / tab / 表单字段 / 上传控件 等）
     - 是 → 按能力语义 grep `[CODE_BASELINE]` M4 + 整个 source_root 找现成实现（按"它提供什么能力"搜，不按 NW-* 名搜）。找到 → 回填 `wraps` 后进第 3 步判断表；确认无现成 → 才判 `需新建文件`
     - 否（纯业务定制、greenfield 无现有代码）→ 判 `需新建文件`
2. （wraps 空时）执行上述主动复用扫描
3. 读 [CODE_BASELINE] M4，确认被包装组件的 props 接口
4. 逐条对照下方判断表，得出唯一结论

> 根因：原"wraps 空 → 直接判需新建、跳过判断表"是个洞 —— 它把"visual-analyzer 没找到映射"误当成"项目里没有现成组件"，导致已 ship 的通用组件被当 net-new 重造。wraps 空是**触发复用扫描的信号**，不是"需新建"的结论。

### 复用探测要扫 hook / util / 样式常量层，不只组件层（强制）

E 类探测**不能只盯 `components/`**。判定"需新建文件"后，仍要做一轮**实现层复用扫描**，在 `e_probe` / [TECH_FE] §5 里登记可复用的项目既有资产：

- **hook 层**：按功能语义（上传 / 校验 / 裁剪 / 轮询 / 防抖 等）grep `[CODE_BASELINE]` M2 的 `hooks/` 目录，而非按组件名。例：图像上传字段该复用 `useUploadFile.getImgUrlFromS3`（签名 URL + 上传 + retry）+ `hooks/image-upload/validation`，不是从零写上传逻辑。
- **util 层**：grep `utils/` 找既有工具函数（解析 / 格式化 / 裁剪算法等）。
- **样式常量层**：表单 / 输入类组件，grep 项目既有的 className 常量（如 `FLAT_INPUT_CN` 之类），优先复用，不要凭 Figma 估 padding/spacing 数值。

> 根因：复用探测只指组件级引用、漏 hook/util/样式常量层，会从零重写已有能力 + padding 不对齐项目约定。判定"需新建文件"≠"内部逻辑全部新写"，新文件内部仍应最大化复用既有 hook/util/常量。

### 判断表（逐条检查"需新建文件"条件，任意命中 → 需新建文件；全部不命中 → 内联复用）

| 情况 | 结论 |
|---|---|
| 拥有独立 state（useState / useReducer / useAtom，该 atom 属于本组件所有） | 需新建文件 |
| 有 useEffect（订阅 / 初始化 / 清理 / 定时器） | 需新建文件 |
| 有副作用调用（API mutation / 命令式 UI 调用 / 路由跳转，在事件里触发） | 需新建文件 |
| 事件处理逻辑协调多步（校验 → 请求 → 跳转等多个副作用串联） | 需新建文件 |

以上全部不命中 → **内联复用**（只做固定 props 配置 / 只读 store / 只做 props 推导 / 只透传回调 / 条件渲染 / 自定义样式均属此类）。

**结论只有"内联复用"和"需新建文件"两种，不存在第三种。判断到结论后直接执行，不附加其他理由改变结论。**

### 处理方式

- 结论为"内联复用"：更新 manifest status 为 `内联复用`，填写 `inline_usage`（记录宿主组件里的内联用法），填写 `e_probe`，step 4 不新建该文件
- 结论为"需新建文件"：manifest 保持不变，填写 `e_probe` 注明判断依据（必须是判断表中"需新建文件"的具体条目）

### sample_usage 强约束（仅当 wraps 字段非空）

如果该 NW-* 的 `wraps` 字段非空（包装现有组件 — 例如 CoUI MobileDrawer / Modal / Tooltip 等基础组件），**必须**在 manifest 中补充 `sample_usage` 字段，记录至少 1 处现有调用方供 step 4 模仿用法：

```bash
grep -rn "<{wraps_component_name}\b" "$PROJECT_SRC" --include="*.tsx" -l | head -3
```

**取至少 1 处**真实调用方，写入 `sample_usage` 字段（绝对路径 + 行号），**step 4 实现 NW-* 时必须 Read 该 sample_usage 路径**，看清楚被包装组件的真实用法（是用 props 槽如 `header` / `footer`、还是 children 自由布局？是 `isOpen` 还是 `open`？等等），再写代码。

**不填的代价**：仅靠读 props 类型签名容易漏掉项目惯例（如 MobileDrawer 应使用 `header` / `footer={{ onOk, okText }}` 内建槽 vs 自己写 sticky 布局），导致实现绕过了组件库设计。

### 更新 [MANIFEST] 格式

```markdown
- **status**: 内联复用
- **inline_usage**: `<TooltipV2 onceKey="..." placement="top" text={...}>` 直接在宿主组件使用
- **e_probe**: 只传固定 props，无独立状态/副作用（step 3 · {日期}）
```

```markdown
- **e_probe**: 有 useEffect 订阅 audioWsStatusAtom（step 3 · {日期}）
- **sample_usage**: src/app/.../HeaderSettingModal.tsx:42（grep -n "MobileDrawer" 取 top1，step 4 必读以模仿 header/footer 槽用法）
```

---

## 步骤 5：D 类探测（§4.2 新建清单逐条存在性检查）

**调脚本枚举事实，不再 LLM 自己 ls + grep**。同 §2.1 Footprint Extract 的分工模式：脚本只做 fs.existsSync + grep 候选枚举（确定性，跨 NW-* 不漏），LLM 只做语义判断（4 个 status 值的最终归类）。

### 调用脚本

1. 把 §4.2 新建清单准备成 JSON 输入文件（每条提供 `nw_id` / `plan_path` / `keywords`）：

```bash
cat > /tmp/d-class-input.json <<'JSON'
[
  { "nw_id": "NW-001", "plan_path": "{绝对计划路径}", "keywords": ["ComponentName", "component-name"] },
  ...
]
JSON
```

> `keywords` 由 LLM 从组件名派生（建议同时给 PascalCase 原名 + kebab-case 变体）；脚本不做语义派生，只按你给的 keywords 做枚举。

2. 调脚本：

```bash
node [D_CLASS_PROBER] \
  --input /tmp/d-class-input.json \
  --source-root "$PROJECT_SRC" \
  --output [FIG_META]/d-class-probe.json
```

`[D_CLASS_PROBER]` 路径见 pageforge/SKILL.md 环境变量节登记。

### 读取脚本输出

`d-class-probe.json` schema：

```json
{
  "results": [
    { "nw_id": "NW-001", "plan_path": "...",
      "exists": true|false,
      "candidates": [{ "path": "...", "matches": <int> }, ...]
    }
  ],
  "stats": { "total": N, "exists": N, "with_candidates": N, "no_match": N }
}
```

### LLM 判断 → 更新 [MANIFEST] status

按下表把每条 result 归类到 4 个 manifest status 之一（这一步必须 LLM 做，脚本不能判断"内容可直接复用 vs 需改造"）：

| 脚本结果 | LLM 进一步判断 | manifest status 值 |
|---|---|---|
| `exists: true` | 读 plan_path 内容评估：现有文件能直接 import 用？ | `已有可复用` + `import_from: {plan_path}` |
| `exists: true` | 现有文件需要改才能用？ | `已有需改造` + `modify_path: {plan_path}` |
| `exists: false` 且 `candidates 非空` | 候选 top1 是同功能文件？ | `同功能已有` + `similar_path: {top1.path}` |
| `exists: false` 且 `candidates 空` | — | `不存在，需新建` |

用 Edit 更新 [MANIFEST] 对应组件的 `status` + `existence_probe` 字段，引用 d-class-probe.json 的具体证据：

```markdown
- **status**: 不存在，需新建
- **existence_probe**: d-class-probe.json NW-001 → exists=false, candidates=[]（step 3 · {日期}）
```

```markdown
- **status**: 同功能已有
- **existence_probe**: d-class-probe.json NW-002 → exists=false, top1=src/components/CommonTooltip.tsx (3 hits)（step 3 · {日期}）
```

### 脚本失败兜底

若 `Bash` 调用返回非零退出 / d-class-probe.json 不存在 → fail-fast 报错，不进入步骤 6。常见原因：source_root 路径错误 / input JSON 格式不规范 / node 不可用。

---

## 步骤 6：写探测摘要

在 [TECH_FE] §9 末尾追加：

```markdown
### 探测摘要（step 3 · {日期}）

| 编号 | 类型 | 探测结论 |
|---|---|---|
| Q-T1 | A | 已查清：{关键发现} |
| Q-T2 | B | 暗坑：{风险描述} |
| Q-T3 | C | 留 step 4 实测 |
| NW-001（E 类） | E | 内联复用 / 需新建文件 |
| NW-002（D 类） | D | 不存在，需新建 / 已有可复用 / 同功能已有 |
```
