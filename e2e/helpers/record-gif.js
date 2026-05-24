/**
 * GIF Recording Helper for E2E Tests
 *
 * 用于在运行 e2e 测试时录制 GIF 动图
 *
 * 用法:
 *   import { recordGif } from './helpers/record-gif.js';
 *
 *   // 在测试前开始录制
 *   await recordGif.start('feature-name', 10);
 *
 *   // 执行测试操作
 *   await doSomething();
 *
 *   // 在测试后停止录制（或等待自动结束）
 *   await recordGif.stop();
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');
const gifDir = path.join(projectRoot, 'docs', 'gifs');

let currentRecording = null;

/**
 * 确保 GIF 目录存在
 */
function ensureGifDir() {
  if (!fs.existsSync(gifDir)) {
    fs.mkdirSync(gifDir, { recursive: true });
  }
}

/**
 * 开始录制 GIF
 *
 * @param {string} featureName - 功能名称（用作文件名）
 * @param {number} duration - 录制时长（秒）
 * @param {Object} options - 配置选项
 * @param {number} options.width - 录制区域宽度 (默认: 1280)
 * @param {number} options.height - 录制区域高度 (默认: 720)
 * @param {string} options.display - X 显示器 (默认: :98)
 * @returns {Promise<string>} - GIF 文件路径
 */
export async function startGif(featureName, duration = 10, options = {}) {
  const {
    width = 1280,
    height = 720,
    display = process.env.DISPLAY || ':98',
  } = options;

  ensureGifDir();

  const gifPath = path.join(gifDir, `${featureName}.gif`);

  // 如果已有录制在进行，先停止它
  if (currentRecording) {
    await stopGif();
  }

  console.log(`[GIF] 开始录制: ${featureName} (${duration}s) → ${gifPath}`);

  // 启动 byzanz-record
  const recorder = spawn('byzanz-record', [
    '-d', duration.toString(),
    '-x', '0', '-y', '0',
    '-w', width.toString(),
    '-h', height.toString(),
    display,
    gifPath,
  ]);

  recorder.on('error', (err) => {
    console.error('[GIF] 录制进程错误:', err.message);
  });

  recorder.stderr.on('data', (data) => {
    console.log(`[GIF] ${data.toString()}`);
  });

  currentRecording = {
    process: recorder,
    path: gifPath,
    startTime: Date.now(),
    duration: duration * 1000,
  };

  return gifPath;
}

/**
 * 停止当前录制
 */
export async function stopGif() {
  if (!currentRecording) {
    console.log('[GIF] 没有正在进行的录制');
    return null;
  }

  const { process, path: gifPath } = currentRecording;

  // byzanz-record 会在指定时间后自动结束
  // 如果需要提前结束，可以 kill 进程
  process.kill('SIGTERM');

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => resolve(), 5000);
      process.on('exit', (code) => {
        clearTimeout(timeout);
        console.log(`[GIF] 录制进程退出，代码: ${code}`);
        resolve(code);
      });
      process.on('error', reject);
    });
  } catch (err) {
    console.error('[GIF] 停止录制时出错:', err.message);
  }

  currentRecording = null;

  // 检查文件是否生成
  if (fs.existsSync(gifPath)) {
    const stats = fs.statSync(gifPath);
    console.log(`[GIF] ✓ 录制完成: ${gifPath} (${(stats.size / 1024).toFixed(1)} KB)`);
    return gifPath;
  } else {
    console.error(`[GIF] ✗ 录制失败，文件不存在: ${gifPath}`);
    return null;
  }
}

/**
 * 等待录制完成
 */
export async function waitForGif() {
  if (!currentRecording) {
    return null;
  }

  const { process, path: gifPath, duration, startTime } = currentRecording;
  const elapsed = Date.now() - startTime;
  const remaining = duration - elapsed;

  if (remaining > 0) {
    console.log(`[GIF] 等待录制完成... (${Math.ceil(remaining / 1000)}s)`);
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }

  return await stopGif();
}

/**
 * 检查是否正在录制
 */
export function isRecording() {
  return currentRecording !== null;
}

/**
 * 获取当前录制信息
 */
export function getCurrentRecording() {
  return currentRecording;
}

/**
 * 删除指定的 GIF 文件
 */
export function deleteGif(featureName) {
  const gifPath = path.join(gifDir, `${featureName}.gif`);
  if (fs.existsSync(gifPath)) {
    fs.unlinkSync(gifPath);
    console.log(`[GIF] 已删除: ${gifPath}`);
    return true;
  }
  return false;
}

/**
 * 列出所有已录制的 GIF
 */
export function listGifs() {
  if (!fs.existsSync(gifDir)) {
    return [];
  }

  return fs.readdirSync(gifDir)
    .filter(f => f.endsWith('.gif'))
    .map(f => {
      const fullPath = path.join(gifDir, f);
      const stats = fs.statSync(fullPath);
      return {
        name: f,
        path: fullPath,
        size: stats.size,
        sizeKB: (stats.size / 1024).toFixed(1),
      };
    });
}

/**
 * Mocha 钩子助手 - 在测试套件中自动录制
 *
 * 用法:
 *   import { recordMochaTest } from './helpers/record-gif.js';
 *
 *   before(async () => {
 *     await recordMochaTest.start('my-feature');
 *   });
 *
 *   after(async () => {
 *     await recordMochaTest.stop();
 *   });
 */
export const recordMochaTest = {
  async start(featureName, duration = 10) {
    return await startGif(featureName, duration);
  },

  async stop() {
    return await stopGif();
  },

  async wait() {
    return await waitForGif();
  },
};

// 导出便捷函数
export const recordGif = {
  start: startGif,
  stop: stopGif,
  wait: waitForGif,
  isRecording,
  getCurrentRecording,
  delete: deleteGif,
  list: listGifs,
};

export default recordGif;
