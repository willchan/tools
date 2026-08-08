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
    }
}
