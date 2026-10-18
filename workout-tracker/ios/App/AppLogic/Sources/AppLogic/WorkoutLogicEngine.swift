#if canImport(JavaScriptCore)
import Foundation
import JavaScriptCore

/// Runs the workout reducer bundle (`workout-logic.js`, built from
/// src/native/workoutLogicBundle.ts by vite.logic.config.ts) in
/// JavaScriptCore, so the phone can answer a watch tap while its WebView is
/// suspended. See docs/adr/0002-apple-watch-remote.md, "Background taps".
///
/// iOS only in practice: watchOS has no JavaScriptCore, and the watch runs
/// no workout rules anyway.
///
/// Not thread-safe: use one engine from one thread at a time.
public final class WorkoutLogicEngine: WatchAnswerEngine {
    public enum Error: Swift.Error, Equatable {
        case noContext
        /// The script threw, while loading or during a call.
        case exception(String)
        /// The bundle doesn't define `WorkoutLogic.<name>`.
        case missingFunction(String)
        case notAString
    }

    private let context: JSContext
    private var lastException: String?

    public init(script: String, sourceURL: URL? = nil) throws {
        guard let context = JSContext() else { throw Error.noContext }
        self.context = context
        context.exceptionHandler = { [weak self] _, exception in
            self?.lastException = exception?.toString() ?? "unknown exception"
        }
        context.evaluateScript(script, withSourceURL: sourceURL)
        try throwIfException()
    }

    /// `WorkoutLogic.answer`: the queued taps (JSON) through the reducer over
    /// the WebView's shadow, returning `{snapshot, verdicts}` as JSON.
    public func answer(shadowJSON: String, eventsJSON: String, seq: Int64, now: Double) throws -> String {
        try callReturningString("answer", [shadowJSON, eventsJSON, Double(seq), now])
    }

    private func callReturningString(_ name: String, _ arguments: [Any]) throws -> String {
        guard let api = context.objectForKeyedSubscript("WorkoutLogic"), api.isObject,
              let function = api.objectForKeyedSubscript(name), function.isObject else {
            throw Error.missingFunction(name)
        }
        lastException = nil
        let result = function.call(withArguments: arguments)
        try throwIfException()
        guard let result, result.isString, let string = result.toString() else { throw Error.notAString }
        return string
    }

    private func throwIfException() throws {
        guard let message = lastException else { return }
        lastException = nil
        throw Error.exception(message)
    }
}
#endif
