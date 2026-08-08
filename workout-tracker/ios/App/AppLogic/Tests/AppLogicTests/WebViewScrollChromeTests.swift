import XCTest
@testable import AppLogic

final class WebViewScrollChromeTests: XCTestCase {
    func testHideNativeIndicatorsTurnsBothScrollbarsOff() {
        let scrollView = UIScrollView()

        // UIScrollView defaults both of these to `true`. Assert the
        // baseline first so that if `hideNativeIndicators` ever becomes a
        // no-op (e.g. the call site is deleted), this test fails loudly
        // instead of trivially passing against an already-false default.
        XCTAssertTrue(scrollView.showsVerticalScrollIndicator)
        XCTAssertTrue(scrollView.showsHorizontalScrollIndicator)

        WebViewScrollChrome.hideNativeIndicators(on: scrollView)

        XCTAssertFalse(scrollView.showsVerticalScrollIndicator)
        XCTAssertFalse(scrollView.showsHorizontalScrollIndicator)
    }
}
