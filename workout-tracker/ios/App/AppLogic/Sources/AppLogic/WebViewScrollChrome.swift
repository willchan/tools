import UIKit

/// Configuration for the WKWebView's underlying UIScrollView that Capacitor
/// doesn't expose a config flag for, so it's set imperatively from
/// `MainViewController.viewDidLoad`.
///
/// Extracted into this package (rather than left inline in
/// `MainViewController`) purely so it has XCTest coverage — the app target
/// itself has no unit test target. See `ios/MANUAL_SETUP.md`.
public enum WebViewScrollChrome {
    /// Turns off the native scroll indicators. The app's root document
    /// scroll maps directly to this UIScrollView, so CSS
    /// (`::-webkit-scrollbar`, etc.) has no effect on it — it has to be
    /// disabled here instead.
    public static func hideNativeIndicators(on scrollView: UIScrollView) {
        scrollView.showsVerticalScrollIndicator = false
        scrollView.showsHorizontalScrollIndicator = false
    }
}
