#if canImport(JavaScriptCore)
import XCTest
@testable import AppLogic

/// Running the reducer bundle in JavaScriptCore. The real bundle is checked
/// to run without a DOM by e2e/workout-logic-bundle.spec.ts; these cover
/// the Swift side with small stand-in scripts.
final class WorkoutLogicEngineTests: XCTestCase {
    private let stub = """
    var WorkoutLogic = {
      answer: function (shadowJSON, eventsJSON, seq, now) {
        var shadow = JSON.parse(shadowJSON);
        var events = JSON.parse(eventsJSON);
        return JSON.stringify({ day: shadow.dayName, ids: events.map(function (e) { return e.id; }), seq: seq, now: now });
      }
    };
    """

    func testAnswerPassesTheShadowTapsSeqAndClockAndReturnsTheJSON() throws {
        let engine = try WorkoutLogicEngine(script: stub)
        let result = try engine.answer(
            shadowJSON: #"{"dayName":"OHP Day"}"#, eventsJSON: #"[{"id":"tap-1"},{"id":"tap-2"}]"#,
            seq: 1_792_270_000_001, now: 1_792_270_000_000)
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(result.utf8)) as? [String: Any])
        XCTAssertEqual(object["day"] as? String, "OHP Day")
        XCTAssertEqual(object["ids"] as? [String], ["tap-1", "tap-2"])
        XCTAssertEqual(object["seq"] as? Double, 1_792_270_000_001)
        XCTAssertEqual(object["now"] as? Double, 1_792_270_000_000)
    }

    func testTheEngineCanBeCalledAgain() throws {
        let engine = try WorkoutLogicEngine(script: stub)
        let first = try engine.answer(shadowJSON: "{}", eventsJSON: "[]", seq: 1, now: 1)
        let second = try engine.answer(shadowJSON: "{}", eventsJSON: "[]", seq: 1, now: 1)
        XCTAssertEqual(first, second)
    }

    func testAScriptThatThrowsWhileLoadingIsAnError() {
        XCTAssertThrowsError(try WorkoutLogicEngine(script: "throw new Error('boom');")) { error in
            guard case WorkoutLogicEngine.Error.exception(let message) = error else {
                return XCTFail("unexpected \(error)")
            }
            XCTAssertTrue(message.contains("boom"), message)
        }
    }

    /// JavaScriptCore has no DOM: a bundle that touches one fails to load.
    func testThereIsNoWindow() {
        XCTAssertThrowsError(try WorkoutLogicEngine(script: "window.x = 1;")) { error in
            guard case WorkoutLogicEngine.Error.exception = error else {
                return XCTFail("unexpected \(error)")
            }
        }
    }

    func testAScriptWithoutTheAPIIsAnError() throws {
        let engine = try WorkoutLogicEngine(script: "var Other = {};")
        XCTAssertThrowsError(try engine.answer(shadowJSON: "{}", eventsJSON: "[]", seq: 0, now: 0)) { error in
            XCTAssertEqual(error as? WorkoutLogicEngine.Error, .missingFunction("answer"))
        }
    }

    func testAThrowingCallIsAnErrorAndTheNextCallStillWorks() throws {
        let engine = try WorkoutLogicEngine(script: """
        var WorkoutLogic = { answer: function (s) { if (s === 'bad') throw new Error('nope'); return 'ok'; } };
        """)
        XCTAssertThrowsError(try engine.answer(shadowJSON: "bad", eventsJSON: "[]", seq: 0, now: 0)) { error in
            guard case WorkoutLogicEngine.Error.exception(let message) = error else {
                return XCTFail("unexpected \(error)")
            }
            XCTAssertTrue(message.contains("nope"), message)
        }
        XCTAssertEqual(try engine.answer(shadowJSON: "good", eventsJSON: "[]", seq: 0, now: 0), "ok")
    }

    func testANonStringResultIsAnError() throws {
        let engine = try WorkoutLogicEngine(script: "var WorkoutLogic = { answer: function () { return 42; } };")
        XCTAssertThrowsError(try engine.answer(shadowJSON: "{}", eventsJSON: "[]", seq: 0, now: 0)) { error in
            XCTAssertEqual(error as? WorkoutLogicEngine.Error, .notAString)
        }
    }
}
#endif
