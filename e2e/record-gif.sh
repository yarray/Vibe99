#!/bin/bash
# GIF 录制脚本 - 在 Xvfb 虚拟显示器上录制 Vibe99 操作
#
# 用法: record-gif.sh <feature_name> <duration_seconds> <recording_command>
#
# 示例:
#   record-gif.sh multi-pane 10 "npm run test:e2e -- --spec ./tests/pane-management.spec.js --grep 'creates new pane'"
#   record-gif.sh quake 8 "npm run test:e2e -- --spec ./tests/float-window.spec.js --grep 'quake mode'"

set -e

FEATURE_NAME="${1:-demo}"
DURATION="${2:-10}"
RECORDING_CMD="${3:-npm run test:e2e}"
DISPLAY_NUM="${RECORD_DISPLAY:-98}"
DISPLAY=":${DISPLAY_NUM}"
GIF_DIR="/app/Vibe99/docs/gifs"
GIF_PATH="${GIF_DIR}/${FEATURE_NAME}.gif"

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=== Vibe99 GIF 录制 ===${NC}"
echo "功能: ${FEATURE_NAME}"
echo "时长: ${DURATION} 秒"
echo "显示: ${DISPLAY}"
echo "输出: ${GIF_PATH}"
echo ""

# 确保 GIF 目录存在
mkdir -p "${GIF_DIR}"

# 启动 Xvfb（如果未运行）
if ! xset q &>/dev/null; then
    echo -e "${YELLOW}启动 Xvfb...${NC}"
    Xvfb "${DISPLAY}" -screen 0 1280x720x24 -ac +extension GLX +render -noreset &
    XVFB_PID=$!
    sleep 2
    echo "Xvfb PID: ${XVFB_PID}"
else
    echo "Xvfb 已在运行"
    XVFB_PID=""
fi

# 启动 tauri-driver（如果未运行）
if ! pgrep -f tauri-driver > /dev/null; then
    echo -e "${YELLOW}启动 tauri-driver...${NC}"
    ~/.cargo/bin/tauri-driver &
    TAURI_DRIVER_PID=$!
    sleep 2
    echo "tauri-driver PID: ${TAURI_DRIVER_PID}"
else
    echo "tauri-driver 已在运行"
    TAURI_DRIVER_PID=""
fi

echo ""
echo -e "${GREEN}开始录制...${NC}"

# 使用 byzanz 录制
# -d: 持续时间
# -x, -y: 起始坐标
# -w, -h: 宽度和高度
# -D: 显示器编号
byzanz-record -d "${DURATION}" -x 0 -y 0 -w 1280 -h 720 "${DISPLAY}" "${GIF_PATH}" &
BYZANZ_PID=$!

# 等待一下让录制器启动
sleep 1

# 执行录制命令（通常是 e2e 测试）
echo "执行命令: ${RECORDING_CMD}"
echo ""
eval "${RECORDING_CMD}"

# 等待录制完成
wait ${BYZANZ_PID}

# 清理
if [ -n "${XVFB_PID}" ]; then
    echo -e "${YELLOW}停止 Xvfb (PID: ${XVFB_PID})...${NC}"
    kill ${XVFB_PID} 2>/dev/null || true
fi

if [ -n "${TAURI_DRIVER_PID}" ]; then
    echo -e "${YELLOW}停止 tauri-driver (PID: ${TAURI_DRIVER_PID})...${NC}"
    kill ${TAURI_DRIVER_PID} 2>/dev/null || true
fi

# 检查结果
if [ -f "${GIF_PATH}" ]; then
    FILE_SIZE=$(du -h "${GIF_PATH}" | cut -f1)
    echo ""
    echo -e "${GREEN}✓ 录制完成!${NC}"
    echo "文件: ${GIF_PATH}"
    echo "大小: ${FILE_SIZE}"
else
    echo ""
    echo -e "${YELLOW}✗ 录制失败，文件不存在${NC}"
    exit 1
fi
