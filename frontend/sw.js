/* Study Tracker Service Worker
   导航走 network-first，改了服务器用户马上能拿到新版；
   静态资源走 cache-first，离线也能用。
   注意：JS/CSS 的缓存失效靠 index.html 里的 ?v= 版本号，
   改了文件记得顺手升版本号，不然 SW 会一直吐旧缓存。
   API 请求不缓存，里面有用户数据。 */
var CACHE = 'yystudy-v61';
var CORE = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css?v=fix1006b',
  './js/app.js?v=fix1006b',
  './js/auth.js?v=fix1006b',
  './icon-192.png?v=4',
  './icon-512.png?v=4',
  './apple-touch-icon.png?v=4',
  './favicon-64.png?v=4',
  './paper-warm.jpg',
  './paper-dark.jpg'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(CORE.map(function (url) {
        return c.add(url).catch(function (err) {
          console.warn('[SW] 预缓存失败:', url, err);
        });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      // 只删除非当前版本的旧缓存，保留当前 CACHE（precache 内容不丢）
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () {
      return self.clients.claim();
    }).then(function () {
      // 激活后通知所有客户端：新版本已就绪，请刷新
      return self.clients.matchAll().then(function (clients) {
        clients.forEach(function (client) {
          client.postMessage({ type: 'SW_UPDATED', cache: CACHE });
        });
      });
    })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  // 只处理 http/https 请求，忽略 chrome-extension 等扩展请求（Cache API 不支持）
  if (req.url.indexOf('http://') !== 0 && req.url.indexOf('https://') !== 0) return;

  // API 响应含用户全量数据：直接走网络、绝不进 SW 缓存，避免登出后隐私残留
  if (req.url.indexOf('/api/') !== -1) {
    e.respondWith(fetch(req));
    return;
  }

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req, { cache: 'no-cache' }).then(function (res) {
        // 仅缓存 200 导航响应，避免 500/维护页被写进缓存
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(req).then(function (r) { return r || caches.match('./index.html'); });
      })
    );
    return;
  }

  // JS/CSS/HTML 用 network-first：部署后用户立即拿到新版，离线时回退缓存
  var url = req.url;
  var isJsCss = url.indexOf('.js') !== -1 || url.indexOf('.css') !== -1;
  if (isJsCss) {
    e.respondWith(
      fetch(req, { cache: 'no-cache' }).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(req);
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
