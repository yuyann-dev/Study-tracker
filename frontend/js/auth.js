var STAuth = (function () {
  var AUTH_TOKEN_KEY = 'st_auth_token';
  var AUTH_USER_KEY = 'st_auth_user';
  var currentUser = null;
  var lastCloudSync = null;
  var syncTimer = null;
  var isSyncing = false;
  var syncPending = false;   // 同步进行中又有新变更时标记，当前同步结束后自动补一次
  var _lastSyncEtag = null;  // 上次 GET /api/data 的 ETag，用于 304 增量判断
  var _localDirty = false;   // 本地数据自上次成功推送后是否有变更
  var SYNC_DEBOUNCE_MS = 5000;
  var PERIODIC_SYNC_MS = 60000;   // 每 60 秒自动双向同步一次

  // === 关闭浏览器对应用内输入框的自动填充与输入历史 ===
  // 两层处理：
  //  ① 应用内非密码输入框统一 autocomplete=off，消除历史输入下拉；
  //  ②（关键）隐藏弹窗里的密码框若仍 enabled，Chrome 会把整页判定为「登录页」，
  //     于是点击任何输入框都弹「保存的密码」——autocomplete=off 无法阻止这种页面级判定。
  //     因此弹窗隐藏时禁用其内部密码框、显示时启用；disabled 字段不参与登录表单识别。
  function applyNoAutofill(root) {
    var scope = root || document;
    scope.querySelectorAll('input').forEach(function (inp) {
      if (inp.type === 'password') return;
      if (inp.closest && inp.closest('#authMask')) return;
      inp.setAttribute('autocomplete', 'off');
    });
  }
  // 按各 .mask 的 hidden 状态，同步其内部密码框的 disabled
  function syncPasswordFields(mask) {
    var masks = mask ? [mask] : Array.prototype.slice.call(document.querySelectorAll('.mask'));
    masks.forEach(function (m) {
      var hidden = m.hidden !== false; // 无 hidden 属性时 m.hidden===false
      m.querySelectorAll('input[type=password]').forEach(function (pw) { pw.disabled = hidden; });
    });
  }
  function initNoAutofill() {
    applyNoAutofill(document);
    syncPasswordFields();
    try {
      new MutationObserver(function (muts) {
        muts.forEach(function (m) {
          if (m.type === 'attributes' && m.attributeName === 'hidden' && m.target.classList && m.target.classList.contains('mask')) {
            syncPasswordFields(m.target);
            return;
          }
          m.addedNodes.forEach(function (n) {
            if (n.nodeType !== 1) return;
            if (n.tagName === 'INPUT') {
              if (n.type !== 'password' && !(n.closest && n.closest('#authMask'))) {
                n.setAttribute('autocomplete', 'off');
              }
            } else if (n.querySelectorAll) {
              applyNoAutofill(n);
            }
          });
        });
      }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    } catch (e) { /* 环境不支持 MutationObserver 时静默 */ }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNoAutofill);
  } else {
    initNoAutofill();
  }
  var periodicSyncTimer = null;
  function startPeriodicSync(){
    if (periodicSyncTimer) clearInterval(periodicSyncTimer);
    periodicSyncTimer = setInterval(function(){
      if (isLoggedIn() && !isSyncing && document.visibilityState === 'visible') syncFromCloud();
    }, PERIODIC_SYNC_MS);
  }
  function stopPeriodicSync(){
    if (periodicSyncTimer){ clearInterval(periodicSyncTimer); periodicSyncTimer = null; }
  }
  // 页面从后台回到前台时立即同步一次（多端数据更快收敛）
  document.addEventListener('visibilitychange', function(){
    if (document.visibilityState === 'visible' && isLoggedIn() && !isSyncing) syncFromCloud();
  });

  function getToken() {
    try {
      return localStorage.getItem(AUTH_TOKEN_KEY) || sessionStorage.getItem(AUTH_TOKEN_KEY);
    } catch(e) { return null; }
  }
  function setToken(t, remember) {
    try {
      clearToken();
      if (remember) localStorage.setItem(AUTH_TOKEN_KEY, t);
      else sessionStorage.setItem(AUTH_TOKEN_KEY, t);
    } catch(e) {}
  }
  function clearToken() {
    try { localStorage.removeItem(AUTH_TOKEN_KEY); } catch(e) {}
    try { sessionStorage.removeItem(AUTH_TOKEN_KEY); } catch(e) {}
  }
  function getStoredUser() {
    try {
      var raw = localStorage.getItem(AUTH_USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch(e) { return null; }
  }
  function setStoredUser(u) {
    try { localStorage.setItem(AUTH_USER_KEY, JSON.stringify(u)); } catch(e) {}
  }
  function clearStoredUser() {
    try { localStorage.removeItem(AUTH_USER_KEY); } catch(e) {}
  }
  function isLoggedIn() { return !!getToken(); }
  function getUsername() { return currentUser ? (currentUser.username || '') : ''; }
  function getUser() { return currentUser; }

  async function apiRequest(path, options) {
    options = options || {};
    options.headers = options.headers || {};
    var tok = getToken();
    if (tok) options.headers['Authorization'] = 'Bearer ' + tok;
    if (options.body && !(options.body instanceof FormData)) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }
    // GET 请求一律防缓存，保证后台数据实时
    var method = (options.method || 'GET').toUpperCase();
    if (method === 'GET') {
      options.cache = 'no-store';
      path += (path.indexOf('?') === -1 ? '?' : '&') + '_t=' + Date.now();
    }
    var resp = await fetch(path, options);
    if (resp.status === 401) {
      // 登录/注册接口的 401 是账号或密码错误，不是 token 过期：不清登录态，透传后端错误信息
      var isAuthEndpoint = path.indexOf('/api/auth/login') !== -1 || path.indexOf('/api/auth/register') !== -1;
      if (isAuthEndpoint) {
        var authErr = await resp.json().catch(function(){ return {}; });
        throw new Error(authErr.error || '邮箱或密码错误');
      }
      clearToken(); clearStoredUser(); currentUser = null;
      _lastSyncEtag = null; _localDirty = false; syncPending = false;
      // token 失效时也清除本地学习数据，防止切换账号后串号
      try { await clearLocalStoreData(); } catch(e) {}
      updateHeaderUI(); updateSyncStatus('logout');
      throw new Error('未登录或登录已过期');
    }
    if (resp.status === 403) {
      var f3 = await resp.json().catch(function(){ return {}; });
      throw new Error(f3.error || '账号已被禁用，请联系管理员');
    }
    // 304 Not Modified：ETag 命中，服务端无变化，返回标记供调用方跳过合并
    if (resp.status === 304) {
      return { _notModified: true, etag: resp.headers.get('ETag') || null };
    }
    var data = await resp.json().catch(function(){ return {}; });
    if (!resp.ok || data.ok === false) {
      throw new Error(data.error || ('请求失败 (' + resp.status + ')'));
    }
    // 附带 ETag（若有），调用方可存下用于下次 If-None-Match
    var etag = resp.headers.get('ETag');
    if (etag) data._etag = etag;
    return data;
  }

  function showAuthError(msg) {
    var el = document.getElementById('authError');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
  }
  function hideAuthError() {
    var el = document.getElementById('authError');
    if (el) el.classList.remove('show');
  }

  // 发送验证码成功后的统一提示（提醒查垃圾邮件/广告文件夹）
  function showCodeSentToast() {
    if (typeof showToast === 'function') showToast('📧', '验证码已发送', '若未收到，请检查垃圾邮件/广告文件夹', 4200);
  }
  // 发送验证码按钮 60s 倒计时：成功后调用，期间禁用按钮，结束后恢复 idleText
  // （后端成功才进入冷却；发送失败返回 502 不占冷却，catch 里立即恢复按钮允许重试）
  function armCodeCooldown(btn, seconds, idleText) {
    if (!btn) return;
    var s = seconds || 60;
    btn.disabled = true;
    if (btn._cdTimer) clearInterval(btn._cdTimer);
    btn._cdTimer = setInterval(function () {
      btn.textContent = s + ' 秒后可重发';
      if (s-- <= 0) {
        clearInterval(btn._cdTimer);
        btn._cdTimer = null;
        btn.textContent = idleText;
        btn.disabled = false;
      }
    }, 1000);
  }

  function openAuth(mode) {
    var mask = document.getElementById('authMask');
    if (!mask) return;
    mask.hidden = false;
    switchAuthTab(mode || 'login');
    hideAuthError();
    document.getElementById('loginEmail').value = '';
    document.getElementById('loginPassword').value = '';
    document.getElementById('regEmail').value = '';
    document.getElementById('regInviteCode').value = '';
    document.getElementById('regCode').value = '';
    document.getElementById('regUsername').value = '';
    document.getElementById('regPassword').value = '';
    document.getElementById('regConfirmPassword').value = '';
    resetRegSteps();
  }
  function closeAuth() {
    if (_loginWall) return;
    document.getElementById('authMask').hidden = true;
  }

  function switchAuthTab(mode) {
    var loginTab = document.getElementById('authTabLogin');
    var regTab = document.getElementById('authTabRegister');
    var loginFields = document.getElementById('loginFields');
    var registerFields = document.getElementById('registerFields');
    var submit = document.getElementById('authSubmit');
    var title = document.getElementById('authModalTitle');
    if (mode === 'register') {
      loginTab.classList.remove('active');
      regTab.classList.add('active');
      loginFields.hidden = true;
      registerFields.hidden = false;
      if (title) title.textContent = '创建账号';
      goRegStep(1);
    } else {
      regTab.classList.remove('active');
      loginTab.classList.add('active');
      loginFields.hidden = false;
      registerFields.hidden = true;
      submit.textContent = '登 录';
      title.textContent = '欢迎回来';
    }
    hideAuthError();
  }

  // 通用邮箱正则
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  // 注册当前步骤
  var regCurrentStep = 1;

  // 切换注册步骤
  function goRegStep(n) {
    regCurrentStep = n;
    for (var i = 1; i <= 3; i++) {
      var pane = document.getElementById('regPane' + i);
      var stepEl = document.querySelector('.reg-step[data-step="' + i + '"]');
      if (pane) pane.hidden = (i !== n);
      if (stepEl) {
        stepEl.classList.toggle('active', i === n);
        stepEl.classList.toggle('done', i < n);
      }
    }
    var backBtn = document.getElementById('authBack');
    if (backBtn) backBtn.hidden = (n === 1);
    var submitBtn = document.getElementById('authSubmit');
    if (submitBtn) {
      var labels = {1: '发送验证码', 2: '下一步', 3: '完成注册'};
      submitBtn.textContent = labels[n];
    }
    hideAuthError();
  }

  // 重置注册到第一步
  function resetRegSteps() {
    regCurrentStep = 1;
    ['regCode'].forEach(function(id){ var el = document.getElementById(id); if (el) el.value = ''; });
    goRegStep(1);
  }

  // 发送注册验证码
  async function sendRegCode() {
    var email = document.getElementById('regEmail').value.trim();
    var inviteCode = document.getElementById('regInviteCode').value.trim().toUpperCase();
    if (!email || !EMAIL_RE.test(email)) throw new Error('请输入有效的邮箱地址');
    var body = { email: email, type: 'register' };
    if (inviteCode) body.inviteCode = inviteCode;
    await apiRequest('/api/auth/send-code', { method: 'POST', body: body });
  }

  function checkPasswordStrength(pw) {
    var score = 0;
    if (pw.length >= 8) score++;
    if (/[a-zA-Z]/.test(pw) && /\d/.test(pw)) score++;
    if (pw.length >= 12) score++;
    return score;
  }
  function updatePwStrength() {
    var pw = document.getElementById('regPassword').value;
    var seg1 = document.getElementById('pwSeg1');
    var seg2 = document.getElementById('pwSeg2');
    var seg3 = document.getElementById('pwSeg3');
    var txt = document.getElementById('pwStrengthText');
    [seg1,seg2,seg3].forEach(function(s){ s.className = 'pw-strength-seg'; });
    if (!pw) { txt.textContent = '密码强度：'; return; }
    var s = checkPasswordStrength(pw);
    if (s >= 1) seg1.classList.add('s1');
    if (s >= 2) { seg1.classList.remove('s1'); seg1.classList.add('s2'); seg2.classList.add('s2'); }
    if (s >= 3) { seg1.classList.remove('s2'); seg1.classList.add('s3'); seg2.classList.remove('s2'); seg2.classList.add('s3'); seg3.classList.add('s3'); }
    var labels = ['弱','中','强'];
    txt.textContent = '密码强度：' + labels[Math.min(s,2)];
  }

  async function doRegister(email, code, username, password, inviteCode, remember) {
    var body = { email: email, code: code, username: username, password: password };
    if (inviteCode) body.inviteCode = inviteCode;
    var data = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: body
    });
    setToken(data.token, remember);
    currentUser = data.user;
    setStoredUser(data.user);
    disableLoginWall();
    // 新账号注册成功：彻底清除本地旧账号数据，防止串号（未登出直接注册新账号的场景）
    await clearLocalStoreData();
    // 清除后重新渲染空状态，避免显示旧账号的残留 DOM
    if (typeof render === 'function') { try { render(); } catch(e) {} }
    startPeriodicSync();
    return data.user;
  }
  async function doLogin(email, password, remember) {
    var data = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: { email: email, password: password }
    });
    setToken(data.token, remember);
    currentUser = data.user;
    setStoredUser(data.user);
    startPeriodicSync();
    return data.user;
  }
  /* 登出/切换账号时彻底清除本地学习数据（localStorage + IndexedDB + Cache 三层），
     防止新账号登录后把老账号数据同步到云端（数据串号） */
  async function clearLocalStoreData() {
    // 1. 立即重置内存 store，防止后续操作读到旧数据
    try {
      store = { currentId: null, projects: {}, unitTemplates: [], paperTemplates: [], tombstones: {} };
      _lastSaveSig = '';
    } catch (e) {}
    // 2. 清除 localStorage 主存储
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    // 3. 清除 IndexedDB 快照备份
    try {
      if (typeof indexedDB !== 'undefined') {
        await new Promise(function(res) {
          var req = indexedDB.deleteDatabase('study_tracker_safe');
          req.onsuccess = req.onerror = req.onblocked = function() { res(); };
        });
      }
    } catch (e) {}
    // 4. 清除 Cache API 备份
    try {
      if ('caches' in window) {
        await caches.delete('study-tracker-data-v1');
      }
    } catch (e) {}
  }
  async function doLogout() {
    // 登出前：如果有未同步的本地变更，先推送到云端，防止数据丢失（最多等 3 秒）
    if (_localDirty && isLoggedIn()) {
      try {
        isSyncing = true;
        await Promise.race([
          pushToCloudInner(),
          new Promise(function(_, reject){ setTimeout(function(){ reject(new Error('timeout')); }, 3000); })
        ]);
        isSyncing = false;
      } catch(e) {
        isSyncing = false;
        console.warn('logout: push local changes failed', e && e.message);
      }
    }
    try { await apiRequest('/api/auth/logout', { method: 'POST' }); } catch(e) {}
    stopPeriodicSync();
    clearToken(); clearStoredUser(); currentUser = null;
    lastCloudSync = null;
    _lastSyncEtag = null;  // 清除 ETag，切换账号后重新全量拉取
    _localDirty = false;
    syncPending = false;
    await clearLocalStoreData();  // 彻底清除本地学习数据，防止串号
    updateHeaderUI();
    updateSyncStatus('logout');
    closeProfile();
    if (typeof showToast === 'function') showToast('👋','已退出登录','请重新登录');
    enableLoginWall();
  }
  async function fetchMe() {
    var data = await apiRequest('/api/auth/me', { method: 'GET' });
    currentUser = data.user;
    setStoredUser(data.user);
    return data.user;
  }

  function updateHeaderUI() {
    var btn = document.getElementById('btnUser');
    if (!btn) return;
    if (currentUser) {
      var avatar = currentUser.avatar;
      var displayName = currentUser.username || '';
      if (avatar && (avatar.indexOf('data:') === 0 || avatar.indexOf('http') === 0 || avatar.indexOf('/uploads/') === 0)) {
        btn.innerHTML = '<span class="user-avatar-btn"><img src="' + avatar + '" alt="" onerror="this.outerHTML=\'👤\'"></span>';
      } else if (avatar && avatar.length <= 4) {
        btn.innerHTML = '<span class="user-avatar-btn">' + avatar + '</span>';
      } else {
        var ch = displayName.charAt(0).toUpperCase();
        btn.innerHTML = '<span class="user-avatar-btn"><span class="av-text">' + ch + '</span></span>';
      }
      btn.title = displayName + ' · 个人中心';
    } else {
      btn.innerHTML = '<span class="user-avatar-btn">👤</span>';
      btn.title = '登录 / 注册';
    }
    var btnAdm = document.getElementById('btnAdmin');
    if (btnAdm) btnAdm.hidden = !(currentUser && currentUser.isAdmin);
  }

  function updateSyncStatus(status, timeStr) {
    var dot = document.getElementById('syncIndicator');
    if (!dot) return;
    if (status === 'ing') {
      dot.hidden = false;
      dot.className = 'sync-indicator sync-ing';
      dot.title = '同步中…';
    } else if (status === 'fail') {
      dot.hidden = false;
      dot.className = 'sync-indicator sync-fail';
      dot.title = '同步失败，点击重试';
    } else if (status === 'ok') {
      dot.hidden = false;
      dot.className = 'sync-indicator sync-ok';
      dot.title = '已同步' + (timeStr ? ' · ' + timeStr : '');
    } else {
      dot.hidden = true;
    }
    var pDot = document.getElementById('profileSyncDot');
    var pLabel = document.getElementById('profileSyncLabel');
    var pTime = document.getElementById('profileSyncTime');
    if (pDot && pLabel && pTime) {
      if (status === 'ing') {
        pDot.className = 'sync-status-dot ing';
        pLabel.textContent = '正在同步…';
      } else if (status === 'fail') {
        pDot.className = 'sync-status-dot fail';
        pLabel.textContent = '同步失败';
      } else if (status === 'ok') {
        pDot.className = 'sync-status-dot ok';
        pLabel.textContent = '已同步';
      } else {
        pDot.className = 'sync-status-dot ok';
        pLabel.textContent = '未登录';
      }
      pTime.textContent = timeStr || (lastCloudSync ? ('上次同步：' + formatTime(lastCloudSync)) : '—');
    }
  }

  // 服务器时间戳统一为 UTC：SQLite datetime('now') 输出 "YYYY-MM-DD HH:MM:SS"（无时区标识），
  // 邀请码到期时间为 toISOString() 输出（带 Z）。解析时显式按 UTC 处理，再由浏览器转本地时区显示。
  function parseServerTime(t){
    if (t == null || t === '') return null;
    if (t instanceof Date) return isNaN(t.getTime()) ? null : t;
    var s = String(t).trim();
    // 末尾已带 Z 或 ±HH:MM 时区标识的，直接交给 Date 解析；否则按 UTC 补 Z
    if (!/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
      if (s.indexOf(' ') >= 0) s = s.replace(' ', 'T');
      s += 'Z';
    }
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  // 格式化为本地时间 "YYYY-MM-DD HH:MM"；解析失败时回退原样输出
  function fmtDateTime(t){
    if (t == null || t === '') return '';
    var d = parseServerTime(t);
    if (!d) return String(t);
    var pad = function(n){ return n<10?'0'+n:''+n; };
    return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate())
         + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function formatTime(d) {
    if (!(d instanceof Date)) d = parseServerTime(d) || new Date(d);
    var pad = function(n){ return n<10?'0'+n:''+n; };
    return (d.getMonth()+1) + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  // 按项目ID合并两份数据：独有项目互相保留；共有项目取 updatedAt 较新者，
  // 并互相补齐独有的打卡记录（rid），避免“项目总数相等却不合并”导致丢数据。
  // 合并模板：本地全部保留（含内置 preset_），云端只并入用户自定义模板，同 id 取 updatedAt 新者
  function mergeTemplates(localArr, cloudArr){
    var map = {};
    (localArr || []).forEach(function(t){ if(t && t.id) map[t.id] = t; });
    (cloudArr || []).forEach(function(t){
      if(!t || !t.id || String(t.id).indexOf('preset_') === 0) return;
      var ex = map[t.id];
      if(!ex || (t.updatedAt || 0) > (ex.updatedAt || 0)) map[t.id] = t;
    });
    return Object.keys(map).map(function(k){ return map[k]; });
  }
  function mergeTombstones(localT, cloudT){
    var out = {};
    [localT || {}, cloudT || {}].forEach(function(src){
      Object.keys(src).forEach(function(id){
        var t = Number(src[id]) || 0;
        if (!out[id] || t > out[id]) out[id] = t;
      });
    });
    return out;
  }

  // 应用墓碑：删除"删除时间晚于/等于项目最后更新时间"的项目；返回被删除 id 列表
  function applyTombstones(projects, tombstones){
    var removed = [];
    Object.keys(tombstones).forEach(function(id){
      var p = projects[id];
      if (p) {
        var deletedAt = Number(tombstones[id]) || 0;
        var updatedAt = Number(p.updatedAt) || 0;
        if (updatedAt <= deletedAt) { delete projects[id]; removed.push(id); }
      }
    });
    return removed;
  }

  // 清理超过保留期的旧墓碑，防止字段无限增长（默认保留 30 天）
  function pruneTombstones(tombstones, retainMs){
    if (!tombstones) return;
    var cutoff = Date.now() - (retainMs || 30 * 24 * 3600 * 1000);
    Object.keys(tombstones).forEach(function(id){
      if ((Number(tombstones[id]) || 0) < cutoff) delete tombstones[id];
    });
  }

  // ── items（背书条目/错题）合并：与后端 backend/utils/syncMerge.js 的 mergeItems 同构（thesis-57）──
  // 合并边界：按 id 做集合 union；同一 id 两端都有时做字段级 LWW：
  //   1) item.updatedAt 较大者胜（都没有视为 0，打平进入下一步）；
  //   2) reviews 数组较长者胜（复习评价更多，状态更新）；
  //   3) 仍打平则保留先入者（base），避免抖动。
  // 这是「LWW + 墓碑」的工程变体，不是 CRDT/OT。已知局限（thesis-62）：updatedAt 用客户端
  // wall-clock，设备时钟漂移会误判；同一条目两端同时改不同字段会丢一个修改（未来工作：per-item 逻辑时钟）。
  function mergeItems(aItems, bItems){
    var byId = {};   // id -> item（字段整体胜出者）
    var order = [];  // 保持先到顺序
    function consider(it){
      if (!it || !it.id) return;
      var existing = byId[it.id];
      if (!existing){
        byId[it.id] = JSON.parse(JSON.stringify(it));
        order.push(it.id);
        return;
      }
      var eu = Number(existing.updatedAt) || 0;
      var iu = Number(it.updatedAt) || 0;
      var winner;
      if (iu > eu) winner = it;
      else if (eu > iu) winner = existing;
      else {
        var er = Array.isArray(existing.reviews) ? existing.reviews.length : 0;
        var ir = Array.isArray(it.reviews) ? it.reviews.length : 0;
        winner = ir > er ? it : existing;
      }
      if (winner !== existing){
        // 把胜出方字段整体覆盖进 existing（保持 byId 引用稳定）
        var merged = JSON.parse(JSON.stringify(winner));
        Object.keys(existing).forEach(function(k){ delete existing[k]; });
        Object.keys(merged).forEach(function(k){ existing[k] = merged[k]; });
      }
    }
    if (Array.isArray(aItems)) aItems.forEach(consider);
    if (Array.isArray(bItems)) bItems.forEach(consider);
    return order.map(function(id){ return byId[id]; });
  }

  function mergeStores(localStore, cloudStore){
    var out = JSON.parse(JSON.stringify(localStore || {}));
    out.projects = out.projects || {};
    // 1) 合并双方墓碑
    out.tombstones = mergeTombstones(localStore && localStore.tombstones, cloudStore && cloudStore.tombstones);
    // 2) 先对本地项目应用墓碑
    applyTombstones(out.projects, out.tombstones);
    var cp = (cloudStore && cloudStore.projects) || {};
    Object.keys(cp).forEach(function(id){
      var lp = out.projects[id], cpx = cp[id];
      // 3) 云端版本若不新于该项目的删除时间，说明是删除前的旧版本，不引入（防止复活）
      var deletedAt = out.tombstones[id] ? Number(out.tombstones[id]) : 0;
      var cUpdated = Number(cpx.updatedAt) || 0;
      if (deletedAt && cUpdated <= deletedAt) return;
      if(!lp){ out.projects[id] = JSON.parse(JSON.stringify(cpx)); return; }
      var lu = lp.updatedAt || 0, cu = cpx.updatedAt || 0;
      var base = (cu > lu) ? cpx : lp;
      var other = (cu > lu) ? lp : cpx;
      var mergedP = JSON.parse(JSON.stringify(base));
      if(Array.isArray(base.records) && Array.isArray(other.records)){
        var have = new Set(base.records.map(function(r){return r.rid;}).filter(Boolean));
        var extra = other.records.filter(function(r){ return r.rid && !have.has(r.rid); });
        if(extra.length){
          mergedP.records = base.records.concat(extra);
          mergedP.records.sort(function(a,b){
            var da = String(a.date||''), db = String(b.date||'');
            return da < db ? -1 : (da > db ? 1 : 0);
          });
          mergedP.updatedAt = Math.max(lu, cu);
        }
      }
      // items：按 id union + 字段级 LWW（thesis-57，防两端改不同 item 互相覆盖；与后端 mergeProjects 同构）
      if(Array.isArray(base.items) || Array.isArray(other.items)){
        mergedP.items = mergeItems(base.items, other.items);
        mergedP.updatedAt = Math.max(lu, cu);
      }
      out.projects[id] = mergedP;
    });
    // 4) 合并后再次应用墓碑（双保险）
    applyTombstones(out.projects, out.tombstones);
    // 合并用户自定义的单元/套卷模板（内置 preset_ 保留本地、不重复合并）
    out.unitTemplates = mergeTemplates(out.unitTemplates, cloudStore && cloudStore.unitTemplates);
    out.paperTemplates = mergeTemplates(out.paperTemplates, cloudStore && cloudStore.paperTemplates);
    // 修正当前任务：本地 currentId 失效时优先用云端 currentId，否则取第一个任务
    var ids = Object.keys(out.projects);
    var curOk = out.currentId && out.projects[out.currentId];
    if(!curOk){
      if(cloudStore && cloudStore.currentId && out.projects[cloudStore.currentId]) out.currentId = cloudStore.currentId;
      else out.currentId = ids.length ? ids[0] : null;
    }
    return out;
  }

  // 合并结果是否比云端更新（需要 PUT 回云）
  function storeHasNewerThan(mergedStore, cloudStore){
    var mp = (mergedStore && mergedStore.projects) || {};
    var cp = (cloudStore && cloudStore.projects) || {};
    var newer = false;
    new Set(Object.keys(mp).concat(Object.keys(cp))).forEach(function(id){
      var m = mp[id], c = cp[id];
      if(!c && m){ newer = true; }
      else if(m && c){
        if((m.updatedAt||0) > (c.updatedAt||0)) newer = true;
        if(Array.isArray(m.records) && Array.isArray(c.records) && m.records.length > c.records.length) newer = true;
        // items 合并后若本端条目数多于云端，需要回推（thesis-57）
        if(Array.isArray(m.items) && Array.isArray(c.items) && m.items.length > c.items.length) newer = true;
      }
    });
    // 墓碑比较：合并结果中存在云端没有（或更新）的删除标记，需要回推
    var mt = (mergedStore && mergedStore.tombstones) || {};
    var ct = (cloudStore && cloudStore.tombstones) || {};
    new Set(Object.keys(mt).concat(Object.keys(ct))).forEach(function(id){
      var m = Number(mt[id]) || 0, c = Number(ct[id]) || 0;
      if (m > c) newer = true;
    });
    return newer;
  }

  function scheduleCloudSync() {
    if (!isLoggedIn()) return;
    _localDirty = true;  // 标记本地有变更，304 场景下仍需回推
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(function(){
      // 走完整双向同步（先拉取他端变更并合并，再推送本地变更），
      // 避免纯全量覆盖把其他设备的删除/修改冲掉
      if (!isSyncing) syncFromCloud();
      else syncPending = true;  // 同步进行中：标记待补，当前同步结束后自动触发
    }, SYNC_DEBOUNCE_MS);
  }

  // 内部推送：不检查重入锁，供已持有 isSyncing 的 syncFromCloud 复用
  async function pushToCloudInner() {
    await apiRequest('/api/data', { method: 'PUT', body: { store: store } });
    _localDirty = false;  // 推送成功，本地变更已上云
    lastCloudSync = new Date();
    updateSyncStatus('ok', formatTime(lastCloudSync));
  }

  async function syncToCloud() {
    if (!isLoggedIn() || isSyncing) return;
    isSyncing = true;
    updateSyncStatus('ing');
    try {
      await pushToCloudInner();
    } catch(e) {
      console.error('云端上传失败:', e);
      updateSyncStatus('fail');
    } finally {
      isSyncing = false;
      if (syncPending) { syncPending = false; scheduleCloudSync(); }
    }
  }

  async function syncFromCloud(opts) {
    if (!isLoggedIn()) return;
    if (isSyncing) return;
    isSyncing = true;
    updateSyncStatus('ing');
    // ux-18：手动/触发式同步在等待网络期间渲染 shimmer 骨架条（数据到达后 render() 替换）
    if (opts && opts.skeleton && typeof showListShimmer === 'function' && cur()) {
      try { showListShimmer(4); } catch (e) {}
    }
    try {
      // ETag 增量：带上次 ETag，服务端无变化则 304，省掉全量 JSON 下载
      var getOpts = { method: 'GET' };
      if (_lastSyncEtag) getOpts.headers = { 'If-None-Match': _lastSyncEtag };
      var data = await apiRequest('/api/data', getOpts);

      // ── 304 快速路径：服务端数据未变，只需判断本地是否有变更待推送 ──
      if (data && data._notModified) {
        if (_lastSyncEtag === null && data.etag) _lastSyncEtag = data.etag;
        if (_localDirty) {
          await pushToCloudInner();
        } else {
          lastCloudSync = new Date();
          updateSyncStatus('ok', formatTime(lastCloudSync));
        }
        return;
      }

      // 记录新 ETag（供下次 If-None-Match）
      if (data && data._etag) _lastSyncEtag = data._etag;

      var cloudStore = data.store || null;
      var localProjectCount = (store && store.projects) ? Object.keys(store.projects).length : 0;
      var cloudProjectCount = (cloudStore && cloudStore.projects) ? Object.keys(cloudStore.projects).length : 0;

      if (localProjectCount === 0 && cloudProjectCount === 0) {
        _localDirty = false;
        updateSyncStatus('ok');
      } else {
        var wasEmptyLocal = localProjectCount === 0 && cloudProjectCount > 0;
        var merged = mergeStores(store, cloudStore);
        pruneTombstones(merged.tombstones); // 清理 30 天以上的旧墓碑
        var _oldProjSig = JSON.stringify((store && store.projects) || {});
        var _oldUnitSig = JSON.stringify((store && store.unitTemplates) || []);
        var _oldPaperSig = JSON.stringify((store && store.paperTemplates) || []);
        var _oldCur = (store && store.currentId) || null;
        var changedLocal = JSON.stringify(merged.projects || {}) !== _oldProjSig
          || JSON.stringify(merged.unitTemplates || []) !== _oldUnitSig
          || JSON.stringify(merged.paperTemplates || []) !== _oldPaperSig
          || (merged.currentId || null) !== _oldCur;
        var needPush = storeHasNewerThan(merged, cloudStore);

        if (changedLocal){
          // ux-29：统计远端带来、本地原本没有的新记录(rid)/条目(id)数，确有新增才 toast
          var addedFromCloud = 0;
          try {
            var _lp = (store && store.projects) || {};
            Object.keys(merged.projects || {}).forEach(function(pid){
              var mp = merged.projects[pid], lp = _lp[pid];
              if (!lp) { addedFromCloud += (mp.items||[]).length + (mp.records||[]).length; return; }
              var lrec = {}; (lp.records||[]).forEach(function(r){ if(r.rid) lrec[r.rid]=1; });
              (mp.records||[]).forEach(function(r){ if(r.rid && !lrec[r.rid]) addedFromCloud++; });
              var lit = {}; (lp.items||[]).forEach(function(i){ if(i.id) lit[i.id]=1; });
              (mp.items||[]).forEach(function(i){ if(i.id && !lit[i.id]) addedFromCloud++; });
            });
          } catch(e){}
          store = merged;
          _lastSaveSig = '';
          saveStore();
          if (typeof render === 'function') render();
          if (addedFromCloud > 0 && typeof showToast === 'function') {
            showToast('☁️','已从云端同步', addedFromCloud + ' 条新记录', 3000);
          }
        }
        if (needPush){
          await pushToCloudInner();
        } else {
          _localDirty = false;  // 确认本地不新于云端，无需推送
          lastCloudSync = parseServerTime(data.updatedAt) || new Date();
          updateSyncStatus('ok', formatTime(lastCloudSync));
        }
        if (wasEmptyLocal && typeof showToast === 'function'){
          showToast('☁️','已从云端恢复数据','共 ' + cloudProjectCount + ' 个任务');
        }
      }
    } catch(e) {
      console.error('云端同步失败:', e);
      updateSyncStatus('fail');
      // 失败也要把 shimmer 还原成真实列表（否则骨架条一直占着）
      if (typeof render === 'function') { try { render(); } catch (er) {} }
      // ux-14：顶部可点击重试的 toast
      if (typeof showToast === 'function') showToast('⚠️','同步失败','网络异常，点此重试', 4000, function(){ syncFromCloud({ skeleton: true }); });
    } finally {
      isSyncing = false;
      // 手动同步的骨架条必须还原：即使云端无变化(changedLocal=false，日常最常见)也要重渲染，
      // 否则 recordList 会永久停在骨架条，看起来像页面故障
      if (opts && opts.skeleton && typeof render === 'function') {
        try { render(); } catch (er) {}
      }
      // 同步期间有新变更排队：自动补一次同步
      if (syncPending) { syncPending = false; scheduleCloudSync(); }
    }
  }

  function triggerSync() {
    if (!isLoggedIn()) {
      if (typeof showToast === 'function') showToast('☁️','请先登录后再同步');
      return;
    }
    if (isSyncing) { syncPending = true; updateSyncStatus('ing'); return; } // 同步中：排队等当前结束后补一次
    syncFromCloud({ skeleton: true }); // ux-18：手动同步显示骨架条
  }

  /* ===== 安装为应用（PWA，全平台、自动更新）===== */
  var _deferredInstall = window._deferredInstallEarly || null;
  window.addEventListener('beforeinstallprompt', function(e){
    e.preventDefault();
    _deferredInstall = e;
  });
  /* ux-30：安装引导不再在登录后固定 8 秒自动弹，改为「首次成功打卡或完成一次复习判定后」再弹一次。
     beforeinstallprompt 仍在上方正常捕获到 _deferredInstall，这里只控制弹出时机。 */
  function maybeAutoPromptInstall(){
    // 改为惰性：不再自动计时弹出；由 tryPromptInstallOnce() 在用户有实质学习动作后触发
  }
  function tryPromptInstallOnce(){
    try {
      if (isStandaloneApp()) return;
      if (localStorage.getItem('st_install_prompted')) return;
      if (!isLoggedIn()) return;
      localStorage.setItem('st_install_prompted', '1');
      if (typeof openInstall === 'function') openInstall();
    } catch(e) {}
  }
  window.addEventListener('appinstalled', function(){
    _deferredInstall = null;
    var inl = document.getElementById('installInline');
    if (inl) inl.hidden = true;
    var done = document.getElementById('installDone');
    if (done) done.hidden = false;
    setTimeout(function(){ var m = document.getElementById('installMask'); if (m) m.hidden = true; }, 1800);
  });
  function isStandaloneApp(){
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
           window.navigator.standalone === true;
  }
  function isAndroidDevice(){
    return /Android|Adr/i.test(navigator.userAgent);
  }
  function openInstall(){
    ['installInline','installIOS','installAndroidOther','installDone'].forEach(function(id){
      var el = document.getElementById(id); if (el) el.hidden = true;
    });
    if (isStandaloneApp()){
      document.getElementById('installDone').hidden = false;
    } else if (_deferredInstall){
      document.getElementById('installInline').hidden = false;
    } else if (isIOSDevice()){
      document.getElementById('installIOS').hidden = false;
    } else if (isAndroidDevice()){
      document.getElementById('installAndroidOther').hidden = false;
    } else {
      document.getElementById('installInline').hidden = false; // 桌面 Firefox/Safari 兜底
    }
    document.getElementById('installMask').hidden = false;
  }
  function closeInstall(){ document.getElementById('installMask').hidden = true; }
  var _btnInstallApp = document.getElementById('btnInstallApp');
  if (_btnInstallApp) _btnInstallApp.addEventListener('click', openInstall);
  var _installClose = document.getElementById('installClose');
  if (_installClose) _installClose.addEventListener('click', closeInstall);
  var _installConfirm = document.getElementById('installConfirm');
  if (_installConfirm) _installConfirm.addEventListener('click', async function(){
    if (!_deferredInstall){
      if (typeof showToast === 'function') showToast('💡','请用 Chrome 或 Edge 浏览器打开本页再安装');
      return;
    }
    _deferredInstall.prompt();
    var choice = await _deferredInstall.userChoice;
    if (choice && choice.outcome === 'accepted') _deferredInstall = null;
  });

  function openProfile() {
    var mask = document.getElementById('profileMask');
    if (!mask) return;
    var nameEl = document.getElementById('profileDisplayName');
    if (nameEl) nameEl.textContent = currentUser ? (currentUser.username || '用户') : '用户';
    var subEl = document.getElementById('profileHeroSub');
    if (subEl) {
      if (currentUser && currentUser.isAdmin) subEl.textContent = '管理员';
      else if (currentUser && currentUser.email) subEl.textContent = currentUser.email;
      else subEl.textContent = '';
    }
    var avEl = document.getElementById('profileAvatar');
    if (currentUser && currentUser.avatar) {
      var av = currentUser.avatar;
      if (av.indexOf('data:') === 0 || av.indexOf('http') === 0 || av.indexOf('/uploads/') === 0) {
        avEl.innerHTML = '<img src="' + av + '" alt="头像" onerror="this.outerHTML=\'👤\'">';
      } else {
        avEl.textContent = av;
      }
    } else {
      avEl.textContent = (currentUser && currentUser.username) ? currentUser.username.charAt(0).toUpperCase() : '👤';
    }
    document.getElementById('profileUsername').value = currentUser ? (currentUser.username || '') : '';
    document.getElementById('profileEmail').value = currentUser ? (currentUser.email || '') : '';
    // 更换邮箱验证区：仅当邮箱改成合法的新地址时出现
    var changeBox = document.getElementById('changeEmailBox');
    var codeInput = document.getElementById('changeEmailCode');
    changeBox.hidden = true;
    codeInput.value = '';
    // 保存用户名按钮：默认置灰，用户名有改动才亮起
    var saveBtn = document.getElementById('btnSaveProfile');
    var nameInput = document.getElementById('profileUsername');
    var emailInput = document.getElementById('profileEmail');
    saveBtn.dataset.origName = nameInput.value;
    var origEmail = emailInput.value.trim();
    var refreshSaveBtn = function(){
      var n = nameInput.value.trim();
      saveBtn.disabled = !(n && n !== saveBtn.dataset.origName);
    };
    var refreshEmailBox = function(){
      var e = emailInput.value.trim();
      var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
      var show = emailOk && e !== origEmail;
      if (changeBox.hidden !== !show) { changeBox.hidden = !show; codeInput.value = ''; }
    };
    nameInput.oninput = refreshSaveBtn;
    emailInput.oninput = function(){ refreshSaveBtn(); refreshEmailBox(); };
    refreshSaveBtn();
    refreshEmailBox();
    document.getElementById('oldPassword').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('confirmNewPassword').value = '';
    updateSyncStatus(isSyncing ? 'ing' : (currentUser ? 'ok' : 'logout'));
    mask.hidden = false;
  }
  function closeProfile() {
    document.getElementById('profileMask').hidden = true;
  }

  /* 首屏关键路径优化：非关键任务推迟到首屏渲染后、浏览器空闲时执行（1.8s 兜底，避免一直不触发） */
  function onIdle(fn){
    try {
      if (typeof requestIdleCallback === 'function') { requestIdleCallback(fn, { timeout: 1800 }); return; }
    } catch(e) {}
    setTimeout(fn, 350);
  }
  function initAuth() {
    initPwToggles();
    var storedUser = getStoredUser();
    var tok = getToken();
    if (tok && storedUser) {
      // 立即：仅用本地缓存恢复会话并刷新头部（同步、快），首屏头部马上显示用户
      currentUser = storedUser;
      updateHeaderUI();
      // 延迟：网络校验 /api/auth/me 与云端同步放到首屏绘制后，避免与首屏渲染争抢 CPU/网络
      onIdle(function(){
        fetchMe().then(function(){
          updateHeaderUI();
          setTimeout(function(){ syncFromCloud(); }, 500);
          startPeriodicSync();
          maybeAutoPromptInstall();
        }).catch(function(e){
          console.warn('Token expired, logging out:', e && e.message);
          clearToken(); clearStoredUser(); currentUser = null;
          updateHeaderUI();
        });
      });
    } else {
      updateHeaderUI();
      enableLoginWall();
    }
  }

  // 统一的 SVG 眼睛图标
  var EYE_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  function initPwToggles() {
    document.querySelectorAll('input[type="password"]').forEach(function(inp){
      if (inp.parentElement.classList.contains('pw-wrap')) return;
      var wrap = document.createElement('div');
      wrap.className = 'pw-wrap';
      inp.parentNode.insertBefore(wrap, inp);
      wrap.appendChild(inp);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pw-toggle';
      btn.innerHTML = EYE_OFF_SVG;
      btn.setAttribute('aria-label', '显示密码');
      btn.addEventListener('click', function(){
        if (inp.type === 'password') { inp.type = 'text'; btn.innerHTML = EYE_SVG; btn.setAttribute('aria-label','隐藏密码'); }
        else { inp.type = 'password'; btn.innerHTML = EYE_OFF_SVG; btn.setAttribute('aria-label','显示密码'); }
        inp.focus();
      });
      wrap.appendChild(btn);
    });
  }
  var _loginWall = false;
  function enableLoginWall() {
    _loginWall = true;
    var mask = document.getElementById('authMask');
    if (mask) { mask.hidden = false; var c = document.getElementById('authClose'); if (c) c.style.display = 'none'; }
    var app = document.getElementById('app'); if (app) app.style.visibility = 'hidden';
    var w = document.getElementById('welcome'); if (w) w.style.visibility = 'hidden';
  }
  function disableLoginWall() {
    _loginWall = false;
    var mask = document.getElementById('authMask');
    if (mask) { mask.hidden = true; var c = document.getElementById('authClose'); if (c) c.style.display = ''; }
    var app = document.getElementById('app'); if (app) app.style.visibility = '';
    var w = document.getElementById('welcome'); if (w) w.style.visibility = '';
  }
  /* === 忘记密码（三步验证码） === */
  var fCurrentStep = 1;

  function goFStep(n) {
    fCurrentStep = n;
    for (var i = 1; i <= 3; i++) {
      var pane = document.getElementById('forgotPane' + i);
      var stepEl = document.querySelector('.reg-step[data-fstep="' + i + '"]');
      if (pane) pane.hidden = (i !== n);
      if (stepEl) {
        stepEl.classList.toggle('active', i === n);
        stepEl.classList.toggle('done', i < n);
      }
    }
    var backBtn = document.getElementById('forgotBack');
    if (backBtn) backBtn.hidden = (n === 1);
    var submitBtn = document.getElementById('forgotSubmit');
    if (submitBtn) {
      var labels = {1: '发送验证码', 2: '下一步', 3: '重置密码'};
      submitBtn.textContent = labels[n];
    }
    var fe = document.getElementById('forgotError');
    if (fe) fe.classList.remove('show');
  }

  function openForgot() {
    document.getElementById('forgotMask').hidden = false;
    document.getElementById('forgotEmail').value = '';
    document.getElementById('forgotCode').value = '';
    document.getElementById('resetNewPassword').value = '';
    document.getElementById('resetConfirmPassword').value = '';
    goFStep(1);
  }
  function closeForgot() { document.getElementById('forgotMask').hidden = true; }

  // 发送重置验证码
  async function sendResetCode() {
    var email = document.getElementById('forgotEmail').value.trim();
    if (!email || !EMAIL_RE.test(email)) throw new Error('请输入有效的邮箱地址');
    await apiRequest('/api/auth/send-code', { method: 'POST', body: { email: email, type: 'reset' } });
  }

  /* === 管理员后台（admin-31~56）=== */
  var ADMIN_AUTO_MS = 30000;
  var adminAutoTimer = null;
  var adminState = {
    days: 14,
    usersPage: 1, usersPageSize: 20, usersQ: '', usersStatus: '', usersIsAdmin: '',
    usersSort: 'id', usersSortDir: 'asc', selected: {}, total: 0, page: 1,
    auditPage: 1, selectedInvites: {}
  };
  var _confirmCb = null, _confirmExpectName = null;

  function currentAdminTabName(){
    var map = {adminTabOverview:'overview',adminTabUsers:'users',adminTabInvites:'invites',adminTabSystem:'system',adminTabAudit:'audit'};
    for (var id in map){ var el = document.getElementById(id); if (el && el.classList.contains('active')) return map[id]; }
    return 'overview';
  }

  function openAdmin() {
    var m = document.getElementById('adminMask'); if (!m) return;
    var wasHidden = m.hidden;
    m.hidden = false;
    if (wasHidden) {
      lockBodyScroll(); // 锁定背景滚动：管理员后台内滚动不带动背后页面
      try { history.pushState({ __stModal: true }, ''); } catch (e) {} // 安卓返回键关闭
    }
    var auditTab = document.getElementById('adminTabAudit');
    if (auditTab) auditTab.hidden = !(currentUser && currentUser.isSuperAdmin);
    switchAdminTab('overview');
    startAdminAuto();
  }
  function closeAdmin() {
    var m = document.getElementById('adminMask'); if (!m || m.hidden) return;
    m.hidden = true;
    unlockBodyScroll();
    stopAdminAuto();
  }
  function startAdminAuto() {
    stopAdminAuto();
    adminAutoTimer = setInterval(function(){
      if (document.hidden) return;
      var cur = currentAdminTabName();
      if (cur === 'overview') loadAdminStats();
      else if (cur === 'system') loadAdminSystem();
    }, ADMIN_AUTO_MS);
  }
  function stopAdminAuto(){ if (adminAutoTimer){ clearInterval(adminAutoTimer); adminAutoTimer = null; } }

  function switchAdminTab(tab) {
    var tabs = {overview:'adminTabOverview',users:'adminTabUsers',invites:'adminTabInvites',system:'adminTabSystem',audit:'adminTabAudit'};
    var panes = {overview:'adminPaneOverview',users:'adminPaneUsers',invites:'adminPaneInvites',system:'adminPaneSystem',audit:'adminPaneAudit'};
    Object.keys(tabs).forEach(function(k){
      var t = document.getElementById(tabs[k]); if (t) t.classList.toggle('active', k === tab);
      var p = document.getElementById(panes[k]); if (p) p.hidden = (k !== tab);
    });
    if (tab === 'users') loadAdminUsers();
    else if (tab === 'invites') loadInviteList();
    else if (tab === 'system') loadAdminSystem();
    else if (tab === 'audit') loadAuditLogs(1);
    else loadAdminStats();
  }

  /* ---- 概览 admin-31/32/33 ---- */
  async function loadAdminStats() {
    try {
      var d = await apiRequest('/api/admin/stats?days=' + adminState.days, {method:'GET'});
      var set = function(id,v){ var el=document.getElementById(id); if(el) el.textContent=(v!=null?v:'—'); };
      set('statTotalUsers', d.totalUsers);
      set('statActiveUsers', d.activeUsers);
      var newSum = Array.isArray(d.newUsersTrend) ? d.newUsersTrend.reduce(function(a,b){return a+b;},0) : 0;
      set('statNewUsers', newSum);
      set('statTotalProjects', d.totalProjects);
      set('statActive7d', d.active7d);
      var rr = d.retentionNextDay || {};
      set('statRetRate', (rr.rate != null ? rr.rate + '%' : '—'));
      renderBars('dauChart', d.activeTrend || [], 'dau');
      renderBars('newChart', d.newUsersTrend || [], 'new');
      set('retRegistered', rr.registered); set('retReturned', rr.returned);
      set('retRate', (rr.rate != null ? rr.rate + '%' : '—'));
      var pct = d.storagePercent || 0;
      var pctEl = document.getElementById('storagePercent'); if (pctEl) pctEl.textContent = pct;
      var fill = document.getElementById('storageBarFill');
      if (fill){ fill.style.width = Math.max(1,pct) + '%'; fill.className = 'storage-bar-fill' + (pct >= 95 ? ' danger' : pct >= 80 ? ' warn' : ''); }
      var detail = document.getElementById('storageDetail');
      if (detail) detail.textContent = '已用 ' + d.dataSizeMB + ' MB / 配额 ' + d.quotaMB + ' MB（单用户上限 ' + (d.perUserQuotaMB || '—') + ' MB）';
      var warn = document.getElementById('storageWarn');
      if (warn){
        if (pct >= 95){ warn.hidden = false; warn.className = 'storage-warn danger'; warn.textContent = '存储即将用尽，请及时清理或扩容'; }
        else if (pct >= 80){ warn.hidden = false; warn.className = 'storage-warn'; warn.textContent = '存储用量偏高，请注意'; }
        else warn.hidden = true;
      }
    } catch(e){ console.error('stats:', e); }
  }
  function renderBars(elId, arr, kind){
    var el = document.getElementById(elId); if (!el) return;
    var maxV = Math.max(1, Math.max.apply(null, arr.concat([0])));
    el.innerHTML = arr.map(function(v,i){
      var h = Math.round((v/maxV)*86) + 2;
      var cls = 'chart-bar' + (v === 0 ? ' zero' : '') + (kind === 'new' ? ' alt' : '');
      var dt = new Date(); dt.setDate(dt.getDate() - (arr.length - 1 - i));
      var label = (dt.getMonth()+1) + '/' + dt.getDate();
      var click = v > 0 ? ' onclick="STAuth._chartDrill(\'' + kind + '\',\'' + label + '\',' + v + ')"' : '';
      return '<div class="chart-col" title="' + label + '：' + v + ' 人"><div class="' + cls + '" style="height:' + h + 'px"' + click + '></div></div>';
    }).join('');
  }
  function _chartDrill(kind, label, count){
    if (typeof showToast === 'function') showToast('📊', label, (kind === 'new' ? '新增用户 ' : '活跃用户 ') + count + ' 人', 2600);
    if (kind === 'new') switchAdminTab('users');
  }

  /* ---- 用户 admin-34~41 ---- */
  function fmtSync(t){ if(!t) return '从未'; return fmtDateTime(t).slice(5,16); }
  async function loadAdminUsers(silent){
    var tb = document.getElementById('adminUsersBody'); if (!tb) return;
    if (!silent) tb.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--muted)">加载中…</td></tr>';
    try {
      var qs = '?page=' + adminState.usersPage + '&pageSize=' + adminState.usersPageSize;
      if (adminState.usersQ) qs += '&q=' + encodeURIComponent(adminState.usersQ);
      if (adminState.usersStatus) qs += '&status=' + adminState.usersStatus;
      if (adminState.usersIsAdmin) qs += '&isAdmin=1';
      var d = await apiRequest('/api/admin/users' + qs, {method:'GET'});
      var items = d.items || [];
      var sortKey = adminState.usersSort, dir = adminState.usersSortDir === 'desc' ? -1 : 1;
      items.sort(function(a,b){
        var va = a[sortKey], vb = b[sortKey];
        if (sortKey === 'createdAt' || sortKey === 'lastLoginAt'){
          var da = parseServerTime(va); va = da ? da.getTime() : 0;
          var db2 = parseServerTime(vb); vb = db2 ? db2.getTime() : 0;
        }
        if (va == null) va = ''; if (vb == null) vb = '';
        if (va < vb) return -1 * dir; if (va > vb) return 1 * dir; return 0;
      });
      adminState.total = d.total || 0; adminState.page = d.page || 1;
      if (!items.length){ tb.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--muted)">暂无用户</td></tr>'; renderPager(); updateBatchBar(); return; }
      var meSuper = currentUser && currentUser.isSuperAdmin;
      tb.innerHTML = items.map(function(u){
        var self = currentUser && u.id === currentUser.id;
        var name = esc(u.username || '');
        var nameJs = esc(JSON.stringify(u.username || ''));
        var adminBadge = u.isSuperAdmin ? '<span class="badge-admin">超级管理员</span>' : (u.isAdmin ? '<span class="badge-admin">管理员</span>' : '');
        var st = u.deletedAt 
               ? (u.deleteReason === 'self' ? '<span class="badge-deleted">已注销</span>' : '<span class="badge-deleted">回收站</span>')
               : (u.status === 'disabled' ? '<span class="badge-disabled">已禁用</span>' : '<span class="badge-active">正常</span>');
        var checked = adminState.selected[u.id] ? ' checked' : '';
        var ops = '<button class="ghost-btn adm-op" onclick="STAuth._userDetail(' + u.id + ')">详情</button>';
        if (self){ ops = '<span style="color:var(--muted);font-size:12px">当前账号</span>'; }
        else if (u.isSuperAdmin && !meSuper){ ops = '<span style="color:var(--muted);font-size:12px">受保护账号</span>'; }
        else if (u.deletedAt){
          ops += '<button class="ghost-btn adm-op" onclick="STAuth._restoreUser(' + u.id + ')">恢复</button>';
          ops += '<button class="ghost-btn adm-op adm-danger" onclick="STAuth._permanentUser(' + u.id + ',' + nameJs + '">永久删除</button>';
        } else {
          ops += '<button class="ghost-btn adm-op" onclick="STAuth._resetPw(' + u.id + ')">重置密码</button>';
          if (u.status === 'disabled') ops += '<button class="ghost-btn adm-op" onclick="STAuth._setStatus(' + u.id + ',\'active\')">启用</button>';
          else ops += '<button class="ghost-btn adm-op" onclick="STAuth._openBan(' + u.id + ')">封禁</button>';
          if (meSuper) ops += '<button class="ghost-btn adm-op" onclick="STAuth._toggleAdmin(' + u.id + ',' + (u.isAdmin ? 'false' : 'true') + ')">' + (u.isAdmin ? '取消管理员' : '设为管理员') + '</button>';
          ops += '<button class="ghost-btn adm-op adm-danger" onclick="STAuth._softDelete(' + u.id + ',' + nameJs + '">删除</button>';
        }
        return '<tr><td><input type="checkbox" class="ad-table-check rowcheck" data-id="' + u.id + '"' + checked + '></td>'
          + '<td>' + u.id + '</td><td>' + name + adminBadge + '</td><td>' + esc(u.email || '—') + '</td>'
          + '<td>' + st + '</td><td>' + (u.projectCount || 0) + '</td>'
          + '<td>' + fmtSync(u.lastLoginAt) + '</td><td>' + (u.createdAt ? fmtDateTime(u.createdAt) : '—') + '</td>'
          + '<td><div class="adm-ops">' + ops + '</div></td></tr>';
      }).join('');
      renderPager(); updateBatchBar();
    } catch(e){
      tb.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--bad)">' + esc(e.message || '加载失败') + '</td></tr>';
    }
  }
  function renderPager(){
    var total = adminState.total || 0, page = adminState.page || 1, ps = adminState.usersPageSize || 20;
    var pages = Math.max(1, Math.ceil(total/ps));
    var info = document.getElementById('adPagerInfo'); if (info) info.textContent = '第 ' + page + ' / ' + pages + ' 页 · 共 ' + total + ' 人';
    var prev = document.getElementById('adPagerPrev'), next = document.getElementById('adPagerNext');
    if (prev) prev.disabled = (page <= 1);
    if (next) next.disabled = (page >= pages);
  }
  function updateBatchBar(){
    var n = Object.keys(adminState.selected).length;
    var bar = document.getElementById('adBatchBar');
    if (bar){ bar.classList.toggle('show', n > 0); var lab = document.getElementById('adBatchCount'); if (lab) lab.textContent = '已选 ' + n + ' 人'; }
    var head = document.getElementById('adCheckAll');
    if (head){
      var rows = document.querySelectorAll('#adminUsersBody .rowcheck');
      var checkedN = 0; rows.forEach ? rows.forEach(function(r){ if(r.checked) checkedN++; }) : Array.prototype.forEach.call(rows, function(r){ if(r.checked) checkedN++; });
      head.checked = rows.length > 0 && checkedN === rows.length;
      head.indeterminate = checkedN > 0 && checkedN < rows.length;
    }
  }
  async function _userDetail(id){
    try {
      var d = await apiRequest('/api/admin/users/' + id, {method:'GET'});
      var u = d.user || {}, dt = d.data || {};
      document.getElementById('udTitle').textContent = '用户详情 · ' + (u.username || ('#' + u.id));
      var logins = (d.recentLogins || []).map(function(l){
        var ok = l.result ? '成功' : '失败';
        return '<div class="login-row"><span class="lr-ip">' + esc(l.ip || '—') + '</span> · ' + ok +
          '<div class="lr-meta">' + (l.created_at ? fmtDateTime(l.created_at) : '') + ' · ' + esc(l.ua || '—') + '</div></div>';
      }).join('') || '<div style="color:var(--muted);font-size:12.5px">暂无登录记录</div>';
      var codes = (d.inviteCodes || []).map(function(c){
        var st = c.used_at ? '已用' : (c.revoked_at ? '作废' : '未用');
        return '<div class="login-row"><span class="lr-ip">' + esc(c.code || '') + '</span> · ' + st +
          '<div class="lr-meta">' + (c.note ? '备注：' + esc(c.note) : '') + (c.note && c.channel ? ' · ' : '') + (c.channel ? '渠道：' + esc(c.channel) : '') + (!c.note && !c.channel ? '—' : '') + (c.used_at ? ' · ' + fmtDateTime(c.used_at) : '') + '</div></div>';
      }).join('') || '<div style="color:var(--muted);font-size:12.5px">无关联邀请码</div>';
      document.getElementById('udBody').innerHTML =
        '<div class="drow"><span>邮箱</span><b>' + esc(u.email || '—') + '</b></div>'
        + '<div class="drow"><span>状态</span><b>' + (u.deletedAt ? (u.deleteReason === 'self' ? '已注销（用户自助）' : '已删除（管理员操作）') : esc(u.status || '—')) + '</b></div>'
        + (u.banReason ? '<div class="drow"><span>封禁原因</span><b>' + esc(u.banReason) + '</b></div>' : '')
        + (u.banUntil ? '<div class="drow"><span>封禁至</span><b>' + fmtDateTime(u.banUntil) + '</b></div>' : '')
        + '<div class="drow"><span>数据量</span><b>' + (dt.sizeBytes != null ? Math.round(dt.sizeBytes/1024*100)/100 + ' KB' : '—') + '</b></div>'
        + '<div class="drow"><span>项目数</span><b>' + (dt.projectCount || 0) + '</b></div>'
        + '<div class="drow"><span>最后同步</span><b>' + fmtDateTime(dt.lastSyncAt) + '</b></div>'
        + '<div class="drow"><span>注册时间</span><b>' + fmtDateTime(u.createdAt) + '</b></div>'
        + '<div class="dsec">最近登录</div>' + logins
        + '<div class="dsec">关联邀请码</div>' + codes;
      document.getElementById('userDrawerMask').hidden = false;
    } catch(e){ if (typeof showToast === 'function') showToast('❌', e.message || '加载失败'); }
  }
  async function _resetPw(id){
    try {
      var d = await apiRequest('/api/admin/users/' + id + '/reset-password', {method:'POST'});
      document.getElementById('resetPwBody').innerHTML =
        '<p class="msub">' + esc(d.message || '临时密码已生成，请转告用户并提醒其登录后立即修改') + '</p>'
        + '<div class="invite-code-display">' + esc(d.tempPassword) + '</div>';
      document.getElementById('resetPwMask').hidden = false;
    } catch(e){ if (typeof showToast === 'function') showToast('❌', e.message || '重置失败'); }
  }
  var _banUserId = null;
  function _openBan(id){
    _banUserId = id;
    document.getElementById('banReason').value = '';
    document.getElementById('banErr').hidden = true;
    document.getElementById('banMask').hidden = false;
  }
  async function _doBan(){
    var reason = document.getElementById('banReason').value.trim();
    var hrs = parseInt(document.getElementById('banDuration').value, 10);
    var body = {status:'disabled'};
    if (reason) body.banReason = reason;
    if (hrs > 0) body.banUntil = new Date(Date.now() + hrs*3600*1000).toISOString();
    try {
      await apiRequest('/api/admin/users/' + _banUserId + '/status', {method:'PUT', body:body});
      document.getElementById('banMask').hidden = true;
      if (typeof showToast === 'function') showToast('✅', '已封禁并强制下线');
      loadAdminUsers(true); loadAdminStats();
    } catch(e){ document.getElementById('banErr').hidden = false; document.getElementById('banErr').textContent = e.message || '操作失败'; }
  }
  async function _setStatus(id, status){
    try {
      await apiRequest('/api/admin/users/' + id + '/status', {method:'PUT', body:{status:status}});
      if (typeof showToast === 'function') showToast('✅', status === 'active' ? '已启用' : '已禁用');
      loadAdminUsers(true); loadAdminStats();
    } catch(e){ if (typeof showToast === 'function') showToast('❌', e.message || '操作失败'); }
  }
  function _doToggleAdmin(id, makeAdmin, password){
    var _body = {isAdmin:makeAdmin}; if (password) _body.password = password;
    apiRequest('/api/admin/users/' + id + '/admin', {method:'PUT', body:_body})
      .then(function(){ if (typeof showToast === 'function') showToast('✅', makeAdmin ? '已设为管理员' : '已取消管理员'); loadAdminUsers(true); loadAdminStats(); })
      .catch(function(e){ if (typeof showToast === 'function') showToast('❌', e.message || '操作失败'); });
  }
  function _toggleAdmin(id, makeAdmin){
    makeAdmin = (makeAdmin === 'true' || makeAdmin === true);
    if (!makeAdmin){
      openConfirm({title:'取消管理员', msg:'将取消该用户的管理员权限（管理员降权）。请重输当前超级管理员密码以确认。', needPassword:true,
        onOk:function(d){ _doToggleAdmin(id, makeAdmin, d && d.password); }});
    } else {
      openConfirm({title:'设为管理员', msg:'将该用户设为管理员？', onOk:function(){ _doToggleAdmin(id, makeAdmin); }});
    }
  }
  function _softDelete(id, username){
    openConfirm({title:'软删除用户', msg:'将用户「' + username + '」移入回收站？其云端数据将先导出备份。请输入该用户名以确认。', expectName:username,
      onOk:function(){
        apiRequest('/api/admin/users/' + id, {method:'DELETE'})
          .then(function(){ if (typeof showToast === 'function') showToast('✅', '已移入回收站'); adminState.selected = {}; loadAdminUsers(true); loadAdminStats(); })
          .catch(function(e){ if (typeof showToast === 'function') showToast('❌', e.message || '删除失败'); });
      }});
  }
  function _restoreUser(id){
    openConfirm({title:'恢复用户', msg:'将该用户从回收站恢复为正常状态？', onOk:function(){
      apiRequest('/api/admin/users/' + id + '/restore', {method:'POST'})
        .then(function(){ if (typeof showToast === 'function') showToast('✅', '已恢复'); loadAdminUsers(true); loadAdminStats(); })
        .catch(function(e){ if (typeof showToast === 'function') showToast('❌', e.message || '操作失败'); });
    }});
  }
  function _permanentUser(id, username){
    openConfirm({title:'永久删除用户', msg:'将物理删除用户「' + username + '」及其全部数据，不可恢复！请输入用户名并重输当前管理员密码。', expectName:username, needPassword:true,
      onOk:function(d){
        apiRequest('/api/admin/users/' + id + '/permanent', {method:'DELETE', body:{password: d && d.password}})
          .then(function(){ if (typeof showToast === 'function') showToast('✅', '已永久删除'); adminState.selected = {}; loadAdminUsers(true); loadAdminStats(); })
          .catch(function(e){ if (typeof showToast === 'function') showToast('❌', e.message || '删除失败'); });
      }});
  }
  async function _exportCsv(){
    try {
      var tok = getToken();
      var resp = await fetch('/api/admin/users/export?format=csv&_t=' + Date.now(), {headers:{'Authorization':'Bearer ' + tok}});
      if (!resp.ok) throw new Error('导出失败 (' + resp.status + ')');
      var blob = await resp.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a'); a.href = url; a.download = 'users-' + Date.now() + '.csv';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      if (typeof showToast === 'function') showToast('✅', '已导出 CSV');
    } catch(e){ if (typeof showToast === 'function') showToast('❌', e.message || '导出失败'); }
  }
  function _batchDisable(){
    var ids = Object.keys(adminState.selected);
    if (!ids.length) return;
    openConfirm({title:'批量禁用', msg:'将禁用选中的 ' + ids.length + ' 个用户（并强制其下线）？', onOk:function(){
      Promise.all(ids.map(function(id){ return apiRequest('/api/admin/users/' + id + '/status', {method:'PUT', body:{status:'disabled'}}).catch(function(){ return null; }); }))
        .then(function(){ adminState.selected = {}; if (typeof showToast === 'function') showToast('✅', '已批量禁用'); loadAdminUsers(true); loadAdminStats(); });
    }});
  }

  /* ---- 邀请码 admin-42/44 ---- */
  async function loadInviteList(){
    var tb = document.getElementById('adminInvitesBody'); if (!tb) return;
    tb.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--muted)">加载中…</td></tr>';
    try {
      var d = await apiRequest('/api/admin/invite/list', {method:'GET'});
      var codes = d.codes || [];
      if (!codes.length){ tb.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--muted)">暂无邀请码</td></tr>'; updateInviteBatchBar(); return; }
      // 排序：未用 > 已作废/已过期 > 已用（未用邀请码排在最上面，方便管理）
      codes.sort(function(a, b){
        function rank(c){
          var exp = c.expiresAt && parseServerTime(c.expiresAt) < new Date();
          if (c.usedAt) return 2;
          if (c.revokedAt || exp) return 1;
          return 0;
        }
        var ra = rank(a), rb = rank(b);
        if (ra !== rb) return ra - rb;
        // 同状态按创建时间倒序（新的在前）
        var ta = a.createdAt ? parseServerTime(a.createdAt).getTime() : 0;
        var tb2 = b.createdAt ? parseServerTime(b.createdAt).getTime() : 0;
        return tb2 - ta;
      });
      tb.innerHTML = codes.map(function(c){
        var expDate = parseServerTime(c.expiresAt);
        var expired = !c.usedAt && !c.revokedAt && expDate && expDate < new Date();
        var st = c.usedAt ? '<span class="badge-used">已用</span>'
               : (c.revokedAt ? '<span class="badge-revoked">已作废</span>'
               : (expired ? '<span class="badge-disabled">已过期</span>' : '<span class="badge-unused">未用</span>'));
        var user = c.usedAt ? esc(c.usedByName || '—') : '—';
        var exp = c.expiresAt ? fmtDateTime(c.expiresAt) : '永久';
        var canBatchDel = !!(c.usedAt || c.revokedAt || expired);
        var checked = adminState.selectedInvites[c.code] ? ' checked' : '';
        var checkbox = canBatchDel
          ? '<input type="checkbox" class="ad-table-check invite-check" data-code="' + esc(c.code) + '"' + checked + '>'
          : '';
        var delBtn = (c.usedAt || c.revokedAt)
          ? '<button class="ghost-btn adm-op" disabled style="opacity:.4;cursor:not-allowed">作废</button>'
          : '<button class="ghost-btn adm-op adm-danger" onclick="STAuth._deleteCode(\'' + c.code + '\')">作废</button>';
        return '<tr><td>' + checkbox + '</td>'
          + '<td style="font-family:monospace;font-weight:600">' + esc(c.code) + '</td>'
          + '<td>' + esc(c.note || '—') + '</td><td>' + esc(c.channel || '—') + '</td>'
          + '<td>' + user + '</td><td>' + (c.usedAt ? fmtDateTime(c.usedAt) : '—') + '</td><td>' + exp + '</td><td>' + st + '</td>'
          + '<td><div class="adm-ops"><button class="ghost-btn adm-op" onclick="STAuth._copyCode(\'' + c.code + '\')">复制</button>' + delBtn + '</div></td></tr>';
      }).join('');
      // 绑定复选框事件
      tb.querySelectorAll('.invite-check').forEach(function(cb){
        cb.addEventListener('change', function(){
          var code = cb.getAttribute('data-code');
          if (cb.checked) adminState.selectedInvites[code] = 1;
          else delete adminState.selectedInvites[code];
          updateInviteBatchBar();
        });
      });
      updateInviteBatchBar();
    } catch(e){ tb.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--bad)">' + esc(e.message || '加载失败') + '</td></tr>'; }
  }
  function updateInviteBatchBar(){
    var n = Object.keys(adminState.selectedInvites || {}).length;
    var bar = document.getElementById('inviteBatchBar');
    if (bar){ bar.classList.toggle('show', n > 0); var lab = document.getElementById('inviteBatchCount'); if (lab) lab.textContent = '已选 ' + n + ' 个'; }
    var head = document.getElementById('inviteCheckAll');
    if (head){
      var rows = document.querySelectorAll('#adminInvitesBody .invite-check');
      var checkedN = 0; rows.forEach(function(r){ if(r.checked) checkedN++; });
      head.checked = rows.length > 0 && checkedN === rows.length;
      head.indeterminate = checkedN > 0 && checkedN < rows.length;
    }
  }
  async function _batchDeleteInvites(){
    var codes = Object.keys(adminState.selectedInvites || {});
    if (!codes.length) return;
    openConfirm({title:'批量清理邀请码', msg:'确定永久删除选中的 ' + codes.length + ' 个已用/已作废/已过期邀请码？此操作不可恢复。', onOk:function(){
      apiRequest('/api/admin/invite/batch-delete', {method:'POST', body:{codes: codes}})
        .then(function(d){
          adminState.selectedInvites = {};
          if (typeof showToast === 'function') showToast('✅', '已清理 ' + (d.deleted || codes.length) + ' 个邀请码');
          loadInviteList(); loadAdminStats();
        })
        .catch(function(e){ if (typeof showToast === 'function') showToast('❌', e.message || '操作失败'); });
    }});
  }
  async function _deleteCode(code){
    openConfirm({title:'作废邀请码', msg:'确定作废未使用的邀请码 ' + code + '？', onOk:function(){
      apiRequest('/api/admin/invite/' + encodeURIComponent(code), {method:'DELETE'})
        .then(function(){ if (typeof showToast === 'function') showToast('✅', '邀请码已作废'); loadInviteList(); loadAdminStats(); })
        .catch(function(e){ if (typeof showToast === 'function') showToast('❌', e.message || '操作失败'); });
    }});
  }
  function _copyCode(code){
    var done = function(){ if (typeof showToast === 'function') showToast('✅', '已复制 ' + code); };
    if (navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(code).then(done).catch(function(){ _copyFallback(code, done); });
    } else { _copyFallback(code, done); }
  }
  function _copyFallback(code, done){
    try{
      var ta = document.createElement('textarea'); ta.value = code; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); done();
    }catch(e){ if (typeof showToast === 'function') showToast('⚠️', '请手动复制'); }
  }

  /* ---- 系统 admin-45/46 ---- */
  function fmtUptime(sec){
    sec = Number(sec) || 0;
    var dd = Math.floor(sec/86400), hh = Math.floor((sec%86400)/3600), mm = Math.floor((sec%3600)/60);
    if (dd > 0) return dd + ' 天 ' + hh + ' 小时';
    if (hh > 0) return hh + ' 小时 ' + mm + ' 分';
    return mm + ' 分钟';
  }
  function setMeter(fillId, pct){
    var f = document.getElementById(fillId);
    if (f){ f.style.width = Math.max(1,pct) + '%'; f.className = 'sys-meter-fill' + (pct >= 95 ? ' danger' : pct >= 80 ? ' warn' : ''); }
  }
  async function loadAdminSystem(){
    try {
      var d = await apiRequest('/api/admin/system', {method:'GET'});
      var set = function(id,v){ var el = document.getElementById(id); if (el) el.textContent = (v != null ? v : '—'); };
      set('sysAppUptime', fmtUptime(d.appUptimeSec));
      set('sysSystemUptime', fmtUptime(d.systemUptimeSec));
      set('sysNodeVersion', d.nodeVersion);
      set('sysPlatform', d.platform);
      set('sysCpuCount', d.cpuCount);
      set('sysDbSize', d.dbSizeMB != null ? d.dbSizeMB + ' MB' : '—');
      if (d.memory){ set('sysMemPercent', d.memory.usedPercent + '%'); set('sysMemDetail', '共 ' + d.memory.totalMB + ' MB'); setMeter('sysMemFill', d.memory.usedPercent); }
      if (d.disk){ set('sysDiskPercent', d.disk.usedPercent + '%'); set('sysDiskDetail', d.disk.freeGB + ' GB 可用 / 共 ' + d.disk.totalGB + ' GB'); setMeter('sysDiskFill', d.disk.usedPercent); }
      else { set('sysDiskPercent', '—'); set('sysDiskDetail', '无法获取'); }
      // 备份状态
      var bk = d.backups || {};
      var bkAt = document.getElementById('bkLastAt');
      if (bkAt){
        if (bk.lastBackupAt){ bkAt.textContent = fmtDateTime(bk.lastBackupAt); bkAt.className = bk.backupStatus === 'ok' ? 'backup-ok' : 'backup-stale'; }
        else { bkAt.textContent = '从未备份'; bkAt.className = 'backup-none'; }
      }
      set('bkName', bk.lastBackupName || '—');
      set('bkSize', bk.lastBackupSize ? Math.round(bk.lastBackupSize/1024/1024*100)/100 + ' MB' : '—');
      set('bkStatus', bk.backupStatus === 'ok' ? '正常' : (bk.backupStatus === 'stale' ? '过期（超过26小时）' : '无备份'));
      // 应用指标
      var m = d.appMetrics || {};
      set('mTotalReq', m.totalRequests != null ? m.totalRequests : '—');
      set('m5xx', m.count5xx != null ? m.count5xx : '—');
      set('mErrRate', m.errorRate != null ? m.errorRate + '%' : '—');
      set('mSyncLat', m.avgSyncLatencyMs != null ? m.avgSyncLatencyMs + ' ms' : '—');
    } catch(e){ console.error('system:', e); }
  }

  /* ---- 审计 admin-49 ---- */
  async function loadAuditLogs(page){
    if (page) adminState.auditPage = page;
    var tb = document.getElementById('auditBody'); if (!tb) return;
    tb.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted)">加载中…</td></tr>';
    try {
      var d = await apiRequest('/api/admin/audit-logs?page=' + adminState.auditPage + '&pageSize=20', {method:'GET'});
      var items = d.items || [];
      if (!items.length){ tb.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted)">暂无日志</td></tr>'; renderAuditPager(d); return; }
      tb.innerHTML = items.map(function(a){
        var tgt = (a.target_type || '') + (a.target_id ? ' #' + a.target_id : '');
        return '<tr><td>' + esc(a.admin_name || ('用户#' + a.admin_id)) + '</td><td>' + esc(a.action || '') + '</td>'
          + '<td>' + esc(tgt || '—') + '</td><td style="font-family:monospace">' + esc(a.ip || '—') + '</td>'
          + '<td>' + (a.created_at ? fmtDateTime(a.created_at) : '—') + '</td></tr>';
      }).join('');
      renderAuditPager(d);
    } catch(e){ tb.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--bad)">' + esc(e.message || '加载失败') + '</td></tr>'; }
  }
  function renderAuditPager(d){
    var total = (d && d.total) || 0, page = adminState.auditPage || 1, ps = (d && d.pageSize) || 20;
    var pages = Math.max(1, Math.ceil(total/ps));
    var info = document.getElementById('auditPagerInfo'); if (info) info.textContent = '第 ' + page + ' / ' + pages + ' 页 · 共 ' + total + ' 条';
    var prev = document.getElementById('auditPagerPrev'), next = document.getElementById('auditPagerNext');
    if (prev) prev.disabled = (page <= 1);
    if (next) next.disabled = (page >= pages);
  }

  /* ---- 统一危险确认 admin-52/54/55 ---- */
  function openConfirm(opts){
    _confirmCb = opts.onOk; _confirmExpectName = opts.expectName || null;
    document.getElementById('confirmTitle').textContent = opts.title || '确认操作';
    document.getElementById('confirmMsg').textContent = opts.msg || '';
    document.getElementById('confirmNameWrap').hidden = !opts.expectName;
    document.getElementById('confirmPassWrap').hidden = !opts.needPassword;
    document.getElementById('confirmErr').hidden = true;
    document.getElementById('confirmNameInput').value = '';
    document.getElementById('confirmPassInput').value = '';
    document.getElementById('confirmMask').hidden = false;
  }
  function closeConfirm(){ document.getElementById('confirmMask').hidden = true; _confirmCb = null; _confirmExpectName = null; }
  async function _confirmOk(){
    if (!_confirmCb) return;
    var errEl = document.getElementById('confirmErr');
    var needName = !document.getElementById('confirmNameWrap').hidden;
    var needPass = !document.getElementById('confirmPassWrap').hidden;
    var pw = null;
    if (needName){
      var nv = document.getElementById('confirmNameInput').value.trim();
      if (nv !== _confirmExpectName){ errEl.hidden = false; errEl.textContent = '用户名输入不一致'; return; }
    }
    if (needPass){
      pw = document.getElementById('confirmPassInput').value;
      if (!pw){ errEl.hidden = false; errEl.textContent = '请输入当前管理员密码'; return; }
    }
    document.getElementById('confirmMask').hidden = true;
    var cb = _confirmCb; _confirmCb = null; _confirmExpectName = null; cb(pw ? { password: pw } : null);
  }

  /* ---- 注销账号 admin-51 ---- */
  async function _sendDelAcctCode(){
    try {
      await apiRequest('/api/auth/send-code', {method:'POST', body:{email: currentUser.email, type:'delete'}});
      if (typeof showToast === 'function') showToast('📧', '验证码已发送', '请查收邮箱', 3500);
      armCodeCooldown(document.getElementById('delAcctSend'), 60, '发送验证码');
    } catch(e){ if (typeof showToast === 'function') showToast('❌', e.message || '发送失败'); }
  }
  async function _doDeleteAccount(){
    var code = document.getElementById('delAcctCode').value.trim();
    var errEl = document.getElementById('delAcctErr');
    if (!code){ errEl.hidden = false; errEl.textContent = '请输入验证码'; return; }
    try {
      await apiRequest('/api/user', {method:'DELETE', body:{code:code}});
      document.getElementById('delAcctMask').hidden = true;
      if (typeof showToast === 'function') showToast('👋', '账号已注销');
      doLogout();
    } catch(e){ errEl.hidden = false; errEl.textContent = e.message || '注销失败'; }
  }

  function bindAdminEvents(){
    // 时间范围
    var seg = document.getElementById('adRangeSeg');
    if (seg) seg.querySelectorAll('button').forEach(function(b){
      b.addEventListener('click', function(){
        seg.querySelectorAll('button').forEach(function(x){ x.classList.remove('active'); });
        b.classList.add('active');
        adminState.days = parseInt(b.getAttribute('data-days'), 10) || 14;
        loadAdminStats();
      });
    });
    // 标签切换
    [['adminTabOverview','overview'],['adminTabUsers','users'],['adminTabInvites','invites'],['adminTabSystem','system'],['adminTabAudit','audit']].forEach(function(pair){
      var el = document.getElementById(pair[0]);
      if (el) el.addEventListener('click', function(){ switchAdminTab(pair[1]); });
    });
    // 用户搜索/筛选
    var uq = document.getElementById('adSearch');
    if (uq){ var t; uq.addEventListener('input', function(){ clearTimeout(t); t = setTimeout(function(){ adminState.usersPage = 1; adminState.usersQ = uq.value.trim(); loadAdminUsers(); }, 300); }); }
    var us = document.getElementById('adStatusFilter');
    if (us) us.addEventListener('change', function(){ adminState.usersPage = 1; adminState.usersStatus = us.value; loadAdminUsers(); });
    var ua = document.getElementById('adAdminFilter');
    if (ua) ua.addEventListener('change', function(){ adminState.usersPage = 1; adminState.usersIsAdmin = ua.value; loadAdminUsers(); });
    // 全选
    var head = document.getElementById('adCheckAll');
    if (head) head.addEventListener('change', function(){
      var rows = document.querySelectorAll('#adminUsersBody .rowcheck');
      Array.prototype.forEach.call(rows, function(r){ r.checked = head.checked; adminState.selected[r.getAttribute('data-id')] = head.checked ? 1 : 0; if(!head.checked) delete adminState.selected[r.getAttribute('data-id')]; });
      updateBatchBar();
    });
    // 邀请码全选
    var inviteHead = document.getElementById('inviteCheckAll');
    if (inviteHead) inviteHead.addEventListener('change', function(){
      var rows = document.querySelectorAll('#adminInvitesBody .invite-check');
      Array.prototype.forEach.call(rows, function(r){ r.checked = inviteHead.checked; var code = r.getAttribute('data-code'); if(inviteHead.checked) adminState.selectedInvites[code] = 1; else delete adminState.selectedInvites[code]; });
      updateInviteBatchBar();
    });
    var tbody = document.getElementById('adminUsersBody');
    if (tbody) tbody.addEventListener('change', function(e){
      var t = e.target; if (!t.classList || !t.classList.contains('rowcheck')) return;
      var id = t.getAttribute('data-id');
      if (t.checked) adminState.selected[id] = 1; else delete adminState.selected[id];
      updateBatchBar();
    });
    // 排序
    document.querySelectorAll('.sort-th').forEach(function(th){
      th.addEventListener('click', function(){
        var key = th.getAttribute('data-sort'); if (!key) return;
        if (adminState.usersSort === key) adminState.usersSortDir = (adminState.usersSortDir === 'asc' ? 'desc' : 'asc');
        else { adminState.usersSort = key; adminState.usersSortDir = 'asc'; }
        loadAdminUsers(true);
      });
    });
    // 分页
    var prev = document.getElementById('adPagerPrev'); if (prev) prev.addEventListener('click', function(){ if (adminState.page > 1){ adminState.usersPage = adminState.page - 1; loadAdminUsers(); } });
    var next = document.getElementById('adPagerNext'); if (next) next.addEventListener('click', function(){ adminState.usersPage = adminState.page + 1; loadAdminUsers(); });
    var ap = document.getElementById('auditPagerPrev'); if (ap) ap.addEventListener('click', function(){ if (adminState.auditPage > 1) loadAuditLogs(adminState.auditPage - 1); });
    var an = document.getElementById('auditPagerNext'); if (an) an.addEventListener('click', function(){ loadAuditLogs(adminState.auditPage + 1); });
    // 批量
    var be = document.getElementById('adBatchExport'); if (be) be.addEventListener('click', _exportCsv);
    var beTop = document.getElementById('adExportTop'); if (beTop) beTop.addEventListener('click', _exportCsv);
    var bd = document.getElementById('adBatchDisable'); if (bd) bd.addEventListener('click', _batchDisable);
    // 生成邀请码
    var bGen = document.getElementById('btnGenInvite');
    if (bGen) bGen.addEventListener('click', async function(){
      var cnt = parseInt(document.getElementById('inviteCount').value) || 1;
      var daysRaw = (document.getElementById('inviteExpireDays').value || '').trim();
      var note = (document.getElementById('inviteNote').value || '').trim();
      var channel = (document.getElementById('inviteChannel').value || '').trim();
      var body = {count: cnt};
      if (daysRaw) body.expiresInDays = parseInt(daysRaw, 10);
      if (note) body.note = note;
      if (channel) body.channel = channel;
      try {
        var d = await apiRequest('/api/admin/invite/generate', {method:'POST', body:body});
        var codes = d.codes || [];
        if (codes.length){
          document.getElementById('newInviteDisplay').hidden = false;
          var cel = document.getElementById('newInviteCode');
          cel.textContent = codes.join('  ·  ');
          cel.onclick = function(){ if (navigator.clipboard) navigator.clipboard.writeText(codes.join(',')); if (typeof showToast === 'function') showToast('✅', '邀请码已复制'); };
        }
        loadInviteList(); loadAdminStats();
      } catch(e){ if (typeof showToast === 'function') showToast('❌', e.message || '生成失败'); }
    });
    // 共享弹窗
    var bindClose = function(id, fn){ var el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    bindClose('confirmClose', closeConfirm); bindClose('confirmCancel', closeConfirm);
    bindClose('confirmOk', _confirmOk);
    bindClose('banClose', function(){ document.getElementById('banMask').hidden = true; });
    bindClose('banCancel', function(){ document.getElementById('banMask').hidden = true; });
    bindClose('banOk', _doBan);
    bindClose('resetPwClose', function(){ document.getElementById('resetPwMask').hidden = true; });
    bindClose('resetPwOk', function(){ document.getElementById('resetPwMask').hidden = true; });
    bindClose('resetPwCopy', function(){ var t = document.querySelector('#resetPwBody .invite-code-display'); if (t && navigator.clipboard) navigator.clipboard.writeText(t.textContent); });
    bindClose('udClose', function(){ document.getElementById('userDrawerMask').hidden = true; });
    var bDelAcct = document.getElementById('btnDeleteAccount');
    if (bDelAcct) bDelAcct.addEventListener('click', function(){
      document.getElementById('delAcctCode').value = '';
      document.getElementById('delAcctErr').hidden = true;
      document.getElementById('delAcctMask').hidden = false;
    });
    bindClose('delAcctClose', function(){ document.getElementById('delAcctMask').hidden = true; });
    bindClose('delAcctCancel', function(){ document.getElementById('delAcctMask').hidden = true; });
    bindClose('delAcctSend', _sendDelAcctCode);
    bindClose('delAcctOk', _doDeleteAccount);
    var dm = document.getElementById('userDrawerMask');
    if (dm) dm.addEventListener('click', function(e){ if (e.target === dm) dm.hidden = true; });
  }

  function bindEvents() {
    var btnUser = document.getElementById('btnUser');
    if (btnUser) {
      btnUser.addEventListener('click', function(){
        if (isLoggedIn()) openProfile();
        else openAuth('login');
      });
    }
    var authClose = document.getElementById('authClose');
    if (authClose) authClose.addEventListener('click', closeAuth);
    var tabLogin = document.getElementById('authTabLogin');
    var tabReg = document.getElementById('authTabRegister');
    if (tabLogin) tabLogin.addEventListener('click', function(){ switchAuthTab('login'); });
    if (tabReg) tabReg.addEventListener('click', function(){ switchAuthTab('register'); });
    var pwInput = document.getElementById('regPassword');
    if (pwInput) pwInput.addEventListener('input', updatePwStrength);
    var authForm = document.getElementById('authForm');
    if (authForm) {
      authForm.addEventListener('submit', async function(e){
        e.preventDefault();
        hideAuthError();
        var isRegister = document.getElementById('authTabRegister').classList.contains('active');
        var remember = document.getElementById('loginRemember').checked;
        var submitBtn = document.getElementById('authSubmit');
        submitBtn.disabled = true;
        var oldBtnText = submitBtn.textContent;
        submitBtn.textContent = '请稍候…';
        try {
          if (isRegister) {
            if (regCurrentStep === 1) {
              // 第一步：验证邮箱并发送验证码
              var email = document.getElementById('regEmail').value.trim();
              if (!email || !EMAIL_RE.test(email)) { showAuthError('请输入有效的邮箱地址'); return; }
              await sendRegCode();
              goRegStep(2);
              showCodeSentToast();
              // 首次发送即进入冷却：直接 arm 重发按钮倒计时（后端成功才占冷却）
              armCodeCooldown(document.getElementById('btnRegResend'), 60, '重新发送验证码');
              return;
            } else if (regCurrentStep === 2) {
              // 第二步：验证验证码格式
              var code = document.getElementById('regCode').value.trim();
              if (!/^\d{6}$/.test(code)) { showAuthError('请输入6位数字验证码'); return; }
              goRegStep(3);
              return;
            } else {
              // 第三步：设置用户名密码，完成注册
              var email3 = document.getElementById('regEmail').value.trim();
              var code3 = document.getElementById('regCode').value.trim();
              var regName = document.getElementById('regUsername').value.trim();
              var inviteCode = document.getElementById('regInviteCode').value.trim().toUpperCase();
              var pw = document.getElementById('regPassword').value;
              var cf = document.getElementById('regConfirmPassword').value;
              if (!regName || regName.length > 20) { showAuthError('请输入用户名（不超过20个字符）'); return; }
              if (!pw || pw.length < 8) { showAuthError('密码至少需要8位'); return; }
              if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) { showAuthError('密码需同时包含字母和数字'); return; }
              if (pw !== cf) { showAuthError('两次输入的密码不一致'); return; }
              await doRegister(email3, code3, regName, pw, inviteCode, remember);
              if (typeof showToast === 'function') showToast('🎉','注册成功，欢迎加入！','已自动登录');
            }
          } else {
            var email2 = document.getElementById('loginEmail').value.trim();
            var pw2 = document.getElementById('loginPassword').value;
            if (!email2 || !EMAIL_RE.test(email2)) { showAuthError('请输入有效的邮箱地址'); return; }
            if (!pw2) { showAuthError('请输入密码'); return; }
            await doLogin(email2, pw2, remember);
            var dn = currentUser ? currentUser.username : '';
            if (typeof showToast === 'function') showToast('✅','欢迎回来，' + dn + '！','正在同步数据…');
          }
          updateHeaderUI();
          disableLoginWall();
          closeAuth();
          setTimeout(function(){ syncFromCloud(); }, 300);
          maybeAutoPromptInstall();
        } catch(err) {
          showAuthError(err.message || '操作失败，请重试');
        } finally {
          submitBtn.disabled = false;
          if (isRegister) {
            var labels = {1: '发送验证码', 2: '下一步', 3: '完成注册'};
            submitBtn.textContent = labels[regCurrentStep] || '注 册';
          } else {
            submitBtn.textContent = '登 录';
          }
        }
      });
    }
    // 注册上一步按钮
    var authBackBtn = document.getElementById('authBack');
    if (authBackBtn) {
      authBackBtn.addEventListener('click', function(){
        if (regCurrentStep > 1) goRegStep(regCurrentStep - 1);
      });
    }
    // 注册重发验证码
    var btnRegResend = document.getElementById('btnRegResend');
    if (btnRegResend) {
      btnRegResend.addEventListener('click', async function(){
        btnRegResend.disabled = true;
        btnRegResend.textContent = '发送中…';
        try {
          await sendRegCode();
          showCodeSentToast();
          armCodeCooldown(btnRegResend, 60, '重新发送验证码');
        } catch(e) {
          showAuthError(e.message || '发送失败，请重试');
          btnRegResend.textContent = '重新发送验证码';
          btnRegResend.disabled = false;
        }
      });
    }
    var profClose = document.getElementById('profileClose');
    if (profClose) profClose.addEventListener('click', closeProfile);
    var btnLogout = document.getElementById('btnLogout');
    if (btnLogout) btnLogout.addEventListener('click', function(){ doLogout(); });
    var btnSync = document.getElementById('btnManualSync');
    if (btnSync) btnSync.addEventListener('click', function(){
      var self = this, orig = this.textContent;
      if (isLoggedIn() && !isSyncing) {
        this.textContent = '同步中…';
        setTimeout(function(){ self.textContent = orig; }, 2500);
      }
      triggerSync();
    });
    var btnSaveProf = document.getElementById('btnSaveProfile');
    if (btnSaveProf) {
      btnSaveProf.addEventListener('click', async function(){
        var newName = document.getElementById('profileUsername').value.trim();
        if (!newName || newName.length > 20) {
          if (typeof showToast === 'function') showToast('⚠️','请输入用户名（不超过20个字符）'); return;
        }
        try {
          var data = await apiRequest('/api/user/profile', { method: 'PUT', body: { username: newName } });
          currentUser = data.user;
          setStoredUser(data.user);
          updateHeaderUI();
          btnSaveProf.dataset.origName = newName;
          btnSaveProf.disabled = true;
          if (typeof showToast === 'function') showToast('✅','用户名已更新');
        } catch(e) {
          if (typeof showToast === 'function') showToast('❌', e.message || '修改失败');
        }
      });
    }
    // 更换邮箱：向新邮箱发送验证码
    var btnSendCode = document.getElementById('btnSendEmailCode');
    if (btnSendCode) {
      btnSendCode.addEventListener('click', async function(){
        var newEmail = document.getElementById('profileEmail').value.trim();
        if (!newEmail || !EMAIL_RE.test(newEmail)) {
          if (typeof showToast === 'function') showToast('⚠️','请输入有效的邮箱地址'); return;
        }
        btnSendCode.disabled = true;
        btnSendCode.textContent = '发送中…';
        try {
          await apiRequest('/api/user/change-email/request', { method: 'POST', body: { newEmail: newEmail } });
          showCodeSentToast();
          armCodeCooldown(btnSendCode, 60, '发送验证码到新邮箱');
        } catch(e) {
          btnSendCode.textContent = '发送验证码到新邮箱';
          btnSendCode.disabled = false;
          if (typeof showToast === 'function') showToast('❌', e.message || '发送失败，请重试');
        }
      });
    }
    // 更换邮箱：校验验证码并绑定
    var btnConfirmEmail = document.getElementById('btnConfirmEmail');
    if (btnConfirmEmail) {
      btnConfirmEmail.addEventListener('click', async function(){
        var newEmail = document.getElementById('profileEmail').value.trim();
        var code = document.getElementById('changeEmailCode').value.trim();
        if (!code) {
          if (typeof showToast === 'function') showToast('⚠️','请输入新邮箱收到的验证码'); return;
        }
        try {
          var data2 = await apiRequest('/api/user/change-email/confirm', { method: 'POST', body: { newEmail: newEmail, code: code } });
          currentUser = data2.user;
          setStoredUser(data2.user);
          updateHeaderUI();
          document.getElementById('profileEmail').value = data2.user.email;
          document.getElementById('changeEmailCode').value = '';
          document.getElementById('changeEmailBox').hidden = true;
          if (typeof showToast === 'function') showToast('✅','邮箱已更换为 ' + data2.user.email);
        } catch(e) {
          if (typeof showToast === 'function') showToast('❌', e.message || '绑定失败');
        }
      });
    }
    var btnChgPw = document.getElementById('btnChangePassword');
    if (btnChgPw) {
      var oldEl = document.getElementById('oldPassword');
      var newEl = document.getElementById('newPassword');
      var confEl = document.getElementById('confirmNewPassword');
      var refreshChgBtn = function(){
        btnChgPw.disabled = !(oldEl.value && newEl.value.length >= 8 && newEl.value === confEl.value);
      };
      [oldEl,newEl,confEl].forEach(function(el){ el.addEventListener('input', refreshChgBtn); });
      refreshChgBtn();
      btnChgPw.addEventListener('click', async function(){
        var oldP = document.getElementById('oldPassword').value;
        var newP = document.getElementById('newPassword').value;
        var confP = document.getElementById('confirmNewPassword').value;
        if (!oldP || !newP) { if (typeof showToast === 'function') showToast('⚠️','请填写完整'); return; }
        if (newP.length < 8) { if (typeof showToast === 'function') showToast('⚠️','新密码至少8位'); return; }
        if (newP !== confP) { if (typeof showToast === 'function') showToast('⚠️','两次新密码不一致'); return; }
        try {
          await apiRequest('/api/user/password', { method: 'PUT', body: { oldPassword: oldP, newPassword: newP } });
          if (typeof showToast === 'function') showToast('✅','密码已修改');
          document.getElementById('oldPassword').value = '';
          document.getElementById('newPassword').value = '';
          document.getElementById('confirmNewPassword').value = '';
          refreshChgBtn();
        } catch(e) {
          if (typeof showToast === 'function') showToast('❌', e.message || '修改失败');
        }
      });
    }
    /* 头像本地压缩：等比缩放到最长边 256px、JPEG q0.85、白底防透明变黑，返回 Blob；失败由调用方回退原图 */
    function compressAvatar(file){
      return new Promise(function(resolve,reject){
        var url=URL.createObjectURL(file), img=new Image();
        img.onload=function(){
          try{
            var S=256,w=img.width,h=img.height,s=Math.min(1,S/Math.max(w,h));
            var nw=Math.max(1,Math.round(w*s)),nh=Math.max(1,Math.round(h*s));
            var cv=document.createElement('canvas');cv.width=nw;cv.height=nh;
            var cx=cv.getContext('2d');cx.fillStyle='#ffffff';cx.fillRect(0,0,nw,nh);
            cx.drawImage(img,0,0,nw,nh);
            URL.revokeObjectURL(url);
            cv.toBlob(function(b){ b?resolve(b):reject(new Error('toBlob null')); },'image/jpeg',0.85);
          }catch(e){URL.revokeObjectURL(url);reject(e);}
        };
        img.onerror=function(){URL.revokeObjectURL(url);reject(new Error('img error'));};
        img.src=url;
      });
    }
    var btnUpload = document.getElementById('btnUploadAvatar');
    var fileInput = document.getElementById('avatarFile');
    if (btnUpload && fileInput) {
      btnUpload.addEventListener('click', function(){ fileInput.click(); });
      fileInput.addEventListener('change', async function(){
        if (!fileInput.files || !fileInput.files[0]) return;
        var file = fileInput.files[0];
        if (file.size > 2 * 1024 * 1024) {
          if (typeof showToast === 'function') showToast('⚠️','图片不能超过2MB');
          fileInput.value='';
          return;
        }
        // 上传前本地压缩：头像从 MB 级降到几十 KB；压缩失败则回退原图
        var upFile = file;
        try { upFile = await compressAvatar(file); } catch(e) { upFile = file; }
        var fd = new FormData();
        fd.append('avatar', upFile, 'avatar.jpg');
        try {
          var data = await apiRequest('/api/user/avatar', { method: 'POST', body: fd });
          currentUser.avatar = data.avatar;
          setStoredUser(currentUser);
          document.getElementById('profileAvatar').innerHTML = '<img src="' + data.avatar + '" alt="头像" onerror="this.outerHTML=\'👤\'">';
          updateHeaderUI();
          if (typeof showToast === 'function') showToast('✅','头像已更新');
        } catch(e) {
          if (typeof showToast === 'function') showToast('❌', e.message || '上传失败');
        }
        fileInput.value = '';
      });
    }
    var syncDot = document.getElementById('syncIndicator');
    if (syncDot) syncDot.addEventListener('click', function(){ triggerSync(); });
    [['authMask', closeAuth], ['profileMask', closeProfile], ['adminMask', closeAdmin], ['forgotMask', closeForgot]].forEach(function(pair){
      var mask = document.getElementById(pair[0]);
      if (mask) mask.addEventListener('click', function(e){ if (e.target === mask) pair[1](); });
    });
    // Forgot password link
    var linkF = document.getElementById('linkForgot');
    if (linkF) linkF.addEventListener('click', openForgot);
    var fClose = document.getElementById('forgotClose');
    if (fClose) fClose.addEventListener('click', closeForgot);
    // 找回密码三步主按钮
    var forgotSubmitBtn = document.getElementById('forgotSubmit');
    if (forgotSubmitBtn) {
      forgotSubmitBtn.addEventListener('click', async function(){
        var errEl = document.getElementById('forgotError');
        errEl.classList.remove('show');
        forgotSubmitBtn.disabled = true;
        forgotSubmitBtn.textContent = '请稍候…';
        try {
          if (fCurrentStep === 1) {
            await sendResetCode();
            goFStep(2);
            showCodeSentToast();
            armCodeCooldown(document.getElementById('btnForgotResend'), 60, '重新发送验证码');
          } else if (fCurrentStep === 2) {
            var code = document.getElementById('forgotCode').value.trim();
            if (!/^\d{6}$/.test(code)) { errEl.textContent = '请输入6位数字验证码'; errEl.classList.add('show'); return; }
            goFStep(3);
          } else {
            var email = document.getElementById('forgotEmail').value.trim();
            var code3 = document.getElementById('forgotCode').value.trim();
            var np = document.getElementById('resetNewPassword').value;
            var cp = document.getElementById('resetConfirmPassword').value;
            if (!np || np.length < 8) { errEl.textContent = '新密码至少8位'; errEl.classList.add('show'); return; }
            if (!/[a-zA-Z]/.test(np) || !/\d/.test(np)) { errEl.textContent = '密码需同时包含字母和数字'; errEl.classList.add('show'); return; }
            if (np !== cp) { errEl.textContent = '两次输入不一致'; errEl.classList.add('show'); return; }
            await apiRequest('/api/auth/reset-password', { method: 'POST', body: { email: email, code: code3, newPassword: np } });
            closeForgot();
            if (typeof showToast === 'function') showToast('✅','密码已重置','请使用新密码登录');
          }
        } catch(err) {
          errEl.textContent = err.message || '操作失败';
          errEl.classList.add('show');
        } finally {
          forgotSubmitBtn.disabled = false;
          var labels = {1: '发送验证码', 2: '下一步', 3: '重置密码'};
          forgotSubmitBtn.textContent = labels[fCurrentStep];
        }
      });
    }
    // 找回密码上一步
    var forgotBackBtn = document.getElementById('forgotBack');
    if (forgotBackBtn) {
      forgotBackBtn.addEventListener('click', function(){
        if (fCurrentStep > 1) goFStep(fCurrentStep - 1);
      });
    }
    // 找回密码重发验证码
    var btnFResend = document.getElementById('btnForgotResend');
    if (btnFResend) {
      btnFResend.addEventListener('click', async function(){
        btnFResend.disabled = true;
        btnFResend.textContent = '发送中…';
        try {
          await sendResetCode();
          showCodeSentToast();
          armCodeCooldown(btnFResend, 60, '重新发送验证码');
        } catch(e) {
          var errEl = document.getElementById('forgotError');
          errEl.textContent = e.message || '发送失败，请重试'; errEl.classList.add('show');
          btnFResend.textContent = '重新发送验证码';
          btnFResend.disabled = false;
        }
      });
    }
    // 新密码强度检测
    var rPw = document.getElementById('resetNewPassword');
    if (rPw) rPw.addEventListener('input', function(){
      var pw = rPw.value;
      var s1=document.getElementById('resetSeg1'),s2=document.getElementById('resetSeg2'),s3=document.getElementById('resetSeg3');
      var txt=document.getElementById('resetPwText');
      if(!s1) return;
      [s1,s2,s3].forEach(function(s){ s.className='pw-strength-seg'; });
      if (!pw) { txt.textContent='密码强度：'; return; }
      var sc = checkPasswordStrength(pw);
      if (sc>=1) s1.classList.add('s1');
      if (sc>=2) { s1.classList.remove('s1'); s1.classList.add('s2'); s2.classList.add('s2'); }
      if (sc>=3) { s1.classList.remove('s2'); s1.classList.add('s3'); s2.classList.remove('s2'); s2.classList.add('s3'); s3.classList.add('s3'); }
      txt.textContent='密码强度：'+['弱','中','强'][Math.min(sc,2)];
    });
    var bAdm = document.getElementById('btnAdmin');
    if (bAdm) bAdm.addEventListener('click', openAdmin);
    var aClose = document.getElementById('adminClose');
    if (aClose) aClose.addEventListener('click', closeAdmin);
    var aRefresh = document.getElementById('btnAdminRefresh');
    if (aRefresh) aRefresh.addEventListener('click', function(){
      var cur = currentAdminTabName();
      if (cur==='overview') loadAdminStats();
      else if (cur==='users') loadAdminUsers();
      else if (cur==='system') loadAdminSystem();
      else if (cur==='invites') loadInviteList();
      else if (cur==='audit') loadAuditLogs();
      if (typeof showToast==='function') showToast('✅','已刷新');
    });
    bindAdminEvents();
    var bGen = document.getElementById('btnGenInvite');
    if (bGen) bGen.addEventListener('click', async function(){
      var cnt = parseInt(document.getElementById('inviteCount').value)||1;
      var daysRaw = document.getElementById('inviteExpireDays').value.trim();
      var body = { count: cnt };
      if (daysRaw) body.expiresInDays = parseInt(daysRaw);
      try {
        var d = await apiRequest('/api/admin/invite/generate',{method:'POST',body:body});
        var codes = d.codes || [];
        if (codes.length) {
          document.getElementById('newInviteDisplay').hidden = false;
          var cel = document.getElementById('newInviteCode');
          cel.textContent = codes.join('  ·  ');
          cel.onclick = function(){ if(navigator.clipboard) navigator.clipboard.writeText(codes.join(',')); if(typeof showToast==='function') showToast('✅','邀请码已复制'); };
        }
        loadInviteList(); loadAdminStats();
      } catch(e) { if(typeof showToast==='function') showToast('❌',e.message||'生成失败'); }
    });
  }

  return {
    isLoggedIn: isLoggedIn,
    getUsername: getUsername,
    getUser: getUser,
    _setStatus: _setStatus,
    _toggleAdmin: _toggleAdmin,
    _softDelete: _softDelete,
    _permanentUser: _permanentUser,
    _restoreUser: _restoreUser,
    _resetPw: _resetPw,
    _openBan: _openBan,
    _userDetail: _userDetail,
    _chartDrill: _chartDrill,
    _exportCsv: _exportCsv,
    _deleteCode: _deleteCode,
    _batchDeleteInvites: _batchDeleteInvites,
    _copyCode: _copyCode,
    scheduleCloudSync: scheduleCloudSync,
    triggerSync: triggerSync,
    syncFromCloud: function(opts){ return syncFromCloud(opts); },
    tryPromptInstallOnce: tryPromptInstallOnce,
    initAuth: initAuth,
    bindEvents: bindEvents,
    closeAuth: closeAuth,
    closeProfile: closeProfile
  };
})();
