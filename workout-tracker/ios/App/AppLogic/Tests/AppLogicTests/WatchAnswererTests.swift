import XCTest
@testable import AppLogic

/// The phone answering watch taps itself from the WebView's shadow. A stub
/// engine stands in for the reducer bundle, which
/// e2e/workout-logic-bundle.spec.ts checks against the TypeScript.
final class WatchAnswererTests: XCTestCase {
    private final class StubEngine: WatchAnswerEngine {
        var calls: [(shadow: String, events: [WatchEvent], seq: Int64, now: Double)] = []
        var setNumber = 2
        var failure: Swift.Error?

        func answer(shadowJSON: String, eventsJSON: String, seq: Int64, now: Double) throws -> String {
            let events = try JSONDecoder().decode([WatchEvent].self, from: Data(eventsJSON.utf8))
            calls.append((shadowJSON, events, seq, now))
            if let failure { throw failure }
            let snapshot = String(decoding: try JSONEncoder().encode(TestSnapshots.active(seq: seq, setNumber: setNumber)), as: UTF8.self)
            let verdicts = events.map { _ in #""apply""# }.joined(separator: ",")
            return #"{"snapshot":\#(snapshot),"verdicts":[\#(verdicts)]}"#
        }
    }

    private struct Boom: Swift.Error {}

    private var engine: StubEngine!
    private var loads = 0
    private var answerer: WatchAnswerer!

    override func setUp() {
        engine = StubEngine()
        loads = 0
        answerer = WatchAnswerer { [unowned self] in
            self.loads += 1
            return self.engine
        }
    }

    private let tap = WatchEvent(id: "t1", at: 1_000, type: .completeSet, setId: "s", reps: 5)
    private let shadow = #"{"session":{}}"#

    func testNothingToAnswerFromBeforeTheWebViewPushesAShadow() throws {
        XCTAssertNil(try answerer.answer(pending: [tap], now: 2_000))
        XCTAssertEqual(loads, 0)
    }

    func testIdleHasNoShadowSoTapsAreLeftToTheWebView() throws {
        _ = answerer.webViewPushed(TestSnapshots.idle(seq: 10), shadowJSON: nil, pending: [], now: 2_000)
        XCTAssertNil(try answerer.answer(pending: [WatchTap.start(at: 1_000, id: "s")], now: 2_000))
    }

    func testAQueuedTapIsAnsweredFromTheShadow() throws {
        _ = answerer.webViewPushed(TestSnapshots.active(seq: 10, setNumber: 1), shadowJSON: shadow, pending: [], now: 1_500)
        let answer = try XCTUnwrap(answerer.answer(pending: [tap], now: 2_000))
        XCTAssertEqual(answer.snapshot.workout?.setNumber, 2)
        XCTAssertEqual(answer.verdicts, ["apply"])
        XCTAssertEqual(engine.calls.count, 1)
        XCTAssertEqual(engine.calls[0].shadow, shadow)
        XCTAssertEqual(engine.calls[0].events, [tap])
        XCTAssertEqual(engine.calls[0].now, 2_000)
    }

    func testTheBundleLoadsOnceAndOnlyTheFirstAnswerIsCold() throws {
        _ = answerer.webViewPushed(TestSnapshots.active(seq: 10, setNumber: 1), shadowJSON: shadow, pending: [], now: 1_500)
        XCTAssertEqual(try answerer.answer(pending: [tap], now: 2_000)?.coldStart, true)
        XCTAssertEqual(try answerer.answer(pending: [tap], now: 3_000)?.coldStart, false)
        XCTAssertEqual(loads, 1)
    }

    func testAFailedLoadIsRetriedNextTime() throws {
        var fail = true
        let answerer = WatchAnswerer { [unowned self] in
            if fail { throw Boom() }
            return self.engine
        }
        _ = answerer.webViewPushed(TestSnapshots.active(seq: 10, setNumber: 1), shadowJSON: shadow, pending: [], now: 1_500)
        XCTAssertThrowsError(try answerer.answer(pending: [tap], now: 2_000))
        fail = false
        XCTAssertNotNil(try answerer.answer(pending: [tap], now: 3_000))
    }

    // MARK: - seq

    func testAnswersAreNewerThanTheLastPushAndThanEachOther() throws {
        _ = answerer.webViewPushed(TestSnapshots.active(seq: 5_000, setNumber: 1), shadowJSON: shadow, pending: [], now: 1_500)
        let first = try XCTUnwrap(answerer.answer(pending: [tap], now: 2_000))
        XCTAssertEqual(first.snapshot.seq, 5_001, "never older than the WebView's last push")
        let second = try XCTUnwrap(answerer.answer(pending: [tap], now: 9_000))
        XCTAssertEqual(second.snapshot.seq, 9_000, "the clock when it's ahead")
    }

    func testAWebViewPushOlderThanAnAnswerIsMovedAfterIt() throws {
        _ = answerer.webViewPushed(TestSnapshots.active(seq: 10, setNumber: 1), shadowJSON: shadow, pending: [], now: 1_500)
        _ = try answerer.answer(pending: [tap], now: 9_000)
        let pushed = answerer.webViewPushed(TestSnapshots.active(seq: 8_500, setNumber: 2), shadowJSON: shadow, pending: [], now: 9_100)
        XCTAssertEqual(pushed.snapshot.seq, 9_001)
        XCTAssertEqual(pushed.snapshot.workout?.setNumber, 2)
    }

    // MARK: - WebView pushes

    func testWithNothingQueuedTheWebViewsSnapshotGoesAsIs() {
        let snapshot = TestSnapshots.active(seq: 10, setNumber: 3)
        let pushed = answerer.webViewPushed(snapshot, shadowJSON: shadow, pending: [], now: 1_500)
        XCTAssertEqual(pushed.snapshot, snapshot)
        XCTAssertNil(pushed.answer)
        XCTAssertTrue(engine.calls.isEmpty)
    }

    /// A WebView that wakes and pushes before applying the queue can't take
    /// the watch back to a set the user already finished.
    func testAPushWithTapsStillQueuedSendsTheAnswerOverThem() {
        engine.setNumber = 4
        let pushed = answerer.webViewPushed(
            TestSnapshots.active(seq: 10, setNumber: 3), shadowJSON: shadow, pending: [tap], now: 1_500)
        XCTAssertEqual(pushed.snapshot.workout?.setNumber, 4)
        XCTAssertNotNil(pushed.answer)
        XCTAssertNil(pushed.error)
    }

    func testAnEngineFailureFallsBackToTheWebViewsSnapshot() {
        engine.failure = Boom()
        let snapshot = TestSnapshots.active(seq: 10, setNumber: 3)
        let pushed = answerer.webViewPushed(snapshot, shadowJSON: shadow, pending: [tap], now: 1_500)
        XCTAssertEqual(pushed.snapshot, snapshot)
        XCTAssertNotNil(pushed.error)
    }

    func testGoingIdleClearsTheShadow() throws {
        _ = answerer.webViewPushed(TestSnapshots.active(seq: 10, setNumber: 1), shadowJSON: shadow, pending: [], now: 1_500)
        _ = answerer.webViewPushed(TestSnapshots.idle(seq: 11), shadowJSON: nil, pending: [], now: 1_600)
        XCTAssertNil(try answerer.answer(pending: [tap], now: 2_000))
    }

    func testAMalformedAnswerIsAnError() throws {
        final class Garbage: WatchAnswerEngine {
            func answer(shadowJSON: String, eventsJSON: String, seq: Int64, now: Double) throws -> String { "{}" }
        }
        let answerer = WatchAnswerer { Garbage() }
        _ = answerer.webViewPushed(TestSnapshots.active(seq: 10, setNumber: 1), shadowJSON: shadow, pending: [], now: 1_500)
        XCTAssertThrowsError(try answerer.answer(pending: [tap], now: 2_000)) { error in
            guard case WatchAnswerer.Error.malformedAnswer = error else { return XCTFail("unexpected \(error)") }
        }
    }
}

/// Small snapshots for tests.
enum TestSnapshots {
    static func active(seq: Int64, setNumber: Int) -> WatchSnapshot {
        WatchSnapshot(seq: seq, status: .active, workout: WatchWorkoutView(
            dayName: "Squat Day", setId: "set-\(setNumber)", setNumber: setNumber, setTotal: 14,
            allSetsDone: false, exerciseName: "Squat", weightLabel: "145 lbs", plateLabel: nil,
            reps: 5, maxReps: 5, isAmrap: false, isBonus: false,
            restEndTime: nil, restLocksDone: false, restAfterSetSeconds: 120))
    }

    static func idle(seq: Int64) -> WatchSnapshot {
        WatchSnapshot(seq: seq, status: .idle, workout: nil)
    }
}
