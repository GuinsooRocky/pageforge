#!/usr/bin/env node
// DAG Validator - detect & report cycles in NW-* component dependencies inside [MANIFEST].
//
// Designed to be called after step 2 (visual-analyzer) and step 3 (tech-solution-generator)
// once NW-* components start declaring dependencies on each other via an optional
// `- **deps**: [NW-002, NW-005]` bullet in [MANIFEST].
//
// Backward-compatible: if [MANIFEST] contains zero `deps` bullets, validator passes silently —
// existing manifests (pre-v0.0.4) require no change.
//
// Usage:
//   node dag-validator.mjs --manifest <path> [--json]
//
// Output:
//   exit 0 : DAG is acyclic (or no deps declared)
//   exit 2 : cycles found; stderr lists each cycle path + suggested edge to break
//   --json : machine-readable report to stdout
//
// Algorithm:
//   - Parse [MANIFEST] for `## N {name}（NW-xxx）` headers + subsequent `- **deps**: [..]` bullets
//   - Build directed graph: NW-id → [dep NW-ids]
//   - DFS with three-color marking (white/gray/black) — gray re-visit = back edge = cycle
//   - For each cycle, suggest breaking the *last* edge on the cycle path (mirrors task-master
//     `findCycles` convention in claude-task-master/scripts/modules/utils.js:1468)
//
// Zero external deps.

import fs from 'node:fs';

const NW_HEADER_RE = /^##\s+\d+[^（(]*[（(](NW-\d+)[）)]/;
const DEPS_BULLET_RE = /^[-*]\s+\*\*deps\*\*\s*:\s*\[([^\]]*)\]/;
const NW_ID_RE = /NW-\d+/g;

function parseArgs(argv) {
  const args = { json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--manifest') args.manifest = argv[++i];
    else if (a === '--json') args.json = true;
    else if (a === '-h' || a === '--help') {
      console.log('Usage: node dag-validator.mjs --manifest <path> [--json]');
      process.exit(0);
    }
  }
  return args;
}

function readOrFail(path) {
  if (!fs.existsSync(path)) throw new Error(`file not found: ${path}`);
  return fs.readFileSync(path, 'utf8');
}

// Parse [MANIFEST] markdown → Map<NW-id, {line, deps: string[]}>.
function buildGraph(content) {
  const graph = new Map();
  const lines = content.split('\n');
  let currentNw = null;

  for (let i = 0; i < lines.length; i++) {
    const headerMatch = lines[i].match(NW_HEADER_RE);
    if (headerMatch) {
      currentNw = headerMatch[1];
      if (!graph.has(currentNw)) graph.set(currentNw, { line: i + 1, deps: [] });
      continue;
    }
    // Reset on RU-* header (only NW-* participate in DAG)
    if (/^##\s+\d+[^（(]*[（(]RU-\d+[）)]/.test(lines[i])) {
      currentNw = null;
      continue;
    }
    if (!currentNw) continue;

    const depsMatch = lines[i].match(DEPS_BULLET_RE);
    if (depsMatch) {
      const ids = depsMatch[1].match(NW_ID_RE) || [];
      graph.get(currentNw).deps = ids;
    }
  }

  return graph;
}

// DFS three-color cycle detection. Returns array of cycles; each cycle = ordered NW-id list
// where the back-edge goes from the last element back to the first.
function findCycles(graph) {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map();
  for (const id of graph.keys()) color.set(id, WHITE);

  const cycles = [];
  const seen = new Set(); // dedupe cycles by sorted-id signature

  function dfs(node, path) {
    color.set(node, GRAY);
    path.push(node);

    const deps = graph.get(node)?.deps || [];
    for (const dep of deps) {
      // dep references unknown NW-* — report separately, skip cycle search
      if (!graph.has(dep)) continue;

      const c = color.get(dep);
      if (c === GRAY) {
        // back edge → cycle from path[indexOf(dep)] to current node
        const startIdx = path.indexOf(dep);
        const cyclePath = path.slice(startIdx);
        const sig = [...cyclePath].sort().join('>');
        if (!seen.has(sig)) {
          seen.add(sig);
          cycles.push(cyclePath);
        }
      } else if (c === WHITE) {
        dfs(dep, path);
      }
      // BLACK → fully explored, no cycle through this node
    }

    path.pop();
    color.set(node, BLACK);
  }

  for (const id of graph.keys()) {
    if (color.get(id) === WHITE) dfs(id, []);
  }

  return cycles;
}

// Find dep references that point to non-existent NW-* ids.
function findMissingDeps(graph) {
  const missing = [];
  for (const [id, info] of graph) {
    for (const dep of info.deps) {
      if (!graph.has(dep)) missing.push({ from: id, to: dep, line: info.line });
    }
  }
  return missing;
}

// For each cycle, suggest removing the *last edge* (path[N-1] → path[0]). This mirrors
// task-master's findCycles convention and produces deterministic, minimal-impact fixes.
function suggestFixes(cycles) {
  return cycles.map((cycle) => {
    const from = cycle[cycle.length - 1];
    const to = cycle[0];
    return {
      cycle,
      remove_edge: { from, to },
      hint: `从 ${from} 的 deps 中删除 ${to}（环上最后一条边）`,
    };
  });
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.manifest) {
    console.error('dag-validator: --manifest is required');
    process.exit(2);
  }

  let content;
  try {
    content = readOrFail(args.manifest);
  } catch (e) {
    console.error(`dag-validator: ${e.message}`);
    process.exit(2);
  }

  const graph = buildGraph(content);
  const totalNw = graph.size;
  const totalDeps = [...graph.values()].reduce((sum, g) => sum + g.deps.length, 0);

  // No deps declared anywhere → backward-compat pass-through
  if (totalDeps === 0) {
    if (args.json) {
      process.stdout.write(JSON.stringify({ ok: true, totalNw, totalDeps: 0, cycles: [], missing: [] }, null, 2) + '\n');
    } else {
      console.error(`✅ dag-validator PASS — no deps declared (${totalNw} NW-* components, backward-compat mode)`);
    }
    process.exit(0);
  }

  const cycles = findCycles(graph);
  const missing = findMissingDeps(graph);
  const fixes = suggestFixes(cycles);

  const report = {
    ok: cycles.length === 0 && missing.length === 0,
    totalNw,
    totalDeps,
    cycles: fixes,
    missing,
  };

  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  }

  if (report.ok) {
    if (!args.json) {
      console.error(`✅ dag-validator PASS — ${totalNw} NW-* / ${totalDeps} deps / 0 cycles`);
    }
    process.exit(0);
  }

  if (!args.json) {
    if (missing.length > 0) {
      console.error(`❌ dag-validator FAIL — ${missing.length} dangling dep reference(s):\n`);
      for (const m of missing) {
        console.error(`  [missing-dep] ${m.from} (line ${m.line}) → ${m.to} not found in [MANIFEST]`);
      }
      console.error('');
    }
    if (cycles.length > 0) {
      console.error(`❌ dag-validator FAIL — ${cycles.length} cycle(s) detected:\n`);
      for (const { cycle, remove_edge, hint } of fixes) {
        console.error(`  [cycle] ${cycle.join(' → ')} → ${cycle[0]}`);
        console.error(`    fix: ${hint}\n`);
      }
    }
  }

  process.exit(2);
}

main();
