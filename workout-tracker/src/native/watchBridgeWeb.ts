import { WebPlugin } from '@capacitor/core';
import type { WatchEvent, WatchSnapshot } from '../logic/watchProtocol';
import type { ReceivedWatchEvent, WatchBridgePlugin } from './watchBridge';

/**
 * Web stand-in for the native WatchBridge plugin, for Playwright tests
 * (there's no watch in a browser). It behaves like the native side where
 * that matters to the TS: taps go into a pending queue before delivery and
 * leave it only when acked. It also records everything the TS sends, and
 * has test-only methods to play taps arriving from the watch.
 */
export class WatchBridgeWeb extends WebPlugin implements WatchBridgePlugin {
  private pending: ReceivedWatchEvent[] = [];
  private snapshots: WatchSnapshot[] = [];
  private acks: string[] = [];
  private startWatchAppCalls = 0;

  async pushSnapshot(options: { snapshot: WatchSnapshot }): Promise<void> {
    this.snapshots.push(options.snapshot);
  }

  async getPendingEvents(): Promise<{ events: ReceivedWatchEvent[] }> {
    return { events: [...this.pending] };
  }

  async ackEvent(options: { id: string }): Promise<void> {
    this.acks.push(options.id);
    this.pending = this.pending.filter((e) => e.id !== options.id);
  }

  async startWatchApp(): Promise<void> {
    this.startWatchAppCalls += 1;
  }

  /**
   * Test-only: a tap arrives from the watch. It's queued (like the native
   * disk queue), then delivered to listeners unless `deliver` is false,
   * which simulates JS being suspended when the tap came in.
   */
  async emit(options: { event: WatchEvent; deliver?: boolean }): Promise<void> {
    const received: ReceivedWatchEvent = { ...options.event, receivedAt: Date.now() };
    if (!this.pending.some((e) => e.id === received.id)) this.pending.push(received);
    if (options.deliver ?? true) this.notifyListeners('watchEvent', received);
  }

  /** Test-only: everything the TS side has sent. */
  async getRecorded(): Promise<{
    snapshots: WatchSnapshot[];
    acks: string[];
    pending: ReceivedWatchEvent[];
    startWatchAppCalls: number;
  }> {
    return {
      snapshots: [...this.snapshots],
      acks: [...this.acks],
      pending: [...this.pending],
      startWatchAppCalls: this.startWatchAppCalls,
    };
  }
}

export const watchBridgeWeb = new WatchBridgeWeb();
