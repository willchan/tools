import Foundation

/// What the watch shows: the phone's latest snapshot, plus a short local
/// guess while a tap is on its way to the phone. The watch applies no workout
/// rules (ADR 0002). The guesses use only what the snapshot already says
/// (`restAfterSetSeconds`, the current rest end), and the phone's next
/// snapshot replaces them.
///
/// One tap at a time: while a tap is unanswered every action is disabled,
/// and after `waitingThresholdMilliseconds` the watch says it's waiting for
/// the iPhone instead of guessing further (e.g. phone JS is suspended).
public struct WatchRemoteState: Sendable {
    /// How long a tap can go unanswered before the watch shows "Waiting for
    /// iPhone…". A live phone answers in well under a second.
    public static let waitingThresholdMilliseconds: Double = 5_000

    public private(set) var snapshot: WatchSnapshot?
    private var gate: WatchSnapshotGate
    private var pending: WatchEvent?
    /// Reps chosen on the watch, and the set they were chosen for. Any other
    /// set shows its own prescription, so a choice never carries over.
    private var chosenReps: (setId: String, reps: Int)?

    public init(lastSnapshot: WatchSnapshot? = nil) {
        snapshot = lastSnapshot
        gate = WatchSnapshotGate(lastSeq: lastSnapshot?.seq)
    }

    /// Whether a workout is showing (the phone's last word was `active`).
    public var isActive: Bool {
        snapshot?.status == .active && snapshot?.workout != nil
    }

    /// Take a snapshot from the phone, if it's newer than the one showing.
    /// A newer snapshot also answers any pending tap: the phone pushes one
    /// whether it applied the tap or rejected it.
    @discardableResult
    public mutating func receive(_ next: WatchSnapshot) -> Bool {
        guard gate.accept(next) else { return false }
        snapshot = next
        pending = nil
        return true
    }

    /// Change the reps the watch will report for the current set, within
    /// 0...maxReps.
    public mutating func adjustReps(by delta: Int) {
        guard let workout = snapshot?.workout, snapshot?.status == .active else { return }
        let current = reps(for: workout)
        chosenReps = (workout.setId, min(max(current + delta, 0), max(workout.maxReps, 0)))
    }

    private func reps(for workout: WatchWorkoutView) -> Int {
        if let chosenReps, chosenReps.setId == workout.setId { return chosenReps.reps }
        return workout.reps
    }

    /// The tap the big button sends right now, built from exactly what the
    /// display shows (including its reps), or nil when it's disabled.
    public func primaryTap(now: Double, id: String = UUID().uuidString) -> WatchEvent? {
        guard case .active(let active) = display(now: now), active.primaryEnabled else { return nil }
        let setId = active.workout.setId
        switch active.primaryAction {
        case .done: return WatchTap.completeSet(setId: setId, reps: active.reps, at: now, id: id)
        case .skipRest: return WatchTap.skipRest(setId: setId, at: now, id: id)
        case .finish: return WatchTap.finish(setId: setId, at: now, id: id)
        }
    }

    /// A tap was just sent to the phone.
    public mutating func record(_ event: WatchEvent) {
        pending = event
    }

    public func display(now: Double) -> WatchDisplay {
        let awaiting = pending != nil
        let waiting = pending.map { now - $0.at >= Self.waitingThresholdMilliseconds } ?? false

        guard let snapshot, snapshot.status == .active, let workout = snapshot.workout else {
            return .idle(awaitingPhone: awaiting, waitingForPhone: waiting)
        }

        let restEnd = effectiveRestEnd(workout)
        let resting = restEnd.map { now < $0 } ?? false
        let phoneLocksDone = workout.restLocksDone && (workout.restEndTime.map { now < $0 } ?? false)

        let doneEnabled = !awaiting && !workout.allSetsDone && !phoneLocksDone
        let primary: WatchPrimaryAction =
            workout.allSetsDone ? .finish : (phoneLocksDone && resting ? .skipRest : .done)

        return .active(ActiveWatchDisplay(
            workout: workout,
            reps: reps(for: workout),
            restEndTime: restEnd,
            restRemainingSeconds: resting ? Int((((restEnd ?? now) - now) / 1000).rounded(.up)) : nil,
            doneEnabled: doneEnabled,
            awaitingPhone: awaiting,
            waitingForPhone: waiting,
            primaryAction: primary,
            primaryEnabled: primary == .done ? doneEnabled : !awaiting))
    }

    private func effectiveRestEnd(_ workout: WatchWorkoutView) -> Double? {
        guard let pending else { return workout.restEndTime }
        switch pending.type {
        case .completeSet:
            return workout.restAfterSetSeconds.map { pending.at + $0 * 1000 }
        case .skipRest:
            return nil
        case .adjustRest:
            return workout.restEndTime.map { $0 + (pending.deltaSeconds ?? 0) * 1000 }
        case .start, .finish:
            return workout.restEndTime
        }
    }
}

public enum WatchDisplay: Equatable, Sendable {
    /// No workout on the phone. `awaitingPhone`: a Start tap is on its way.
    case idle(awaitingPhone: Bool, waitingForPhone: Bool)
    case active(ActiveWatchDisplay)
}

public struct ActiveWatchDisplay: Equatable, Sendable {
    public let workout: WatchWorkoutView
    /// Reps Done will report: the prescription, or what was chosen on the
    /// watch for this set.
    public let reps: Int
    /// Epoch ms the rest shown ends (the phone's, or the local guess).
    public let restEndTime: Double?
    /// Whole seconds left, rounded up; nil when not resting.
    public let restRemainingSeconds: Int?
    public let doneEnabled: Bool
    /// A tap is unanswered: every action is disabled.
    public let awaitingPhone: Bool
    /// ...and has been for long enough to tell the user.
    public let waitingForPhone: Bool
    /// The watch's one big button.
    public let primaryAction: WatchPrimaryAction
    public let primaryEnabled: Bool
}

/// The single primary button the watch shows for the current moment.
public enum WatchPrimaryAction: Equatable, Sendable {
    /// Complete the current set with the chosen reps.
    case done
    /// The phone's rest locks Done until it ends: offer to skip it instead.
    case skipRest
    /// Every set is done.
    case finish
}

/// Builds the taps the watch sends. Each gets a fresh idempotency id and the
/// watch's clock as `at`, in whole epoch milliseconds.
public enum WatchTap {
    public static func start(at: Date = Date(), id: String = UUID().uuidString) -> WatchEvent {
        start(at: ms(at), id: id)
    }

    public static func start(at: Double, id: String = UUID().uuidString) -> WatchEvent {
        WatchEvent(id: id, at: at, type: .start)
    }

    public static func completeSet(setId: String, reps: Int, at: Date = Date(),
                                   id: String = UUID().uuidString) -> WatchEvent {
        completeSet(setId: setId, reps: reps, at: ms(at), id: id)
    }

    public static func completeSet(setId: String, reps: Int, at: Double,
                                   id: String = UUID().uuidString) -> WatchEvent {
        WatchEvent(id: id, at: at, type: .completeSet, setId: setId, reps: reps)
    }

    public static func skipRest(setId: String, at: Date = Date(), id: String = UUID().uuidString) -> WatchEvent {
        skipRest(setId: setId, at: ms(at), id: id)
    }

    public static func skipRest(setId: String, at: Double, id: String = UUID().uuidString) -> WatchEvent {
        WatchEvent(id: id, at: at, type: .skipRest, setId: setId)
    }

    public static func adjustRest(setId: String, deltaSeconds: Double, at: Date = Date(),
                                  id: String = UUID().uuidString) -> WatchEvent {
        adjustRest(setId: setId, deltaSeconds: deltaSeconds, at: ms(at), id: id)
    }

    public static func adjustRest(setId: String, deltaSeconds: Double, at: Double,
                                  id: String = UUID().uuidString) -> WatchEvent {
        WatchEvent(id: id, at: at, type: .adjustRest, setId: setId, deltaSeconds: deltaSeconds)
    }

    public static func finish(setId: String, at: Date = Date(), id: String = UUID().uuidString) -> WatchEvent {
        finish(setId: setId, at: ms(at), id: id)
    }

    public static func finish(setId: String, at: Double, id: String = UUID().uuidString) -> WatchEvent {
        WatchEvent(id: id, at: at, type: .finish, setId: setId)
    }

    private static func ms(_ date: Date) -> Double {
        (date.timeIntervalSince1970 * 1000).rounded()
    }
}

/// Decides when the watch plays its own rest-over haptic: once per rest, at
/// the end, and not for a rest that ended more than `graceMilliseconds` ago
/// (a late snapshot about a rest already over).
public struct RestEndAlarm: Sendable {
    /// Also the shortest gap between two buzzes, since no two rests end
    /// within it: a rest whose end moves slightly doesn't buzz twice.
    public static let graceMilliseconds: Double = 5_000

    private var lastFiredAt: Double?

    public init() {}

    public mutating func shouldFire(restEnd: Double?, now: Double) -> Bool {
        guard let restEnd, now >= restEnd, now - restEnd <= Self.graceMilliseconds else { return false }
        if let last = lastFiredAt, now - last <= Self.graceMilliseconds { return false }
        lastFiredAt = now
        return true
    }
}
