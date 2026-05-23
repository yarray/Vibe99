#!/bin/bash
# GIF 录制便捷脚本
#
# 用法:
#   ./scripts/record-gifs.sh              # 录制所有功能
#   ./scripts/record-gifs.sh multi-pane   # 录制单个功能
#   ./scripts/record-gifs.sh list         # 列出可录制功能

set -e

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

IMAGE_NAME="vibe99-recorder"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# 检查 Docker 镜像
check_image() {
    if ! docker image inspect "$IMAGE_NAME" &>/dev/null; then
        echo -e "${YELLOW}镜像 $IMAGE_NAME 不存在，正在构建...${NC}"
        docker build -f e2e/Dockerfile.gif -t "$IMAGE_NAME" .
    fi
}

# 可录制功能列表
declare -A FEATURES=(
    ["multi-pane"]="record-multi-pane.spec.js - 多 Pane 布局和切换"
    ["layouts"]="record-layouts.spec.js - Layout 保存/打开"
    ["quake"]="record-quake.spec.js - Quake 下拉终端"
    ["activity"]="record-activity-alert.spec.js - Activity Alert"
    ["shortcuts"]="record-shortcuts.spec.js - 快捷键操作"
    ["profiles"]="record-profiles.spec.js - Shell Profile"
    ["float"]="record-float-window.spec.js - Float Window"
    ["all"]="所有功能"
)

# 显示帮助
show_help() {
    echo "Vibe99 GIF 录制脚本"
    echo ""
    echo "用法: $0 [功能名称]"
    echo ""
    echo "可录制功能:"
    for key in "${!FEATURES[@]}"; do
        if [ "$key" != "all" ]; then
            echo "  $key - ${FEATURES[$key]}"
        fi
    done
    echo ""
    echo "其他命令:"
    echo "  list  - 列出所有可录制功能"
    echo "  all   - 录制所有功能"
    echo "  help  - 显示此帮助"
    echo ""
    echo "示例:"
    echo "  $0 multi-pane    # 录制多 pane 布局"
    echo "  $0 all           # 录制所有功能"
}

# 录制单个功能
record_feature() {
    local feature="$1"
    local spec_file=""

    case "$feature" in
        multi-pane) spec_file="record-multi-pane.spec.js" ;;
        layouts) spec_file="record-layouts.spec.js" ;;
        quake) spec_file="record-quake.spec.js" ;;
        activity) spec_file="record-activity-alert.spec.js" ;;
        shortcuts) spec_file="record-shortcuts.spec.js" ;;
        profiles) spec_file="record-profiles.spec.js" ;;
        float) spec_file="record-float-window.spec.js" ;;
        *)
            echo -e "${YELLOW}未知功能: $feature${NC}"
            echo "使用 'list' 查看可录制功能"
            exit 1
            ;;
    esac

    echo -e "${GREEN}=== 录制功能: $feature ===${NC}"
    echo "测试文件: $spec_file"
    echo ""

    cd "$PROJECT_ROOT"

    docker run --rm --privileged \
        -v "$PWD:/mnt/source:ro" \
        "$IMAGE_NAME" \
        npm run test:e2e -- "./tests/$spec_file"

    echo ""
    echo -e "${GREEN}✓ 录制完成${NC}"
    echo "检查 docs/gifs/ 目录查看生成的 GIF 文件"
}

# 录制所有功能
record_all() {
    echo -e "${GREEN}=== 录制所有功能 ===${NC}"
    echo ""

    cd "$PROJECT_ROOT"

    docker run --rm --privileged \
        -v "$PWD:/mnt/source:ro" \
        "$IMAGE_NAME" \
        npm run test:e2e -- "./tests/record-*.spec.js"

    echo ""
    echo -e "${GREEN}✓ 所有录制完成${NC}"
    echo "检查 docs/gifs/ 目录查看生成的 GIF 文件"

    # 列出生成的文件
    if [ -d "docs/gifs" ]; then
        echo ""
        echo "生成的 GIF 文件:"
        ls -lh docs/gifs/*.gif 2>/dev/null || echo "  (没有生成 GIF 文件)"
    fi
}

# 列出可录制功能
list_features() {
    echo "可录制功能:"
    echo ""
    for key in "${!FEATURES[@]}"; do
        if [ "$key" != "all" ]; then
            echo "  $key - ${FEATURES[$key]}"
        fi
    done
    echo ""
    echo "使用: $0 <功能名称>"
}

# 主程序
main() {
    local command="${1:-help}"

    case "$command" in
        help|--help|-h)
            show_help
            ;;
        list)
            list_features
            ;;
        all)
            check_image
            record_all
            ;;
        *)
            check_image
            record_feature "$command"
            ;;
    esac
}

main "$@"
