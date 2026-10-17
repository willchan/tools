#if canImport(JavaScriptCore)
import XCTest
@testable import AppLogic

/// Running the reducer bundle in JavaScriptCore. The real bundle is checked
/// to run without a DOM by e2e/workout-logic-bundle.spec.ts; these cover
/// the Swift side with small stand-in scripts.
final class WorkoutLogicEngineTests: XCTestCase {
    private let stub = """
    var WorkoutLogic = {
      probe: function (eventJSON, now) {
        var event = JSON.parse(eventJSON);
        return JSON.stringify({ verdict: 'apply', id: event.id, now: now });
      }
    };
    """

    func testProbePassesTheTapAndClockAndReturnsTheJSON() throws {
        let engine = try WorkoutLogicEngine(script: stub)
        let result = try engine.probe(eventJSON: #"{"id":"tap-1"}"#, now: 1_792_270_000_000)
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(result.utf8)) as? [String: Any])
        XCTAssertEqual(object["verdict"] as? String, "apply")
        XCTAssertEqual(object["id"] as? String, "tap-1")
        XCTAssertEqual(object["now"] as? Double, 1_792_270_000_000)
    }

    func testTheEngineCanBeCalledAgain() throws {
        let engine = try WorkoutLogicEngine(script: stub)
        let first = try engine.probe(eventJSON: #"{"id":"a"}"#, now: 1)
        let second = try engine.probe(eventJSON: #"{"id":"a"}"#, now: 1)
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
        XCTAssertThrowsError(try engine.probe(eventJSON: "{}", now: 0)) { error in
            XCTAssertEqual(error as? WorkoutLogicEngine.Error, .missingFunction("probe"))
        }
    }

    func testAThrowingCallIsAnErrorAndTheNextCallStillWorks() throws {
        let engine = try WorkoutLogicEngine(script: """
        var WorkoutLogic = { probe: function (e) { if (e === 'bad') throw new Error('nope'); return 'ok'; } };
        """)
        XCTAssertThrowsError(try engine.probe(eventJSON: "bad", now: 0)) { error in
            guard case WorkoutLogicEngine.Error.exception(let message) = error else {
                return XCTFail("unexpected \(error)")
            }
            XCTAssertTrue(message.contains("nope"), message)
        }
        XCTAssertEqual(try engine.probe(eventJSON: "good", now: 0), "ok")
    }

    func testANonStringResultIsAnError() throws {
        let engine = try WorkoutLogicEngine(script: "var WorkoutLogic = { probe: function () { return 42; } };")
        XCTAssertThrowsError(try engine.probe(eventJSON: "{}", now: 0)) { error in
            XCTAssertEqual(error as? WorkoutLogicEngine.Error, .notAString)
        }
    }
}
#endif
