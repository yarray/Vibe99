# GIF 录制指南

本文档说明如何使用 Docker 镜像录制 Vibe99 功能演示 GIF。

## 原理

Vibe99 的 e2e 测试在 Docker 容器中通过 Xvfb（X Virtual Framebuffer）运行，提供一个虚拟显示环境。我们可以使用 `byzanz-record` 工具捕获这个虚拟显示的内容，生成 GIF 动图。

## 快速开始

### 1. 构建录制镜像

```bash
docker build -f e2e/Dockerfile.gif -t vibe99-recorder .
```

### 2. 录制单个功能

```bash
# 录制多 pane 布局
docker run --rm --privileged \
  -v $PWD:/mnt/source:ro \
  vibe99-recorder \
  npm run test:e2e -- ./recordings/record-multi-pane.spec.js

# 录制 layout 功能
docker run --rm --privileged \
  -v $PWD:/mnt/source:ro \
  vibe99-recorder \
  npm run test:e2e -- ./recordings/record-layouts.spec.js
```

### 3. 录制所有功能

```bash
docker run --rm --privileged \
  -v $PWD:/mnt/source:ro \
  vibe99-recorder \
  npm run test:e2e -- ./recordings/record-*.spec.js
```

## 可录制的功能

| 测试文件 | 功能描述 | GIF 文件名 |
|---------|---------|-----------|
| `record-multi-pane.spec.js` | 多 pane 布局和切换 | `multi-pane-layout.gif`, `navigation-mode.gif` |
| `record-layouts.spec.js` | Layout 保存/打开 | `layout-save.gif`, `layout-switch.gif` |
| `record-quake.spec.js` | Quake 下拉终端 | `quake-mode.gif` |
| `record-activity-alert.spec.js` | Activity Alert | `activity-alert.gif` |
| `record-shortcuts.spec.js` | 快捷键操作 | `command-palette.gif`, `tab-switcher.gif`, `shortcuts-help.gif` |
| `record-profiles.spec.js` | Shell Profile | `shell-profiles.gif`, `profile-switch.gif` |
| `record-float-window.spec.js` | Float Window | `float-window.gif` |

## 录制参数调整

可以在测试文件中调整录制参数：

```javascript
// 录制时长（秒）
startRecording('feature-name', 10);

// 录制区域
startRecording('feature-name', 10, {
  width: 1280,  // 默认
  height: 720,  // 默认
});
```

## GIF 输出目录

所有录制的 GIF 会保存到 `docs/gifs/` 目录。

## 优化 GIF 大小

如果 GIF 文件过大，可以使用 FFmpeg 进一步优化：

```bash
# 减小帧率
ffmpeg -i input.gif -vf "fps=15,scale=900:-1" -f gif output.gif

# 使用 gifsicle 优化
gifsicle -O3 --lossy=30 input.gif -o output.gif

# 减小颜色数
ffmpeg -i input.gif -vf "scale=900:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" output.gif
```

## 故障排查

### byzanz-record 未找到

确保使用 `e2e/Dockerfile.gif` 构建的镜像，它包含 `byzanz` 包。

### 录制为空

1. 确保应用在录制时间内有可见活动
2. 增加录制时长
3. 检查 DISPLAY 环境变量是否正确（默认 `:98`）

### 权限错误

必须使用 `--privileged` 参数运行容器，WebKitWebDriver 需要特定的文件描述符操作。

## 本地运行（不使用 Docker）

如果你有 Linux 桌面环境，也可以直接运行录制：

```bash
# 安装依赖
sudo apt install byzanz xvfb

# 启动 Xvfb
Xvfb :98 -screen 0 1280x720x24 &
export DISPLAY=:98

# 启动 tauri-driver
~/.cargo/bin/tauri-driver &

# 运行录制测试
npm run test:e2e -- ./recordings/record-multi-pane.spec.js
```

## 技术细节

- **Xvfb**: 虚拟 X 服务器，运行在 `:98` 显示器，分辨率 1280x720
- **byzanz-record**: GNOME 桌面的录制工具，可以录制指定区域为 GIF
- **tauri-driver**: Tauri 的 WebDriver 桥接器，用于 e2e 测试控制

录制过程：
1. 启动 Xvfb 虚拟显示
2. 启动 tauri-driver
3. 启动 byzanz-record 开始录制
4. 运行 e2e 测试执行操作
5. byzanz-record 自动结束，生成 GIF
