#!/usr/bin/env python3
"""
视觉分析与Figma节点匹配工具
通过IoU（交并比）将视觉识别的组件区域与Figma节点进行匹配
"""

import json
import argparse
import sys
from pathlib import Path
from dataclasses import dataclass, field
from typing import List, Dict, Tuple, Any, Optional

try:
    from PIL import Image
except ImportError:
    print("Error: PIL (Pillow) is required. Install it with: pip install Pillow", file=sys.stderr)
    sys.exit(1)


@dataclass
class BoundingBox:
    """边界框"""
    x: float
    y: float
    width: float
    height: float

    @property
    def x2(self):
        return self.x + self.width

    @property
    def y2(self):
        return self.y + self.height

    @property
    def area(self):
        return self.width * self.height

    def __repr__(self):
        return f"BBox({self.x:.1f}, {self.y:.1f}, {self.width:.1f}x{self.height:.1f})"


@dataclass
class VisualComponent:
    """视觉识别的组件"""
    name: str
    bbox: BoundingBox
    semantic_type: str = ""  # 如: banner, hero, selector, action, list
    implementation: str = ""  # 如: 整图, 背景图+组件, 完全组件化
    reasons: List[str] = field(default_factory=list)
    matched_figma_node: Optional["FigmaNode"] = None
    iou_score: float = 0.0


@dataclass
class FigmaNode:
    """Figma 节点"""
    id: str
    name: str
    type: str
    bbox: BoundingBox
    depth: int = 0
    semantic_type: str = ""  # 通过匹配后填充
    implementation: str = ""
    visual_component_name: str = ""


def calculate_iou(box1: BoundingBox, box2: BoundingBox) -> float:
    """计算两个边界框的IoU（交并比）"""
    x_left = max(box1.x, box2.x)
    y_top = max(box1.y, box2.y)
    x_right = min(box1.x2, box2.x2)
    y_bottom = min(box1.y2, box2.y2)

    if x_right <= x_left or y_bottom <= y_top:
        return 0.0

    # 计算交集
    intersection = (x_right - x_left) * (y_bottom - y_top)

    # 计算并集
    union = box1.area + box2.area - intersection

    if union <= 0:
        return 0.0

    return intersection / union


def extract_figma_nodes(figma_data: Dict[str, Any], max_depth: int = 5) -> List[FigmaNode]:
    """从 Figma API 数据中递归提取所有节点"""
    nodes: List[FigmaNode] = []
    root_bounds: Optional[Dict[str, Any]] = None

    def extract_recursive(node: Dict, depth: int = 0, root_bounds: Optional[Dict] = None):
        if max_depth is not None:
            if depth > max_depth:
                return

        # 获取边界框
        node_bounds = node.get("absoluteBoundingBox", {})

        # 计算相对坐标（相对于根节点）
        if root_bounds is None and depth == 0:
            root_bounds = node_bounds

        bounds = node_bounds
        if root_bounds:
            rel_x = bounds.get("x", 0) - root_bounds.get("x", 0)
            rel_y = bounds.get("y", 0) - root_bounds.get("y", 0)
            bbox = BoundingBox(
                rel_x,
                rel_y,
                bounds.get("width", 0),
                bounds.get("height", 0),
            )
        else:
            bbox = BoundingBox(
                bounds.get("x", 0),
                bounds.get("y", 0),
                bounds.get("width", 0),
                bounds.get("height", 0),
            )

        figma_node = FigmaNode(
            id=node.get("id", ""),
            name=node.get("name", "Unknown"),
            type=node.get("type", "Unknown"),
            bbox=bbox,
            depth=depth,
        )

        nodes.append(figma_node)

        # 跳过以 @ 开头的节点的子节点（视为整图）
        node_name = node.get("name", "")
        if node_name.startswith("@"):
            return

        # 递归处理子节点
        for child in node.get("children", []):
            extract_recursive(child, depth + 1, root_bounds)

    # 处理 figma_data 中的所有节点
    for node_id, node_data in figma_data.get("nodes", {}).items():
        doc = node_data.get("document", {})
        extract_recursive(doc, 0)

    return nodes


def match_visual_to_figma(
    visual_components: List[VisualComponent],
    figma_nodes: List[FigmaNode],
    iou_threshold: float = 0.5,
) -> None:
    """对每个视觉组件，找到 IoU 最高的 Figma 节点作为匹配"""
    LOW_IOU_THRESHOLD = 0.5

    for vc in visual_components:
        # 收集所有候选（IoU >= 阈值）
        candidates: List[Tuple[float, FigmaNode]] = []

        for fn in figma_nodes:
            iou = calculate_iou(vc.bbox, fn.bbox)
            if iou >= LOW_IOU_THRESHOLD:
                candidates.append((iou, fn))

        if candidates:
            # 从所有候选中选 IoU 最高的
            best_iou, best_match = max(candidates, key=lambda x: x[0])
            vc.matched_figma_node = best_match
            vc.iou_score = best_iou
            # 反向标记 Figma 节点
            best_match.semantic_type = vc.semantic_type
            best_match.implementation = vc.implementation
            best_match.visual_component_name = vc.name
        else:
            # 没有候选达到阈值，不视作有效匹配
            vc.matched_figma_node = None
            vc.iou_score = 0.0


def get_screenshot_dimensions(screenshot_path: str) -> Tuple[int, int]:
    """从截图文件中读取尺寸"""
    try:
        img = Image.open(screenshot_path)
        return img.width, img.height
    except Exception as e:
        print(f"Error reading screenshot: {e}", file=sys.stderr)
        sys.exit(1)


def get_figma_dimensions(figma_data: Dict[str, Any]) -> Tuple[float, float]:
    """从 Figma 数据获取根节点尺寸"""
    try:
        for node_id, node_data in figma_data.get("nodes", {}).items():
            doc = node_data.get("document", {})
            bounds = doc.get("absoluteBoundingBox", {})
            return bounds.get("width", 0), bounds.get("height", 0)
        return 0, 0
    except Exception as e:
        print(f"Error reading figma dimensions: {e}", file=sys.stderr)
        return 0, 0


def load_visual_components(config_path: str) -> List[VisualComponent]:
    """从 visual_components 配置文件加载视觉组件"""
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        # Support multi-state wrapper format
        if isinstance(data, dict) and data.get("mode") == "multi-state":
            data = data["components"]

        components = []
        for item in data:
            bbox_data = item["bbox"]
            bbox = BoundingBox(
                bbox_data["x"],
                bbox_data["y"],
                bbox_data["width"],
                bbox_data["height"],
            )
            component = VisualComponent(
                name=item["name"],
                bbox=bbox,
                semantic_type=item.get("semantic_type", ""),
                implementation=item.get("implementation", ""),
                reasons=item.get("reasons", []),
            )
            components.append(component)

        return components
    except Exception as e:
        print(f"Error loading visual components config: {e}", file=sys.stderr)
        sys.exit(1)


def generate_match_report(
    visual_components: List[VisualComponent],
    figma_nodes: List[FigmaNode],
) -> str:
    """生成匹配报告"""
    lines = []
    lines.append("=" * 60)
    lines.append("视觉-Figma 节点匹配报告")
    lines.append("=" * 60)
    lines.append("")

    # 一、匹配结果
    lines.append("一、匹配结果")
    lines.append("-" * 60)
    matched_nodes = [vc.matched_figma_node for vc in visual_components if vc.matched_figma_node]

    # 二、Hero Section 组合检测
    hero_pattern = []
    for vc in visual_components:
        if vc.semantic_type in ["hero", "selector", "action"] and vc.matched_figma_node:
            hero_pattern.append(vc)

    if len(hero_pattern) >= 2:
        lines.append("=== Hero Section 组合模式 ===")
        lines.append("")
        for vc in hero_pattern:
            lines.append(f"  - {vc.name} ({vc.semantic_type})")
        lines.append("")
        lines.append("建议：这些组件应放在同一个父组件中，共享状态。")
        lines.append("")

    # 三、Figma 节点语义标注
    lines.append("三、Figma 节点语义标注")
    lines.append("-" * 60)
    annotated_nodes = [fn for fn in figma_nodes if fn.semantic_type]
    lines.append(f"已标注 {len(annotated_nodes)} 个 Figma 节点为视觉组件")
    lines.append("")

    for fn in sorted(annotated_nodes, key=lambda n: (n.depth, n.name)):
        lines.append(f"  - {fn.name} ({fn.type}) [depth={fn.depth}]")
        lines.append(f"      语义: {fn.semantic_type}")
        lines.append(f"      实现: {fn.implementation}")
        lines.append(f"      对应视觉组件: {fn.visual_component_name}")
        lines.append("")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="视觉组件与Figma节点匹配工具",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s -s screenshot.png -f figma_data.json -c components.json
  %(prog)s -s screenshot.png -f figma_data.json -c components.json -o report.txt
  %(prog)s --iou-threshold 0.4 --max-depth 4
""",
    )

    parser.add_argument("-s", "--screenshot", required=True, help="截图文件路径")
    parser.add_argument("-f", "--figma-data", required=True, help="Figma data JSON 文件")
    parser.add_argument("-c", "--config", required=True, help="visual_components 配置文件 (JSON 格式)")
    parser.add_argument("-o", "--output", help="输出文件路径 (默认: visual_figma_match_report.txt 输出到截图文件所在目录)")
    parser.add_argument("--output-dir", help="输出目录 (默认: 截图文件所在目录)")
    parser.add_argument("--iou-threshold", type=float, default=0.5, help="IoU 阈值 (默认: 0.5)")
    parser.add_argument("--max-depth", type=int, default=4, help="最大递归深度 (默认: 4)")
    parser.add_argument("--save-data", action="store_true", help="保存匹配数据到 match_data.pkl (用于可视化)")

    args = parser.parse_args()

    # 验证输入文件
    for path in [args.screenshot, args.figma_data, args.config]:
        if not Path(path).exists():
            print(f"Error: File not found: {path}", file=sys.stderr)
            sys.exit(1)

    # 确定输出目录
    if args.output_dir:
        output_dir = Path(args.output_dir)
    else:
        output_dir = Path(args.screenshot).parent

    output_dir.mkdir(parents=True, exist_ok=True)

    # 确定输出路径
    if args.output:
        output_path = Path(args.output)
        if not output_path.is_absolute():
            output_path = output_dir / output_path
    else:
        output_path = output_dir / "visual_figma_match_report.txt"

    # 加载数据
    print(f"📊 加载 Figma 数据: {args.figma_data}")
    with open(args.figma_data, "r", encoding="utf-8") as f:
        figma_data = json.load(f)

    print(f"📊 加载视觉组件配置: {args.config}")
    visual_components = load_visual_components(args.config)
    print(f"   ✅ 加载了 {len(visual_components)} 个视觉组件")

    # 获取尺寸
    screenshot_width, screenshot_height = get_screenshot_dimensions(args.screenshot)
    figma_width, figma_height = get_figma_dimensions(figma_data)

    print(f"📐 截图尺寸: {screenshot_width}x{screenshot_height}")
    print(f"📐 Figma 尺寸: {figma_width}x{figma_height}")

    # 计算缩放比例
    if figma_width > 0 and figma_height > 0:
        scale_x = screenshot_width / figma_width
        scale_y = screenshot_height / figma_height
        print(f"📏 缩放比例: x={scale_x:.4f}, y={scale_y:.4f}")
    else:
        scale_x = scale_y = 1.0

    # 提取 Figma 节点
    figma_nodes = extract_figma_nodes(figma_data, max_depth=args.max_depth)
    print(f"🌲 提取了 {len(figma_nodes)} 个 Figma 节点")

    # 应用缩放
    for fn in figma_nodes:
        fn.bbox = BoundingBox(
            fn.bbox.x * scale_x,
            fn.bbox.y * scale_y,
            fn.bbox.width * scale_x,
            fn.bbox.height * scale_y,
        )

    # 执行匹配
    print(f"🔍 开始匹配 (IoU 阈值: {args.iou_threshold})...")
    match_visual_to_figma(visual_components, figma_nodes, iou_threshold=args.iou_threshold)

    matched_count = sum(1 for vc in visual_components if vc.matched_figma_node)
    print(f"✅ 匹配完成: {matched_count}/{len(visual_components)} 个组件成功匹配")

    # 生成报告
    report = generate_match_report(visual_components, figma_nodes)

    # 写入报告
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(report)
    print(f"📄 报告已保存: {output_path}")

    # 10. 保存匹配数据（用于可视化）
    if args.save_data:
        import pickle
        data_file = output_dir / "match_data.pkl"
        # 只保存有匹配的组件（IoU >= 50%）
        valid_components = [vc for vc in visual_components if vc.matched_figma_node is not None]
        excluded = len(visual_components) - len(valid_components)
        if excluded > 0:
            print(f"⚠️  已排除 {excluded} 个低 IoU 组件（不在可视化产物中）")

        with open(data_file, "wb") as f:
            pickle.dump(
                {
                    "visual_components": valid_components,
                    "figma_nodes": figma_nodes,
                    "screenshot_width": screenshot_width,
                    "screenshot_height": screenshot_height,
                },
                f,
            )
        print(f"💾 匹配数据已保存: {data_file} ({len(valid_components)} 个有效组件)")

    # 11. 控制台简短摘要
    print("\n" + report)


if __name__ == "__main__":
    main()
