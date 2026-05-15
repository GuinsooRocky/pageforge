/**
 * 从 figma_raw.json 中提取指定节点的父子关系树
 * 用法: node extract-node-hierarchy.js --ids 3:2602,3:2606,3:2608 [--raw <path>]
 *
 * 输出: 每个节点的 id、name、parent_id、parent_name、depth
 * 用于 m0-template-gen 技能步骤4 节点层级校验
 */

const fs = require('fs');
const path = require('path');

// ---- 参数解析 ----
const args = process.argv.slice(2);
let ids = [];
let rawPath = path.join(process.cwd(), '.claude/docs/fig_meta/figma_raw.json');

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--ids') ids = args[++i].split(',').map(s => s.trim());
  if (args[i] === '--raw') rawPath = args[++i];
}

if (ids.length === 0) {
  console.error('Usage: node extract-node-hierarchy.js --ids 3:2602,3:2606 [--raw <path>]');
  process.exit(1);
}

// ---- 读取 JSON ----
const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));

// ---- 构建 id -> node 与 id -> parentId 映射 ----
const nodeMap = {};   // id -> { id, name, type }
const parentMap = {}; // id -> parentId

function traverse(node, parentId) {
  nodeMap[node.id] = { id: node.id, name: node.name, type: node.type };
  if (parentId) parentMap[node.id] = parentId;
  if (node.children) {
    for (const child of node.children) traverse(child, node.id);
  }
}

// figma_raw.json 顶层结构: { nodes: { "3:2585": { document: {...} } } }
for (const key of Object.keys(raw.nodes || {})) {
  traverse(raw.nodes[key].document, null);
}

// ---- 获取祖先链 ----
function getAncestors(id) {
  const chain = [];
  let cur = id;
  while (parentMap[cur]) {
    cur = parentMap[cur];
    chain.unshift(cur);
  }
  return chain;
}

// ---- 输出结果 ----
console.log('\n=== 节点层级校验结果 ===\n');

const result = [];
for (const id of ids) {
  const node = nodeMap[id];
  if (!node) {
    console.warn(`⚠ 节点 ${id} 未找到，请检查 id 是否正确`);
    continue;
  }
  const parentId = parentMap[id] || null;
  const parent = parentId ? nodeMap[parentId] : null;
  const ancestors = getAncestors(id);
  const depth = ancestors.length + 1;

  result.push({ id, name: node.name, type: node.type, parentId, parentName: parent?.name, depth });

  console.log(`节点: ${id} "${node.name}" (${node.type})`);
  console.log(`  深度: 第${depth}层`);
  console.log(`  父节点: ${parentId ? `${parentId} "${parent?.name}"` : '(无, 根节点)'}`);
  console.log(`  祖先链: ${ancestors.length ? ancestors.map(a => `${a}(${nodeMap[a]?.name})`).join(' → ') : '(直接在根下)'}`);
  console.log('');
}

// ---- 输出嵌套关系摘要（用于 Vue 模板生成参考）----
console.log('=== 占位嵌套关系摘要 ===\n');

// 只看 ids 中相互之间的父子关系
const idSet = new Set(ids);
for (const id of ids) {
  const parentId = parentMap[id];
  if (parentId && idSet.has(parentId)) {
    const node = nodeMap[id];
    const parent = nodeMap[parentId];
    console.log(`✅ ${id}("${node.name}") 是 ${parentId}("${parent.name}") 的子节点`);
    console.log(`   → Vue 模板中 placeholder-${id.replace(':', '_')} 必须嵌套在 placeholder-${parentId.replace(':', '_')} 内部`);
  }
}
console.log('');
