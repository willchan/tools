import { getDB } from '../db/database';
import type { LogEntry } from '../db/types';

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const SEEN_KEY = 'logSeenAt';

export type LogLevel = LogEntry['level'];

export async function log(
  level: LogLevel,
  message: string,
  context?: string,
  stack?: string,
): Promise<void> {
  const db = await getDB();
  const entry: LogEntry = { timestamp: Date.now(), level, message };
  if (context !== undefined) entry.context = context;
  if (stack !== undefined) entry.stack = stack;
  await db.add('logs', entry);
}

export async function getAllLogs(): Promise<LogEntry[]> {
  const db = await getDB();
  const logs = (await db.getAll('logs')) as LogEntry[];
  return logs.sort((a, b) => a.timestamp - b.timestamp);
}

export async function clearLogs(): Promise<void> {
  const db = await getDB();
  await db.clear('logs');
}

export async function pruneOldLogs(now: number = Date.now()): Promise<number> {
  const cutoff = now - RETENTION_MS;
  const db = await getDB();
  const tx = db.transaction('logs', 'readwrite');
  const index = tx.store.index('timestamp');
  let cursor = await index.openCursor(IDBKeyRange.upperBound(cutoff, true));
  let removed = 0;
  while (cursor) {
    await cursor.delete();
    removed += 1;
    cursor = await cursor.continue();
  }
  await tx.done;
  return removed;
}

let installed = false;

export function installGlobalErrorHandlers(): void {
  if (installed) return;
  installed = true;

  window.addEventListener('error', (event) => {
    const stack = event.error instanceof Error ? event.error.stack : undefined;
    const where = event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined;
    void log('error', event.message || 'Uncaught error', where, stack).catch(() => {});
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : safeStringify(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    void log('error', `Unhandled rejection: ${message}`, undefined, stack).catch(() => {});
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void pruneOldLogs().catch(() => {});
    }
  });
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export async function getLastSeenAt(): Promise<number> {
  const db = await getDB();
  return ((await db.get('state', SEEN_KEY)) as number | undefined) ?? 0;
}

export async function markErrorsSeen(now: number = Date.now()): Promise<void> {
  const db = await getDB();
  await db.put('state', now, SEEN_KEY);
}

/**
 * Distinct error messages logged since {@link markErrorsSeen} was last called.
 * Deduped by exact message text so a recurring error doesn't keep alerting.
 */
export async function getNewErrorSummary(): Promise<{ count: number; messages: string[] }> {
  const [lastSeen, logs] = await Promise.all([getLastSeenAt(), getAllLogs()]);
  const messages: string[] = [];
  const seen = new Set<string>();
  for (const entry of logs) {
    if (entry.level !== 'error') continue;
    if (entry.timestamp <= lastSeen) continue;
    if (seen.has(entry.message)) continue;
    seen.add(entry.message);
    messages.push(entry.message);
  }
  return { count: messages.length, messages };
}

/**
 * Decorate a freshly-rendered bottom-nav with a count badge on the Settings
 * button when there are unseen errors. Safe to call once per render.
 */
export async function decorateSettingsNavBadge(nav: HTMLElement): Promise<void> {
  const btn = nav.querySelector('.nav-btn[data-route="settings"]');
  if (!(btn instanceof HTMLElement)) return;
  // Strip any pre-existing badge to keep this idempotent across re-renders.
  btn.querySelector('[data-testid="nav-badge"]')?.remove();

  const { count } = await getNewErrorSummary();
  if (count <= 0) return;

  const badge = document.createElement('span');
  badge.className = 'nav-badge';
  badge.dataset.testid = 'nav-badge';
  badge.textContent = String(count);
  btn.appendChild(badge);
  btn.setAttribute('aria-label', `Settings (${count} new ${count === 1 ? 'error' : 'errors'})`);
}

/** Format logs as a single human-readable text block (handy for pasting into Claude). */
export function formatLogsAsText(logs: LogEntry[]): string {
  return logs
    .map((l) => {
      const ts = new Date(l.timestamp).toISOString();
      const head = `[${ts}] ${l.level.toUpperCase()} ${l.message}`;
      const ctx = l.context ? `\n  context: ${l.context}` : '';
      const stack = l.stack ? `\n  ${l.stack.replace(/\n/g, '\n  ')}` : '';
      return head + ctx + stack;
    })
    .join('\n');
}
