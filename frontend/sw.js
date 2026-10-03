/* Study Tracker Service Worker
   导航请求 network-first：服务器更新后用户立即拿到新版（避免旧缓存卡住）；
   静态资源 cache-first：图标/清单/CSS/JS 离线可用。
   v23：新增 dom.js 独立模块（打破 $ 循环依赖 TDZ），缓存全部 9 个 JS 文件 */
var CACHE = 'yystudy-v23';
var CORE = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/dom.js',
  './js/app.js',
  './js/auth.js',
  './js/utils.js',
  './js/storage.js',
  './js/review.js',
  './js/render.js',
  './js/ui.js',
  './js/events.js',
  './icon-192.png?v=2',
  './icon-512.png?v=2',
  './apple-touch-icon.png?v=2',
  './favicon-64.png?v=2'
];

/* 支持前端 postMessage({type:'SKIP_WAITING'}) 立即激活新版 */
self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'SKIP_WAITING') { self.skipWaiting(); }
});

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(CORE); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE; })
            .map(function (k) { return caches.delete(k); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (r) { return r || caches.match('./index.html'); });
      })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
