import { getDB } from '../db/database';
import type { LogEntry } from '../db/types';

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

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
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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
