#!/usr/bin/env node
// Clarify HTML Generator - render [CLARIFY_FE] §9 / §10 sections into a self-contained
// single-file HTML for human-friendly QA review on Desktop.
//
// Designed for pageforge step 1 prd-clarifier: after [CLARIFY_FE] is produced and
// before the main agent fires AskUserQuestion, this script renders the §9 (待确认项)
// and §10 (设计稿决策) tables into a polished HTML the user can open in browser,
// read alongside PRD, then answer in the chat. Markdown CLARIFY_FE remains the source
// of truth for downstream sub-agents; the HTML is purely a human-facing view.
//
// Usage:
//   node clarify-html-gen.mjs --clarify <path/to/clarify-fe-prd.md>
//                             --output  <path/to/output.html>
//                             [--feature <feature-name>]
//
// Args:
//   --clarify   absolute or relative path to [CLARIFY_FE] markdown (required)
//   --output    absolute or relative output HTML path (required)
//   --feature   optional feature name shown in HTML header
//
// Exit codes:
//   0  ok, HTML written; counts logged to stdout
//   2  bad args
//   3  parse failure (no §9 / §10 section found in clarify)
//   4  io error

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));

if (!args.clarify || !args.output) {
  console.error(
    'Usage: node clarify-html-gen.mjs --clarify <clarify-fe-prd.md> --output <out.html> [--feature <name>]',
  );
  process.exit(2);
}

let markdown;
try {
  markdown = fs.readFileSync(path.resolve(args.clarify), 'utf8');
} catch (e) {
  console.error(`[clarify-html-gen] failed to read ${args.clarify}: ${e.message}`);
  process.exit(4);
}

const section9 = extractSection(markdown, /^##\s*9\.?\s/m, /^##\s/m);
const section10 = extractSection(markdown, /^##\s*10\.?\s/m, /^##\s/m);

if (!section9 && !section10) {
  console.error('[clarify-html-gen] neither §9 nor §10 section found in clarify markdown');
  process.exit(3);
}

const qRows = section9 ? parseTable(section9) : [];
const oRows = section10 ? parseTable(section10) : [];

const html = renderHtml({
  feature: args.feature || '',
  generatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
  qRows,
  oRows,
});

try {
  fs.writeFileSync(path.resolve(args.output), html, 'utf8');
} catch (e) {
  console.error(`[clarify-html-gen] failed to write ${args.output}: ${e.message}`);
  process.exit(4);
}

console.log(JSON.stringify({ output: path.resolve(args.output), q_count: qRows.length, o_count: oRows.length }));

// ---------------------------------------------------------------------------
// parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith('--')) out[k.slice(2)] = argv[i + 1];
  }
  return out;
}

function extractSection(md, headerRe, nextHeaderRe) {
  const m = md.match(headerRe);
  if (!m) return null;
  const start = m.index + m[0].length;
  const tail = md.slice(start);
  const next = tail.match(nextHeaderRe);
  return next ? tail.slice(0, next.index) : tail;
}

// parse a markdown table inside a section; returns array of row objects keyed by header
function parseTable(section) {
  const lines = section.split('\n');
  let headerLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.startsWith('|') && l.endsWith('|') && lines[i + 1] && /^\|[\s|:\-]+\|$/.test(lines[i + 1].trim())) {
      headerLine = i;
      break;
    }
  }
  if (headerLine === -1) return [];

  const headers = splitRow(lines[headerLine]);
  const rows = [];
  for (let i = headerLine + 2; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l.startsWith('|') || !l.endsWith('|')) break;
    const cells = splitRow(lines[i]);
    if (cells.length === 0) continue;
    const row = {};
    for (let j = 0; j < headers.length; j++) row[headers[j]] = (cells[j] || '').trim();
    // skip rows missing 编号 or where most cells are '...' (template example rows)
    const id = row['编号'] || '';
    if (!id || id === '...') continue;
    const dotCount = Object.values(row).filter((v) => v === '...').length;
    if (dotCount >= 2) continue;
    rows.push(row);
  }
  return rows;
}

function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((s) => s.trim());
}

// strip single-backtick inline code wrappers from a cell value, keeping inner text
function unwrapInline(value) {
  if (!value) return '';
  const m = value.match(/^`(.+)`$/s);
  return m ? m[1] : value;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

function renderHtml({ feature, generatedAt, qRows, oRows }) {
  const qCount = qRows.length;
  const oCount = oRows.length;
  const title = feature ? `PRD 待确认追问 · ${escapeHtml(feature)}` : 'PRD 待确认追问';

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
${baseCss()}
</style>
</head>
<body>
<header class="page-head">
  <h1>${title}</h1>
  <div class="meta">
    <time>${escapeHtml(generatedAt)}</time>
    <span class="dot">·</span>
    <span class="badge badge-q">${qCount} 待答 (§9)</span>
    <span class="badge badge-o">${oCount} 设计稿决策 (§10)</span>
  </div>
  <p class="hint">打开本页面对照阅读 PRD 原文，然后回到对话窗口按 <code>Q-XXX</code> / <code>O-XXX</code> 编号回复。回复后此文件会自动删除。</p>
</header>

${renderToc(qRows, oRows)}

<main>
${renderQSection(qRows)}
${renderOSection(oRows)}
</main>

<footer><small>generated by clarify-html-gen.mjs · pageforge new0.0.3</small></footer>
</body>
</html>
`;
}

function renderToc(qRows, oRows) {
  if (qRows.length + oRows.length === 0) return '';
  const qLinks = qRows.map((r) => `<a href="#${escapeHtml(r['编号'])}">${escapeHtml(r['编号'])}</a>`).join('');
  const oLinks = oRows.map((r) => `<a href="#${escapeHtml(r['编号'])}">${escapeHtml(r['编号'])}</a>`).join('');
  return `<nav class="toc">
  ${qLinks ? `<div class="toc-group"><span class="toc-label">§9</span>${qLinks}</div>` : ''}
  ${oLinks ? `<div class="toc-group"><span class="toc-label">§10</span>${oLinks}</div>` : ''}
</nav>`;
}

function renderQSection(rows) {
  if (rows.length === 0) {
    return `<section class="section">
  <h2><span class="num">①</span> 待答疑问 <small>§9 — PRD 没说清，需要你定</small></h2>
  <p class="empty">本次无 §9 待确认项 ✓</p>
</section>`;
  }
  const cards = rows.map(renderQCard).join('\n');
  return `<section class="section">
  <h2><span class="num">①</span> 待答疑问 <small>§9 — PRD 没说清，需要你定</small></h2>
  ${cards}
</section>`;
}

function renderOSection(rows) {
  if (rows.length === 0) {
    return `<section class="section">
  <h2><span class="num">②</span> 设计稿决策 <small>§10 — 已按设计稿处理，请过目可否决</small></h2>
  <p class="empty">本次无 §10 设计稿决策项 ✓</p>
</section>`;
  }
  const cards = rows.map(renderOCard).join('\n');
  return `<section class="section">
  <h2><span class="num">②</span> 设计稿决策 <small>§10 — 已按设计稿处理，请过目可否决</small></h2>
  ${cards}
</section>`;
}

function renderQCard(row) {
  const id = row['编号'] || '';
  const category = row['类别'] || '';
  const question = row['问题描述'] || '';
  const cursor = unwrapInline(row['PRD 出处'] || '');
  const evidence = unwrapInline(row['PRD 原文片段'] || '');
  const suggestion = row['建议'] || '';
  const isEngineering = cursor === 'engineering-only';

  return `<article class="card" id="${escapeHtml(id)}">
  <div class="card-head">
    <h3>${escapeHtml(id)}</h3>
    <span class="tag tag-cat">${escapeHtml(category)}</span>
    ${isEngineering
      ? '<span class="tag tag-eng">engineering-only</span>'
      : `<span class="tag tag-cursor">${escapeHtml(cursor)}</span>`}
  </div>
  ${isEngineering
    ? '<p class="no-evidence">无 PRD 原文依据 — 项目侧工程决策</p>'
    : `<blockquote class="prd-quote">${escapeHtml(evidence)}</blockquote>`}
  <p class="question">${escapeHtml(question)}</p>
  ${suggestion && suggestion !== '...' ? `<aside class="suggest">建议：${escapeHtml(suggestion)}</aside>` : ''}
</article>`;
}

function renderOCard(row) {
  const id = row['编号'] || '';
  const diff = row['差异点'] || '';
  const cursor = unwrapInline(row['PRD 出处'] || '');
  const prdDesc = unwrapInline(row['PRD描述'] || '');
  const figmaTake = row['设计稿表现（采用）'] || row['设计稿表现'] || '';
  const chapter = row['涉及章节'] || '';

  return `<article class="card card-o" id="${escapeHtml(id)}">
  <div class="card-head">
    <h3>${escapeHtml(id)}</h3>
    <span class="tag tag-diff">${escapeHtml(diff)}</span>
    <span class="tag tag-cursor">${escapeHtml(cursor)}</span>
    ${chapter ? `<span class="tag tag-chapter">${escapeHtml(chapter)}</span>` : ''}
  </div>
  <dl class="diff">
    <dt>PRD 原文</dt>
    <dd><blockquote class="prd-quote">${escapeHtml(prdDesc)}</blockquote></dd>
    <dt>设计稿采用</dt>
    <dd class="figma">${escapeHtml(figmaTake)}</dd>
  </dl>
</article>`;
}

// ---------------------------------------------------------------------------
// styles - inlined, self-contained, no external font/JS
// ---------------------------------------------------------------------------

function baseCss() {
  return `
:root {
  --fg: #1a1a1a;
  --fg-muted: #6b6b6b;
  --bg: #fafafa;
  --bg-card: #ffffff;
  --border: #e5e5e5;
  --accent: #2563eb;
  --accent-soft: #eff6ff;
  --quote-rule: #3b82f6;
  --quote-bg: #f0f7ff;
  --suggest-bg: #fffbeb;
  --suggest-rule: #d97706;
  --tag-bg: #f3f4f6;
  --tag-eng: #fee2e2;
  --tag-eng-fg: #991b1b;
  --shadow: 0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06);
  --mono: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  --sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', sans-serif;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 0;
  font-family: var(--sans);
  font-size: 15px;
  line-height: 1.7;
  color: var(--fg);
  background: var(--bg);
}
.page-head {
  max-width: 820px;
  margin: 48px auto 24px;
  padding: 0 32px;
}
.page-head h1 {
  font-size: 24px;
  font-weight: 600;
  margin: 0 0 12px;
  letter-spacing: -0.01em;
}
.page-head .meta {
  font-size: 13px;
  color: var(--fg-muted);
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}
.page-head .meta .dot { color: var(--border); }
.badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 999px;
  background: var(--tag-bg);
  font-size: 12px;
  font-weight: 500;
}
.badge-q { background: var(--accent-soft); color: var(--accent); }
.badge-o { background: var(--suggest-bg); color: var(--suggest-rule); }
.page-head .hint {
  font-size: 13px;
  color: var(--fg-muted);
  background: var(--bg-card);
  border: 1px solid var(--border);
  padding: 10px 14px;
  border-radius: 6px;
  margin: 0;
}
.page-head .hint code {
  font-family: var(--mono);
  font-size: 12px;
  background: var(--tag-bg);
  padding: 1px 6px;
  border-radius: 3px;
}
.toc {
  position: sticky;
  top: 0;
  z-index: 10;
  max-width: 820px;
  margin: 0 auto;
  padding: 12px 32px;
  background: rgba(250, 250, 250, 0.85);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--border);
  font-size: 13px;
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}
.toc-group { display: inline-flex; gap: 6px; flex-wrap: wrap; align-items: baseline; }
.toc-label {
  font-family: var(--mono);
  color: var(--fg-muted);
  font-size: 12px;
  margin-right: 4px;
}
.toc a {
  text-decoration: none;
  color: var(--accent);
  font-family: var(--mono);
  font-size: 12px;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--accent-soft);
}
.toc a:hover { background: var(--accent); color: white; }
main {
  max-width: 820px;
  margin: 0 auto;
  padding: 32px;
}
.section { margin-bottom: 48px; }
.section h2 {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 20px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.section h2 .num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: var(--fg);
  color: white;
  border-radius: 50%;
  font-size: 13px;
  font-weight: 600;
}
.section h2 small {
  font-size: 13px;
  font-weight: 400;
  color: var(--fg-muted);
  margin-left: auto;
}
.section .empty {
  color: var(--fg-muted);
  font-size: 14px;
  padding: 20px;
  text-align: center;
  background: var(--bg-card);
  border: 1px dashed var(--border);
  border-radius: 6px;
}
.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 20px 24px;
  margin-bottom: 16px;
  box-shadow: var(--shadow);
  scroll-margin-top: 80px;
}
.card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
}
.card-head h3 {
  font-size: 15px;
  font-weight: 600;
  font-family: var(--mono);
  margin: 0;
  color: var(--accent);
}
.tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: 4px;
  background: var(--tag-bg);
  color: var(--fg-muted);
  font-size: 12px;
  font-family: var(--mono);
}
.tag-cat { background: var(--accent-soft); color: var(--accent); }
.tag-cursor { font-size: 11px; }
.tag-eng { background: var(--tag-eng); color: var(--tag-eng-fg); }
.tag-diff { background: var(--suggest-bg); color: var(--suggest-rule); }
.tag-chapter { font-family: var(--sans); }
.prd-quote {
  margin: 0 0 14px;
  padding: 10px 16px;
  border-left: 3px solid var(--quote-rule);
  background: var(--quote-bg);
  font-family: var(--mono);
  font-size: 13.5px;
  color: var(--fg);
  border-radius: 0 4px 4px 0;
  white-space: pre-wrap;
  word-break: break-word;
}
.no-evidence {
  margin: 0 0 12px;
  padding: 8px 14px;
  background: var(--tag-eng);
  color: var(--tag-eng-fg);
  font-size: 13px;
  border-radius: 4px;
}
.card .question {
  font-size: 15px;
  font-weight: 500;
  margin: 0 0 14px;
}
.card .question::before {
  content: '❓ ';
  margin-right: 2px;
}
.suggest {
  margin: 0;
  padding: 10px 14px;
  background: var(--suggest-bg);
  border-left: 3px solid var(--suggest-rule);
  border-radius: 0 4px 4px 0;
  font-size: 13.5px;
  color: var(--fg);
}
.suggest::before {
  content: '💡 ';
}
.card-o .diff {
  margin: 0;
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 6px 16px;
  align-items: start;
}
.card-o .diff dt {
  font-size: 12px;
  font-weight: 500;
  color: var(--fg-muted);
  font-family: var(--mono);
  padding-top: 12px;
}
.card-o .diff dd { margin: 0; }
.card-o .diff dd.figma {
  font-size: 14px;
  padding: 8px 0;
}
footer {
  max-width: 820px;
  margin: 32px auto;
  padding: 0 32px;
  text-align: center;
  color: var(--fg-muted);
  font-family: var(--mono);
  font-size: 11px;
}
@media (max-width: 640px) {
  .page-head, main, .toc, footer { padding-left: 16px; padding-right: 16px; }
  .card { padding: 16px; }
  .section h2 { flex-wrap: wrap; }
  .section h2 small { margin-left: 0; flex-basis: 100%; }
}
`;
}
