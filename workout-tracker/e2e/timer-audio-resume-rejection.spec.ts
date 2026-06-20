import { test, expect } from '@playwright/test';

/**
 * Regression test for the iOS PWA "Failed to start the audio device" error.
 *
 * When the app resumes from a long background, iOS WebKit interrupts the audio
 * session and AudioContext.resume() rejects with "Failed to start the audio
 * device". The beep path fires-and-forgets that promise, so the rejection used
 * to surface as an unhandledrejection and get logged as an error.
 *
 * The fix attaches a .catch() to the resume() promises, so a failed audio
 * resume must NOT produce an unhandled rejection — the notification and
 * vibration still alert the user.
 */
test.describe('Timer audio resume rejection', () => {
  test('rejected AudioContext.resume() does not surface as an unhandled rejection', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (window as any).__rejections = [];
      window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason;
        (window as any).__rejections.push(
          reason instanceof Error ? reason.message : String(reason),
        );
      });

      // Force resume() to reject exactly like iOS does after a long background.
      const Orig = window.AudioContext;
      class FailingResumeAudioContext extends Orig {
        resume(): Promise<void> {
          return Promise.reject(new DOMException('Failed to start the audio device'));
        }
      }
      (window as any).AudioContext = FailingResumeAudioContext;
      (window as any).webkitAudioContext = FailingResumeAudioContext;
    });

    await page.goto('/');
    await page.waitForSelector('#app');
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');

    await page.click('[data-testid="done-set-btn"]');
    await expect(page.locator('#rest-timer')).toBeVisible();

    // Expire the timer so fireTimerNotification() -> playBeepPattern() runs.
    await page.evaluate(async () => {
      const { putTimerState } = await import('/src/db/database.ts');
      await putTimerState({
        expectedEndTime: Date.now() - 1000,
        durationMs: 90000,
      });
    });

    await page.waitForSelector('[data-testid="timer-expired"]', { timeout: 5000 });
    // Give the rejected resume() promise a chance to surface.
    await page.waitForTimeout(500);

    const rejections = await page.evaluate(() => (window as any).__rejections as string[]);
    expect(rejections.filter((m) => m.includes('Failed to start the audio device'))).toEqual([]);
  });
});
