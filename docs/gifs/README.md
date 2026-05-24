# Feature GIFs Guide

This directory contains animated GIF demonstrations of Vibe99 features. Each GIF showcases a specific feature to help users understand the workflow and visual feedback.

## Recording Tools

### Recommended Tools

1. **Peek** (Linux) - Simple GIF recorder with clean UI
   ```bash
   sudo apt install peek
   ```
   - Select area → Record → Export as GIF
   - Adjust FPS (10-15 is usually enough for terminal apps)

2. **asciinema + agg** (Cross-platform)
   ```bash
   pip3 install asciinema-agg agg
   ```
   - Record: `asciinema rec demo.cast`
   - Convert: `agg demo.cast demo.gif`

3. **Kazam** (Linux)
   ```bash
   sudo apt install kazam
   ```
   - Record to video, then convert with FFmpeg

4. **SimpleScreenRecorder** (Linux)
   ```bash
   sudo apt install simplescreenrecorder
   ```
   - Record to MP4/WebM, convert to GIF

### Converting Video to GIF

Using FFmpeg:
```bash
ffmpeg -i input.mp4 -vf "fps=10,scale=880:-1:flags=lanczos" -c:v gif output.gif
# Or with palette for better quality:
ffmpeg -i input.mp4 -vf "fps=10,scale=880:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" output.gif
```

## GIF Guidelines

### Size & Duration
- **Duration**: 5-10 seconds maximum
- **Dimensions**: Keep under 1000px width (880px is ideal for README)
- **Frame rate**: 10-15 FPS (terminal apps don't need 60 FPS)
- **File size**: Aim for under 2 MB per GIF

### Content Guidelines
- **Show the essential workflow**: One clear use case per GIF
- **Minimize idle time**: Trim waiting periods
- **Clear contrast**: Use distinct terminal content for each pane
- **Focus on the feature**: The cursor/action should be visible

### Naming Convention
```
<feature-name>.gif
```
Examples:
- `multi-pane-layout.gif`
- `layout-save-restore.gif`
- `float-window.gif`

## Current Status

| Feature | GIF File | Status |
|---------|----------|--------|
| Multi-pane layout & switching | `multi-pane-layout.gif` | TODO |
| Layout save/restore | `layout-save-restore.gif` | TODO |
| Float Window | `float-window.gif` | TODO |
| Quake terminal | `quake-terminal.gif` | TODO |
| Profile management | `profile-management.gif` | TODO |
| Activity Alert | `activity-alert.gif` | TODO |
| Keyboard shortcuts | `keyboard-shortcuts.gif` | TODO |
| Breathing light effects | `breathing-light.gif` | TODO |

## Recording Checklist

For each feature:

1. [ ] Prepare a clean test environment
2. [ ] Set up distinct terminal content (e.g., run `top` in one, `vim` in another)
3. [ ] Position the window to capture relevant UI elements
4. [ ] Record the workflow (5-10 seconds)
5. [ ] Trim if necessary
6. [ ] Optimize file size
7. [ ] Test in dark/light theme if applicable
8. [ ] Add to this directory and update feature docs
