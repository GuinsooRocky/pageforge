#!/usr/bin/env node
// xref-closure.mjs — PRD scope 引用闭包扩展（step 0.5 末附加步骤）
//
// 解决：scope-narrower 按章节号 grep 切片，但 in-scope 章节正文里可能
// `见 §X.X` / `详见 §X.X` 引用了 OoS 章节，下游漏覆盖。
//
// 工作流：
//   1. 解析 [ORIGIN_PRD] 全文按章节号建索引（章节号 → 起止行）
//   2. 解析 [ORIGIN_PRD_SCOPED] 顶部「In Scope」清单作为种子节点
//   3. 在 [ORIGIN_PRD_SCOPED] 正文里扫所有 `§X.X` / `§X` / `章节 X.X` 引用
//   4. BFS 闭包扩展：被引未入选的章节 → 补入 [ORIGIN_PRD_SCOPED]
//      （标 `> ⚠️ [补 · 因 §X.X 引用]`）
//   5. 多轮迭代直到 fixed point（被补章节自己也可能引别的）
//
// 用法：
//   node xref-closure.mjs --origin-prd <p> --scoped <p> [--max-depth 3] [--dry-run] [--json]
//
// 退出码：
//   0 — 闭包扩展完成（写回 scoped 文件 + stdout 报告新增章节数）
//   1 — IO/解析错误
//   2 — 闭包深度超 max（防失控）；用户需手动确认
//
// 零外部依赖。

import fs from 'node:fs';
import path from 'node:path';

const SECTION_RE = /^#{2,5}\s+§?(\d+(?:\.\d+)*)\s+(.+?)\s*$/;
const REF_RE = /§\s*(\d+(?:\.\d+)*)/g;

function parseArgs(argv) {
  const a = { maxDepth: 3, dryRun: false, json: false };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--origin-prd') { a.originPrd = v; i++; }
    else if (k === '--scoped') { a.scoped = v; i++; }
    else if (k === '--max-depth') { a.maxDepth = parseInt(v, 10); i++; }
    else if (k === '--dry-run') { a.dryRun = true; }
    else if (k === '--json') { a.json = true; }
  }
  return a;
}

function indexSections(src) {
  const lines = src.split('\n');
  const sections = new Map();
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(SECTION_RE);
    if (m) {
      if (cur) cur.end = i;
      cur = { num: m[1], title: m[2], start: i, end: lines.length, headingLevel: lines[i].match(/^#+/)[0].length };
      sections.set(m[1], cur);
    }
  }
  if (cur) cur.end = lines.length;
  return { lines, sections };
}

function extractRefs(lines, start, end) {
  const refs = new Set();
  for (let i = start; i < end; i++) {
    let m;
    REF_RE.lastIndex = 0;
    while ((m = REF_RE.exec(lines[i]))) refs.add(m[1]);
  }
  return refs;
}

function inScopeSeeds(scopedLines) {
  // 找 "In Scope" 段，抽里面的 §X.X
  const seeds = new Set();
  let inSeg = false;
  for (const line of scopedLines) {
    if (/In Scope/.test(line)) inSeg = true;
    else if (inSeg && /Out of Scope/.test(line)) break;
    if (inSeg) {
      let m;
      REF_RE.lastIndex = 0;
      while ((m = REF_RE.exec(line))) seeds.add(m[1]);
    }
  }
  return seeds;
}

function isAncestorOrSelf(child, anc) {
  return child === anc || child.startsWith(anc + '.');
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.originPrd || !args.scoped) {
    console.error('xref-closure: --origin-prd and --scoped required');
    process.exit(1);
  }
  const originSrc = fs.readFileSync(args.originPrd, 'utf8');
  const scopedSrc = fs.readFileSync(args.scoped, 'utf8');
  const { lines: originLines, sections: originSections } = indexSections(originSrc);
  const scopedLines = scopedSrc.split('\n');

  // 种子 = 当前 scoped 文件已含的章节号（用顶部 In Scope + 实际节标题双源）
  const seeds = inScopeSeeds(scopedLines);
  for (const line of scopedLines) {
    const m = line.match(SECTION_RE);
    if (m) seeds.add(m[1]);
  }

  // BFS 闭包
  const inClosure = new Set(seeds);
  const added = []; // [{ num, depth, viaRef }]
  let frontier = [...seeds];
  let depth = 0;
  while (frontier.length > 0 && depth < args.maxDepth) {
    depth++;
    const next = new Set();
    for (const num of frontier) {
      const sec = originSections.get(num);
      if (!sec) continue;
      const refs = extractRefs(originLines, sec.start, sec.end);
      for (const ref of refs) {
        if (inClosure.has(ref)) continue;
        // 也跳过祖先关系（如 in scope §8，§8.4 算 in scope）
        let covered = false;
        for (const c of inClosure) {
          if (isAncestorOrSelf(ref, c)) { covered = true; break; }
        }
        if (covered) continue;
        // 必须在 origin 里能找到对应章节才补
        if (!originSections.has(ref)) continue;
        inClosure.add(ref);
        next.add(ref);
        added.push({ num: ref, depth, viaRef: num });
      }
    }
    frontier = [...next];
  }

  if (depth >= args.maxDepth && frontier.length > 0) {
    console.error(`xref-closure: max depth ${args.maxDepth} reached, ${frontier.length} unresolved refs remain`);
    if (!args.dryRun) process.exit(2);
  }

  const result = {
    seeds_count: seeds.size,
    closure_count: inClosure.size,
    added_count: added.length,
    added,
    depth_used: depth,
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`# xref-closure`);
    console.log(`seeds: ${seeds.size}  closure: ${inClosure.size}  added: ${added.length}  depth: ${depth}`);
    if (added.length > 0) {
      console.log(`\n## Added sections (via reference)\n`);
      console.log('| § | depth | via reference in |');
      console.log('|---|---|---|');
      for (const a of added) {
        const title = originSections.get(a.num)?.title || '(unknown)';
        console.log(`| §${a.num} ${title} | ${a.depth} | §${a.viaRef} |`);
      }
    }
  }

  if (added.length === 0) {
    console.log(`\nxref-closure: nothing to add`);
    process.exit(0);
  }

  if (args.dryRun) {
    console.log(`\nxref-closure: dry-run, no file written`);
    process.exit(0);
  }

  // 把新增章节追加到 scoped 文件尾部（在 `<!-- END 切片正文 -->` 之前）
  const endMarker = '<!-- END 切片正文 -->';
  const insertIdx = scopedLines.findIndex(l => l.includes(endMarker));
  const insertAt = insertIdx === -1 ? scopedLines.length : insertIdx;

  const appendBlocks = [];
  appendBlocks.push('');
  appendBlocks.push('<!-- BEGIN xref-closure 补章节 -->');
  appendBlocks.push('');
  for (const a of added) {
    const sec = originSections.get(a.num);
    if (!sec) continue;
    const body = originLines.slice(sec.start, sec.end);
    appendBlocks.push(`> ⚠️ [补 · 因 §${a.viaRef} 引用 / depth=${a.depth}]`);
    appendBlocks.push('');
    appendBlocks.push(...body);
    appendBlocks.push('');
  }
  appendBlocks.push('<!-- END xref-closure 补章节 -->');
  appendBlocks.push('');

  const newLines = [...scopedLines.slice(0, insertAt), ...appendBlocks, ...scopedLines.slice(insertAt)];
  fs.writeFileSync(args.scoped, newLines.join('\n'));
  console.log(`\nxref-closure: wrote ${added.length} sections to ${args.scoped}`);
  process.exit(0);
}

main();
