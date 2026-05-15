#!/usr/bin/env python3
"""
Figma Design Tree Parser
解析 Figma API 返回的设计树结构，提取组件层级和样式信息

Usage:
  curl -s -H "X-Figma-Token: YOUR_TOKEN" \
    "https://api.figma.com/v1/files/{file_key}/nodes?ids={node_id}" | \
    python3 parse_figma_tree.py

或者:
  python3 parse_figma_tree.py --file input.json
"""

import json
import sys
import argparse


def rgb_to_hex(r, g, b):
    """将 RGB 值 (0-1) 转换为十六进制颜色"""
    return f"#{int(r * 255):02x}{int(g * 255):02x}{int(b * 255):02x}"


def extract_fill_info(fills):
    """提取填充信息"""
    if not fills or len(fills) == 0:
        return ""

    fill = fills[0]
    fill_type = fill.get("type", "")

    if fill_type == "SOLID":
        color = fill.get("color", {})
        r = color.get("r", 0)
        g = color.get("g", 0)
        b = color.get("b", 0)
        a = color.get("a", 1)
        hex_color = rgb_to_hex(r, g, b)
        if a < 1:
            return f"[SOLID] {hex_color}, opacity: {a:.2f}"
        return f"[SOLID] {hex_color}"
    elif fill_type == "IMAGE":
        return "[IMAGE]"
    elif "GRADIENT" in fill_type:
        return f"[{fill_type}]"

    return ""


def extract_stroke_info(strokes, stroke_weight):
    """提取边框信息"""
    if not strokes or len(strokes) == 0:
        return ""

    stroke = strokes[0]
    stroke_type = stroke.get("type", "")

    if stroke_type == "SOLID":
        color = stroke.get("color", {})
        r = color.get("r", 0)
        g = color.get("g", 0)
        b = color.get("b", 0)
        hex_color = rgb_to_hex(r, g, b)
        return f"[stroke: {hex_color}, {stroke_weight}px]"

    return ""


def extract_text_info(node):
    """提取文本节点信息"""
    if node.get("type") != "TEXT":
        return ""

    characters = node.get("characters", "")
    style = node.get("style", {})
    font_family = style.get("fontFamily", "")
    font_size = style.get("fontSize", 0)
    font_weight = style.get("fontWeight", 400)

    text_preview = characters[:20] + "..." if len(characters) > 20 else characters
    return f'["{text_preview}"] ({font_family}, {font_size}px, w{font_weight})'


def extract_node_info(node, depth=0, output_lines=None):
    """提取节点详细信息"""
    if output_lines is None:
        output_lines = []

    indent = "  " * depth
    name = node.get("name", "Unknown")
    node_type = node.get("type", "Unknown")
    node_id = node.get("id", "")

    # 获取尺寸信息
    bounds = node.get("absoluteBoundingBox", {})
    width = bounds.get("width", 0)
    height = bounds.get("height", 0)
    x = bounds.get("x", 0)
    y = bounds.get("y", 0)

    # 获取样式信息
    fills = node.get("fills", [])
    strokes = node.get("strokes", [])
    stroke_weight = node.get("strokeWeight", 0)
    corner_radius = node.get("cornerRadius", 0)

    # 构建信息字符串
    size_info = f"({width:.0f}x{height:.0f})" if width and height else ""
    fill_info = extract_fill_info(fills)
    stroke_info = extract_stroke_info(strokes, stroke_weight)
    text_info = extract_text_info(node)
    corner_info = f"[radius: {corner_radius}px]" if corner_radius else ""

    # 组件实例标记
    component_info = ""
    if node_type == "INSTANCE":
        component_id = node.get("componentId", "")
        component_info = f"[component: {component_id}]"

    line = f"{indent}├─ [{node_type}] {name} {size_info} {fill_info} {stroke_info} {text_info} {component_info} {corner_info}"
    output_lines.append(line)

    # 递归处理子节点
    for child in node.get("children", []):
        extract_node_info(child, depth + 1, output_lines)

    return output_lines


def extract_colors(node, colors=None):
    """提取设计中使用的所有颜色"""
    if colors is None:
        colors = set()

    # 提取填充颜色
    for fill in node.get("fills", []):
        if fill.get("type") == "SOLID":
            color = fill.get("color", {})
            r = color.get("r", 0)
            g = color.get("g", 0)
            b = color.get("b", 0)
            colors.add(rgb_to_hex(r, g, b))

    # 提取边框颜色
    for stroke in node.get("strokes", []):
        if stroke.get("type") == "SOLID":
            color = stroke.get("color", {})
            r = color.get("r", 0)
            g = color.get("g", 0)
            b = color.get("b", 0)
            colors.add(rgb_to_hex(r, g, b))

    # 递归处理子节点
    for child in node.get("children", []):
        extract_colors(child, colors)

    return colors


def extract_text_styles(node, styles=None):
    """提取所有文本样式"""
    if styles is None:
        styles = []

    if node.get("type") == "TEXT":
        style = node.get("style", {})
        style_info = {
            "fontFamily": style.get("fontFamily", ""),
            "fontSize": style.get("fontSize", 0),
            "fontWeight": style.get("fontWeight", 400),
        }
        # 简单去重
        if style_info not in styles:
            styles.append(style_info)

    for child in node.get("children", []):
        extract_text_styles(child, styles)

    return styles


def extract_components(node, components=None):
    """提取设计中使用的组件实例"""
    if components is None:
        components = []

    if node.get("type") == "INSTANCE":
        component_info = {
            "id": node.get("id", ""),
            "name": node.get("name", ""),
            "componentId": node.get("componentId", ""),
            "bounds": node.get("absoluteBoundingBox", {}),
        }
        components.append(component_info)

    for child in node.get("children", []):
        extract_components(child, components)

    return components


def generate_report(data):
    """生成完整的分析报告"""
    nodes = data.get("nodes", {})

    report = []
    report.append("=" * 70)
    report.append("Figma 设计分析报告")
    report.append("=" * 70)
    report.append("")

    for node_id, node_data in nodes.items():
        doc = node_data.get("document", {})

        # 1. 设计树结构
        report.append("=" * 40)
        report.append("1. 设计树结构")
        report.append("=" * 40)
        tree_lines = extract_node_info(doc)
        report.extend(tree_lines)
        report.append("")

        # 2. 颜色提取
        report.append("=" * 40)
        report.append("2. 使用的颜色")
        report.append("=" * 40)
        colors = extract_colors(doc)
        for color in sorted(colors):
            report.append(f"  - {color}")
        report.append("")

        # 3. 文本样式
        report.append("=" * 40)
        report.append("3. 文本样式")
        report.append("=" * 40)
        text_styles = extract_text_styles(doc)
        for style in text_styles:
            report.append(
                f'  - {style["fontFamily"]} {style["fontSize"]}px, '
                f'weight: {style["fontWeight"]}'
            )
        report.append("")

        # 4. 组件实例
        report.append("=" * 40)
        report.append("4. 组件实例")
        report.append("=" * 40)
        components = extract_components(doc)
        for comp in components:
            bounds = comp.get("bounds", {})
            w = bounds.get("width", 0)
            h = bounds.get("height", 0)
            report.append(
                f'  - {comp["name"]} ({w:.0f}x{h:.0f}) componentId: {comp["componentId"]}'
            )
        report.append("")

    return "\n".join(report)


def main():
    parser = argparse.ArgumentParser(description="Parse Figma design tree structure")
    parser.add_argument("--file", "-f", type=str, help="Input JSON file path")
    parser.add_argument("--output", "-o", type=str, help="Output file path")
    parser.add_argument(
        "--format",
        type=str,
        choices=["tree", "report"],
        default="report",
        help="Output format: tree (simple tree) or report (full analysis)",
    )

    args = parser.parse_args()

    # 读取输入
    if args.file:
        with open(args.file, "r", encoding="utf-8") as f:
            data = json.load(f)
    else:
        data = json.load(sys.stdin)

    # 生成报告
    if args.format == "tree":
        nodes = data.get("nodes", {})
        for node_id, node_data in nodes.items():
            doc = node_data.get("document", {})
            print(f"获取根节点: {doc.get('name', 'Unknown')}")
            print("=" * 60)
            lines = extract_node_info(doc)
            for line in lines:
                print(line)
    else:
        report = generate_report(data)
        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                f.write(report)
            print(f"Report saved to: {args.output}")
        else:
            print(report)


if __name__ == "__main__":
    main()
