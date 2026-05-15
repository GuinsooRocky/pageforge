#!/usr/bin/env python3
"""
组件分析器
基于 Figma 设计树结构，分析推荐的前端组件架构

主要功能：
1. 推断每个节点的实现方式（图片 vs 组件）
2. 识别组件之间的关联关系
3. 生成结构化组件树
4. 生成实现建议
"""

import json
import argparse
from typing import List, Dict, Any, Tuple
from dataclasses import dataclass, field
from enum import Enum


class ComponentType(Enum):
    """组件类型"""
    IMAGE = "image"          # 使用图片实现
    COMPONENT = "component"  # 独立组件
    COMPOSITE = "composite"  # 混合(图片+组件)


class ImplementationType(Enum):
    """实现方式"""
    FULL_IMAGE = "整图"
    COMPONENT_WITH_BG = "背景图+组件"
    FULL_COMPONENT = "完全组件化"


@dataclass
class NodeInfo:
    """节点信息"""
    id: str
    name: str
    type: str
    depth: int
    bounds: Dict[str, float]
    children: List["NodeInfo"] = field(default_factory=list)
    fills: List = field(default_factory=list)

    # 分析结果
    component_type: ComponentType = ComponentType.COMPONENT
    implementation: ImplementationType = ImplementationType.FULL_COMPONENT
    reasons: List[str] = field(default_factory=list)
    has_dynamic_content: bool = False
    has_interaction: bool = False
    is_reusable: bool = False

    # 关联信息
    related_nodes: List[str] = field(default_factory=list)
    parent_component: str = None

    @property
    def area(self) -> float:
        """计算节点面积"""
        return self.bounds.get('width', 0) * self.bounds.get('height', 0)


class ComponentRuleEngine:
    """组件设计规则引擎"""

    # 交互关键词
    INTERACTION_KEYWORDS = [
        'button', 'btn', '按钮',
        'input', '输入', 'textarea',
        'select', '选择', 'dropdown',
        'checkbox', 'radio',
        'tab', 'tabs', '选项卡',
        'switch', '开关',
        'slider', '滑块',
        'modal', '弹窗', 'dialog',
        'menu', '菜单',
        'scroll', '滚动',
    ]

    # 动态内容关键词
    DYNAMIC_KEYWORDS = [
        'list', 'grid', '列表', '网格',
        'card', '卡片',
        'item', '条目',
        'avatar', '头像',
        'badge', '徽章',
        'count', 'number', '数字', '数量',
        'price', '价格',
        'name', 'title', '名称', '标题',
        'progress', '进度',
        'rank', '排行',
        'data', '数据',
    ]

    # 装饰性关键词
    DECORATIVE_KEYWORDS = [
        'background', 'bg', '背景',
        'decoration', '装饰',
        'illustration', '插图',
        'gradient', '渐变',
        'pattern', '图案',
        'banner',
    ]

    # 关联模式
    RELATED_PATTERNS = [
        # Hero Section: 预览 + 选择器
        (['preview', '预览', 'hero', '主视觉'], ['selector', 'tab', '选择', '选项']),
        # 操作组合：按钮 + 描述
        (['button', 'btn', '按钮'], ['description', 'desc', '说明']),
        # 列表项：标题 + 内容
        (['title', '标题'], ['content', '内容']),
    ]

    def should_use_image(self, node: NodeInfo) -> Tuple[bool, List[str]]:
        """判断是否应该使用图片实现"""
        reasons = []
        name_lower = node.name.lower()

        # 规则1：Banner/KV/Hero 区域的整体
        if any(kw in name_lower for kw in ['banner', 'kv', 'hero']) and \
           not any(kw in name_lower for kw in ['button', 'btn', '按钮']):
            # 如果是大型banner/hero，且没有交互元素
            if node.area > 50000:  # 大于 500x100
                reasons.append("大型KV或视觉区域，适合使用整图")
                return True, reasons

        return False, reasons

    def has_interaction(self, node: NodeInfo) -> Tuple[bool, List[str]]:
        """判断是否有交互"""
        reasons = []
        name_lower = node.name.lower()

        for kw in self.INTERACTION_KEYWORDS:
            if kw in name_lower or kw in node.name:
                reasons.append(f"包含交互关键词: {kw}")
                return True, reasons

        return False, reasons

    def has_dynamic_content(self, node: NodeInfo) -> Tuple[bool, List[str]]:
        """判断是否有动态内容"""
        reasons = []
        name_lower = node.name.lower()

        # 列表/网格通常是动态内容
        if any(kw in name_lower for kw in ['list', 'grid', '列表', '网格']):
            reasons.append("列表/网格类组件，包含动态数据")
            return True, reasons

        # 检查动态关键词
        for kw in self.DYNAMIC_KEYWORDS:
            if kw in name_lower or kw in node.name:
                reasons.append(f"包含动态内容关键词: {kw}")
                return True, reasons

        # 数据型节点
        if node.type == "INSTANCE":
            reasons.append("是组件实例，可能包含动态数据")
            return True, reasons

        return False, reasons

    def is_reusable(self, node: NodeInfo, all_nodes: List[NodeInfo]) -> Tuple[bool, int]:
        """判断是否可复用"""
        # 查找同名节点
        same_name_nodes = [n for n in all_nodes if n.name == node.name and n.id != node.id]
        count = len(same_name_nodes) + 1

        if count > 1:
            return True, count

        # 检查是否是组件实例
        if node.type == "INSTANCE":
            return True, 1

        return False, 1

    def analyze_node(self, node: NodeInfo, all_nodes: List[NodeInfo]) -> None:
        """分析单个节点"""
        # 判断是否使用图片
        use_image, image_reasons = self.should_use_image(node)

        # 判断是否有交互
        has_interaction, interaction_reasons = self.has_interaction(node)
        node.has_interaction = has_interaction

        # 判断是否有动态内容
        has_dynamic, dynamic_reasons = self.has_dynamic_content(node)
        node.has_dynamic_content = has_dynamic

        # 判断是否可复用
        is_reusable, count = self.is_reusable(node, all_nodes)
        node.is_reusable = is_reusable

        # 综合判断实现方式
        if use_image and not has_interaction and not has_dynamic:
            node.component_type = ComponentType.IMAGE
            node.implementation = ImplementationType.FULL_IMAGE
            node.reasons = image_reasons
        elif use_image and (has_interaction or has_dynamic):
            node.component_type = ComponentType.COMPOSITE
            node.implementation = ImplementationType.COMPONENT_WITH_BG
            node.reasons = image_reasons + interaction_reasons + dynamic_reasons
            node.reasons.append("视觉复杂但有交互/动态内容，建议背景图+组件")
        else:
            node.component_type = ComponentType.COMPONENT
            node.implementation = ImplementationType.FULL_COMPONENT
            node.reasons = interaction_reasons + dynamic_reasons
            if is_reusable:
                node.reasons.append(f"可复用组件（出现 {count} 次）")
            if not node.reasons:
                node.reasons.append("默认使用组件实现")


class RelationshipAnalyzer:
    """节点关联关系分析器"""

    def __init__(self, rules: ComponentRuleEngine):
        self.rules = rules
        self.node_semantics: Dict[str, str] = {}

    def find_related_nodes(self, nodes: List[NodeInfo]) -> None:
        """查找节点之间的关联关系"""
        # 第一步：推断每个节点的语义类型
        self._infer_node_semantics(nodes)

        # 按深度分组
        by_depth = {}
        for node in nodes:
            if node.depth not in by_depth:
                by_depth[node.depth] = []
            by_depth[node.depth].append(node)

        # 分析每一层级的关联
        for depth in sorted(by_depth.keys()):
            depth_nodes = by_depth[depth]

            # 识别兄弟组件之间的关联
            self._identify_sibling_relations(depth_nodes)

            # 识别父子组件关联（假设相邻 depth 的关系）
            self._identify_parent_child_relations(depth_nodes, by_depth.get(depth - 1, []))

    def _infer_node_semantics(self, nodes: List[NodeInfo]) -> None:
        """推断节点的语义类型（属于子节点自身判断）"""
        # 构建父子关系
        children_map = {}
        for node in nodes:
            children_map[node.id] = []

        for node in nodes:
            for other in nodes:
                if other.id == node.id:
                    continue
                if self._is_within(other, node) and other.depth == node.depth + 1:
                    children_map[node.id].append(other)

        # 推断每个节点的语义
        for node in nodes:
            semantics = []
            name_lower = node.name.lower()

            # 基于名称匹配
            if any(kw in name_lower for kw in ['preview', '预览', 'hero', 'kv']):
                semantics.append('preview')
            elif any(kw in name_lower for kw in ['selector', 'tab', '选择', '选项']):
                semantics.append('selector')
            elif any(kw in name_lower for kw in ['action', 'button', 'btn', '按钮']):
                semantics.append('action')
            elif any(kw in name_lower for kw in ['list', 'grid', '列表', '网格']):
                semantics.append('list')
            elif any(kw in name_lower for kw in ['gift', '礼物']):
                semantics.append('gift')

            # 基于子节点推断
            children = children_map.get(node.id, [])
            if children:
                child_semantics = []
                for child in children:
                    child_name_lower = child.name.lower()
                    if any(kw in child_name_lower for kw in ['preview', '预览']):
                        child_semantics.append('preview')
                    elif any(kw in child_name_lower for kw in ['selector', 'tab', '选择']):
                        child_semantics.append('selector')
                    elif any(kw in child_name_lower for kw in ['action', 'button', '按钮']):
                        child_semantics.append('action')

                # 如果子节点中同时有 preview + selector + action，识别为 hero_section
                if 'preview' in child_semantics and 'selector' in child_semantics and 'action' in child_semantics:
                    semantics.append('hero_section')

            self.node_semantics[node.id] = semantics

    def _identify_sibling_relations(self, depth_nodes: List[NodeInfo]) -> None:
        """识别同级节点之间的关联（如 preview ↔ selector）"""
        for i, node1 in enumerate(depth_nodes):
            for node2 in depth_nodes[i + 1:]:
                # 检查空间位置相近
                if self._is_spatially_near(node1, node2):
                    # 检查名称模式匹配
                    if self._match_pattern(node1.name, node2.name):
                        node1.related_nodes.append(node2.id)
                        node2.related_nodes.append(node1.id)

    def _identify_parent_child_relations(
        self,
        child_nodes: List[NodeInfo],
        parent_nodes: List[NodeInfo],
    ) -> None:
        """识别父子节点关联"""
        for child in child_nodes:
            for parent in parent_nodes:
                if self._is_within(child, parent):
                    child.parent_component = parent.id

    def _is_within(self, child: NodeInfo, parent: NodeInfo) -> bool:
        """判断 child 是否在 parent 范围内"""
        cb = child.bounds
        pb = parent.bounds
        return (
            cb.get('x', 0) >= pb.get('x', 0)
            and cb.get('y', 0) >= pb.get('y', 0)
            and cb.get('x', 0) + cb.get('width', 0) <= pb.get('x', 0) + pb.get('width', 0)
            and cb.get('y', 0) + cb.get('height', 0) <= pb.get('y', 0) + pb.get('height', 0)
        )

    def _is_spatially_near(self, node1: NodeInfo, node2: NodeInfo) -> bool:
        """判断两个节点空间上相邻"""
        b1 = node1.bounds
        b2 = node2.bounds
        # 简单判断：水平或垂直距离小于阈值
        h_dist = abs(b1.get('x', 0) + b1.get('width', 0) / 2 - b2.get('x', 0) - b2.get('width', 0) / 2)
        v_dist = abs(b1.get('y', 0) + b1.get('height', 0) / 2 - b2.get('y', 0) - b2.get('height', 0) / 2)
        return h_dist < 200 and v_dist < 200

    def _match_pattern(self, name1: str, name2: str) -> bool:
        """检查两个名称是否匹配关联模式"""
        n1_lower = name1.lower()
        n2_lower = name2.lower()
        for pattern_a, pattern_b in self.rules.RELATED_PATTERNS:
            if (any(kw in n1_lower for kw in pattern_a) and any(kw in n2_lower for kw in pattern_b)) or \
               (any(kw in n2_lower for kw in pattern_a) and any(kw in n1_lower for kw in pattern_b)):
                return True
        return False


class ComponentArchitectureGenerator:
    """组件架构报告生成器"""

    def generate_report(self, nodes: List[NodeInfo]) -> str:
        """生成完整的组件架构报告"""
        report = []
        report.append("=" * 60)
        report.append("组件架构分析报告")
        report.append("=" * 60)
        report.append("")

        # 1. 实现方式建议
        report.append("一、实现方式建议")
        report.append("-" * 60)
        impl_lines = self._generate_implementation_suggestions(nodes)
        report.extend(impl_lines)
        report.append("")

        # 2. 组件层级树
        report.append("二、组件层级结构")
        report.append("-" * 60)
        hierarchy_lines = self._generate_component_hierarchy(nodes)
        report.extend(hierarchy_lines)
        report.append("")

        # 3. 关联关系
        report.append("三、组件关联关系")
        report.append("-" * 60)
        relation_lines = self._generate_relations(nodes)
        report.extend(relation_lines)
        report.append("")

        # 4. 可复用组件
        report.append("四、可复用组件")
        report.append("-" * 60)
        reusable_lines = self._generate_reusable_components(nodes)
        report.extend(reusable_lines)
        report.append("")

        return "\n".join(report)

    def _generate_implementation_suggestions(self, nodes: List[NodeInfo]) -> List[str]:
        """生成实现方式建议"""
        lines = []
        # 按深度分组
        by_depth = {}
        for node in nodes:
            if node.depth not in by_depth:
                by_depth[node.depth] = []
            by_depth[node.depth].append(node)

        for depth in sorted(by_depth.keys()):
            lines.append(f"\n第 {depth} 层 ({len(by_depth[depth])} 个节点):")
            for node in by_depth[depth]:
                icon = self._get_icon(node)
                impl = node.implementation.value
                lines.append(f"  {icon} [{node.name}] → {impl}")
                if node.reasons:
                    lines.append(f"     理由: {'; '.join(node.reasons)}")

                # 实现细节建议
                if node.implementation == ImplementationType.FULL_IMAGE:
                    lines.append(f"     建议: 直接使用导出的图片资源")
                elif node.implementation == ImplementationType.COMPONENT_WITH_BG:
                    lines.append(f"     建议: 背景图 + 交互元素组件化")
                else:
                    lines.append(f"     建议: 完全组件化实现")

        return lines

    def _generate_component_hierarchy(self, nodes: List[NodeInfo]) -> List[str]:
        """生成组件层级树"""
        lines = []
        # 只显示需要组件化的节点
        component_nodes = [n for n in nodes if n.component_type != ComponentType.IMAGE]

        # 构建层级
        by_depth = {}
        for node in component_nodes:
            if node.depth not in by_depth:
                by_depth[node.depth] = []
            by_depth[node.depth].append(node)

        for depth in sorted(by_depth.keys()):
            indent = "  " * depth
            for node in by_depth[depth]:
                lines.append(f"{indent}└─ {node.name}")

        return lines

    def _generate_relations(self, nodes: List[NodeInfo]) -> List[str]:
        """生成关联关系报告"""
        lines = []
        groups = self._find_related_groups(nodes)

        if not groups:
            lines.append("  未发现明显的组件关联关系")
            return lines

        for i, group in enumerate(groups, 1):
            lines.append(f"\n关联组 {i}:")
            for node_id in group:
                node = next((n for n in nodes if n.id == node_id), None)
                if node:
                    lines.append(f"  - {node.name}")
            lines.append(f"  → 建议放在同一父组件中，共享状态")

        return lines

    def _find_related_groups(self, nodes: List[NodeInfo]) -> List[List[str]]:
        """通过并查集找出关联组"""
        # 简单的连通分量
        parent_map = {n.id: n.id for n in nodes}

        def find(x):
            while parent_map[x] != x:
                parent_map[x] = parent_map[parent_map[x]]
                x = parent_map[x]
            return x

        def union(a, b):
            ra, rb = find(a), find(b)
            if ra != rb:
                parent_map[ra] = rb

        for node in nodes:
            for related in node.related_nodes:
                if related in parent_map:
                    union(node.id, related)

        # 收集组
        groups = {}
        for node_id in parent_map:
            root = find(node_id)
            if root not in groups:
                groups[root] = []
            groups[root].append(node_id)

        # 只返回有关联的组（>1 个节点）
        return [g for g in groups.values() if len(g) > 1]

    def _generate_reusable_components(self, nodes: List[NodeInfo]) -> List[str]:
        """生成可复用组件列表"""
        lines = []
        reusable = [n for n in nodes if n.is_reusable]

        if not reusable:
            lines.append("  未发现明显的可复用组件")
            return lines

        # 按名称去重
        seen = set()
        unique_reusable = []
        for node in reusable:
            if node.name not in seen:
                seen.add(node.name)
                unique_reusable.append(node)

        for node in unique_reusable:
            count = sum(1 for n in nodes if n.name == node.name)
            lines.append(f"  - {node.name} (出现 {count} 次)")

        return lines

    def _get_icon(self, node: NodeInfo) -> str:
        """根据节点类型返回图标"""
        if node.component_type == ComponentType.IMAGE:
            return "🖼"
        elif node.component_type == ComponentType.COMPOSITE:
            return "🎨"
        else:
            return "📐"


def parse_figma_nodes(figma_data: Dict[str, Any], max_depth: int = 3) -> List[NodeInfo]:
    """解析 Figma 数据并提取所有节点"""
    nodes = []

    for node_id, node_data in figma_data.get("nodes", {}).items():
        doc = node_data.get("document", {})
        _extract_nodes_recursive(doc, 0, max_depth, nodes)

    return nodes


def _extract_nodes_recursive(
    node: Dict,
    depth: int,
    max_depth: int,
    result: List[NodeInfo],
) -> None:
    """递归提取节点"""
    if depth > max_depth:
        return

    bounds = node.get("absoluteBoundingBox", {})
    if not bounds:
        return

    node_info = NodeInfo(
        id=node.get("id", ""),
        name=node.get("name", "Unknown"),
        type=node.get("type", "Unknown"),
        depth=depth,
        bounds=bounds,
        fills=node.get("fills", []),
    )
    result.append(node_info)

    # 递归处理子节点
    for child in node.get("children", []):
        _extract_nodes_recursive(child, depth + 1, max_depth, result)


def main():
    parser = argparse.ArgumentParser(description="组件架构分析器")
    parser.add_argument("-f", "--figma-data", required=True, help="Figma 数据 JSON 文件")
    parser.add_argument("-o", "--output", help="输出文件路径")
    parser.add_argument("--depth", type=int, default=3, help="分析深度（默认：3）")

    args = parser.parse_args()

    # 加载数据
    with open(args.figma_data, 'r', encoding='utf-8') as f:
        figma_data = json.load(f)

    # 解析节点
    nodes = parse_figma_nodes(figma_data, args.depth)
    print(f"📊 解析了 {len(nodes)} 个节点")

    # 应用规则引擎
    rule_engine = ComponentRuleEngine()
    for node in nodes:
        rule_engine.analyze_node(node, nodes)
    print(f"📊 规则应用完毕")

    # 关联分析
    relationship_analyzer = RelationshipAnalyzer(rule_engine)
    relationship_analyzer.find_related_nodes(nodes)
    print(f"📊 完成关联分析")

    # 生成报告
    generator = ComponentArchitectureGenerator()
    report = generator.generate_report(nodes)

    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(report)
        print(f"📊 报告已保存：{args.output}")
    else:
        print(report)


if __name__ == "__main__":
    main()
