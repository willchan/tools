import UIKit
import WebKit
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

    /// Keep the page's JavaScript running while the app is in the
    /// background. All workout logic is TypeScript (ADR 0002), so a tap from
    /// the watch is only applied when JS runs; with WebKit's default
    /// (.suspend) a tap made while the phone app is in the background waits,
    /// queued, until the app is opened again. This only helps while iOS keeps
    /// the app process itself running, which the watch's mirrored workout
    /// session (WorkoutMirroring) is there to do.
    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let configuration = super.webViewConfiguration(for: instanceConfiguration)
        configuration.preferences.inactiveSchedulingPolicy = .none
        return configuration
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        guard let scrollView = webView?.scrollView else { return }
        WebViewScrollChrome.hideNativeIndicators(on: scrollView)
    }
}
