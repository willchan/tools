import { registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import type { WatchEvent, WatchShadow, WatchSnapshot } from '../logic/watchProtocol';

/** A watch tap as handed to JS by the native side. */
export interface ReceivedWatchEvent extends WatchEvent {
  /** Epoch ms the native plugin received (and queued) the tap. */
  receivedAt: number;
}

/**
 * The native side answering a watch tap: it ran the queued taps through the
 * reducer bundle in JavaScriptCore over the latest shadow, sent the watch
 * the result, and timed it (see WatchProbeRecord in ios/App/AppLogic).
 * `verdict` is this tap's; `error` is set when it couldn't answer (e.g.
 * `noShadow` with no workout showing). Times are epoch ms.
 */
export interface WatchProbeResult {
  eventId: string;
  /** The WatchConnectivity channel that brought the tap first. */
  channel: string;
  tapAt: number;
  receivedAt: number;
  computedAt: number;
  repliedAt: number;
  /** The bundle was loaded for this tap. */
  coldStart: boolean;
  verdict?: string;
  error?: string;
  appState?: string;
  /** Seconds; absent in the foreground. */
  backgroundTimeRemaining?: number;
}

/**
 * Our own Capacitor plugin bridging to the Apple Watch app (see
 * docs/adr/0002-apple-watch-remote.md). The native side (step 2) wraps
 * WCSession: it writes each incoming tap to a disk queue *before* acking
 * the watch, delivers it here, and removes it from the queue only once
 * ackEvent() says the tap has been committed to IndexedDB.
 *
 * The web implementation (watchBridgeWeb.ts) plays the native side in
 * Playwright tests.
 */
export interface WatchBridgePlugin {
  /**
   * Send the latest snapshot to the watch (WCSession.updateApplicationContext),
   * with the shadow it was built from (null when idle), which the native side
   * answers taps from while JS is suspended. Binaries built before that
   * ignore the shadow.
   */
  pushSnapshot(options: { snapshot: WatchSnapshot; shadow: WatchShadow | null }): Promise<void>;
  /** Taps queued natively that JS hasn't acked yet, oldest first. */
  getPendingEvents(): Promise<{ events: ReceivedWatchEvent[] }>;
  /** The tap is committed (or rejected for good): drop it from the native queue. */
  ackEvent(options: { id: string }): Promise<void>;
  /** Launch the watch app into a workout (HKHealthStore.startWatchApp). */
  startWatchApp(): Promise<void>;
  /**
   * Timings of taps answered natively since the last call. Rejects with
   * code UNIMPLEMENTED on app binaries built before that.
   */
  drainProbeResults(): Promise<{ results: WatchProbeResult[] }>;
  addListener(
    eventName: 'watchEvent',
    listener: (event: ReceivedWatchEvent) => void,
  ): Promise<PluginListenerHandle>;
}

export const WatchBridge = registerPlugin<WatchBridgePlugin>('WatchBridge', {
  // One shared instance: registerPlugin can call this factory more than once
  // if two calls race the first load, and the fake native queue must not be
  // split across instances.
  web: () => import('./watchBridgeWeb').then((m) => m.watchBridgeWeb),
});
