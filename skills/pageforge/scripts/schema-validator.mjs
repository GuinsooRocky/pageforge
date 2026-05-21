#!/usr/bin/env node
// Schema Validator - postcondition self-check for pageforge step产物.
//
// Designed to be called by sub-agents BEFORE they return to main Agent (sub-agent
// self-check pattern). The validator reads the target markdown file(s) and verifies
// schema invariants documented in pageforge/SKILL.md.
//
// Usage:
//   node schema-validator.mjs --step <2|3|4> [--manifest <path>] [--tech-fe <path>] [--template-summary <path>]
//
// Step → file → validation rules:
//   step 2 (visual-analyzer):
//     --manifest required
//     - Every `- **status**: <value>` row must be in the 9-enum set
//     - `path` (component file path) — soft check only at step 2
//
//   step 3 (tech-solution-generator):
//     --manifest required
//     --tech-fe required
//     - All status values in 9-enum set
//     - Invariant: count of "待 step 3 确认" must be 0
//     - tech-fe.md frontmatter 模式 in {brownfield, greenfield, mixed}
//     - If 模式: mixed, pages: array must be non-empty
//
//   step 4 (page-template-gen):
//     --template-summary required
//     - "## nw_components 状态表" section must exist
//     - Each table row has 5 columns
//     - Each row's status in {ok, skeleton-failed}
//     - Each row's path starts with "/"
//
//   step 5 (page-logic-gen, post-codegen):
//     --source-root required (absolute path to project src dir, from [CODE_BASELINE] M2)
//     - No `throw new Error('not implemented')` residue (pseudo-completion stub)
//     - Source root from [CODE_BASELINE] M2 source_root. Scans .ts/.tsx/.js/.jsx files,
//       skipping node_modules / .next / .turbo / dist / build / .git.
//     - 注意：本检测仅查 throw-not-implemented（误报率极低，跨项目通用）。
//       `as unknown as` 这类 TS cast 在 React/测试/浏览器兼容场景大量合法使用，
//       加白名单 = 定制化 = 违反 pageforge 跨项目通用原则，故不查。
//     - Background: v0.0.3 实战根因 #1 (延期项不回收) — see evolution/05.14-v0.0.3-实战 5 根因.md
//
// Exit code: 0 = pass, 2 = fail. On pass stdout prints `validator-pass-token: <step>-<short-hash>`
// for sub-agent to include in its return summary (proof-of-validation).
//
// Zero external deps. Enums loaded from ../schemas/*.schema.json (single source of truth).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMAS_DIR = path.resolve(__dirname, '..', 'schemas');

// Load enum sets from schemas/*.schema.json (JSON Schema `enum` field).
// Single source of truth: sub-agent prompts reference the same files for product format spec.
function loadEnum(filename) {
  const fp = path.join(SCHEMAS_DIR, filename);
  if (!fs.existsSync(fp)) {
    throw new Error(`schema-validator: missing schema file ${fp}. Re-check pageforge/schemas/ integrity.`);
  }
  const schema = JSON.parse(fs.readFileSync(fp, 'utf8'));
  if (!Array.isArray(schema.enum)) {
    throw new Error(`schema-validator: ${filename} has no top-level \`enum\` array.`);
  }
  return new Set(schema.enum);
}

const MANIFEST_STATUS_ENUM = loadEnum('manifest-status.schema.json');
const TECH_FE_MODE_ENUM = loadEnum('tech-fe-mode.schema.json');

// nw_components row schema is an object; its `status` is nested.
const NW_COMPONENTS_SCHEMA = JSON.parse(
  fs.readFileSync(path.join(SCHEMAS_DIR, 'nw-components.schema.json'), 'utf8'),
);
const NW_STATUS_ENUM = new Set(NW_COMPONENTS_SCHEMA.properties.status.enum);
const VERIFY_STATUS_ENUM = new Set(NW_COMPONENTS_SCHEMA.properties.verify_status.enum);

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--step') args.step = argv[++i];
    else if (a === '--manifest') args.manifest = argv[++i];
    else if (a === '--tech-fe') args.techFe = argv[++i];
    else if (a === '--template-summary') args.templateSummary = argv[++i];
    else if (a === '--source-root') args.sourceRoot = argv[++i];
    else if (a === '-h' || a === '--help') {
      console.log('Usage: node schema-validator.mjs --step <2|3|4|5> [--manifest <path>] [--tech-fe <path>] [--template-summary <path>] [--source-root <path>]');
      process.exit(0);
    }
  }
  return args;
}

function failures(arr) {
  // returns array of {rule, line, value, hint}
  return arr.filter(Boolean);
}

function readOrFail(path) {
  if (!fs.existsSync(path)) throw new Error(`file not found: ${path}`);
  return fs.readFileSync(path, 'utf8');
}

function validateManifest(content, opts = {}) {
  const errors = [];
  const lines = content.split('\n');
  const statusValues = []; // {line, value}

  // Match "- **status**: <value>"
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^[-*]\s+\*\*status\*\*:\s*(.+?)\s*$/);
    if (m) statusValues.push({ line: i + 1, value: m[1] });
  }

  if (statusValues.length === 0) {
    errors.push({ rule: 'manifest-empty', hint: '[MANIFEST] 中未发现任何 `- **status**: ...` 行；检查文件是否被正确产出' });
  }

  for (const { line, value } of statusValues) {
    if (!MANIFEST_STATUS_ENUM.has(value)) {
      errors.push({
        rule: 'unknown-status',
        line,
        value,
        hint: `合法 status 集合：${[...MANIFEST_STATUS_ENUM].join(' / ')}`,
      });
    }
  }

  if (opts.afterStep3) {
    const pending = statusValues.filter((s) => s.value === '待 step 3 确认');
    if (pending.length > 0) {
      errors.push({
        rule: 'pending-after-step3',
        count: pending.length,
        hint: `step 3 Phase 2 完成后 [MANIFEST] 不允许残留 \`待 step 3 确认\`；共 ${pending.length} 处（行号：${pending.map((p) => p.line).join(', ')}）；回 step 3 重跑 Phase 2`,
      });
    }
  }

  return { errors, statusCount: statusValues.length };
}

function parseFrontmatter(content) {
  // Extract content between first --- and second ---
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const body = m[1];
  const fields = {};
  // Simple yaml-style key: value, plus list block detection (pages:)
  const lines = body.split('\n');
  let pagesArrayDetected = false;
  let pagesItemCount = 0;
  let inPagesList = false;
  for (const line of lines) {
    if (/^pages\s*:/.test(line)) {
      pagesArrayDetected = true;
      inPagesList = true;
      // pages: [...] inline form — try to detect non-empty
      const inlineMatch = line.match(/^pages\s*:\s*\[(.*)\]\s*$/);
      if (inlineMatch) {
        pagesItemCount = inlineMatch[1].trim() === '' ? 0 : inlineMatch[1].split(',').length;
        inPagesList = false;
      }
      continue;
    }
    if (inPagesList && /^\s*-\s/.test(line)) {
      pagesItemCount++;
    } else if (inPagesList && line && !line.startsWith(' ') && !line.startsWith('\t')) {
      inPagesList = false;
    }

    const kv = line.match(/^([^\s:][^:]*?)\s*:\s*(.+?)\s*$/);
    if (kv) fields[kv[1].trim()] = kv[2].trim();
  }
  fields._pagesArrayDetected = pagesArrayDetected;
  fields._pagesItemCount = pagesItemCount;
  return fields;
}

function validateTechFe(content) {
  const errors = [];
  const fm = parseFrontmatter(content);
  if (!fm) {
    errors.push({ rule: 'tech-fe-frontmatter-missing', hint: '[TECH_FE] 缺 frontmatter（首行必须是 `---` 包围的 YAML 块）' });
    return { errors };
  }
  const mode = fm['模式'] ?? fm['mode'];
  if (!mode) {
    errors.push({ rule: 'tech-fe-mode-missing', hint: '[TECH_FE] frontmatter 缺 `模式:` 字段；合法值 brownfield/greenfield/mixed' });
  } else if (!TECH_FE_MODE_ENUM.has(mode)) {
    errors.push({
      rule: 'tech-fe-mode-invalid',
      value: mode,
      hint: `[TECH_FE] frontmatter \`模式: ${mode}\` 非法；合法集合：${[...TECH_FE_MODE_ENUM].join(' / ')}`,
    });
  } else if (mode === 'mixed') {
    if (!fm._pagesArrayDetected) {
      errors.push({ rule: 'tech-fe-mixed-missing-pages', hint: '[TECH_FE] 模式: mixed 但 frontmatter 缺 `pages:` 列表' });
    } else if (fm._pagesItemCount === 0) {
      errors.push({ rule: 'tech-fe-mixed-pages-empty', hint: '[TECH_FE] 模式: mixed 但 `pages:` 数组为空；至少需要 2 个页面（一 brownfield 一 greenfield）' });
    } else if (fm._pagesItemCount === 1) {
      errors.push({
        rule: 'tech-fe-mixed-pages-single',
        hint: '[TECH_FE] 模式: mixed 仅 1 个 page；mixed 严格定义为 ≥ 2 页且既有 brownfield 又有 greenfield；单页面应改用单值模式',
      });
    }
  }
  return { errors, mode };
}

function validateTemplateSummary(content) {
  const errors = [];
  const lines = content.split('\n');

  // Find "## nw_components 状态表" section
  const sectionStart = lines.findIndex((l) => /^##\s+nw_components\s+状态表/.test(l));
  if (sectionStart === -1) {
    errors.push({ rule: 'nw-section-missing', hint: '[TEMPLATE_SUMMARY] 缺 `## nw_components 状态表` 节；schema 见 pageforge/SKILL.md' });
    return { errors };
  }

  // Find table rows (skip header + separator)
  const tableLines = [];
  let foundHeader = false;
  for (let i = sectionStart + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^##\s/.test(l)) break; // next section
    if (/^\|/.test(l)) {
      if (!foundHeader) {
        foundHeader = true;
        continue; // skip header line
      }
      if (/^\|\s*-+/.test(l) || /^\|---/.test(l)) continue; // skip separator
      tableLines.push({ line: i + 1, raw: l });
    }
  }

  if (tableLines.length === 0) {
    errors.push({ rule: 'nw-table-empty', hint: '`## nw_components 状态表` 节存在但表格为空；step 4-B 至少应写入一行' });
    return { errors };
  }

  for (const { line, raw } of tableLines) {
    const cells = raw.split('|').slice(1, -1).map((c) => c.trim()); // drop leading/trailing empty
    // 5 列 = 未启用 verify 回路的旧/兼容格式；6 列 = 含 lever ③ verify_status
    if (cells.length !== 5 && cells.length !== 6) {
      errors.push({
        rule: 'nw-row-column-count',
        line,
        cellCount: cells.length,
        hint: `nw_components 表必须 5 或 6 列（nw_id | path | status | is_client | failure_reason [| verify_status]）；本行 ${cells.length} 列：${raw.trim()}`,
      });
      continue;
    }
    const [nw_id, path, status, is_client, _failure_reason, verify_status] = cells;
    if (!NW_STATUS_ENUM.has(status)) {
      errors.push({
        rule: 'nw-row-status-invalid',
        line,
        value: status,
        nw_id,
        hint: `nw_components.status 非法值 \`${status}\`；合法集合：${[...NW_STATUS_ENUM].join(' / ')}`,
      });
    }
    if (!path.startsWith('/')) {
      errors.push({
        rule: 'nw-row-path-relative',
        line,
        value: path,
        nw_id,
        hint: `nw_components.path 必须绝对路径（以 \`/\` 开头）；当前值：\`${path}\``,
      });
    }
    if (!/^(true|false|-)$/.test(is_client)) {
      errors.push({
        rule: 'nw-row-is-client-invalid',
        line,
        value: is_client,
        nw_id,
        hint: `nw_components.is_client 必须为 \`true\` / \`false\` / \`-\`；当前值：\`${is_client}\``,
      });
    }
    // 6 列时校验 verify_status（lever ③）；5 列时该列缺省视为 `-`，跳过
    if (verify_status !== undefined && !VERIFY_STATUS_ENUM.has(verify_status)) {
      errors.push({
        rule: 'nw-row-verify-status-invalid',
        line,
        value: verify_status,
        nw_id,
        hint: `nw_components.verify_status 非法值 \`${verify_status}\`；合法集合：${[...VERIFY_STATUS_ENUM].join(' / ')}`,
      });
    }
  }

  return { errors, rowCount: tableLines.length };
}

// Recursively walk source dir, grep each source file line-by-line for stub-residue patterns.
// Zero deps; uses only fs.readdirSync(withFileTypes) + fs.readFileSync.
function walkAndGrepResidue(sourceRoot, patterns, opts = {}) {
  const {
    skipDirs = new Set(['node_modules', '.next', '.turbo', 'dist', 'build', '.git', 'coverage']),
    extensions = new Set(['.ts', '.tsx', '.js', '.jsx']),
    maxHits = 500, // hard cap to avoid runaway output on huge codebases
  } = opts;
  const hits = [];

  function walk(dir) {
    if (hits.length >= maxHits) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (hits.length >= maxHits) return;
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        walk(path.join(dir, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name);
      if (!extensions.has(ext)) continue;
      const fp = path.join(dir, entry.name);
      let content;
      try {
        content = fs.readFileSync(fp, 'utf8');
      } catch {
        continue;
      }
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        for (const p of patterns) {
          if (p.regex.test(lines[i])) {
            hits.push({
              rule: p.rule,
              file: fp,
              line: i + 1,
              snippet: lines[i].trim().slice(0, 140),
            });
            if (hits.length >= maxHits) return;
            break; // 同一行命中多 pattern 只算一次
          }
        }
      }
    }
  }

  walk(sourceRoot);
  return hits;
}

function getStubResidueHint(rule) {
  switch (rule) {
    case 'throw-not-implemented':
      return '伪完成 stub：方法体只 throw "not implemented"，没有真实现。step 5 完成时不应残留。根因 #1（延期项不回收）；详见 agg/evolution/05.14-v0.0.3-实战 5 根因.md';
    default:
      return '';
  }
}

function validateStubResidue(sourceRoot) {
  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`source-root not found: ${sourceRoot}`);
  }
  const stat = fs.statSync(sourceRoot);
  if (!stat.isDirectory()) {
    throw new Error(`source-root is not a directory: ${sourceRoot}`);
  }

  const patterns = [
    {
      rule: 'throw-not-implemented',
      // Matches:  throw new Error('not implemented'), throw new Error("Not Implemented"), throw new Error(`not-implemented`)
      regex: /throw\s+new\s+Error\s*\(\s*['"`]?\s*not[\s\-_]?implemented/i,
    },
  ];

  const hits = walkAndGrepResidue(sourceRoot, patterns);
  const errors = hits.map((h) => ({
    rule: h.rule,
    file: h.file,
    line: h.line,
    value: h.snippet,
    hint: getStubResidueHint(h.rule),
  }));

  return {
    errors,
    hitCount: hits.length,
    sourceRoot,
  };
}

function emitReport(step, allErrors, extras = {}) {
  if (allErrors.length === 0) {
    const tokenSeed = `step${step}-${Date.now()}-${JSON.stringify(extras)}`;
    const hash = crypto.createHash('sha256').update(tokenSeed).digest('hex').slice(0, 8);
    process.stdout.write(`validator-pass-token: step${step}-${hash}\n`);
    console.error(`✅ schema-validator step ${step} PASS (${JSON.stringify(extras)})`);
    process.exit(0);
  }
  console.error(`❌ schema-validator step ${step} FAIL — ${allErrors.length} error(s):\n`);
  for (const e of allErrors) {
    const loc = e.file
      ? `${e.file}:${e.line ?? '?'}`
      : (e.line ? `line ${e.line}` : '');
    console.error(`  [${e.rule}]${loc ? ` (${loc})` : ''}${e.value !== undefined ? ` \`${e.value}\`` : ''}${e.nw_id ? ` nw_id=${e.nw_id}` : ''}`);
    console.error(`    → ${e.hint}\n`);
  }
  process.exit(2);
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.step) {
    console.error('schema-validator: --step is required (2|3|4)');
    process.exit(2);
  }

  let allErrors = [];
  const extras = {};

  if (args.step === '2') {
    if (!args.manifest) {
      console.error('schema-validator: step 2 requires --manifest');
      process.exit(2);
    }
    try {
      const content = readOrFail(args.manifest);
      const r = validateManifest(content, { afterStep3: false });
      allErrors = r.errors;
      extras.manifest_status_count = r.statusCount;
    } catch (e) {
      console.error(`schema-validator: ${e.message}`);
      process.exit(2);
    }
  } else if (args.step === '3') {
    if (!args.manifest || !args.techFe) {
      console.error('schema-validator: step 3 requires --manifest and --tech-fe');
      process.exit(2);
    }
    try {
      const manifestContent = readOrFail(args.manifest);
      const techFeContent = readOrFail(args.techFe);
      const m = validateManifest(manifestContent, { afterStep3: true });
      const t = validateTechFe(techFeContent);
      allErrors = [...m.errors, ...t.errors];
      extras.manifest_status_count = m.statusCount;
      extras.tech_fe_mode = t.mode;
    } catch (e) {
      console.error(`schema-validator: ${e.message}`);
      process.exit(2);
    }
  } else if (args.step === '4') {
    if (!args.templateSummary) {
      console.error('schema-validator: step 4 requires --template-summary');
      process.exit(2);
    }
    try {
      const content = readOrFail(args.templateSummary);
      const r = validateTemplateSummary(content);
      allErrors = r.errors;
      extras.nw_row_count = r.rowCount;
    } catch (e) {
      console.error(`schema-validator: ${e.message}`);
      process.exit(2);
    }
  } else if (args.step === '5') {
    if (!args.sourceRoot) {
      console.error('schema-validator: step 5 requires --source-root (absolute path to project src dir; read from [CODE_BASELINE] M2 source_root)');
      process.exit(2);
    }
    if (!args.sourceRoot.startsWith('/')) {
      console.error(`schema-validator: --source-root must be absolute path (got: ${args.sourceRoot})`);
      process.exit(2);
    }
    try {
      const r = validateStubResidue(args.sourceRoot);
      allErrors = r.errors;
      extras.scanned_root = r.sourceRoot;
      extras.stub_residue_count = r.hitCount;
    } catch (e) {
      console.error(`schema-validator: ${e.message}`);
      process.exit(2);
    }
  } else {
    console.error(`schema-validator: invalid --step value: ${args.step}; expected 2|3|4|5`);
    process.exit(2);
  }

  emitReport(args.step, allErrors, extras);
}

main();
