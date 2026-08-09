import UIKit
import Capacitor
import AppLogic

/// Capacitor's default CAPBridgeViewController leaves the WKWebView's
/// underlying UIScrollView with its stock scroll indicators enabled. Since
/// the app's root document scroll maps directly to that native
/// UIScrollView, CSS (`::-webkit-scrollbar`, etc.) has no effect on it —
/// it has to be turned off here instead. See AppLogic's WebViewScrollChrome
/// for the (unit-tested) implementation.
class MainViewController: CAPBridgeViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        guard let scrollView = webView?.scrollView else { return }
        WebViewScrollChrome.hideNativeIndicators(on: scrollView)
    }
}
