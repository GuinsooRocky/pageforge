#!/usr/bin/env node
// nw-slicer.mjs — pageforge lever ② per-NW-* 切片器
//
// 零外部依赖（仅 node 内置）。产物结构契约见 schemas/nw-slice.schema.json，
// 解析依赖的锚点契约见 agents/_refs/tech-solution-generator/tech-fe-schema.md
// 文末「§4/§5 NW-* 锚点契约」。
//
// 用法：
//   node nw-slicer.mjs --step 4|5 --tech-fe <p> --manifest <p> --baseline <p> \
//        [--template-summary <p>] --nw-id NW-007[,NW-008,...] --out-dir <dir>
//
// 对每个 NW-* 产出 <out-dir>/<NW-ID>.slice.md。
// 内容关键分节（A1/A2/A3/B1/B3）任一为空 → exit 2（slice-incomplete），
// 主 Agent 应 fail-fast、不 dispatch。
//
// NW-* 间依赖契约：由 B4 全局 store 契约 + B7 import 白名单（读 manifest deps.consumes）
//   承载；旧 B6/edges.json 体系 2026-05-21 已砍（见 CHANGELOG）。
//
// P0-1 status 守卫 + 富化（2026-05-19）：
//   守卫（P0-1a）— 产切片前按 manifest status 校验主切片目标：step 4 仅放行
//     `不存在，需新建`、step 5 仅放行 nw_components status=`ok`；不符 / 含未定案
//     「建议再拆」标记 → exit 2 fail-fast、不产切片。把「该不该 dispatch」从主 Agent
//     自觉变成脚本硬守卫。
//   富化（P0-1b）— B5 sibling 目录 / B7 来源1（manifest deps.consumes）的每个依赖都标注
//     manifest status + 生成指令（内联复用/内联重写 → 禁 import、必须内联；其余 → 可按
//     plan_path import）。根治「消费方把内联复用依赖盲写成 import 幽灵组件」。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// ---------- arg ----------
function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--step') a.step = argv[++i];
    else if (k === '--tech-fe') a.techFe = argv[++i];
    else if (k === '--manifest') a.manifest = argv[++i];
    else if (k === '--baseline') a.baseline = argv[++i];
    else if (k === '--template-summary') a.templateSummary = argv[++i];
    else if (k === '--nw-id') a.nwId = argv[++i];
    else if (k === '--out-dir') a.outDir = argv[++i];
    else if (k === '--edges-dir') { argv[++i]; } // 2026-05-21 砍 edges 体系；参数容忍但忽略（向后兼容旧调用）
  }
  return a;
}

function die(msg, code = 1) {
  console.error(`nw-slicer: ${msg}`);
  process.exit(code);
}

function readText(p, label) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (e) {
    die(`无法读取 ${label}：${p}（${e.code || e.message}）`);
  }
}

// ---------- markdown 辅助 ----------
function splitFrontmatter(text) {
  if (!text.startsWith('---')) return { fm: '', body: text };
  const nl = text.indexOf('\n');
  const end = text.indexOf('\n---', nl);
  if (end === -1) return { fm: '', body: text };
  const fm = text.slice(nl + 1, end);
  const bodyStart = text.indexOf('\n', end + 1);
  return { fm, body: bodyStart === -1 ? '' : text.slice(bodyStart + 1) };
}

function fmGet(fm, key) {
  const m = fm.match(new RegExp(`^\\s*${key}\\s*[:：]\\s*(.+)$`, 'm'));
  return m ? m[1].trim() : '';
}

// 抽取 heading 区段：从匹配 startRe 的行（含）到匹配 endRe 的行（不含）/ EOF
function extractSection(lines, startRe, endRe) {
  const s = lines.findIndex((l) => startRe.test(l));
  if (s === -1) return null;
  let e = lines.length;
  for (let i = s + 1; i < lines.length; i++) {
    if (endRe.test(lines[i])) { e = i; break; }
  }
  return lines.slice(s, e);
}

// 表格数据行（去掉表头 + 分隔行）
function tableDataRows(sectionLines) {
  const rows = [];
  let headerSeen = false;
  for (const l of sectionLines) {
    if (!/^\s*\|/.test(l)) continue;
    if (/^\s*\|[\s|:-]+\|?\s*$/.test(l)) continue; // 分隔行
    const cells = l.split('|').slice(1, -1).map((c) => c.trim());
    if (!headerSeen) { headerSeen = true; continue; } // 跳表头
    rows.push({ raw: l.trim(), cells });
  }
  return rows;
}

// nw-id 带非数字边界匹配（防 NW-7 误命中 NW-70）
function hasNwId(str, nwId) {
  return new RegExp(`(^|[^\\d])${nwId.replace(/[-]/g, '\\-')}([^\\d]|$)`).test(str);
}

// ---------- 各分节抽取 ----------

// §5：把整个 §5 拆成 per-NW-* chunk
// 注意：end 边界先于 §5.5（契约对账表）截断——否则 §5.5 的表格行会被 bleed 进
// 最后一个 NW-* 的 A2。§5.5 不存在时正则回退到 §6（向后兼容旧 tech-fe）。
function s5Chunks(techFeLines) {
  const sec = extractSection(techFeLines, /^##\s+§?5\b/, /^##\s+§?(?:5\.5|6)\b/);
  const map = new Map();
  if (!sec) return map;
  let cur = null;
  for (const l of sec) {
    const m = l.match(/^###\s+(NW-\d+)\b/);
    if (m) { cur = m[1]; map.set(cur, []); }
    if (cur) map.get(cur).push(l);
  }
  return map;
}

// §5.5 跨 NW-* 契约对账表（可选；step 3 产出，nw-slicer 解析为 B9 切片节）。
// 表格行严格格式：| 契约符号 | kind | owner | 形状 | 写回义务 |
//   - kind ∈ atom|type|hook|enum|callback
//   - 形状：字段/返回键/枚举值，逗号分隔（如 `name, description, entries` 或 `Draft=0, Published=1`）
//   - 写回义务：`NW-003:name; NW-005:description,coverUrl`（每个写入方 NW-* 一段；无则 `—`）
function s55Rows(techFeLines) {
  const sec = extractSection(techFeLines, /^##\s+§?5\.5\b/, /^##\s+§?6\b/);
  if (!sec) return [];
  const rows = [];
  for (const { cells } of tableDataRows(sec)) {
    if (cells.length < 5) continue;
    const [symbol, kind, owner, shape, writeback] = cells;
    if (!/^NW-\d+$/.test(owner.replace(/`/g, '').trim())) continue; // 跳过表头/分隔行
    rows.push({
      symbol: symbol.replace(/`/g, '').trim(),
      kind: kind.trim().toLowerCase(),
      owner: owner.replace(/`/g, '').trim(),
      shape: shape.trim(),
      writeback: writeback.trim(),
    });
  }
  return rows;
}

// 解析写回义务串 `NW-003:name; NW-005:description,coverUrl` → Map(NW-id → [字段])
function parseWriteback(s) {
  const out = new Map();
  if (!s || s === '—' || s === '-') return out;
  for (const seg of s.split(';')) {
    const m = seg.match(/\s*(NW-\d+)\s*[:：]\s*(.+)\s*/);
    if (m) out.set(m[1], m[2].split(',').map((f) => f.trim()).filter(Boolean));
  }
  return out;
}

// B9：把 §5.5 契约对账表里与本 NW-* 相关的行，按 消费 / 写回义务 / owner 三视角渲染。
// consumesNames = 本 NW-* deps.consumes 的 name 集合（判断它消费了哪些契约）。
function contractSlice(s55rows, nwId, consumesNames) {
  if (s55rows.length === 0) return '';
  const consumed = [];
  const writebackDuties = [];
  const owned = [];
  for (const r of s55rows) {
    if (r.owner === nwId) owned.push(r);
    if (consumesNames.has(r.symbol)) consumed.push(r);
    const wb = parseWriteback(r.writeback);
    if (wb.has(nwId)) writebackDuties.push({ symbol: r.symbol, owner: r.owner, kind: r.kind, fields: wb.get(nwId) });
  }
  if (consumed.length === 0 && writebackDuties.length === 0 && owned.length === 0) return '';

  const out = [];
  if (writebackDuties.length) {
    out.push('### ⚠️ 你的写回义务（这些必须真正 set 回 atom/store，只写 local state = 数据静默丢失）');
    for (const d of writebackDuties) {
      // 区分「字段名」(plain identifier) 与「动作语义」(boolean atom 等，含括号/中文/空格)
      const plainFields = d.fields.filter((f) => /^[A-Za-z_$][\w$.]*$/.test(f));
      const actions = d.fields.filter((f) => !/^[A-Za-z_$][\w$.]*$/.test(f));
      const parts = [];
      if (plainFields.length) parts.push(`写回字段 **${plainFields.map((f) => `\`${f}\``).join(', ')}**`);
      if (actions.length) parts.push(`执行 **${actions.join('、')}**`);
      out.push(`- \`${d.symbol}\`（owner ${d.owner}，${d.kind}）：本组件必须${parts.join('；')} —— 用 \`useSetAtom(${d.symbol})\` / 对应 setter 真正写入；漏写即业务动线断裂（dead-state-scanner P9 / nw-verifier V5 会查）。`);
    }
    out.push('');
  }
  if (consumed.length) {
    out.push('### 你消费的契约形状（按此精确使用，勿臆造字段名 / 枚举值 —— 防 enum 错位、防解构幽灵字段）');
    out.push('> **enum 行**：形状只给成员名 + proto 源路径；**数值以 proto 为准——必须 `import` proto enum 成员，勿照抄本表、勿凭命名直觉编数值**（手写数值必抄错）。');
    out.push('| 契约 | kind | owner | 形状（字段/返回键/成员名）|');
    out.push('|---|---|---|---|');
    for (const r of consumed) out.push(`| \`${r.symbol}\` | ${r.kind} | ${r.owner} | ${r.shape} |`);
    out.push('');
  }
  if (owned.length) {
    out.push('### 你作为 owner 导出的契约（消费方按此形状依赖你，导出形状必须与此一致）');
    out.push('| 契约 | kind | 形状 |');
    out.push('|---|---|---|');
    for (const r of owned) out.push(`| \`${r.symbol}\` | ${r.kind} | ${r.shape} |`);
    out.push('');
  }
  return out.join('\n').trim();
}

// §4 整段
function s4Section(techFeLines) {
  return extractSection(techFeLines, /^##\s+§?4\b/, /^##\s+§?5\b/) || [];
}

// A1：§4 各表格里 来源编号 列 == nwId 的行
function a1Rows(s4Lines, nwId) {
  const hits = [];
  for (const { raw, cells } of tableDataRows(s4Lines)) {
    if (cells.some((c) => c === nwId || hasNwId(c, nwId))) hits.push(raw);
  }
  return hits;
}

// 从 A1 行里抽出 path-like 单元格（用于 join §4.0 / §4.6）
function pathsFromRows(rawRows) {
  const set = new Set();
  for (const raw of rawRows) {
    for (const c of raw.split('|')) {
      const t = c.trim().replace(/^`|`$/g, '');
      if (/[\w[\]()@.-]+\/[\w[\]()./-]+\.(tsx?|jsx?|vue|svelte)$/.test(t)) set.add(t);
    }
  }
  return [...set];
}

// A8：§4.2「最小改造判定结果」段里含 nwId 的行
function a8Line(s4Lines, nwId) {
  const idx = s4Lines.findIndex((l) => /最小改造判定结果/.test(l));
  if (idx === -1) return '';
  for (let i = idx + 1; i < s4Lines.length; i++) {
    if (/^###?\s/.test(s4Lines[i])) break;
    if (hasNwId(s4Lines[i], nwId)) return s4Lines[i].trim();
  }
  return '';
}

// §4.0 足迹 block（按 `文件：<path>` 分块），join 给命中 host path 的
function a4Footprint(techFeLines, hostPaths) {
  const sec = extractSection(techFeLines, /^###?\s+§?4\.0\b/, /^###?\s+§?4\.1\b/);
  if (!sec || hostPaths.length === 0) return '';
  const blocks = [];
  let cur = null;
  for (const l of sec) {
    if (/^文件\s*[:：]/.test(l)) { cur = [l]; blocks.push(cur); }
    else if (cur) cur.push(l);
  }
  const out = [];
  for (const b of blocks) {
    if (hostPaths.some((p) => b[0].includes(p))) out.push(b.join('\n'));
  }
  return out.join('\n\n');
}

// §4.6 授权行：所在文件命中 host path
function a5Auth(s4Lines, hostPaths) {
  const sec = extractSection(s4Lines, /^###?\s+§?4\.6\b/, /^###?\s+§?5\b/) || s4Lines;
  const hits = [];
  for (const { raw } of tableDataRows(sec)) {
    if (hostPaths.some((p) => raw.includes(p))) hits.push(raw);
  }
  return hits.join('\n');
}

// manifest：含 nwId 的 ## block
function manifestBlock(manifestBodyLines, nwId) {
  let s = -1;
  for (let i = 0; i < manifestBodyLines.length; i++) {
    if (/^##\s/.test(manifestBodyLines[i]) && hasNwId(manifestBodyLines[i], nwId)) { s = i; break; }
  }
  if (s === -1) return '';
  let e = manifestBodyLines.length;
  for (let i = s + 1; i < manifestBodyLines.length; i++) {
    if (/^##\s/.test(manifestBodyLines[i])) { e = i; break; }
  }
  return manifestBodyLines.slice(s, e).join('\n').trim();
}

// 从某 NW-*/RU-* 的 manifest ## block 抽 status 字段值（P0-1）。
// manifest 格式：每个组件 ## block 内一行 `- **status**: <值>`。
function manifestStatusOf(manifestBodyLines, id) {
  const block = manifestBlock(manifestBodyLines, id);
  if (!block) return '';
  const m = block.match(/^\s*-\s*\*\*status\*\*\s*[:：]\s*(.+?)\s*$/m);
  return m ? m[1].trim() : '';
}

// manifest block 是否含未定案的「建议再拆」标记（P0-1a：step 3 未收敛 → 不可 dispatch）。
function hasUnresolvedSplitMark(manifestBodyLines, id) {
  return /建议再拆/.test(manifestBlock(manifestBodyLines, id));
}

// 依赖组件「生成指令」—— 据其 manifest status 告诉消费方该 import 还是内联（P0-1b）。
function depDirective(status) {
  switch (status) {
    case '不存在，需新建':
      return '本轮产出独立文件 → 可 import';
    case '内联复用':
      return '⚠️ 内联复用：无独立文件 → 必须把其 JSX 内联进本组件，禁止 import';
    case '内联重写':
      return '⚠️ 内联重写：无独立文件 → 逻辑就地写入宿主，禁止 import';
    case '复用现有':
    case '已有可复用':
      return '现有文件 → 按 plan_path import 复用';
    case '已有需改造':
      return '现有文件需改造 → 按 plan_path import';
    case '同功能已有':
      return '已有同功能文件 → 按 plan_path import（可能需适配）';
    case 'figma_node_missing':
      return '纯逻辑组件 → 按 plan_path import';
    case '待 step 3 确认':
      return '⚠️ status 未定（step 3 Phase 2 未完成）→ 不可依赖';
    case '':
      return '⚠️ manifest 无 status → 谨慎核对，勿盲写 import';
    default:
      return `（status=${status}）按 manifest 处理`;
  }
}

// baseline M1/M2/M4/M5/M7/M9
function baselineModules(baselineLines) {
  const out = [];
  for (const m of [1, 2, 4, 5, 7, 9]) {
    const sec = extractSection(baselineLines, new RegExp(`^##\\s+M${m}\\b`), /^##\s/);
    if (sec) out.push(sec.join('\n').trim());
  }
  return out.join('\n\n');
}

// B4：§5 里被 ≥2 个 NW-* 引用的 atom/store（best-effort 启发式）
function globalStores(chunks) {
  const ref = new Map(); // name -> Set(nwId)
  for (const [nwId, lines] of chunks) {
    const text = lines.join('\n');
    for (const m of text.matchAll(/\b([A-Za-z][\w]*(?:[Aa]tom|Store))\b/g)) {
      if (!ref.has(m[1])) ref.set(m[1], new Set());
      ref.get(m[1]).add(nwId);
    }
  }
  const global = [...ref.entries()].filter(([, s]) => s.size >= 2);
  if (global.length === 0) return '';
  return global.map(([n, s]) => `- \`${n}\` —— 被 ${[...s].join(', ')} 引用（跨 NW-* 全局契约）`).join('\n');
}

// B7：import 白名单 —— dispatch 前注入，sub-agent 写 import 时必须命中本表。
// 三来源合并：① manifest deps.consumes（本 NW-* consume 的 NW-*，按 manifest provides + import_path 拼）
//             ② [CODE_BASELINE] M2/M4 既有组件清单（已落地的可直接 import）
//             ③ bare 包（NPM 包不限制，本节只说明边界）
// 解析 manifest 某 NW-* block 的 deps.consumes 数组（替代 edges.json，B6/edges 体系 2026-05-21 砍后）。
// 格式：`## N name（NW-xxx）` block 下 `- **deps**:` → `- consumes:` → `    - { from: NW-Y, kind: K, name: Z }`
function manifestConsumes(manifestBodyLines, id) {
  let inBlock = false;
  let inConsumes = false;
  // 组件 header 是顶层 `## N name（NW-xxx）`；deps.consumes 块在组件内部、位于 `### e_probe` 等子 header 之后
  const idRe = new RegExp(`^##\\s.*[（(]${id}[）)]`);
  const out = [];
  for (const line of manifestBodyLines) {
    if (idRe.test(line)) { inBlock = true; inConsumes = false; continue; }
    // 只在遇到下一个顶层组件 header (`## `) 时 break；`### 子header` 不能终止（否则到不了 deps 块）
    if (inBlock && /^##\s/.test(line)) break;
    if (!inBlock) continue;
    if (/^\s*-?\s*consumes\s*:/.test(line)) { inConsumes = true; continue; }
    if (inConsumes) {
      // 退出 consumes：遇到非缩进 list item（如 provides 行 / 顶层 - 字段）
      const item = line.match(/\{\s*from:\s*(NW-\d+)\s*,\s*kind:\s*(\w+)\s*,\s*name:\s*([^}]+?)\s*\}/);
      if (item) { out.push({ from: item[1], kind: item[2], name: item[3].trim() }); continue; }
      if (/^\s*-\s+\*\*/.test(line) || /^\s*-\s+provides\s*:/.test(line)) { inConsumes = false; }
    }
  }
  return out;
}

function allowedImports(nwId, manifestBodyLines, baselineLines) {
  const lines = [];

  // 来源 1：manifest deps.consumes → 拼 NW-* import 来源（B6/edges 砍后改读 manifest deps）
  lines.push('### 来源 1：本 NW-* 的 deps.consumes 依赖（manifest deps 块）');
  const outEdges = manifestConsumes(manifestBodyLines, nwId);
  if (outEdges.length === 0) {
    lines.push('（无 NW-* 间依赖；本 NW-* 不从其它 NW-* import 任何符号）');
  } else {
    lines.push('| from NW-* | manifest status | 可 import 的符号 | import 路径 |');
    lines.push('|---|---|---|---|');
    for (const e of outEdges) {
      const st = manifestStatusOf(manifestBodyLines, e.from) || '?';
      const importable = st === '内联复用' || st === '内联重写' ? '**禁止 import（必须内联）**' : `\`${e.name || ''}\``;
      const ipath = importPathOf(manifestBodyLines, e.from) || '(查 manifest)';
      lines.push(`| ${e.from} | ${st} | ${importable} | \`${ipath}\` |`);
    }
  }
  lines.push('');

  // 来源 2：baseline M2/M4 既有组件
  lines.push('### 来源 2：[CODE_BASELINE] M2/M4 既有组件 / hook / atom');
  const baselineSig = extractBaselineImportable(baselineLines);
  if (baselineSig.length === 0) {
    lines.push('（CODE_BASELINE 未列出可 import 目标 —— 项目可能是 greenfield-empty）');
  } else {
    lines.push(...baselineSig.map(l => `- ${l}`));
  }
  lines.push('');

  // 来源 3：bare 包
  lines.push('### 来源 3：NPM 包（bare specifier）');
  lines.push('NPM 包名（`react` / `jotai` / `framer-motion` / `next/*` / 等）**不在本约束范围内**——按 [CODE_BASELINE] M1 已声明依赖正常 import。5-C 第二关 import-resolver 也会跳过 bare specifier。');
  lines.push('');

  // 禁止
  lines.push('### ❌ 禁止行为（违反则 5-C 第二关硬 fail）');
  lines.push('写 import 时**任何不在以上三类**的来源都禁止：');
  lines.push('- ❌ 凭空 import 一个本轮 [MANIFEST] 未登记的"下游子组件名"（典型："为了让本文件看起来完整，我猜一个 EditorPublishBar/EntryCharCountBanner 等子组件名 import 进来"——5-C 第二关会抓 broken import 硬 fail）');
  lines.push('- ❌ 从一个真实存在的 barrel 文件里 import 一个**未 export 的符号**（5-C 第二关只查文件存在性、查不到这条，但写代码时必须先在 B5 sibling 目录确认 barrel 真 export 了该符号）');
  lines.push('- ❌ 自己写 inline SVG/icon 绕过"找不到 icon"——必须先 grep B1 baseline / B5 sibling 的 icon 库；找不到则写占位（见下方修正方向）');
  lines.push('');
  lines.push('### ✅ 修正方向（需要某不存在的下游时）');
  lines.push('① 写 `// TODO step5-pending: 需新增子组件 <Name>，本轮 [MANIFEST] 未登记` 占位 + placeholder JSX（**不写 import 语句**）；该项进阻塞账本由用户/上游评估');
  lines.push('② 或：回 step 3 把该组件登记进 [MANIFEST] 作为新 NW-*，重跑 4-B/5-B');

  return lines.join('\n');
}

// 从 manifest body 提取某 NW-* 的 plan_path 字段（也兼容 import_path）。
// idRe 同时支持英文括号 (NW-008) 和中文括号 （NW-008）—— manifest 实际用中文括号。
function importPathOf(manifestBodyLines, id) {
  let inBlock = false;
  const idRe = new RegExp(`^#{1,5}\\s.*[（(]${id}[）)]`);
  for (const line of manifestBodyLines) {
    if (idRe.test(line)) { inBlock = true; continue; }
    if (inBlock && /^#{1,5}\s/.test(line)) break;
    if (inBlock) {
      const m = line.match(/[-*]\s*\*\*(?:plan_path|import_path)\*\*\s*:\s*[`'"]?([^`'"\s]+)/i)
        || line.match(/[-*]\s*(?:plan_path|import_path)\s*:\s*[`'"]?([^`'"\s]+)/i);
      if (m) return m[1];
    }
  }
  return '';
}

// 从 CODE_BASELINE frontmatter 抽 M2_*/M4_*/M5_* 节段的可 import 路径作摘要清单。
// baseline 实际格式是 YAML（不是 markdown heading）：manifest.M2_dirs / M4_modal / M5_state 等
// 节点下含 scanned_files: [{ path: src/.../X.tsx }]。简化：直接 grep `path: <src/...>` 抽。
function extractBaselineImportable(baselineLines) {
  const out = [];
  let curBucket = '';
  for (const line of baselineLines) {
    // 节段名：YAML 缩进开头 `  M2_dirs:` / `  M4_modal:` 等
    const h = line.match(/^\s+(M[2-9][\w_]*)\s*:\s*$/);
    if (h) { curBucket = h[1]; continue; }
    // 路径行：` - { path: src/components/CoUI/Modal/Modal.tsx, ... }`
    const p = line.match(/path:\s*([^\s,}]+\.(?:tsx?|jsx?))/i);
    if (p) {
      const fp = p[1];
      // 只保留 src/ 下的真实 ts/tsx 文件（剔除配置类）
      if (fp.startsWith('src/')) out.push(`[${curBucket || '?'}] \`${fp}\``);
    }
  }
  return [...new Set(out)].slice(0, 40); // 防爆，最多 40 条
}

// B8：禁忌生码 pattern —— 从 forbidden-patterns.schema.json 读 x-canonical.patterns 渲染。
// 与 dead-state-scanner.mjs 共享同一份 patterns 真相（事前注入 + 事后扫描双层防御）。
function forbiddenPatterns() {
  const here = fileURLToPath(import.meta.url);
  const schemaPath = path.join(path.dirname(here), '..', 'schemas', 'forbidden-patterns.schema.json');
  let schema;
  try {
    schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  } catch {
    return '（forbidden-patterns.schema.json 缺失或解析失败 —— slicer 跳过 B8 渲染）';
  }
  const patterns = schema['x-canonical']?.patterns || [];
  if (patterns.length === 0) return '（schema 未含 patterns）';

  const lines = [];
  lines.push('写代码时**禁止**任何一条 pattern；写了会被 5-C 第四关 dead-state-scanner 抓出来追加进阻塞账本（软警告，由用户人工修——但你应该在 dispatch 时就避免，少走一回手修）。');
  lines.push('');
  lines.push('| # | pattern id | 标签 | 形态 | 为什么不该 | 正确替代 |');
  lines.push('|---|---|---|---|---|---|');
  patterns.forEach((p, i) => {
    const cells = [
      String(i + 1),
      `\`${p.id}\``,
      p.label,
      `\`${p.regex_human}\``,
      p.why_bad,
      p.correct_alternative,
    ].map(c => c.replace(/\|/g, '\\|').replace(/\n/g, ' '));
    lines.push(`| ${cells.join(' | ')} |`);
  });
  lines.push('');
  lines.push(`> **共性**：以上 ${patterns.length} 类 pattern 共同特征是「编译过但运行时形同死代码」——通常是 sub-agent 为了让代码"看起来完整"用空数组/空函数/空串/未调用的 setter / 空体处理器占位。**正确做法一律是**：如果数据/逻辑来自上游（atom/mutation/hook）→ 加 \`// TODO upstream-gap: <X> 待接入\` 注释；如果是临时占位 → 加 \`// TODO step5-pending: <动作描述>\` 注释；**绝不**用空值默认值蒙混过关。`);

  return lines.join('\n');
}

// B5：§4 全表 sibling 目录（来源编号 + path + manifest status + 生成指令）（P0-1b）
function siblingDir(s4Lines, manifestBodyLines) {
  const out = [];
  for (const { cells } of tableDataRows(s4Lines)) {
    const id = cells.find((c) => /^(NW|RU)-\d+$/.test(c));
    if (!id) continue;
    const p = cells.find((c) => /\.(tsx?|jsx?|vue|svelte)$/.test(c.replace(/`/g, '')));
    const st = manifestStatusOf(manifestBodyLines, id);
    const pathPart = p ? ` → ${p.replace(/`/g, '')}` : '';
    out.push(`- ${id} [${st || 'status?'}]${pathPart} —— ${depDirective(st)}`);
  }
  return [...new Set(out)].join('\n');
}

// nw_components 行（step 5）
function nwCompRow(tsLines, nwId) {
  for (const { raw, cells } of tableDataRows(tsLines)) {
    if (cells[0] === nwId) return raw;
  }
  return '';
}

// ---------- 组装 ----------
function buildSlice(nwId, ctx) {
  const { step, techFeLines, techFm, manifestBodyLines, manifestFm,
          baselineLines, tsLines, s5map, s4lines, s55rows, techHash } = ctx;

  const a1 = a1Rows(s4lines, nwId);
  const a2lines = s5map.get(nwId) || [];
  const a3 = manifestBlock(manifestBodyLines, nwId);
  const hostPaths = pathsFromRows(a1);
  const a4 = a4Footprint(techFeLines, hostPaths);
  const a5 = a5Auth(s4lines, hostPaths);
  const a8 = a8Line(s4lines, nwId);
  const b1 = baselineModules(baselineLines);
  const b2 = fmGet(manifestFm, 'step2_mode');
  const mode = fmGet(techFm, '模式') || fmGet(techFm, 'mode');
  const pagesBlock = /pages\s*:/.test(techFm) ? techFm.slice(techFm.indexOf('pages')) : '';
  const b3 = `模式: ${mode || '(未知)'}\n${pagesBlock}`.trim();
  // B6/edges 体系 2026-05-21 砍；依赖契约由 B5 sibling + B7 import 白名单（读 manifest deps）承载
  const b4 = globalStores(s5map);
  const b5 = siblingDir(s4lines, manifestBodyLines);
  const b7 = allowedImports(nwId, manifestBodyLines, baselineLines);
  const b8 = forbiddenPatterns();
  // B9：§5.5 跨 NW-* 契约形状（消费形状 + 写回义务 + owner 导出）。consumesNames = 本 NW-* 依赖的契约名集合。
  const consumesNames = new Set(manifestConsumes(manifestBodyLines, nwId).map((c) => c.name));
  const b9 = contractSlice(s55rows || [], nwId, consumesNames);

  const a6 = step === '5' ? nwCompRow(tsLines, nwId) : '';
  const a7 = '';

  // 内容关键分节
  const critical = { A1: a1.join('\n'), A2: a2lines.join('\n'), A3: a3, B1: b1, B3: b3 };
  const missing = Object.entries(critical).filter(([, v]) => !v || !v.trim()).map(([k]) => k);

  const sec = (title, body, optional) =>
    `## ${title}\n\n${body && body.trim() ? body.trim() : (optional ? '（无）' : '（缺失 — slice-incomplete）')}\n`;

  const md = [
    '---',
    `nw_id: ${nwId}`,
    `step: ${step}`,
    `source_tech_fe_hash: ${techHash}`,
    `generated_at: ${new Date().toISOString()}`,
    '---',
    '',
    `# 切片 ${nwId}（step ${step}）`,
    '',
    '> 由 nw-slicer.mjs 生成。生成 sub-agent 只读本文件、禁读整份 [TECH_FE]/[MANIFEST]。',
    '> 分节契约见 schemas/nw-slice.schema.json。',
    '',
    sec('A1 §4 表格行', critical.A1),
    sec('A2 §5 逻辑方案（含 PRD 出处锚）', critical.A2),
    sec('A3 manifest 节段', critical.A3),
    sec('A4 §4.0 足迹', a4, true),
    sec('A5 §4.6 授权删除', a5, true),
    ...(step === '5' ? [sec('A6 nw_components 行', a6, true), sec('A7 §5 待决项', a7, true)] : []),
    sec('A8 §4.2 最小改造判定', a8, true),
    sec('B1 项目底座（CODE_BASELINE M1/M2/M4/M5/M7/M9）', critical.B1),
    sec('B2 step2_mode', b2, true),
    sec('B3 模式', critical.B3),
    sec('B4 全局 store 契约', b4, true),
    sec('B5 sibling 目录', b5, true),
    sec('B7 import 白名单（写 import 时必须命中本表）', b7),
    sec('B8 禁忌生码 pattern（dispatch 前注入禁忌清单）', b8),
    sec('B9 跨 NW-* 契约形状（消费形状 / 写回义务 / owner 导出 —— 防 enum 错位、字段不写回 atom）', b9, true),
  ].join('\n');

  return { md, missing };
}

// ---------- main ----------
const args = parseArgs(process.argv.slice(2));
if (!args.step || !['4', '5'].includes(args.step)) die('缺 --step（4 或 5）', 2);
if (!args.techFe || !args.manifest || !args.baseline) die('缺 --tech-fe / --manifest / --baseline', 2);
if (!args.nwId) die('缺 --nw-id', 2);
if (!args.outDir) die('缺 --out-dir', 2);
if (args.step === '5' && !args.templateSummary) die('step 5 需 --template-summary', 2);

const techFeRaw = readText(args.techFe, 'tech-fe');
const manifestRaw = readText(args.manifest, 'manifest');
const baselineRaw = readText(args.baseline, 'baseline');
const tsRaw = args.templateSummary ? readText(args.templateSummary, 'template-summary') : '';

const { fm: techFm, body: techBody } = splitFrontmatter(techFeRaw);
const { fm: manifestFm, body: manifestBody } = splitFrontmatter(manifestRaw);

const techFeLines = techBody.split('\n');
const ctx = {
  step: args.step,
  techFeLines,
  techFm,
  manifestBodyLines: manifestBody.split('\n'),
  manifestFm,
  baselineLines: baselineRaw.split('\n'),
  tsLines: tsRaw.split('\n'),
  s5map: s5Chunks(techFeLines),
  s4lines: s4Section(techFeLines),
  s55rows: s55Rows(techFeLines),
  techHash: crypto.createHash('sha256').update(techFeRaw).digest('hex').slice(0, 12),
};

fs.mkdirSync(args.outDir, { recursive: true });

const nwIds = args.nwId.split(',').map((s) => s.trim()).filter(Boolean);

// ---------- P0-1a：主切片目标 status 守卫（fail-fast，先于产切片）----------
// step 4-B 只该 dispatch manifest status=`不存在，需新建` 的 NW-*；step 5-B 只该
// dispatch nw_components status=`ok` 的 NW-*。把「该不该 dispatch」从主 Agent 自觉
// 变成脚本硬守卫——内联复用/内联重写 NW-* 误当主目标会产出本不该存在的独立文件。
const gateRejected = [];
for (const nwId of nwIds) {
  if (!/^NW-\d+$/.test(nwId)) die('非法 nw-id：' + nwId + '（需匹配 ^NW-<数字>$）', 2);
  if (args.step === '4') {
    const st = manifestStatusOf(ctx.manifestBodyLines, nwId);
    if (st !== '不存在，需新建') {
      gateRejected.push(
        nwId + ': manifest status=「' + (st || '缺失') +
        '」≠「不存在，需新建」—— step 4-B 不该 dispatch（内联复用/内联重写 应由消费方内联；复用类零改动）',
      );
    } else if (hasUnresolvedSplitMark(ctx.manifestBodyLines, nwId)) {
      gateRejected.push(
        nwId + ': manifest 含未定案「建议再拆」标记 —— step 3 未收敛终态，不可 dispatch（须先拆成子 NW-* 或定案）',
      );
    }
  } else {
    const row = nwCompRow(ctx.tsLines, nwId);
    const stCell = row ? row.split('|').slice(1, -1).map((c) => c.trim())[2] : '';
    if (stCell !== 'ok') {
      gateRejected.push(
        nwId + ': nw_components status=「' + (stCell || '未在状态表') +
        '」≠「ok」—— step 5-B 只 dispatch status=ok 的 NW-*',
      );
    }
  }
}
if (gateRejected.length) {
  console.error('nw-slicer: status-gate-reject —— 以下 NW-* 不应在本 step dispatch，已 fail-fast、未产切片：');
  for (const x of gateRejected) console.error('  ' + x);
  process.exit(2);
}

const incomplete = [];
const written = [];

for (const nwId of nwIds) {
  if (!/^NW-\d+$/.test(nwId)) die(`非法 nw-id：${nwId}（需匹配 ^NW-\\d+$）`, 2);
  const { md, missing } = buildSlice(nwId, ctx);
  const outPath = path.join(args.outDir, `${nwId}.slice.md`);
  fs.writeFileSync(outPath, md, 'utf8');
  written.push(outPath);
  if (missing.length) incomplete.push(`${nwId}: ${missing.join('/')}`);
}

if (incomplete.length) {
  console.error(`nw-slicer: slice-incomplete —— 以下 NW-* 关键分节缺失：`);
  for (const x of incomplete) console.error(`  ${x}`);
  console.error(`已落盘 ${written.length} 份切片（含缺失标记），主 Agent 应 fail-fast、回查 [TECH_FE]。`);
  process.exit(2);
}

console.log(`nw-slicer: ok —— 已产出 ${written.length} 份切片 → ${args.outDir}`);
for (const p of written) console.log(`  ${p}`);
