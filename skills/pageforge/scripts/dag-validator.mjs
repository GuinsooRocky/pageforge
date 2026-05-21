#!/usr/bin/env node
// DAG Validator - detect & report cycles + dangling refs in NW-* component dependencies
// inside [MANIFEST]. Single responsibility: graph validation only.
//
// Designed to be called after step 2 (visual-analyzer) and step 3 (tech-solution-generator)
// once NW-* components declare dependencies on each other.
//
// Two `deps` shapes are accepted:
//   (a) legacy flat     : `- **deps**: [NW-002, NW-005]` — cycle-detection only, no kind/name.
//   (b) structured block: `- **deps**:` with a nested `provides:` line + `consumes:` list of
//       `{ from: NW-Y, kind: render|type|callback|atom, name: ... }` items.
//   tech-solution-generator (step 3) emits (b) for every NW-*; nw-slicer reads the same
//   `consumes` block directly for B7 import 白名单（旧 edges.json 体系 2026-05-21 已砍）。
//
// Backward-compatible: if [MANIFEST] contains zero `deps` bullets, validator passes silently.
//
// Usage:
//   node dag-validator.mjs --manifest <path> [--json]
//
// Output:
//   exit 0 : DAG is acyclic (or no deps declared)
//   exit 2 : cycles / dangling deps found; stderr lists each + suggested edge to break.
//   --json : machine-readable report to stdout
//
// Algorithm:
//   - Parse [MANIFEST] for `## N {name}（NW-xxx）` headers + subsequent `- **deps**:` block
//   - Build directed graph: NW-id → { provides, consumes:[{from,kind,name}] }
//   - DFS with three-color marking (white/gray/black) — gray re-visit = back edge = cycle
//   - For each cycle, suggest breaking the *last* edge on the cycle path (mirrors task-master
//     `findCycles` convention in claude-task-master/scripts/modules/utils.js:1468)
//
// Zero external deps (node built-ins only).

import fs from 'node:fs';

const NW_HEADER_RE = /^##\s+\d+[^（(]*[（(](NW-\d+)[）)]/;
const RU_HEADER_RE = /^##\s+\d+[^（(]*[（(]RU-\d+[）)]/;
const DEPS_BULLET_RE = /^([-*])\s+\*\*deps\*\*\s*:\s*(.*)$/;
const FLAT_DEPS_RE = /^\[([^\]]*)\]/;
const NW_ID_RE = /NW-\d+/g;

function parseArgs(argv) {
  const args = { json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--manifest') args.manifest = argv[++i];
    else if (a === '--emit-edges') argv[++i]; // 2026-05-21 砍 edges 体系；参数容忍但忽略（向后兼容旧调用）
    else if (a === '--emit-layers') args.emitLayers = argv[++i]; // 主题 C：输出拓扑分层供 §B.5 调度
    else if (a === '--json') args.json = true;
    else if (a === '-h' || a === '--help') {
      console.log('Usage: node dag-validator.mjs --manifest <path> [--emit-layers <out>] [--json]');
      process.exit(0);
    }
  }
  return args;
}

function readOrFail(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`file not found: ${filePath}`);
  return fs.readFileSync(filePath, 'utf8');
}

// Indentation depth of a markdown list line (spaces before the `-`/`*` marker).
function indentOf(line) {
  const m = line.match(/^(\s*)[-*]\s/);
  return m ? m[1].length : -1;
}

// Parse a `provides: { component: X, types: [A, B], atoms: [C] }`-ish fragment.
// Tolerant: accepts braces or not, missing keys, empty arrays.
function parseProvides(text) {
  const out = {};
  const comp = text.match(/component\s*:\s*([A-Za-z_$][\w$]*)/);
  if (comp) out.component = comp[1];
  const typesM = text.match(/types\s*:\s*\[([^\]]*)\]/);
  if (typesM) {
    const t = typesM[1].split(',').map((s) => s.trim()).filter(Boolean);
    if (t.length) out.types = t;
  }
  const atomsM = text.match(/atoms\s*:\s*\[([^\]]*)\]/);
  if (atomsM) {
    const a = atomsM[1].split(',').map((s) => s.trim()).filter(Boolean);
    if (a.length) out.atoms = a;
  }
  return out;
}

// Parse one `{ from: NW-016, kind: type, name: WorldCardDraft }` consume item.
function parseConsumeItem(text) {
  const from = text.match(/from\s*:\s*(NW-\d+)/);
  const kind = text.match(/kind\s*:\s*(render|type|callback|atom)/);
  const name = text.match(/name\s*:\s*([^,}]+?)\s*[},]/) || text.match(/name\s*:\s*([^,}]+)$/);
  if (!from) return null;
  return {
    from: from[1],
    kind: kind ? kind[1] : 'unknown',
    name: name ? name[1].trim() : '',
  };
}

// Parse [MANIFEST] markdown → Map<NW-id, {line, provides, consumes:[{from,kind,name}]}>.
// Handles both legacy flat `- **deps**: [..]` and the structured nested block.
function buildGraph(content) {
  const graph = new Map();
  const lines = content.split('\n');
  let currentNw = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const headerMatch = line.match(NW_HEADER_RE);
    if (headerMatch) {
      currentNw = headerMatch[1];
      if (!graph.has(currentNw)) {
        graph.set(currentNw, { line: i + 1, provides: {}, consumes: [] });
      }
      continue;
    }
    if (RU_HEADER_RE.test(line)) {
      currentNw = null;
      continue;
    }
    if (!currentNw) continue;

    const depsMatch = line.match(DEPS_BULLET_RE);
    if (!depsMatch) continue;

    const node = graph.get(currentNw);
    const rest = depsMatch[2].trim();

    // ---- shape (a): legacy flat — `- **deps**: [NW-002, NW-005]`
    const flat = rest.match(FLAT_DEPS_RE);
    if (flat) {
      const ids = flat[1].match(NW_ID_RE) || [];
      for (const id of ids) {
        node.consumes.push({ from: id, kind: 'unknown', name: '' });
      }
      continue;
    }

    // ---- shape (b): structured nested block.
    // Scan following lines deeper-indented than the `- **deps**:` bullet.
    const baseIndent = indentOf(line);
    for (let j = i + 1; j < lines.length; j++) {
      const sub = lines[j];
      if (sub.trim() === '') continue;
      const subIndent = indentOf(sub);
      // a non-list deeper line (e.g. wrapped text) — skip but keep scanning
      if (subIndent === -1) {
        if (/^\s/.test(sub) && sub.length - sub.trimStart().length > baseIndent) continue;
        break;
      }
      if (subIndent <= baseIndent) break; // dedented out of the deps block

      const body = sub.trim().replace(/^[-*]\s+/, '');
      if (/^provides\s*:/.test(body)) {
        Object.assign(node.provides, parseProvides(body));
      } else if (/^consumes\s*:/.test(body)) {
        // consume items may be inline on this line or nested deeper — handled by next iters
        const inline = body.replace(/^consumes\s*:\s*/, '');
        if (inline) {
          const item = parseConsumeItem(inline);
          if (item) node.consumes.push(item);
        }
      } else if (/from\s*:/.test(body)) {
        const item = parseConsumeItem(body);
        if (item) node.consumes.push(item);
      }
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
  const seen = new Set();

  function depsOf(node) {
    return (graph.get(node)?.consumes || []).map((c) => c.from);
  }

  function dfs(node, path) {
    color.set(node, GRAY);
    path.push(node);

    for (const dep of depsOf(node)) {
      if (!graph.has(dep)) continue; // unknown ref — reported by findMissingDeps
      const c = color.get(dep);
      if (c === GRAY) {
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
    }

    path.pop();
    color.set(node, BLACK);
  }

  for (const id of graph.keys()) {
    if (color.get(id) === WHITE) dfs(id, []);
  }

  return cycles;
}

// Find consume.from references that point to non-existent NW-* ids.
function findMissingDeps(graph) {
  const missing = [];
  for (const [id, info] of graph) {
    for (const c of info.consumes) {
      if (!graph.has(c.from)) {
        missing.push({ from: id, to: c.from, kind: c.kind, name: c.name, line: info.line });
      }
    }
  }
  return missing;
}

// For each cycle, suggest removing the *last edge* (path[N-1] → path[0]).
function suggestFixes(cycles) {
  return cycles.map((cycle) => {
    const from = cycle[cycle.length - 1];
    const to = cycle[0];
    return {
      cycle,
      remove_edge: { from, to },
      hint: `从 ${from} 的 deps.consumes 中删除指向 ${to} 的条目（环上最后一条边）`,
    };
  });
}

// 主题 C — 拓扑分层：layer[node] = max(layer of its deps) + 1（无 deps = layer 0）。
// owner（被依赖方）在浅层、consumer 在深层。给主 Agent §B.5 调度用：同层并行、层间串行。
// 仅在无环时有意义（main 仅在 cycles===0 时调用）。
function computeLayers(graph) {
  const memo = new Map();
  function depth(id, stack) {
    if (memo.has(id)) return memo.get(id);
    if (stack.has(id)) return 0; // 防御性环守卫（正常不会触发，调用前已确认无环）
    stack.add(id);
    let d = 0;
    for (const c of graph.get(id)?.consumes || []) {
      if (graph.has(c.from)) d = Math.max(d, depth(c.from, stack) + 1);
    }
    stack.delete(id);
    memo.set(id, d);
    return d;
  }
  const layers = [];
  for (const id of graph.keys()) {
    const d = depth(id, new Set());
    (layers[d] ||= []).push(id);
  }
  return layers.map((l) => (l || []).slice().sort());
}

function emitLayersIfRequested(args, graph) {
  if (!args.emitLayers) return;
  const layers = computeLayers(graph);
  const payload = { layer_count: layers.length, layers };
  fs.writeFileSync(args.emitLayers, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.error(`   layers: ${layers.length} 层 → ${args.emitLayers}（主 Agent §B.5 据此分波：同层并行 / 层间串行）`);
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
  const totalDeps = [...graph.values()].reduce((sum, g) => sum + g.consumes.length, 0);

  // No deps declared anywhere → backward-compat pass-through.
  if (totalDeps === 0) {
    emitLayersIfRequested(args, graph); // 无 deps → 全部 layer 0（单层全并行）
    if (args.json) {
      process.stdout.write(JSON.stringify(
        { ok: true, totalNw, totalDeps: 0, cycles: [], missing: [] },
        null, 2) + '\n');
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
    emitLayersIfRequested(args, graph); // 无环 → 输出拓扑分层供 §B.5 调度
    if (!args.json) {
      console.error(`✅ dag-validator PASS — ${totalNw} NW-* / ${totalDeps} deps / 0 cycles`);
    }
    process.exit(0);
  }

  if (!args.json) {
    if (missing.length > 0) {
      console.error(`❌ dag-validator FAIL — ${missing.length} dangling dep reference(s):\n`);
      for (const m of missing) {
        const tag = m.kind && m.kind !== 'unknown' ? ` [${m.kind}:${m.name}]` : '';
        console.error(`  [missing-dep] ${m.from} (line ${m.line}) → ${m.to}${tag} not found in [MANIFEST]`);
      }
      console.error('');
    }
    if (cycles.length > 0) {
      console.error(`❌ dag-validator FAIL — ${cycles.length} cycle(s) detected:\n`);
      for (const { cycle, hint } of fixes) {
        console.error(`  [cycle] ${cycle.join(' → ')} → ${cycle[0]}`);
        console.error(`    fix: ${hint}\n`);
      }
    }
  }

  process.exit(2);
}

main();
