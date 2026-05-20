/**
 * Quake Animation Module
 *
 * Implements Quake-style dropdown/slide-up animations for the Layout window.
 * When Quake mode is enabled, the window slides in from the top or bottom
 * of the screen when shown, and slides out when hidden.
 *
 * Design principles:
 * - Smooth animations using requestAnimationFrame
 * - Respects user settings for position, duration, and height
 * - Works with Tauri v2 WebviewWindow API
 * - Independent of float-window, focused on Layout window animation
 *
 * @module quake-animation
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Quake mode configuration
 */
export interface QuakeModeConfig {
  /** Whether Quake mode is enabled */
  enabled: boolean;
  /** Animation duration in milliseconds (100-500) */
  animationDuration: number;
  /** Which edge to slide from: 'top' or 'bottom' */
  screenPosition: 'top' | 'bottom';
  /** Percentage of screen height (30-100) */
  heightPercent: number;
}

/**
 * Tauri Window API subset needed for animation
 */
export interface QuakeAnimationWindow {
  show: () => Promise<void>;
  hide: () => Promise<void>;
  setSize: (size: { width: number; height: number }) => Promise<void>;
  setPosition: (position: { x: number; y: number }) => Promise<void>;
}

/**
 * Screen information for calculating window position
 */
export interface ScreenInfo {
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Animation State
// ---------------------------------------------------------------------------

interface ActiveAnimation {
  window: QuakeAnimationWindow;
  startTime: number;
  duration: number;
  startY: number;
  endY: number;
  targetHeight: number;
  targetWidth: number;
  screenPosition: 'top' | 'bottom';
  resolve: () => void;
}

let activeAnimation: ActiveAnimation | null = null;

// ---------------------------------------------------------------------------
// Animation Helpers
// ---------------------------------------------------------------------------

/**
 * Easing function for smooth animation
 * Uses ease-out cubic for natural deceleration
 */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Get screen dimensions
 * In Tauri, we need to get the current window's monitor info
 * For simplicity, we use window.screen which gives the primary monitor
 */
function getScreenInfo(): ScreenInfo {
  return {
    width: window.screen.width,
    height: window.screen.height,
  };
}

/**
 * Calculate initial and final Y positions for the animation
 */
function calculateYPositions(
  screenHeight: number,
  windowHeight: number,
  screenPosition: 'top' | 'bottom',
): { startY: number; endY: number } {
  if (screenPosition === 'top') {
    // Start above the screen, end at y=0
    return {
      startY: -windowHeight,
      endY: 0,
    };
  } else {
    // Start below the screen, end at bottom edge
    return {
      startY: screenHeight,
      endY: screenHeight - windowHeight,
    };
  }
}

/**
 * Run a single animation frame
 */
async function runAnimationFrame(anim: ActiveAnimation, progress: number): Promise<void> {
  const easedProgress = easeOutCubic(progress);
  const currentY = anim.startY + (anim.endY - anim.startY) * easedProgress;

  // Round to integers for window positioning
  await anim.window.setPosition({
    x: 0,
    y: Math.round(currentY),
  });
}

/**
 * Main animation loop using requestAnimationFrame
 */
function runAnimationLoop(anim: ActiveAnimation): void {
  const elapsed = performance.now() - anim.startTime;
  const progress = Math.min(elapsed / anim.duration, 1);

  if (progress < 1) {
    // Continue animation
    void runAnimationFrame(anim, progress).then(() => {
      requestAnimationFrame(() => runAnimationLoop(anim));
    });
  } else {
    // Animation complete - ensure final position
    void runAnimationFrame(anim, 1).then(() => {
      activeAnimation = null;
      anim.resolve();
    });
  }
}

/**
 * Cancel any active animation
 */
function cancelActiveAnimation(): void {
  activeAnimation = null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Show the window with Quake-style dropdown animation
 *
 * @param window - The Tauri window to animate
 * @param config - Quake mode configuration
 * @returns Promise that resolves when animation completes
 */
export async function showWithQuakeAnimation(
  window: QuakeAnimationWindow,
  config: QuakeModeConfig,
): Promise<void> {
  if (!config.enabled) {
    // Quake mode disabled, just show normally
    await window.show();
    return;
  }

  // Cancel any existing animation
  cancelActiveAnimation();

  const screen = getScreenInfo();
  const targetHeight = Math.round(screen.height * (config.heightPercent / 100));
  const targetWidth = screen.width;

  const { startY, endY } = calculateYPositions(
    screen.height,
    targetHeight,
    config.screenPosition,
  );

  // Set window size first
  await window.setSize({
    width: targetWidth,
    height: targetHeight,
  });

  // Set initial position (off-screen)
  await window.setPosition({
    x: 0,
    y: startY,
  });

  // Show the window (it will be off-screen initially)
  await window.show();

  // Create animation promise
  return new Promise<void>((resolve) => {
    activeAnimation = {
      window,
      startTime: performance.now(),
      duration: config.animationDuration,
      startY,
      endY,
      targetHeight,
      targetWidth,
      screenPosition: config.screenPosition,
      resolve,
    };

    // Start animation loop
    requestAnimationFrame(() => runAnimationLoop(activeAnimation!));
  });
}

/**
 * Hide the window with Quake-style slide-up animation
 *
 * @param window - The Tauri window to animate
 * @param config - Quake mode configuration
 * @returns Promise that resolves when animation completes and window is hidden
 */
export async function hideWithQuakeAnimation(
  window: QuakeAnimationWindow,
  config: QuakeModeConfig,
): Promise<void> {
  if (!config.enabled) {
    // Quake mode disabled, just hide normally
    await window.hide();
    return;
  }

  // Cancel any existing animation
  cancelActiveAnimation();

  const screen = getScreenInfo();
  const targetHeight = Math.round(screen.height * (config.heightPercent / 100));
  const targetWidth = screen.width;

  // Get current window size to calculate slide-out position
  const { endY: currentY, startY: targetY } = calculateYPositions(
    screen.height,
    targetHeight,
    config.screenPosition,
  );

  // Set window size (in case it changed)
  await window.setSize({
    width: targetWidth,
    height: targetHeight,
  });

  // Create animation promise
  return new Promise<void>((resolve) => {
    activeAnimation = {
      window,
      startTime: performance.now(),
      duration: config.animationDuration,
      startY: currentY,
      endY: targetY,
      targetHeight,
      targetWidth,
      screenPosition: config.screenPosition,
      resolve: () => {
        // Hide window after animation completes
        void window.hide().then(() => resolve());
      },
    };

    // Start animation loop
    requestAnimationFrame(() => runAnimationLoop(activeAnimation!));
  });
}

/**
 * Check if a Quake animation is currently running
 */
export function isQuakeAnimationRunning(): boolean {
  return activeAnimation !== null;
}

/**
 * Cancel any ongoing Quake animation
 */
export function cancelQuakeAnimation(): void {
  cancelActiveAnimation();
}

// ---------------------------------------------------------------------------
// Default Configuration
// ---------------------------------------------------------------------------

/**
 * Default Quake mode configuration
 */
export const DEFAULT_QUAKE_MODE: QuakeModeConfig = {
  enabled: false,
  animationDuration: 200,
  screenPosition: 'top',
  heightPercent: 60,
};

/**
 * Parse a raw settings object into QuakeModeConfig
 * Provides defaults for missing or invalid values
 */
export function parseQuakeModeConfig(raw: unknown): QuakeModeConfig {
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    return {
      enabled: typeof obj.enabled === 'boolean' ? obj.enabled : DEFAULT_QUAKE_MODE.enabled,
      animationDuration:
        typeof obj.animationDuration === 'number'
          ? Math.max(100, Math.min(500, obj.animationDuration))
          : DEFAULT_QUAKE_MODE.animationDuration,
      screenPosition:
        obj.screenPosition === 'top' || obj.screenPosition === 'bottom'
          ? obj.screenPosition
          : DEFAULT_QUAKE_MODE.screenPosition,
      heightPercent:
        typeof obj.heightPercent === 'number'
          ? Math.max(30, Math.min(100, obj.heightPercent))
          : DEFAULT_QUAKE_MODE.heightPercent,
    };
  }
  return DEFAULT_QUAKE_MODE;
}
