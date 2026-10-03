/* Study Tracker Service Worker
   导航请求 network-first：服务器更新后用户立即拿到新版；
   静态资源 cache-first：图标/清单/CSS/JS 离线可用。
   v27：API 响应绝不缓存（防登出后隐私残留）；导航响应仅缓存 200（防 500 页入缓存）；
        恢复纸纹背景图预缓存；修复 v26 注释未闭合导致 SW 脚本语法错误、安装失败 */
var CACHE = 'yystudy-v27';
var CORE = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/auth.js',
  './icon-192.png?v=2',
  './icon-512.png?v=2',
  './apple-touch-icon.png?v=2',
  './favicon-64.png?v=2',
  './paper-warm.jpg',
  './paper-dark.jpg'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // 逐个 add，避免单个文件 404 导致整个 install 失败
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
      // 清理所有旧版本缓存（不限于当前 CACHE 名称）
      return Promise.all(keys.map(function (k) { return caches.delete(k); }));
    }).then(function () {
      // 重新打开当前缓存（上面全删了）
      return caches.open(CACHE);
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  // API 响应含用户全量数据：直接走网络、绝不进 SW 缓存，避免登出后隐私残留
  if (req.url.indexOf('/api/') !== -1) {
    e.respondWith(fetch(req));
    return;
  }

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (res) {
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
