import Foundation
import HealthKit
import WatchKit
import AppLogic

/// Glue between the phone link, the HealthKit workout and the view. The
/// decisions (what to show, when Done is enabled, when to buzz) are
/// AppLogic's WatchRemoteState and RestEndAlarm, tested there.
@MainActor
final class RemoteModel: ObservableObject {
    static let shared = RemoteModel()

    @Published private(set) var display: WatchDisplay = .idle(awaitingPhone: false, waitingForPhone: false)

    let workout = WorkoutSessionController()

    private let link = PhoneLink()
    private var state = WatchRemoteState()
    private var alarm = RestEndAlarm()
    private var ticker: Timer?
    private var activated = false

    func activate() {
        guard !activated else { return }
        activated = true
        link.onSnapshot = { [weak self] snapshot in self?.receive(snapshot) }
        link.activate()
        // Counts rest down and fires the rest-over haptic. The workout's
        // background mode keeps this running with the screen off.
        ticker = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
        refresh()
    }

    private func receive(_ snapshot: WatchSnapshot) {
        let wasActive = state.isActive
        guard state.receive(snapshot) else { return }
        if wasActive && !state.isActive {
            // The phone finished or abandoned the workout.
            Task { await workout.end() }
        }
        refresh()
    }

    private func refresh() {
        let now = Date().timeIntervalSince1970 * 1000
        display = state.display(now: now)
        guard case .active(let active) = display else { return }
        if alarm.shouldFire(restEnd: active.restEndTime, now: now) {
            WKInterfaceDevice.current().play(.notification)
        }
    }

    private func send(_ event: WatchEvent) {
        state.record(event)
        link.send(event)
        refresh()
    }

    private var current: ActiveWatchDisplay? {
        if case .active(let active) = display, !active.awaitingPhone { return active }
        return nil
    }

    // MARK: - Actions

    func start() {
        guard case .idle(let awaiting, _) = display, !awaiting else { return }
        send(WatchTap.start())
        Task { await workout.start() }
    }

    func workoutStartedFromPhone(_ configuration: HKWorkoutConfiguration) {
        Task { await workout.start(with: configuration) }
    }

    /// The big button: whatever WatchRemoteState says it is right now.
    func primary() {
        guard let active = current, active.primaryEnabled else { return }
        switch active.primaryAction {
        case .done: completeSet()
        case .skipRest: skipRest()
        case .finish: finish()
        }
    }

    func changeReps(by delta: Int) {
        state.adjustReps(by: delta)
        refresh()
    }

    func completeSet() {
        guard let active = current, active.doneEnabled else { return }
        send(WatchTap.completeSet(setId: active.workout.setId, reps: active.reps))
    }

    func skipRest() {
        guard let active = current, active.restEndTime != nil else { return }
        send(WatchTap.skipRest(setId: active.workout.setId))
    }

    func adjustRest(by seconds: Double) {
        guard let active = current, active.restEndTime != nil else { return }
        send(WatchTap.adjustRest(setId: active.workout.setId, deltaSeconds: seconds))
    }

    func finish() {
        guard let active = current, active.workout.allSetsDone else { return }
        send(WatchTap.finish(setId: active.workout.setId))
    }

    /// Ends only the watch's HealthKit workout, for when the phone can't
    /// (e.g. its app was closed mid-workout). The phone's workout is untouched.
    func endWatchWorkout() {
        Task { await workout.end() }
    }
}
