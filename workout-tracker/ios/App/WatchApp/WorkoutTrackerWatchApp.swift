import SwiftUI
import WatchKit
import HealthKit

/// The Apple Watch remote (docs/adr/0002-apple-watch-remote.md). A thin
/// SwiftUI shell: what to show and when comes from AppLogic's
/// WatchRemoteState, and every workout rule stays in the phone's TypeScript.
@main
struct WorkoutTrackerWatchApp: App {
    @WKApplicationDelegateAdaptor(WatchAppDelegate.self) private var delegate
    @StateObject private var model = RemoteModel.shared

    var body: some Scene {
        WindowGroup {
            RemoteView()
                .environmentObject(model)
                .environmentObject(model.workout)
        }
    }
}

final class WatchAppDelegate: NSObject, WKApplicationDelegate {
    func applicationDidFinishLaunching() {
        Task { @MainActor in RemoteModel.shared.activate() }
    }

    /// Where the phone's HKHealthStore.startWatchApp lands (a workout opened
    /// on the phone). Also called while a watch workout is already running,
    /// e.g. one started here; WorkoutSessionController ignores it then.
    func handle(_ workoutConfiguration: HKWorkoutConfiguration) {
        Task { @MainActor in RemoteModel.shared.workoutStartedFromPhone(workoutConfiguration) }
    }
}
