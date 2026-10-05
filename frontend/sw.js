/* Study Tracker Service Worker
   导航请求 network-first：服务器更新后用户立即拿到新版；
   静态资源 cache-first：图标/清单/CSS/JS 离线可用。
   v32：全局多视角审查修复——删除条目/记录墓碑机制防同步复活、深色模式全量适配、热力图紧凑化、术语按类型感知、自习室返回键/广场返回键/自看详情修复、邮箱枚举防护、wrongStreak退档归零。
   v33：自习室 UI 重设计——房主解散自习室(DELETE /api/study-room)、房间内广场入口、成员列表紧凑两行布局、成员详情以最近学习动态替代热力图、深浅色/窄屏适配。
   v34：三大模块排期逻辑系统性优化（错题/刷题/背书）——舒适量与容量关系重构、超量提示、截止日过期行为、临考策略按钮真拦截、薄弱点看板热力图按月、刷题本完成情况弹窗加注意事项、最后登录活跃刷新、批量清理修复、去打卡按钮样式修复。
   重要：静态资源靠 index.html 里的 ?v= 版本号 cache-busting，
   每次改 JS/CSS 必须同时升 ?v= 版本号，否则 SW 会一直返回旧缓存。 */
var CACHE = 'yystudy-v34';
var CORE = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/auth.js',
  './icon-192.png?v=3',
  './icon-512.png?v=3',
  './apple-touch-icon.png?v=3',
  './favicon-64.png?v=3',
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

  // JS/CSS/HTML 用 network-first：部署后用户立即拿到新版，离线时回退缓存
  var url = req.url;
  var isJsCss = url.indexOf('.js') !== -1 || url.indexOf('.css') !== -1;
  if (isJsCss) {
    e.respondWith(
      fetch(req).then(function (res) {
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
