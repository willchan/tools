import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.willchan.workouttracker',
  appName: 'Workout Tracker',
  webDir: 'dist',
  ios: {
    // 'never' (Capacitor's own default, set explicitly here as a guard
    // against that default ever changing) so UIKit never auto-adjusts the
    // WKWebView's scrollView.contentInset for the notch/home indicator.
    // 'automatic' sounds like the safer choice, but it makes UIKit apply
    // the safe-area adjustment at the native layer — and WebKit responds by
    // reporting env(safe-area-inset-*) as 0 to the page, to avoid the inset
    // being applied twice. This app's entire safe-area strategy (.app-header,
    // .rest-timer, .bottom-nav, .failure-sheet-card in style.css) is CSS-side,
    // built on env(safe-area-inset-*) resolving to the real device value —
    // 'automatic' silently breaks all of it. Caught by
    // AppUITests/SafeAreaUITests.swift's testHeaderTitleClearsTheTopSafeArea
    // failing on a real notched Simulator (header title at y=26, i.e. the
    // pre-fix position) despite the CSS fix being in place and correct.
    contentInset: 'never',
    // Capacitor's default (false) wires its own WebViewDelegationHandler in
    // as the WKWebView's UIScrollView delegate specifically to police zoom
    // (see CAPBridgeViewController.swift's prepareWebView: `if
    // !configuration.zoomingEnabled { aWebView.scrollView.delegate =
    // delegationHandler }`). That handler disables
    // scrollView.pinchGestureRecognizer the instant ANY zoom begins
    // (scrollViewWillBeginZooming) and never re-enables it — so a
    // double-tap-to-zoom (WKWebView's own gesture, untouched by that
    // handler otherwise) trips the same one-way disable a pinch would,
    // leaving the user stuck zoomed in with no way to pinch back out.
    // Setting this to true skips wiring that delegate up at all, so
    // WKWebView's normal, symmetric pinch/double-tap zoom handles both
    // directions correctly — fixing the stuck-zoom bug and, as a bonus,
    // giving native users real pinch-to-zoom accessibility (WCAG 1.4.4)
    // that this app has no in-app alternative for (no text-scaling setting
    // in src/ui/settings.ts).
    zoomEnabled: true,
  },
  plugins: {
    LocalNotifications: {
      presentationOptions: ['badge', 'sound', 'banner', 'list'],
    },
    CapacitorUpdater: {
      // GitHub Pages only serves static GETs, but the plugin's built-in
      // autoUpdate/updateUrl flow expects a POST-based update-check API — so
      // auto-update is off here and src/native/otaUpdate.ts drives the same
      // self-hosted channel manually via plain fetch() + download()/set().
      autoUpdate: false,
    },
  },
};

export default config;
