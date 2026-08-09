import type { Page } from '@playwright/test';

/**
 * Mocks env(safe-area-inset-top/bottom) for layout tests.
 *
 * Playwright's Chromium/WebKit builds never resolve env(safe-area-inset-*)
 * to a non-zero value — that only happens in the real WKWebView on a
 * notched device or a matching iOS Simulator model — so there is no way to
 * make the *browser* report a Dynamic-Island-sized inset. Instead this
 * mocks the *input* our CSS consumes: style.css resolves env() into
 * `--safe-area-inset-top`/`--safe-area-inset-bottom` custom properties once
 * at :root (see style.css), and every safe-area-aware rule reads those
 * properties rather than env() directly. Overriding the custom properties
 * with an injected, `!important` :root rule reliably wins regardless of
 * cascade order (the app's own :root rule is defined earlier in the same
 * stylesheet, so a later same-specificity rule would already win, but
 * !important removes any doubt and protects this helper against future
 * reordering of style.css) and lets us assert the app's CSS *responds
 * correctly* to whatever inset value a real device would supply.
 *
 * Call after `page.goto()` — it injects a <style> tag into the current
 * document, so it needs a document to inject into.
 */
export async function withSafeArea(
  page: Page,
  insets: { top?: number; bottom?: number }
): Promise<void> {
  const { top = 0, bottom = 0 } = insets;
  await page.addStyleTag({
    content: `:root {
      --safe-area-inset-top: ${top}px !important;
      --safe-area-inset-bottom: ${bottom}px !important;
    }`,
  });
}
