#!/bin/bash
#
# Figma API 数据获取脚本
# 从 Figma API 获取设计文件的节点数据
#
# Usage:
#   ./fetch_figma_data.sh <file_key> <node_id> [output_file]
#
# Example:
#   ./fetch_figma_data.sh 8jV7hEtURMfum06ttZ1M02 1-10429 output.json
#
# Environment:
#   FIGMA_ACCESS_TOKEN - Figma API 访问令牌（必需）

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 帮助信息
show_help() {
    echo "Figma API 数据获取脚本"
    echo ""
    echo "Usage:"
    echo "  $0 <file_key> <node_id> [output_file]"
    echo ""
    echo "Arguments:"
    echo "  file_key      - Figma 文件的唯一标识符"
    echo "  node_id       - 要获取的节点 ID"
    echo "  output_file   - （可选）输出文件路径，默认输出到 stdout"
    echo ""
    echo "Environment:"
    echo "  FIGMA_ACCESS_TOKEN - Figma API 访问令牌（必需）"
    echo ""
    echo "Example:"
    echo "  export FIGMA_ACCESS_TOKEN='your-token-here'"
    echo "  $0 8jV7hEtURMfum06ttZ1M02 1-10429 output.json"
    echo ""
    echo "从 Figma URL 提取 file_key 和 node_id:"
    echo "  URL: https://www.figma.com/design/{file_key}/{file_name}?node-id={node_id}"
    echo "  例如: https://www.figma.com/design/8jV7hEtURMfum06ttZ1M02/情人节礼遇?node-id=1-10429"
    echo "      file_key: 8jV7hEtURMfum06ttZ1M02"
    echo "      node_id: 1-10429"
}

# 检查参数
if [[ "$1" == "-h" || "$1" == "--help" ]]; then
    show_help
    exit 0
fi

if [[ -z "$1" || -z "$2" ]]; then
    echo -e "${RED}Error: Missing required arguments${NC}"
    echo ""
    show_help
    exit 1
fi

FILE_KEY="$1"
NODE_ID="$2"
OUTPUT_FILE="$3"

# 检查 token
if [[ -z "$FIGMA_ACCESS_TOKEN" ]]; then
    echo -e "${RED}Error: FIGMA_ACCESS_TOKEN environment variable is not set${NC}"
    echo ""
    echo "Please set the token:"
    echo "  export FIGMA_ACCESS_TOKEN='your-figma-token'"
    echo ""
    echo "You can get a token from:"
    echo "  https://www.figma.com/developers/api#access-tokens"
    exit 1
fi

# 获取脚本所在目录
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# 调用 Python 版本的脚本 (Python 的 urllib 在处理环境变量 token 时更可靠)
python3 "${SCRIPT_DIR}/fetch_figma_data.py" "$FILE_KEY" "$NODE_ID" $OUTPUT_FILE
