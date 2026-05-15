#!/usr/bin/env python3
"""
check-component.py
检查 m0-template-gen 生成的组件模板（React TSX / Vue SFC）和 placeholder-list.md
是否包含了 visual_figma_match_report.txt 中所有已匹配 (✅) 的组件占位。

用法:
  python3 check-component.py \
    --report     .claude/docs/fig_meta/visual_figma_match_report.txt \
    --component  <输出目录>/page.tsx \
    --md         .claude/docs/placeholder-list.md

  # --vue 作为 deprecated alias 保留（与 --component 等价）:
  python3 check-component.py --vue <旧 Vue 项目>/index.vue ...

  # 也可省略参数，使用默认路径:
  python3 check-component.py
"""

import argparse
import re
import sys
from pathlib import Path


# ─────────────────────────────────────────
# 1. 解析报告：提取已匹配节点 ID
# ─────────────────────────────────────────

def parse_report(report_path):
    """
    解析 visual_figma_match_report.txt.

    返回:
        matched   - 需检查的已匹配组件  [{"name": str, "node_id": str}, ...]
        unmatched - 未匹配组件 (❌, 无需占位)  [{"name": str}, ...]
    """
    text = report_path.read_text(encoding="utf-8")
    blocks = re.split(r"\n(?=###\s)", text)

    matched = []
    unmatched = []

    for block in blocks:
        name_match = re.match(r"###\s+(.+)", block.strip())
        if not name_match:
            continue
        component_name = name_match.group(1).strip()

        if "❌ 未找到匹配的Figma节点" in block:
            unmatched.append({"name": component_name})
            continue

        node_id_match = re.search(r"节点ID:\s*(\S+)", block)
        if not node_id_match:
            continue
        node_id = node_id_match.group(1).strip()
        matched.append({"name": component_name, "node_id": node_id})

    return matched, unmatched


# ─────────────────────────────────────────
# 2. 解析组件文件: 提取 [placeholder] 注释中的 nodeId
#    （兼容 React TSX 的 JSX 注释 / Vue SFC 的 HTML 注释 / 任意文件的占位标记）
# ─────────────────────────────────────────

def parse_component(component_path):
    """
    从组件文件（React TSX / Vue SFC / etc）中提取所有占位注释里的 nodeId。
    匹配格式 1（Vue HTML 注释）: <!-- [placeholder] nodeId=3:2602 ... -->
    匹配格式 2（React JSX 注释）: {/* [placeholder] nodeId=3:2602 ... */}
    匹配格式 3（任意 [placeholder] 标记）: 任何包含 [placeholder] ... nodeId=X 的行
    也支持复合实例ID: nodeId=I3:945;7724:910219
    """
    text = component_path.read_text(encoding="utf-8")
    ids = re.findall(r"\[placeholder\].*?nodeId=([\w:;]+)", text)
    return set(ids)


# Deprecated alias，保留向后兼容
def parse_vue(vue_path):
    return parse_component(vue_path)


# ─────────────────────────────────────────
# 3. 解析 placeholder-list.md: 提取清单表格中的 nodeId
# ─────────────────────────────────────────

def parse_md(md_path):
    """
    从 placeholder-list.md 的组件清单表格中提取所有 nodeId。

    识别两种格式:
      1. Figma 链接文本形如  [3:2602](https://...node-id=3%3A2602)
      2. 表格行中带反引号的  `3:2602` 或 `I3:945;7724:910219`
    """
    text = md_path.read_text(encoding="utf-8")
    ids = set()

    # 格式1: Markdown 链接文本是 nodeId
    for m in re.finditer(r"\[(\d+:\d+)\]\(https?://[^)]+node-id[^)]+\)", text):
        ids.add(m.group(1))

    # 格式2: 带反引号的 nodeId (支持简单ID和复合实例ID, 如 I3:945;7724:910219)
    for m in re.finditer(r"`([\w:;]+)`", text):
        ids.add(m.group(1))

    return ids


# ─────────────────────────────────────────
# 4. 单项检查 & 输出
# ─────────────────────────────────────────

def print_section(label, matched, generated_ids):
    """打印单个目标文件的检查结果，返回是否全部通过。"""
    present = [c for c in matched if c["node_id"] in generated_ids]
    missing = [c for c in matched if c["node_id"] not in generated_ids]

    status = "PASS ✅" if not missing else "FAIL ❌"
    print(f"— {label} ({status}) —")
    print(f"  通过 {len(present)}/{len(matched)}: ")
    for c in present:
        print(f"    ✅ {c['name']}  (nodeId={c['node_id']})")
    if missing:
        print(f"  缺失 {len(missing)} 个: ")
        for c in missing:
            print(f"    ❌ {c['name']}  (nodeId={c['node_id']})")
    print()
    return len(missing) == 0


# ─────────────────────────────────────────
# 5. 主检查流程
# ─────────────────────────────────────────

def check(report_path, component_path, md_path):
    matched, unmatched = parse_report(report_path)
    component_ids = parse_component(component_path)
    md_ids = parse_md(md_path) if md_path else set()

    print("=" * 62)
    print("  m0-template-gen 组件占位检查报告")
    print("=" * 62)
    print(f"  报告文件   : {report_path}")
    print(f"  组件文件   : {component_path}")
    if md_path:
        print(f"  MD  文件   : {md_path}")
    print()

    if unmatched:
        print(f"【跳过-未匹配】❌ 未找到 Figma 节点的组件 (共 {len(unmatched)} 个, 无需占位): ")
        for c in unmatched:
            print(f"    - {c['name']}")
        print()

    print(f"共需检查已匹配组件: {len(matched)} 个\n")

    all_pass = True
    all_pass &= print_section(f"组件模板  {component_path.name}", matched, component_ids)
    if md_path:
        all_pass &= print_section(f"清单文档  {md_path.name}", matched, md_ids)

    print("=" * 62)
    if all_pass:
        print("  结论: PASS - 所有已匹配组件均已生成占位 ✅")
    else:
        print("  结论: FAIL - 存在缺失占位, 请补充 ❌")
    print("=" * 62)
    return 0 if all_pass else 1


# ─────────────────────────────────────────
# 6. CLI 入口
# ─────────────────────────────────────────

DEFAULT_REPORT    = ".claude/docs/fig_meta/visual_figma_match_report.txt"
DEFAULT_COMPONENT = "<source_root>/<route>/page.tsx"
DEFAULT_MD        = ".claude/docs/placeholder-list.md"


def main():
    parser = argparse.ArgumentParser(
        description="检查 m0-template-gen 生成的组件模板（React TSX / Vue SFC）和 placeholder-list.md 是否包含所有已匹配组件的占位"
    )
    parser.add_argument("--report",    "-r", default=DEFAULT_REPORT,
                        help=f"visual_figma_match_report.txt 路径 (默认: {DEFAULT_REPORT})")
    parser.add_argument("--component", "-c", default=None,
                        help=f"待检查的组件文件路径 (React .tsx / .jsx / Vue .vue 等；默认: {DEFAULT_COMPONENT})")
    parser.add_argument("--vue",       "-v", default=None,
                        help="[DEPRECATED] 旧 Vue 项目入参，等价 --component；新项目用 --component")
    parser.add_argument("--md",        "-m", default=DEFAULT_MD,
                        help=f"placeholder-list.md 路径 (默认: {DEFAULT_MD}, 传 none 跳过)")
    args = parser.parse_args()

    # --component 优先；若用户传了 --vue 走 deprecated 路径
    component_arg = args.component or args.vue or DEFAULT_COMPONENT
    if args.vue and not args.component:
        print("⚠️  --vue 已 deprecated，请改用 --component（功能等价）", file=sys.stderr)

    report_path    = Path(args.report)
    component_path = Path(component_arg)
    md_path        = None if args.md.lower() == "none" else Path(args.md)

    for p, label in [(report_path, "报告文件"), (component_path, "组件文件")]:
        if not p.exists():
            print(f"错误: 找不到{label} {p}", file=sys.stderr)
            sys.exit(2)
    if md_path and not md_path.exists():
        print(f"错误: 找不到 MD 文件 {md_path}", file=sys.stderr)
        sys.exit(2)

    sys.exit(check(report_path, component_path, md_path))


if __name__ == "__main__":
    main()
