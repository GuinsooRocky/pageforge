/**
 * 从 figma_raw.json 中提取模板生成所需的最小数据集
 * 用法: node extract-figma-essentials.js --ids 3:2602,3:2606,3:2608 [--raw <path>] [--out <path>]
 *
 * 输出 figma_essentials.json (< 5KB), 包含:
 *   - root: 根节点的 absoluteBoundingBox + backgroundColor
 *   - nodes: 各目标节点的 absoluteBoundingBox + _parentId + name (含所有中间父节点)
 *
 * 字段命名规则:
 *   - 与 Figma 原始字段同名 (absoluteBoundingBox, backgroundColor, name, type, id)
 *   - _parentId 为脚本附加字段 (Figma 原始节点无此字段), 加下划线前缀区分
 *
 * 目的: 替代直接读取 512KB figma_raw.json, 减少 LLM 上下文消耗
 */

const fs = require('fs');
const path = require('path');

// ─── 参数解析 ───
const args = process.argv.slice(2);
let ids = [];
let rawPath = path.join(process.cwd(), '.claude/docs/fig_meta/figma_raw.json');
let outPath = path.join(process.cwd(), '.claude/docs/fig_meta/figma_essentials.json');

for (let i = 0; i < args.length; i++) {
  const flag = args[i];
  if (flag === '--ids' || flag === '--raw' || flag === '--out') {
    if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
      console.error(`❌ 参数 ${flag} 缺少对应的值`);
      process.exit(1);
    }
    const val = args[++i];
    if (flag === '--ids') ids = val.split(',').map(s => s.trim()).filter(Boolean);
    else if (flag === '--raw') rawPath = val;
    else if (flag === '--out') outPath = val;
  }
}

if (ids.length === 0) {
  console.error('Usage: node extract-figma-essentials.js --ids 3:2602,3:2606 [--raw <path>] [--out <path>]');
  process.exit(1);
}

// ─── 读取 JSON ───
let raw;
try {
  raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
} catch (err) {
  if (err.code === 'ENOENT')             console.error(`❌ 文件不存在: ${rawPath}`);
  else if (err.code === 'EACCES')        console.error(`❌ 无读取权限: ${rawPath}`);
  else if (err instanceof SyntaxError)   console.error(`❌ JSON 解析失败 (文件格式错误): ${rawPath}`);
  else                                   console.error(`❌ 读取文件失败: ${err.message}`);
  process.exit(1);
}

// ─── 构建 id -> node 与 id -> parentId 映射 ───
const nodeMap = {};   // id -> 精简节点对象
const parentMap = {}; // id -> parentId (脚本内部使用)

function toHex(c) {
  const r = Math.round(c.r * 255).toString(16).padStart(2, '0');
  const g = Math.round(c.g * 255).toString(16).padStart(2, '0');
  const b = Math.round(c.b * 255).toString(16).padStart(2, '0');
  return '#' + r + g + b;
}

function toRgba(color) {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = color.a !== undefined ? parseFloat(color.a.toFixed(3)) : 1;
  return a < 1 ? `rgba(${r},${g},${b},${a})` : `rgb(${r},${g},${b})`;
}

/**
 * 将 Figma GRADIENT_LINEAR fill 转为 CSS linear-gradient()
 * Figma gradientHandlePositions: [start(0%), end(100%), width-control]
 * 角度推算: atan2(dy, dx) 转为 CSS "to <direction>" 或 deg
 */
function gradientLinearToCss(fill) {
  const handles = fill.gradientHandlePositions;
  if (!handles || handles.length < 2) return null;
  const [p0, p1] = handles;
  // CSS gradient 角度: 从 top 顺时针, 单位 deg
  // Figma 坐标系 y 轴向下, CSS 相同; Figma 0→1 归一化坐标
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  // CSS angle: 0deg = top-bottom, 顺时针为正
  const angleDeg = Math.round(Math.atan2(dx, -dy) * (180 / Math.PI));
  const stops = (fill.gradientStops || []).map(s => {
    const pos = Math.round(s.position * 100);
    return `${toRgba(s.color)} ${pos}%`;
  });
  return `linear-gradient(${angleDeg}deg, ${stops.join(', ')})`;
}

/**
 * 将 Figma GRADIENT_RADIAL fill 转为 CSS radial-gradient() (近似)
 */
function gradientRadialToCss(fill) {
  const handles = fill.gradientHandlePositions;
  // 中心点 (handle[0]), 归一化坐标 → 百分比
  const cx = handles && handles[0] ? Math.round(handles[0].x * 100) : 50;
  const cy = handles && handles[0] ? Math.round(handles[0].y * 100) : 50;
  const stops = (fill.gradientStops || []).map(s => {
    const pos = Math.round(s.position * 100);
    return `${toRgba(s.color)} ${pos}%`;
  });
  return `radial-gradient(ellipse at ${cx}% ${cy}%, ${stops.join(', ')})`;
}

/**
 * 将 Figma GRADIENT_ANGULAR fill 转为 CSS conic-gradient() (近似)
 */
function gradientAngularToCss(fill) {
  const handles = fill.gradientHandlePositions;
  const cx = handles && handles[0] ? Math.round(handles[0].x * 100) : 50;
  const cy = handles && handles[0] ? Math.round(handles[0].y * 100) : 50;
  const stops = (fill.gradientStops || []).map(s => {
    const pos = Math.round(s.position * 360);
    return `${toRgba(s.color)} ${pos}deg`;
  });
  return `conic-gradient(from 0deg at ${cx}% ${cy}%, ${stops.join(', ')})`;
}

function fillToCss(fill) {
  if (!fill || fill.visible === false) return null;
  switch (fill.type) {
    case 'SOLID':
      return toHex(fill.color);
    case 'GRADIENT_LINEAR':
      return gradientLinearToCss(fill);
    case 'GRADIENT_RADIAL':
      return gradientRadialToCss(fill);
    case 'GRADIENT_ANGULAR':
      return gradientAngularToCss(fill);
    default:
      return null;
  }
}

function traverse(node, parentId) {
  // 提取 backgroundColor:
  //   1. 优先取节点自身的 backgroundColor (纯色, Frame/Component 等类型)
  //   2. 否则从 fills 中按顺序提取 (支持 SOLID / 渐变)
  //   3. 多个 fill 叠加时, 模板用有效数 fill 的 CSS 表示 (数组)
  let backgroundColor = null;
  if (node.backgroundColor && node.backgroundColor.r !== undefined && node.backgroundColor.a > 0) {
    // backgroundColor 是纯色对象且不透明时才使用
    backgroundColor = toHex(node.backgroundColor);
  }

  if (!backgroundColor && node.fills && node.fills.length > 0) {
    const cssValues = node.fills
      .filter(f => f.visible !== false)
      .map(f => fillToCss(f))
      .filter(Boolean);
    if (cssValues.length === 1) {
      backgroundColor = cssValues[0];
    } else if (cssValues.length > 1) {
      // 多个 fill: 用数组保存, 模板生成时可逐层叠加
      backgroundColor = cssValues;
    }
  }

  nodeMap[node.id] = {
    id: node.id,
    name: node.name,
    type: node.type,
    absoluteBoundingBox: node.absoluteBoundingBox || null,
    ...(backgroundColor !== null ? { backgroundColor } : {}),
  };
  if (parentId) parentMap[node.id] = parentId;
  if (node.children) {
    for (const child of node.children) traverse(child, node.id);
  }
}

// figma_raw.json 顶层结构: { nodes: { "3:2585": { document: {...} } } }
if (!raw.nodes || typeof raw.nodes !== 'object') {
  console.error(`❌ figma_raw.json 结构不合法: 缺少 nodes 字段或 nodes 不是对象 (${rawPath})`);
  process.exit(1);
}
const rootKeys = Object.keys(raw.nodes);
if (rootKeys.length === 0) {
  console.error(`❌ figma_raw.json 中 nodes 为空, 无可处理的节点 (${rawPath})`);
  process.exit(1);
}

for (const key of rootKeys) {
  const entry = raw.nodes[key];
  if (!entry || !entry.document) {
    console.warn(`⚠ nodes["${key}"] 缺少 document 字段, 已跳过`);
    continue;
  }
  traverse(entry.document, null);
}

// ─── 确定根节点 ───
const rootId = rootKeys[0];
const rootNode = nodeMap[rootId];
if (!rootNode) {
  console.error(`❌ 无法确定根节点 [${rootId}], 请检查 figma_raw.json 结构`);
  process.exit(1);
}

// ─── 收集目标节点 + 用于中间父节点 ───
function getAncestors(id) {
  const chain = [];
  let cur = id;
  while (parentMap[cur]) {
    cur = parentMap[cur];
    chain.unshift(cur);
  }
  return chain;
}

const neededIds = new Set([rootId]);
for (const id of ids) {
  if (!nodeMap[id]) {
    console.warn(`⚠ 节点 ${id} 未找到, 已跳过`);
    continue;
  }
  neededIds.add(id);
  // 把所有中间父节点也纳入 (用于 margin-left 推算计算)
  for (const ancestor of getAncestors(id)) {
    neededIds.add(ancestor);
  }
}

// ─── 构建精简输出 ───
const essentialNodes = {};
for (const id of neededIds) {
  const n = nodeMap[id];
  if (!n) continue;
  essentialNodes[id] = {
    id: n.id,
    name: n.name,
    type: n.type,
    absoluteBoundingBox: n.absoluteBoundingBox,
    _parentId: parentMap[id] || null,  // 脚本附加字段, 非 Figma 原生
    ...(n.backgroundColor ? { backgroundColor: n.backgroundColor } : {}),
  };
}

const output = {
  _meta: {
    generatedAt: new Date().toISOString(),
    sourceFile: path.basename(rawPath),
    targetIds: ids,
    note: '此文件由 extract-figma-essentials.js 自动生成, 仅含模板生成所需的最小字段集, 请勿手动编辑',
  },
  root: {
    id: rootNode.id,
    name: rootNode.name,
    absoluteBoundingBox: rootNode.absoluteBoundingBox,
    backgroundColor: rootNode.backgroundColor || null,
  },
  nodes: essentialNodes,
};

try {
  const outDir = path.dirname(outPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
} catch (err) {
  if (err.code === 'ENOENT')      console.error(`❌ 输出路径不存在且无法创建: ${path.dirname(outPath)}`);
  else if (err.code === 'EACCES') console.error(`❌ 无写入权限: ${outPath}`);
  else if (err.code === 'ENOSPC') console.error(`❌ 磁盘空间不足, 无法写入: ${outPath}`);
  else                            console.error(`❌ 写入文件失败: ${err.message}`);
  process.exit(1);
}

const sizeKB = (Buffer.byteLength(JSON.stringify(output, null, 2)) / 1024).toFixed(1);
console.log(`✅ 提取完成: ${Object.keys(essentialNodes).length} 个节点 → ${outPath} (${sizeKB} KB)`);
console.log(`   原文件大小: ${(fs.statSync(rawPath).size / 1024).toFixed(0)} KB`);
console.log(`   压缩比: ${((1 - sizeKB / (fs.statSync(rawPath).size / 1024)) * 100).toFixed(0)}%`);
console.log('');
console.log('提取的节点: ');
for (const id of ids) {
  const n = essentialNodes[id];
  if (n) {
    const b = n.absoluteBoundingBox;
    console.log(`  ${id} "${n.name}" absoluteBoundingBox=(${b?.x},${b?.y}) ${b?.width}x${b?.height} _parentId=${n._parentId}`);
  }
}
