#!/usr/bin/env node
// Import Resolver — postcondition check for pageforge-generated .tsx/.ts files.
//
// Detects "phantom imports": import statements whose target file does not exist
// on disk. Designed for pageforge step 5-C as a second axis to the existing
// TODO-occurrence accounting (page-logic-gen.md 步骤 4 / 5-C postcondition).
//
// Boundary (deliberate):
//   - Path / file-existence only — NO typecheck, NO export-name resolution,
//     NO JSX element / lint analysis. Kept project-agnostic (any project with
//     ES module imports, regardless of TS/JS).
//   - Aliases: read from tsconfig.json compilerOptions.paths if present;
//     can be overridden via --alias.
//   - Bare specifiers (package imports like 'react', 'jotai') are skipped by
//     default — verifying them is package-manager territory, not pageforge.
//
// Usage:
//   node import-resolver.mjs --files <p1,p2,...>
//                           [--summary <TEMPLATE_SUMMARY.md>]
//                           [--project-root <dir>]    (default: cwd)
//                           [--alias '@/=src/'[,'~/=src/']]
//                           [--json]
//
// Exit codes:
//   0 — all imports resolved (or skipped); prints `import-resolver-pass-token:<hash>`
//   1 — at least one not-found; prints broken list; no pass-token
//   2 — usage error (no input files)
//
// Zero external deps.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const EXTS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs'];
const INDEX_EXTS = ['/index.tsx', '/index.ts', '/index.jsx', '/index.js'];

function parseArgs(argv) {
  const a = { files: [], aliases: [], json: false };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--files') { a.files = v.split(',').filter(Boolean); i++; }
    else if (k === '--summary') { a.summary = v; i++; }
    else if (k === '--project-root') { a.projectRoot = v; i++; }
    else if (k === '--alias') { a.aliases.push(...v.split(',').filter(Boolean)); i++; }
    else if (k === '--json') { a.json = true; }
  }
  return a;
}

function stripJsonComments(src) {
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
    if (c === '"' || c === "'") { inStr = true; strCh = c; out += c; i++; continue; }
    if (c === '/' && next === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && next === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    out += c;
    i++;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

function readTsconfigAliases(projectRoot) {
  const p = path.join(projectRoot, 'tsconfig.json');
  if (!fs.existsSync(p)) return [];
  try {
    const cfg = JSON.parse(stripJsonComments(fs.readFileSync(p, 'utf8')));
    const paths = cfg?.compilerOptions?.paths;
    const baseUrl = cfg?.compilerOptions?.baseUrl ?? '.';
    if (!paths || typeof paths !== 'object') return [];
    const out = [];
    for (const [key, vals] of Object.entries(paths)) {
      const target = Array.isArray(vals) ? vals[0] : vals;
      if (!key.endsWith('/*') || typeof target !== 'string' || !target.endsWith('/*')) continue;
      const prefix = key.slice(0, -1);
      const expand = path.resolve(projectRoot, baseUrl, target.slice(0, -1));
      out.push({ prefix, expand });
    }
    return out;
  } catch {
    return [];
  }
}

// Strip line + block comments (preserve newlines) so commented-out imports
// (legal TODO upstream-gap placeholders) don't get scanned as real imports.
function stripCodeComments(src) {
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
    if (c === '/' && next === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && next === '*') {
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

function extractImportPaths(src) {
  const code = stripCodeComments(src);
  const seen = new Set();
  const re1 = /\bfrom\s+['"]([^'"\n]+)['"]/g;
  const re2 = /\bimport\(\s*['"]([^'"\n]+)['"]\s*\)/g;
  const re3 = /^\s*import\s+['"]([^'"\n]+)['"]/gm;
  let m;
  while ((m = re1.exec(code))) seen.add(m[1]);
  while ((m = re2.exec(code))) seen.add(m[1]);
  while ((m = re3.exec(code))) seen.add(m[1]);
  return [...seen];
}

function tryResolve(target) {
  if (fs.existsSync(target)) {
    const st = fs.statSync(target);
    if (st.isFile()) return target;
    if (st.isDirectory()) {
      for (const ie of INDEX_EXTS) {
        const p = target + ie;
        if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
      }
    }
  }
  for (const ext of EXTS) {
    const p = target + ext;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  for (const ie of INDEX_EXTS) {
    const p = target + ie;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}

function classify(spec, ownerFile, aliases) {
  if (spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/')) {
    const base = path.dirname(ownerFile);
    const target = path.resolve(base, spec);
    return { kind: 'relative', target };
  }
  for (const { prefix, expand } of aliases) {
    if (spec === prefix.slice(0, -1) || spec.startsWith(prefix)) {
      const rest = spec.startsWith(prefix) ? spec.slice(prefix.length) : '';
      const target = path.resolve(expand, rest);
      return { kind: 'alias', target, prefix };
    }
  }
  return { kind: 'bare', spec };
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

function main() {
  const args = parseArgs(process.argv);
  const projectRoot = args.projectRoot ? path.resolve(args.projectRoot) : process.cwd();

  let aliases = [];
  for (const a of args.aliases) {
    const [prefix, target] = a.split('=');
    if (prefix && target) aliases.push({ prefix, expand: path.resolve(projectRoot, target) });
  }
  if (aliases.length === 0) aliases = readTsconfigAliases(projectRoot);

  let files = [...args.files];
  if (args.summary) {
    const fromSummary = readSummaryFiles(path.resolve(projectRoot, args.summary));
    files = [...new Set([...files, ...fromSummary])];
  }
  files = files.map(f => path.isAbsolute(f) ? f : path.resolve(projectRoot, f));

  if (files.length === 0) {
    console.error('import-resolver: no input files (use --files or --summary)');
    process.exit(2);
  }

  const broken = [];
  const skipped = [];
  const resolved = [];

  for (const f of files) {
    if (!fs.existsSync(f)) {
      broken.push({ file: f, spec: '(file missing on disk)', kind: 'owner-missing' });
      continue;
    }
    const src = fs.readFileSync(f, 'utf8');
    const specs = extractImportPaths(src);
    for (const spec of specs) {
      const c = classify(spec, f, aliases);
      if (c.kind === 'bare') {
        skipped.push({ file: f, spec });
        continue;
      }
      const target = tryResolve(c.target);
      if (target) {
        resolved.push({ file: f, spec, target });
      } else {
        broken.push({ file: f, spec, attempt: c.target, kind: c.kind });
      }
    }
  }

  const ok = broken.length === 0;

  if (args.json) {
    console.log(JSON.stringify({
      ok,
      project_root: projectRoot,
      files_scanned: files.length,
      aliases: aliases.map(a => ({ prefix: a.prefix, expand: a.expand })),
      resolved_count: resolved.length,
      skipped_count: skipped.length,
      broken,
    }, null, 2));
  } else {
    console.log(`# import-resolver`);
    console.log(`project_root: ${projectRoot}`);
    console.log(`files scanned: ${files.length}`);
    console.log(`aliases: ${aliases.map(a => `${a.prefix} → ${path.relative(projectRoot, a.expand)}/`).join(', ') || '(none)'}`);
    console.log(`resolved: ${resolved.length}  bare-skipped: ${skipped.length}  broken: ${broken.length}`);
    if (broken.length) {
      console.log(`\n## Broken imports (${broken.length})\n`);
      for (const b of broken) {
        const rel = path.relative(projectRoot, b.file);
        console.log(`- ${rel}`);
        console.log(`    spec:    ${b.spec}`);
        console.log(`    attempt: ${b.attempt ? path.relative(projectRoot, b.attempt) : b.kind}`);
      }
    }
  }

  if (ok) {
    const seed = JSON.stringify({
      files: files.map(f => path.relative(projectRoot, f)).sort(),
      aliases: aliases.map(a => ({ p: a.prefix, e: path.relative(projectRoot, a.expand) })),
    });
    const token = crypto.createHash('sha256').update(seed).digest('hex').slice(0, 12);
    console.log(`\nimport-resolver-pass-token:${token}`);
    process.exit(0);
  } else {
    process.exit(1);
  }
}

main();
