const CACHE_NAME = 'workout-tracker-v1';
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
];

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

function broadcastNotificationShown() {
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      client.postMessage({ type: 'TIMER_NOTIFICATION_SHOWN' });
    }
  });
}

function showTimerNotification() {
  if (scheduledEndTime !== null && firedForEndTime === scheduledEndTime) return;
  firedForEndTime = scheduledEndTime;
  self.registration.showNotification('Rest Timer Complete', {
    body: 'Time for your next set!',
    icon: './icons/icon-192.png',
    tag: 'rest-timer',
    requireInteraction: false,
  });
  broadcastNotificationShown();
}

// Handle timer notification messages from the app
self.addEventListener('message', (event) => {
  if (!event.data) return;

  if (event.data.type === 'TIMER_DONE') {
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
