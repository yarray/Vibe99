import { waitForAppReady } from '../helpers/app-launch.js';
import { cleanupApp } from '../helpers/app-cleanup.js';
import {
  waitForTerminalReady,
  waitForTerminalSessionReady,
  getTerminalRecentOutput,
  sendKeyToTerminal,
  setTerminalLocalEcho,
  getFocusedLatencyStats,
  resetLatencyStats,
} from '../helpers/terminal-helpers.js';

describe('Terminal input latency and local echo', () => {
  after(async () => {
    await cleanupApp();
  });

  it('measures backend echo latency and verifies local echo reconciliation', async () => {
    await waitForAppReady();
    await waitForTerminalReady(0);
    await waitForTerminalSessionReady(0);

    // -------------------------------------------------------------------------
    // Baseline: local echo OFF. Measure the raw backend-to-frontend latency.
    // -------------------------------------------------------------------------
    await setTerminalLocalEcho(false);
    await resetLatencyStats();

    const baselineChars = 'xyz';
    for (const char of baselineChars) {
      await sendKeyToTerminal(char);
      await browser.pause(100);
    }
    await browser.pause(800);

    const baseline = await getFocusedLatencyStats();
    console.log('[terminal-latency] baseline backend latency:', JSON.stringify(baseline));

    expect(baseline.count).toBeGreaterThanOrEqual(baselineChars.length);
    expect(baseline.avg).toBeGreaterThan(0);

    // -------------------------------------------------------------------------
    // Local echo ON: type short characters that are echoed locally.
    // -------------------------------------------------------------------------
    await setTerminalLocalEcho(true);
    await resetLatencyStats();

    const echoChars = 'abc';
    for (const char of echoChars) {
      await sendKeyToTerminal(char);
      await browser.pause(80);
    }
    await browser.pause(800);

    const echoText = await getTerminalRecentOutput(0, 10);
    console.log('[terminal-latency] terminal output with local echo:', JSON.stringify(echoText));

    // The echoed characters must be present.
    expect(echoText).toContain(echoChars);

    // They must appear only once: local echo wrote them immediately and the
    // backend echo was stripped, so the final buffer has no duplicates.
    expect(echoText).not.toContain(`${echoChars}${echoChars}`);

    const effective = await getFocusedLatencyStats();
    console.log('[terminal-latency] local-echo backend latency:', JSON.stringify(effective));

    expect(effective.count).toBeGreaterThanOrEqual(echoChars.length);
  });
});
