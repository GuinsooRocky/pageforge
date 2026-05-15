#!/usr/bin/env node
// Page Aggregator - 4-C placeholder replacement + 'use client' OR aggregation.
//
// Designed to feed step 4 page-template-gen 4-C 收尾 aggregator so the LLM no longer
// has to do per-NW-* Edit calls. Script reads nw_components JSON, replaces all
// status=ok placeholders in page.tsx with real components, batch-appends imports,
// OR-aggregates is_client to decide top-of-file 'use client' directive, and runs
// built-in validation (replaced count vs ok count vs skeleton-failed count).
//
// Usage:
//   node page-aggregator.mjs --page <page.tsx>
//                            --manifest <nw_components.json>
//                            [--page-self-client true|false]
//                            [--dry-run]
//
// Args:
//   --page              required, absolute path to page.tsx (or equivalent entry file)
//   --manifest          required, JSON file with nw_components array (see schema below)
//   --page-self-client  optional, "true" if page.tsx itself uses hooks/events/browser API
//                       (LLM judges per the 4-condition spec; default "false")
//   --dry-run           optional, print result to stderr without writing
//
// Manifest JSON schema:
//   [
//     {
//       "nw_id": "NW-001",
//       "name": "TooltipV2",                       // component identifier in JSX
//       "import_path": "@/components/TooltipV2",   // import 'from' value
//       "status": "ok" | "skeleton-failed",
//       "is_client": true | false                  // ignored if status=skeleton-failed
//     }
//   ]
//
// Validation:
//   - replaced count must equal status=ok count → else exit 1
//   - remaining placeholder count must equal status=skeleton-failed count → else exit 1
//
// Zero external deps.

import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const args = { pageSelfClient: false, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--page') args.page = argv[++i];
    else if (a === '--manifest') args.manifest = argv[++i];
    else if (a === '--page-self-client') args.pageSelfClient = argv[++i] === 'true';
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '-h' || a === '--help') {
      console.log('Usage: node page-aggregator.mjs --page <page.tsx> --manifest <nw.json> [--page-self-client true|false] [--dry-run]');
      process.exit(0);
    }
  }
  return args;
}

function fail(msg) {
  console.error(`page-aggregator: ${msg}`);
  process.exit(2);
}

function findImportInsertPoint(src) {
  // Find the line index after the last `import ... from '...'` or `import '...'` statement.
  const lines = src.split('\n');
  let lastImportIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^import\s.+from\s+['"]/.test(t) || /^import\s+['"]/.test(t)) {
      lastImportIdx = i;
    }
  }
  return lastImportIdx; // -1 if no imports yet
}

function ensureUseClient(src, needed) {
  const trimmed = src.trimStart();
  const has = /^['"]use client['"]\s*;?/.test(trimmed);
  if (!needed) return { src, status: has ? 'kept' : 'absent' };
  if (has) return { src, status: 'kept' };
  return { src: `'use client';\n\n${src}`, status: 'added' };
}

function buildPlaceholderRegex(nwId) {
  // Match: <div ... data-placeholder="NW-001" ... /> (self-closing)
  //     or <div ... data-placeholder="NW-001" ...></div> (paired, empty)
  // The order of attributes is unrestricted.
  const escaped = nwId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `<div\\s+[^>]*data-placeholder=["']${escaped}["'][^>]*?(?:\\/>|>\\s*</div>)`,
    'g'
  );
}

function countPlaceholders(src) {
  return (src.match(/<div\s+[^>]*data-placeholder=["'][^"']+["'][^>]*?(?:\/>|>\s*<\/div>)/g) || []).length;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.page) fail('--page is required');
  if (!args.manifest) fail('--manifest is required');
  if (!path.isAbsolute(args.page)) fail(`--page must be absolute, got: ${args.page}`);
  if (!fs.existsSync(args.page)) fail(`page file not found: ${args.page}`);
  if (!fs.existsSync(args.manifest)) fail(`manifest file not found: ${args.manifest}`);

  const items = JSON.parse(fs.readFileSync(args.manifest, 'utf8'));
  if (!Array.isArray(items)) fail('manifest JSON must be an array');

  const okItems = items.filter((x) => x.status === 'ok');
  const failedItems = items.filter((x) => x.status === 'skeleton-failed');
  const otherItems = items.filter((x) => x.status !== 'ok' && x.status !== 'skeleton-failed');
  if (otherItems.length > 0) {
    fail(`unexpected status values: ${otherItems.map((x) => `${x.nw_id}=${x.status}`).join(', ')}; expected ok | skeleton-failed`);
  }

  let src = fs.readFileSync(args.page, 'utf8');
  const initialPlaceholders = countPlaceholders(src);

  // 1. Replace each status=ok placeholder div → component JSX.
  let replacedCount = 0;
  const importsToAdd = []; // [{name, path}]
  for (const item of okItems) {
    if (!item.nw_id || !item.name || !item.import_path) {
      fail(`item missing nw_id/name/import_path: ${JSON.stringify(item)}`);
    }
    const re = buildPlaceholderRegex(item.nw_id);
    const before = src;
    src = src.replace(re, `<${item.name} />`);
    if (src !== before) {
      replacedCount++;
      importsToAdd.push({ name: item.name, path: item.import_path });
    }
  }

  // 2. Validation: replaced count == ok count
  if (replacedCount !== okItems.length) {
    fail(`replaced count mismatch: replaced=${replacedCount}, ok-status=${okItems.length}; check page.tsx for missing placeholders or attribute typo`);
  }

  // 3. Validation: remaining placeholders == skeleton-failed count
  const remainingPlaceholders = countPlaceholders(src);
  if (remainingPlaceholders !== failedItems.length) {
    fail(`remaining placeholder count mismatch: remaining=${remainingPlaceholders}, skeleton-failed=${failedItems.length}; either spurious placeholder or skeleton-failed item not in page.tsx`);
  }

  // 4. Batch append imports after the last import statement (skip if already present).
  if (importsToAdd.length > 0) {
    const lines = src.split('\n');
    const insertIdx = findImportInsertPoint(src);
    const newImports = [];
    for (const imp of importsToAdd) {
      const stmt = `import { ${imp.name} } from '${imp.path}';`;
      if (!src.includes(stmt)) newImports.push(stmt);
    }
    if (newImports.length > 0) {
      if (insertIdx >= 0) {
        lines.splice(insertIdx + 1, 0, ...newImports);
      } else {
        // No existing imports — insert at top (after potential 'use client' to be added below).
        lines.unshift(...newImports, '');
      }
      src = lines.join('\n');
    }
  }

  // 5. OR-aggregate is_client across status=ok items + caller-provided pageSelfClient.
  const childClient = okItems.some((x) => x.is_client === true);
  const needUseClient = childClient || args.pageSelfClient;
  const useClientResult = ensureUseClient(src, needUseClient);
  src = useClientResult.src;

  // 6. Write back (or dry-run).
  if (args.dryRun) {
    process.stdout.write(src);
  } else {
    fs.writeFileSync(args.page, src);
  }

  // Summary to stderr.
  console.error(
    `✅ page-aggregator: replaced ${replacedCount} placeholder(s) / ` +
    `added ${importsToAdd.length} import(s) / ` +
    `'use client' ${useClientResult.status}` +
    (failedItems.length > 0 ? ` / retained ${failedItems.length} skeleton-failed placeholder(s)` : '') +
    (args.dryRun ? ' [DRY RUN]' : '')
  );
  console.error(`   initial placeholders=${initialPlaceholders}, after-replace remaining=${remainingPlaceholders} (== skeleton-failed count ✓)`);
}

main();
