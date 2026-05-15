#!/usr/bin/env python3
"""
生成匹配结果的增强可视化
同时显示视觉识别区域和对应的Figma节点信息

Usage:
    python3 visualize_match_result.py --screenshot <path> [--label-mode <mode>] [--output <path>]

Arguments:
    --screenshot, -s    截图文件路径（必需）
    --label-mode, -l    标签模式: simple/verbose/none（默认: simple）
    --output, -o        输出文件路径（默认: matched-visualization.png）
    --data-file, -d     匹配数据文件（默认: match_data.pkl）
"""

from PIL import Image, ImageDraw, ImageFont
import sys
import argparse
import pickle
from pathlib import Path

# 导入match_visual_to_figma中的类定义（用于pickle反序列化）
from match_visual_to_figma import VisualComponent, FigmaNode, BoundingBox

# 解析命令行参数
parser = argparse.ArgumentParser(
    description='生成视觉组件与Figma节点匹配的可视化图',
    formatter_class=argparse.RawDescriptionHelpFormatter
)
parser.add_argument('-s', '--screenshot', required=True, help='截图文件路径')
parser.add_argument('-l', '--label-mode', default='simple',
                    choices=['simple', 'verbose', 'none'],
                    help='标签模式（默认: simple）')
parser.add_argument('-o', '--output',
                    help='输出文件名或路径（默认: matched-visualization.png，输出到截图文件所在目录）')
parser.add_argument('-d', '--data-file',
                    help='匹配数据文件路径（默认: 截图文件所在目录下的match_data.pkl）')

args = parser.parse_args()

# 验证截图文件存在
screenshot_path = Path(args.screenshot)
if not screenshot_path.exists():
    print(f"Error: Screenshot file not found: {args.screenshot}", file=sys.stderr)
    sys.exit(1)

# 确定输出目录（截图文件所在目录）
output_dir = screenshot_path.parent

# 确定匹配数据文件路径
if args.data_file:
    data_file = Path(args.data_file)
else:
    data_file = output_dir / 'match_data.pkl'

# 验证匹配数据文件存在
if not data_file.exists():
    print(f"Error: Match data file not found: {data_file}", file=sys.stderr)
    print(f"提示：请先运行match_visual_to_figma.py并使用--save-data选项生成匹配数据", file=sys.stderr)
    sys.exit(1)

# 确定输出路径
if args.output:
    output_path = Path(args.output)
    # 如果是相对路径或只是文件名，放到输出目录下
    if not output_path.is_absolute():
        output_path = output_dir / output_path
else:
    output_path = output_dir / 'matched-visualization.png'

print(f"📁 输出目录: {output_dir}")
print(f"📄 输出文件: {output_path}")

print(f"标签模式: {args.label_mode}")

# 加载匹配数据
print(f"📊 加载匹配数据: {data_file}")
with open(data_file, 'rb') as f:
    match_data = pickle.load(f)

visual_components = match_data['visual_components']
screenshot_width = match_data['screenshot_width']
screenshot_height = match_data['screenshot_height']
print(f"✅ 加载了 {len(visual_components)} 个组件")

# 加载原图
print(f"🖼 加载截图: {args.screenshot}")
img = Image.open(args.screenshot)
if img.mode != 'RGBA':
    img = img.convert('RGBA')

# 创建绘制层
overlay = Image.new('RGBA', img.size, (0, 0, 0, 0))
draw = ImageDraw.Draw(overlay, 'RGBA')

# 加载字体 - 尝试多个中文字体路径
font_paths = [
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/System/Library/Fonts/PingFang.ttc",
]

font_loaded = False
for font_path in font_paths:
    try:
        font = ImageFont.truetype(font_path, 13)
        small_font = ImageFont.truetype(font_path, 11)
        tiny_font = ImageFont.truetype(font_path, 9)
        print(f"✅ 成功加载字体: {font_path}")
        font_loaded = True
        break
    except:
        continue

if not font_loaded:
    print("⚠️  警告：无法加载中文字体，使用默认字体（中文可能显示为乱码）")
    font = ImageFont.load_default()
    small_font = font
    tiny_font = font

# 准备颜色列表（为每个组件分配不同颜色）
COLORS = [
    (255, 0, 0),     # 红色
    (0, 200, 0),     # 绿色
    (0, 100, 255),   # 蓝色
    (255, 165, 0),   # 橙色
    (128, 0, 128),   # 紫色
    (255, 192, 203), # 粉色
    (0, 255, 255),   # 青色
    (255, 255, 0),   # 黄色
]

# 构建匹配结果列表（从visual_components读取）
matches = []
for idx, vc in enumerate(visual_components):
    if vc.matched_figma_node:
        fn = vc.matched_figma_node
        matches.append({
            "name": vc.name,
            "visual": (vc.bbox.x, vc.bbox.y, vc.bbox.width, vc.bbox.height),
            "figma": (fn.bbox.x, fn.bbox.y, fn.bbox.width, fn.bbox.height),
            "figma_name": fn.name,
            "semantic": vc.semantic_type,
            "impl": vc.implementation,
            "iou": vc.iou_score * 100,  # 转换为百分比
            "color": COLORS[idx % len(COLORS)],
        })

print(f"✅ 准备绘制 {len(matches)} 个匹配对")

# 绘制每个匹配对
for idx, match in enumerate(matches, 1):
    vx, vy, vw, vh = match["visual"]
    fx, fy, fw, fh = match["figma"]
    color = match["color"]

    # Figma坐标已经在匹配时缩放过了，所以直接使用
    fx_scaled = fx
    fy_scaled = fy
    fw_scaled = fw
    fh_scaled = fh

    # 计算矩形的四个角点
    # 为了防止边框被裁剪，贴边的坐标需要向内缩进
    BORDER_MARGIN = 3  # 边距，至少要大于线条宽度的一半
    x1 = max(BORDER_MARGIN, fx_scaled)
    y1 = max(BORDER_MARGIN, fy_scaled)
    x2 = min(img.width - BORDER_MARGIN, fx_scaled + fw_scaled)
    y2 = min(img.height - BORDER_MARGIN, fy_scaled + fh_scaled)

    # 输出绘制信息
    print(f"\n{idx}. {match['name']} (颜色: {color})")
    print(f"  原始Figma坐标: ({fx}, {fy}) 尺寸: {fw}x{fh}")
    print(f"  缩放后坐标: ({x1:.1f}, {y1:.1f}) 尺寸: {fw_scaled:.1f}x{fh_scaled:.1f}")
    print(f"  矩形边框四条线:")
    print(f"   上边: ({x1:.1f}, {y1:.1f}) → ({x2:.1f}, {y1:.1f})")
    print(f"   右边: ({x2:.1f}, {y1:.1f}) → ({x2:.1f}, {y2:.1f})")
    print(f"   下边: ({x2:.1f}, {y2:.1f}) → ({x1:.1f}, {y2:.1f})")
    print(f"   左边: ({x1:.1f}, {y2:.1f}) → ({x1:.1f}, {y1:.1f})")

    # 1. 绘制视觉识别区域（虚线边框）
    # 由于PIL不直接支持虚线，我们用实线+透明度来表示
    visual_alpha = 50
    draw.rectangle([vx, vy, vx + vw, vy + vh],
                   outline=color + (150,),
                   width=2)

    # 2. 绘制Figma节点区域（实线边框）- 手动绘制四条线段增强可见性
    line_width = 3
    # 为了更明显，先画一层白色描边
    outline_width = line_width + 2
    # 白色描边（增强对比）
    draw.line([(x1, y1), (x2, y1)], fill=(255, 255, 255, 200), width=outline_width)  # 上边
    draw.line([(x2, y1), (x2, y2)], fill=(255, 255, 255, 200), width=outline_width)  # 右边
    draw.line([(x2, y2), (x1, y2)], fill=(255, 255, 255, 200), width=outline_width)  # 下边
    draw.line([(x1, y2), (x1, y1)], fill=(255, 255, 255, 200), width=outline_width)  # 左边

    # 彩色主线
    draw.line([(x1, y1), (x2, y1)], fill=color + (255,), width=line_width)  # 上边
    draw.line([(x2, y1), (x2, y2)], fill=color + (255,), width=line_width)  # 右边
    draw.line([(x2, y2), (x1, y2)], fill=color + (255,), width=line_width)  # 下边
    draw.line([(x1, y2), (x1, y1)], fill=color + (255,), width=line_width)  # 左边

    # 3. 绘制填充（更淡）
    fill_color = color + (20,)
    draw.rectangle([x1, y1, x2, y2], fill=fill_color)

    # 4. 绘制标签 - 根据label_mode决定显示内容
    if args.label_mode != 'none':
        padding = 3

        if args.label_mode == 'simple':
            # simple模式：只显示组件名
            label_y = max(5, fy_scaled - 20)
            main_label = f"{idx}. {match['name']}"
            bbox = draw.textbbox((fx_scaled + 5, label_y), main_label, font=small_font)
            draw.rectangle(
                [bbox[0] - padding, bbox[1] - padding, bbox[2] + padding, bbox[3] + padding],
                fill=(255, 255, 255, 250),
                outline=color,
                width=2
            )
            draw.text((fx_scaled + 5, label_y), main_label, fill=color, font=small_font)
        elif args.label_mode == 'verbose':
            # verbose模式：显示完整标签（三行）
            label_y = max(5, fy_scaled - 45)

            # 第1行：主标签（组件名）
            main_label = f"{idx}. {match['name']}"
            bbox = draw.textbbox((fx_scaled + 5, label_y), main_label, font=small_font)
            draw.rectangle(
                [bbox[0] - padding, bbox[1] - padding, bbox[2] + padding, bbox[3] + padding],
                fill=(255, 255, 255, 250),
                outline=color,
                width=2
            )
            draw.text((fx_scaled + 5, label_y), main_label, fill=color, font=small_font)

            # 第2行：详细信息（Figma节点名 + IoU）
            detail_label = f"🔷 {match['figma_name']} | IoU: {match['iou']:.1f}%"
            detail_y = label_y + 16
            bbox2 = draw.textbbox((fx_scaled + 5, detail_y), detail_label, font=tiny_font)
            draw.rectangle(
                [bbox2[0] - padding, bbox2[1] - padding, bbox2[2] + padding, bbox2[3] + padding],
                fill=(255, 255, 255, 230),
                outline=color,
                width=1
            )
            draw.text((fx_scaled + 5, detail_y), detail_label, fill=color, font=tiny_font)

            # 第3行：实现方式
            impl_label = f"⚙ {match['impl']}"
            impl_y = detail_y + 14
            bbox3 = draw.textbbox((fx_scaled + 5, impl_y), impl_label, font=tiny_font)
            draw.rectangle(
                [bbox3[0] - padding, bbox3[1] - padding, bbox3[2] + padding, bbox3[3] + padding],
                fill=(255, 255, 255, 230),
                outline=color,
                width=1
            )
            draw.text((fx_scaled + 5, impl_y), impl_label, fill=(80, 80, 80), font=tiny_font)

# 合成图片
result = Image.alpha_composite(img, overlay)

# 保存结果
result.save(output_path)
print(f"✅ 匹配可视化已生成: {output_path}")
