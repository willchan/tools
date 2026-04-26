const CACHE_NAME = 'workout-tracker-v1';
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
];

// --- Diagnostic logging ---
// The SW writes directly to the same IndexedDB 'logs' store the page uses so
// timer events are captured even if the page is suspended. Opens without a
// version so we never trigger an upgrade from this side; if the store doesn't
// exist yet (very first load) the put call simply errors and we ignore it.
function swLog(level, message, context) {
  try {
    const req = indexedDB.open('workout-tracker');
    req.onsuccess = () => {
      const db = req.result;
      try {
        if (!db.objectStoreNames.contains('logs')) { db.close(); return; }
        const tx = db.transaction('logs', 'readwrite');
        const entry = { timestamp: Date.now(), level, message };
        if (context !== undefined) entry.context = String(context);
        tx.objectStore('logs').add(entry);
        tx.oncomplete = () => db.close();
        tx.onerror = () => db.close();
      } catch (_e) {
        db.close();
      }
    };
    req.onerror = () => {};
  } catch (_e) {
    // SW logging must never throw into the calling event handler.
  }
}

// Install: precache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch: network-first with cache fallback
self.addEventListener('fetch', (event) => {
  // Skip non-GET and chrome-extension requests
  if (event.request.method !== 'GET') return;
  if (event.request.url.startsWith('chrome-extension://')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful responses
        if (response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      })
      .catch(() => {
        // Network failed, try cache
        return caches.match(event.request);
      })
  );
});

// Background timer: the SW owns its own timeout so notifications fire even
// when the main thread is throttled or suspended by the browser.
let backgroundTimerTimeout = null;
// Dedupe key: the SW fires showTimerNotification at most once per
// scheduledEndTime, regardless of which path triggered it (its own setTimeout
// or a TIMER_DONE message from the page when both race at expiry).
let scheduledEndTime = null;
let firedForEndTime = null;

function broadcastNotificationShown(firedAt, expectedEndTime) {
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      client.postMessage({ type: 'TIMER_NOTIFICATION_SHOWN', firedAt, expectedEndTime });
    }
  });
}

function showTimerNotification() {
  if (scheduledEndTime !== null && firedForEndTime === scheduledEndTime) return;
  firedForEndTime = scheduledEndTime;
  const firedAt = Date.now();
  const expected = scheduledEndTime;
  const lateBy = expected !== null ? firedAt - expected : null;
  swLog('info', 'sw: notification fired', `firedAt=${firedAt} expectedEndTime=${expected} lateByMs=${lateBy} permission=${self.Notification ? self.Notification.permission : 'unsupported'}`);
  self.registration.showNotification('Rest Timer Complete', {
    body: 'Time for your next set!',
    icon: './icons/icon-192.png',
    tag: 'rest-timer',
    requireInteraction: false,
  }).then(() => {
    swLog('info', 'sw: showNotification resolved');
  }).catch((err) => {
    swLog('error', 'sw: showNotification rejected', err && err.message ? err.message : String(err));
  });
  broadcastNotificationShown(firedAt, expected);
}

// Handle timer notification messages from the app
self.addEventListener('message', (event) => {
  if (!event.data) return;

  if (event.data.type === 'TIMER_DONE') {
    swLog('info', 'sw: TIMER_DONE received');
    showTimerNotification();
  }

  if (event.data.type === 'TIMER_START') {
    // Cancel any existing background timer
    if (backgroundTimerTimeout !== null) {
      clearTimeout(backgroundTimerTimeout);
      backgroundTimerTimeout = null;
    }
    scheduledEndTime = event.data.expectedEndTime;
    firedForEndTime = null;
    const delayMs = event.data.expectedEndTime - Date.now();
    swLog(
      'info',
      'sw: timer scheduled',
      `expectedEndTime=${scheduledEndTime} delayMs=${delayMs}`,
    );
    if (delayMs <= 0) {
      showTimerNotification();
    } else {
      backgroundTimerTimeout = setTimeout(() => {
        backgroundTimerTimeout = null;
        showTimerNotification();
      }, delayMs);
    }
  }

  if (event.data.type === 'TIMER_CANCEL') {
    swLog('info', 'sw: timer cancelled');
    if (backgroundTimerTimeout !== null) {
      clearTimeout(backgroundTimerTimeout);
      backgroundTimerTimeout = null;
    }
    scheduledEndTime = null;
    firedForEndTime = null;
  }
});

// Handle notification click — focus the app
self.addEventListener('notificationclick', (event) => {
  swLog(
    'info',
    'sw: notificationclick',
    `tag=${event.notification && event.notification.tag} action=${event.action || ''}`,
  );
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      if (clients.length > 0) {
        clients[0].focus();
      } else {
        self.clients.openWindow('./');
      }
    })
  );
});
