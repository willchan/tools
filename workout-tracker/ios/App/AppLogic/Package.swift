// swift-tools-version: 5.9
import PackageDescription

// A local Swift package for native logic that's worth unit-testing but
// doesn't belong in TypeScript (src/native/*). Unlike CapApp-SPM (which is
// Capacitor-CLI-managed and just vendors plugin dependencies), this package
// is ours: add real logic here, not directly in App/ or LiveActivityWidget/,
// so it gets XCTest coverage instead of relying on the Simulator-boots smoke
// test or manual on-device QA. See ios/MANUAL_SETUP.md for how this package
// is tested in CI and how it's linked into the App target.
let package = Package(
    name: "AppLogic",
    platforms: [.iOS(.v16)],
    products: [
        .library(
            name: "AppLogic",
            targets: ["AppLogic"])
    ],
    targets: [
        .target(name: "AppLogic"),
        .testTarget(name: "AppLogicTests", dependencies: ["AppLogic"])
    ]
)
