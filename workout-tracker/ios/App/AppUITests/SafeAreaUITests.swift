import XCTest

/// Ground-truth backstop for env(safe-area-inset-*) handling.
///
/// The Playwright suite (workout-tracker/e2e/safe-area.spec.ts) proves the
/// app's CSS *responds correctly* to a mocked inset value, because
/// Chromium/WebKit builds run outside a real WKWebView and never resolve
/// env(safe-area-inset-*) to anything but 0. This test is the other half:
/// it proves the compiled app, running in an actual WKWebView on a
/// notched/Dynamic-Island Simulator, actually *reports* a real inset and
/// that the header visibly clears it — the one thing Playwright cannot see.
///
/// Kept intentionally minimal (see ios/MANUAL_SETUP.md's "Test coverage
/// layers" — thoroughness lives in the Playwright suite, this is a
/// backstop). The threshold below is deliberately loose: it isn't trying to
/// pin the exact Dynamic Island inset (that varies across simulator/OS
/// versions), just to fail against the pre-fix layout (header pinned at
/// y≈0) and pass against the fix (header pushed down to clear the inset).
final class SafeAreaUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testHeaderTitleClearsTheTopSafeArea() throws {
        let app = XCUIApplication()
        app.launch()

        // The header's <h1> ("Workout Tracker") renders inside the
        // WKWebView; WKWebView content participates in the accessibility
        // tree, so XCUIApplication can find it like any native element.
        let title = app.staticTexts["Workout Tracker"]
        XCTAssertTrue(
            title.waitForExistence(timeout: 30),
            "header title never appeared — the web bundle may not have loaded"
        )

        // Pre-fix, .app-header had a flat 16px top padding regardless of
        // device, so the title sat at y ≈ 16-25pt on any notched device.
        // Post-fix it additionally claims env(safe-area-inset-top), which
        // is at least ~44pt on every notched/Dynamic-Island device Xcode
        // ships a Simulator for. 40pt clears the pre-fix value with margin
        // while staying safely under every real device's actual inset, so
        // it fails against the regression and passes against the fix
        // without hardcoding a specific device's exact inset pixel value.
        let minimumY: CGFloat = 40
        XCTAssertGreaterThanOrEqual(
            title.frame.origin.y,
            minimumY,
            "header title rendered under the notch/Dynamic Island (y=\(title.frame.origin.y)) — "
                + "the header must claim env(safe-area-inset-top)"
        )
    }

    func testBottomNavStaysWithinTheSafeAreaLayoutGuide() throws {
        let app = XCUIApplication()
        app.launch()

        // Wait for the header title first, same as the other test above,
        // rather than querying the nav button immediately after launch: on
        // a cold launch WKWebView's accessibility bridge can take a while
        // to finish exposing the DOM as native elements, and interactive
        // controls (buttons) have lagged noticeably behind simple static
        // text in practice — querying app.buttons["Home"] as the very first
        // lookup timed out even though the button was on screen the whole
        // time. Anchoring on the title first (which the other test proves
        // resolves reliably) gives the bridge more time to settle before we
        // ask it about anything interactive.
        let title = app.staticTexts["Workout Tracker"]
        XCTAssertTrue(
            title.waitForExistence(timeout: 30),
            "header title never appeared — the web bundle may not have loaded"
        )

        // Any of the four nav buttons' accessibility labels works as an
        // anchor for the bottom nav row; "Home" is always present and active
        // on launch.
        let homeNavButton = app.buttons["Home"]
        XCTAssertTrue(homeNavButton.waitForExistence(timeout: 30))

        // A button's own frame always sits inside its window's frame — that
        // alone would be true whether or not .bottom-nav claims any bottom
        // inset at all, so it can't tell a working safe-area reservation
        // apart from a missing one. What can: the *gap* between the nav
        // button's bottom edge and the window's true bottom edge. .bottom-nav
        // pins to the real viewport bottom (position: fixed; bottom: 0) and
        // pads itself by env(safe-area-inset-bottom), so a nav button sits
        // above that padding — on every notched/Dynamic-Island Simulator
        // (this suite only runs pinned to one, see ios.yml) the real home
        // indicator inset is at least ~20pt. If that padding were ever
        // dropped, the button would sit flush against the window's bottom
        // edge and this gap would collapse to ~0.
        let navBottom = homeNavButton.frame.maxY
        let windowBottom = app.windows.firstMatch.frame.maxY
        let gap = windowBottom - navBottom
        let minimumGap: CGFloat = 15
        XCTAssertGreaterThanOrEqual(
            gap,
            minimumGap,
            "bottom nav sits only \(gap)pt above the window's bottom edge — "
                + ".bottom-nav must claim env(safe-area-inset-bottom)"
        )
    }
}
