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

    // Type a few safe, printable characters with a small gap so the latency
    // tracker can match each input to its backend echo individually.
    const baselineMarker = 'vib';
    for (const char of baselineMarker) {
      await sendKeyToTerminal(char);
      await browser.pause(80);
    }

    // Give the PTY enough time to echo everything back.
    await browser.pause(1000);

    const baseline = await getFocusedLatencyStats();
    console.log('[terminal-latency] baseline backend latency:', JSON.stringify(baseline));

    // The tracker should have recorded one sample per character.
    expect(baseline.count).toBeGreaterThanOrEqual(baselineMarker.length);
    expect(baseline.avg).toBeGreaterThan(0);

    // -------------------------------------------------------------------------
    // Local echo ON: verify that characters render without duplication.
    // -------------------------------------------------------------------------
    await setTerminalLocalEcho(true);
    await resetLatencyStats();

    // Clear the screen with a `reset` command so we can inspect the output
    // without shell-prompt noise.
    await sendKeyToTerminal('reset');
    await browser.pause(50);
    await sendKeyToTerminal('Enter');
    await browser.pause(800);

    const echoMarker = 'locEcho42';
    for (const char of echoMarker) {
      await sendKeyToTerminal(char);
      await browser.pause(60);
    }

    // Wait for the real PTY echo to arrive and be reconciled.
    await browser.pause(1000);

    const echoText = await getTerminalRecentOutput(0, 10);
    console.log('[terminal-latency] terminal output with local echo:', JSON.stringify(echoText));

    // The marker must be present.
    expect(echoText).toContain(echoMarker);

    // It must not be duplicated. A duplicated marker would mean the local echo
    // wrote it once and the backend echo was not stripped.
    const duplicatedMarker = `${echoMarker}${echoMarker}`;
    expect(echoText).not.toContain(duplicatedMarker);

    // -------------------------------------------------------------------------
    // Report the effective improvement.
    // -------------------------------------------------------------------------
    const effective = await getFocusedLatencyStats();
    console.log('[terminal-latency] local-echo backend latency:', JSON.stringify(effective));

    // Local echo does not change the actual backend round-trip time, but it
    // removes the wait for the user: keystrokes are rendered immediately by the
    // frontend. The assertion above (no duplicated marker) proves the echo was
    // reconciled correctly.
    expect(effective.count).toBeGreaterThanOrEqual(echoMarker.length);
  });
});
