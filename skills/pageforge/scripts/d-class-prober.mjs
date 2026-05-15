#!/usr/bin/env node
// D-class Prober - existence + similar-file probe for §4.2 NW-* new files.
//
// Designed to feed step 3 tech-solution-generator Phase 2 step 5 (D-class probe) so the
// LLM no longer has to run ls + grep itself for each NW-*. The LLM reads the JSON output
// and decides which of 4 manifest status values to apply.
//
// Usage:
//   node d-class-prober.mjs --input <items.json>
//                           --source-root <abs-path>
//                           [--output result.json]
//                           [--include tsx,ts,jsx,js]
//
// Args:
//   --input        JSON file with array of items: [{nw_id, plan_path, keywords}, ...]
//                  - nw_id: required, e.g. "NW-001"
//                  - plan_path: required, absolute path the LLM plans to create
//                  - keywords: required array, search terms to find similar files
//                              (LLM provides; typically ComponentName + kebab-case variant)
//   --source-root  required absolute path; project source root (from baseline M2)
//   --output       optional JSON output path; default stdout
//   --include      comma-separated file extensions to search (default: tsx,ts,jsx,js)
//
// Output schema:
//   {
//     "results": [
//       { "nw_id": "...", "plan_path": "...",
//         "exists": true|false,
//         "candidates": [{ "path": "...", "matches": <int> }, ...]   // only when exists=false
//       },
//       ...
//     ],
//     "stats": { "total": N, "exists": N, "with_candidates": N, "no_match": N }
//   }
//
// Zero external deps (uses node:fs + node:child_process + system grep).

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

function parseArgs(argv) {
  const args = { include: 'tsx,ts,jsx,js' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input') args.input = argv[++i];
    else if (a === '--source-root') args.sourceRoot = argv[++i];
    else if (a === '--output') args.output = argv[++i];
    else if (a === '--include') args.include = argv[++i];
    else if (a === '-h' || a === '--help') {
      console.log('Usage: node d-class-prober.mjs --input items.json --source-root /abs/path [--output out.json] [--include tsx,ts]');
      process.exit(0);
    }
  }
  return args;
}

function fail(msg) {
  console.error(`d-class-prober: ${msg}`);
  process.exit(2);
}

function probeOne(item, sourceRoot, includeFlags) {
  const { nw_id, plan_path, keywords } = item;
  if (!nw_id || !plan_path) {
    return { nw_id: nw_id ?? '<missing>', plan_path: plan_path ?? '<missing>', error: 'missing nw_id or plan_path' };
  }

  // 1. Existence check
  const exists = fs.existsSync(plan_path);
  if (exists) return { nw_id, plan_path, exists: true };

  // 2. Similar-file probe via grep -l, tally matches across keywords
  const tally = new Map(); // path -> hit count
  const kws = Array.isArray(keywords) ? keywords : [];
  for (const kw of kws) {
    const escaped = kw.replace(/(["\\$`])/g, '\\$1');
    let out = '';
    try {
      out = execSync(`grep -r -l ${includeFlags} -- "${escaped}" "${sourceRoot}"`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch (_e) {
      // grep exits 1 when no matches; that is normal here
      out = '';
    }
    out.split('\n').filter(Boolean).forEach((p) => {
      tally.set(p, (tally.get(p) ?? 0) + 1);
    });
  }
  const candidates = [...tally.entries()]
    .map(([p, matches]) => ({ path: p, matches }))
    .sort((a, b) => b.matches - a.matches)
    .slice(0, 5);

  return { nw_id, plan_path, exists: false, candidates };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.input) fail('--input is required');
  if (!args.sourceRoot) fail('--source-root is required');
  if (!path.isAbsolute(args.sourceRoot)) fail(`--source-root must be absolute, got: ${args.sourceRoot}`);
  if (!fs.existsSync(args.input)) fail(`input file not found: ${args.input}`);
  if (!fs.existsSync(args.sourceRoot)) fail(`source-root not found: ${args.sourceRoot}`);

  const items = JSON.parse(fs.readFileSync(args.input, 'utf8'));
  if (!Array.isArray(items)) fail('input JSON must be an array of items');

  const includeFlags = args.include
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean)
    .map((e) => `--include="*.${e}"`)
    .join(' ');

  const results = items.map((item) => probeOne(item, args.sourceRoot, includeFlags));

  const stats = {
    total: results.length,
    exists: results.filter((r) => r.exists === true).length,
    with_candidates: results.filter((r) => r.exists === false && r.candidates?.length > 0).length,
    no_match: results.filter((r) => r.exists === false && (!r.candidates || r.candidates.length === 0)).length,
  };

  const output = JSON.stringify({ results, stats }, null, 2);
  if (args.output) {
    fs.writeFileSync(args.output, output);
    console.error(`✅ wrote ${results.length} probes to ${args.output} (exists=${stats.exists}, with_candidates=${stats.with_candidates}, no_match=${stats.no_match})`);
  } else {
    process.stdout.write(output);
  }
}

main();
