// ============================================================
// service-worker.js
// 建設業日報PWA — Service Worker
// ============================================================

const CACHE_NAME = 'kensetsu-nippo-v1';
const CACHE_VERSION = 1;

// キャッシュするリソース（オフライン対応）
const STATIC_ASSETS = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

// Firebase CDN URLs（ネットワーク優先）
const NETWORK_FIRST = [
  'https://www.gstatic.com/firebasejs/',
  'https://firestore.googleapis.com/',
  'https://identitytoolkit.googleapis.com/',
  'https://securetoken.googleapis.com/',
];

// ============================================================
// INSTALL — キャッシュにリソースを保存
// ============================================================
self.addEventListener('install', event => {
  console.log('[SW] Installing v' + CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.warn('[SW] Cache addAll partial failure:', err);
        // Continue even if some assets fail
      });
    }).then(() => self.skipWaiting())
  );
});

// ============================================================
// ACTIVATE — 古いキャッシュを削除
// ============================================================
self.addEventListener('activate', event => {
  console.log('[SW] Activating v' + CACHE_VERSION);
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => {
            console.log('[SW] Deleting old cache:', k);
            return caches.delete(k);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ============================================================
// FETCH — リクエスト戦略
// ============================================================
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Firebase / Google APIs → Network First（キャッシュしない）
  if (NETWORK_FIRST.some(prefix => url.startsWith(prefix))) {
    event.respondWith(fetch(event.request));
    return;
  }

  // POST リクエストはキャッシュしない
  if (event.request.method !== 'GET') {
    event.respondWith(fetch(event.request));
    return;
  }

  // Static assets → Cache First with Network Fallback
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) {
        // バックグラウンドでネットワーク更新
        const networkUpdate = fetch(event.request).then(response => {
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
          }
          return response;
        }).catch(() => null);
        return cached;
      }

      // キャッシュになければネットワーク取得
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200) return response;
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
        return response;
      }).catch(() => {
        // オフライン時のフォールバック
        if (event.request.headers.get('accept')?.includes('text/html')) {
          return caches.match('./index.html');
        }
        return new Response('', { status: 503 });
      });
    })
  );
});

// ============================================================
// BACKGROUND SYNC — オフライン時の保存データを再送
// ============================================================
self.addEventListener('sync', event => {
  if (event.tag === 'sync-reports') {
    console.log('[SW] Background sync triggered');
    event.waitUntil(syncPendingReports());
  }
});

async function syncPendingReports() {
  // IndexedDB などからペンディングデータを取得してFirestoreへ送信
  // （メインアプリ側のAPP.pendingSaveと連携）
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({ type: 'SYNC_PENDING' });
  });
}

// ============================================================
// PUSH NOTIFICATIONS（将来拡張用）
// ============================================================
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  self.registration.showNotification(data.title || '日報通知', {
    body: data.body || '',
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: 'nippo-notification',
  });
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      if (clients.length > 0) {
        clients[0].focus();
      } else {
        self.clients.openWindow('./index.html');
      }
    })
  );
});

// ============================================================
// MESSAGE HANDLER
// ============================================================
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
