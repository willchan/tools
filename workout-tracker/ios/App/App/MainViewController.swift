import UIKit
import Capacitor

/// Capacitor's default CAPBridgeViewController leaves the WKWebView's
/// underlying UIScrollView with its stock scroll indicators enabled. Since
/// the app's root document scroll maps directly to that native
/// UIScrollView, CSS (`::-webkit-scrollbar`, etc.) has no effect on it —
/// it has to be turned off here instead.
class MainViewController: CAPBridgeViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        webView?.scrollView.showsVerticalScrollIndicator = false
        webView?.scrollView.showsHorizontalScrollIndicator = false

        // Capacitor's own WebViewDelegationHandler (Capacitor/Capacitor/
        // WebViewDelegationHandler.swift) implements
        // scrollViewWillBeginZooming by disabling scrollView.pinchGestureRecognizer
        // — with no matching scrollViewDidEndZooming to turn it back on. Any
        // zoom gesture (including WKWebView's own double-tap-to-zoom, which
        // that delegate doesn't otherwise touch) permanently kills pinch
        // once it fires, leaving the user stuck zoomed in with no way back.
        // src/main.ts keeps the page's own viewport meta locked to
        // maximum-scale=1.0/user-scalable=no while running natively, which
        // stops WKWebView from ever starting a zoom in the first place —
        // but that's JS applied after the document has parsed. Pin the
        // scroll view's zoom range here too, before the page has loaded or
        // the view is even on screen, so there's no window in which a zoom
        // gesture could reach WebViewDelegationHandler's one-way disable.
        webView?.scrollView.minimumZoomScale = 1.0
        webView?.scrollView.maximumZoomScale = 1.0
    }
}
