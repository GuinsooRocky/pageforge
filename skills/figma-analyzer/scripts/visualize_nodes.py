#!/usr/bin/env python3
"""
Figma 节点可视化脚本
在原始上传的 Figma 设计稿中的节点位置和边界

Usage:
    python3 visualize_nodes.py -f figma_data.json -i screenshot.png -o output.png --depth 2
"""

import json
import argparse
import colorsys
import os
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("Error: PIL (Pillow) is required.", file=sys.stderr)
    sys.exit(1)


def get_distinct_colors(n):
    """生成 n 个在视觉上可区分的颜色"""
    colors = []
    for i in range(n):
        hue = i / n
        saturation = 0.7 + (i % 3) * 0.1
        lightness = 0.5 + (i % 2) * 0.1
        rgb = colorsys.hls_to_rgb(hue, lightness, saturation)
        colors.append(tuple(int(c * 255) for c in rgb))
    return colors


def extract_nodes_at_depth(node, target_depth, current_depth=0, nodes=None, root_bounds=None):
    """递归提取指定深度的节点"""
    if nodes is None:
        nodes = []

    # 获取当前节点的 absoluteBoundingBox
    if root_bounds is None and current_depth == 0:
        root_bounds = node.get("absoluteBoundingBox", {})

    bounds = node.get("absoluteBoundingBox", {})

    if current_depth == target_depth and bounds:
        # 计算相对于根节点的相对坐标
        rel_x = bounds.get("x", 0) - root_bounds.get("x", 0)
        rel_y = bounds.get("y", 0) - root_bounds.get("y", 0)

        node_info = {
            "id": node.get("id", ""),
            "name": node.get("name", "Unknown"),
            "type": node.get("type", "Unknown"),
            "depth": current_depth,
            "bounds": {
                "x": rel_x,
                "y": rel_y,
                "width": bounds.get("width", 0),
                "height": bounds.get("height", 0),
            },
            "absolute_bounds": bounds,
            "fills": node.get("fills", []),
            "children_count": len(node.get("children", [])),
        }
        nodes.append(node_info)

    # 递归处理子节点
    if current_depth < target_depth:
        for child in node.get("children", []):
            extract_nodes_at_depth(child, target_depth, current_depth + 1, nodes, root_bounds)

    return nodes


def get_fill_color(fills):
    """从 fills 中获取主要颜色"""
    if not fills:
        return None

    fill = fills[0]
    fill_type = fill.get("type", "")

    if fill_type == "SOLID":
        color = fill.get("color", {})
        r = int(color.get("r", 0) * 255)
        g = int(color.get("g", 0) * 255)
        b = int(color.get("b", 0) * 255)
        return f"#{r:02x}{g:02x}{b:02x}"
    elif fill_type == "IMAGE":
        return "[IMAGE]"
    elif "GRADIENT" in fill_type:
        return "[GRADIENT]"

    return None


def draw_node_overlay(image, nodes, show_labels=True, opacity=0.3, focus_layers=None):
    """在图片上绘制节点边界框

    Args:
        focus_layers: 要重点显示的层级列表，如 [1, 2]，其他层级会变淡
    """
    # 确保图片转换为 RGBA 模式以支持透明度
    if image.mode != 'RGBA':
        image = image.convert('RGBA')

    # 创建一个用于绘制的透明图层
    overlay = Image.new('RGBA', image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay, 'RGBA')

    # 尝试加载字体
    try:
        font = ImageFont.truetype("/System/Library/Fonts/PingFang.ttc", 14)
        small_font = ImageFont.truetype("/System/Library/Fonts/PingFang.ttc", 12)
    except:
        font = ImageFont.load_default()
        small_font = font

    # 为每个深度级别使用不同的颜色 - 使用更鲜明的颜色
    depth_colors = {
        0: (255, 0, 0),      # 红色 - 一级节点
        1: (0, 200, 0),      # 绿色 - 二级
        2: (0, 100, 255),    # 蓝色 - 三级
        3: (255, 165, 0),    # 橙色 - 四级
        4: (128, 0, 128),    # 紫色 - 五级
    }

    # 如果指定了焦点层级，只显示这些层级
    if focus_layers:
        filtered_nodes = [n for n in nodes if n["depth"] in focus_layers]
    else:
        filtered_nodes = nodes

    # 按深度排序，深度大的先绘制（这样小的会在上层）
    sorted_nodes = sorted(filtered_nodes, key=lambda x: -x["depth"])

    # 存储标签信息，最后再绘制
    labels = []

    for node in sorted_nodes:
        bounds = node["bounds"]
        depth = node["depth"]
        x1 = bounds["x"]
        y1 = bounds["y"]
        x2 = bounds["x"] + bounds["width"]
        y2 = bounds["y"] + bounds["height"]

        # 跳过超出图片范围的节点
        img_width, img_height = image.size
        x1 = max(0, x1)
        y1 = max(0, y1)
        x2 = min(img_width, x2)
        y2 = min(img_height, y2)

        # 跳过完全超出图片范围或尺寸过小的边界框
        if x2 <= x1 or y2 <= y1 or (x2 - x1) < 5 or (y2 - y1) < 5:
            continue

        # 获取颜色
        color = depth_colors.get(depth, (128, 128, 128))

        # 绘制半透明填充
        if focus_layers and depth in focus_layers:
            fill_alpha = int(255 * 0.15)
        else:
            fill_alpha = int(255 * opacity)
        fill_color = color + (fill_alpha,)
        draw.rectangle([x1, y1, x2, y2], fill=fill_color)

        # 绘制边框 - 焦点层级用更粗的边框
        if focus_layers and depth in focus_layers:
            border_width = 4
        else:
            border_width = max(1, 3 - depth)
        draw.rectangle([x1, y1, x2, y2], outline=color, width=border_width)

        # 收集标签信息（焦点层级或显示全部时）
        if show_labels and (not focus_layers or depth in focus_layers):
            label = f"[{node['name'][:25]}]"
            if node["type"] == "INSTANCE":
                label = f"[{label}]"
            labels.append({
                "text": label,
                "x": x1,
                "y": y1,
                "depth": depth,
                "color": color,
                "x2": x2,
                "y2": y2,
                "node": node,
            })

    # 绘制标签（从浅层到深层，避免遮挡）
    for label_info in sorted(labels, key=lambda x: -x["depth"]):
        text = label_info["text"]
        x, y = label_info["x"], label_info["y"]
        color = label_info["color"]

        # 测试标签位置不会超出图片
        if x2 - x1 < 5 or (y2 - y1) < 5:
            continue

        # 获取文本尺寸
        color = depth_colors.get(depth, (128, 128, 128))

        # 绘制带背景的标签
        if focus_layers and depth in focus_layers:
            fill_alpha = int(255 * 0.15)
            fill_color = int(255 * 0.3)
        else:
            fill_alpha = int(255 * opacity)
        fill_color = color + (fill_alpha,)
        draw.rectangle([x1, y1, x2, y2], fill=fill_color)

        # 绘制焦点层级用实心边框，其他用淡色
        if focus_layers and depth in focus_layers:
            border_width = max(1, 3 - depth)
            draw.rectangle([x1, y1, x2, y2], outline=color, width=border_width)
        else:
            border_width = max(1, 3 - depth)
            draw.rectangle([x1, y1, x2, y2], outline=color, width=border_width)

        # 添加标签
        if show_labels and (not focus_layers or depth in focus_layers):
            label = f"[{node['name'][:25]}]"
            if node["type"] == "INSTANCE":
                label = f"[{label}]"
            # 取标签位置（节点左上角附近）
            label_x = x1 + 2
            label_y = y1 + 2
            draw.text((label_x, label_y), label, fill=color, font=small_font)

    # 合成图层
    result = Image.alpha_composite(image, overlay)
    return result


def infer_node_function(node, image_height):
    """基于节点名称、位置推断功能用途"""
    name_patterns = {
        "nav": ["header", "top", "导航", "nav", "导航栏/头部区域"],
        "hero": ["banner", "hero", "主视觉", "活动banner/KV区"],
        "gift": ["gift", "礼物", "送礼", "reward", "礼物/奖励/激励项"],
        "preview": ["preview", "预览", "展示", "活动banner/预览区"],
        "button": ["btn", "button", "click", "操作按钮"],
        "list": ["list", "grid", "列表", "列表/排行榜"],
        "card": ["card", "卡片", "卡片/物品"],
        "icon": ["icon", "图标"],
        "title": ["title", "heading", "标题"],
        "module": ["module", "section", "区域/模块"],
        "background": ["bg", "背景", "背景图"],
    }

    name = node.get("name", "")
    name_lower = name.lower()
    node_type = node.get("type", "")
    bounds = node.get("bounds", {})
    center_y = bounds.get("y", 0) + bounds.get("height", 0) / 2
    width = bounds.get("width", 0)
    height = bounds.get("height", 0)

    inferences = []

    # 基于命名模式
    for keywords, description in name_patterns.items():
        for kw in keywords if isinstance(keywords, list) else [keywords]:
            if kw in name_lower or kw in name:
                for keyword in keywords:
                    if keyword in name_lower or keyword in name:
                        inferences.append(description)
                        break
                break

    # 基于位置推断
    if center_y < image_height * 0.15:
        if not inferences:
            inferences.append("顶部区域元素")
    elif center_y > image_height * 0.85:
        if not inferences:
            inferences.append("底部区域元素")

    # 基于尺寸推断
    if width > 350 and height > 100:
        if not inferences:
            inferences.append("大型容器或主视觉区")
    elif width > 200 and height > 50:
        if not inferences:
            inferences.append("主要内容模块")
    elif width < 100 and height < 100:
        if not inferences:
            inferences.append("小型元素/图标")

    # 基于类型推断
    if node_type == "INSTANCE":
        inferences.append("组件实例（可复用）")

    return inferences


def generate_node_summary(nodes, focus_layers=None):
    """生成节点分析摘要

    Args:
        focus_layers: 要重点分析的层级列表，如 [1, 2]
    """
    summary = []
    summary.append("=" * 60)

    # 获取图片高度用于位置推断
    if nodes:
        root_node = nodes[0]
        image_height = root_node["bounds"]["height"]
    else:
        image_height = 800

    # 按深度分组
    by_depth = {}
    for node in nodes:
        depth = node["depth"]
        if depth not in by_depth:
            by_depth[depth] = []
        by_depth[depth].append(node)

    for depth in sorted(by_depth.keys()):
        depth_nodes = by_depth[depth]

        # 标记焦点层级
        is_focus = focus_layers and depth in focus_layers
        prefix = "→ " if is_focus else "  "

        summary.append(f"\n{prefix}第 {depth} 层 ({len(depth_nodes)} 个节点):")

        for node in depth_nodes:
            bounds = node["bounds"]
            fill_color = get_fill_color(node.get("fills", []))

            type_icon = "📐" if node["type"] == "FRAME" else \
                        "🔷" if node["type"] == "INSTANCE" else \
                        "▢" if node["type"] == "RECTANGLE" else \
                        "T" if node["type"] == "TEXT" else "•"

            line = f"  {type_icon} [{node['name']}]"
            line += f" ({bounds['width']:.0f}x{bounds['height']:.0f})"
            line += f" @({bounds['x']:.0f}, {bounds['y']:.0f})"

            if fill_color:
                line += f" {fill_color}"

            if node["children_count"] > 0:
                line += f" [{node['children_count']} children]"

            summary.append(line)

            # 焦点层级输出推断
            if is_focus:
                inferences = infer_node_function(node, image_height)
                if inferences:
                    for inf in inferences:
                        summary.append(f"      ↳ 推断: {inf}")

    return "\n".join(summary)


def generate_visual_analysis(nodes, image_size):
    """基于节点位置和尺寸生成视觉布局分析"""
    analysis = []
    analysis.append("\n" + "=" * 60)
    analysis.append("视觉布局分析")
    analysis.append("=" * 60)

    img_width, img_height = image_size

    # 分析布局结构
    top_nodes = []
    middle_nodes = []
    bottom_nodes = []

    for node in nodes:
        bounds = node["bounds"]
        center_y = bounds["y"] + bounds["height"] / 2

        if center_y < img_height * 0.33:
            top_nodes.append(node)
        elif center_y < img_height * 0.66:
            middle_nodes.append(node)
        else:
            bottom_nodes.append(node)

    # 输出每个区域的节点
    if top_nodes:
        analysis.append(f"\n📍 顶部区域 ({len(top_nodes)} 个节点):")
        for node in top_nodes[:10]:
            analysis.append(f"  - [{node['name']}] ({node['type']})")

    if middle_nodes:
        analysis.append(f"\n📍 中间区域 ({len(middle_nodes)} 个节点):")
        for node in middle_nodes[:10]:
            analysis.append(f"  - [{node['name']}] ({node['type']})")

    if bottom_nodes:
        analysis.append(f"\n📍 底部区域 ({len(bottom_nodes)} 个节点):")
        for node in bottom_nodes[:10]:
            analysis.append(f"  - [{node['name']}] ({node['type']})")

    return "\n".join(analysis)


def main():
    parser = argparse.ArgumentParser(description="Figma 节点可视化")
    parser.add_argument("-f", "--figma-data", required=True, help="Figma JSON 数据文件")
    parser.add_argument("-i", "--image", required=True, help="原始截图文件")
    parser.add_argument("-o", "--output", required=True, help="输出可视化图片路径")
    parser.add_argument("--depth", type=int, default=1, help="要可视化的节点深度（默认: 1）")
    parser.add_argument("--no-labels", action="store_true", help="不显示节点名称标签")
    parser.add_argument("--summary", help="输出节点分析摘要到文件")
    parser.add_argument("--focus-layers", type=str, help="只显示指定层级，用逗号分隔，如 '1,2'")

    args = parser.parse_args()

    # 解析 focus-layers 参数
    focus_layers = None
    if args.focus_layers:
        focus_layers = [int(x.strip()) for x in args.focus_layers.split(",")]
        print(f"焦点层级: {focus_layers}")

    # 加载 Figma 数据
    print(f"📊 加载 Figma 数据: {args.figma_data}")
    with open(args.figma_data, "r", encoding="utf-8") as f:
        figma_data = json.load(f)

    # 加载原始图片
    print(f"🖼  加载图片: {args.image}")
    image = Image.open(args.image)

    # 提取节点
    print(f"🌲 提取深度 {args.depth} 的节点...")
    nodes = []
    for node_id, node_data in figma_data.get("nodes", {}).items():
        doc = node_data.get("document", {})
        nodes = extract_nodes_at_depth(doc, args.depth)

    print(f"✅ 提取了 {len(nodes)} 个节点")

    # 根据图片尺寸缩放 Figma 节点坐标
    if nodes:
        root_node = nodes[0]
        figma_width = root_node["bounds"]["width"] if root_node else 0
        figma_height = root_node["bounds"]["height"] if root_node else 0

        if abs(image.width - figma_width) > 1 or abs(image.height - figma_height) > 1:
            scale_x = image.width / figma_width
            scale_y = image.height / figma_height
            print(f"📏 缩放比例: x={scale_x:.2f}, y={scale_y:.2f}")

            for node in nodes:
                node["bounds"]["x"] *= scale_x
                node["bounds"]["y"] *= scale_y
                node["bounds"]["width"] *= scale_x
                node["bounds"]["height"] *= scale_y

    # 绘制可视化
    if focus_layers:
        print(f"🎨 绘制节点边界（焦点层级: {focus_layers}）...")
    else:
        print("🎨 绘制节点边界...")
    result = draw_node_overlay(image, nodes, show_labels=not args.no_labels, focus_layers=focus_layers)

    # 保存结果
    result.save(args.output)
    print(f"✅ 可视化图片已保存: {args.output}")

    # 生成摘要
    summary = generate_node_summary(nodes, focus_layers=focus_layers)
    visual_analysis = generate_visual_analysis(nodes, image.size)

    full_summary = summary + visual_analysis
    print(full_summary)

    if args.summary:
        with open(args.summary, "w", encoding="utf-8") as f:
            f.write(full_summary)
        print(f"📄 摘要已保存: {args.summary}")


if __name__ == "__main__":
    main()
