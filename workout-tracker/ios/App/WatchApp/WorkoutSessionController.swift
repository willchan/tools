import Foundation
import HealthKit
import os

private let log = Logger(subsystem: "com.willchan.workouttracker.watchkitapp", category: "Workout")

/// The watch's own HealthKit workout (traditional strength training), which
/// is what records heart rate and calories and fills the Activity rings, in
/// place of a separate Fitness app workout. It knows nothing about sets: it
/// starts when a workout starts on either device and ends when the phone
/// reports no workout running.
@MainActor
final class WorkoutSessionController: NSObject, ObservableObject {
    @Published private(set) var isRunning = false

    private let store = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?

    static func strengthTraining() -> HKWorkoutConfiguration {
        let configuration = HKWorkoutConfiguration()
        configuration.activityType = .traditionalStrengthTraining
        configuration.locationType = .indoor
        return configuration
    }

    /// Start a workout, unless one is already running. Starting from either
    /// device can reach here twice (a watch start, then the phone's
    /// startWatchApp for the workout that opened), so the second is a no-op.
    func start(with configuration: HKWorkoutConfiguration = WorkoutSessionController.strengthTraining()) async {
        guard session == nil, HKHealthStore.isHealthDataAvailable() else { return }
        let session: HKWorkoutSession
        do {
            try await store.requestAuthorization(
                toShare: [HKObjectType.workoutType()],
                read: [HKQuantityType(.heartRate), HKQuantityType(.activeEnergyBurned)])
            session = try HKWorkoutSession(healthStore: store, configuration: configuration)
        } catch {
            log.error("could not create a workout session: \(error.localizedDescription, privacy: .public)")
            return
        }
        guard self.session == nil else { return } // another start won the race while authorizing

        let builder = session.associatedWorkoutBuilder()
        builder.dataSource = HKLiveWorkoutDataSource(healthStore: store, workoutConfiguration: configuration)
        session.delegate = self
        self.session = session
        self.builder = builder
        isRunning = true

        let startDate = Date()
        session.startActivity(with: startDate)
        do {
            try await builder.beginCollection(at: startDate)
        } catch {
            log.error("could not begin collecting workout data: \(error.localizedDescription, privacy: .public)")
        }
        do {
            // Wakes the phone app in the background (iOS 17), so a workout
            // started here can reach the phone's TypeScript.
            try await session.startMirroringToCompanionDevice()
        } catch {
            log.error("could not mirror the workout to iPhone: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// End and save the workout, if one is running.
    func end() async {
        guard let session, let builder else { return }
        reset()
        session.end()
        do {
            try await builder.endCollection(at: Date())
            _ = try await builder.finishWorkout()
        } catch {
            log.error("could not save the workout: \(error.localizedDescription, privacy: .public)")
        }
    }

    private func reset() {
        session = nil
        builder = nil
        isRunning = false
    }
}

extension WorkoutSessionController: HKWorkoutSessionDelegate {
    nonisolated func workoutSession(
        _ workoutSession: HKWorkoutSession,
        didChangeTo toState: HKWorkoutSessionState,
        from fromState: HKWorkoutSessionState,
        date: Date
    ) {}

    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        log.error("workout session failed: \(error.localizedDescription, privacy: .public)")
        Task { @MainActor in
            if self.session === workoutSession { self.reset() }
        }
    }
}
