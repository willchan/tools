import Foundation
import Capacitor
import HealthKit
import AppLogic

/// Native side of the `WatchBridge` Capacitor plugin. The TS contract is
/// `WatchBridgePlugin` in src/native/watchBridge.ts, and
/// src/native/watchBridgeWeb.ts models the same semantics for Playwright.
///
/// Thin glue: the protocol types, disk queue and ack rules live in AppLogic
/// (tested there), and WatchConnectivityCoordinator owns the WCSession.
/// Registered as a local plugin instance by MainViewController.
@objc(WatchBridgePlugin)
public class WatchBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WatchBridgePlugin"
    public let jsName = "WatchBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pushSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPendingEvents", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ackEvent", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startWatchApp", returnType: CAPPluginReturnPromise)
    ]

    private let coordinator = WatchConnectivityCoordinator.shared
    private lazy var healthStore = HKHealthStore()

    override public func load() {
        coordinator.onEvent = { [weak self] event in
            guard let self else { return }
            do {
                self.notifyListeners("watchEvent", data: try event.jsObject())
            } catch {
                // Still queued on disk: the next getPendingEvents drain has it.
                CAPLog.print("⚡️ WatchBridge: could not emit watch event \(event.event.id): \(error)")
            }
        }
    }

    @objc func pushSnapshot(_ call: CAPPluginCall) {
        // The raw parsed options, so the snapshot is still plain JSON types.
        guard let object = call.options["snapshot"] else {
            return call.reject("snapshot is required")
        }
        do {
            try coordinator.push(WatchSnapshot(jsObject: object))
            call.resolve()
        } catch {
            call.reject("pushSnapshot failed: \(error)", nil, error)
        }
    }

    @objc func getPendingEvents(_ call: CAPPluginCall) {
        do {
            call.resolve(["events": try coordinator.inbox.pendingJSObjects()])
        } catch {
            call.reject("getPendingEvents failed: \(error)", nil, error)
        }
    }

    @objc func ackEvent(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            return call.reject("id is required")
        }
        do {
            try coordinator.inbox.queue.ack(id: id)
            call.resolve()
        } catch {
            // Not removed: JS retries on its next drain, and TS idempotency
            // ids make re-applying it a no-op.
            call.reject("ackEvent failed: \(error)", nil, error)
        }
    }

    /// Launch the watch app into a traditional strength training workout.
    ///
    /// Resolves without doing anything when there's no paired watch with the
    /// app installed, which is also every build until the watch target and
    /// its HealthKit entitlement exist (step 3 of ADR 0002), so this never
    /// reaches HealthKit without them.
    ///
    /// Harmless when a watch workout is already running: startWatchApp only
    /// brings the watch app forward and hands it this configuration, and the
    /// watch app's `handle(_ workoutConfiguration:)` must ignore it while it
    /// has a session (step 3).
    @objc func startWatchApp(_ call: CAPPluginCall) {
        guard coordinator.watchAppAvailable, HKHealthStore.isHealthDataAvailable() else {
            return call.resolve()
        }
        let configuration = HKWorkoutConfiguration()
        configuration.activityType = .traditionalStrengthTraining
        configuration.locationType = .indoor
        healthStore.startWatchApp(with: configuration) { _, error in
            if let error {
                call.reject("startWatchApp failed: \(error.localizedDescription)", nil, error)
            } else {
                call.resolve()
            }
        }
    }
}
