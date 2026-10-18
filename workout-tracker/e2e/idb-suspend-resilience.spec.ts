import { test, expect, type Page } from '@playwright/test';

/**
 * When iOS suspends the app mid-workout, IndexedDB requests in flight are
 * aborted on resume ("Attempt to get a record from database without an
 * in-progress transaction", plus idb's own AbortError for each transaction).
 * A real Squat Day log had 573 such errors, mostly from the 250ms rest timer
 * poll, and they kept the Settings badge lit for nothing.
 */

async function startRest(page: Page) {
  await page.addInitScript(() => {
    (window as any).__rejections = [];
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason;
      (window as any).__rejections.push(reason instanceof Error ? reason.message : String(reason));
    });
  });
  await page.goto('/');
  await page.waitForSelector('#start-workout-btn');
  await page.evaluate(async () => {
    const { clearLogs } = await import('/src/logic/logger.ts');
    await clearLogs();
  });
  await page.click('#start-workout-btn');
  await page.waitForSelector('.workout-screen');
  await page.click('[data-testid="done-set-btn"]');
  await expect(page.locator('#rest-timer')).toBeVisible();
}

async function errorLogs(page: Page) {
  return page.evaluate(async () => {
    const { getAllLogs } = await import('/src/logic/logger.ts');
    return (await getAllLogs()).filter((l) => l.level === 'error').map((l) => l.message);
  });
}

test.describe('IndexedDB suspend/resume resilience', () => {
  test('a failing rest timer read is not an unhandled rejection, and the poll recovers', async ({
    page,
  }) => {
    await startRest(page);

    // What a resumed WebKit does to a read that was in flight at suspension.
    await page.evaluate(() => {
      const original = IDBObjectStore.prototype.get;
      (window as any).__restoreGet = () => (IDBObjectStore.prototype.get = original);
      IDBObjectStore.prototype.get = function (this: IDBObjectStore, query: IDBValidKey | IDBKeyRange) {
        if (this.name === 'timer') {
          throw new DOMException(
            'Attempt to get a record from database without an in-progress transaction',
            'InvalidStateError',
          );
        }
        return original.call(this, query);
      };
    });
    await page.waitForTimeout(1_000);
    await page.evaluate(() => (window as any).__restoreGet());

    const before = await page.locator('#timer-value').textContent();
    await expect(page.locator('#timer-value')).not.toHaveText(before ?? '', { timeout: 3_000 });

    const rejections = await page.evaluate(() => (window as any).__rejections as string[]);
    expect(rejections.filter((m) => m.includes('in-progress transaction'))).toEqual([]);
    expect((await errorLogs(page)).filter((m) => m.includes('in-progress transaction'))).toEqual([]);
  });

  test('a stalled rest timer read does not pile up more reads behind it', async ({ page }) => {
    await startRest(page);

    const reads = await page.evaluate(async () => {
      let count = 0;
      const original = IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get = function (this: IDBObjectStore, query: IDBValidKey | IDBKeyRange) {
        if (this.name === 'timer' && this.transaction.mode === 'readonly') count++;
        return original.call(this, query);
      };

      // A readwrite transaction on the same store from a second connection
      // blocks every read behind it, like a suspended database does.
      const db: IDBDatabase = await new Promise((resolve, reject) => {
        const req = indexedDB.open('workout-tracker');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const tx = db.transaction('timer', 'readwrite');
      const store = tx.objectStore('timer');
      const until = Date.now() + 2_000;
      const keepAlive = () => {
        if (Date.now() < until) store.get('current').onsuccess = keepAlive;
      };
      keepAlive();
      await new Promise((resolve) => (tx.oncomplete = resolve));
      db.close();
      IDBObjectStore.prototype.get = original;
      return count;
    });

    // The 250ms poll would start ~8 reads in 2s without an in-flight guard.
    expect(reads).toBeLessThanOrEqual(2);
  });

  test("idb's AbortError for an aborted transaction is a warning, not an error", async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#start-workout-btn');
    const logs = await page.evaluate(async () => {
      const { clearLogs, getAllLogs } = await import('/src/logic/logger.ts');
      const { getDB } = await import('/src/db/database.ts');
      await clearLogs();
      const db = await getDB();
      // Nothing awaits a read transaction's tx.done, so idb's rejection of it
      // is unhandled when the transaction aborts.
      db.transaction('timer').abort();
      await new Promise((resolve) => setTimeout(resolve, 300));
      return (await getAllLogs()).map((l) => ({ level: l.level, message: l.message }));
    });

    expect(logs).toContainEqual({ level: 'warn', message: 'Unhandled rejection: AbortError' });
    expect(logs.filter((l) => l.level === 'error')).toEqual([]);
  });

  test('a write iOS cut off mid-transaction is a warning, not an error', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#start-workout-btn');
    const logs = await page.evaluate(async () => {
      const { clearLogs, getAllLogs } = await import('/src/logic/logger.ts');
      await clearLogs();
      // What a resumed WebKit rejects a write with when its transaction was
      // torn down during a suspend (e.g. a log entry's autoIncrement key).
      void Promise.reject(
        new DOMException('Attempt to generate key in database without an in-progress transaction', 'InvalidStateError'),
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      return (await getAllLogs()).map((l) => ({ level: l.level, message: l.message }));
    });

    expect(logs).toEqual([
      {
        level: 'warn',
        message: 'Unhandled rejection: Attempt to generate key in database without an in-progress transaction',
      },
    ]);
  });

  test('other unhandled rejections are still errors', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#start-workout-btn');
    const levels = await page.evaluate(async () => {
      const { clearLogs, getAllLogs } = await import('/src/logic/logger.ts');
      await clearLogs();
      void Promise.reject(new DOMException('The object is in an invalid state.', 'InvalidStateError'));
      void Promise.reject(new Error('boom'));
      await new Promise((resolve) => setTimeout(resolve, 300));
      return (await getAllLogs()).map((l) => l.level);
    });
    expect(levels).toEqual(['error', 'error']);
  });
});
