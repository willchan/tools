/**
 * Entry point of the JavaScriptCore bundle (vite.logic.config.ts): the same
 * reducer the WebView runs, for the iOS app to answer a watch tap natively
 * while the WebView is suspended. See docs/adr/0002-apple-watch-remote.md,
 * "Background taps".
 *
 * Everything reachable from here must run without a DOM: JavaScriptCore has
 * no `window`, `document`, IndexedDB or timers.
 */
import { answerWatchEvents } from '../logic/watchProtocol';
import type { WatchEvent, WatchShadow } from '../logic/watchProtocol';

/**
 * `answerWatchEvents` over JSON in and out, the simplest thing to pass
 * across JavaScriptCore: the WebView's latest shadow and the taps queued
 * natively, oldest first. Returns `{snapshot, verdicts}`.
 */
export function answer(shadowJSON: string, eventsJSON: string, seq: number, now: number): string {
  const shadow = JSON.parse(shadowJSON) as WatchShadow;
  const events = JSON.parse(eventsJSON) as WatchEvent[];
  return JSON.stringify(answerWatchEvents(shadow, events, seq, now));
}
