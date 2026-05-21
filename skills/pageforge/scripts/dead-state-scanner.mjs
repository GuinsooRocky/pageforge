#!/usr/bin/env node
// Dead-state Scanner — postcondition pattern scan for pageforge-generated
// .tsx/.ts files. Detects common "compiles but logically dead" patterns that
// schema/grep TODO accounting + import-resolver can't catch.
//
// Boundary (deliberate):
//   - Lexical regex only, NO AST parse, NO typecheck, NO export resolution.
//   - SOFT WARNING semantics: hits do NOT fail-fast, do NOT trigger NW-* regen.
//     They're appended to [LOGIC_SUMMARY]'s 阻塞账本 by the main Agent (consumer
//     manually fixes). This is the deliberate replacement for the removed
//     nw-verifier "adversary" dimension — adversarial pattern scanning is
//     valuable, but it must be a deterministic script, NOT an opus loop, because
//     LLM adversary + retry ≤ 2 cap = guaranteed non-convergence.
//     (NOTE: nw-verifier's current V5 is the "contract reconciliation" judge
//      dimension — unrelated to the cut adversary dimension.)
//
// Patterns (high-precision; expand carefully):
//   1. `onXxx={undefined}` — callback prop explicitly passed undefined
//   2. `onXxx={() => {}}` — callback prop is empty arrow function (placeholder)
//   3. `onXxx={() => console.log(...)}` — callback prop is console-only stub
//   4. `useState([])` with destructured setter that's NEVER called elsewhere
//      in same file = state stuck empty
//   5. `useMemo(() => [], [...])` — memo that hard-codes empty array as data
//      source (typical "list forever empty" anti-pattern)
//   6. `const [, setX] = useState(...)` — state name empty slot (write-only,
//      snapshot is set but never read; typical "snapshot dead state" pattern)
//   7. `const X = []` followed by `X.map` / `X.length` in same file —
//      const empty-array referenced as data source = list forever empty
//   8. `const X = ''` followed by `if (X)` in same file — const empty-string
//      gating a branch that can never execute (placeholder URL/key anti-pattern)
//   9. `const handleX = () => {}` / `function handleX() {}` / empty
//      `useCallback(() => {}, [...])` — NAMED handler declared with empty body
//      (distinct from P2's inline JSX `onX={() => {}}`). Wired up via
//      onClick={handleX} but does nothing = the "looks connected" illusion.
//      Matches v2 bug #5 (handleSubmit wired but no-op).
//
// Usage:
//   node dead-state-scanner.mjs --files <p1,p2,...>
//                              [--summary <TEMPLATE_SUMMARY.md>]
//                              [--project-root <dir>]   (default: cwd)
//                              [--json]
//
// Exit codes:
//   0 — scan completed (always 0, even on hits). stdout last line:
//       `dead-state-scanner-found:<N>` (N = total hit count across files).
//       Main Agent reads N and appends each hit to 阻塞账本.
//   2 — usage error (no input files).
//
// Zero external deps.

import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const a = { files: [], json: false };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--files') { a.files = v.split(',').filter(Boolean); i++; }
    else if (k === '--summary') { a.summary = v; i++; }
    else if (k === '--project-root') { a.projectRoot = v; i++; }
    else if (k === '--json') { a.json = true; }
  }
  return a;
}

function readSummaryFiles(summaryPath) {
  if (!fs.existsSync(summaryPath)) return [];
  const md = fs.readFileSync(summaryPath, 'utf8');
  const out = new Set();
  const re = /(?:^|[\s|`])((?:\/|\.{0,2}\/)?(?:[\w.@\-]+\/)+[\w.\-]+\.(?:tsx|ts|jsx|js))/gm;
  let m;
  while ((m = re.exec(md))) out.add(m[1]);
  return [...out];
}

function lineOf(src, idx) {
  let line = 1;
  for (let i = 0; i < idx && i < src.length; i++) if (src[i] === '\n') line++;
  return line;
}

// Strip line comments + block comments so identifiers inside them don't
// inflate identifier-counting heuristics (e.g. P4 setter-never-called).
// Lexical-only; doesn't fully respect string literals but adequate for the
// counting use-case.
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let inStr = false;
  let strCh = '';
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (inStr) {
      out += c;
      if (c === '\\' && i + 1 < n) { out += src[i + 1]; i += 2; continue; }
      if (c === strCh) inStr = false;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = true; strCh = c; out += c; i++; continue; }
    if (c === '/' && next === '/') {
      // Skip to end-of-line, but preserve the \n itself (already handled by the outer loop hitting it next).
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      // Skip block comment but preserve internal newlines so line numbers stay aligned.
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function scanFile(file, srcRaw) {
  const hits = [];
  // Strip comments so identifier counts (P4) ignore self-referential comments
  // like "// later we will call setIsLoading(false)". Line-number tracking
  // still uses raw source via lineOf().
  const src = stripComments(srcRaw);

  // P1: onXxx={undefined}
  const reP1 = /\bon\w+\s*=\s*\{\s*undefined\s*\}/g;
  let m;
  while ((m = reP1.exec(src))) {
    hits.push({ pattern: 'callback-undefined', line: lineOf(src, m.index), snippet: m[0] });
  }

  // P2: onXxx={() => {}}  (empty arrow function as JSX prop)
  const reP2 = /\bon\w+\s*=\s*\{\s*\(\s*[^)]*\)\s*=>\s*\{\s*\}\s*\}/g;
  while ((m = reP2.exec(src))) {
    hits.push({ pattern: 'callback-empty-fn', line: lineOf(src, m.index), snippet: m[0].slice(0, 80) });
  }

  // P3: onXxx={() => console.log(...)}  (console-only stub)
  const reP3 = /\bon\w+\s*=\s*\{\s*\(\s*[^)]*\)\s*=>\s*console\.(log|warn|info)\s*\(/g;
  while ((m = reP3.exec(src))) {
    hits.push({ pattern: 'callback-console-stub', line: lineOf(src, m.index), snippet: m[0].slice(0, 80) });
  }

  // P4: const [X, setX] = useState(...)  where setX is NEVER invoked anywhere
  // in the file (declaration occurrence excluded). Any initial value — catches
  // both `useState([])` "list stuck empty" and `useState(true)` "isLoading
  // never flipped" patterns.
  const reP4 = /const\s+\[\s*(\w+)\s*,\s*(set\w+)\s*\]\s*=\s*useState\b/g;
  while ((m = reP4.exec(src))) {
    const [, _state, setter] = m;
    // Total occurrences of the setter name. Declaration always contributes 1;
    // any invocation adds >=1 more. So total === 1 ⇒ setter never invoked.
    const setterRe = new RegExp(`\\b${setter}\\b`, 'g');
    const total = (src.match(setterRe) || []).length;
    if (total === 1) {
      hits.push({
        pattern: 'state-setter-never-called',
        line: lineOf(src, m.index),
        snippet: `useState → ${setter} declared but never invoked (stuck at initial value)`,
      });
    }
  }

  // P5: useMemo(() => [], [...])  — empty array memo (typical list-forever-empty)
  // Also catch `useMemo(() => ([]), ...)` parenthesized form.
  const reP5 = /useMemo\s*\(\s*\(\s*\)\s*=>\s*\(?\s*\[\s*\]\s*\)?\s*,/g;
  while ((m = reP5.exec(src))) {
    hits.push({ pattern: 'memo-empty-array', line: lineOf(src, m.index), snippet: m[0].slice(0, 80) });
  }

  // P6: const [, setX] = useState(...)  — state slot is empty (write-only)
  const reP6 = /const\s+\[\s*,\s*set\w+\s*\]\s*=\s*useState\s*(?:<[^>]+>)?\s*\(/g;
  while ((m = reP6.exec(src))) {
    hits.push({ pattern: 'state-write-only', line: lineOf(src, m.index), snippet: m[0].slice(0, 80) });
  }

  // P7: `const X = []` / `const X: T[] = []` followed by `X.map`/`X.length`
  // (and NOT mutated in-place via push/splice/etc). const declaration with
  // no mutation = list forever empty even if .map'd later.
  const reP7 = /const\s+(\w+)(?:\s*:\s*[^=\n]+)?\s*=\s*\[\s*\]\s*;/g;
  while ((m = reP7.exec(src))) {
    const [, name] = m;
    const consumeRe = new RegExp(`\\b${name}\\.(map|filter|forEach|reduce|length)\\b`);
    const mutateRe = new RegExp(`\\b${name}\\.(push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin)\\(`);
    if (consumeRe.test(src) && !mutateRe.test(src)) {
      hits.push({
        pattern: 'const-empty-array-consumed',
        line: lineOf(src, m.index),
        snippet: `const ${name} = []  // consumed by .map/.length, never mutated`,
      });
    }
  }

  // P8: `const X = ''` followed by `if (X)` — empty-string gating dead branch
  const reP8 = /const\s+(\w+)(?:\s*:\s*\w+)?\s*=\s*(?:''|"")\s*;/g;
  while ((m = reP8.exec(src))) {
    const [, name] = m;
    const usageRe = new RegExp(`\\bif\\s*\\(\\s*${name}\\s*[)&|!=]`);
    if (usageRe.test(src)) {
      hits.push({
        pattern: 'const-empty-string-gating',
        line: lineOf(src, m.index),
        snippet: `const ${name} = ''  // gates an if-branch elsewhere`,
      });
    }
  }

  // P9: named handler declared with an empty body (handle* / on[A-Z]*), distinct
  // from P2's inline JSX prop. Three shapes: arrow / empty useCallback / function decl.
  //   const handleX = () => {}            const handleX = async (e): void => {}
  //   const handleX = useCallback(() => {}, [deps])   function handleX() {}
  //
  // ⚠️ P9 scans srcRaw (NOT comment-stripped `src`), unlike P1-P8. Rationale (主题 B,
  // 标记生命周期): a TODO-acknowledged deferral `() => { /* TODO step5-pending */ }`
  // is an *intentional* stub already counted by 5-C 第一关 TODO 对账 — re-flagging it
  // here would double-report into the ledger. On raw source the comment body keeps the
  // braces non-empty so `{\s*}` won't match → TODO-bodied handlers are naturally exempt;
  // only a BARE `() => {}` with no acknowledgment (the real *unintentional* dead handler)
  // gets flagged. So: P9 = unacknowledged empty handler; TODO-bodied = handled by gate 1.
  const reP9arrow = /\b(?:const|let)\s+(handle\w+|on[A-Z]\w+)\s*=\s*(?:useCallback\s*\(\s*)?(?:async\s+)?\([^)]*\)\s*(?::[^=>{]+)?=>\s*\{\s*\}/g;
  while ((m = reP9arrow.exec(srcRaw))) {
    hits.push({
      pattern: 'handler-noop',
      line: lineOf(srcRaw, m.index),
      snippet: `${m[1]} = () => {}  // 具名处理器空体（无 TODO 标记），接好线却 no-op`,
    });
  }
  const reP9fn = /\bfunction\s+(handle\w+|on[A-Z]\w+)\s*\([^)]*\)\s*(?::[^{]+)?\{\s*\}/g;
  while ((m = reP9fn.exec(srcRaw))) {
    hits.push({
      pattern: 'handler-noop',
      line: lineOf(srcRaw, m.index),
      snippet: `function ${m[1]}() {}  // 具名处理器空体（无 TODO 标记），接好线却 no-op`,
    });
  }

  return hits;
}

function main() {
  const args = parseArgs(process.argv);
  const projectRoot = args.projectRoot ? path.resolve(args.projectRoot) : process.cwd();

  let files = [...args.files];
  if (args.summary) {
    const fromSummary = readSummaryFiles(path.resolve(projectRoot, args.summary));
    files = [...new Set([...files, ...fromSummary])];
  }
  files = files.map(f => path.isAbsolute(f) ? f : path.resolve(projectRoot, f));

  if (files.length === 0) {
    console.error('dead-state-scanner: no input files (use --files or --summary)');
    process.exit(2);
  }

  const allHits = [];
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    const src = fs.readFileSync(f, 'utf8');
    const hits = scanFile(f, src);
    for (const h of hits) {
      allHits.push({ file: path.relative(projectRoot, f), ...h });
    }
  }

  const total = allHits.length;

  if (args.json) {
    console.log(JSON.stringify({
      project_root: projectRoot,
      files_scanned: files.length,
      total_hits: total,
      hits: allHits,
    }, null, 2));
  } else {
    console.log(`# dead-state-scanner`);
    console.log(`project_root: ${projectRoot}`);
    console.log(`files scanned: ${files.length}`);
    console.log(`total hits: ${total}`);
    if (total > 0) {
      console.log(`\n## Hits (${total})\n`);
      console.log('| 文件 | 行 | pattern | 片段 |');
      console.log('|---|---|---|---|');
      for (const h of allHits) {
        const snippet = h.snippet.replace(/\|/g, '\\|').replace(/\n/g, ' ');
        console.log(`| ${h.file} | ${h.line} | ${h.pattern} | \`${snippet}\` |`);
      }
      console.log('\n> 软警告（SOFT WARNING）：本扫描不 fail-fast、不触发 NW-* 重生成。主 Agent 须把每条命中追加到 [LOGIC_SUMMARY] 阻塞账本（文件 / 行 / pattern / 片段），由用户人工修复。这是 nw-verifier 旧「对抗扫描」维度被砍后的确定性替代（与现 V5「契约对账」judge 维度无关）。');
    }
  }

  console.log(`\ndead-state-scanner-found:${total}`);
  process.exit(0);
}

main();
