import XCTest

/// Loads the JSON fixtures in `Fixtures/`, which e2e/watch-protocol.spec.ts
/// also checks against the TypeScript protocol (src/logic/watchProtocol.ts).
enum Fixture {
    static let eventNames = [
        "event-start.json",
        "event-complete-set.json",
        "event-complete-set-default-reps.json",
        "event-skip-rest.json",
        "event-adjust-rest.json",
        "event-finish.json",
    ]

    static let snapshotNames = [
        "snapshot-active-first-set.json",
        "snapshot-active-resting.json",
        "snapshot-idle.json",
    ]

    static func data(_ name: String, file: StaticString = #filePath, line: UInt = #line) throws -> Data {
        let url = try XCTUnwrap(
            Bundle.module.url(forResource: name, withExtension: nil, subdirectory: "Fixtures"),
            "missing fixture \(name)", file: file, line: line)
        return try Data(contentsOf: url)
    }

    /// The fixture parsed the way Foundation parses any JSON (NSNull for
    /// null), for comparing encoded output against it key by key.
    static func object(_ name: String, file: StaticString = #filePath, line: UInt = #line) throws -> NSDictionary {
        try jsonDictionary(data(name, file: file, line: line))
    }
}

func jsonDictionary(_ data: Data) throws -> NSDictionary {
    try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? NSDictionary)
}
