#!/usr/bin/env node
// Footprint Extractor - extract 6 categories of structural facts from TSX/TS files.
//
// Designed to feed step 3 tech-solution-generator §4.0 (现有足迹基线) so the LLM no longer
// has to scan source files for: imports / tracking calls / i18n keys / business filters /
// responsive strategy / dark-mode coverage. The LLM reads the JSON and writes §4.0 directly.
//
// Usage:
//   node footprint-extractor.mjs --files <p1>,<p2>,...
//                                [--baseline <path/to/code-baseline.md>]
//                                [--output footprint.json]
//
// Args:
//   --files     comma-separated absolute or relative paths to TSX/TS source files (required)
//   --baseline  optional [CODE_BASELINE] markdown path for project-specific config overrides;
//               if absent, uses defaults (works on most React/Next.js projects)
//   --output    optional output JSON path (default: footprint.json in cwd)
//
// Output schema:
//   {
//     "summary": { total_files, total_imports, total_tracking_calls, total_i18n_keys,
//                  total_dark_classes, total_rollout_hits, total_business_filters,
//                  responsive_strategies },
//     "protected_footprint": [ "tracking_calls" ],  // 二级保险：标记为受保护的足迹类别，
//                                                   // 严禁登记进 tech-fe.md §4.6 删除授权清单
//                                                   // （见 pageforge/SKILL.md step 3 限制④）
//     "files": [ <extractFootprint output per file> ]
//   }

import fs from 'node:fs';
import path from 'node:path';
import { extractFootprint, loadBaselineConfig } from './lib/extract.mjs';

const args = parseArgs(process.argv.slice(2));

if (!args.files) {
  console.error(
    'Usage: node footprint-extractor.mjs --files <p1>,<p2>,... [--baseline <code-baseline.md>] [--output <out>]',
  );
  process.exit(2);
}

const filePaths = args.files
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const config = loadBaselineConfig(args.baseline);
const outputPath = args.output || 'footprint.json';

const fileFootprints = filePaths.map((p) => extractFootprint(path.resolve(p), config));

const summary = {
  total_files: fileFootprints.length,
  total_imports: sum(fileFootprints, 'imports'),
  total_tracking_calls: sum(fileFootprints, 'tracking_calls'),
  total_i18n_keys: sum(fileFootprints, 'i18n_keys'),
  total_business_filters: sum(fileFootprints, 'business_filters'),
  total_dark_classes: sum(fileFootprints, 'dark_mode'),
  total_rollout_hits: sum(fileFootprints, 'rollout'),
  responsive_strategies: fileFootprints.map((f) => ({
    file: f.path ? path.basename(f.path) : '?',
    strategy: f.responsive?.strategy || 'unknown',
  })),
};

// 二级保险：埋点足迹受保护，禁止被 §4.6 删除授权清单登记（见 SKILL.md step 3 限制④）
const output = {
  summary,
  protected_footprint: ['tracking_calls'],
  config_used: config,
  files: fileFootprints,
};
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

console.log(`✅ footprint written to ${outputPath}`);
console.log(JSON.stringify(summary, null, 2));

function sum(footprints, key) {
  return footprints.reduce((n, f) => n + (Array.isArray(f[key]) ? f[key].length : 0), 0);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}
