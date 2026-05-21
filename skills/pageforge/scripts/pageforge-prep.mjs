#!/usr/bin/env node
// pageforge-prep — 产出文档「规范化层」（主题 A：消除 产出↔解析 格式漂移）。
//
// 背景：pageforge 有多处「agent/主Agent 手写产出 → 下游脚本严格解析」的接缝
// （manifest header、template-summary）。历史上靠双方「记得对齐」，必然漂移
// （visual-analyzer 产 `## NW-001 name`，但 dag-validator/nw-slicer 要 `## N name（NW-001）`；
//  主 Agent 手写 template-summary 列错）。本脚本把「格式对齐」收敛到一处确定性逻辑，
// 下游统一消费规范化后的产物，不再在 N 个解析脚本里各加容错正则。
//
// 子命令：
//   node pageforge-prep.mjs normalize-manifest --manifest <p>
//     把 [MANIFEST] 每个组件 header 规范成下游唯一认的 `## N name（NW-NNN） —— desc`
//     形态（N=运行序号）。接受输入 `## NW-NNN name（desc）` / `## N name（NW-NNN）`
//     两种形态，输出统一。幂等（已规范的不破坏）。step 2 visual-analyzer 产出后、
//     跑 schema-validator/dag-validator 前由主 Agent 调一次。
//
//   node pageforge-prep.mjs init-summary --manifest <p> --out <p> --project-root <dir>
//     从 [MANIFEST] 自动生成 [TEMPLATE_SUMMARY] 骨架（nw_components 状态表，列序
//     严格 = nw-components.schema：nw_id | path(绝对) | status | is_client | failure_reason）。
//     status/is_client 留待 step 4-B 各 NW-* 返回后由主 Agent 回填。主 Agent 不再手写表。
//
// 零外部依赖（node 内置）。
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--manifest') a.manifest = argv[++i];
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--project-root') a.projectRoot = argv[++i];
    else if (!k.startsWith('--')) a._.push(k);
  }
  return a;
}

function die(msg) { console.error(`pageforge-prep: ${msg}`); process.exit(2); }

// 从一行 header 抽 {id, name, desc}，兼容两种输入形态：
//   ## NW-001 CreateWorldDialog（创建弹窗）        ← id 在前缀（visual-analyzer 默认产出）
//   ## 1 CreateWorldDialog（NW-001） —— 创建弹窗   ← id 在括号（已规范）
// 不是组件 header（无 NW/RU id）→ 返回 null。
function parseHeader(line) {
  if (!/^##\s/.test(line)) return null;
  // 形态二（已规范）：## N name（NW-NNN） [—— desc]
  let m = line.match(/^##\s+\d+\s+(.+?)[（(]((?:NW|RU)-\d+)[）)](?:\s*——\s*(.+))?\s*$/);
  if (m) return { id: m[2], name: m[1].trim(), desc: (m[3] || '').trim() };
  // 形态一（id 前缀）：## NW-NNN name（desc）
  m = line.match(/^##\s+((?:NW|RU)-\d+)\s+([^（(]+?)(?:[（(](.+)[）)])?\s*$/);
  if (m) return { id: m[1], name: m[2].trim(), desc: (m[3] || '').trim() };
  return null;
}

function normalizeManifest(args) {
  if (!args.manifest) die('normalize-manifest 需 --manifest');
  const lines = fs.readFileSync(args.manifest, 'utf8').split('\n');
  let n = 0, changed = 0;
  const out = lines.map((l) => {
    const h = parseHeader(l);
    if (!h) return l;
    n++;
    const norm = `## ${n} ${h.name}（${h.id}）${h.desc ? ` —— ${h.desc}` : ''}`;
    if (norm !== l) changed++;
    return norm;
  });
  fs.writeFileSync(args.manifest, out.join('\n'));
  console.log(`pageforge-prep normalize-manifest: ok —— ${n} 个组件 header，规范化 ${changed} 个 → \`## N name（NW-NNN）\``);
}

function initSummary(args) {
  if (!args.manifest) die('init-summary 需 --manifest');
  if (!args.out) die('init-summary 需 --out');
  const root = args.projectRoot ? path.resolve(args.projectRoot) : process.cwd();
  const body = fs.readFileSync(args.manifest, 'utf8');
  // 提每个组件的 id + plan_path（plan_path 行：`- **plan_path**: \`src/...\``，取首个 src 路径）
  const lines = body.split('\n');
  const rows = [];
  let cur = null;
  for (const l of lines) {
    const h = parseHeader(l);
    if (h) { cur = { id: h.id, name: h.name }; continue; }
    if (cur && /plan_path/.test(l)) {
      const p = (l.match(/(src\/[A-Za-z0-9_./\[\]()-]+\.(?:tsx?|ts))/) || [])[1];
      if (p && !cur.done) { rows.push({ id: cur.id, path: path.join(root, p) }); cur.done = true; }
    }
  }
  // 仅 NW-*（RU-* 是复用、不进 step4-B nw_components 状态表）
  const nwRows = rows.filter((r) => /^NW-/.test(r.id));
  let md = '# Template Gen Summary（step 4-B）\n\n生成时间：' + new Date().toISOString().slice(0, 10) +
    '\n\n> 本骨架由 pageforge-prep.mjs init-summary 从 [MANIFEST] 自动生成（主题 A：主 Agent 不手写表，杜绝列错）。' +
    '\n> status / is_client 待 step 4-B 各 NW-* 返回后由主 Agent 单一收口回填（§B.2）。\n\n' +
    '## nw_components 状态表\n\n| nw_id | path | status | is_client | failure_reason |\n|---|---|---|---|---|\n';
  for (const r of nwRows) md += `| ${r.id} | ${r.path} | TBD | - | - |\n`;
  md += '\n## §5 待决项（step 5 接力）\n\n各 NW-* 4-B 返回的 step5-pending / upstream-gap 在各自骨架 // TODO 注释中；step 5-C 汇总进阻塞账本。\n';
  fs.writeFileSync(args.out, md);
  console.log(`pageforge-prep init-summary: ok —— ${nwRows.length} 个 NW-* 行（status/is_client=占位待回填）→ ${args.out}`);
}

const args = parseArgs(process.argv);
const cmd = args._[0];
if (cmd === 'normalize-manifest') normalizeManifest(args);
else if (cmd === 'init-summary') initSummary(args);
else die('用法：normalize-manifest --manifest <p> | init-summary --manifest <p> --out <p> --project-root <dir>');
