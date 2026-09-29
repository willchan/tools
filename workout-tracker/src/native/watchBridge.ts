import { registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import type { WatchEvent, WatchSnapshot } from '../logic/watchProtocol';

/** A watch tap as handed to JS by the native side. */
export interface ReceivedWatchEvent extends WatchEvent {
  /** Epoch ms the native plugin received (and queued) the tap. */
  receivedAt: number;
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
  /** Send the latest snapshot to the watch (WCSession.updateApplicationContext). */
  pushSnapshot(options: { snapshot: WatchSnapshot }): Promise<void>;
  /** Taps queued natively that JS hasn't acked yet, oldest first. */
  getPendingEvents(): Promise<{ events: ReceivedWatchEvent[] }>;
  /** The tap is committed (or rejected for good): drop it from the native queue. */
  ackEvent(options: { id: string }): Promise<void>;
  /** Launch the watch app into a workout (HKHealthStore.startWatchApp). */
  startWatchApp(): Promise<void>;
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
