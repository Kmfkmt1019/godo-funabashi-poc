/**
 * Service Worker
 * 指示書 §4「オフライン起動: Service Worker + Cache Storage」に対応。
 *
 * 方針:
 *  - 起動に必要なファイル(App Shell)だけをキャッシュする
 *  - GET かつ 同一オリジンのリクエストだけを扱う（GASへのAPI通信は素通しする）
 *  - PoCなので「毎回キャッシュを作り直す」(§8のトラブルシュート欄の通り)。
 *    キャッシュ名にバージョン番号を持たせているので、CACHE_VERSION の数字を
 *    上げるだけで確実に作り直せる。
 */

var CACHE_VERSION = 'v1';
var CACHE_NAME = 'godo-poc-cache-' + CACHE_VERSION;

var APP_SHELL = [
  './',
  './index.html',
  './weight-mock.html',
  './manifest.json',
  './css/style.css',
  './js/db.js',
  './js/api.js',
  './js/sync.js',
  './js/app.js',
  './js/weight-mock.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(APP_SHELL);
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (key) { return key !== CACHE_NAME; })
          .map(function (key) { return caches.delete(key); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;

  // GET以外（POSTなど）は素通し。GASへのAPI通信を邪魔しないため。
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  // 別オリジン（GASのAPI等）はキャッシュ対象外。ネットワークにそのまま任せる。
  if (url.origin !== self.location.origin) return;

  // 同一オリジンの静的ファイル: キャッシュ優先 → 裏でネットワーク更新（stale-while-revalidate）
  event.respondWith(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.match(req).then(function (cached) {
        var networkFetch = fetch(req).then(function (res) {
          if (res && res.status === 200) {
            cache.put(req, res.clone());
          }
          return res;
        }).catch(function () {
          // オフラインでネットワークが取れない場合はキャッシュのみに頼る
          return cached;
        });
        return cached || networkFetch;
      });
    })
  );
});
