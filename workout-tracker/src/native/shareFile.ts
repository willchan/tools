import type { ShareOptions } from '@capacitor/share';

/**
 * Options for handing one written file to the native share sheet.
 *
 * The file goes in once, as `url`: iOS shares a file URL as the file itself,
 * and Capacitor's web fallback (used by the Playwright tests) passes `url`
 * through. Also listing it in `files` made the share sheet show
 * "2 Documents" and save two identical copies.
 */
export function shareOptionsForFile(uri: string, filename: string): ShareOptions {
  return { title: filename, url: uri };
}
