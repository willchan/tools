// swift-tools-version: 5.9
import PackageDescription

// A local Swift package for native logic that's worth unit-testing but
// doesn't belong in TypeScript (src/native/*). Unlike CapApp-SPM (which is
// Capacitor-CLI-managed and just vendors plugin dependencies), this package
// is ours: add real logic here, not directly in App/ or LiveActivityWidget/,
// so it gets XCTest coverage instead of relying on the Simulator-boots smoke
// test or manual on-device QA. See ios/MANUAL_SETUP.md for how this package
// is tested in CI and how it's linked into the App target.
//
// Multi-platform: the phone app and the watch app (step 3 of
// docs/adr/0002-apple-watch-remote.md) share the watch protocol types and
// queue logic here, and ios.yml runs the tests on both an iOS and a watchOS
// Simulator. watchOS 10 is the floor because workout mirroring needs it.
// Anything UIKit-only must sit behind `#if os(iOS)`.
let package = Package(
    name: "AppLogic",
    platforms: [.iOS(.v16), .watchOS(.v10)],
    products: [
        .library(
            name: "AppLogic",
            targets: ["AppLogic"])
    ],
    targets: [
        .target(name: "AppLogic"),
        .testTarget(
            name: "AppLogicTests",
            dependencies: ["AppLogic"],
            // JSON shared with e2e/watch-protocol.spec.ts, which checks the
            // same files against the TypeScript protocol.
            resources: [.copy("Fixtures")])
    ]
)
