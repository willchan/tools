import Foundation
import HealthKit

/// Receives the workout the watch mirrors to the phone when a workout starts
/// on the watch (HKWorkoutSession.startMirroringToCompanionDevice).
///
/// The mirrored session itself carries nothing this app uses: sets and
/// snapshots travel over WatchConnectivity (ADR 0002). What matters is that
/// registering this handler lets iOS launch or wake the app in the background
/// when the watch starts a workout, so the watch's start tap reaches the
/// TypeScript without the user opening the phone. Registered from
/// AppDelegate at launch, as HealthKit requires.
final class WorkoutMirroring {
    static let shared = WorkoutMirroring()

    private let store = HKHealthStore()
    private let lock = NSLock()
    /// Held so the session isn't released while the workout runs.
    private var mirrored: HKWorkoutSession?

    func activate() {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        store.workoutSessionMirroringStartHandler = { [weak self] session in
            guard let self else { return }
            self.lock.lock()
            self.mirrored = session
            self.lock.unlock()
        }
    }
}
