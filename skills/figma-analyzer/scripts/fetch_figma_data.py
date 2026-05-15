#!/usr/bin/env python3
"""
Figma API 数据获取脚本
从 Figma API 获取设计文件的节点数据

Usage:
    ./fetch_figma_data.py <file_key> <node_id> [output_file]

Example:
    ./fetch_figma_data.py 8jV7hEtURMfum06ttZ1M02 1:10429 output.json

Environment:
    FIGMA_ACCESS_TOKEN - Figma API 访问令牌（必需）
"""

import os
import sys
import json
import urllib.request
import urllib.error


# 颜色定义
class Colors:
    RED = '\033[0;31m'
    GREEN = '\033[0;32m'
    YELLOW = '\033[1;33m'
    NC = '\033[0m'  # No Color


def show_help():
    """显示帮助信息"""
    help_text = """
Figma API 数据获取脚本

Usage:
    {script} <file_key> <node_id> [output_file]

Arguments:
    file_key      - Figma 文件的唯一标识符
    node_id       - 要获取的节点 ID（格式：数字:数字，如 1:10429）
    output_file   - （可选）输出文件路径，默认输出到 stdout

Environment:
    FIGMA_ACCESS_TOKEN - Figma API 访问令牌（必需）

Example:
    export FIGMA_ACCESS_TOKEN='your-token-here'
    {script} 8jV7hEtURMfum06ttZ1M02 1:10429 output.json

从 Figma URL 提取 file_key 和 node_id:
URL: https://www.figma.com/design/{{file_key}}/{{file_name}}?node-id={{node_id}}
例如: https://www.figma.com/design/8jV7hEtURMfum06ttZ1M02/情人节礼遇?node-id=1-10429
    file_key: 8jV7hEtURMfum06ttZ1M02
    node_id: 1-10429（在 API 中转换为 1:10429）

Note: node_id 在 URL 中使用连字符（1-10429），但在 API 调用中需要使用冒号（1:10429）
""".format(script=os.path.basename(sys.argv[0]))
    print(help_text)


def convert_node_id(node_id):
    """
    转换 node_id 格式
    URL 格式：1-10429（连字符）
    API 格式：1:10429（冒号）
    """
    return node_id.replace('-', ':')


def fetch_figma_data(file_key, node_id, token):
    """
    从 Figma API 获取数据

    Args:
        file_key: Figma 文件 key
        node_id: 节点 ID（API 格式，使用冒号）
        token: Figma access token

    Returns:
        dict: API 响应的 JSON 数据

    Raises:
        Exception: 当 API 请求失败时
    """
    # 构建 API URL
    api_url = f'https://api.figma.com/v1/files/{file_key}/nodes?ids={node_id}'

    # 创建请求
    req = urllib.request.Request(api_url)
    req.add_header('X-Figma-Token', token)

    try:
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode())
            return data
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()
        try:
            error_data = json.loads(error_body)
            error_msg = error_data.get('err', 'Unknown error')
        except:
            error_msg = error_body
        raise Exception(f"HTTP {e.code}: {error_msg}")


def main():
    """主函数"""
    # 检查帮助参数
    if len(sys.argv) > 1 and sys.argv[1] in ['-h', '--help']:
        show_help()
        sys.exit(0)

    # 检查参数数量
    if len(sys.argv) < 3:
        print(f"{Colors.RED}Error: Missing required arguments{Colors.NC}")
        print()
        show_help()
        sys.exit(1)

    file_key = sys.argv[1]
    node_id = convert_node_id(sys.argv[2])  # 自动转换格式
    output_file = sys.argv[3] if len(sys.argv) > 3 else None

    # 检查 token
    token = os.environ.get('FIGMA_ACCESS_TOKEN')
    if not token:
        print(f"{Colors.RED}Error: FIGMA_ACCESS_TOKEN environment variable is not set{Colors.NC}")
        print()
        print("Please set the token:")
        print("    export FIGMA_ACCESS_TOKEN='your-figma-token'")
        print()
        print("You can get a token from:")
        print("    https://www.figma.com/settings (Personal access tokens section)")
        sys.exit(1)

    # 显示正在获取的信息
    print(f"{Colors.YELLOW}Fetching Figma data...{Colors.NC}")
    print(f"  File Key: {file_key}")
    print(f"  Node ID: {node_id}")

    try:
        # 获取数据
        data = fetch_figma_data(file_key, node_id, token)

        # 检查是否有错误消息
        if 'err' in data:
            print(f"{Colors.RED}Error: {data['err']}{Colors.NC}")
            sys.exit(1)

        print(f"{Colors.GREEN}Successfully fetched data{Colors.NC}")

        # 格式化输出
        formatted_json = json.dumps(data, indent=2, ensure_ascii=False)

        # 输出结果
        if output_file:
            with open(output_file, 'w', encoding='utf-8') as f:
                f.write(formatted_json)
            print(f"{Colors.GREEN}Data saved to: {output_file}{Colors.NC}")
        else:
            print(formatted_json)

    except Exception as e:
        print(f"{Colors.RED}Error: {e}{Colors.NC}")
        sys.exit(1)


if __name__ == '__main__':
    main()
