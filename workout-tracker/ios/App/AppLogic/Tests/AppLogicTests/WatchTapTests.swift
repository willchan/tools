import XCTest
@testable import AppLogic

/// The taps the watch sends: every field the phone's checkWatchEvent needs.
final class WatchTapTests: XCTestCase {
    private let at = Date(timeIntervalSince1970: 1_759_100_000.1234)

    func testCompleteSet() {
        let event = WatchTap.completeSet(setId: "s", reps: 4, at: at, id: "a")
        XCTAssertEqual(event, WatchEvent(id: "a", at: 1_759_100_000_123, type: .completeSet, setId: "s", reps: 4))
    }

    func testSkipRest() {
        XCTAssertEqual(WatchTap.skipRest(setId: "s", at: at, id: "a"),
                       WatchEvent(id: "a", at: 1_759_100_000_123, type: .skipRest, setId: "s"))
    }

    func testAdjustRest() {
        XCTAssertEqual(WatchTap.adjustRest(setId: "s", deltaSeconds: -15, at: at, id: "a"),
                       WatchEvent(id: "a", at: 1_759_100_000_123, type: .adjustRest, setId: "s", deltaSeconds: -15))
    }

    func testFinish() {
        XCTAssertEqual(WatchTap.finish(setId: "end", at: at, id: "a"),
                       WatchEvent(id: "a", at: 1_759_100_000_123, type: .finish, setId: "end"))
    }

    func testStartCarriesNoSetId() {
        XCTAssertEqual(WatchTap.start(at: at, id: "a"), WatchEvent(id: "a", at: 1_759_100_000_123, type: .start))
    }

    func testEpochMillisecondOverloadIsUsedAsIs() {
        XCTAssertEqual(WatchTap.skipRest(setId: "s", at: 42, id: "a").at, 42)
    }

    func testEachTapGetsAUniqueIdByDefault() {
        XCTAssertNotEqual(WatchTap.start().id, WatchTap.start().id)
    }

    func testDefaultTimeIsNow() {
        let before = Date().timeIntervalSince1970 * 1000
        let event = WatchTap.start()
        XCTAssertGreaterThanOrEqual(event.at, before.rounded(.down))
        XCTAssertLessThanOrEqual(event.at, Date().timeIntervalSince1970 * 1000 + 1)
    }
}

/// The watch's own haptic when rest ends: once per rest, not again when a
/// snapshot repeats the same end time, and not for a rest that ended long ago
/// (e.g. a stale snapshot arriving late).
final class RestEndAlarmTests: XCTestCase {
    private let end: Double = 1_759_100_090_000

    func testFiresOnceWhenRestEnds() {
        var alarm = RestEndAlarm()
        XCTAssertFalse(alarm.shouldFire(restEnd: end, now: end - 1))
        XCTAssertTrue(alarm.shouldFire(restEnd: end, now: end))
        XCTAssertFalse(alarm.shouldFire(restEnd: end, now: end + 1_000))
    }

    func testNeverFiresWithoutARest() {
        var alarm = RestEndAlarm()
        XCTAssertFalse(alarm.shouldFire(restEnd: nil, now: end))
    }

    func testIgnoresARestThatEndedAWhileAgo() {
        var alarm = RestEndAlarm()
        XCTAssertFalse(alarm.shouldFire(restEnd: end, now: end + RestEndAlarm.graceMilliseconds + 1))
    }

    func testFiresAgainForTheNextRest() {
        var alarm = RestEndAlarm()
        XCTAssertTrue(alarm.shouldFire(restEnd: end, now: end))
        let next = end + 200_000
        XCTAssertFalse(alarm.shouldFire(restEnd: next, now: next - 1))
        XCTAssertTrue(alarm.shouldFire(restEnd: next, now: next))
    }

    /// The local guess and the phone's answer usually agree to the
    /// millisecond (both use the tap time), but an adjusted rest moves it.
    /// Either way: one buzz per rest period.
    func testDoesNotFireTwiceForOneRestWhoseEndMovedSlightly() {
        var alarm = RestEndAlarm()
        XCTAssertTrue(alarm.shouldFire(restEnd: end, now: end))
        XCTAssertFalse(alarm.shouldFire(restEnd: end - 500, now: end + 200))
    }
}
