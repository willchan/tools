import XCTest
@testable import AppLogic

/// What the watch shows, given the phone's latest snapshot and any tap the
/// watch has sent but the phone hasn't answered yet. The watch applies no
/// workout rules (ADR 0002): everything here comes from the snapshot, except
/// the short local guesses made while a tap is on its way to the phone.
final class WatchRemoteStateTests: XCTestCase {
    private let t0: Double = 1_759_100_000_000

    private func workout(
        setId: String = "w/0/squat",
        allSetsDone: Bool = false,
        restEndTime: Double? = nil,
        restLocksDone: Bool = false,
        restAfterSetSeconds: Double? = 90
    ) -> WatchWorkoutView {
        WatchWorkoutView(
            dayName: "Squat Day", setId: setId, setNumber: 1, setTotal: 3, allSetsDone: allSetsDone,
            exerciseName: "Barbell Squat", weightLabel: "145 lbs", plateLabel: "45 + 5 per side",
            reps: 5, maxReps: 5, isAmrap: false, isBonus: false, restEndTime: restEndTime,
            restLocksDone: restLocksDone, restAfterSetSeconds: restAfterSetSeconds)
    }

    private func active(_ seq: Int64, _ w: WatchWorkoutView) -> WatchSnapshot {
        WatchSnapshot(seq: seq, status: .active, workout: w)
    }

    private func idle(_ seq: Int64) -> WatchSnapshot {
        WatchSnapshot(seq: seq, status: .idle, workout: nil)
    }

    private func activeDisplay(_ state: WatchRemoteState, now: Double,
                               file: StaticString = #filePath, line: UInt = #line) throws -> ActiveWatchDisplay {
        guard case .active(let display) = state.display(now: now) else {
            XCTFail("expected an active display, got \(state.display(now: now))", file: file, line: line)
            throw XCTSkip()
        }
        return display
    }

    // MARK: - Snapshots

    func testWithNoSnapshotItIsIdle() {
        XCTAssertEqual(WatchRemoteState().display(now: t0), .idle(awaitingPhone: false, waitingForPhone: false))
    }

    func testAnIdleSnapshotIsIdle() {
        var state = WatchRemoteState()
        state.receive(idle(1))
        XCTAssertEqual(state.display(now: t0), .idle(awaitingPhone: false, waitingForPhone: false))
    }

    func testAnActiveSnapshotIsShownAsIs() throws {
        var state = WatchRemoteState()
        XCTAssertTrue(state.receive(active(1, workout())))
        let display = try activeDisplay(state, now: t0)
        XCTAssertEqual(display.workout, workout())
        XCTAssertNil(display.restEndTime)
        XCTAssertNil(display.restRemainingSeconds)
        XCTAssertTrue(display.doneEnabled)
        XCTAssertFalse(display.awaitingPhone)
        XCTAssertFalse(display.waitingForPhone)
    }

    func testAnOlderSnapshotIsIgnored() throws {
        var state = WatchRemoteState()
        state.receive(active(5, workout(setId: "new")))
        XCTAssertFalse(state.receive(active(4, workout(setId: "old"))))
        XCTAssertEqual(try activeDisplay(state, now: t0).workout.setId, "new")
    }

    /// e.g. WCSession's receivedApplicationContext at launch.
    func testCanStartFromTheLastSnapshotSeen() throws {
        let state = WatchRemoteState(lastSnapshot: active(5, workout()))
        XCTAssertEqual(try activeDisplay(state, now: t0).workout, workout())
        var seeded = state
        XCTAssertFalse(seeded.receive(active(5, workout(setId: "same seq"))))
    }

    // MARK: - Rest

    func testRestCountsDownToThePhonesEndTime() throws {
        var state = WatchRemoteState()
        state.receive(active(1, workout(restEndTime: t0 + 90_000)))
        let display = try activeDisplay(state, now: t0 + 30_500)
        XCTAssertEqual(display.restEndTime, t0 + 90_000)
        XCTAssertEqual(display.restRemainingSeconds, 60, "rounds up, so 0 only once rest is over")
        XCTAssertNil(try activeDisplay(state, now: t0 + 90_000).restRemainingSeconds)
    }

    func testDoneIsLockedDuringRestOnlyWhenThePhoneSaysSo() throws {
        var locked = WatchRemoteState()
        locked.receive(active(1, workout(restEndTime: t0 + 90_000, restLocksDone: true)))
        XCTAssertFalse(try activeDisplay(locked, now: t0).doneEnabled)
        XCTAssertTrue(try activeDisplay(locked, now: t0 + 90_000).doneEnabled)

        var unlocked = WatchRemoteState()
        unlocked.receive(active(1, workout(restEndTime: t0 + 90_000, restLocksDone: false)))
        XCTAssertTrue(try activeDisplay(unlocked, now: t0).doneEnabled)
    }

    func testDoneIsOffOnceEverySetIsDone() throws {
        var state = WatchRemoteState()
        state.receive(active(1, workout(allSetsDone: true)))
        let display = try activeDisplay(state, now: t0)
        XCTAssertFalse(display.doneEnabled)
        XCTAssertTrue(display.workout.allSetsDone, "the view shows Finish instead")
    }

    // MARK: - Taps waiting for the phone

    /// Done starts the phone-supplied rest locally right away, from the tap
    /// time, rather than waiting a round trip for the next snapshot.
    func testCompletingASetStartsItsRestLocallyUntilThePhoneAnswers() throws {
        var state = WatchRemoteState()
        state.receive(active(1, workout(restAfterSetSeconds: 90)))
        state.record(WatchTap.completeSet(setId: "w/0/squat", reps: 5, at: t0, id: "a"))

        let display = try activeDisplay(state, now: t0 + 1_000)
        XCTAssertEqual(display.restEndTime, t0 + 90_000)
        XCTAssertEqual(display.restRemainingSeconds, 89)
        XCTAssertTrue(display.awaitingPhone)
        XCTAssertFalse(display.doneEnabled, "one tap at a time")
        XCTAssertFalse(display.waitingForPhone, "the phone usually answers well within the threshold")
    }

    func testCompletingASetThatStartsNoRestShowsNoRest() throws {
        var state = WatchRemoteState()
        state.receive(active(1, workout(restAfterSetSeconds: nil)))
        state.record(WatchTap.completeSet(setId: "w/0/squat", reps: 5, at: t0, id: "a"))
        XCTAssertNil(try activeDisplay(state, now: t0 + 1_000).restEndTime)
    }

    func testSkippingRestEndsItLocally() throws {
        var state = WatchRemoteState()
        state.receive(active(1, workout(restEndTime: t0 + 90_000, restLocksDone: true)))
        state.record(WatchTap.skipRest(setId: "w/0/squat", at: t0 + 10_000, id: "s"))
        XCTAssertNil(try activeDisplay(state, now: t0 + 11_000).restEndTime)
    }

    func testAdjustingRestMovesItLocally() throws {
        var state = WatchRemoteState()
        state.receive(active(1, workout(restEndTime: t0 + 90_000)))
        state.record(WatchTap.adjustRest(setId: "w/0/squat", deltaSeconds: 15, at: t0 + 10_000, id: "r"))
        XCTAssertEqual(try activeDisplay(state, now: t0 + 11_000).restEndTime, t0 + 105_000)
    }

    /// Any newer snapshot is the phone's answer, whether it applied the tap
    /// or rejected it as stale (it pushes a fresh snapshot either way).
    func testTheNextSnapshotReplacesTheLocalGuess() throws {
        var state = WatchRemoteState()
        state.receive(active(1, workout()))
        state.record(WatchTap.completeSet(setId: "w/0/squat", reps: 5, at: t0, id: "a"))
        state.receive(active(2, workout(setId: "w/1/squat", restEndTime: t0 + 90_000, restLocksDone: true)))

        let display = try activeDisplay(state, now: t0 + 1_000)
        XCTAssertFalse(display.awaitingPhone)
        XCTAssertEqual(display.workout.setId, "w/1/squat")
        XCTAssertEqual(display.restEndTime, t0 + 90_000)
        XCTAssertFalse(display.doneEnabled, "locked by the phone's rest now, not by the pending tap")
    }

    func testAnIgnoredOlderSnapshotDoesNotAnswerATap() throws {
        var state = WatchRemoteState()
        state.receive(active(5, workout()))
        state.record(WatchTap.skipRest(setId: "w/0/squat", at: t0, id: "s"))
        state.receive(active(4, workout()))
        XCTAssertTrue(try activeDisplay(state, now: t0 + 1_000).awaitingPhone)
    }

    /// ADR 0002: if phone JS is suspended, the watch says so and stops
    /// advancing, rather than guessing further.
    func testAnUnansweredTapTurnsIntoWaitingForIPhone() throws {
        var state = WatchRemoteState()
        state.receive(active(1, workout()))
        state.record(WatchTap.completeSet(setId: "w/0/squat", reps: 5, at: t0, id: "a"))
        let threshold = WatchRemoteState.waitingThresholdMilliseconds
        XCTAssertFalse(try activeDisplay(state, now: t0 + threshold - 1).waitingForPhone)
        XCTAssertTrue(try activeDisplay(state, now: t0 + threshold).waitingForPhone)
    }

    func testStartingFromTheWatchWaitsForThePhoneToo() {
        var state = WatchRemoteState()
        state.receive(idle(1))
        state.record(WatchTap.start(at: t0, id: "go"))
        XCTAssertEqual(state.display(now: t0 + 1_000), .idle(awaitingPhone: true, waitingForPhone: false))
        XCTAssertEqual(state.display(now: t0 + WatchRemoteState.waitingThresholdMilliseconds),
                       .idle(awaitingPhone: true, waitingForPhone: true))

        state.receive(active(2, workout()))
        guard case .active(let display) = state.display(now: t0 + 1_000) else { return XCTFail() }
        XCTAssertFalse(display.awaitingPhone)
    }

    func testWhetherAWorkoutIsShowing() {
        var state = WatchRemoteState()
        XCTAssertFalse(state.isActive)
        state.receive(active(1, workout()))
        XCTAssertTrue(state.isActive)
        state.receive(idle(2))
        XCTAssertFalse(state.isActive)
    }
}
