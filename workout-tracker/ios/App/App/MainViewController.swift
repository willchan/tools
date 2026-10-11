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
    /// Local (app-embedded) plugins aren't found by Capacitor's plugin
    /// auto-registration, which only loads the npm plugin classes `cap sync`
    /// lists in capacitor.config.json's packageClassList, so they are
    /// registered here. This runs before the WebView loads, so the
    /// plugin's JS proxy and `Capacitor.isPluginAvailable('WatchBridge')`
    /// are in place from the page's first script.
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(WatchBridgePlugin())
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        guard let scrollView = webView?.scrollView else { return }
        WebViewScrollChrome.hideNativeIndicators(on: scrollView)
    }
}
