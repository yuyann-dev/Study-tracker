/* ============ 工具 ============ */
const $ = s => document.querySelector(s);
const pad2 = n => String(n).padStart(2, '0');
const fmtDate = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayStr = () => fmtDate(new Date());
const parseDate = s => { if (!s) return new Date(); const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const diffDays = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000);
const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return fmtDate(d); };
const fmtCN = s => { if (!s) return '未设置'; const d = parseDate(s); return `${d.getMonth() + 1}月${d.getDate()}日`; };
const WEEK = ['周日','周一','周二','周三','周四','周五','周六'];
const esc = s => String(s == null ? '' : s).replace(/[&<>"'\\]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','\\':'&#92;' }[c]));

/* ============ 主题管理 ============ */
const THEME_KEY = 'study_tracker_theme';
function getThemePref() {
  return getLocalVal(THEME_KEY, 'auto');
}
function resolveTheme(pref) {
  if (pref === 'light' || pref === 'dark') return pref;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function applyTheme() {
  const pref = getThemePref();
  const resolved = resolveTheme(pref);
  document.documentElement.setAttribute('data-theme', resolved);
  // theme-color 随主题切换：深色用深色背景色，浅色用品牌紫，避免浏览器状态栏与页面割裂
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#273859' : '#2e6b4f');
  const radio = document.querySelector(`input[name="theme"][value="${pref}"]`);
  if (radio) radio.checked = true;
}
function setThemePref(pref) {
  setLocalVal(THEME_KEY, pref);
  applyTheme();
}

const TYPES = {
  exercise: { name:'刷题', icon:'✏️', badgeCls:'', typeCls:'type-exercise' },
  recite:   { name:'背书', icon:'📖', badgeCls:'recite', typeCls:'type-recite' },
  mistake:  { name:'错题', icon:'📝', badgeCls:'mistake', typeCls:'type-mistake' }
};

const DEFAULT_INTERVALS = [1, 2, 4, 7, 15, 30];
const ERROR_REASONS = [
  '概念不清 / 定义混淆',
  '公式记错',
  '计算失误',
  '审题不清 / 漏看条件',
  '思路卡壳 / 没思路',
  '知识点遗忘',
  '粗心 / 笔误',
  '其他'
];
const REASON_COLORS = [
  ['#f8e5de', '#b02e24'], ['#fbf0da', '#96600c'], ['#e9ebdb', '#2e6b4f'],
  ['#e4ecd5', '#096f4e'], ['#f5e3dd', '#b04a5a'], ['#e4efe9', '#2a7a5c'],
  ['#f0e4d2', '#a06838'], ['#e9f6ef', '#15803d'], ['#fff3e0', '#b45309'],
  ['#e0f2f1', '#0f766e'], ['#fce8e6', '#b3261e'], ['#e9ebdb', '#2e6b4f'],
  ['#ffe9d6', '#c2410c'], ['#dcfce7', '#166534'], ['#f3e2d5', '#b0503a'],
  ['#e0ede6', '#1f6b4f'], ['#fef9c3', '#854d0e'], ['#e0efe8', '#0f766e'],
  ['#fce7f3', '#be185d'], ['#ecfccb', '#4d7c0f'],
  ['#ffedd5', '#9a3412'], ['#f3e7d8', '#b07a4b'], ['#ece5d6', '#5a4e3a']
];
function reasonColor(name) {
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return REASON_COLORS[h % REASON_COLORS.length];
}
function deleteReasonByName(p, name) {
  const usedItems = (p.items || []).filter(it => (it.errTags || []).includes(name));
  if (usedItems.length) {
    if (!confirm(`「${name}」已被 ${usedItems.length} 道错题使用，删除后这些错题将不再带这个错因。\n\n确定删除吗？`)) return false;
    usedItems.forEach(it => { it.errTags = it.errTags.filter(t => t !== name); });
  } else {
    if (!confirm(`删除错因「${name}」？`)) return false;
  }
  if (ERROR_REASONS.includes(name)) {
    if (!p.hiddenReasons.includes(name)) p.hiddenReasons.push(name);
  } else {
    p.customErrorReasons = (p.customErrorReasons || []).filter(r => r.name !== name);
  }
  p.reasonOrder = (p.reasonOrder || []).filter(n => n !== name);
  p.updatedAt = Date.now();
  saveStore();
  return true;
}
function reasonPill(name) {
  if (!name) return '';
  const [bg, fg] = reasonColor(name);
  // 深色模式下浅底白亮刺眼：把浅底降到 ~18% 透明度，文字色保持（深色卡上呈淡色晕）
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const bgCss = dark ? bg + '2e' : bg;
  return `<span class="reason-pill" style="background:${bgCss};color:${fg}">${esc(name)}</span>`;
}
function reasonOptionList(p) {
  if (!p || typeof p !== 'object') return [];
  if (Array.isArray(p.customErrorReasons)) {
    p.customErrorReasons = p.customErrorReasons.map(r =>
      (typeof r === 'string') ? { name: r, permanent: true } : r);
  } else p.customErrorReasons = [];
  const used = new Set((p.items || []).flatMap(it => it.errTags || []));
  if (!Array.isArray(p.hiddenReasons)) p.hiddenReasons = [];
  const hidden = new Set(p.hiddenReasons);
  const all = [...ERROR_REASONS.map(n => ({ name: n, permanent: true })),
               ...p.customErrorReasons.filter(r => r.permanent || used.has(r.name))]
    .filter(r => !hidden.has(r.name));
  if (!Array.isArray(p.reasonOrder)) p.reasonOrder = [];
  return all.sort((a, b) => {
    const ia = p.reasonOrder.indexOf(a.name), ib = p.reasonOrder.indexOf(b.name);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return 0;
  });
}
function renderReasonDropdown(p) {
  let dragFrom = null;
  const hidden = $('#reciteErrTagSel');
  const btn = $('#reasonDDBtn');
  const list = $('#reasonDDList');
  if (!hidden || !btn || !list) return;
  if (!p || typeof p !== 'object') {
    btn.innerHTML = '<span class="muted">不设置（可多选）</span>';
    list.innerHTML = '<div class="reason-dd-hint">暂无错因</div>';
    return;
  }
  const opts = reasonOptionList(p);
  const cur = (hidden.value || '').split(',').filter(Boolean);
  btn.innerHTML = cur.length
    ? cur.map(r => reasonPill(r)).join('')
    : '<span class="muted">不设置（可多选）</span>';
  list.innerHTML = opts.map(r => {
    const [bg, fg] = reasonColor(r.name);
    const on = cur.includes(r.name);
    const del = `<span class="reason-del" data-del="${esc(r.name)}" title="删除该错因">×</span>`;
    return `<div class="reason-dd-row${on ? ' sel' : ''}" data-name="${esc(r.name)}" draggable="${r.permanent}">
      <span class="reason-dd-check">${on ? '✓' : ''}</span>
      <span class="reason-dd-dot" style="background:${bg}"></span>
      <span class="reason-dd-name">${esc(r.name)}</span>
      ${del}
      <span class="reason-dd-handle">⠿</span></div>`;
  }).join('') || '<div class="reason-dd-hint">暂无错因</div>';
  list.onclick = e => {
    const del = e.target.closest('[data-del]');
    if (del) {
      const name = del.dataset.del;
      if (deleteReasonByName(p, name)) {
        hidden.value = cur.filter(x => x !== name).join(',');
        renderReasonDropdown(p);
      }
      return;
    }
    const row = e.target.closest('.reason-dd-row');
    if (!row) return;
    const name = row.dataset.name;
    const idx = cur.indexOf(name);
    if (idx >= 0) cur.splice(idx, 1); else cur.push(name);
    hidden.value = cur.join(',');
    renderReasonDropdown(p);
  };
  list.ondragstart = e => {
    const row = e.target.closest('.reason-dd-row');
    if (!row || row.getAttribute('draggable') !== 'true') { e.preventDefault(); return; }
    dragFrom = row.dataset.name; row.style.opacity = '.4';
  };
  list.ondragend = e => { const row = e.target.closest('.reason-dd-row'); if (row) row.style.opacity=''; dragFrom=null; };
  list.ondragover = e => e.preventDefault();
  list.ondrop = e => {
    e.preventDefault();
    const row = e.target.closest('.reason-dd-row');
    if (!row || !dragFrom || row.dataset.name === dragFrom) return;
    const names = [...list.querySelectorAll('.reason-dd-row')].map(c => c.dataset.name);
    const fi = names.indexOf(dragFrom), ti = names.indexOf(row.dataset.name);
    names.splice(fi, 1); names.splice(ti, 0, dragFrom);
    p.reasonOrder = names;
    saveStore();
    renderReasonDropdown(p);
  };
}
function openReasonDropdown() {
  const panel = $('#reasonDDPanel');
  panel.hidden = !panel.hidden;
}
// 记录当前打开 popover 所属的 itemId，用于"新增错因"直接挂到条目上
let pendingNewReason = null;
let pendingNewReasonItemId = null;

function openReasonPopover(anchor, itemId) {
  const p = cur(); if (!p) return;
  const item = (p.items || []).find(it => it.id === itemId);
  if (!item) return;
  if (!Array.isArray(item.errTags)) item.errTags = [];
  const opts = reasonOptionList(p);
  const pop = $('#reasonPopover');
  pop.innerHTML = '<div class="muted" style="font-size:11.5px;padding:4px 6px 6px">勾选错因（累加不覆盖）· 拖 ⠿ 排序 · × 删除</div>'
    + opts.map(r => {
      const on = item.errTags.includes(r.name);
      const [bg] = reasonColor(r.name);
      const del = `<span class="reason-del" data-del="${esc(r.name)}" title="删除">×</span>`;
      return `<div class="rp-row${on ? ' sel' : ''}" data-name="${esc(r.name)}" draggable="${r.permanent}">
        <span class="reason-dd-handle">⠿</span>
        <span class="rp-check">${on ? '✓' : ''}</span>
        <span class="reason-dd-dot" style="background:${bg}"></span>
        <span class="rp-name">${esc(r.name)}</span>
        ${del}</div>`;
    }).join('')
    + '<button class="reason-dd-add" id="rpAdd">＋ 新增错因…</button>';
  pop.hidden = false;
  const r = anchor.getBoundingClientRect();
  pop.style.top = Math.min(r.bottom + 6, window.innerHeight - 320) + 'px';
  pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 250)) + 'px';

  const refresh = () => { openReasonPopover(anchor, itemId); renderReasonDropdown(p); };

  pop.onclick = ev => {
    const del = ev.target.closest('[data-del]');
    if (del) {
      const nm = del.dataset.del;
      if (deleteReasonByName(p, nm)) {
        item.errTags = item.errTags.filter(t => t !== nm);
        refresh();
        const itemEl = document.querySelector(`.review-item[data-id="${itemId}"]`);
        if (itemEl) {
          const b = itemEl.querySelector('[data-reasonpicker]');
          if (b) b.textContent = `🏷 错因${item.errTags.length ? `(${item.errTags.length})` : ''}`;
        }
      }
      return;
    }
    if (ev.target.closest('#rpAdd')) {
      const nm = prompt('输入新的错因标签：');
      if (nm && nm.trim()) {
        const v = nm.trim().slice(0, 20);
        if (ERROR_REASONS.includes(v) || (p.customErrorReasons||[]).some(x => x.name === v)) {
          alert('这个错因已经存在啦～'); return;
        }
        pendingNewReason = v;
        pendingNewReasonItemId = itemId;
        $('#reasonKindMask').hidden = false;
        modalTop($('#reasonKindMask'));
      }
      return;
    }
    const row = ev.target.closest('.rp-row'); if (!row) return;
    const name = row.dataset.name;
    const i = item.errTags.indexOf(name);
    if (i >= 0) item.errTags.splice(i, 1); else item.errTags.push(name);
    p.updatedAt = Date.now(); saveStore();
    openReasonPopover(anchor, itemId);
    renderReasonDropdown(p);
    const itemEl = document.querySelector(`.review-item[data-id="${itemId}"]`);
    if (itemEl) {
      const b = itemEl.querySelector('[data-reasonpicker]');
      if (b) b.textContent = `🏷 错因${item.errTags.length ? `(${item.errTags.length})` : ''}`;
    }
  };
  let dragFrom = null;
  pop.ondragstart = ev => {
    const row = ev.target.closest('.rp-row');
    if (!row || row.getAttribute('draggable') !== 'true') { ev.preventDefault(); return; }
    dragFrom = row.dataset.name; row.style.opacity = '.4';
  };
  pop.ondragend = ev => { const row = ev.target.closest('.rp-row'); if (row) row.style.opacity=''; dragFrom=null; };
  pop.ondragover = ev => ev.preventDefault();
  pop.ondrop = ev => {
    ev.preventDefault();
    const row = ev.target.closest('.rp-row');
    if (!row || !dragFrom || row.dataset.name === dragFrom) return;
    const names = [...pop.querySelectorAll('.rp-row')].map(c => c.dataset.name);
    const fi = names.indexOf(dragFrom), ti = names.indexOf(row.dataset.name);
    names.splice(fi, 1); names.splice(ti, 0, dragFrom);
    p.reasonOrder = names;
    p.updatedAt = Date.now(); saveStore();
    refresh();
  };
}
document.addEventListener('click', e => {
  const panel = $('#reasonDDPanel');
  if (panel && !panel.hidden && !e.target.closest('#reasonDD')) panel.hidden = true;
  const pop = $('#reasonPopover');
  if (pop && !pop.hidden && !e.target.closest('#reasonPopover') && !e.target.closest('[data-reasonpicker]')) pop.hidden = true;
  const scopePanel = $('#inSetScopePanel');
  if (scopePanel && !scopePanel.hidden && !e.target.closest('#inSetScopeMulti')) scopePanel.hidden = true;
});

/* ============ 存储 ============ */
const STORE_KEY = 'study_tracker_v2';
let store = { currentId: null, projects: {}, unitTemplates: [], paperTemplates: [], tombstones: {} };
let lastMetrics = null;
let creatingLinkedFrom = null; // 从刷题本创建关联错题本时，存储刷题本ID

function migrateProject(p) {
  if (!p) return;
  if (p.type === 'exercise') {
    if (p.unit == null) p.unit = 'page';
    if (p.unit === 'set') {
      if (!Array.isArray(p.paperSections)) p.paperSections = [];
      if (!p.paperLabelMode) p.paperLabelMode = 'index';
    }
  }
  // 错题本模式迁移：老用户默认 free（自由出处），新增 page/set 模式
  if (p.type === 'mistake' && p.mistakeMode == null) {
    p.mistakeMode = 'free';
  }
  // 错题本关联刷题本：老用户默认 null
  if (p.type === 'mistake' && p.refProjectId === undefined) {
    p.refProjectId = null;
  }
  if (p.type === 'mistake' && p.mistakeMode === 'page') {
    if (p.unitMode == null) p.unitMode = false;
    if (!Array.isArray(p.units)) p.units = [];
  }
  // 老数据迁移：旧版刷题/背书直接存 p.total（总页码），新版改用正文起止页自动计算
  // 若有 p.total 但未设置结束页，把总页数迁移到 bookEndPage（起始页默认第1页，不单独存）
  if ((p.type === 'exercise' || p.type === 'recite') && p.unit !== 'set'
      && p.total > 0 && p.bookEndPage == null && p.bookStartPage == null) {
    p.bookEndPage = p.total;
  }
  if (Array.isArray(p.items)) {
    p.items.forEach(it => {
      if (it.note === undefined && Array.isArray(it.reviews) && it.reviews.length) {
        const last = it.reviews[it.reviews.length - 1];
        it.note = (last && last.note) ? last.note : '';
      }
      if (!Array.isArray(it.errTags)) {
        it.errTags = it.errTag ? [it.errTag] : [];
        delete it.errTag;
      }
      // 老数据兜底：已攻克但没有 masteredDate 的，用 learnedDate 补齐
      if ((it.mastered || it.manualMastered) && !it.masteredDate) {
        it.masteredDate = it.learnedDate || '';
      }
      // 保持期复习迁移：已掌握（非手动熟知）但没有 retentionDate 的老数据，补设保持复习
      if (it.retentionDate === undefined) {
        if (p.type !== 'exercise' && it.mastered && !it.manualMastered && it.masteredDate) {
          it.retentionPass = 0;
          const firstRetention = addDays(it.masteredDate, 30);
          // 已超过首次保持复习日的从今天起补排；无论哪种，都走统一错峰，避免批量老数据同一天扎堆
          const target = firstRetention < todayStr() ? todayStr() : firstRetention;
          it.retentionDate = staggerRetentionDate(p, target, it.id);
        } else {
          it.retentionDate = null;
          it.retentionPass = 0;
        }
      }
      if (it.retentionReviews === undefined) it.retentionReviews = [];
    });
  }
  // 舒适量默认值按项目类型区分（背书6/错题10），已手动设置的保留
  if (p.spreadThreshold == null) p.spreadThreshold = defaultComfortCap(p);
}

/* ============ 预设单元模板 ============ */
function buildPresetUnits(chapters) {
  // chapters: [{name, startPage, endPage?, sections:[{name, startPage, endPage?}]}]
  // 校验：子级（节）页码必须在父级（章）范围内；结束页>=起始页
  return chapters.map((ch, ci) => {
    const chEnd = ch.endPage !== undefined ? ch.endPage :
      ((ci < chapters.length - 1) ? chapters[ci + 1].startPage - 1 : ch.startPage + 80);
    const children = (ch.sections || []).map((sec, si) => {
      let secEnd;
      if (sec.endPage !== undefined) {
        secEnd = sec.endPage;
      } else {
        const nextStart = (si < ch.sections.length - 1) ? ch.sections[si + 1].startPage : (chEnd + 1);
        secEnd = Math.max(sec.startPage, Math.min(nextStart - 1, chEnd));
      }
      // 校验：结束页>=起始页，且在章范围内
      secEnd = Math.max(sec.startPage, Math.min(secEnd, chEnd));
      const secStart = Math.max(sec.startPage, ch.startPage);
      return { name: sec.name, startPage: secStart, endPage: secEnd, children: [] };
    });
    return { name: ch.name, startPage: ch.startPage, endPage: chEnd, children };
  });
}
function getPresetUnitTemplates() {
  const now = Date.now();
  const templates = [];

  // 1. 王道27计算机网络
  templates.push({
    id: 'preset_wangdao_network',
    name: '王道27计算机网络',
    preset: true,
    createdAt: now, updatedAt: now,
    units: buildPresetUnits([
      { name: '第1章 计算机网络体系结构', startPage: 1, endPage: 29, sections: [
        { name: '1.1 计算机网络概述', startPage: 1, endPage: 8 },
        { name: '1.2 计算机网络体系结构与参考模型', startPage: 15, endPage: 21 },
        { name: '1.3 本章小结及疑难点', startPage: 28, endPage: 29 },
      ]},
      { name: '第2章 物理层', startPage: 30, endPage: 49, sections: [
        { name: '2.1 通信基础', startPage: 30, endPage: 34 },
        { name: '2.2 传输介质', startPage: 42, endPage: 43 },
        { name: '2.3 物理层设备', startPage: 46, endPage: 46 },
        { name: '2.4 本章小结及疑难点', startPage: 48, endPage: 49 },
      ]},
      { name: '第3章 数据链路层', startPage: 50, endPage: 126, sections: [
        { name: '3.1 数据链路层的功能', startPage: 50, endPage: 51 },
        { name: '3.2 组帧', startPage: 54, endPage: 54 },
        { name: '3.3 差错控制', startPage: 56, endPage: 58 },
        { name: '3.4 流量控制与可靠传输机制', startPage: 61, endPage: 62 },
        { name: '3.5 介质访问控制', startPage: 77, endPage: 82 },
        { name: '3.6 局域网', startPage: 87, endPage: 99 },
        { name: '3.7 广域网', startPage: 106, endPage: 114 },
        { name: '3.8 数据链路层设备', startPage: 117, endPage: 119 },
        { name: '3.9 本章小结及疑难点', startPage: 126, endPage: 126 },
      ]},
      { name: '第4章 网络层', startPage: 127, endPage: 223, sections: [
        { name: '4.1 网络层的功能', startPage: 127, endPage: 131 },
        { name: '4.2 IPv4', startPage: 137, endPage: 150 },
        { name: '4.3 IPv6', startPage: 181, endPage: 183 },
        { name: '4.4 路由算法与路由协议', startPage: 186, endPage: 195 },
        { name: '4.5 IP多播', startPage: 208, endPage: 209 },
        { name: '4.6 移动IP', startPage: 212, endPage: 212 },
        { name: '4.7 网络层设备', startPage: 214, endPage: 215 },
        { name: '4.8 本章小结及疑难点', startPage: 223, endPage: 223 },
      ]},
      { name: '第5章 传输层', startPage: 224, endPage: 265, sections: [
        { name: '5.1 传输层提供的服务', startPage: 224, endPage: 226 },
        { name: '5.2 UDP', startPage: 229, endPage: 230 },
        { name: '5.3 TCP', startPage: 236, endPage: 245 },
        { name: '5.4 本章小结及疑难点', startPage: 265, endPage: 265 },
      ]},
      { name: '第6章 应用层', startPage: 267, endPage: 303, sections: [
        { name: '6.1 网络应用模型', startPage: 267, endPage: 267 },
        { name: '6.2 域名系统', startPage: 270, endPage: 272 },
        { name: '6.3 文件传输协议', startPage: 277, endPage: 277 },
        { name: '6.4 电子邮件', startPage: 283, endPage: 285 },
        { name: '6.5 万维网', startPage: 289, endPage: 294 },
        { name: '6.6 本章小结及疑难点', startPage: 303, endPage: 303 },
      ]},
    ])
  });

  // 2. 王道27计算机组成原理
  templates.push({
    id: 'preset_wangdao_co',
    name: '王道27计算机组成原理',
    preset: true,
    createdAt: now, updatedAt: now,
    units: buildPresetUnits([
      { name: '第1章 计算机系统概述', startPage: 1, endPage: 19, sections: [
        { name: '1.1 计算机发展历程', startPage: 1, endPage: 1 },
        { name: '1.2 计算机系统层次结构', startPage: 2, endPage: 6 },
        { name: '1.3 计算机的性能指标', startPage: 11, endPage: 12 },
        { name: '1.4 本章小结', startPage: 18, endPage: 18 },
        { name: '1.5 常见问题和易混淆知识点', startPage: 18, endPage: 19 },
      ]},
      { name: '第2章 数据的表示和运算', startPage: 20, endPage: 76, sections: [
        { name: '2.1 数制与编码', startPage: 20, endPage: 26 },
        { name: '2.2 运算方法和运算电路', startPage: 32, endPage: 43 },
        { name: '2.3 浮点数的表示与运算', startPage: 53, endPage: 60 },
        { name: '2.4 本章小结', startPage: 75, endPage: 75 },
        { name: '2.5 常见问题和易混淆知识点', startPage: 75, endPage: 76 },
      ]},
      { name: '第3章 存储系统', startPage: 77, endPage: 147, sections: [
        { name: '3.1 存储器概述', startPage: 77, endPage: 79 },
        { name: '3.2 主存储器', startPage: 82, endPage: 86 },
        { name: '3.3 主存储器与CPU的连接', startPage: 97, endPage: 98 },
        { name: '3.4 外部存储器', startPage: 102, endPage: 103 },
        { name: '3.5 高速缓冲存储器', startPage: 109, endPage: 115 },
        { name: '3.6 虚拟存储器', startPage: 130, endPage: 134 },
        { name: '3.7 本章小结', startPage: 146, endPage: 146 },
        { name: '3.8 常见问题和易混淆知识点', startPage: 147, endPage: 147 },
      ]},
      { name: '第4章 指令系统', startPage: 148, endPage: 194, sections: [
        { name: '4.1 指令系统', startPage: 148, endPage: 150 },
        { name: '4.2 寻址方式', startPage: 156, endPage: 159 },
        { name: '4.3 程序的机器级代码表示', startPage: 171, endPage: 178 },
        { name: '4.4 CISC和RISC的基本概念', startPage: 190, endPage: 191 },
        { name: '4.5 本章小结', startPage: 193, endPage: 193 },
        { name: '4.6 常见问题和易混淆知识点', startPage: 194, endPage: 194 },
      ]},
      { name: '第5章 中央处理器', startPage: 195, endPage: 273, sections: [
        { name: '5.1 CPU的功能和基本结构', startPage: 195, endPage: 196 },
        { name: '5.2 指令执行过程', startPage: 201, endPage: 203 },
        { name: '5.3 数据通路的功能和基本结构', startPage: 206, endPage: 209 },
        { name: '5.4 控制器的功能和工作原理', startPage: 221, endPage: 233 },
        { name: '5.5 异常和中断机制', startPage: 242, endPage: 242 },
        { name: '5.6 指令流水线', startPage: 247, endPage: 254 },
        { name: '5.7 多处理器的基本概念', startPage: 267, endPage: 269 },
        { name: '5.8 本章小结', startPage: 272, endPage: 272 },
        { name: '5.9 常见问题和易混淆知识点', startPage: 273, endPage: 273 },
      ]},
      { name: '第6章 总线', startPage: 274, endPage: 290, sections: [
        { name: '6.1 总线概述', startPage: 274, endPage: 277 },
        { name: '6.2 总线事务和定时', startPage: 283, endPage: 285 },
        { name: '6.3 本章小结', startPage: 290, endPage: 290 },
        { name: '6.4 常见问题和易混淆知识点', startPage: 290, endPage: 290 },
      ]},
      { name: '第7章 输入/输出系统', startPage: 291, endPage: 326, sections: [
        { name: '7.1 I/O系统基本概念', startPage: 291, endPage: 292 },
        { name: '7.2 I/O接口', startPage: 293, endPage: 294 },
        { name: '7.3 I/O方式', startPage: 299, endPage: 308 },
        { name: '7.4 本章小结', startPage: 326, endPage: 326 },
        { name: '7.5 常见问题和易混淆知识点', startPage: 326, endPage: 326 },
      ]},
    ])
  });

  // 3. 王道27数据结构
  templates.push({
    id: 'preset_wangdao_ds',
    name: '王道27数据结构',
    preset: true,
    createdAt: now, updatedAt: now,
    units: buildPresetUnits([
      { name: '第1章 绪论', startPage: 1, endPage: 12, sections: [
        { name: '1.1 数据结构的基本概念', startPage: 1, endPage: 2 },
        { name: '1.2 算法和算法评价', startPage: 4, endPage: 5 },
        { name: '归纳总结', startPage: 11, endPage: 11 },
        { name: '思维拓展', startPage: 12, endPage: 12 },
      ]},
      { name: '第2章 线性表', startPage: 13, endPage: 62, sections: [
        { name: '2.1 线性表的定义和基本操作', startPage: 13, endPage: 13 },
        { name: '2.2 线性表的顺序表示', startPage: 15, endPage: 17 },
        { name: '2.3 线性表的链式表示', startPage: 30, endPage: 38 },
        { name: '归纳总结', startPage: 62, endPage: 62 },
        { name: '思维拓展', startPage: 62, endPage: 62 },
      ]},
      { name: '第3章 栈、队列和数组', startPage: 63, endPage: 108, sections: [
        { name: '3.1 栈', startPage: 63, endPage: 66 },
        { name: '3.2 队列', startPage: 76, endPage: 81 },
        { name: '3.3 栈和队列的应用', startPage: 90, endPage: 93 },
        { name: '3.4 数组和特殊矩阵', startPage: 100, endPage: 103 },
        { name: '归纳总结', startPage: 108, endPage: 108 },
        { name: '思维拓展', startPage: 108, endPage: 108 },
      ]},
      { name: '第4章 串', startPage: 109, endPage: 123, sections: [
        { name: '4.1 串的定义和实现', startPage: 109, endPage: 110 },
        { name: '4.2 串的模式匹配', startPage: 111, endPage: 116 },
        { name: '归纳总结', startPage: 123, endPage: 123 },
        { name: '思维拓展', startPage: 123, endPage: 123 },
      ]},
      { name: '第5章 树与二叉树', startPage: 124, endPage: 193, sections: [
        { name: '5.1 树的基本概念', startPage: 124, endPage: 125 },
        { name: '5.2 二叉树的概念', startPage: 129, endPage: 132 },
        { name: '5.3 二叉树的遍历和线索二叉树', startPage: 140, endPage: 145 },
        { name: '5.4 树、森林', startPage: 168, endPage: 171 },
        { name: '5.5 树与二叉树的应用', startPage: 180, endPage: 184 },
        { name: '归纳总结', startPage: 192, endPage: 192 },
        { name: '思维拓展', startPage: 193, endPage: 193 },
      ]},
      { name: '第6章 图', startPage: 194, endPage: 263, sections: [
        { name: '6.1 图的基本概念', startPage: 194, endPage: 196 },
        { name: '6.2 图的存储及基本操作', startPage: 201, endPage: 205 },
        { name: '6.3 图的遍历', startPage: 214, endPage: 217 },
        { name: '6.4 图的应用', startPage: 226, endPage: 236 },
        { name: '归纳总结', startPage: 262, endPage: 262 },
        { name: '思维拓展', startPage: 263, endPage: 263 },
      ]},
      { name: '第7章 查找', startPage: 264, endPage: 330, sections: [
        { name: '7.1 查找的基本概念', startPage: 264, endPage: 264 },
        { name: '7.2 顺序查找和折半查找', startPage: 265, endPage: 267 },
        { name: '7.3 树形查找', startPage: 278, endPage: 290 },
        { name: '7.4 B树和B+树', startPage: 304, endPage: 307 },
        { name: '7.5 散列（Hash）表', startPage: 317, endPage: 320 },
        { name: '归纳总结', startPage: 330, endPage: 330 },
        { name: '思维拓展', startPage: 330, endPage: 330 },
      ]},
      { name: '第8章 排序', startPage: 331, endPage: 391, sections: [
        { name: '8.1 排序的基本概念', startPage: 331, endPage: 331 },
        { name: '8.2 插入排序', startPage: 333, endPage: 335 },
        { name: '8.3 交换排序', startPage: 340, endPage: 343 },
        { name: '8.4 选择排序', startPage: 351, endPage: 353 },
        { name: '8.5 归并排序、基数排序和计数排序', startPage: 363, endPage: 366 },
        { name: '8.6 各种内部排序算法的比较及应用', startPage: 373, endPage: 373 },
        { name: '8.7 外部排序', startPage: 380, endPage: 384 },
        { name: '归纳总结', startPage: 390, endPage: 390 },
        { name: '思维拓展', startPage: 391, endPage: 391 },
      ]},
    ])
  });

  // 4. 王道27操作系统
  templates.push({
    id: 'preset_wangdao_os',
    name: '王道27操作系统',
    preset: true,
    createdAt: now, updatedAt: now,
    units: buildPresetUnits([
      { name: '第1章 计算机系统概述', startPage: 1, endPage: 36, sections: [
        { name: '1.1 操作系统的基本概念', startPage: 1, endPage: 4 },
        { name: '1.2 操作系统发展历程', startPage: 7, endPage: 9 },
        { name: '1.3 操作系统的运行环境', startPage: 15, endPage: 18 },
        { name: '1.4 操作系统结构', startPage: 26, endPage: 28 },
        { name: '1.5 操作系统引导', startPage: 29, endPage: 29 },
        { name: '1.6 虚拟机', startPage: 30, endPage: 30 },
        { name: '1.7 本章疑难点', startPage: 35, endPage: 36 },
      ]},
      { name: '第2章 进程与线程', startPage: 37, endPage: 175, sections: [
        { name: '2.1 进程与线程简介', startPage: 37, endPage: 50 },
        { name: '2.2 CPU调度', startPage: 66, endPage: 77 },
        { name: '2.3 同步与互斥', startPage: 99, endPage: 113 },
        { name: '2.4 死锁', startPage: 149, endPage: 157 },
        { name: '2.5 本章疑难点', startPage: 175, endPage: 175 },
      ]},
      { name: '第3章 内存管理', startPage: 176, endPage: 250, sections: [
        { name: '3.1 内存管理概念', startPage: 176, endPage: 190 },
        { name: '3.2 虚拟内存管理', startPage: 212, endPage: 225 },
        { name: '3.3 本章疑难点', startPage: 250, endPage: 250 },
      ]},
      { name: '第4章 文件管理', startPage: 251, endPage: 304, sections: [
        { name: '4.1 文件系统基础', startPage: 251, endPage: 255 },
        { name: '4.2 目录与文件', startPage: 257, endPage: 270 },
        { name: '4.3 文件系统', startPage: 294, endPage: 299 },
        { name: '4.4 本章疑难点', startPage: 304, endPage: 304 },
      ]},
      { name: '第5章 输入/输出管理', startPage: 305, endPage: 359, sections: [
        { name: '5.1 I/O管理概述', startPage: 305, endPage: 313 },
        { name: '5.2 设备独立性软件', startPage: 320, endPage: 328 },
        { name: '5.3 磁盘和固态硬盘', startPage: 340, endPage: 346 },
        { name: '5.4 本章疑难点', startPage: 359, endPage: 359 },
      ]},
    ])
  });

  // 5. 植物生理学背诵手册
  templates.push({
    id: 'preset_plant_physiology',
    name: '植物生理学背诵手册',
    preset: true,
    createdAt: now, updatedAt: now,
    units: buildPresetUnits([
      { name: '第一章 植物生理学概述', startPage: 17, endPage: 18, sections: [
        { name: '一、植物生理学的研究内容', startPage: 17, endPage: 17 },
        { name: '二、植物生理学的发展简史', startPage: 17, endPage: 18 },
      ]},
      { name: '第二章 植物细胞生理', startPage: 19, endPage: 26, sections: [
        { name: '一、植物细胞概述', startPage: 19, endPage: 19 },
        { name: '二、植物细胞的亚显微结构与功能', startPage: 19, endPage: 24 },
        { name: '三、植物细胞信号转导', startPage: 24, endPage: 26 },
      ]},
      { name: '第三章 植物水分生理', startPage: 29, endPage: 38, sections: [
        { name: '一、水分在植物生命活动中的意义', startPage: 29, endPage: 29 },
        { name: '二、植物细胞的水分关系', startPage: 29, endPage: 31 },
        { name: '三、植物根系对水分的吸收', startPage: 32, endPage: 34 },
        { name: '四、植物蒸腾作用', startPage: 34, endPage: 37 },
        { name: '五、植物体内水分运输的途径与机制', startPage: 37, endPage: 37 },
        { name: '六、合理灌溉的生理基础', startPage: 38, endPage: 38 },
      ]},
      { name: '第四章 植物的矿质营养', startPage: 41, endPage: 54, sections: [
        { name: '一、植物体内的必需元素', startPage: 41, endPage: 46 },
        { name: '二、植物对矿质元素的吸收和运输', startPage: 47, endPage: 51 },
        { name: '三、植物对氮、磷、硫的同化', startPage: 52, endPage: 52 },
        { name: '四、合理施肥的生理基础', startPage: 53, endPage: 54 },
      ]},
      { name: '第五章 光合作用', startPage: 58, endPage: 78, sections: [
        { name: '一、光合作用的概念', startPage: 58, endPage: 58 },
        { name: '二、叶绿体和光合色素', startPage: 58, endPage: 59 },
        { name: '三、光合作用的光反应', startPage: 60, endPage: 67 },
        { name: '四、光合碳同化', startPage: 68, endPage: 75 },
        { name: '五、光合作用的影响因素', startPage: 76, endPage: 77 },
        { name: '六、提高植物光能利用率的途径', startPage: 78, endPage: 78 },
      ]},
      { name: '第六章 植物的呼吸作用', startPage: 84, endPage: 90, sections: [
        { name: '一、呼吸作用的概念和生理意义', startPage: 84, endPage: 84 },
        { name: '二、植物呼吸代谢的类型和代谢途径的特点', startPage: 84, endPage: 84 },
        { name: '三、植物呼吸电子传递途径', startPage: 85, endPage: 88 },
        { name: '四、呼吸作用的影响因素', startPage: 88, endPage: 89 },
        { name: '五、呼吸作用的实践应用', startPage: 90, endPage: 90 },
      ]},
      { name: '第七章 植物次生代谢物', startPage: 93, endPage: 96, sections: [
        { name: '一、初生代谢物和次生代谢物', startPage: 93, endPage: 93 },
        { name: '二、酚类化合物及其衍生物', startPage: 94, endPage: 94 },
        { name: '三、萜烯类', startPage: 95, endPage: 95 },
        { name: '四、含氮化合物', startPage: 95, endPage: 96 },
      ]},
      { name: '第八章 韧皮部运输与同化物分配', startPage: 99, endPage: 105, sections: [
        { name: '一、韧皮部的同化物运输', startPage: 99, endPage: 101 },
        { name: '二、韧皮部的运输机制', startPage: 101, endPage: 103 },
        { name: '三、同化物的配置与分配', startPage: 104, endPage: 105 },
      ]},
      { name: '第九章 植物生长物质', startPage: 108, endPage: 124, sections: [
        { name: '一、植物生长物质的概念', startPage: 108, endPage: 108 },
        { name: '二、生长素', startPage: 108, endPage: 111 },
        { name: '三、赤霉素', startPage: 112, endPage: 113 },
        { name: '四、细胞分裂素', startPage: 114, endPage: 116 },
        { name: '五、脱落酸', startPage: 117, endPage: 118 },
        { name: '六、乙烯', startPage: 119, endPage: 120 },
        { name: '七、油菜素内酯', startPage: 121, endPage: 121 },
        { name: '八、其他植物内源生长物质与植物生长调节剂', startPage: 122, endPage: 122 },
        { name: '九、植物激素的相互作用', startPage: 123, endPage: 123 },
        { name: '十、植物激素的测定方法', startPage: 123, endPage: 124 },
      ]},
      { name: '第十章 植物生长生理', startPage: 129, endPage: 139, sections: [
        { name: '一、植物生长和分化的细胞基础', startPage: 129, endPage: 130 },
        { name: '二、植物的生长和分化', startPage: 130, endPage: 133 },
        { name: '三、植物生长的相关性', startPage: 134, endPage: 134 },
        { name: '四、环境因子对植物生长的影响', startPage: 135, endPage: 135 },
        { name: '五、植物光形态建成与光受体', startPage: 136, endPage: 137 },
        { name: '六、植物运动及其机制', startPage: 138, endPage: 139 },
      ]},
      { name: '第十一章 植物生殖生理', startPage: 143, endPage: 152, sections: [
        { name: '一、幼年期与花熟状态', startPage: 143, endPage: 143 },
        { name: '二、光周期对成花的影响', startPage: 143, endPage: 145 },
        { name: '三、春化作用', startPage: 145, endPage: 146 },
        { name: '四、花器官的形成', startPage: 146, endPage: 148 },
        { name: '五、授粉受精生理', startPage: 149, endPage: 152 },
      ]},
      { name: '第十二章 植物的休眠、成熟和衰老生理', startPage: 156, endPage: 165, sections: [
        { name: '一、种子的休眠和萌发', startPage: 156, endPage: 157 },
        { name: '二、芽的休眠和萌发', startPage: 158, endPage: 159 },
        { name: '三、种子的发育和成熟生理', startPage: 159, endPage: 161 },
        { name: '四、果实的生长和成熟生理', startPage: 161, endPage: 162 },
        { name: '五、植物的衰老和脱落生理', startPage: 162, endPage: 165 },
      ]},
      { name: '第十三章 植物逆境生理', startPage: 169, endPage: 177, sections: [
        { name: '一、逆境和抗逆性', startPage: 169, endPage: 171 },
        { name: '二、植物的抗旱性', startPage: 172, endPage: 173 },
        { name: '三、植物的抗寒性', startPage: 174, endPage: 175 },
        { name: '四、植物的抗盐性', startPage: 176, endPage: 177 },
        { name: '五、植物抗逆性的研究方法', startPage: 177, endPage: 177 },
      ]},
    ])
  });

  // 6. 生物化学背诵手册
  templates.push({
    id: 'preset_biochemistry',
    name: '生物化学背诵手册',
    preset: true,
    createdAt: now, updatedAt: now,
    units: buildPresetUnits([
      { name: '第一章 氨基酸', startPage: 17, endPage: 22, sections: [
        { name: '一、氨基酸的结构', startPage: 17, endPage: 17 },
        { name: '二、氨基酸的性质', startPage: 18, endPage: 20 },
        { name: '三、氨基酸的分离分析', startPage: 20, endPage: 22 },
      ]},
      { name: '第二章 蛋白质的结构和功能', startPage: 25, endPage: 35, sections: [
        { name: '一、导论', startPage: 25, endPage: 25 },
        { name: '二、肽', startPage: 25, endPage: 26 },
        { name: '三、蛋白质的一级结构', startPage: 27, endPage: 28 },
        { name: '四、蛋白质的二级结构', startPage: 29, endPage: 30 },
        { name: '五、蛋白质的三级结构', startPage: 31, endPage: 33 },
        { name: '六、蛋白质的四级结构', startPage: 33, endPage: 35 },
      ]},
      { name: '第三章 蛋白质的分离和鉴定', startPage: 38, endPage: 47, sections: [
        { name: '一、蛋白质的性质', startPage: 38, endPage: 38 },
        { name: '二、蛋白质的分离和纯化', startPage: 39, endPage: 44 },
        { name: '三、蛋白质的鉴定', startPage: 44, endPage: 47 },
      ]},
      { name: '第四章 酶', startPage: 50, endPage: 61, sections: [
        { name: '一、导论', startPage: 50, endPage: 51 },
        { name: '二、酶活力的测定', startPage: 51, endPage: 52 },
        { name: '三、酶促反应动力学', startPage: 53, endPage: 56 },
        { name: '四、酶催化机理', startPage: 56, endPage: 58 },
        { name: '五、酶活性调节', startPage: 59, endPage: 61 },
      ]},
      { name: '第五章 维生素和辅酶', startPage: 64, endPage: 65, sections: [
        { name: '一、水溶性维生素', startPage: 64, endPage: 64 },
        { name: '二、脂溶性维生素', startPage: 65, endPage: 65 },
      ]},
      { name: '第六章 核酸', startPage: 68, endPage: 80, sections: [
        { name: '一、核苷酸', startPage: 68, endPage: 68 },
        { name: '二、DNA的结构', startPage: 69, endPage: 72 },
        { name: '三、RNA的结构', startPage: 72, endPage: 74 },
        { name: '四、核酸的性质', startPage: 74, endPage: 75 },
        { name: '五、核酸的分离和鉴定', startPage: 76, endPage: 79 },
        { name: '六、DNA序列的测定', startPage: 79, endPage: 80 },
      ]},
      { name: '第七章 生物氧化', startPage: 83, endPage: 90, sections: [
        { name: '一、概述', startPage: 83, endPage: 83 },
        { name: '二、生物能学原理', startPage: 83, endPage: 84 },
        { name: '三、线粒体电子传递链（呼吸链）', startPage: 85, endPage: 87 },
        { name: '四、氧化磷酸化', startPage: 88, endPage: 90 },
      ]},
      { name: '第八章 糖代谢', startPage: 93, endPage: 107, sections: [
        { name: '一、糖酵解', startPage: 93, endPage: 95 },
        { name: '二、柠檬酸循环', startPage: 95, endPage: 99 },
        { name: '三、磷酸戊糖途径', startPage: 99, endPage: 101 },
        { name: '四、糖异生', startPage: 101, endPage: 103 },
        { name: '五、双糖和多糖的酶促降解', startPage: 103, endPage: 107 },
      ]},
      { name: '第九章 脂质代谢', startPage: 111, endPage: 122, sections: [
        { name: '一、脂的消化、吸收和转运', startPage: 111, endPage: 111 },
        { name: '二、三酰甘油的降解', startPage: 112, endPage: 115 },
        { name: '三、三酰甘油的合成', startPage: 116, endPage: 121 },
        { name: '四、胆固醇代谢', startPage: 121, endPage: 122 },
      ]},
      { name: '第十章 氨基酸代谢', startPage: 125, endPage: 131, sections: [
        { name: '一、蛋白质的降解', startPage: 125, endPage: 125 },
        { name: '二、氨基酸降解', startPage: 125, endPage: 128 },
        { name: '三、氨基酸合成', startPage: 129, endPage: 131 },
      ]},
      { name: '第十一章 核苷酸代谢', startPage: 133, endPage: 138, sections: [
        { name: '一、核酸的降解', startPage: 133, endPage: 134 },
        { name: '二、核糖核苷酸的合成', startPage: 135, endPage: 137 },
        { name: '三、脱氧核糖核苷酸的合成', startPage: 138, endPage: 138 },
      ]},
      { name: '第十二章 DNA的生物合成', startPage: 140, endPage: 148, sections: [
        { name: '一、DNA复制', startPage: 140, endPage: 144 },
        { name: '二、逆转录', startPage: 145, endPage: 145 },
        { name: '三、DNA的突变与修复', startPage: 145, endPage: 147 },
        { name: '四、PCR技术', startPage: 148, endPage: 148 },
      ]},
      { name: '第十三章 RNA转录', startPage: 151, endPage: 159, sections: [
        { name: '一、转录的特征', startPage: 151, endPage: 151 },
        { name: '二、原核生物RNA转录', startPage: 151, endPage: 152 },
        { name: '三、原核生物的转录调控', startPage: 153, endPage: 154 },
        { name: '四、真核生物RNA的合成及其调控', startPage: 155, endPage: 156 },
        { name: '五、RNA的转录后加工', startPage: 157, endPage: 157 },
        { name: '六、RNA的复制方式', startPage: 158, endPage: 159 },
      ]},
      { name: '第十四章 蛋白质生物合成', startPage: 162, endPage: 170, sections: [
        { name: '一、密码子', startPage: 162, endPage: 162 },
        { name: '二、蛋白质合成体系', startPage: 162, endPage: 164 },
        { name: '三、蛋白质合成过程', startPage: 164, endPage: 169 },
        { name: '四、多肽链的折叠、修饰与转运', startPage: 169, endPage: 170 },
      ]},
    ])
  });

  // 7. 2027考研数学这十年（真题分类习题册）
  templates.push({
    id: 'preset_math_2027',
    name: '2027考研数学这十年',
    preset: true,
    createdAt: now, updatedAt: now,
    units: [
      { name: '高数', startPage: 1, endPage: 144, children: [
        { name: '极限', startPage: 1, endPage: 17, children: [] },
        { name: '一元函数微分学', startPage: 18, endPage: 33, children: [] },
        { name: '一元函数积分学', startPage: 34, endPage: 68, children: [] },
        { name: '常微分方程', startPage: 69, endPage: 83, children: [] },
        { name: '多元函数微分学', startPage: 84, endPage: 103, children: [] },
        { name: '多元函数积分学', startPage: 104, endPage: 130, children: [] },
        { name: '无穷级数', startPage: 131, endPage: 144, children: [] },
      ]},
      { name: '线代', startPage: 145, endPage: 194, children: [
        { name: '行列式', startPage: 145, endPage: 149, children: [] },
        { name: '矩阵', startPage: 150, endPage: 157, children: [] },
        { name: '向量与线性方程组', startPage: 158, endPage: 176, children: [] },
        { name: '矩阵的特征值和特征向量', startPage: 177, endPage: 187, children: [] },
        { name: '二次型', startPage: 188, endPage: 194, children: [] },
      ]},
      { name: '概率论', startPage: 195, endPage: 236, children: [
        { name: '随机事件和概率', startPage: 195, endPage: 199, children: [] },
        { name: '随机变量及其分布', startPage: 200, endPage: 205, children: [] },
        { name: '多维随机变量及其分布', startPage: 206, endPage: 213, children: [] },
        { name: '随机变量的数字特征', startPage: 214, endPage: 221, children: [] },
        { name: '大数定律和中心极限定理', startPage: 222, endPage: 223, children: [] },
        { name: '数理统计的基本概念', startPage: 224, endPage: 228, children: [] },
        { name: '参数估计', startPage: 229, endPage: 234, children: [] },
        { name: '假设检验', startPage: 235, endPage: 236, children: [] },
      ]},
    ]
  });

  // 8. 竟成408真题考点分类
  templates.push({
    id: 'preset_408_jingcheng',
    name: '竟成408真题考点分类',
    preset: true,
    createdAt: now, updatedAt: now,
    units: [
      { name: '数据结构', startPage: 1, endPage: 67, children: [
        { name: '绪论', startPage: 1, endPage: 4, children: [] },
        { name: '线性表', startPage: 5, endPage: 11, children: [] },
        { name: '栈、队列和数组', startPage: 12, endPage: 18, children: [] },
        { name: '树与二叉树', startPage: 19, endPage: 29, children: [] },
        { name: '图', startPage: 30, endPage: 43, children: [] },
        { name: '查找', startPage: 44, endPage: 56, children: [] },
        { name: '排序', startPage: 57, endPage: 67, children: [] },
      ]},
      { name: '计算机组成原理', startPage: 68, endPage: 143, children: [
        { name: '计算机系统概述', startPage: 68, endPage: 72, children: [] },
        { name: '数据的表示和运算', startPage: 73, endPage: 83, children: [] },
        { name: '存储器层次结构', startPage: 84, endPage: 101, children: [] },
        { name: '指令系统', startPage: 102, endPage: 113, children: [] },
        { name: '中央处理器', startPage: 114, endPage: 131, children: [] },
        { name: '总线和输入输出系统', startPage: 132, endPage: 143, children: [] },
      ]},
      { name: '操作系统', startPage: 144, endPage: 210, children: [
        { name: '操作系统概述', startPage: 144, endPage: 151, children: [] },
        { name: '进程管理', startPage: 152, endPage: 175, children: [] },
        { name: '内存管理', startPage: 176, endPage: 191, children: [] },
        { name: '文件管理', startPage: 192, endPage: 202, children: [] },
        { name: 'I/O管理', startPage: 203, endPage: 210, children: [] },
      ]},
      { name: '计算机网络', startPage: 211, endPage: 265, children: [
        { name: '计算机网络概述', startPage: 211, endPage: 214, children: [] },
        { name: '物理层', startPage: 215, endPage: 220, children: [] },
        { name: '数据链路层', startPage: 221, endPage: 232, children: [] },
        { name: '网络层', startPage: 233, endPage: 248, children: [] },
        { name: '传输层', startPage: 249, endPage: 258, children: [] },
        { name: '应用层', startPage: 259, endPage: 265, children: [] },
      ]},
    ]
  });

  return templates;
}

// 全局数据净化：任何来源（localStorage / IndexedDB / Cache / 导入文件）的损坏数据都不应导致白屏。
// 过滤非对象项目、null/非数组容器、脏条目。返回净化后的 store；无法净化则返回 null。
function sanitizeProjectData(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  ['records', 'items', 'units', 'shownMilestones', 'intervals'].forEach(k => {
    if (p[k] != null && !Array.isArray(p[k])) p[k] = [];
  });
  if (Array.isArray(p.records)) p.records = p.records.filter(r => r && typeof r === 'object');
  if (Array.isArray(p.items)) p.items = p.items.filter(it => it && typeof it === 'object').map(it => {
    // 字符串字段长度兜底：防止被篡改/损坏的超长备份撑爆本地存储与渲染
    if (typeof it.content === 'string') it.content = it.content.slice(0, 500);
    if (typeof it.note === 'string') it.note = it.note.slice(0, 60);
    if (typeof it.source === 'string') it.source = it.source.slice(0, 40);
    return it;
  });
  if (Array.isArray(p.units)) {
    const cleanUnits = arr => arr.filter(u => u && typeof u === 'object').map(u => {
      if (typeof u.name === 'string') u.name = u.name.slice(0, 60);
      if (Array.isArray(u.children)) u.children = cleanUnits(u.children);
      else u.children = [];
      return u;
    });
    p.units = cleanUnits(p.units);
  }
  return p;
}
function sanitizeStoreData(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  if (!s.projects || typeof s.projects !== 'object' || Array.isArray(s.projects)) {
    s.projects = {};
  }
  const cleanProjects = {};
  Object.keys(s.projects).forEach(pid => {
    const cp = sanitizeProjectData(s.projects[pid]);
    if (cp) cleanProjects[pid] = cp;
  });
  s.projects = cleanProjects;
  // 规范化墓碑字段：导入/外部数据缺失或类型错误时补空对象
  if (!s.tombstones || typeof s.tombstones !== 'object' || Array.isArray(s.tombstones)) s.tombstones = {};
  return s;
}

async function loadStore() {
  let lsValid = false;
  let lsRaw = null;
  try {
    lsRaw = localStorage.getItem(STORE_KEY);
    if (lsRaw) {
      const obj = JSON.parse(lsRaw);
      // 必须要求 projects 为非空对象：空 projects 会被当作"有效"，阻断 IndexedDB 恢复，
      // 进而用空数据覆盖真实备份，造成不可逆数据丢失
      if (obj && typeof obj === 'object' && obj.projects && typeof obj.projects === 'object' && Object.keys(obj.projects).length > 0) {
        store = obj;
        lsValid = true;
        _lastSaveSig = JSON.stringify(store);
      }
    }
  } catch (e) {}

  // ========== 关键：localStorage 无效时，并行从 IndexedDB / Cache API 恢复，成功后再做任何写入 ==========
  if (!lsValid) {
    let backup = null;
    let source = '';
    // 并行读取 IndexedDB 和 Cache API（原串行，改为并行以缩短恢复时间）
    // 不设超时中断：IndexedDB 若真卡住说明浏览器存储异常，此时用空数据覆盖真实数据的风险远大于加载慢
    // 但15秒后若仍未恢复，显示"恢复较慢"提示（不中断，继续后台等待）
    const idbPromise = idbRestoreLatest().catch(() => null);
    const cachePromise = cacheLoad().then(s => {
      if (!s) return null;
      try {
        const obj = JSON.parse(s);
        if (obj && obj.projects && typeof obj.projects === 'object' && Object.keys(obj.projects).length > 0) return obj;
      } catch (e) {}
      return null;
    }).catch(() => null);
    const slowRestoreTimer = setTimeout(() => {
      try {
        const splash = document.getElementById('splashScreen');
        if (splash) {
          const t = splash.querySelector('.splash-text') || splash.querySelector('p') || splash;
          if (t) t.textContent = '数据恢复较慢，请稍候…（请勿关闭页面）';
        }
      } catch (e) {}
    }, 15000);
    try {
      const [idbResult, cacheResult] = await Promise.all([idbPromise, cachePromise]);
      clearTimeout(slowRestoreTimer);
      // 优先用 IndexedDB（写入更及时、数据更新），其次用 Cache API
      if (idbResult && idbResult.projects && typeof idbResult.projects === 'object' && Object.keys(idbResult.projects).length > 0) {
        backup = idbResult; source = '备份';
      } else if (cacheResult) {
        backup = cacheResult; source = '离线缓存';
      }
    } catch (e) { clearTimeout(slowRestoreTimer); }
    if (backup && backup.projects && Object.keys(backup.projects).length > 0) {
      store = backup;
      _lastSaveSig = JSON.stringify(store);
      try { localStorage.setItem(STORE_KEY, _lastSaveSig); } catch (e) {}
      // 恢复后同步写入其他后端
      idbSaveSnapshot(_lastSaveSig);
      cacheSave(_lastSaveSig);
      // 只有 localStorage 本来有数据但损坏时才显示警告；本来就没数据则静默恢复
      if (lsRaw) {
        showStorageWarning('⚠️ 检测到本地数据异常，已从' + source + '自动恢复。建议立即到「设置 → 导出备份」保存一份 JSON 文件。');
      }
    } else {
      // 真·全新用户：此时才初始化空 store
      store = { currentId: null, projects: {}, unitTemplates: [], paperTemplates: [], tombstones: {} };
      _lastSaveSig = '';
    }
  }

  // ========== 到这里 store 一定是"有效的"，再做迁移和预设写入 ==========
  // 统一净化：任何存储层损坏（null 项目、脏条目、容器类型错误）都在迁移前剔除，杜绝 boot 白屏
  sanitizeStoreData(store);
  _booting = false; // 恢复完成，允许保存
  const beforeMigrate = JSON.stringify(store);
  if (store.mistakeGuided == null) store.mistakeGuided = false;
  if (!store.uiFlags || typeof store.uiFlags !== 'object') store.uiFlags = {}; // UI 标记（弹窗是否已看过等），随 store 一起双写备份
  if (!store.localData || typeof store.localData !== 'object') store.localData = {}; // 通用本地存储（主题、提醒设置等），随 store 一起双写备份
  Object.values(store.projects || {}).forEach(p => {
    if (!p || typeof p !== 'object') return;
    (p.items || []).forEach(it => {
      if (!it || typeof it !== 'object') return;
      if (it.pageStart == null && it.page != null) {
        it.pageStart = it.page;
        it.pageEnd = it.page;
      }
      if (it.pageStart == null) it.pageStart = 0;
      if (it.pageEnd == null) it.pageEnd = it.pageStart;
      if (it.manualMastered == null) it.manualMastered = false;
      if (it.wrongStreak == null) it.wrongStreak = 0;
      if (it.customIntervals === undefined) it.customIntervals = null;
      if (it.spreadCount == null) it.spreadCount = 0;
      if (it.lastSpreadDate == null) it.lastSpreadDate = null;
      if (it.earlyReviewed == null) it.earlyReviewed = false;
      if (it.stage == null) it.stage = 0;
      if (it.mastered == null) it.mastered = false;
      if (!Array.isArray(it.reviews)) it.reviews = [];
      if (it.masteredDate === undefined) it.masteredDate = null;
      if (it.learnedDate == null) it.learnedDate = todayStr();
      if (it.finalReviewDate === undefined) it.finalReviewDate = null;
    });
    if (!Array.isArray(p.shownMilestones)) p.shownMilestones = [];
    if (!Array.isArray(p.units)) p.units = [];
    const ensureUnitChildren = arr => arr.forEach(u => { if (!u || typeof u !== 'object') return; if (!Array.isArray(u.children)) u.children = []; if (u.children.length) ensureUnitChildren(u.children); });
    ensureUnitChildren(p.units);
    if (!Array.isArray(p.records)) p.records = [];
    p.records.forEach(r => {
      if (!r || typeof r !== 'object') return;
      if (r.startPage == null && r.endPage == null && r.page != null) { r.endPage = r.page; delete r.page; }
    });
    if (!Array.isArray(p.items)) p.items = [];
    if (!Array.isArray(p.intervals) || !p.intervals.length) p.intervals = [...DEFAULT_INTERVALS];
    if (p.weakThreshold == null) p.weakThreshold = 0.4;
    if (p.lapseRollback == null) p.lapseRollback = 2;
    if (p.skipConfirmDismissed == null) p.skipConfirmDismissed = false;
    if (p.reviewMode == null) p.reviewMode = 'classic';
    if (p.dailyCapacity == null) p.dailyCapacity = null;
    if (p.spreadThreshold == null) p.spreadThreshold = defaultComfortCap(p);
    if (p.totalLocked == null) p.totalLocked = false;
    if (p.bookStartPage == null) p.bookStartPage = null;
    if (p.bookEndPage == null) p.bookEndPage = null;
    if (!p.deadline && !(p.type === 'mistake' && (!p.mistakeMode || p.mistakeMode === 'free'))) p.deadline = todayStr();
    if (p.unitMode == null) p.unitMode = false;
    if (p.startDate == null) p.startDate = '';
    if (p.startPage == null) p.startPage = 0;
    if (p.createdAt == null) p.createdAt = Date.now();
    if (p.updatedAt == null) p.updatedAt = Date.now();
    migrateProject(p);
  });
  // 老用户适配：把已有项目的单元/套卷数据自动存为模板
  if (!Array.isArray(store.unitTemplates)) store.unitTemplates = [];
  if (!Array.isArray(store.paperTemplates)) store.paperTemplates = [];
  // 墓碑字段（多设备删除同步）：老版本数据无此字段时补空对象
  if (!store.tombstones || typeof store.tombstones !== 'object' || Array.isArray(store.tombstones)) store.tombstones = {};
  Object.values(store.projects).forEach(p => {
    if (!p || typeof p !== 'object') return;
    if (p.unitMode && Array.isArray(p.units) && p.units.length > 0) {
      const exists = store.unitTemplates.some(t => t.name === p.name);
      if (!exists) {
        store.unitTemplates.push({ id: genId(), name: p.name, units: JSON.parse(JSON.stringify(p.units)), createdAt: Date.now(), updatedAt: Date.now() });
      }
    }
    if (p.type === 'exercise' && p.unit === 'set' && Array.isArray(p.paperSections) && p.paperSections.length > 0) {
      const exists = store.paperTemplates.some(t => t.name === p.name);
      if (!exists) {
        store.paperTemplates.push({ id: genId(), name: p.name, sections: JSON.parse(JSON.stringify(p.paperSections)), createdAt: Date.now(), updatedAt: Date.now() });
      }
    }
  });
  if (JSON.stringify(store) !== beforeMigrate) saveStore();

  // 预设单元模板（放在恢复成功之后，空库也不会覆盖备份）
  const PRESET_VERSION = 7;
  const needPresetUpdate = !store.presetTemplatesLoaded || store.presetVersion !== PRESET_VERSION;
  if (needPresetUpdate) {
    if (!Array.isArray(store.unitTemplates)) store.unitTemplates = [];
    store.unitTemplates = store.unitTemplates.filter(t => t.id && !t.id.startsWith('preset_'));
    const presets = getPresetUnitTemplates();
    presets.forEach(p => store.unitTemplates.push(p));
    store.presetTemplatesLoaded = true;
    store.presetVersion = PRESET_VERSION;
    saveStore();
  }
}
/* ============ 数据安全防护：双写存储 + IndexedDB 版本快照 + 持久化 + 自动保存 + 损坏恢复 ============ */

// ---- IndexedDB 备份存储（保留最近 5 个版本快照，可回滚）----
const IDB_NAME = 'study_tracker_safe';
const IDB_STORE = 'snapshots';
const IDB_QUEUE = 'opqueue'; // ux-28：离线写操作队列
const IDB_VER = 2;
const MAX_SNAPSHOTS = 5;
let _idb = null;
function idbOpen() {
  return new Promise((resolve, reject) => {
    if (_idb) return resolve(_idb);
    try {
      const req = indexedDB.open(IDB_NAME, IDB_VER);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          const os = db.createObjectStore(IDB_STORE, { keyPath: 'id' });
          os.createIndex('time', 'time', { unique: false });
        }
        // ux-28：离线写操作队列（v2 新增）
        if (!db.objectStoreNames.contains(IDB_QUEUE)) {
          db.createObjectStore(IDB_QUEUE, { keyPath: 'id' });
        }
      };
      req.onsuccess = e => {
        const db = e.target.result;
        _idb = db;
        // 连接被关闭（浏览器清存储/磁盘回收）或版本变更时，把缓存句柄置空，下次自动重开，避免死连接导致 IDB 备份永久失效
        try {
          db.onclose = () => { _idb = null; };
          db.onversionchange = () => { try { db.close(); } catch (e) {} _idb = null; };
        } catch (err) {}
        resolve(_idb);
      };
      req.onerror = e => reject(e.target.error);
    } catch (e) { reject(e); }
  });
}
function idbPut(record) {
  return idbOpen().then(db => new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = e => reject(e.target.error);
    } catch (e) { reject(e); }
  }));
}
function idbGetAll() {
  return idbOpen().then(db => new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = e => reject(e.target.error);
    } catch (e) { reject(e); }
  }));
}
function idbDel(id) {
  return idbOpen().then(db => new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = e => reject(e.target.error);
    } catch (e) { reject(e); }
  }));
}
// 写入快照并清理旧版本
async function idbSaveSnapshot(dataStr) {
  try {
    const now = Date.now();
    await idbPut({ id: 'snap_' + now, time: now, data: dataStr });
    const all = await idbGetAll();
    if (all.length > MAX_SNAPSHOTS) {
      all.sort((a, b) => b.time - a.time);
      for (let i = MAX_SNAPSHOTS; i < all.length; i++) {
        try { await idbDel(all[i].id); } catch (e) {}
      }
    }
    return true;
  } catch (e) { return false; }
}
// 从 IndexedDB 恢复最近的有效快照
async function idbRestoreLatest() {
  try {
    const all = await idbGetAll();
    if (!all.length) return null;
    all.sort((a, b) => b.time - a.time);
    for (const snap of all) {
      try {
        const obj = JSON.parse(snap.data);
        // 空 projects 快照不算有效恢复源，继续找下一个
        if (obj && obj.projects && typeof obj.projects === 'object' && Object.keys(obj.projects).length > 0) return obj;
      } catch (e) { /* 损坏快照跳过 */ }
    }
    return null;
  } catch (e) { return null; }
}

/* ============ ux-28：离线写操作队列 + 顶部黄条 ============
   写操作（打卡/复习判定/录入）本地已落盘（localStorage+IDB快照+Cache），这里的 opqueue 只是
   "离线期间产生过写操作"的持久化台账：离线时记录一条并显示黄条；联网后自动 syncFromCloud()
   （双向 LWW 合并天然幂等，不会重复提交），成功后清空台账。 */
async function idbOpQueuePush(type){
  try {
    await idbOpen().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_QUEUE, 'readwrite');
      tx.objectStore(IDB_QUEUE).put({ id: 'op_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), ts: Date.now(), type: type || 'write' });
      tx.oncomplete = () => resolve();
      tx.onerror = e => reject(e.target.error);
    }));
  } catch (e) {}
}
async function idbOpQueueCount(){
  try {
    return await idbOpen().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_QUEUE, 'readonly');
      const req = tx.objectStore(IDB_QUEUE).getAll();
      req.onsuccess = () => resolve((req.result || []).length);
      req.onerror = e => reject(e.target.error);
    }));
  } catch (e) { return 0; }
}
async function idbOpQueueClear(){
  try {
    await idbOpen().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_QUEUE, 'readwrite');
      tx.objectStore(IDB_QUEUE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = e => reject(e.target.error);
    }));
  } catch (e) {}
}
let _offlineBar = null;
function showOfflineBar(){
  if (_offlineBar) return;
  const bar = document.createElement('div');
  bar.id = 'offlineBar';
  bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99998;background:var(--warn);color:#fff;padding:10px 16px;font-size:13px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.2)';
  bar.textContent = '📡 离线模式，改动已保存在本地，联网后自动同步';
  document.body.appendChild(bar);
  _offlineBar = bar;
  document.body.style.paddingTop = '56px';
}
function hideOfflineBar(){
  if (_offlineBar) { _offlineBar.remove(); _offlineBar = null; document.body.style.paddingTop = ''; }
}
// 离线时记录一条写操作（仅在离线时入队；本地数据早已落盘）
function markOfflineWrite(type){
  if (navigator.onLine) return;
  idbOpQueuePush(type);
  showOfflineBar();
}
window.addEventListener('offline', () => { if (navigator.onLine === false) showOfflineBar(); });
window.addEventListener('online', async () => {
  hideOfflineBar();
  // 联网后：把离线期间的写操作台账触发一次云端同步（幂等合并），成功后清空台账
  try {
    const n = await idbOpQueueCount();
    if (n > 0 && typeof STAuth !== 'undefined' && STAuth.isLoggedIn()) {
      if (typeof showToast === 'function') showToast('📶', '网络已恢复', '正在同步离线期间的 ' + n + ' 条改动', 3000);
      await STAuth.syncFromCloud({ skeleton: false });
      await idbOpQueueClear();
    } else if (n > 0) {
      // 未登录也清空本地台账（无云端可同步）
      await idbOpQueueClear();
    }
  } catch (e) {}
});

/* ---- Cache API 第三存储后端（PWA 离线存储，比 localStorage 更持久）---- */
const CACHE_NAME = 'study-tracker-data-v1';
async function cacheSave(dataStr) {
  try {
    if (!('caches' in window)) return false;
    const cache = await caches.open(CACHE_NAME);
    const resp = new Response(dataStr, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    await cache.put('store.json', resp);
    return true;
  } catch (e) { return false; }
}
async function cacheLoad() {
  try {
    if (!('caches' in window)) return null;
    const cache = await caches.open(CACHE_NAME);
    const resp = await cache.match('store.json');
    if (resp) return await resp.text();
    return null;
  } catch (e) { return null; }
}

/* Service Worker 注册已移除：Blob URL 注册 SW 会被现代浏览器以 SecurityError 拒绝，
   且 localStorage + IndexedDB + Cache API 三层存储已足够，无需 SW。 */
async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      return await navigator.storage.persist();
    }
  } catch (e) {}
  return false;
}
// ---- 存储配额检测 ----
async function getStorageEstimate() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      return { usage: est.usage || 0, quota: est.quota || 0,
               usagePct: est.quota ? Math.round(est.usage / est.quota * 100) : 0 };
    }
  } catch (e) {}
  return null;
}

// ---- 保存：localStorage（主）+ IndexedDB（备）双写，带防抖 ----
let _lastSaveSig = '';
let _booting = true; // 启动恢复期间禁止写入，防止空数据覆盖备份
function saveStore() {
  if (_booting) return; // 恢复期间静默忽略，防止空 store 污染 IndexedDB 备份
  const dataStr = JSON.stringify(store);
  // PWA 独立模式下禁用防抖，强制每次写入（增加存储成功率）
  if (!_isPWA && dataStr === _lastSaveSig) return; // 数据未变，跳过写入
  // 主存储：localStorage
  let lsOk = false;
  try {
    localStorage.setItem(STORE_KEY, dataStr);
    lsOk = true;
  } catch (e) {
    if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
      showStorageWarning('⚠️ 浏览器存储空间不足，数据可能无法保存。请到「设置 → 导出备份」保存 JSON 文件，然后清理浏览器网站数据。');
    }
  }
  // 只有写入成功才更新签名，失败时允许下次重试（避免一次失败后永久跳过）
  if (lsOk) _lastSaveSig = dataStr;
  // 备份存储：IndexedDB 快照（异步不阻塞）
  idbSaveSnapshot(dataStr);
  // 第三备份：Cache API（PWA 离线存储，异步不阻塞）
  cacheSave(dataStr);
  // 云端同步：已登录则防抖同步到云端（追加，不影响原有逻辑）
  if (typeof STAuth !== 'undefined' && STAuth.isLoggedIn()) STAuth.scheduleCloudSync();
}

/* ---- UI 标记：双写 localStorage + store.uiFlags，任一为 true 即视为已设置 ----
   iOS 会清 localStorage，但 store.uiFlags 会随 store 一起被 IndexedDB/Cache 恢复，
   这样"只弹一次"的弹窗标记不会因为 iOS 清 localStorage 而丢失。 */
function getUIFlag(name) {
  try { if (localStorage.getItem(name) === '1') return true; } catch (e) {}
  return !!(store && store.uiFlags && store.uiFlags[name] === true);
}
function setUIFlag(name) {
  try { localStorage.setItem(name, '1'); } catch (e) {}
  if (store) {
    if (!store.uiFlags || typeof store.uiFlags !== 'object') store.uiFlags = {};
    store.uiFlags[name] = true;
    saveStore(); // 触发 IndexedDB + Cache 备份
  }
}

/* ---- 通用本地存储：双写 localStorage + store.localData，任一有值即生效 ----
   与 getUIFlag/setUIFlag 类似，但支持任意字符串值（不只是 '1'）。
   iOS 清 localStorage 后，store.localData 会随 store 一起从 IndexedDB/Cache 恢复。 */
function getLocalVal(key, defaultValue) {
  try {
    const v = localStorage.getItem(key);
    if (v !== null) return v;
  } catch (e) {}
  if (store && store.localData && store.localData[key] !== undefined) return store.localData[key];
  return defaultValue;
}
function setLocalVal(key, value) {
  try { localStorage.setItem(key, value); } catch (e) {}
  if (store) {
    if (!store.localData || typeof store.localData !== 'object') store.localData = {};
    store.localData[key] = value;
    saveStore(); // 触发 IndexedDB + Cache 备份
  }
}

// ---- 顶部警告条 ----
let _storageWarnShown = false;
function showStorageWarning(html) {
  if (_storageWarnShown) return;
  _storageWarnShown = true;
  const bar = document.createElement('div');
  bar.id = 'storageWarnBar';
  bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#b02e24;color:#fff;padding:12px 44px 12px 16px;font-size:13px;line-height:1.55;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.25);max-height:40vh;overflow-y:auto';
  bar.innerHTML = html + '<span id="storageWarnClose" style="position:absolute;top:8px;right:12px;font-size:22px;opacity:.8;cursor:pointer;line-height:1;padding:4px 8px">×</span>';
  document.body.appendChild(bar);
  document.body.style.paddingTop = '56px';
  const closeIt = () => { bar.remove(); document.body.style.paddingTop = ''; _storageWarnShown = false; };
  const closeBtn = document.getElementById('storageWarnClose');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeIt);
    closeBtn.addEventListener('touchstart', e => { e.preventDefault(); closeIt(); }, { passive: false });
  }
}

// ---- 存储可用性 & 浏览器检测 ----
function isLocalStorageAvailable() {
  try {
    const k = '__st_ls_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch (e) {
    // 配额已满（QuotaExceededError）仍视为"可用但写不下"：返回 true，让自动保存继续尝试
    // （写不进会被 saveStore 内部 catch 掉）；只有真正禁用 localStorage（SecurityError / 无痕模式）才返回 false
    if (e && (e.name === 'QuotaExceededError' || e.code === 22 || /quota/i.test(e.name || ''))) return true;
    return false;
  }
}
function isSafariLike() {
  return /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent) ||
         (navigator.vendor && navigator.vendor.indexOf('Apple') > -1 && !/CriOS|FxiOS/.test(navigator.userAgent));
}
/* 检测是否为"添加到主屏幕"的独立模式（iOS PWA）——此模式下与 Safari 存储隔离且可能被清理 */
let _isPWA = false;
function isPWAMode() {
  try {
    if (window.navigator && window.navigator.standalone === true) return true;
    if (window.matchMedia) {
      if (window.matchMedia('(display-mode: standalone)').matches) return true;
      if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
    }
  } catch (e) {}
  return false;
}
/* manifest 注入已移除：iOS Safari 不支持 Blob URL manifest，依赖 meta 标签即可 */

/* ---- 动态生成 PNG 格式的 apple-touch-icon（SVG 图标在部分 iOS 版本不被识别）---- */
function ensureAppleTouchIconPNG() {
  return; // 静态统一图标已在 <head> 引入，停用 canvas 覆盖
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 180;
    canvas.height = 180;
    const ctx = canvas.getContext('2d');
    // 渐变背景
    const grad = ctx.createLinearGradient(0, 0, 180, 180);
    grad.addColorStop(0, '#2e6b4f');
    grad.addColorStop(1, '#23533d');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 180, 180);
    // 圆角（iOS 会自动裁剪，但手动加更保险）
    // 文字
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 105px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('学', 90, 96);
    const pngUrl = canvas.toDataURL('image/png');
    // 替换或添加 apple-touch-icon
    let link = document.querySelector('link[rel="apple-touch-icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'apple-touch-icon';
      document.head.appendChild(link);
    }
    link.href = pngUrl;
  } catch (e) {}
}

// ---- 初始化存储安全模块 ----
function initStorageSafety() {
  // 检测 PWA 独立模式（添加到桌面）
  _isPWA = isPWAMode();
  if (!isLocalStorageAvailable()) {
    // 无痕模式或存储空间不足：不显示横幅（无痕模式由 checkIncognito 弹窗提醒，存储不足由 saveStore 检测）
    return;
  }
  // 请求持久化存储（浏览器不会自动清理本站数据，PWA 模式下尤其重要）
  requestPersistence();
  // 延迟检测配额，超 80% 警告
  setTimeout(() => {
    getStorageEstimate().then(est => {
      if (est && est.usagePct >= 80) {
        showStorageWarning('⚠️ 浏览器存储空间已用 ' + est.usagePct + '%，快满了。建议尽快到「设置 → 导出备份」保存数据，并清理浏览器缓存。');
      }
    });
  }, 3000);
  // 页面切后台 / 关闭时强制保存（iOS Safari 上 pagehide 最可靠）
  const flush = () => { try { saveStore(); } catch (e) {} };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);
  // PWA 模式下每 10 秒自动保存（更频繁，增加存储成功率）；普通模式 20 秒
  const saveInterval = _isPWA ? 10000 : 20000;
  setInterval(() => { try { saveStore(); } catch (e) {} }, saveInterval);
  // 生成 PNG 格式的应用图标（延迟到渲染之后，不阻塞首屏；head 中已有内联脚本提前生成）
  setTimeout(ensureAppleTouchIconPNG, 1000);
}
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function cur() { return store.currentId ? (store.projects[store.currentId] || null) : null; }
let lastRenderedProjectId = null;

/* ============ 回车自动跳转下一个输入框（统一表单键盘流） ============
 * 在文本/数字/日期等输入框按 Enter，自动聚焦到容器内下一个"当前可见且可填"的框；
 * 在最后一个框按 Enter 触发该表单提交。桌面 Enter 与移动端虚拟键盘"下一步/完成"均生效。
 * 字段在每次按键时实时计算，自动适配各模式下输入框的显示/隐藏。 */
function _navFieldVisible(el) {
  if (!el || el.disabled || el.readOnly) return false;
  const t = ((el.type || el.tagName || '') + '').toLowerCase();
  if (['hidden','checkbox','radio','button','submit','reset','file','range','color','image'].includes(t)) return false;
  if (el.hidden) return false;
  let node = el;
  while (node && node !== document.body) {
    if (node.hidden) return false;
    const cs = getComputedStyle(node);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    node = node.parentElement;
  }
  if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
  return true;
}
function getNavFields(container) {
  if (!container) return [];
  return [...container.querySelectorAll('input, textarea, select')].filter(_navFieldVisible);
}
function setupEnterNav(container, submitBtn) {
  if (!container) return;
  container.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    // 中文/日文输入法组词中（含 keyCode 229），回车是确认候选词，不跳转
    if (e.isComposing || e.keyCode === 229) return;
    const t = e.target;
    if (!t || !t.closest || !t.matches('input, textarea, select')) return;
    // 原生下拉框：保留 Enter 展开/选择选项的原生行为，不拦截跳转
    if (t.tagName === 'SELECT') return;
    const tt = ((t.type || '') + '').toLowerCase();
    if (['button','submit','checkbox','radio','file','hidden','range','color','image'].includes(tt)) return;
    // textarea 默认 Enter 换行，需 Ctrl/Cmd+Enter 才跳转（本应用暂无多行框，预留）
    if (t.tagName === 'TEXTAREA' && !e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const fields = getNavFields(container);
    const idx = fields.indexOf(t);
    if (idx === -1) return;
    if (idx < fields.length - 1) {
      const next = fields[idx + 1];
      next.focus();
      const nt = ((next.type || '') + '').toLowerCase();
      if (['text','number','search','tel','url','email','password'].includes(nt)) {
        try { next.select(); } catch (_) {}
      }
    } else if (submitBtn) {
      const btn = typeof submitBtn === 'function' ? submitBtn() : submitBtn;
      if (btn && !btn.disabled) btn.click();
    }
  });
}

/* ============ 页码辅助 ============ */
function getItemPageStart(it) {
  if (it.pageStart != null) return it.pageStart;
  if (it.page != null) return it.page;
  return 0;
}
function getItemPageEnd(it) {
  if (it.pageEnd != null) return it.pageEnd;
  if (it.pageStart != null) return it.pageStart;
  if (it.page != null) return it.page;
  return 0;
}
// 判断条目是否有有效的页码定位（pageStart > 0 才算有）
function hasPageLocator(it) {
  return getItemPageStart(it) > 0;
}
// 判断条目是否有有效的套卷号定位（setNo > 0 才算有）
function hasSetLocator(it) {
  return it.setNo != null && it.setNo > 0;
}
function fmtPageRange(it) {
  const s = getItemPageStart(it);
  const e = getItemPageEnd(it);
  if (s === e) return `P${s}`;
  return `P${s}-${e}`;
}
/* 错题出处：根据当前模式返回定位信息
   - free模式：优先source自由文本，回退页码
   - page模式：只显示页码，不显示旧source文本（转换后旧source保留但不展示）
   - set模式：只显示套卷号，不显示旧source文本 */
function getItemSource(it, p) {
  const mode = p && p.mistakeMode ? p.mistakeMode : 'free';
  if (mode === 'set') {
    if (hasSetLocator(it)) return paperLabel(p, it.setNo);
    return ''; // set模式下不显示旧source文本
  }
  if (mode === 'page') {
    if (hasPageLocator(it)) return fmtPageRange(it);
    return ''; // page模式下不显示旧source文本
  }
  // free模式：优先source，回退页码
  if (it.source != null && String(it.source).trim() !== '') return String(it.source).trim();
  if (hasPageLocator(it)) return fmtPageRange(it);
  if (hasSetLocator(it)) return paperLabel(p, it.setNo);
  return '';
}
/* 列表/看板里条目的定位文字：错题显示出处（可空），背书显示页码区间 */
function fmtItemLocator(p, it) {
  if (p.type === 'mistake') return getItemSource(it, p);
  return fmtPageRange(it);
}

/* ============ 核心计算 ============ */
function getIntervals(p) {
  return (p.intervals && p.intervals.length) ? p.intervals : DEFAULT_INTERVALS;
}

/* 一条内容从首次学习到"走完最后一轮、毕业"所需的累计天数 = 各档间隔之和。
   默认 [1,2,4,7,15,30] → 59 天。背书要保证所有内容在考试前毕业，
   最后一批新内容最晚必须在 deadline - cycleDays 天学完，之后只复习不学新。 */
function getReviewCycleDays(p) {
  const iv = getIntervals(p);
  let sum = 0;
  for (let i = 0; i < iv.length; i++) sum += Math.max(1, parseInt(iv[i], 10) || 1);
  return sum;
}

function calcNextReviewDateFromLearn(learnDate, completedReviews, intervals) {
  if (completedReviews >= intervals.length) return null;
  let total = 0;
  for (let i = 0; i <= completedReviews; i++) total += intervals[i];
  return addDays(learnDate, total);
}

function isSetMode(p) { return !!p && p.type === 'exercise' && p.unit === 'set'; }
/* 错题本模式辅助 */
function isMistakeFreeMode(p) { return !!p && p.type === 'mistake' && (!p.mistakeMode || p.mistakeMode === 'free'); }
function isMistakePageMode(p) { return !!p && p.type === 'mistake' && p.mistakeMode === 'page'; }
// 能否用"只做部分页（跳着做）"：按页推进的模式（刷题页模式 / 错题按页 / 背书）；套卷、自由错题不适用
function isPageScopeCapable(p) {
  if (!p) return false;
  if (p.type === 'exercise') return p.unit !== 'set';
  if (p.type === 'mistake') return isMistakePageMode(p);
  if (p.type === 'recite') return true;
  return false;
}
function isMistakeSetMode(p) { return !!p && p.type === 'mistake' && p.mistakeMode === 'set'; }
function mistakeUsesUnits(p) { return isMistakePageMode(p) && p.unitMode && Array.isArray(p.units) && p.units.length > 0; }
function unitName(p) {
  if (isSetMode(p)) return '套';
  // 错题本所有模式统一按"条"统计（收录→攻克），套卷号只是归类维度
  if (p && p.type === 'mistake') return '条';
  return '页';
}
function fmtUnitNum(n) {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/* ============ 区间合并 & 已完成页数 ============ */
function mergeRanges(ranges) {
  if (!ranges.length) return [];
  const sorted = ranges.filter(r => r.end >= r.start).slice().sort((a, b) => a.start - b.start);
  if (!sorted.length) return [];
  const merged = [{ start: sorted[0].start, end: sorted[0].end }];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].start <= last.end + 1) {
      last.end = Math.max(last.end, sorted[i].end);
    } else {
      merged.push({ start: sorted[i].start, end: sorted[i].end });
    }
  }
  return merged;
}
function countMergedPages(merged) {
  return merged.reduce((sum, r) => sum + (r.end - r.start + 1), 0);
}
/* 把原始区间 merge 后裁剪到目标范围（单元范围/正文范围），再计页数。
   所有"已完成页数"口径都应走这里，避免一个裁一个不裁导致 delta/今日新增/速度估计对不上。 */
function countClippedRanges(ranges, p) {
  const targets = getTargetPageRanges(p);
  if (!targets.length) return 0; // 与 getBookDoneRanges 一致：无目标范围视为 0 页
  const merged = mergeRanges(ranges);
  const clipped = [];
  merged.forEach(r => targets.forEach(t => {
    const s = Math.max(t.start, r.start), e = Math.min(t.end, r.end);
    if (e >= s) clipped.push({ start: s, end: e });
  }));
  return countMergedPages(mergeRanges(clipped));
}
function getRecordRange(r, p) {
  if (r.startPage != null) {
    const s = r.startPage;
    const e = r.endPage != null ? r.endPage : s;
    return { start: s, end: e };
  }
  const end = r.endPage != null ? r.endPage : (r.page != null ? r.page : 0);
  return { start: 1, end };
}
function getPaperSections(p) {
  return Array.isArray(p.paperSections) ? p.paperSections.filter(s => s && s.name) : [];
}
function getNormalizedSections(p) {
  const secs = getPaperSections(p);
  const sum = secs.reduce((s, x) => s + Math.max(0, Number(x.weight) || 0), 0);
  if (!secs.length) return [];
  if (sum <= 0) {
    const eq = 1 / secs.length;
    return secs.map(s => ({ ...s, wt: eq }));
  }
  return secs.map(s => ({ ...s, wt: Math.max(0, Number(s.weight) || 0) / sum }));
}
function paperLabel(p, n) {
  if (p && p.paperLabelMode === 'year' && p.paperYearStart) {
    const y = parseInt(p.paperYearStart, 10) + n - 1;
    return `${y}年`;
  }
  return `第${n}套`;
}
function getSetState(p, targetDate) {
  const secs = getNormalizedSections(p);
  const state = {};
  const recs = (p.records || []).slice().sort((a, b) => a.date < b.date ? -1 : (a.date > b.date ? 1 : 0));
  // 追踪每个 (套号, 板块) 最近一次录入的日期与 pct：
  // 同一天重复录入同板块 = 覆盖（后填替换先填），跨天录入才累加，避免 50%+80%=130% 被 cap 到 100%
  const lastSetSec = {};
  recs.forEach(r => {
    if (r.set == null) return;
    if (targetDate && r.date > targetDate) return;
    const no = r.set;
    if (!state[no]) state[no] = { secs: {}, legacy: 0 };
    const st = state[no];
    if (r.secId != null && r.pct != null) {
      const key = no + '|' + r.secId;
      const pct = Number(r.pct);
      const prev = lastSetSec[key];
      if (prev && prev.date === r.date) {
        // 同一天重复：用新 pct 替换旧 pct（先减旧再加新）
        st.secs[r.secId] = Math.max(0, Math.min(100, (st.secs[r.secId] || 0) - prev.pct + pct));
        prev.pct = pct;
      } else {
        st.secs[r.secId] = Math.max(0, Math.min(100, (st.secs[r.secId] || 0) + pct));
        lastSetSec[key] = { date: r.date, pct: pct };
      }
    } else if (r.all === true || (r.done == null && r.q == null)) {
      if (secs.length) secs.forEach(s => { st.secs[s.id] = 100; });
      st.legacy = 1;
    } else if (r.done != null && r.q != null && r.q > 0) {
      st.legacy = Math.max(0, Math.min(1, r.done / r.q));
    }
  });
  return state;
}
function getSetFraction(p, no, state) {
  const st = (state || getSetState(p))[no];
  if (!st) return 0;
  const secs = getNormalizedSections(p);
  if (secs.length) {
    let f = 0;
    secs.forEach(s => { f += ((st.secs[s.id] || 0) / 100) * s.wt; });
    return Math.max(0, Math.min(1, f));
  }
  return st.legacy;
}
function getCompletedSets(p, targetDate) {
  const state = getSetState(p, targetDate);
  return Object.keys(state).reduce((sum, no) => sum + getSetFraction(p, no, state), 0);
}
function getCompletedPages(p) {
  if (isSetMode(p)) return getCompletedSets(p);
  // 错题：按已攻克条数统计（mastered 或 manualMastered），而非收录条数
  if (p.type === 'mistake') return (p.items || []).filter(it => it.mastered || it.manualMastered).length;
  // 刷题(练习册)与背书：按"页码区间合并"算进度。getBookDoneRanges 已自动裁剪到目标范围（单元范围或正文范围）
  return countRanges(getBookDoneRanges(p));
}
function getCompletedPagesAtDate(p, targetDate) {
  if (isSetMode(p)) return getCompletedSets(p, targetDate);
  if (p.type === 'mistake') {
    // 用 masteredDate 精确回溯：在目标日期或之前已攻克/熟知的才算；
    // 极少数老数据没有 masteredDate 时退回 learnedDate，避免已攻克条目在历史曲线里"消失"。
    return (p.items || []).filter(it => {
      if (!(it.mastered || it.manualMastered)) return false;
      const d = it.masteredDate || it.learnedDate;
      return d && d <= targetDate;
    }).length;
  }
  let ranges;
  if (p.type === 'exercise') {
    ranges = (p.records || []).filter(r => r.date <= targetDate).map(r => getRecordRange(r, p));
  } else {
    ranges = (p.items || []).filter(it => it.learnedDate <= targetDate)
      .map(it => ({ start: getItemPageStart(it), end: getItemPageEnd(it) }));
  }
  // 与 getBookDoneRanges 同口径：裁剪到目标范围，避免历史/当前累计一个裁一个不裁
  return countClippedRanges(ranges, p);
}

/* ============ 节奏估计：活跃率 × 学习日产能 ============
 * 旧算法把"剩余量/剩余自然日"当每日目标，并把"14天内进度差/14"当速度，
 * 隐含两个错误假设：① 你每天都学；② 休息日也算学习日。
 * 新模型从历史打卡重建"每日新增完成量"，估计两个参数：
 *   activityPerDay —— 任一自然日你会学习的概率（贝叶斯 Beta 后验，先验≈每周5天）
 *   perStudyDayRaw —— 学习日当天的平均完成量（EWMA，半衰期14天，近期更重）
 * 自然日产能 = activityPerDay × perStudyDayRaw，才是外推 ETA 的正确速度。
 * 学习日目标 = (剩余量 + 已落后量) / 剩余预期学习日数，自动把过去的债分摊回来。
 */
/* getMetrics 缓存：按项目+日期，数据未变则直接复用 */
const _metricsCache = {};
function getMetrics(p) {
  const t = todayStr();
  // 清理过期缓存：只保留今天的
  Object.keys(_metricsCache).forEach(k => { if (!k.endsWith(':' + t)) delete _metricsCache[k]; });
  const cacheKey = p.id + ':' + t;
  const itemsLen = (p.items || []).length;
  // 缓存签名：包含所有影响指标的字段，避免改 paperSections/intervals/unitMode 等不刷新
  const dataSig = (p.updatedAt || 0) + '|' + (p.records || []).length + '|' + itemsLen
    + '|' + p.total + '|' + p.bookStartPage + '|' + p.bookEndPage + '|' + (p.deadline || '')
    + '|' + JSON.stringify(p.paperSections || []) + '|' + JSON.stringify(p.intervals || [])
    + '|' + (p.unitMode ? 1 : 0) + '|' + (p.reviewMode || '');
  if (_metricsCache[cacheKey] && _metricsCache[cacheKey].sig === dataSig) {
    return _metricsCache[cacheKey].result;
  }
  // 错题本：总量 = 当前已收录条数（随添加/删除动态变化，无需预估）
  // 刷题/背书：启用单元模式时用所有单元范围的总页数（自动排除习题等）；否则用整本书范围或 p.total
  let total;
  if (p.type === 'mistake') {
    total = itemsLen;
  } else if (p.unitMode && Array.isArray(p.units) && p.units.length) {
    total = countRanges(getTargetPageRanges(p));
  } else if (p.bookStartPage != null && p.bookEndPage != null) {
    total = Math.max(0, p.bookEndPage - p.bookStartPage + 1);
  } else {
    total = p.total;
  }
  const currentPage = getCompletedPages(p);
  const remaining = Math.max(0, total - currentPage);

  const daysLeft = p.deadline ? diffDays(t, p.deadline) : null;
  const daysAvailable = daysLeft === null ? null : daysLeft + 1;
  // 兼容旧通知/看板：假设"天天学"的保守自然日均值
  const needPerDay = daysAvailable > 0 ? remaining / daysAvailable : Infinity;

  // ---- 收集所有完成日期（exercise→records.date；recite/mistake→items.learnedDate + masteredDate）----
  const dateSet = new Set();
  if (p.type === 'exercise') {
    (p.records || []).forEach(r => { if (r.date) dateSet.add(r.date); });
  } else {
    (p.items || []).forEach(it => {
      if (it.learnedDate) dateSet.add(it.learnedDate);
      if (it.masteredDate) dateSet.add(it.masteredDate); // 攻克日也要有采样点
    });
  }
  const allDates = [...dateSet].sort();

  // 累计完成量（自动处理区间合并 / 套卷权重 / 背书 learnedDate）
  const cumByDate = {};
  allDates.forEach(d => { cumByDate[d] = getCompletedPagesAtDate(p, d); });
  const idxOf = {};
  allDates.forEach((d, i) => { idxOf[d] = i; });

  // 观察窗口：最近 60 个自然日，且不早于第一条记录（ISO 日期可按字符串字典序比较）
  const WINDOW_DAYS = 60;
  const cutoff = addDays(t, -(WINDOW_DAYS - 1));
  let windowStart = allDates.length ? (allDates[0] > cutoff ? allDates[0] : cutoff) : cutoff;
  if (windowStart > t) windowStart = t;
  const inWindowDates = allDates.filter(d => d >= windowStart && d <= t);

  // 窗口内每日新增完成量（与上一个记录日做差，区间合并保证 cum 单调不减）
  const dailyDelta = [];
  inWindowDates.forEach(d => {
    const i = idxOf[d];
    const prevCum = i > 0 ? cumByDate[allDates[i - 1]] : 0;
    dailyDelta.push({ date: d, delta: Math.max(0, cumByDate[d] - prevCum) });
  });

  const activeDays = dailyDelta.filter(x => x.delta > 0).length;
  const windowDays = Math.max(1, diffDays(windowStart, t) + 1);
  const activeSet = new Set(dailyDelta.filter(x => x.delta > 0).map(x => x.date));

  // ---- 活跃率：对窗口内每个自然日的 0/1 学习指示做 EWMA（半衰期10天），再向先验收缩 ----
  // v3.1：先验强度随观察到的学习日数自适应衰减。
  // 原固定 PRIOR_K=10 会让“每天都学”的重度用户被永久低估（上限约 0.884）。
  // 现在：activeDays 越少越依赖先验（每周约 5 天）；累积到 7 个学习日后完全相信历史数据。
  // v8.1：收敛上限从 10 调整为 7，经模拟验证：全职用户首周误差减半，在职用户提前约1周收敛，小样本仍有先验保护。
  const ACT_HALF = 10;
  const PRIOR_RATE = 5 / 7;
  const PRIOR_K = Math.max(0, 7 - Math.min(activeDays, 7));

  let wAll = 0, wActive = 0;
  // 全新项目（无任何学习记录）不虚构"过去 60 个自然日都没学"，否则会把先验（每周约 5 天）
  // 错误稀释成每周约 2 天。只有真正存在过记录（哪怕在 60 天前）时，才用窗口内的空白天数反映"最近没学"。
  const ewmaDays = allDates.length ? windowDays : 0;
  for (let age = 0; age < ewmaDays; age++) {
    const d = addDays(t, -age);
    const w = Math.pow(0.5, age / ACT_HALF);
    wAll += w;
    if (activeSet.has(d)) wActive += w;
  }
  const rawActivity = wAll > 0 ? wActive / wAll : 0;
  const activityPerDay = (wActive + PRIOR_RATE * PRIOR_K) / (wAll + PRIOR_K);
  const activityPerWeek = activityPerDay * 7;

  // ---- 学习日产能：EWMA，半衰期 14 天（只对真正推进了进度的日子加权）----
  const HALF_LIFE = 14;
  let wSum = 0, dwSum = 0;
  dailyDelta.forEach(x => {
    if (x.delta <= 0) return;
    const age = Math.max(0, diffDays(x.date, t));
    const w = Math.pow(0.5, age / HALF_LIFE);
    wSum += w; dwSum += w * x.delta;
  });
  const perStudyDayRaw = wSum > 0 ? dwSum / wSum : 0;

  // ---- 自然日产能（含休息日），与 ETA 同口径 ----
  const naturalDailyRate = activityPerDay * perStudyDayRaw;

  // ---- 置信度 ----
  // medium：累计 3 个学习日即启动个性化（不再要求窗口跨满 7 天，否则天天学的积极用户前 6 天都被当"样本不足"，
  // 与容量冷启动"3 个学习日就个性化"的门槛保持一致）；早期 medium 文案会标"范围偏宽、会随你修正"。
  // high：需 7 个学习日且跨满 2 周，才有稳定的活跃率/星期画像。
  let confidence = 'low';
  if (activeDays >= 7 && windowDays >= 14) confidence = 'high';
  else if (activeDays >= 3) confidence = 'medium';
  const enoughData = confidence !== 'low';

    // ---- 稀疏打卡检测：记录间隔越长，产能归因越不精确 ----
  // 系统只能把完成量归到「有打卡的那一天」，长间隔会让单日产能被高估。
  // 这里用相邻学习日的间隔中位数来判断，≥4 天就在 UI 上提示。
  let medianGap = null;
  if (activeDays >= 2) {
    const activeDates = dailyDelta.filter(x => x.delta > 0).map(x => x.date);
    const gaps = [];
    for (let i = 1; i < activeDates.length; i++) {
      gaps.push(diffDays(activeDates[i - 1], activeDates[i]));
    }
    if (gaps.length) {
      gaps.sort((a, b) => a - b);
      medianGap = gaps[Math.floor(gaps.length / 2)];
    }
  }
  const sparseLogging = medianGap != null && medianGap >= 4;

  // ---- 产能波动区间：给"乐观/保守"完成范围，而不是一个看似精确的单点日期 ----
  const activeVals = dailyDelta.filter(x => x.delta > 0).map(x => x.delta).sort((a, b) => a - b);
  const quantile = (arr, q) => {
    if (!arr.length) return null;
    const pos = (arr.length - 1) * q, b = Math.floor(pos), r = pos - b;
    return arr[b + 1] != null ? arr[b] + r * (arr[b + 1] - arr[b]) : arr[b];
  };
  let rateHigh = null, rateLow = null; // 状态好 / 状态差时，每个学习日的典型产能
  if (confidence === 'high' && activeVals.length >= 7) {
    // 经验分位，并保留 ±8% 的最小带宽（即使每天很规律，日常也难免波动，范围不应退化成一个点）
    rateHigh = Math.max(quantile(activeVals, 0.75), perStudyDayRaw * 1.08);
    rateLow  = Math.min(quantile(activeVals, 0.25), perStudyDayRaw * 0.92);
  } else if (enoughData && activeVals.length >= 3) {
    rateHigh = perStudyDayRaw * 1.3;   // 样本偏少，给较宽的启发式区间并在文案标注
    rateLow  = perStudyDayRaw * 0.7;
  }
  const natRateHigh = activityPerDay * (rateHigh || 0); // 乐观自然日产能（早完成）
  const natRateLow  = activityPerDay * (rateLow || 0);  // 保守自然日产能（晚完成）

  // ---- 速度（自然日口径，兼容旧 status/图表）----
  let speed = null, speedLabel = '';
  if (naturalDailyRate > 0) {
    speed = naturalDailyRate;
    speedLabel = `近${windowDays}天节奏（每周约${Math.round(activityPerWeek)}个学习日）`;
  }
  if (speed === null) {
    const fbDate = allDates[0] || p.startDate;
    if (fbDate) {
      const span = diffDays(fbDate, t) + 1;
      if (span >= 1 && currentPage > 0) { speed = currentPage / span; speedLabel = '自开始以来（粗估）'; }
    }
  }

  // ---- ETA（基准 + 乐观/保守区间）----
  let etaDate = null, etaEarlyDate = null, etaLateDate = null;
  if (remaining === 0) { etaDate = etaEarlyDate = etaLateDate = t; }
  else if (speed !== null && speed > 0) {
    etaDate = addDays(t, Math.ceil(remaining / speed));
    if (enoughData) {
      if (natRateHigh > 0) etaEarlyDate = addDays(t, Math.ceil(remaining / natRateHigh));
      if (natRateLow > 0)  etaLateDate  = addDays(t, Math.ceil(remaining / natRateLow));
    }
  }

  // ---- 有效开始日：填了 startDate 且不早于/等于最早打卡日时用它；否则用最早打卡日；全新项目无记录则为 null ----
  const effStart = (p.startDate && (!allDates.length || p.startDate <= allDates[0]))
    ? p.startDate : (allDates.length ? allDates[0] : null);

  // ---- 落后量（仅用于文案解释；不重复加进目标，因为 remaining 已含落后）----
  let behind = 0;
  if (effStart && p.deadline && total > 0) {
    const totalSpan = diffDays(effStart, p.deadline);
    const elapsed = diffDays(effStart, t);
    if (totalSpan > 0) {
      const idealAtToday = total * Math.max(0, Math.min(1, elapsed / totalSpan));
      behind = Math.max(0, idealAtToday - currentPage);
    }
  }
  // 剩余预期学习日数（含今天）；无截止日时不存在"追赶目标"，下面不计算每学习日目标
  const hasDeadline = daysAvailable != null && daysAvailable > 0;
  // ===== 背书本：要保证"所有内容在考试前走完所有复习轮次并毕业"，
  // 新学必须提前一个完整复习周期（默认约59天）结束，之后只滚动复习。据此计算新学有效窗口。 =====
  let cycleDays = 0, newLearnEnd = null, sprint = false, cycleTight = false;
  let planDaysAvailable = daysAvailable; // 新学进度/可行性使用的有效天数（背书=到新学截止日，其余=到考试日）
  if (p.type === 'recite' && hasDeadline) {
    cycleDays = getReviewCycleDays(p);
    newLearnEnd = addDays(p.deadline, -cycleDays);
    const daysToNewLearnEnd = diffDays(t, newLearnEnd) + 1;
    if (daysToNewLearnEnd < 1) {
      // 剩余时间已放不下一个完整复习周期：进入冲刺，新学目标按考试日算（至少把要考的过一遍），由状态卡给冲刺策略
      sprint = true;
      planDaysAvailable = daysAvailable;
    } else {
      planDaysAvailable = daysToNewLearnEnd;
    }
  }
  const studyDaysRemaining = hasDeadline ? Math.max(0.5, planDaysAvailable * activityPerDay) : null;
  // 每个学习日该做多少 = 剩余 / 剩余学习日（落后已体现在 remaining 里，不再叠加，否则会堆到做不到）
  let perStudyDay = null;
  // 可行性分级：把"目标负荷"和"历史产能"对比，做不到时给出路而不是硬塞数字
  let feasibility = null, ratio = null, feasiblePerWeek = null, feasibleDays = null, feasibleDaysLong = null;
  let needWkNormal = null, needWkBest = null; // 按平时节奏 / 拼尽全力，每周需学几天
  // 近 7 天「势头」：产能用半衰期 14 天的 EWMA，用户刚提速时反应偏慢，会让"来不及"提示挂很久。
  // 额外统计最近 7 天的自然日产能作为乐观信号（至少 3 个学习日才采信，避免一两天的异常误导），
  // 让"刚开始努力"能在几天内被看见；这是只上抬、不压低的信号。
  let momentumNatRate = null, momentumDays = 0;
  if (remaining > 0) {
    const deltaByDate = {};
    dailyDelta.forEach(x => { deltaByDate[x.date] = x.delta; });
    let mActive = 0, mTotal = 0;
    for (let o = 0; o < 7; o++) {
      const dl = deltaByDate[addDays(t, -o)] || 0;
      if (dl > 0) { mActive++; mTotal += dl; }
    }
    momentumDays = mActive;
    if (mActive >= 3) momentumNatRate = (mActive / 7) * (mTotal / mActive);
  }
  if (enoughData && remaining > 0 && hasDeadline) {
    perStudyDay = remaining / studyDaysRemaining;
    if (perStudyDayRaw > 0) {
      ratio = perStudyDay / perStudyDayRaw;
      // 乐观边界 = 长期最好状态 与 最近 7 天势头 取较高者；保守边界仍用长期低值，不轻易承诺"轻松"
      const effectiveHigh = momentumNatRate != null
        ? Math.max(natRateHigh || 0, momentumNatRate) : natRateHigh;
      // 用"最快/最慢"完成所需自然日数与可用天数比较来分档，比单点均值更稳健、更好解释
      const daysNeededEarly = effectiveHigh > 0 ? remaining / effectiveHigh : Infinity; // 状态最好/最近势头
      const daysNeededLate  = natRateLow  > 0 ? remaining / natRateLow  : Infinity; // 状态较差时
      // 背书本按"新学窗口"判断能否在留出完整复习周期的前提下学完；其余类型按考试日总天数
      if (daysNeededLate <= planDaysAvailable) feasibility = 'easy';  // 即使慢一点也来得及
      else if (daysNeededEarly > planDaysAvailable) {
        if (p.type === 'recite' && !sprint && daysNeededEarly <= daysAvailable) {
          // 新学窗口（考试日-复习周期）赶不上，但在考试前还能学完：复习周期会被压缩，
          // 最后一批内容只能做短期冲刺。标记 cycleTight，由状态卡给出"加量/提前"建议，而不是简单判来不及。
          cycleTight = true;
          feasibility = 'stretch';
        } else if (sprint) {
          // 已进入冲刺期（完整周期放不下）：新学目标按考试日算，不再判 impossible，交由冲刺文案
          feasibility = 'stretch';
        } else {
          // 数据有限（medium，通常是刚用 1~2 周）时不轻易判"无法完成"：样本噪声大、用户正在适应，
          // 太早挂"来不及"会很打击人；降级为 stretch，攒满约 2 周数据后再如实判断。
          feasibility = confidence === 'high' ? 'impossible' : 'stretch';
        }
      }
      else feasibility = 'stretch';                                      // 正常发挥有风险、加把劲可赶上
      // 每周需学几天：主指标用平时产能（用户最可能达到的水平）；分母用新学窗口天数
      needWkNormal = remaining / perStudyDayRaw / (planDaysAvailable / 7);
      // 拼尽全力（每次都达到最好状态）时每周需学几天，用于判断"学满7天到底行不行"
      needWkBest = rateHigh ? remaining / rateHigh / (planDaysAvailable / 7) : needWkNormal;
      feasiblePerWeek = needWkNormal;
      // 预计完成所需自然日：若近期势头明显更快，按势头给一个更贴近当下的口径（状态卡展示"最近势头"）
      const effectiveNat = momentumNatRate != null ? Math.max(naturalDailyRate, momentumNatRate) : naturalDailyRate;
      if (effectiveNat > 0) feasibleDays = remaining / effectiveNat;
      // 长期可持续口径（不含近7天爆发）：用于"延期兜底"建议，避免爆发期算出比截止日还早的日期
      if (naturalDailyRate > 0) feasibleDaysLong = remaining / naturalDailyRate;
    }
  }
  // 冷启动（尚无个人节奏）：仍给一个粗略"每学习日目标"，让看板大字、今日目标横幅、状态卡三处口径一致，
  // 避免新用户前几天看板是空目标或用错口径。按固定先验"每周约 5 个学习日"；planDaysAvailable 对背书
  // 已自动用"新学窗口（目标日−完整复习周期）"、其余模式用目标日。攒满 3 个学习日进入 medium 后，
  // 由上面的真实节奏 perStudyDay 覆盖。
  if (perStudyDay == null && remaining > 0 && hasDeadline) {
    perStudyDay = remaining / Math.max(0.5, planDaysAvailable * (5 / 7));
  }
  // 数据不足时，告诉用户再补多少天打卡预测才稳
  // “再积累多少学习日”，而不是“再连续打卡多少天”——后者对低频用户不准确
  // 两阶段：累计 3 个学习日即开始个性化（宽范围），7 个学习日且跨 2 周后范围稳定（high）。
  const daysToMedium = confidence === 'low' ? Math.max(0, 3 - activeDays) : 0;
  const needMoreActiveDays = confidence === 'high' ? 0 : Math.max(0, 7 - activeDays);
  const needMoreDays = needMoreActiveDays; // 兼容旧调用点

  // 今天已推进多少（用于"今日是否达标"提示）：当前累计 − 昨天及以前的累计
  const cumYesterday = getCompletedPagesAtDate(p, addDays(t, -1));
  const todayDone = Math.max(0, currentPage - cumYesterday);

  // ---- 坚持度 & 趋势（供看板/完成情况使用）----
  const isActiveDay = d => activeSet.has(d);
  // 当前连续：今天学了从今天算；今天还没学则从昨天往回算（不因今天尚未学就清零）
  let streakNow = 0;
  let cursor = isActiveDay(t) ? t : addDays(t, -1);
  while (cursor >= windowStart && isActiveDay(cursor)) { streakNow++; cursor = addDays(cursor, -1); }
  // 窗口内最长连续 & 最长停摆（无活跃日时停摆为0）
  // 与连续打卡逻辑一致：今天没学则从昨天开始统计，不把"今天还没来得及学"算入停摆
  let longestStreak = 0, runOn = 0, longestBreak = 0, runOff = 0;
  if (allDates.length) {
    const startAge = isActiveDay(t) ? 0 : 1; // 今天学了从今天算，没学从昨天算
    // 当前这一段连续（从 startAge 起 streakNow 天）不计入"历史最长"，否则刷新纪录永远不成立
    const currentRunEndAge = startAge + streakNow - 1;
    for (let age = windowDays - 1; age >= startAge; age--) {
      const d = addDays(t, -age);
      if (isActiveDay(d)) {
        runOn++;
        if (age > currentRunEndAge) longestStreak = Math.max(longestStreak, runOn);
        runOff = 0;
      } else {
        runOff++; longestBreak = Math.max(longestBreak, runOff); runOn = 0;
      }
    }
  }
  const lastStudyDate = allDates.length ? allDates[allDates.length - 1] : null;
  // 今天之前的上一个学习日（用于"中断后回归"判断，lastStudyDate可能包含今天）
  const prevStudyDate = allDates.filter(d => d < t).slice(-1)[0] || null;
  // 趋势：近 7 天学习日平均产能 vs 之前 3 周（8~28 天前）学习日平均产能
  const meanActive = dates => {
    const vals = dailyDelta.filter(x => dates.includes(x.date) && x.delta > 0).map(x => x.delta);
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  };
  const recentDates = [], prevDates = [];
  for (let o = 0; o <= 6; o++) recentDates.push(addDays(t, -o));
  for (let o = 7; o <= 27; o++) prevDates.push(addDays(t, -o));
  const recentRate = meanActive(recentDates), prevRate = meanActive(prevDates);
  let trendPct = null;
  if (recentRate != null && prevRate != null && prevRate > 0) trendPct = (recentRate - prevRate) / prevRate;

  // 按最近 7 天势头的预计完成日（比长期 EWMA 更贴近"现在的你"，用于鼓励刚提速的用户）
  let momentumEtaDate = null;
  if (remaining > 0 && momentumNatRate != null && momentumNatRate > 0) {
    momentumEtaDate = addDays(t, Math.ceil(remaining / momentumNatRate));
  }
  // 最近势头是否足以在截止日前完成（状态卡据此及时给出"按这个势头能赶上"）
  let momentumOnTime = false;
  if (hasDeadline && momentumEtaDate) {
    // 背书正常窗口下按"新学截止日"判断（赶上新学截止才留得出完整复习周期）；冲刺/其余按考试日
    const onTimeTarget = (p.type === 'recite' && newLearnEnd && !sprint) ? newLearnEnd : p.deadline;
    momentumOnTime = momentumEtaDate <= onTimeTarget;
  }
  // 近期势头改善：最近 7 天自然日产能比长期均值高出 ≥25%，但还没高到能按期。
  // 用于在"暂时落后"时也及时把进步反馈出来（缺口在缩小），而不是让红灯一直挂着。只上抬、不压低。
  let momentumImproving = false;
  if (!momentumOnTime && momentumDays >= 3 && momentumNatRate != null && naturalDailyRate > 0 && remaining > 0) {
    momentumImproving = momentumNatRate >= naturalDailyRate * 1.25;
  }

  const result = {
    t, total, currentPage, remaining, daysLeft, daysAvailable,
    needPerDay, speed, speedLabel, etaDate, etaEarlyDate, etaLateDate,
    activeDays, windowDays, activityPerWeek, perStudyDayRaw, rateHigh, rateLow,
    perStudyDay, studyDaysRemaining, behind, confidence, enoughData,
    feasibility, ratio, feasiblePerWeek, feasibleDays, feasibleDaysLong, needWkNormal, needWkBest, needMoreDays, needMoreActiveDays, daysToMedium,
    sparseLogging, medianGap,
    todayDone, streakNow, longestStreak, longestBreak, lastStudyDate, prevStudyDate,
    recentRate, prevRate, trendPct,
    momentumNatRate, momentumDays, momentumEtaDate, momentumOnTime, momentumImproving,
    cycleDays, newLearnEnd, sprint, cycleTight, planDaysAvailable,
    effStart
  };
  _metricsCache[cacheKey] = { sig: dataSig, result };
  return result;
}

function getDueItems(p) {
  if (p.type === 'exercise') return [];
  const today = todayStr();
  return (p.items || []).filter(it => !it.mastered && !it.manualMastered && it.nextReviewDate && it.nextReviewDate <= today);
}
function getOverdueItems(p) {
  if (p.type === 'exercise') return [];
  const today = todayStr();
  return (p.items || []).filter(it => !it.mastered && !it.manualMastered && it.nextReviewDate && it.nextReviewDate < today);
}

/* ============ 保持期复习（已掌握内容的定期唤醒，防止遗忘） ============ */
// 保持间隔：前2次30天，第3次45天，之后60天（逐渐拉长，符合记忆曲线）
function getRetentionGap(passCount) {
  if (passCount <= 0) return 30;
  if (passCount === 1) return 30;
  if (passCount === 2) return 45;
  return 60;
}
// 每日保持复习软上限：同一天掌握的内容，到期日自动摊到多天，避免几十条扎堆
const RETENTION_DAILY_CAP = 5;
const RETENTION_STAGGER_WINDOW = 21; // 最多向后顺延的天数
// 复习列表中保持复习默认展示条数（超出折叠，避免长期未处理时列表冗长）
const RETENTION_SHOWN_CAP = 5;
const _retentionExpanded = new Set(); // 已展开全部保持复习的项目 id
/* 在目标日期当天及之后找一个"已排保持复习最少"的日子（只顺延、不提前）。
   逐条掌握时反复调用：前面刚排的条目会被计入，于是同日掌握的一批自然均匀摊开。 */
function staggerRetentionDate(p, target, excludeId) {
  if (!p || !Array.isArray(p.items)) return target;
  const counts = {};
  p.items.forEach(it => {
    if (it.id === excludeId) return;
    if (it.mastered && !it.manualMastered && it.retentionDate) {
      counts[it.retentionDate] = (counts[it.retentionDate] || 0) + 1;
    }
  });
  // 叠加当天正常复习负载（未掌握条目的排期）：保持复习错峰要避开已被正常复习占满的日子，
  // 用项目舒适量作总容量上限，避免某天总负载远超舒适量
  const cap = getComfortCap(p);
  p.items.forEach(it => {
    if (it.mastered) return; // 已掌握条目不进正常复习排期
    if (it.nextReviewDate) {
      counts[it.nextReviewDate] = (counts[it.nextReviewDate] || 0) + 1;
    }
  });
  // 优先：目标日期起，找到第一个"总负载未达舒适量上限"的日子
  for (let i = 0; i <= RETENTION_STAGGER_WINDOW; i++) {
    const d = addDays(target, i);
    if ((counts[d] || 0) < cap) return d;
  }
  // 兜底：窗口内都满了，选总负载最少的一天
  let best = target, bestN = Infinity;
  for (let i = 0; i <= RETENTION_STAGGER_WINDOW; i++) {
    const d = addDays(target, i);
    const n = counts[d] || 0;
    if (n < bestN) { bestN = n; best = d; }
  }
  return best;
}
// 安排下一次保持复习（掌握时调用，或保持复习通过后调用）。传入 p 以启用自动错峰。
function scheduleRetention(item, baseDate, passCount, p) {
  item.retentionPass = passCount;
  const target = addDays(baseDate, getRetentionGap(passCount));
  item.retentionDate = p ? staggerRetentionDate(p, target, item.id) : target;
}
// 清除保持复习安排（取消掌握/手动熟知时调用）
function clearRetention(item) {
  item.retentionDate = null;
  item.retentionPass = 0;
}
// 今日到期的保持复习条目（已掌握、非手动熟知、retentionDate <= 今天）
function getRetentionDueItems(p) {
  if (p.type === 'exercise') return [];
  const today = todayStr();
  return (p.items || []).filter(it =>
    it.mastered && !it.manualMastered && it.retentionDate && it.retentionDate <= today
  );
}
// 保持复习逾期条目
function getRetentionOverdueItems(p) {
  if (p.type === 'exercise') return [];
  const today = todayStr();
  return (p.items || []).filter(it =>
    it.mastered && !it.manualMastered && it.retentionDate && it.retentionDate < today
  );
}
/* 保持复习评价：pass=还记得（继续保持，间隔拉长）；fail=模糊了（退出掌握，回到正常复习） */
function applyRetentionReview(item, result, p) {
  const today = todayStr();
  item.retentionReviews = item.retentionReviews || [];
  item.retentionReviews.push({ date: today, result });
  if (result === 'pass') {
    // 还记得：继续保持，安排下一次（间隔逐渐拉长，同日批量通过时自动错峰）
    const nextPass = (item.retentionPass || 0) + 1;
    scheduleRetention(item, today, nextPass, p);
  } else {
    // 模糊了：退出保持期，追加一条 forgot 评价后重算，让正常复习流程接管
    item.mastered = false;
    item.masteredDate = null;
    item.retentionDate = null;
    item.retentionPass = 0;
    item.reviews = item.reviews || [];
    item.reviews.push({ date: today, quality: 'forgot' });
    recomputeItemMastery(item, p);
  }
  p.updatedAt = Date.now();
  saveStore();
}

/* ============ 条目优先级（保留今天 / 先分散谁的统一口径） ============ */
/* 高优先级 = 更该留在今天：逾期久 > 更薄弱 > 被分散次数多（防饥饿）> stage 低 */
function compareItemPriority(a, b) {
  const today = todayStr();
  const oa = a.nextReviewDate < today ? diffDays(a.nextReviewDate, today) : 0;
  const ob = b.nextReviewDate < today ? diffDays(b.nextReviewDate, today) : 0;
  if (oa !== ob) return ob - oa;
  const sa = getItemScore(a) ?? 0.5;
  const sb = getItemScore(b) ?? 0.5;
  if (sa !== sb) return sa - sb;
  if ((a.spreadCount || 0) !== (b.spreadCount || 0)) return (b.spreadCount || 0) - (a.spreadCount || 0);
  return (a.stage || 0) - (b.stage || 0);
}

/* 逾期分散：为今天原本排期的条目预留名额，只把"超出今日舒适量"的逾期条目摊到未来。
   返回 { moved, blocked }：moved=改到未来的条数；blocked=被防饥饿锁死、强制移回今天的紧急条数。 */
function spreadOverdueItems(p, days) {
  const today = todayStr();
  const cap = getComfortCap(p, today);
  const onTimeToday = getDueItems(p).filter(it => it.nextReviewDate === today);
  const reserve = onTimeToday.length;
  const overdueSorted = getOverdueItems(p).slice().sort(compareItemPriority);
  // 今天最该还的逾期 = 舒适量减去今天已有排期；防饥饿锁死的条目由 spreadItems 强制留在今天
  const keepN = Math.max(0, cap - reserve);
  const keepIds = new Set(overdueSorted.slice(0, keepN).map(it => it.id));
  const overflow = overdueSorted.filter(it => !keepIds.has(it.id));
  if (!overflow.length) return { moved: 0, blocked: 0 };
  const blockedN = overflow.filter(it => !canBeSpread(it, p)).length;
  const changed = spreadItems(p, overflow, days);
  // spreadItems 的改动 = 锁死条目移回今天（blockedN）+ 可分散条目改到未来
  return { moved: Math.max(0, changed - blockedN), blocked: Math.min(blockedN, changed) };
}

/* 通用分散引擎（v2：每日硬上限 + 全局最佳适配，绝不抬高本就忙的日子）
   - 每日上限 = 舒适量 与 当日排期容量 的较小值（经典模式/容量0 时只看舒适量）
   - 在 1..days 天窗口内，把每条放到"负载/容量比最低"的日子；并列取最近
   - 窗口内全部满载时，仍放入最低负载日（有界超量，保证条目不会无限期滞留）
   - 防饥饿：canBeSpread=false 的条目强制留在今天
*/
function spreadItems(p, items, days) {
  const today = todayStr();
  days = Math.max(1, parseInt(days, 10) || 1);
  if (!items || !items.length) return 0;

  const spreadable = items.filter(it => canBeSpread(it, p));
  const blocked = items.filter(it => !canBeSpread(it, p));
  let changed = 0;
  // 防饥饿锁死的逾期条目强制回到今天（已在今天的不算变更）
  blocked.forEach(it => {
    if (it.nextReviewDate !== today) { it.nextReviewDate = today; changed++; }
  });

  if (!spreadable.length) {
    if (changed) { p.updatedAt = Date.now(); saveStore(); }
    return changed;
  }

  // 背书本冲刺期：摊派窗口不得越过考试日（把复习排到考试之后没有意义）。
  // 考试就在今天/已到期时，无可摊派的日子，全部留在今天（考前能过多少过多少）。
  let windowDays = days;
  if (p.type === 'recite' && p.deadline) {
    const toDeadline = diffDays(today, p.deadline);
    if (toDeadline < windowDays) windowDays = Math.max(0, toDeadline);
  }
  if (windowDays <= 0) {
    spreadable.forEach(it => { if (it.nextReviewDate !== today) { it.nextReviewDate = today; changed++; } });
    if (changed) { p.updatedAt = Date.now(); saveStore(); }
    return changed;
  }

  spreadable.sort(compareItemPriority);

  // 未来 days 天的逐日容量与已有负载（负载表随分配实时更新）
  const days_ = [];
  for (let d = 1; d <= windowDays; d++) {
    const date = addDays(today, d);
    days_.push({ date, cap: getSpreadDayCap(p, date), load: getReviewLoadOnDate(p, date) });
  }

  spreadable.forEach(it => {
    const oldDate = it.nextReviewDate;
    // 第一轮：只在未满的日子里选相对负载最低、并列最近的
    let best = null;
    for (const col of days_) {
      if (col.load >= col.cap) continue;
      const ratio = col.load / col.cap;
      const dist = diffDays(today, col.date);
      if (!best || ratio < best.ratio - 1e-9 || (Math.abs(ratio - best.ratio) < 1e-9 && dist < best.dist)) {
        best = { col, ratio, dist };
      }
    }
    // 第二轮：窗口全满 → 选绝对负载最低的，并列选最远（保护近期，把溢出推到远端）
    if (!best) {
      let col = days_[0];
      for (const c of days_) {
        if (c.load < col.load || (c.load === col.load && c.date > col.date)) col = c;
      }
      best = { col };
    }
    it.nextReviewDate = best.col.date;
    it.spreadCount = (it.spreadCount || 0) + 1;
    it.lastSpreadDate = today;
    best.col.load++;
    if (oldDate !== best.col.date) changed++;
  });

  if (changed) { p.updatedAt = Date.now(); saveStore(); }
  return changed;
}

/* 当日超额分散：按优先级保留前 N 条在今天，其余分散到未来 days 天。
   - 主模式（keepRatio 未指定）：保留舒适量内的量，其余全部分散
   - 温和模式（keepRatio 指定，如 0.5）：保留当前待复习量的 keepRatio 倍，其余分散
   返回实际改动条数；若超额条目全部被防饥饿锁死，返回 0（调用方应提示用户这些不能再推）。 */
function spreadExcessToday(p, days, keepRatio) {
  const today = todayStr();
  const due = getDueItems(p).slice();
  const cap = getComfortCap(p, today);
  let keepN;
  if (keepRatio != null && keepRatio >= 0 && keepRatio < 1) {
    keepN = Math.max(1, Math.ceil(due.length * keepRatio));
  } else {
    if (due.length <= cap) return 0;
    keepN = cap;
  }
  if (due.length <= keepN) return 0;

  due.sort(compareItemPriority);
  const keep = due.slice(0, keepN);
  const excess = due.slice(keepN);
  let changed = 0;
  keep.forEach(it => { if (it.nextReviewDate !== today) { it.nextReviewDate = today; changed++; } });
  return changed + spreadItems(p, excess, days);
}

/* 重新均匀排期所有未掌握的条目（切换到均匀模式时调用，v2 双向最佳适配） */
function rebalanceAllItems(p) {
  const today = todayStr();
  const items = (p.items || []).filter(it =>
    !it.mastered && !it.manualMastered && it.nextReviewDate
  );
  if (!items.length) return;

  if (p.reviewMode === 'balanced') {
    // 一次性建立未来 60 天的负载表，避免 O(n²) 全表扫描
    const HORIZON = 60;
    const loadMap = new Map();
    const bump = (date, delta) => { if (date) loadMap.set(date, (loadMap.get(date) || 0) + delta); };
    items.forEach(it => bump(it.nextReviewDate, 1));
    const tomorrow = addDays(today, 1);

    // 关键修复：模式切换绝不能把"今天到期 / 已逾期"的复习推到明天，否则用户切换当天会看到
    // "没有任何复习任务"，记忆上也不安全。做法：把这些条目一律锚定到今天；若超出当日容量，
    // 交给 render 时的 autoBalanceIfNeeded（按容量+防饥饿规则）自动摊派——该留今天的（逾期太久）
    // 会被强制留下，其余均匀摊到未来。未来才到期的条目才参与错峰。
    const dueItems = items.filter(it => it.nextReviewDate <= today);
    const futureItems = items.filter(it => it.nextReviewDate > today);
    dueItems.forEach(it => {
      if (it.nextReviewDate !== today) {
        bump(it.nextReviewDate, -1);
        bump(today, 1);
        it.nextReviewDate = today;
      }
    });

    // 未来条目：一次性重排，给略宽的窗口（gap×0.5、绝对上限 21 天），允许向前借位最多 2 天，
    // 但 minDate=tomorrow，绝不把未来内容提前到今天（避免切换当天额外增加负担）
    futureItems.sort(compareItemPriority);
    futureItems.forEach(it => {
      const intervals = getItemIntervals(it, p);
      const stage = Math.min(it.stage || 0, intervals.length - 1);
      const gap = intervals[stage] || 1;
      const maxForward = Math.min(21, Math.max(3, Math.round(gap * 0.5)));
      const maxBack = Math.min(2, Math.floor(gap * 0.25));
      const oldDate = it.nextReviewDate;
      const target = findAvailableDate(p, oldDate, {
        maxForward, maxBack, minDate: tomorrow, gap, loadMap
      });
      if (target !== oldDate) {
        bump(oldDate, -1);
        bump(target, 1);
        it.nextReviewDate = target;
      }
    });
  } else {
    // 经典间隔：未到期的保持原计划；已逾期的也保持其逾期日期（经典模式下它们本来就在今日清单里，
    // 切模式不应把欠账"推到明天再补"，也不应让用户切换当天看不到任何复习任务）。
    // 经典模式不做自动摊派，逾期多少就如实显示多少，由用户按优先级尽快清。
  }
  p.lastAutoBalanceDate = null; // 模式切换后允许今天再做一次启动自动均衡
  p.updatedAt = Date.now();
  saveStore();
}

/* ============ 智能排期引擎 v2（EWMA 产能 + 星期画像 + 双向最佳适配） ============ */

/* 汇总每个自然日的"复习评价次数"（排除首次录入；用索引而非对象引用，导入/重算后依然稳健） */
function getReviewCountsByDate(p) {
  const counts = {};
  (p.items || []).forEach(it => {
    (it.reviews || []).forEach((r, i) => {
      if (i > 0 && r.date) counts[r.date] = (counts[r.date] || 0) + 1;
    });
  });
  return counts;
}

/* 汇总每个自然日的"学习动作条数"：新学（learnedDate 每条 1 次）+ 复习评价（reviews i>0）。
   只统计复习会陷入冷启动死锁——系统每天只排几条、用户只能做几条、容量就永远停在几条；
   新学动作同样反映"你每天能处理多少条"，必须计入产能。 */
function getActivityCountsByDate(p) {
  const counts = {};
  (p.items || []).forEach(it => {
    if (it.learnedDate) counts[it.learnedDate] = (counts[it.learnedDate] || 0) + 1;
    (it.reviews || []).forEach((r, i) => {
      if (i > 0 && r.date) counts[r.date] = (counts[r.date] || 0) + 1;
    });
  });
  return counts;
}

/* 学习日比例：近 28 个自然日里有学习动作的天数占比（clamp 到 0.35~1）。
   冷启动（不足 3 个学习日）按"天天可学"=1 处理，宁可任务略多也不把进度拖到最后。 */
function getStudyDayRatio(p, counts) {
  counts = counts || getActivityCountsByDate(p);
  const today = todayStr();
  let active = 0;
  for (let age = 0; age < 28; age++) {
    if ((counts[addDays(today, -age)] || 0) > 0) active++;
  }
  if (active < 3) return 1;
  return Math.max(0.35, Math.min(1, active / 28));
}

/* 按期均摊下限（deadline-aware leveling）：为了让"已学但未毕业"的内容都在目标日前走完，
   从今天起每个学习日至少要处理的复习条数。
   - 这是排期容量的硬下限，防止智能容量被"低速率历史"锁死后，任务被一路摊到最后一天集中爆发；
   - 只统计已学内容的剩余复习（确定的硬需求）；未学内容由新学目标（perStudyDay）单独驱动；
   - 已在最后一轮但因模糊未毕业的，保守按"再复习 1 次"计；
   - 目标日 120 天以外不启用（远期不制造数字压力）。
   返回 { cap, need, studyDaysLeft }；无目标日或无需求时 cap=0。 */
function getDeadlineLevelCap(p, date) {
  // 背书（封闭总量）与错题（已收录的是确定硬需求）都做"目标日前走完已学内容"的复习均摊，
  //   这是防止被低速率历史锁死、任务一路摊到最后集中爆发的硬下限；
  //   错题未来新收录的随时进来再重算；"新学均摊"只对背书（按页推进）启用，错题不按页新学。
  if (!p || (p.type !== 'recite' && p.type !== 'mistake') || !p.deadline) return { cap: 0, need: 0, studyDaysLeft: 0 };
  const today = date || todayStr();
  const daysLeft = diffDays(today, p.deadline) + 1; // 含今天
  if (daysLeft <= 0 || daysLeft > 120) return { cap: 0, need: 0, studyDaysLeft: 0 };
  const intervals = getIntervals(p);
  const totalStages = intervals.length;
  const ratio = getStudyDayRatio(p);
  const studyDaysLeft = Math.max(1, daysLeft * ratio);
  // ① 复习需求：已学未毕业内容的剩余复习轮次（均摊到目标日前的学习日）
  let reviewNeed = 0;
  let learnedItems = 0, learnedItemPages = 0;
  (p.items || []).forEach(it => {
    if (it.mastered || it.manualMastered || it.finalReviewDate || !it.learnedDate) return;
    learnedItems++;
    if (it.pageStart != null && it.pageEnd != null) learnedItemPages += Math.max(0, it.pageEnd - it.pageStart + 1);
    const stage = Math.min(it.stage || 0, totalStages - 1);
    let remain = totalStages - stage;
    if (remain < 1) remain = 1;
    reviewNeed += remain;
  });
  const reviewCap = reviewNeed / studyDaysLeft;
  // ② 新学需求：仅在新学窗口内（目标日 - 一个完整复习周期之前），把未学内容均摊到剩余新学学习日
  let newCap = 0;
  const cycleDays = getReviewCycleDays(p);
  const newLearnEnd = addDays(p.deadline, -cycleDays);
  // 新学均摊仅对背书（按页推进）；错题不按页新学、新错题随时收录，newCap 保持 0。
  if (p.type === 'recite' && (!p.deadline || today <= newLearnEnd)) {
    // 总页 / 已学页（与 getMetrics 同口径）
    let totalPages;
    if (p.unitMode && Array.isArray(p.units) && p.units.length) totalPages = countRanges(getTargetPageRanges(p));
    else if (p.bookStartPage != null && p.bookEndPage != null) totalPages = Math.max(0, p.bookEndPage - p.bookStartPage + 1);
    else totalPages = p.total;
    const learnedPages = getCompletedPages(p) || 0;
    const unlearnedPages = Math.max(0, (totalPages || 0) - learnedPages);
    if (unlearnedPages > 0) {
      // 用已学条目估算"平均每条多少页"，把未学页换算成条；无数据时按 1 条=1 页（保守偏小，容量不足再由复习级量兜底）
      const avgPages = learnedItems > 0 ? Math.max(0.5, learnedItemPages / learnedItems) : 1;
      const unlearnedItems = unlearnedPages / avgPages;
      const newWindowDays = Math.max(1, diffDays(today, newLearnEnd) + 1);
      const newStudyDays = Math.max(1, newWindowDays * ratio);
      newCap = unlearnedItems / newStudyDays;
    }
  }
  const need = reviewNeed;
  const cap = Math.ceil(reviewCap + newCap);
  return { cap, need, studyDaysLeft, newCap: Math.round(newCap * 10) / 10, reviewCap: Math.round(reviewCap * 10) / 10 };
}

/* 舒适量默认值按项目类型区分：背书单条内容量大（十几页），默认6；错题单条是一道题，默认10 */
function defaultComfortCap(p) {
  return p && p.type === 'recite' ? 6 : 10;
}

/* 舒适量：用户希望每天最多面对多少条（背书默认6，错题默认10） */
function getComfortCap(p) {
  return Math.max(1, Math.min(50, parseInt(p.spreadThreshold, 10) || defaultComfortCap(p)));
}

/* 舒适量智能建议：基于最近14天日均实际完成复习条数，给出推荐值
   数据不足（<2个活跃日）返回 null；建议值 clamp 在 3~15 */
function getComfortAdvice(p) {
  if (!p || p.type === 'exercise') return null;
  const counts = getReviewCountsByDate(p);
  const today = todayStr();
  let total = 0, activeDays = 0;
  for (let age = 0; age < 14; age++) {
    const c = counts[addDays(today, -age)] || 0;
    if (c > 0) { total += c; activeDays++; }
  }
  if (activeDays < 2) return null;
  const avg = total / activeDays;
  const suggested = Math.max(3, Math.min(15, Math.round(avg * 1.2)));
  return { avg: Math.round(avg * 10) / 10, suggested, current: getComfortCap(p), activeDays };
}

/* 渲染设置页舒适量建议区域（容量透明化 + 智能建议 + 一键应用） */
function renderComfortAdvice(p) {
  const el = document.getElementById('comfortAdvice');
  if (!el || !p || p.type === 'exercise') { if (el) el.style.display = 'none'; return; }
  // 当前舒适量优先读输入框（用户可能刚改了还没保存），其次读项目配置
  const inputEl = document.getElementById('sSpreadThreshold');
  const inputVal = inputEl ? parseInt(inputEl.value, 10) : NaN;
  const currentComfort = !isNaN(inputVal) && inputVal >= 1 ? inputVal : getComfortCap(p);
  const parts = [];
  // 容量透明化：均匀模式下显示当前智能容量估算
  // 容量透明化（仅均匀模式）：区分"积压追赶"与"日常节奏"两种状态
  const cu = getBacklogCatchUp(p);
  const backlogHeavy = p.reviewMode === 'balanced' && cu.backlog > currentComfort;
  if (p.reviewMode === 'balanced') {
    const cap = getDailyCapacity(p);
    const daily = Math.min(cap, currentComfort);
    if (backlogHeavy) {
      const clearDays = Math.ceil(cu.backlog / Math.max(1, daily));
      parts.push(`<div style="margin-bottom:6px">📊 当前有 <b>${cu.backlog}</b> 条到期/逾期，系统正按每天 <b>${daily}</b> 条安排，约 <b>${clearDays}</b> 天清完；每天的量不会超过你的舒适量，不会被一次性压垮。</div>`);
    } else {
      const bottleneck = currentComfort < cap ? '舒适量是当前瓶颈' : '容量在控制排题，舒适量是安全上限';
      parts.push(`<div style="margin-bottom:6px">📊 当前智能容量约 <b>${cap}</b> 条/天，实际每日排题 = min(${cap}, ${currentComfort})，${bottleneck}。</div>`);
    }
  }
  // 智能建议：积压较重时不再按"近期完成量"建议下调（越积压越压容量会形成死循环），改为提速引导
  const advice = getComfortAdvice(p);
  if (backlogHeavy) {
    parts.push(`<div style="color:#d97706">💡 有较多积压时，系统已在你的舒适量范围内自动提速。保持当前舒适量即可，每天完成一点就能稳步清完；若想更快，可把舒适量小幅上调 1~2 条试试。</div>`);
  } else if (advice) {
    advice.current = currentComfort;
    const diff = advice.suggested - advice.current;
    let tag = '';
    if (Math.abs(diff) <= 1) tag = '<span style="color:#16a34a">当前设置合理</span>';
    else if (diff > 0) tag = `<span style="color:#d97706">建议上调</span>`;
    else tag = `<span style="color:#dc2626">建议下调</span>`;
    parts.push(`<div style="margin-bottom:6px">💡 你最近14天（${advice.activeDays}个学习日）日均完成 <b>${advice.avg}</b> 条复习，建议舒适量设为 <b>${advice.suggested}</b> 条。${tag}</div>`);
    if (Math.abs(diff) > 1) {
      parts.push(`<button type="button" class="ghost-btn" id="btnApplyComfortAdvice" style="padding:5px 12px;font-size:12px;margin-top:2px">一键应用建议（${advice.suggested}条）</button>`);
    }
  } else {
    parts.push(`<div style="color:var(--muted)">💡 再积累几天复习数据后，这里会根据你的实际节奏给出舒适量建议。</div>`);
  }
  el.innerHTML = parts.join('');
  el.style.display = 'block';
  const btn = document.getElementById('btnApplyComfortAdvice');
  if (btn) {
    btn.addEventListener('click', () => {
      const advice = getComfortAdvice(p);
      if (advice) {
        document.getElementById('sSpreadThreshold').value = advice.suggested;
        updateSpreadPressureHint();
        updatePressurePanel();
        renderComfortAdvice(p);
        showToast('✅', '已应用建议', `舒适量已设为 ${advice.suggested} 条，保存后生效。`, 3000);
      }
    });
  }
}

/* 手动/自动分散时，未来某天的每日排期上限
   - 经典间隔/严格容量：只看舒适量
   - 固定容量（用户显式设了每天 N 条）：尊重用户，min(舒适量, N)
   - 智能容量：按期均摊主导，允许抬到"为在目标日前完成所需"的量（可能高于默认舒适量），
     这样任务会被均匀摊开，而不是被舒适量锁死、最后一天集中爆发；
     当所需量明显高于舒适量时，由状态卡给出"一键后移目标/缩小范围"的温和选项，不强迫用户改设置。 */
function getSpreadDayCap(p, date) {
  const comfort = getComfortCap(p);
  if (p.reviewMode !== 'balanced') return comfort;
  if (p.dailyCapacity === 0) return comfort;
  if (p.dailyCapacity != null) return Math.max(1, Math.min(comfort, Math.round(p.dailyCapacity)));
  const cap = getDailyCapacity(p, date);
  if (cap <= 0) return comfort;
  // 今天：到期/逾期的是"已经该面对"的硬需求，只要在舒适量内就全部保留——
  //   不被"近期完成少"压出的低容量推走（否则今天莫名只剩几条、反而越堆越多，是死锁的根源）；
  //   背书为赶目标日所需若高于舒适量，今天也排得下。
  const isToday = !date || date === todayStr();
  if (isToday) return Math.max(comfort, cap);
  // 未来日子：作为摊派目标按个人节奏接收——
  //   错题走"前紧后松"目标（前期略多、为后期新增预留，后期回落，硬上限封顶不焦虑）；
  //   背书封闭总量、有硬截止，允许抬到按期所需的量，可行性由状态卡/风险横幅单独、温和提示。
  if (p.type === 'mistake') return getMistakeDayPlan(p, date).target;
  return Math.max(1, Math.min(50, cap));
}

/* 积压追赶信息：今天及以前到期、尚未掌握的内容量（backlog），
   以及"按约一周清完"所需的每日下限（need）、理论消化天数（catchDays）。
   背书单条耗时长，给 10 天；错题单题量小，给 7 天。供容量算法与设置页文案共用同一口径。 */
function getBacklogCatchUp(p) {
  if (!p || p.type === 'exercise') return { backlog: 0, catchDays: 0, need: 0, days: null };
  const backlog = getDueItems(p).length;
  const catchDays = p.type === 'recite' ? 10 : 7;
  const need = backlog > 0 ? Math.ceil(backlog / catchDays) : 0;
  return { backlog, catchDays, need, days: need > 0 ? catchDays : null };
}

/* 获取某一天的排期容量（均匀模式每天最多安排多少条）
   - 固定值：直接返回（0 = 严格按间隔，不自动错峰）
   - 智能：取三者的较大者——「节奏容量」「积压追赶」「按期均摊」，再用星期画像只上抬：
     · 节奏容量 = 近 28 天"新学+复习"动作速率的 EWMA（半衰期 14 天），中性反映真实节奏；
       计入新学动作是关键，否则会陷入"系统每天只排几条→只能做几条→容量永远停在低位"的死锁。
     · 冷启动（活跃日<3）给适中值（背书4、错题5），不再低到2/3；能学多的人很快被抬升，
       一条很重的人由真实速率回落。
     · 按期均摊 = 已学内容为在目标日前走完所需的每日下限，这是硬约束，绝不被舒适量锁死。
   智能模式不用舒适量硬封顶（否则按期所需一旦超过舒适量，任务会被压到最后一天集中爆发）；
   是否"超出舒适量、需要调整范围或目标日"由状态卡的可行性判断单独、温和地提示。 */
function getDailyCapacity(p, date) {
  if (p.dailyCapacity != null) return Math.max(0, Math.round(p.dailyCapacity));
  const today = todayStr();
  const counts = getActivityCountsByDate(p);

  // 28 天 EWMA 速率（自然日口径，含新学与复习）
  const HALF = 14, WIN = 28;
  let wSum = 0, cwSum = 0, activeDays = 0;
  for (let age = 0; age < WIN; age++) {
    const d = addDays(today, -age);
    const c = counts[d] || 0;
    const w = Math.pow(2, -age / HALF);
    wSum += w; cwSum += c * w;
    if (c > 0) activeDays++;
  }
  let rateCap;
  if (activeDays < 3) {
    // 冷启动：适中节奏，不做星期画像。
    rateCap = p.type === 'recite' ? 4 : 5;
  } else {
    // 先验速率按类型区分，随学习日数快速让位于个人真实节奏（能学多的人约 5 个学习日后就按其速率）。
    const K0 = p.type === 'recite' ? 5 : 8;
    const K = Math.max(0, K0 - Math.min(activeDays, K0));
    const PRIOR = p.type === 'recite' ? 4 : 6;
    const baseRate = (cwSum + PRIOR * K) / (wSum + K);
    rateCap = Math.max(1, Math.round(baseRate));
  }
  let cap = rateCap;

  // 积压追赶：今天及以前到期的未掌握内容，需要在约一周内清完的每日下限。
  if (p.type !== 'exercise') {
    const cu = getBacklogCatchUp(p);
    if (cu.need > cap) cap = cu.need;
  }

  // 按期均摊硬下限：已学内容必须在目标日前走完（不被低速率锁死后摊到最后）。
  if (p.type !== 'exercise') {
    const lv = getDeadlineLevelCap(p, date || today);
    if (lv.cap > cap) cap = lv.cap;
  }

  // 星期画像只用于"抬高"符合你习惯的日子（如周末更有空）
  if (date && activeDays >= 3) {
    const dowCap = getWeekdayAwareCap(p, date, counts, activeDays);
    if (dowCap > cap) cap = dowCap;
  }

  // 下限至少 1，绝对硬顶 50（防异常数据）；智能模式不以舒适量硬封顶。
  return Math.max(1, Math.min(50, Math.round(cap)));
}


/* 指定日期的容量：在全局 EWMA 速率基础上，用"该星期几"的历史速率做收缩估计
   （贝叶斯 shrinkage：样本越少越向全局靠拢），窗口 56 天、半衰期 28 天。 */
function getWeekdayAwareCap(p, date, counts, activeDays) {
  const dow = new Date(date + 'T00:00:00').getDay();
  const HALF = 28, WIN = 56;
  let gW = 0, gCW = 0;
  const agg = { w: 0, cw: 0, n: 0 };
  for (let age = 0; age < WIN; age++) {
    const d = addDays(todayStr(), -age);
    const c = counts[d] || 0;
    const w = Math.pow(2, -age / HALF);
    gW += w; gCW += c * w;
    if (new Date(d + 'T00:00:00').getDay() === dow) {
      agg.w += w; agg.cw += c * w;
      if (c > 0) agg.n++;
    }
  }
  if (agg.n < 2 || agg.w <= 0) {
    // 该星期几样本不足：回退到全局 28 天口径（冷启动已在外层处理）
    return Math.max(1, Math.round((gCW / gW) * 0.9));
  }
  const globalRate = gCW / gW;
  const dowRate = agg.cw / agg.w;
  const shrink = agg.n / (agg.n + 4); // n=2→0.33, n=4→0.5, n=8→0.67
  const rate = shrink * dowRate + (1 - shrink) * globalRate;
  return Math.max(1, Math.min(30, Math.round(rate * 0.9)));
}

/* 查询某一天已排的复习量（不含已掌握的）；可传负载表用于批量排期 */
function getReviewLoadOnDate(p, date, loadMap) {
  if (loadMap) return loadMap.get(date) || 0;
  return (p.items || []).filter(it =>
    !it.mastered && !it.manualMastered && it.nextReviewDate === date
  ).length;
}

/* 更新设置页的压力评估面板 */
function updatePressurePanel() {
  const p = store.projects[editingProjectId];
  if (!p || p.type !== 'mistake') return;
  const panel = $('#pressurePanel');
  if (!panel || panel.hidden) return;

  // 用舒适量（spreadThreshold）判断超量，和复习区横幅一致
  const thVal = parseInt($('#sSpreadThreshold').value, 10);
  const threshold = isNaN(thVal) ? 10 : Math.max(1, Math.min(50, thVal));
  // 排期容量（仅均匀模式下有意义，用于自动错峰）
  let scheduleCap;
  if ($('#sCapacityMode').value === 'fixed') {
    const v = parseInt($('#sCapacityFixed').value, 10);
    scheduleCap = isNaN(v) ? 0 : Math.max(0, Math.min(50, v));
  } else {
    scheduleCap = getDailyCapacity(p);
  }
  // 系统推荐：容量是已留过 10% 余量的保守估计，舒适量再取其 80%；积压重时不建议下调
  const capForRec = getDailyCapacity(p);
  const backlogHeavyRec = getBacklogCatchUp(p).backlog > threshold;
  let recTxt = '';
  if (capForRec > 0) {
    if (backlogHeavyRec) {
      recTxt = `当前有较多到期/逾期内容，系统正以你的舒适量满负荷安排（每天约 ${Math.min(capForRec, threshold)} 道、不会超出 ${threshold}）。保持现状即可稳步清完，若想更快可小幅上调舒适量，不建议下调。`;
    } else {
      const recThreshold = Math.max(3, Math.round(capForRec * 0.8));
      recTxt = `每日复习容量当前约 ${capForRec} 道，与舒适量取较小值决定实际每日排题量；建议舒适量设为约 ${recThreshold} 道，与容量相近。`;
    }
  }

  // 计算未来7天负载
  const today = todayStr();
  const days = [];
  let maxLoad = 0;
  let overDays = 0;
  let totalLoad = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, i);
    const load = getReviewLoadOnDate(p, d);
    days.push({ date: d, load, label: i === 0 ? '今' : (i === 1 ? '明' : `+${i}`) });
    if (load > maxLoad) maxLoad = load;
    if (load > threshold) overDays++;
    totalLoad += load;
  }

  // 渲染柱状图
  const barsHtml = days.map(d => {
    const h = maxLoad > 0 ? Math.max(6, (d.load / maxLoad) * 36) : 6;
    const over = d.load > threshold;
    const color = over ? '#e3a0a4' : (d.load > 0 ? '#2e6b4f' : '#e8dfd0');
    return `<div class="pressure-bar">
      <div class="pressure-bar-fill" style="height:${h}px;background:${color}" title="${d.date}: ${d.load}道"></div>
      <span class="pressure-bar-label">${d.label}</span>
    </div>`;
  }).join('');
  $('#pressureBars').innerHTML = barsHtml;

  // 压力等级（基于舒适量）
  const avg = totalLoad / 7;
  let level, levelCls, hint;
  if (overDays === 0 && avg <= threshold * 0.6) {
    level = '轻松'; levelCls = 'pressure-ok';
    hint = `舒适量 ${threshold} 道/天，未来7天无超量，平均每天 ${avg.toFixed(1)} 道。${recTxt}`;
  } else if (overDays === 0) {
    level = '适中'; levelCls = 'pressure-ok';
    hint = `舒适量 ${threshold} 道/天，未来7天无超量，平均每天 ${avg.toFixed(1)} 道。${recTxt}`;
  } else if (overDays <= 2) {
    level = '偏紧'; levelCls = 'pressure-high';
    hint = `舒适量 ${threshold} 道/天，未来7天有 ${overDays} 天超量（红色柱），平均每天 ${avg.toFixed(1)} 道。可用复习区横幅的「分散到未来」把部分内容摊开；如果你每天确实能多做，也可调高舒适量。${recTxt}`;
  } else {
    level = '过载'; levelCls = 'pressure-over';
    hint = `舒适量 ${threshold} 道/天，未来7天有 ${overDays} 天超量（红色柱），平均每天 ${avg.toFixed(1)} 道。建议先用「分散到未来」摊开逾期内容，再考虑调高每日容量；硬扛容易再次堆积。${recTxt}`;
  }
  if (scheduleCap === 0) {
    hint += ' 排期容量设为0：不自动错峰，严格按间隔提醒。';
  }
  const levelEl = $('#pressureLevel');
  levelEl.textContent = level;
  levelEl.className = 'pressure-tag ' + levelCls;
  $('#pressureHint').textContent = hint;
}

/* 更新分散阈值的实时提示 */
function updateSpreadPressureHint() {
  const p = store.projects[editingProjectId];
  if (!p) return;
  const hintEl = $('#spreadPressureHint');
  if (!hintEl || hintEl.closest('[hidden]')) return;

  const th = parseInt($('#sSpreadThreshold').value, 10);
  const threshold = isNaN(th) ? 5 : Math.max(1, Math.min(50, th));
  const due = getDueItems(p).length;
  const overdue = getOverdueItems(p).length;

  let msg;
  if (due > threshold) {
    msg = `⚠️ 今天有 ${due} 道待复习（含 ${overdue} 道逾期），已超过你设的舒适量 ${threshold}。保存后复习区会出现「分散到未来」按钮。`;
  } else if (due > 0) {
    msg = `✅ 今天有 ${due} 道待复习，在舒适量 ${threshold} 以内，可以从容完成。`;
  } else {
    msg = `今天暂无待复习。设为 ${threshold} 意味着超过 ${threshold} 道时会提示你分散。`;
  }

  // 系统推荐：积压重时以舒适量满负荷消化、不建议下调；平时按容量的 80% 建议
  const cap = getDailyCapacity(p);
  if (cap > 0) {
    if (due > threshold) {
      msg += ` 当前有较多到期/逾期内容，系统正按每天最多 ${Math.min(cap, threshold)} 道（不超过舒适量）安排，稳步清完即可；想更快可小幅上调舒适量，不建议下调。`;
    } else {
      const rec = Math.max(3, Math.round(cap * 0.8));
      msg += ` 每日复习容量当前约 ${cap} 道，与舒适量取较小值决定实际每日排题量；建议舒适量设为约 ${rec} 道，与容量相近。`;
    }
  }

  hintEl.textContent = msg;
}

/* 活动日集合（比"完成日"更宽：收录、复习、攻克、刷题打卡都算"今天学了"）。
   专用于连续打卡、启动鼓励、中断检测这类"有没有在学"的判断；
   产能与 ETA 仍按 getMetrics 的实际完成口径，两者不混用。 */
function getActivityDateSet(p) {
  const set = new Set();
  (p.items || []).forEach(it => {
    if (it.learnedDate) set.add(it.learnedDate);
    if (it.masteredDate) set.add(it.masteredDate);
    (it.reviews || []).forEach((r, i) => {
      if (r.date && i > 0) set.add(r.date); // i=0 是首次录入，已由 learnedDate 覆盖
    });
  });
  if (p.type === 'exercise') {
    (p.records || []).forEach(r => { if (r.date) set.add(r.date); });
  }
  return set;
}

/* 活动日总数 + 当前连续活动天数（今天学了从今天算，否则从昨天算，不因今天尚未学就清零） */
function getActivityStreak(p, t) {
  t = t || todayStr();
  const set = getActivityDateSet(p);
  let streak = 0;
  let cursor = set.has(t) ? t : addDays(t, -1);
  while (set.has(cursor)) { streak++; cursor = addDays(cursor, -1); }
  // 当前连续段最早那天距今天数（今天学了从 streak-1，否则从 streak）
  const curStartAge = set.has(t) ? Math.max(0, streak - 1) : streak;
  // 历史最长连续（只统计当前段之前的 60 天，避免把当前段算成"历史纪录"）
  let priorLongest = 0, run = 0;
  for (let age = 59; age > curStartAge; age--) {
    const d = addDays(t, -age);
    if (set.has(d)) { run++; priorLongest = Math.max(priorLongest, run); }
    else run = 0;
  }
  // 上一个活动日（不含今天），用于回归/中断判断
  let prev = null;
  set.forEach(d => { if (d < t && (!prev || d > prev)) prev = d; });
  return { activeDays: set.size, streak, priorLongest, prevDate: prev };
}

/* 摆烂检测：计算连续未复习天数（不含今天），返回 {days, lastReviewDate} */
function getLazyInfo(p) {
  const activeDates = getActivityDateSet(p);
  if (!activeDates.size) return { days: 0, lastReviewDate: null }; // 从未活跃，不触发摆烂提醒
  const today = todayStr();
  let last = null;
  activeDates.forEach(d => { if (!last || d > last) last = d; });
  if (!last) return { days: 0, lastReviewDate: null };
  const days = diffDays(last, today);
  return { days: Math.max(0, days), lastReviewDate: last };
}

/* 因材施教的中断提醒：按"中断天数梯度 × 项目类型"差异化
   轻度(3-4天)轻推+最小行动；中度(5-7天)自我关怀、强调捡起来比从零快；
   长期(8天+)降低重启门槛、必要时引导调目标，避免"干脆放弃"。绝不制造内疚。 */
function getLazyMessage(p, m, lazy) {
  const days = lazy.days;
  const u = unitName(p);
  const verb = p.type === 'exercise' ? '推进' : '复习';
  let head = `😴 你已经连续 ${days} 天没${verb}了`;
  if (lazy.lastReviewDate) head += `（上次${verb} ${fmtCN(lazy.lastReviewDate)}）`;
  head += '。';

  // 最小启动量：行为激活，先做一个"一定能完成"的小动作
  const micro = p.type === 'exercise'
    ? `今天先推进 1 ${u}，把节奏找回来就好。`
    : `今天只复习 1 条，记忆会很快接上。`;

  // 按模式的核心提醒
  let modeLine;
  if (p.type === 'mistake') {
    const overdue = getOverdueItems(p).length;
    modeLine = overdue > 0
      ? `目前有 ${overdue} 道逾期，不用一次清完，先从最久没复习的那条开始。`
      : '错题靠间隔滚动，停几天后它们会更早地回到队列，正好趁现在接上。';
  } else if (p.type === 'recite') {
    modeLine = '背诵间隔一拉长，之前的记忆会变模糊，今天复习一条就能把它重新激活。';
  } else {
    modeLine = '进度不会因为停几天就清零，今天往前推一点点，节奏就回来了。';
  }

  if (days <= 4) {
    return head + modeLine + micro;
  }
  if (days <= 7) {
    return head + '断几天很正常，不用有负罪感——之前学的都还在，捡起来比从零开始快得多。' + modeLine + micro;
  }
  // 长期：明确"不需要补回欠下的，只需今天重新开始"；目标不现实时引导调整
  const recal = (m && m.feasibility === 'impossible')
    ? '如果最近目标确实太满，看看状态卡的建议，把截止日或每日目标调到够得着，比硬扛更重要。'
    : '不用去补落下的量，把今天的目标定小一点，让"重新开始"足够容易。';
  return head + '停得久了，最容易想"干脆放弃"——但你不需要补回欠下的，只需今天重新迈出第一步。' + recal + micro;
}

/* 双向最佳适配找空位（v2）
   在 [baseDate-maxBack, baseDate+maxForward]（且不早于 minDate）窗口内：
   1) 优先选"负载/容量比 < 1"中相对最空的日子，并列取离 baseDate 最近、再并列取更早（记忆更安全）
   2) 窗口全满时，继续向后逐日扩展搜索（最多再找 14 天），优先把批量录入摊到更远的空位
   3) 扩展后仍全满，才在原窗口内选相对负载最低的日子（有界超量，保证不无限顺延）
   opts: { maxForward, maxBack=0, minDate=null, gap, loadMap=null, maxExtend=14 }
   容量为 0（严格模式）时直接返回 baseDate。 */
function findAvailableDate(p, baseDate, opts) {
  if (typeof opts === 'number') opts = { maxForward: opts }; // 兼容旧签名 (p, base, maxOffset)
  opts = opts || {};
  const maxForward = Math.max(0, opts.maxForward != null ? opts.maxForward : 1);
  const maxBack = Math.max(0, opts.maxBack || 0);
  const minDate = opts.minDate;
  const maxExtend = opts.maxExtend != null ? Math.max(0, opts.maxExtend) : 14;

  let start = addDays(baseDate, -maxBack);
  const end = addDays(baseDate, maxForward);
  if (minDate && start < minDate) start = minDate;

  const consider = (d, best) => {
    const cap = getDailyCapacity(p, d);
    if (cap <= 0) return { strict: true }; // 严格模式：不错峰
    const load = getReviewLoadOnDate(p, d, opts.loadMap);
    const ratio = load / cap;
    const offset = diffDays(baseDate, d); // 负=提前，正=顺延
    const absOff = Math.abs(offset);
    if (ratio < 1) {
      if (!best.found
        || ratio < best.found.ratio - 1e-9
        || (Math.abs(ratio - best.found.ratio) < 1e-9 && absOff < best.found.absOff)
        || (Math.abs(ratio - best.found.ratio) < 1e-9 && absOff === best.found.absOff && offset < best.found.offset)) {
        best.found = { d, ratio, absOff, offset };
      }
    }
    if (!best.fallback
      || ratio < best.fallback.ratio - 1e-9
      || (Math.abs(ratio - best.fallback.ratio) < 1e-9 && offset > best.fallback.offset)) {
      best.fallback = { d, ratio, offset };
    }
    return best;
  };

  const acc = { found: null, fallback: null };
  for (let d = start; ; d = addDays(d, 1)) {
    const r = consider(d, acc);
    if (r && r.strict) return baseDate;
    if (d >= end) break;
  }
  if (acc.found) return acc.found.d;

  // 窗口全满：向后扩展（默认14天；早期复习调用方会传更短的 maxExtend，保证首次复习不被推到太远）寻找真正的空位
  const outerEnd = addDays(end, maxExtend);
  for (let d = addDays(end, 1); d <= outerEnd; d = addDays(d, 1)) {
    const cap = getDailyCapacity(p, d);
    if (cap <= 0) break;
    const load = getReviewLoadOnDate(p, d, opts.loadMap);
    if (load < cap) return d;
  }
  // 扩展仍满：在原窗口内有界超量
  return (acc.fallback || { d: baseDate }).d;
}

/* 智能排期：根据模式计算下次复习日期
   - classic：严格按间隔
   - balanced：以间隔为基础，在容量约束下双向错峰；顺延窗口随间隔收窄（后期不再被推 +50%） */
function scheduleNextReview(p, item, baseDate, stage, gapOverride) {
  const intervals = getItemIntervals(item, p);
  const st = Math.min(stage != null ? stage : (item.stage || 0), intervals.length - 1);
  let gap = gapOverride || intervals[st] || intervals[0] || 1;
  // 提前复习过的条目，间隔缩短15%（主动提前复习说明需要多巩固）
  if (item.earlyReviewed) gap = Math.max(1, Math.round(gap * 0.85));

  // 背书本冲刺期（距考试不足一个完整复习周期）：
  // 1) 任何复习都不能被排到考试之后（否则模糊条目会因间隔×1.3 越拉越长，等于考前不再复习）；
  // 2) "模糊/忘记"的内容要在考前高频复现（2~3 天内再见），"记得"的也保证考前再见到至少一次。
  let sprintClamp = null;
  let sprintTail = false; // 冲刺最后 7 天：把复习均匀撒到剩余所有天，而非堆到目标日
  let sprintFinal = false; // 已完成"考前最后一遍"，不再排到目标日
  if (p.type === 'recite' && p.deadline) {
    const d2d = diffDays(baseDate, p.deadline);
    if (d2d >= 0 && d2d <= getReviewCycleDays(p)) {
      const lastQ = item.reviews && item.reviews.length ? item.reviews[item.reviews.length - 1].quality : null;
      const capGap = (d2d === 0) ? 1
        : (lastQ === 'good') ? Math.max(1, Math.min(d2d, Math.round(d2d * 0.6)))
        : Math.max(1, Math.min(3, d2d));
      gap = Math.min(gap, capGap);
      sprintClamp = d2d; // 错峰扩展也不得越过目标日
      if (d2d <= 7) {
        sprintTail = true;
        // 非"记得"的内容（模糊/忘记），若按间隔下次再见已落到目标日当天或之后，
        // 这次就作为考前最后一遍（再排只会在目标日堆积），记录并把下次放在目标日之后。
        if (lastQ !== 'good' && addDays(baseDate, gap) >= p.deadline) sprintFinal = true;
      }
    }
  }
  if (sprintFinal) {
    item.finalReviewDate = baseDate;
    return addDays(p.deadline, 1);
  }

  const base = addDays(baseDate, gap);
  if (p.reviewMode === 'balanced' && p.type !== 'exercise') {
    let maxForward, maxBack, maxExtend;
    if (sprintTail) {
      // 冲刺最后 7 天：在 [明天, 目标日] 全范围内找负载最低的一天，把本条均匀撒开，
      // 避免 fuzzy/forgot 条目每次都排到"今天+1~3天"、最后在目标日集中爆发。
      maxBack = 1; // start 被 minDate 抬到"明天"
      maxForward = Math.max(0, sprintClamp - gap); // end ≈ 目标日
      maxExtend = 0;
    } else {
      // 错题本与背书本在均匀模式下都做即时错峰（背书单条内容可多可少，错峰窗口仍按当前间隔自适应，避免某天扎堆）
      maxForward = Math.max(1, Math.round(gap * 0.25));
      maxBack = Math.min(2, Math.floor(gap * 0.25));
      // 早期复习（间隔≤2天，尤其是刚学的首次复习）是记忆最关键的窗口：即使当天批量录入，
      // 也只允许在近几天内错峰，绝不把"本应明天复习"的内容一路推到十几天后（那会拖垮整体毕业节奏）。
      maxExtend = gap <= 2 ? 3 : 14;
      if (sprintClamp != null) maxExtend = Math.min(maxExtend, sprintClamp);
    }
    let d = findAvailableDate(p, base, {
      maxForward, maxBack, minDate: addDays(baseDate, 1), gap, maxExtend
    });
    // 冲刺期硬上限：错峰后仍不得越过目标日
    if (p.deadline && d > p.deadline) d = p.deadline;
    return d;
  }
  if (p.deadline && base > p.deadline) return p.deadline;
  return base;
}

/* 背书本冲刺重排：进入冲刺期（距目标日不足一个完整复习周期）后，做一次"全窗口负载均衡"。
   处理两类会造成考前扎堆/沉睡的内容：
   ① 下次复习为空或已被排到目标日之后的条目（尤其全 fuzzy 用户，间隔×1.3 容易越界沉睡）；
   ② 未来某天（尤其目标日当天）排期超过当日容量的溢出条目。
   把它们按"薄弱者优先、顺序填入最早未饱和日"的方式，均匀分摊到 [明天, 目标日]，
   每天不超过当日容量，避免最后一天集中爆发。对 classic / balanced 都生效。
   今天的条目不动（今天该复习的今天做）；只改 nextReviewDate，不删数据、不强制毕业。 */
function rebalanceForSprint(p) {
  if (!p || p.type !== 'recite' || !p.deadline) return 0;
  const today = todayStr();
  const d2d = diffDays(today, p.deadline);
  if (d2d < 0 || d2d > getReviewCycleDays(p)) return 0;

  const live = (p.items || []).filter(it => !it.mastered && !it.manualMastered && !it.finalReviewDate);
  const capOf = d => (p.reviewMode === 'balanced') ? getSpreadDayCap(p, d) : getComfortCap(p);

  // 负载表
  const loadMap = new Map();
  live.forEach(it => {
    if (it.nextReviewDate) loadMap.set(it.nextReviewDate, (loadMap.get(it.nextReviewDate) || 0) + 1);
  });

  // 候选①：无日期 / 越界到目标日之后
  const toMove = live.filter(it => !it.nextReviewDate || it.nextReviewDate > p.deadline);
  const moveIds = new Set(toMove.map(it => it.id));

  // 候选②：未来某天（不含今天）超容量的溢出
  const buckets = {};
  live.forEach(it => {
    const d = it.nextReviewDate;
    if (d && d > today && d <= p.deadline) (buckets[d] = buckets[d] || []).push(it);
  });
  Object.keys(buckets).sort().forEach(d => {
    const arr = buckets[d].slice().sort(compareItemPriority); // 优先级高者在前（更该保留在近期）
    const cap = capOf(d);
    if (arr.length > cap) {
      arr.slice(cap).forEach(it => {
        if (!moveIds.has(it.id)) { moveIds.add(it.id); toMove.push(it); }
      });
    }
  });
  if (!toMove.length) return 0;

  // 从负载表移除待移动条目的占位
  toMove.forEach(it => {
    const d = it.nextReviewDate;
    if (d && loadMap.has(d)) loadMap.set(d, loadMap.get(d) - 1);
  });

  // 未来日期列表（今天不动）
  const dayList = [];
  for (let d = addDays(today, 1); d <= p.deadline; d = addDays(d, 1)) dayList.push(d);

  // 薄弱者优先，顺序填入最早未饱和日（全满则选相对最空日，均摊而非堆到目标日）
  toMove.sort(compareItemPriority);
  let moved = 0;
  toMove.forEach(it => {
    let bestD = null;
    for (const d of dayList) {
      if ((loadMap.get(d) || 0) < capOf(d)) { bestD = d; break; } // 最早未饱和
    }
    if (!bestD) {
      let bestRatio = Infinity;
      for (const d of dayList) {
        const ratio = (loadMap.get(d) || 0) / Math.max(1, capOf(d));
        if (ratio < bestRatio - 1e-9) { bestRatio = ratio; bestD = d; }
      }
    }
    if (!bestD) bestD = p.deadline;
    it.nextReviewDate = bestD;
    it.spreadCount = (it.spreadCount || 0) + 1;
    it.lastSpreadDate = today;
    loadMap.set(bestD, (loadMap.get(bestD) || 0) + 1);
    moved++;
  });
  return moved;
}

/* 启动自动均衡：均匀模式下，今天待复习超过当日容量时，
   自动把优先级最低的超额条目摊到未来若干天。
   v10 修正：不再"每天只跑一次"（旧逻辑用 lastAutoBalanceDate 硬幂等，会导致
   当天首次均衡之后又新增到期——批量录入、补录、复习"又错了"等——再也无法被摊派，
   今天越堆越多）。改为"按超额触发、收敛即停"：
   - 今天到期量 ≤ 当日容量：天然收敛，不动作、不写盘；
   - 超出容量：只摊走真正超出的部分，摊完 today 回到容量内即停；
   - 防饥饿（逾期太久，canBeSpread=false）的条目强制留今天，宁可今天多做也不继续后推；
   - spreadItems 内每条最多被摊 3 次（canBeSpread），不会无限推、也不会与用户复习操作冲突。 */
/* ===== 错题"前紧后松"排期 =====
   错题动态增长、后期可能集中收录。系统在前期主动多排、提前消化，给后期留空间；
   后期每日量平滑回落、设硬上限，不堆量、不制造焦虑。 */

// 历史收录速率（条/自然日；近28天为主，数据少时用全周期平均）
function getMistakeCollectRate(p) {
  const today = todayStr();
  const learned = (p.items || []).map(it => it.learnedDate).filter(Boolean).sort();
  if (!learned.length) return 0;
  const recent = learned.filter(d => d >= addDays(today, -27));
  if (recent.length >= 2) return recent.length / 28;
  const span = Math.max(1, diffDays(learned[0], today) + 1);
  return learned.length / span;
}

// 某天的"前紧后松"目标量 / 硬上限 / 是否吃紧
function getMistakeDayPlan(p, date) {
  const d = date || todayStr();
  const dl = getDeadlineLevelCap(p, d);
  const base = dl.cap || 0;                    // 已学内容按期走完所需（硬下限）
  let addon = 0;
  if (p.deadline) {
    const daysLeft = diffDays(d, p.deadline) + 1;
    if (daysLeft > 0) {
      const rate = getMistakeCollectRate(p);
      const predictedNew = Math.max(0, rate * Math.max(0, daysLeft - 1)); // 今天之后预计新增
      const studyDays = Math.max(1, daysLeft * getStudyDayRatio(p));
      addon = predictedNew / studyDays;       // 为未来新题保底复习，提前均摊（前期多、后期衰减）
    }
  }
  const comfort = getComfortCap(p);
  const hardMax = Math.min(20, Math.max(12, Math.round(comfort * 1.5)));
  let raw = base + addon;
  const target = Math.max(1, Math.min(hardMax, Math.ceil(raw)));
  return { target, raw, base, addon, hardMax, risk: raw > hardMax };
}

// 全局可行性：预测总复习工作量 vs 剩余时间的舒适/最大容量，提前判断是否会完不成
function getMistakeFeasibility(p) {
  if (!p || p.type !== 'mistake' || !p.deadline) return { level: 'ok' };
  const today = todayStr();
  if (p.deadline <= today) return { level: 'ok' };
  const daysLeft = diffDays(today, p.deadline) + 1;
  if (daysLeft > 120) return { level: 'ok' };
  const studyDays = Math.max(1, daysLeft * getStudyDayRatio(p));
  const iv = getIntervals(p), N = iv.length;
  let remainRounds = 0;
  (p.items || []).forEach(it => {
    if (it.mastered || it.manualMastered || it.finalReviewDate || !it.learnedDate) return;
    remainRounds += Math.max(1, N - (it.stage || 0));
  });
  const predictedNew = Math.max(0, getMistakeCollectRate(p) * Math.max(0, daysLeft - 1)); // 保底1轮
  const work = remainRounds + predictedNew;
  const comfort = getComfortCap(p);
  const hardMax = Math.min(20, Math.max(12, Math.round(comfort * 1.5)));
  let level = 'ok';
  if (work > studyDays * hardMax) level = 'risk';
  else if (work > studyDays * comfort) level = 'tight';
  return { level, work: Math.round(work), daysLeft, comfort, hardMax };
}

// 主动提前复习：当天第一次进入错题本时，若今日到期少于前期目标，把"近期将到期、薄弱优先"的题提前到今天。
// 一天只检查一次（无论是否拉题），避免用户做完一题后被反复补拉，观感不好。
function pullForwardIfNeeded(p) {
  if (!p || p.type !== 'mistake' || !p.deadline) return 0;
  const today = todayStr();
  if (p.todayMetDate === today) return 0; // 今天已达标，不再加题
  if (p.lastPullForwardDate === today || p.deadline < today) return 0; // 今天已检查过，不再重复
  // 仅"均匀分布"模式主动提前；经典间隔是用户主动选择的严格节奏，不自动加量
  if (p.reviewMode !== 'balanced' || p.dailyCapacity === 0) return 0;

  // 无论本次是否真的拉题，都记下今天已检查过（关键：避免做题后反复补拉）
  p.lastPullForwardDate = today;
  p.updatedAt = Date.now();

  const plan = getMistakeDayPlan(p, today);
  let want = plan.target - getDueItems(p).length;
  if (want <= 0) return 0; // 今天够目标，不加

  const horizon = addDays(today, 14);
  let cands = (p.items || []).filter(it =>
    !it.mastered && !it.manualMastered && it.nextReviewDate &&
    it.nextReviewDate > today && it.nextReviewDate <= horizon);
  cands.sort((a, b) => {
    const sa = getItemScore(a) ?? 0.5, sb = getItemScore(b) ?? 0.5;
    if (sa !== sb) return sa - sb;
    if (a.nextReviewDate !== b.nextReviewDate) return a.nextReviewDate < b.nextReviewDate ? -1 : 1;
    return (a.stage || 0) - (b.stage || 0);
  });
  let pulled = 0;
  for (const it of cands) { if (pulled >= want) break; it.nextReviewDate = today; it.earlyReviewed = true; pulled++; }
  return pulled;
}

// 安全网：每条错题截止日前至少重做一遍（stage=0 还没重做的，下次复习不得晚于截止日）
function ensureAtLeastOneReview(p) {
  if (!p || p.type !== 'mistake' || !p.deadline || p.deadline < todayStr()) return 0;
  const today = todayStr();
  let changed = 0;
  (p.items || []).forEach(it => {
    if (it.mastered || it.manualMastered || it.finalReviewDate || (it.stage || 0) >= 1) return;
    if (!it.nextReviewDate) { it.nextReviewDate = today < p.deadline ? addDays(today, 1) : p.deadline; changed++; }
    else if (it.nextReviewDate > p.deadline) { it.nextReviewDate = p.deadline; changed++; }
  });
  if (changed > 0) p.updatedAt = Date.now();
  return changed;
}

// 今日达标收尾：已做够当天目标后，把"误提前、今天没做"的多余题顺延到明天，并记录今日已达标
function settleToday(p) {
  if (!p || p.type !== 'mistake' || !p.deadline) return 0;
  const today = todayStr();
  const target = getMistakeDayPlan(p, today).target;
  const reviewed = getTodayReviewedCount(p);
  if (reviewed < target) return 0;
  let changed = 0;
  getDueItems(p).forEach(it => {
    const did = (it.reviews || []).filter(r => r.date === today).length > (it.learnedDate === today ? 1 : 0);
    if (it.earlyReviewed && !did) { it.nextReviewDate = addDays(today, 1); changed++; }
  });
  if (getDueItems(p).length === 0 && p.todayMetDate !== today) { p.todayMetDate = today; changed++; }
  if (changed > 0) p.updatedAt = Date.now();
  return changed;
}

function autoBalanceIfNeeded(p) {
  if (!p || p.type === 'exercise') return 0;
  if (p.reviewMode !== 'balanced') return 0;
  if (p.dailyCapacity === 0) return 0;
  const today = todayStr();
  // 错题：与"前紧后松"共用同一个今日目标，避免"均衡摊走、前紧又拉回"互相打架；
  // 背书无提前机制，仍用分散容量。
  const cap = p.type === 'mistake' ? getMistakeDayPlan(p, today).target : getSpreadDayCap(p, today);
  const due = getDueItems(p).slice().sort(compareItemPriority);
  if (due.length <= cap) {
    p.lastAutoBalanceDate = today;
    return 0;
  }
  // 先把锁死条目（canBeSpread=false，逾期太久不能再推）强制归入 keep 留今天，
  // 不进 excess；否则切到 excess 后又被 spreadItems 强制放回今天，造成今日实际负载虚高、重复处理
  const blocked = due.filter(it => !canBeSpread(it, p));
  const spreadable = due.filter(it => canBeSpread(it, p));
  const keepN = Math.max(0, cap - blocked.length);
  const keep = blocked.concat(spreadable.slice(0, keepN));
  const excess = spreadable.slice(keepN);
  keep.forEach(it => { it.nextReviewDate = today; });
  if (!excess.length) {
    // 超额条目全部因"逾期太久不能再推"而锁死，今日负载无法再后摊（记忆安全优先）。
    // 标记今天已处理，交由状态卡如实提示"优先做逾期"，不做无效写盘。
    p.lastAutoBalanceDate = today;
    return 0;
  }
  // 摊派窗口按"积压量 / 每日容量"自适应（至少 3 天、至多 3 周）：
  // 积压少时维持原来的 3 天（记忆更安全）；积压多时拉长，避免超额内容全挤在未来 3 天形成新的爆量日
  const tomorrowCap = getSpreadDayCap(p, addDays(today, 1));
  const spreadDays = Math.max(3, Math.min(21, Math.ceil(excess.length / Math.max(1, tomorrowCap))));
  p.lastAutoBalanceDate = today;
  return spreadItems(p, excess, spreadDays);
}

/* 防饥饿：判断这条是否还能被分散（注意：调用方需保证能拿到项目配置） */
function canBeSpread(it, p) {
  if (it.spreadCount >= 3) return false; // 被分散过3次，不能再推
  if (!it.nextReviewDate) return false;
  const intervals = p ? getItemIntervals(it, p) : (it.customIntervals || DEFAULT_INTERVALS);
  const stage = it.stage || 0;
  const maxGap = (intervals[Math.min(stage, intervals.length - 1)] || 1) * 2;
  const overdue = diffDays(it.nextReviewDate, todayStr());
  if (overdue > maxGap) return false; // 超过最大间隔2倍，不能再推
  return true;
}

/* ============ 复习评价 ============ */
let pendingConfirmItem = null;
let pendingConfirmProject = null;
let pendingConfirmFromSkip = false; // 标记确认弹窗是否来自"已熟知"按钮
let __autoBalanceToastShown = {}; // 自动均衡 toast 当日去重（key: projectId:date）

function getItemIntervals(item, p) {
  return (item.customIntervals && item.customIntervals.length) ? item.customIntervals : getIntervals(p);
}

/* 统一三档复习质量模型（错题本 / 背书本共用，Anki Again/Hard/Good 思路）
   - good（做对/记得）：进入下一轮，间隔 = 下一轮标准间隔
   - fuzzy（看答案/模糊）：也进轮，但新间隔 ≤ 当前间隔×1.3，薄弱内容不会被快速放到长间隔
   - forgot（做错/忘记）：停留本轮、间隔回到首轮；连续 rollbackAfter 次 forgot 再退一轮
   纯函数：传入当前 stage / wrongStreak，返回 { stage, gap, wrongStreak }。 */
function transitionReview(intervals, s0, wrongStreak0, quality, isFirstLearn, rollbackAfter) {
  rollbackAfter = rollbackAfter || 2;
  const last = intervals.length - 1;
  const firstGap = intervals[0] || 1;
  if (isFirstLearn) {
    let gap = firstGap;
    // 首次学习三档按首间隔比例缩放，避免默认 firstGap=1 时 good/fuzzy/forgot 都排 1 天无区分度；
    // fuzzy≈0.5×、forgot≈0.3×（天粒度最小 1 天，间隔调大后梯度自然拉开）
    if (quality === 'fuzzy') gap = Math.max(1, Math.round(firstGap * 0.5));
    else if (quality === 'forgot') gap = Math.max(1, Math.round(firstGap * 0.3));
    return { stage: 0, gap, wrongStreak: quality === 'forgot' ? 1 : 0 };
  }
  const curGap = intervals[Math.min(s0, last)] || firstGap;
  if (quality === 'good') {
    const stage = Math.min(s0 + 1, last);
    return { stage, gap: intervals[stage] || firstGap, wrongStreak: 0 };
  }
  if (quality === 'fuzzy') {
    if (s0 >= last) {
      // 已在最后一轮仍模糊：不毕业，间隔小幅拉长
      return { stage: last, gap: Math.max(curGap + 1, Math.round(curGap * 1.3)), wrongStreak: 0 };
    }
    const stage = s0 + 1;
    const nextGap = intervals[stage] || curGap;
    const gap = Math.min(nextGap, Math.max(curGap + 1, Math.round(curGap * 1.3)));
    return { stage, gap, wrongStreak: 0 };
  }
  // forgot
  const wrongStreak = wrongStreak0 + 1;
  const stage = wrongStreak >= rollbackAfter ? Math.max(0, s0 - 1) : s0;
  return { stage, gap: firstGap, wrongStreak };
}

/* 根据 reviews 历史重算 stage / mastered / masteredDate（修改历史评价后调用） */
function recomputeItemMastery(item, p) {
  const reviews = item.reviews || [];
  const wasEarlyReviewed = !!item.earlyReviewed; // 先保存，重置后 scheduleNextReview 要用
  if (!reviews.length) {
    item.stage = 0;
    item.mastered = false;
    item.masteredDate = null;
    item.spreadCount = 0;
    item.earlyReviewed = false;
    clearRetention(item);
    return;
  }
  const intervals = getItemIntervals(item, p);
  // 回放首次学习：第一条 review 的 quality 决定首个 gap（good/fuzzy/forgot 按比例缩放首间隔），
  // 否则重算后 lastGap 永远退回首间隔，丢失首次学习质量带来的排期差异
  const firstT = transitionReview(intervals, 0, 0, reviews[0].quality, true, p.lapseRollback);
  let stage = firstT.stage;
  let wrongStreak = firstT.wrongStreak;
  let lastGap = firstT.gap;
  // 统一三档模型回放：good 进轮；fuzzy 进轮但间隔受限；forgot 停留（连续2次退一轮）；错题/背书一致
  for (let i = 1; i < reviews.length; i++) {
    const t = transitionReview(intervals, stage, wrongStreak, reviews[i].quality, false, p.lapseRollback);
    stage = t.stage;
    wrongStreak = t.wrongStreak;
    lastGap = t.gap;
  }
  item.stage = stage;
  item.wrongStreak = wrongStreak;
  item.spreadCount = 0; // 重算后清零分散次数
  item.earlyReviewed = false;
  // 判断是否掌握：最后一轮 + 满3次 + 最近3次全对（最后一次必须是 good）才直接标记（后台重算不弹窗）
  const isLastRound = stage >= intervals.length - 1;
  const recent = reviews.slice(-3);
  const allGood = recent.length >= 1 && recent.every(r => r.quality === 'good');
  const lastQuality = reviews[reviews.length - 1].quality;
  if (isLastRound && lastQuality === 'good' && allGood && reviews.length >= 3) {
    item.mastered = true;
    item.masteredDate = reviews[reviews.length - 1].date;
    item.nextReviewDate = null;
    // 进入保持期（手动熟知的条目不安排）
    if (!item.manualMastered) scheduleRetention(item, item.masteredDate, item.retentionPass || 0, p);
    else clearRetention(item);
  } else {
    item.mastered = false;
    item.masteredDate = null;
    clearRetention(item);
    // 提前复习过的条目，临时设回 earlyReviewed 让 scheduleNextReview 能缩短间隔
    if (wasEarlyReviewed) item.earlyReviewed = true;
    item.nextReviewDate = scheduleNextReview(p, item, reviews[reviews.length - 1].date, stage, lastGap);
    item.earlyReviewed = false; // 算完再重置
  }
}

function applyReview(item, quality, p, note) {
  const intervals = getItemIntervals(item, p);
  const today = todayStr();

  item.reviews = item.reviews || [];
  const isFirstLearn = item.reviews.length === 0;

  // 统一三档质量模型（错题/背书一致）：good 进轮；fuzzy 进轮但间隔受限；forgot 停留、连续2次退一轮
  const tr = transitionReview(intervals, item.stage || 0, item.wrongStreak || 0, quality, isFirstLearn, p.lapseRollback);
  const newStage = tr.stage;
  item.wrongStreak = tr.wrongStreak;

  const review = { date: today, quality, stage: isFirstLearn ? 0 : newStage };
  if (note && note.trim()) review.note = note.trim().slice(0, 60);
  if (note !== undefined) item.note = (note || '').trim().slice(0, 60);
  item.reviews.push(review);
  item.stage = newStage;
  item.spreadCount = 0; // 正常复习后，分散次数清零
  const wasEarlyReviewed = !!item.earlyReviewed; // 先保存，重置后 scheduleNextReview 要用
  item.earlyReviewed = false;
  delete item.originalNextReviewDate; // 已复习，清掉提前复习的追踪字段
  p.updatedAt = Date.now();
  saveStore(); // 立即存盘，避免弹出确认弹窗时刷新导致本次评价丢失

  if (isFirstLearn) {
    item.mastered = false;
    item.masteredDate = null;
    // 首次学习也走统一排期（均匀模式下自动错峰；新录入不计入当天任务量）
    if (wasEarlyReviewed) item.earlyReviewed = true;
    item.nextReviewDate = scheduleNextReview(p, item, today, 0, tr.gap);
    item.earlyReviewed = false;
    p.updatedAt = Date.now();
    return;
  }

  // 毕业逻辑：只有 good 走到最后一轮才考虑毕业（fuzzy/forgot 永不触发毕业）
  // - 最后一轮 + 复习≥3次 + 最近3次全对 → 直接毕业（不弹窗）
  // - 最后一轮 good 但不满足上述条件 → 弹确认掌握弹窗
  // - 其他情况 → 按三档模型正常排期，不弹窗
  const recent = item.reviews.slice(-3);
  const allGood = recent.length >= 1 && recent.every(r => r.quality === 'good');
  const tooFew = item.reviews.length < 3;
  const isLastRound = newStage >= intervals.length - 1;

  if (quality === 'good' && isLastRound) {
    if (allGood && !tooFew) {
      // 最后一轮 + 满3次 + 最近3次全对 → 直接毕业，进入保持期
      item.mastered = true;
      item.masteredDate = today;
      item.nextReviewDate = null;
      scheduleRetention(item, today, 0, p);
    } else {
      // 最后一轮但不满足直接毕业条件 → 弹窗确认
      // 弹窗前先落一个默认的下次复习日期（最长间隔），避免用户杀进程/刷新后 stage 已推进但 nextReviewDate 还是旧值的不一致状态
      const lastGap = intervals[intervals.length - 1] || 30;
      item.mastered = false;
      item.masteredDate = null;
      item.nextReviewDate = scheduleNextReview(p, item, today, newStage, lastGap);
      p.updatedAt = Date.now();
      saveStore();
      pendingConfirmItem = item;
      pendingConfirmProject = p;
      pendingConfirmFromSkip = false;
      const reason = tooFew ? 'few' : 'notAllGood';
      showConfirmMaster(item, p, recent, reason);
      return;
    }
  } else {
    // 未到最后一轮，或 fuzzy/forgot → 不掌握，按三档模型安排下次复习
    item.mastered = false;
    item.masteredDate = null;
    clearRetention(item);
    if (wasEarlyReviewed) item.earlyReviewed = true;
    item.nextReviewDate = scheduleNextReview(p, item, today, newStage, tr.gap);
    item.earlyReviewed = false;
  }
  p.updatedAt = Date.now();
}

function showConfirmMaster(item, p, recentReviews, reason) {
  const mask = $('#confirmMasterMask');
  const text = $('#confirmMasterText');
  const opts = $('#confirmMasterOptions');
  $('#skipConfirmMask').hidden = true;

  const qLabels = p.type === 'mistake'
    ? { good: '做对了', fuzzy: '看答案', forgot: '又错了' }
    : { good: '记得', fuzzy: '模糊', forgot: '忘记' };
  const evalSequence = recentReviews.map(r => qLabels[r.quality] || r.quality).join(' → ');
  const badReviews = recentReviews.filter(r => r.quality !== 'good');
  const badDesc = badReviews.map(r => qLabels[r.quality] || r.quality).join('、');

  // 根据触发原因显示不同建议文案
  // pendingConfirmFromSkip 为 true 表示用户主动点「已熟知」，不一定是最后一轮
  const isNaturalGraduation = !pendingConfirmFromSkip;
  let suggestText = '';
  if (reason === 'few') {
    if (isNaturalGraduation) {
      suggestText = `这条已经走到<strong>最后一轮</strong>，即将毕业～但目前只复习了 <strong>${recentReviews.length}</strong> 次，记得还不够牢，建议再巩固几轮。`;
    } else {
      suggestText = `目前只复习了 <strong>${recentReviews.length}</strong> 次，记得还不够牢，建议再巩固几轮。`;
    }
  } else if (reason === 'notAllGood') {
    if (isNaturalGraduation) {
      suggestText = `这条已经走到<strong>最后一轮</strong>，但最近有「${badDesc}」的情况，还不够稳定。确认已经掌握了吗？还是再复习几轮？`;
    } else {
      suggestText = `最近有「${badDesc}」的情况，还不够稳定，建议再复习几轮。`;
    }
  } else {
    if (isNaturalGraduation) {
      suggestText = `这条已经走到<strong>最后一轮</strong>，即将毕业！最近 <strong>${recentReviews.length}</strong> 次都答对了，确认已经真正掌握了吗？`;
    } else {
      suggestText = `最近 <strong>${recentReviews.length}</strong> 次都答对了，确认已经真正掌握了吗？`;
    }
  }

  text.innerHTML = `
    <div class="cm-item-name">「${esc(item.content)}」</div>
    <div class="cm-eval">最近 ${recentReviews.length} 次评价：<strong>${evalSequence}</strong></div>
    <div class="cm-suggest">${suggestText}</div>
  `;

  opts.innerHTML = '';

  // 选项1：确认已掌握/已攻克（主色调高亮）
  const masteredWord = p.type === 'mistake' ? '攻克' : '掌握';
  const opt1 = document.createElement('button');
  opt1.className = 'cm-opt cm-opt-primary';
  opt1.innerHTML = `<span class="cm-opt-icon">✅</span><span class="cm-opt-main"><span class="cm-opt-title">确认已${masteredWord}</span><span class="cm-opt-desc">不再复习这条内容</span></span>`;
  opt1.addEventListener('click', () => { mask.hidden = true; confirmMasterItem(true); });
  opts.appendChild(opt1);

  // 选项2：重新开始
  const opt2 = document.createElement('button');
  opt2.className = 'cm-opt';
  opt2.innerHTML = `<span class="cm-opt-icon">🔄</span><span class="cm-opt-main"><span class="cm-opt-title">重新开始复习</span><span class="cm-opt-desc">清空记录，从第1轮重新复习</span></span>`;
  opt2.addEventListener('click', () => { mask.hidden = true; confirmMasterItem(false, 'restart'); });
  opts.appendChild(opt2);

  // 选项3：自定义间隔（可展开）
  // 用 div role=button 而非 button，避免 button 内嵌套 input/button 违反 HTML 规范
  const opt3 = document.createElement('div');
  opt3.className = 'cm-opt';
  opt3.setAttribute('role', 'button');
  opt3.tabIndex = 0;
  const curIntervals = getItemIntervals(item, p);
  opt3.innerHTML = `
    <span class="cm-opt-icon">⚙️</span>
    <span class="cm-opt-main">
      <span class="cm-opt-title">自定义复习间隔</span>
      <span class="cm-opt-desc">只影响这条内容，有几个间隔就复习几轮</span>
      <div class="cm-custom-panel">
        <input type="text" id="customIntervals" value="${curIntervals.join(', ')}" placeholder="例如：1, 2, 4, 7, 15, 30">
        <div class="cm-preview" id="customIntervalPreview"></div>
        <button class="primary" id="btnApplyCustom" style="padding:7px 16px;font-size:13px">应用此间隔</button>
      </div>
    </span>`;
  opt3.addEventListener('click', (e) => {
    // 点击选项卡片本身时展开/收起，点击输入框和按钮时不触发
    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') {
      opt3.classList.toggle('expanded');
    }
  });
  opts.appendChild(opt3);

  // 选项4：暂不处理
  const opt4 = document.createElement('button');
  opt4.className = 'cm-opt';
  opt4.innerHTML = `<span class="cm-opt-icon">⏸️</span><span class="cm-opt-main"><span class="cm-opt-title">暂不处理</span><span class="cm-opt-desc">按最长一档间隔安排下次复习</span></span>`;
  opt4.addEventListener('click', () => { mask.hidden = true; closeConfirmMaster(); });
  opts.appendChild(opt4);

  // 自定义间隔的实时预览和应用
  setTimeout(() => {
    const input = $('#customIntervals');
    const preview = $('#customIntervalPreview');
    if (!input) return;
    const updatePreview = () => {
      const str = input.value.trim();
      const intervals = str.split(/[,，\s]+/).map(s => parseInt(s, 10)).filter(n => !isNaN(n) && n > 0);
      if (!intervals.length) { preview.textContent = '请填写有效的间隔天数'; return; }
      preview.innerHTML = `共 <strong>${intervals.length}</strong> 轮：` +
        intervals.map((d, i) => `第${i+1}轮=${d}天`).join(' → ');
    };
    input.addEventListener('input', updatePreview);
    input.addEventListener('click', e => e.stopPropagation());
    updatePreview();

    const btn = $('#btnApplyCustom');
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const str = input.value.trim();
        const intervals = str.split(/[,，\s]+/).map(s => parseInt(s, 10)).filter(n => !isNaN(n) && n > 0);
        if (!intervals.length) { alert('请填写有效的间隔天数'); return; }
        mask.hidden = true;
        confirmMasterItem(false, 'custom', intervals);
      });
    }
  }, 0);

  mask.hidden = false;
  modalTop(mask);
}

function confirmMasterItem(confirm, mode, customIntervals) {
  const item = pendingConfirmItem;
  const p = pendingConfirmProject;
  if (!item || !p) return;
  unlockBodyScroll(); // 打开 confirmMasterMask 时 modalTop 同步 lockBodyScroll，此处必须解锁（opt1确认/opt2重新开始/自定义间隔三条路径都走这里）
  pendingConfirmItem = null;
  pendingConfirmProject = null;
  const fromSkip = pendingConfirmFromSkip;
  pendingConfirmFromSkip = false;

  if (confirm) {
    if (fromSkip) {
      item.manualMastered = true; // 来自"已熟知"按钮，标记为已熟知（不安排保持复习）
      clearRetention(item);
    } else {
      item.mastered = true; // 来自复习评价，标记为已掌握，进入保持期
      scheduleRetention(item, todayStr(), 0, p);
    }
    item.masteredDate = todayStr();
    item.nextReviewDate = null;
  } else if (mode === 'restart') {
    item.stage = 0;
    item.reviews = [];
    item.wrongStreak = 0;
    item.mastered = false;
    item.masteredDate = null;
    item.customIntervals = null;
    clearRetention(item);
    const intervals = getIntervals(p);
    item.nextReviewDate = scheduleNextReview(p, item, todayStr(), 0, intervals[0]);
  } else if (mode === 'custom' && customIntervals && customIntervals.length) {
    item.stage = 0;
    item.reviews = [];
    item.wrongStreak = 0;
    item.mastered = false;
    item.masteredDate = null;
    item.customIntervals = customIntervals;
    clearRetention(item);
    item.nextReviewDate = scheduleNextReview(p, item, todayStr(), 0, customIntervals[0]);
  }
  p.updatedAt = Date.now();
  saveStore();
  render();
}

function closeConfirmMaster() {
  const mask = $('#confirmMasterMask');
  if (mask.hidden) return;
  const item = pendingConfirmItem;
  const p = pendingConfirmProject;
  mask.hidden = true;
  unlockBodyScroll();
  pendingConfirmItem = null;
  pendingConfirmProject = null;
  pendingConfirmFromSkip = false;
  if (item && p) {
    const iv = getItemIntervals(item, p);
    const lastGap = iv.length ? iv[iv.length - 1] : 30;
    item.mastered = false;
    item.masteredDate = null;
    // 均匀模式下同样走智能错峰，避免最长一档直接压到已繁忙的日子
    item.nextReviewDate = scheduleNextReview(p, item, todayStr(), item.stage || 0, lastGap);
    p.updatedAt = Date.now();
    saveStore();
    render();
  }
}
// 取消按钮：单纯关闭弹窗，不做任何数据操作（评价已在弹窗前落盘）
$('#cmCancel').addEventListener('click', () => {
  $('#confirmMasterMask').hidden = true;
  unlockBodyScroll();
  pendingConfirmItem = null;
  pendingConfirmProject = null;
  pendingConfirmFromSkip = false;
});
// 注意：不监听遮罩层点击关闭，必须主动选择一个选项或取消

/* ============ 掌握度 ============ */
function getItemScore(it) {
  if (it.manualMastered) return 1.0;
  if (it.mastered) return 1.0;
  if (!it.reviews || !it.reviews.length) return null;

  let weightedSum = 0, totalWeight = 0;
  for (let i = it.reviews.length - 1; i >= 0; i--) {
    const rec = it.reviews[i];
    const recency = it.reviews.length - 1 - i;
    const weight = 1 / (recency + 1);
    const s = rec.quality === 'good' ? 1.0 : (rec.quality === 'fuzzy' ? 0.5 : 0);
    weightedSum += s * weight;
    totalWeight += weight;
  }
  let score = totalWeight > 0 ? weightedSum / totalWeight : 0;

  let streak = 0;
  for (let i = it.reviews.length - 1; i >= 0; i--) {
    if (it.reviews[i].quality === 'good') streak++;
    else break;
  }
  if (streak >= 3) score = Math.min(1.0, score + 0.1);

  if (it.reviews.length >= 2) {
    const last2 = it.reviews.slice(-2);
    if (last2.every(r => r.quality === 'forgot')) score = Math.min(score, 0.3);
  }

  return score;
}

function getMasteryInfo(it, p) {
  const isMistake = p && p.type === 'mistake';
  const masteredWord = isMistake ? '攻克' : '掌握';
  if (it.manualMastered || it.mastered) return { key: 'mastered', label: '已' + masteredWord, cls: 'm-mastered' };
  if (!it.reviews || !it.reviews.length) return { key: 'new', label: '未复习', cls: 'm-new' };

  const score = getItemScore(it);
  if (score === null) return { key: 'new', label: '未复习', cls: 'm-new' };
  if (score >= 0.8) return { key: 'solid', label: isMistake ? '牢固攻克' : '牢固掌握', cls: 'm-solid' };
  if (score >= 0.6) return { key: 'good', label: masteredWord, cls: 'm-good' };
  if (score >= 0.4) return { key: 'fuzzy', label: '需要巩固', cls: 'm-fuzzy' };
  return { key: 'weak', label: '需要重点看', cls: 'm-weak' };
}

/* 取单元内的条目及其归属权重（按页码重叠比例分摊，跨页条不会被多个单元重复计数） */
function getUnitItemEntries(p, unit) {
  // 递归获取单元及其所有子单元的页码范围
  const ranges = getUnitPageRanges(unit);
  const out = [];
  (p.items || []).forEach(it => {
    const s = getItemPageStart(it), e = getItemPageEnd(it);
    let matched = false;
    ranges.forEach(([us, ue]) => {
      if (matched) return;
      const ovS = Math.max(s, us), ovE = Math.min(e, ue);
      if (ovE >= ovS) {
        const span = Math.max(1, e - s + 1);
        const w = Math.min(1, (ovE - ovS + 1) / span);
        out.push({ it, w });
        matched = true;
      }
    });
  });
  return out;
}
// 递归获取单元及其所有子单元的页码范围
function getUnitPageRanges(unit) {
  let ranges = [];
  if (unit.startPage != null && unit.endPage != null) ranges.push([unit.startPage, unit.endPage]);
  (unit.children || []).forEach(c => ranges = ranges.concat(getUnitPageRanges(c)));
  return ranges;
}
/* 获取关联刷题本中该单元的学习进度 */
function getRefUnitProgress(p, unit) {
  if (!p || !p.refProjectId) return null;
  const ref = store.projects[p.refProjectId];
  if (!ref || ref.type !== 'exercise') return null;
  // 计量方式必须一致
  if (p.mistakeMode === 'set' && ref.unit !== 'set') return null;
  if (p.mistakeMode === 'page' && ref.unit !== 'page') return null;

  // 套卷模式：按套号直接匹配
  if (p.mistakeMode === 'set') {
    const setNo = unit.__setNo;
    if (!setNo) return null;
    const frac = getSetFraction(ref, setNo);
    return { unitPages: 1, learnedPages: frac, learnedRatio: frac };
  }

  // 页码模式：把刷题本的已完成区间裁剪到该单元范围内
  const ranges = getUnitPageRanges(unit);
  if (!ranges.length) return null;
  const unitPages = countRanges(ranges.map(([s, e]) => ({ start: s, end: e })));
  if (unitPages <= 0) return null;

  const done = getBookDoneRanges(ref);
  let learned = 0;
  ranges.forEach(([us, ue]) => {
    let covered = [];
    done.forEach(r => {
      const s = Math.max(r.start, us), e = Math.min(r.end, ue);
      if (e >= s) covered.push({ start: s, end: e });
    });
    learned += countRanges(mergeRanges(covered));
  });

  return { unitPages, learnedPages: learned, learnedRatio: learned / unitPages };
}
function getUnitMastery(p, unit) {
  const entries = getUnitItemEntries(p, unit);
  const mistakeCount = entries.length;
  const masteredCount = entries.filter(({ it }) => it.mastered || it.manualMastered).length;

  // 掌握率：仅在有错题时有意义
  let masteryRate = null;
  if (mistakeCount > 0) {
    let sw = 0, sws = 0;
    entries.forEach(({ it, w }) => {
      // 从没复习过的条目：权重减半（还没暴露真实水平）
      const reviews = (it.reviews || []).length;
      const weightScale = reviews === 0 ? 0.5 : 1.0;
      const sc = (it.mastered || it.manualMastered) ? 1.0 : (getItemScore(it) ?? 0.5);
      sw += w * weightScale; sws += sc * w * weightScale;
    });
    masteryRate = sw > 0 ? sws / sw : 0;
  }

  // 学习进度：仅联动时可用
  const ref = getRefUnitProgress(p, unit);
  const learnedRatio = ref ? ref.learnedRatio : null;

  // 状态判定
  let state;
  if (mistakeCount > 0) {
    state = 'learned-with-mistake';
  } else if (ref) {
    state = learnedRatio === 0 ? 'unlearned' : 'learned-no-mistake';
  } else {
    state = 'no-data';
  }

  return {
    state,
    learnedRatio,
    refUnitPages: ref ? ref.unitPages : null,
    refLearnedPages: ref ? ref.learnedPages : null,
    mistakeCount,
    masteredCount,
    masteryRate
  };
}

function masteryFromScore(score) {
  if (score === null || score === undefined) return { label: '未开始', cls: 'm-new' };
  if (score >= 0.8) return { label: '掌握良好', cls: 'm-solid' };
  if (score >= 0.4) return { label: '需要巩固', cls: 'm-fuzzy' };
  return { label: '需要重点看', cls: 'm-weak' };
}

/* ============ 状态卡 ============ */
/* 统一的"加量/缺口"措辞：既要让用户知道有缺口（首要目标是按时完成），又不用"多 358%、2.7 倍"
   这种击溃性数字。小样本（medium）速率不稳、不给精确倍数；高倍数引导调整计划（加天数/延后/缩范围）。
   short 用于卡片/脚注的短句；full 用于状态卡/看板的完整说明。 */
function stretchShort(m) {
  const ratio = m.ratio || 1;
  if (!(ratio > 1.05)) return '';
  if (m.confidence !== 'high') return '需加量（早期估算）';
  const pct = Math.round((ratio - 1) * 100);
  if (ratio <= 1.5) return `比平时多 ${pct}%`;
  if (ratio <= 2.2) return '强度偏大，建议加天数';
  return '缺口较大，建议调整计划';
}
function stretchFull(m) {
  const ratio = m.ratio || 1;
  if (!(ratio > 1.05)) return '';
  if (m.confidence !== 'high') return '需要比平时多做一些才能赶上；现在样本还少、这个估算并不稳定，先按节奏推进，具体以状态卡的调整方案为准。';
  const pct = Math.round((ratio - 1) * 100);
  if (ratio <= 1.5) return `比平时多约 ${pct}%`;
  if (ratio <= 2.2) return `每次约需比平时多 ${pct}%，强度偏大；更建议增加学习天数或把截止日适当延后，避免某天硬撑。`;
  return '按当前节奏缺口较大，硬加到每天很容易累垮；更建议在设置里延后截止日、增加每周学习天数，或缩小范围。';
}

/* ============ 按期方案（看板 / 今日目标 / 状态卡共用，保证同一数字） ============
   理念：按期完成是第一选择，延期只作兜底；从多个"按期组合"（每周几天 × 每次多少）里
   选一个综合最易坚持的作为系统推荐，其余最多留一个备选，避免用户在多个数字里纠结。 */
function getCatchUpPlan(p, m) {
  const remaining = m.remaining;
  // 背书正常窗口下追赶分母用"新学窗口（到新学截止日）"，与 perStudyDay 口径一致；
  // 背书冲刺期、刷题/错题用"到目标日"。
  const daysAvailable = (p.type === 'recite' && m.newLearnEnd && !m.sprint)
    ? m.planDaysAvailable : m.daysAvailable;
  const curWk = Math.max(1, Math.round(m.activityPerWeek));
  const curRate = m.perStudyDayRaw > 0 ? m.perStudyDayRaw : 1;
  const out = { onTime: null, alt: null, delay: null, curWk, curRate };
  if (!(remaining > 0 && daysAvailable > 0)) return out;
  const perFor = (wk) => remaining / (daysAvailable * wk / 7); // 每周学 wk 天时，每个学习日的量
  const MAX_MULT = 2.5; // 每次量超过平时 2.5 倍视为硬撑，不放进"可行按期方案"

  // 1) 保持当前频率（改动最小，缺口小时优先）
  const keep = { wk: curWk, tag: `保持每周 ${curWk} 天`, per: perFor(curWk), mult: perFor(curWk) / curRate, keep: true };
  // 2) 加频率的方案（每周 6 天 / 每天都学 / 向 5 天补）
  const add = [];
  const addCand = (wk, tag) => {
    if (wk <= curWk || wk > 7) return;
    const per = perFor(wk);
    if (per <= curRate * MAX_MULT) add.push({ wk, tag, per, mult: per / curRate });
  };
  addCand(6, '每周 6 天');
  addCand(7, '每天都学');
  addCand(5, '每周 5 天');

  if (keep.mult <= 1.5) {
    // 缺口小：保持现有频率、每次稍微多做一点即可，不必改频率
    out.onTime = keep;
    out.alt = null;
  } else {
    const pool = add.filter(c => c.mult <= MAX_MULT);
    if (pool.length) {
      // 综合最易坚持：每次量倍数越低越好；倍数接近（≤15%）时优先每周 6 天（有缓冲、比每天都学更可持续）
      pool.sort((a, b) => (a.mult + (a.wk === 6 ? -0.12 : 0)) - (b.mult + (b.wk === 6 ? -0.12 : 0)));
      out.onTime = pool[0];
      out.alt = pool[1] || null;
    }
    // 保持频率就能在 3 倍内追上（强度大但数学上可行）时，作为首选/备选
    if (!out.onTime && keep.mult <= 3) out.onTime = keep;
    if (out.onTime && !out.alt && keep.mult <= MAX_MULT && out.onTime.wk !== curWk) out.alt = keep;
  }
  // 无任何可行按期方案：给"每天都学"的硬路径，并如实标注强度，让卡片去引导延期
  if (!out.onTime) {
    const per = perFor(7);
    out.onTime = { wk: 7, tag: '每天都学（冲刺）', per, mult: per / curRate, heavy: true };
  }
  // 3) 延期兜底：每周约 6 天、维持平时每次量，算出从容完成日（现实往往不允许逾期，故仅作最后兜底）
  if (m.perStudyDayRaw > 0) {
    const wk = Math.max(curWk, 6);
    const days = Math.ceil(remaining / (curRate * wk / 7));
    out.delay = { wk, per: curRate, days, date: addDays(m.t, days) };
  }
  return out;
}

// 统一的"每个学习日目标"：stretch/impossible 时采用推荐按期方案，其余按当前预测频率
function getDailyTarget(p, m) {
  if (m.remaining <= 0) return { per: 0, wk: null, plan: null };
  if ((m.feasibility === 'stretch' || m.feasibility === 'impossible') && m.perStudyDayRaw > 0) {
    const plan = getCatchUpPlan(p, m);
    if (plan.onTime) return { per: plan.onTime.per, wk: plan.onTime.wk, plan, heavy: !!plan.onTime.heavy };
  }
  // 冷启动（数据不足）时 perStudyDay 是按"每周 5 天"先验折算的，频率口径也要用 5，避免大字与脚注打架
  const wk = m.enoughData ? Math.round(m.activityPerWeek) : 5;
  return { per: m.perStudyDay, wk: m.perStudyDay != null ? wk : null, plan: null };
}

/* ============ 动态学习教练文案池 ============
   多维度组合：时间段 × 连续天数 × 进度状态 × 日期种子轮换，保证新鲜感。 */
const Coach = {
  pick(arr, seedKey) {
    if (!arr || !arr.length) return '';
    let h = 0;
    const s = todayStr() + '|' + (seedKey || '');
    for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return arr[Math.abs(h) % arr.length];
  },
  start: {
    morning: [
      '早上好！新的一天，先从今天的小目标开始，做完会很踏实～',
      '早晨状态最好，先把今天的量完成，剩下时间都是赚的～',
      '早！今天也按节奏来，先坐下开始，进入状态就顺了～',
      '清晨是高效时段，先完成目标，一天都轻松～',
    ],
    day: [
      '今天的目标已经安排好啦，找个时间开始吧～',
      '按节奏推进就好，先从今天的第一部分开始～',
      '今天也稳稳的，完成目标就是胜利～',
      '不用想太多，跟着今天的安排走就好～',
      '先开始，哪怕只做一点点，进入状态后会越做越顺～',
    ],
    evening: [
      '晚上好，今天还有时间完成目标，现在开始刚刚好～',
      '别拖到太晚哦，现在开始，做完安心休息～',
      '晚上效率也可以很高，先做起来，时间够用～',
      '今天还剩一点时间，完成目标再休息会更踏实～',
    ],
    night: [
      '夜深了，如果今天还没做，做一点点也好，别给自己压力～',
      '深夜了，量力而行，哪怕开始一点点都算数～',
    ],
  },
  streak: {
    hot: [
      '连续天数很亮眼，今天别断、保持住！',
      '这份坚持很了不起，今天也坐下来、接着保持～',
      '已经连续这么多天，惯性在你这边～',
    ],
    warm: [
      '连续几天了，节奏不错，今天也跟上～',
      '保持连续记录，今天做一点就续上了～',
    ],
  },
  back: [
    '歇了几天没关系，节奏很快就会回来～',
    '欢迎回来！不用补之前的，重新出发就好～',
    '断几天很正常，捡起来比从零开始快得多～',
    '回来就好，慢慢进入状态～',
    '休息也是学习的一部分，今天重新出发～',
    '之前学的都还在，不用有负担～',
  ],
  progress: {
    early: [
      '稳扎稳打，先完成一部分～',
      '已经启动，保持这个感觉～',
      '不错的开局，继续往下～',
      '踏踏实实，一步步来～',
    ],
    mid: [
      '稳扎稳打，保持这个节奏～',
      '中间阶段最考验坚持，你做得很好，继续～',
      '进度在稳步推进，继续保持～',
      '保持这个势头，再接再厉～',
    ],
    late: [
      '进入后半程，一鼓作气～',
      '快了，保持住这个状态～',
      '收尾阶段，再加把劲～',
      '手感正好，拿下它～',
    ],
  },
  done: [
    '今日目标达成，剩下时间自由安排～',
    '完成！今天的任务稳稳拿下，好好放松～',
    '达标了！按节奏走就是这么稳～',
    '今日份学习圆满完成，辛苦啦～',
    '目标完成，这份踏实感是你应得的～',
  ],
  // 今日只完成一部分时的收尾鼓励（句子自带动作引导，不再拼后缀，避免"继续~继续"重复）
  dashPartial: [
    '已经开了个好头，把剩下的完成，今天就更踏实了～',
    '进度不错，趁热打铁把今天的目标收尾～',
    '进度在往前走，今天的任务很快就能清完～',
    '状态已经热起来了，顺手把剩下的做完～',
    '继续保持这个节奏，再推进一点点，今天的目标就到手了～',
  ],
  overSmall: [
    '小超额，今天状态不错～',
    '多做了一些，很棒，剩下时间自由安排～',
    '超额完成，效率在线～',
    '比目标多做了点，今天很充实～',
  ],
  overMid: [
    '比目标多做了不少，今天的你很高效～',
    '状态正佳，多学了这么多，成就感满满～',
    '一口气推进了这么多，势头很足～',
    '今天发挥得很好，这份高效很提气～',
  ],
  overBig: [
    '今天彻底爆发了，状态太强了，剩下时间好好休息～',
    '这股劲头太棒了，不用每天都这样，今天已经很厉害～',
    '火力全开的一天，好好犒劳自己～',
    '今天效率拉满，爆发日是加分项，按自己的节奏来～',
    '学了这么多，今天的你超强，剩下时间完全自由～',
  ],
  cold: [
    '刚开始，数据还在积累，先按你的状态来，不用有压力～',
    '前几天是磨合期，做几天系统就更懂你的节奏了～',
    '开局阶段，目标只是参考，找到自己的感觉最重要～',
  ],
};
function coachSlot() {
  const h = new Date().getHours();
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 18) return 'day';
  if (h >= 18 && h < 23) return 'evening';
  return 'night';
}
// 天数措辞统一处理：0 天说"就是今天"，负值说"已过 N 天"，正值说"还有 N 天"
function fmtDaysLeft(n) {
  if (n === 0) return '就是今天';
  if (n < 0) return `已过 ${-n} 天`;
  return `还有 ${n} 天`;
}

function getStatusMessage(p, m) {
  const u = unitName(p);
  const curN = fmtUnitNum(m.currentPage), tot = fmtUnitNum(m.total), rem = fmtUnitNum(m.remaining);
  const pct = m.total > 0 ? m.currentPage / m.total : 0;

  // 1. 全部完成：提前完成给正反馈
  if (pct >= 1 && m.currentPage > 0) {
    if (p.type === 'mistake') {
      return { icon:'🏁', cls:'ok', title:'已收录的错题全部攻克',
        desc:`共攻克 ${tot} 道错题，这些曾经的坑都被你填平了，它们就是你的得分点。以后遇到新错题随时收录，系统会继续自动提醒你重做。` };
    }
    let praise = '';
    if (p.deadline) {
      const early = diffDays(m.t, p.deadline);
      if (early > 0) praise = `比目标提前了 ${early} 天，太棒了！`;
      else if (early === 0) praise = '刚好在目标日完成，卡得很准！';
    }
    return { icon:'🏁', cls:'ok', title:'全部内容已完成',
      desc:`共 ${tot} ${u}，你在 ${fmtCN(m.t)} 完成了整个目标。${praise ? praise + '<br><br>' : ''}可以在设置中调整截止日期，或开始下一个任务。` };
  }

  // 2. 错题本：核心理念——攻克错题是最高效的提分，错题是"提前发现的薄弱点"而非负担。
  //    按间隔滚动复习，不采用"每天订正多少 / 攻克速度线性外推"的线性思维：
  //    每道题要走多轮才攻克，攻克速度天然非线性，小样本外推会得出"还需90周"这种荒谬且打击人的数字。
  if (p.type === 'mistake') {
    const today = todayStr();
    const due = getDueItems(p).length;
    const over = getOverdueItems(p).length;
    const totalNum = m.total || 0;
    const masteredNum = m.currentPage || 0;
    const mpct = totalNum > 0 ? masteredNum / totalNum : 0;
    const masteredPct = Math.round(mpct * 100);
    const justStarted = masteredNum === 0 && totalNum > 0;

    // 今天的动作（复习 / 攻克），用于"今天做完了"的即时满足
    let reviewedToday = 0, masteredToday = 0;
    (p.items || []).forEach(it => {
      const revs = it.reviews || [];
      if (revs.length >= 2 && revs[revs.length - 1].date === today) reviewedToday++;
      if (it.masteredDate === today && !it.manualMastered) masteredToday++;
    });
    // 高频薄弱点：反复错（连续 2 次及以上"又错了"）的未攻克题——考前最该拿下、提分最快的点
    const weakKey = (p.items || []).filter(it => !it.mastered && !it.manualMastered && (it.wrongStreak || 0) >= 2).length;

    const masteryLine = totalNum > 0
      ? (masteredNum > 0 ? `已攻克 ${curN} / ${tot} 道（${masteredPct}%）` : `已收录 ${tot} 道，还没开始复习`)
      : '';
    const progressPhrase = masteredNum > 0
      ? `已实打实攻克 ${curN} 道，这些曾经的薄弱点正在变成你的得分点。`
      : (totalNum > 0 ? '收录错题，就是在精准定位你自己的提分点，已经开了个好头。' : '');
    const weakPhrase = weakKey > 0
      ? `<strong>${weakKey}</strong> 道你反复错过，是考前最该拿下的高频薄弱点，优先做熟它们、提分最快。`
      : '';

    // 截止日：只在临近（≤14 天）或已过时温和提示；距离还远时不喊焦虑——每天清掉"今天到期"的就是最优策略
    let deadlineWarn = '';
    if (p.deadline && m.remaining > 0) {
      const daysLeft = diffDays(today, p.deadline);
      if (daysLeft < 0) {
        deadlineWarn = `<br><br>目标日已过 ${-daysLeft} 天，错题本仍会继续帮你滚动剩下的 ${rem} 道，不用焦虑；想设个新目标日，可以在设置里调整。`;
      } else if (daysLeft <= 14) {
        deadlineWarn = `<br><br>距目标日 ${fmtCN(p.deadline)} ${fmtDaysLeft(daysLeft)}。这段时间建议优先清「今天到期」和「反复错」的题——把已经暴露过的薄弱点做熟，比漫无目的地刷新题更针对考前提分。想筛查哪些题从收录后一次都没复习过，可以到「🎯 薄弱点 → 未复习」里看一眼。`;
      }
    }

    // (a) 有逾期：温和提醒 + 分批（自动均衡已控制今日量），进步前置，不制造"做不完"的恐慌
    if (over > 0) {
      const heavy = over >= Math.max(1, due * 0.5);
      const lead = heavy
        ? `今天有 ${due} 道待复习（含 ${over} 道逾期）。<strong>不用一次做完，也不用有负担</strong>，先从最久没复习的那条开始，其余的系统会自动摊到接下来几天。`
        : `今天有 ${due} 道待复习（含 ${over} 道逾期）。先把逾期的过一遍，哪怕只做几条，记忆也会重新接上。`;
      return { icon:'📌', cls:'info', title: heavy ? `有 ${over} 道逾期，分批消化就好` : `有 ${over} 道错题到期了`,
        desc:`${lead}<br>${progressPhrase}${weakPhrase ? '<br>' + weakPhrase : ''}错题按间隔滚动，做完当轮自动排下一轮，你只管清今天的。${deadlineWarn}` };
    }
    // (b) 正常待复习：强调"攻克 = 实打实进步"
    if (due > 0) {
      let tail = '今天从第一条开始订正，间隔就会开始滚动。';
      if (mpct >= 0.8) tail = '已经攻克大半，进入收尾，保持住，能看到头了。';
      else if (mpct >= 0.5) tail = '已经攻克过半，进展很实在。';
      else if (masteredNum > 0) tail = '做对会把间隔越拉越长，之后会越来越轻松。';
      return { icon:'📋', cls:'info', title:`今天有 ${due} 道错题等你过一遍`,
        desc:`每攻克一道错题，就是实打实补上一个提分点，比刷十道新题更值。${masteryLine ? masteryLine + '，' : ''}${tail}${weakPhrase ? '<br>' + weakPhrase : ''}${deadlineWarn}` };
    }
    // (c) 今天刚把队列清完（还没全攻克）：给即时满足
    if (due <= 0 && reviewedToday > 0 && m.remaining > 0) {
      const got = masteredToday > 0 ? `今天还攻克了 ${masteredToday} 道，又拿下 ${masteredToday} 个薄弱点。` : '';
      return { icon:'✅', cls:'ok', title:'今天的错题都过完了',
        desc:`今天已复习 ${reviewedToday} 道，${got}剩下的会在到期日自动提醒，不用提前惦记。${progressPhrase ? '<br>' + progressPhrase : ''}` };
    }
    if (m.remaining === 0 && m.currentPage > 0) {
      return { icon:'🎉', cls:'ok', title:'已收录的错题全部攻克',
        desc:`共攻克 ${curN} 道错题，这些曾经的坑都被你填平了。遇到新错题随时收录，到复习日会自动提醒你重做。` };
    }
    // (d) 刚收录、还没开始：把"收录错题"正面化
    if (justStarted) {
      return { icon:'📝', cls:'info', title:'错题已经帮你记下了',
        desc:`已收录 ${tot} 道错题，等于提前找到了 ${tot} 个提分点。现在还没有到期提醒，可以在复习区先过 1 道，间隔系统就开始运转，之后全自动提醒。` };
    }
    // (e) 队列暂时清空
    const calmTail = mpct >= 0.8
      ? `已攻克 ${masteredPct}%，进入收尾，队列暂时清空，遇到新错题随时收录。`
      : mpct >= 0.5
        ? `已攻克 ${masteredPct}%、过半了，暂无到期就是暂时清空了队列，保持节奏就好。`
        : masteredNum > 0
          ? `已攻克 ${curN} / ${tot} 道，队列暂时清空，今天可以轻松些。`
          : '暂无到期错题，遇到新错题随时收录即可。';
    return { icon:'✅', cls:'ok', title:'暂无到期错题',
      desc:`${calmTail}${deadlineWarn}` };
  }

  // 3. 背书本·冲刺期：剩余时间已不足一个完整复习周期（距考试 < cycleDays），
  //    目标从"把新内容学完"切换为"把已学的在考场上记住"，不判 impossible、给清晰的冲刺动作。
  if (p.type === 'recite' && m.sprint) {
    const due = getDueItems(p).length;
    const over = getOverdueItems(p).length;
    const finalRev = (p.items || []).filter(it => it.finalReviewDate).length;
    let body = `距你的目标日 ${fmtCN(p.deadline)} ${fmtDaysLeft(m.daysLeft)}，已不足一个完整复习周期（约 ${m.cycleDays} 天）。<br><br>`;
    body += `<b>这个阶段的目标不是"把没背的全背完"，而是"把已学的内容牢牢记住"。</b><br>`;
    body += `• 已学内容的复习最优先，这是性价比最高的巩固动作；<br>`;
    body += `• 新内容只挑最核心、最关键的部分，系统会用更短的间隔帮你快速过；<br>`;
    if (m.remaining > 0) body += `• 还有约 ${fmtUnitNum(m.remaining)} 页没学，不建议再大面积铺新，按"先复习、有余力再挑重点学新"走即可。<br>`;
    if (finalRev > 0) body += `• 已有 <b>${finalRev}</b> 条完成了目标前最后一遍，目标日前不再占用你，稳住状态即可。<br>`;
    if (due > 0) body += `<br>今天有 ${due} 条到期复习${over > 0 ? `（含 ${over} 条逾期）` : ''}，先把它们过一遍，就是此刻最有效的冲刺。`;
    else body += `<br>今天的复习已清完，有余力就挑重点学一点。`;
    return { icon:'⏰', cls:'warn', title:'进入冲刺期：先复习、再挑重点学新', desc: body };
  }

  // 背书本的"新学截止日"提示（正常窗口）：新内容应在 deadline-cycleDays 前学完，之后只滚动复习，
  // 才能保证所有内容在考试前走完所有轮次、形成长期记忆。
  const reciteCycleLine = (p.type === 'recite' && m.newLearnEnd && !m.sprint)
    ? (m.cycleTight
      ? `<br><b>注意：</b>按当前节奏，新内容可能赶不上 ${fmtCN(m.newLearnEnd)} 的新学截止日，最后一部分会来不及走完完整复习周期；建议近期加一点量或提前，实在来不及就优先保高频考点。`
      : `<br>新内容建议在 <b>${fmtCN(m.newLearnEnd)}</b> 前学完，之后约 ${m.cycleDays} 天只做滚动复习，这样到目标日每一块都能走完所有轮次、记得最牢。`)
    : '';

  // 4. 数据不足：用"已完成的小集合"框架肯定第一步，再给一个今天就能执行的小抓手
  if (!m.enoughData || !m.etaDate) {
    const verb0 = p.type === 'recite' ? '新学' : '做';
    const doneTxt = m.currentPage > 0
      ? `已完成 ${curN} ${u}、第 ${m.activeDays} 个学习日`
      : `第 ${m.activeDays} 个学习日`;
    if (p.deadline && m.remaining > 0 && m.daysAvailable > 0) {
      // 有截止日：早期也给一个粗略但可执行的小目标（只给一个数字，与看板/今日目标同源）。
      // 背书按"新学窗口（目标日−完整复习周期）"算，留得出复习时间；其余按到目标日。
      const reciteWin = (p.type === 'recite' && !m.sprint && m.newLearnEnd)
        ? Math.max(1, diffDays(m.t, m.newLearnEnd) + 1) : 0;
      const winDays = reciteWin || m.daysAvailable;
      const perStudy = m.perStudyDay != null ? m.perStudyDay : m.remaining / (winDays * 5 / 7); // 按每周约 5 个学习日
      const targetDate = reciteWin ? m.newLearnEnd : p.deadline;
      const grasp = reciteWin
        ? `按每个学习日约 ${perStudy.toFixed(1)} ${u}（每周约 5 天）推进，就能在 ${fmtCN(targetDate)} 前学完，之后还留约 ${m.cycleDays} 天滚动复习。`
        : `按每个学习日约 ${perStudy.toFixed(1)} ${u}（每周约 5 天）推进，就能在 ${fmtCN(targetDate)} 前完成。`;
      return { icon:'🌱', cls:'info', title:'刚开始，先把节奏跑起来',
        desc:`${doneTxt}。先有个粗略抓手：${grasp}这是早期估算，做几天就会按你的真实节奏自动修正，现在不用有压力。${reciteCycleLine}` };
    }
    if (m.activeDays >= 1) {
      return { icon:'🌱', cls:'info', title:'第一步已经完成',
        desc:`${doneTxt}已经记下了。再积累约 ${m.daysToMedium} 个学习日，系统就能开始结合你的节奏估算完成时间；现在只需定一个自己做得到的小量，连续几天完成它。` };
    }
    return { icon:'📊', cls:'info', title:'今天从第一个小目标开始',
      desc:'先完成今天的第一次打卡/复习，让系统看到你的节奏。把目标定小到"一定能完成"，连续几天比一次猛学更重要。' };
  }

  const verb = p.type === 'recite' ? '新学' : '做';
  const paceBits = `按你每周约 ${Math.round(m.activityPerWeek)} 个学习日、每次约 ${(Math.round(m.perStudyDayRaw * 10) / 10).toFixed(1)} ${u} 的节奏`;
  const confTxt = m.confidence === 'medium' ? '（样本还少，范围偏宽）' : '';
  const sparseNote = m.sparseLogging
    ? `（提示：你最近打卡间隔中位数约 ${m.medianGap} 天，产能估计可能有偏差，建议每天记录一次。）`
    : '';
  let rangeTxt = `预计 ${fmtCN(m.etaDate)} 完成`;
  if (m.etaEarlyDate && m.etaLateDate && m.etaEarlyDate !== m.etaLateDate) {
    rangeTxt = `预计 ${fmtCN(m.etaEarlyDate)}～${fmtCN(m.etaLateDate)} 之间完成`;
  }
  // 落后/超前量（与 getMetrics 同口径：填了 startDate 用它，否则用最早打卡日）
  let behindTxt = '';
  if (m.effStart && p.deadline && m.total > 0) {
    const totalSpan = diffDays(m.effStart, p.deadline);
    const elapsed = diffDays(m.effStart, m.t);
    if (totalSpan > 0) {
      const ideal = m.total * Math.max(0, Math.min(1, elapsed / totalSpan));
      const gap = Math.round(m.currentPage - ideal);
      if (gap < -1) behindTxt = `比理想进度慢了 ${-gap} ${u}。`;
      else if (gap > 1) behindTxt = `目前相对理想进度超前 ${gap} ${u}。`;
    }
  }

  // 4. 未设截止日：给预计完成 + 还需几周
  if (!p.deadline) {
    const weeksLeft = m.etaDate ? Math.ceil(diffDays(m.t, m.etaDate) / 7 * 10) / 10 : null;
    return { icon:'📈', cls:'ok', title:'保持节奏，持续推进',
      desc:`${paceBits}，${rangeTxt}全部 ${tot} ${u}${weeksLeft ? `，大约还需 ${weeksLeft} 周` : ''}。可在设置里添加截止日，获得每个学习日目标和可行性提醒。${confTxt}` };
  }

  // ---- 按期方案（看板 / 今日目标 / 状态卡共用同一数字）：按期首选、延期只作兜底 ----
  const plan = getCatchUpPlan(p, m);
  const remaining = m.remaining, daysAvailable = m.daysAvailable;
  const curWk = plan.curWk, curRate = plan.curRate;
  const n1 = v => (Math.round(v * 10) / 10).toFixed(1);
  const planText = (c) => {
    if (!c) return '';
    if (c.keep) return `保持每周 ${c.wk} 天、每次约 ${n1(c.per)} ${u}（比平时多约 ${Math.round((c.mult - 1) * 100)}%）`;
    return `每周学 ${c.wk} 天、每次约 ${n1(c.per)} ${u}`;
  };
  // 真实完成日期：高置信给区间；小样本只在"能赶上 / 仅小幅落后"时给精确日期，
  // 若外推到目标日 30 天以后（数据少时极易被几天低迷放大成击溃性数字），只如实说"会晚"而不给伪精确日期。
  const etaLine = (() => {
    if (m.confidence === 'high' && m.etaEarlyDate && m.etaLateDate && m.etaEarlyDate !== m.etaLateDate)
      return { text: `按现在节奏预计 ${fmtCN(m.etaEarlyDate)}～${fmtCN(m.etaLateDate)} 完成`, far: false };
    const d = m.momentumEtaDate || m.etaDate;
    if (!d) return { text: '', far: false };
    const over = p.deadline ? diffDays(p.deadline, d) : 0; // 正值=晚于目标日多少天
    if (m.confidence !== 'high' && over > 30)
      return { text: '按目前节奏会晚于目标日', far: true };
    return { text: `按${m.momentumEtaDate ? '最近' : '现在'}节奏预计 ${fmtCN(d)} 左右完成`, far: false };
  })();
  // 小样本只保留这一次极短标注（far 时尤其需要强调会快速修正）
  const earlyTag = m.confidence === 'medium'
    ? (etaLine.far
      ? '<span class="muted">（数据还少，只看方向不看具体日期，随每天记录快速修正）</span>'
      : '<span class="muted">（早期估算，随每天记录更新）</span>')
    : '';

  // 5. impossible（含已过期）：先给按期硬路径，延期作为更现实的兜底；不渲染"晚 X 天"
  if (m.feasibility === 'impossible' || m.daysLeft < 0) {
    const overdue = m.daysLeft < 0;
    let body = '';
    if (overdue) {
      body = `已经过了原定目标日 ${fmtCN(p.deadline)}，还剩 ${rem} ${u}。之前学的都还在，我们把计划重新理顺。<br><br>`;
    } else {
      body = `还剩 ${rem} ${u}，${etaLine.text ? etaLine.text + '，' : ''}按平时节奏在 ${fmtCN(p.deadline)} 前完成难度较大。<br><br>`;
    }
    if (m.momentumDays >= 3) body += m.momentumImproving
      ? `你最近 ${m.momentumDays} 天明显提速了，方向对了，继续保持；不过按目标日算，缺口仍然偏大。<br><br>`
      : `你最近 ${m.momentumDays} 天有在持续推进，这股劲很重要。<br><br>`;
    if (plan.onTime) {
      if (plan.onTime.heavy) {
        body += `<b>硬要赶上 ${fmtCN(p.deadline)}，只能每天都学、每次约 ${n1(plan.onTime.per)} ${u}</b>（约为平时的 ${plan.onTime.mult.toFixed(1)} 倍，强度很大、容易断档）。<br><br>`;
      } else {
        body += `<b>想赶上 ${fmtCN(p.deadline)}，可行的方式：</b>${planText(plan.onTime)}。<br><br>`;
      }
    }
    if (plan.delay) {
      body += `<b>如果强度太大，更现实的是把目标日延到 ${fmtCN(plan.delay.date)} 左右</b>（每周 ${plan.delay.wk} 天、每次约 ${n1(curRate)} ${u}，节奏更稳）。截止日是规划工具不是审判，可在设置里调整。`;
    }
    body += reciteCycleLine + sparseNote;
    return { icon: overdue ? '⛔' : '🚧', cls:'bad', title: overdue ? '已过目标日，一起重新规划' : '目标偏紧，需要调整安排', desc: body };
  }

  // 6. stretch：势头能赶上→及时翻绿；在提速→先肯定；常规→真实现状 + 首选按期方案 + 延期兜底
  if (m.feasibility === 'stretch') {
    const ratio = m.ratio || 1;
    // 6a. 近期状态好：状态卡聚焦"长期能否按时"，今天的超额肯定交给目标卡，避免重复
    if (m.momentumOnTime && m.momentumEtaDate) {
      const keepPer = plan.onTime ? plan.onTime.per : m.perStudyDay;
      const todayDone = m.todayDone || 0;
      const todayMet = todayDone >= keepPer;
      let body = `还剩 ${rem} ${u}、距目标日 ${fmtDaysLeft(m.daysLeft)}，每个学习日约 ${n1(keepPer)} ${u}就能按时完成。<br><br>`;
      body += Coach.pick([
        '你最近状态不错，按这个节奏稳定推进就好。',
        '最近效率在线，保持稳定推进，水到渠成。',
        '势头很好，稳住节奏、不用额外加压。',
      ], '6a') + '<br><br>';
      // 结尾按"今天是否已达标"给正确场景的话，不催已完成的人"继续"
      if (todayMet) {
        body += `<span class="muted">今天已完成 ${fmtUnitNum(todayDone)} ${u}` + (todayDone > keepPer*1.2 ? '、超额了，可以收工休息～' : '，达标了，剩下时间自由安排～') + `</span>`;
      } else {
        body += `<span class="muted">今天目标 ${n1(keepPer)} ${u}，${todayDone>0 ? '已完成 '+fmtUnitNum(todayDone)+'，还差一点～' : '找个时间开始吧～'}</span>`;
      }
      return { icon:'✅', cls:'ok', title:'节奏稳，能按时完成', desc: body };
    }
    // 6b. 正在提速、缺口在缩小（尚未完全赶上）：先肯定，再给首选按期方案
    if (m.momentumImproving) {
      // 只剩"硬路径"（强度很大）时，不能只给乐观，要如实说明仍需大幅加量
      if (plan.onTime && plan.onTime.heavy) {
        let body = `还剩 ${rem} ${u}。你最近明显提速了，方向对了，但按 ${fmtCN(p.deadline)} 算，缺口仍然偏大。<br><br>`;
        body += `<b>硬要赶上，只能每天都学、每次约 ${n1(plan.onTime.per)} ${u}</b>（约为平时的 ${plan.onTime.mult.toFixed(1)} 倍，强度很大、容易断档）。<br><br>`;
        if (plan.delay) body += `<b>更可持续的选择：把目标日延到 ${fmtCN(plan.delay.date)} 左右</b>（每周 ${plan.delay.wk} 天、每次约 ${n1(curRate)} ${u}）。`;
        body += reciteCycleLine;
        return { icon:'🚧', cls:'warn', title:'在提速，但还需要加量', desc: body };
      }
      let body = `还剩 ${rem} ${u}。你最近效率明显提升，状态在往上走，方向对了。<br><br>`;
      if (plan.onTime) {
        body += `<b>想在 ${fmtCN(p.deadline)} 前完成：</b>${planText(plan.onTime)}。`;
        if (plan.alt) body += `（也可${planText(plan.alt)}。）`;
      }
      if (plan.delay) body += `<br><span class="muted">若实在加不动，可把目标日延到 ${fmtCN(plan.delay.date)} 左右。</span>`;
      body += reciteCycleLine;
      return { icon:'📈', cls:'ok', title:'状态在上升，继续保持', desc: body };
    }
    // 6c. 常规 stretch
    const isHeavyGap = ratio > 1.5;
    const hardPath = plan.onTime && plan.onTime.heavy;
    let body = `还剩 ${rem} ${u}，${etaLine.text}。${earlyTag}<br><br>`;
    if (hardPath) {
      // 缺口大到可持续方案都不可行：硬路径如实标注强度，延期不再弱化，而作为并列的现实选择
      body += `<b>想赶上 ${fmtCN(p.deadline)}，只能每天都学、每次约 ${n1(plan.onTime.per)} ${u}</b>（约为平时的 ${plan.onTime.mult.toFixed(1)} 倍，强度很大、容易断档）。<br><br>`;
      if (plan.delay) body += `<b>更现实的选择：把目标日延到 ${fmtCN(plan.delay.date)} 左右</b>（每周 ${plan.delay.wk} 天、每次约 ${n1(curRate)} ${u}，节奏可持续），在设置里即可调整。`;
    } else {
      if (plan.onTime) {
        body += `<b>想按时完成，最省力的方式：</b>${planText(plan.onTime)}。`;
        if (plan.onTime.keep) body += '不用改学习频率，每次多做一点即可。';
        if (plan.alt) body += `<br>或者：${planText(plan.alt)}。`;
        body += '<br><br>';
      }
      if (plan.delay) {
        body += `<span class="muted">若最近确实排不开，可把目标日延到 ${fmtCN(plan.delay.date)} 左右（每周 ${plan.delay.wk} 天、每次约 ${n1(curRate)} ${u}），在设置里即可调整。</span>`;
      }
    }
    body += reciteCycleLine + sparseNote;
    if (hardPath) return { icon:'🚧', cls:'warn', title:'目标偏紧，建议调整安排', desc: body };
    return { icon: isHeavyGap ? '🚧' : '💪', cls: isHeavyGap ? 'warn' : 'ok',
      title: isHeavyGap ? '目标偏紧，需要加一点量' : '稍微加把劲，稳步完成', desc: body };
  }

  // 7. easy：节奏够，重点是"保持"；只给一个预计日期 + 一句缓冲建议，不堆多个速率数字
  const gapLate = m.etaLateDate ? diffDays(m.etaLateDate, p.deadline) : diffDays(m.etaDate, p.deadline);
  const isTight = gapLate <= 3;
  const etaEasy = m.etaLateDate ? fmtCN(m.etaLateDate) : fmtCN(m.etaDate);
  let body;
  if (isTight) {
    body = `还剩 ${rem} ${u}，按你现在的节奏预计 ${etaEasy} 前完成，时间刚好。<br><br>保持打卡、状态好时往前赶一点会更稳。${reciteCycleLine}${sparseNote}`;
  } else {
    body = `还剩 ${rem} ${u}，按你现在的节奏（每次约 ${(Math.round(m.perStudyDayRaw * 10) / 10).toFixed(1)} ${u}、每周约 ${Math.round(m.activityPerWeek)} 天），预计 ${etaEasy} 前完成，时间有富余。<br><br>${Coach.pick([
      '保持现在的节奏就好，状态好时往前赶一点，给自己多留缓冲。',
      '节奏很稳，继续这样推进，完成目标水到渠成。',
      '目前进度从容，按自己的节奏走就好，不用额外加压。',
      '时间还宽裕，稳稳推进，劳逸结合最重要。',
    ], 'easy')}${reciteCycleLine}${sparseNote}`;
  }
  return { icon:'✅', cls:'ok', title: isTight ? '节奏刚好，保持住' : '按当前节奏，可以按时完成', desc: body };
}

/* ============ 进步鼓励系统 ============ */
// 进度事件：启动脚手架（前3天）+ 提速/连续/回归；4个防呆，文案必须有数字
function checkProgressPraise(p, m) {
  // 防呆3：焦虑时不弹（impossible或已过期）
  if (m.feasibility === 'impossible' || m.daysLeft < 0) return null;
  // 防呆4：同一天只弹一次
  if (!p.shownPraises) p.shownPraises = {};
  const today = todayStr();
  if (p.shownPraises._lastDate === today) return null;

  const praises = [];
  const u = unitName(p);
  // 连续/启动用"活动日"口径（收录、复习、攻克、打卡都算今天学了）；
  // 错题本用户前期可能只复习尚未攻克，按完成口径会误判为没学习、零反馈。
  const act = getActivityStreak(p, today);

  // ⓪ 启动脚手架：最容易放弃的是前几天，这里只做"第1/2/3天"的有限递进确认，
  //    每个事件只弹一次、之后自动交给常规里程碑，避免每天都被哄、也避免冷启动零反馈。
  if (act.activeDays === 1 && !p.shownPraises['first_step']) {
    praises.push({ priority: 0, key:'first_step', icon:'🌱',
      title:'第一步完成了', desc:'最难的是开始，你已经在路上。今天保持这个量就好，明天再来一次。' });
  }
  if (act.streak === 2 && !p.shownPraises['streak_2']) {
    praises.push({ priority: 0, key:'streak_2', icon:'🌱',
      title:'连续两天，启动得不错', desc:'不用追求量大，能连续两天坐下来，节奏就开始建立了。' });
  }

  // 个性化启动：累计满 3 个学习日、系统从"粗略抓手"切换为"按你真实节奏定制"时，给一次明确反馈，
  // 让冷启动到个性化的过渡可见（之前只能自己发现"样本不足"消失）。
  // 仅在刚跨过门槛（3~6 个学习日）弹一次；连续 3 天的情况交给 streak_3 里程碑；老用户不补弹。
  if (m.enoughData && act.activeDays >= 3 && act.activeDays <= 6 && act.streak !== 3 && !p.shownPraises['personalized']) {
    praises.push({ priority: 0, key:'personalized', icon:'🎯',
      title:'系统开始按你的节奏定制了',
      desc:`已经积累 ${act.activeDays} 个学习日，今日目标和预计完成时间从现在起会随你的真实节奏自动调整——你只管跟着今天的安排走就好。` });
  }

  // ① 节奏提速：近7天产能 vs 之前3周，提升>=15%（需要历史，早期 prevRate 为空自然不触发）
  if (m.trendPct != null && m.trendPct >= 0.15 && m.recentRate != null && m.prevRate != null) {
    const lastKey = 'trend';
    const lastDate = p.shownPraises[lastKey];
    if (!lastDate || diffDays(lastDate, today) >= 7) {
      praises.push({
        priority: 1, key: lastKey,
        icon: '📈', title: '这周你比之前快了',
        desc: `每次平均 ${m.recentRate.toFixed(1)} ${u}（之前 ${m.prevRate.toFixed(1)} ${u}），提升了 ${(m.trendPct*100).toFixed(0)}%`
      });
    }
  }

  // ② 连续打卡：突破 3/5/7/14/30 天档位；只有"曾连续≥3天、这次再打破历史最长"才算刷新纪录，
  //    避免首次连续时 3→4→5 这样的小数字被天天当成新纪录
  const streakTargets = [3, 5, 7, 14, 30];
  const streak = act.streak;
  if (streak >= 3) {
    const hitTarget = streakTargets.find(t => streak === t);
    // 已宣告过的纪录值也参与比较，避免刷新纪录只弹一次、之后再破纪录不再提示
    const announcedRecord = p.shownPraises.streak_record_n || 0;
    const histBest = Math.max(act.priorLongest || 0, announcedRecord);
    const isRecord = !hitTarget && streak > histBest && histBest >= 3;
    if (hitTarget || isRecord) {
      const key = isRecord ? 'streak_record' : `streak_${hitTarget}`;
      const alreadyMilestone = !isRecord && p.shownPraises[key];
      const alreadyRecord = isRecord && announcedRecord >= streak;
      if (!alreadyMilestone && !alreadyRecord) {
        const recordDesc = histBest > 0
          ? `已经连续 ${streak} 天，超过了你之前的最长纪录 ${histBest} 天`
          : `已经连续 ${streak} 天，这是你目前最长的一次连续打卡`;
        praises.push({
          priority: isRecord ? 2 : 3, key,
          recordN: streak,
          icon: '🔥', title: isRecord ? '连续打卡刷新纪录' : `连续打卡 ${streak} 天`,
          desc: isRecord ? recordDesc : `已经连续 ${streak} 天了，继续保持`
        });
      }
    }
  }

  // ③ 中断后回归：今天重新开始（当前连续=1），且上一个活动日距今停摆>=3天
  if (act.streak === 1 && act.prevDate) {
    const recentBreak = Math.max(0, diffDays(act.prevDate, today) - 1);
    if (recentBreak >= 3) {
      const key = `return_${today}`;
      if (!p.shownPraises[key]) {
        const doneTxt = m.todayDone > 0
          ? `今天做了 ${fmtUnitNum(m.todayDone)} ${u}，节奏没丢`
          : '今天重新坐下来开始了，节奏没丢';
        praises.push({
          priority: 4, key,
          icon: '👋', title: '休息后回来了',
          desc: `之前停了 ${recentBreak} 天，${doneTxt}`
        });
      }
    }
  }

  if (!praises.length) return null;
  // 防呆4：选最硬的一条（priority最小）
  praises.sort((a, b) => a.priority - b.priority);
  const best = praises[0];
  p.shownPraises[best.key] = today;
  if (best.recordN) p.shownPraises.streak_record_n = best.recordN;
  p.shownPraises._lastDate = today;
  p.updatedAt = Date.now();
  saveStore();
  return best;
}

// 打卡成功后统一调用：检测进步鼓励并弹出
function maybeShowProgressPraise(p) {
  const praise = checkProgressPraise(p, getMetrics(p));
  if (praise) setTimeout(() => showToast(praise.icon, praise.title, praise.desc, 4000), 800);
}

/* ============ 里程碑 ============ */
const MILESTONES = [
  { at:25, icon:'📈', title:'完成 25%！', desc:'四分之一已达成。继续推进，节奏很稳。' },
  { at:50, icon:'🌟', title:'完成 50%！', desc:'进度已经过半，接下来稳扎稳打。' },
  { at:70, icon:'💪', title:'完成 70%！', desc:'胜利在望。保持节奏，别停下来。' },
  { at:90, icon:'🔥', title:'完成 90%！', desc:'最后一程，一鼓作气冲线。' },
  { at:100, icon:'✅', title:'全部完成！', desc:'恭喜你拿下整个目标，好好犒劳一下自己。' }
];
let toastTimer = null;
function showToast(icon, title, desc, duration, onClick) {
  const t = $('#toast');
  t.querySelector('.toast-icon').textContent = icon;
  t.querySelector('.toast-title').textContent = title;
  t.querySelector('.toast-desc').textContent = desc;
  t.hidden = false;
  t.classList.remove('show');
  void t.offsetWidth;
  requestAnimationFrame(() => t.classList.add('show'));
  // ux-14：toast 可点击重试（onClick 存在时手型 + 点击触发一次）
  _toastClickHandler = (typeof onClick === 'function') ? onClick : null;
  t.style.cursor = _toastClickHandler ? 'pointer' : 'default';
  if (toastTimer) clearTimeout(toastTimer);
  const ms = duration && duration > 0 ? duration : 2200;
  toastTimer = setTimeout(() => {
    t.classList.remove('show');
    _toastClickHandler = null;
    t.style.cursor = 'default';
    setTimeout(() => { t.hidden = true; }, 320);
  }, ms);
}
let _toastClickHandler = null;
document.addEventListener('DOMContentLoaded', () => {
  const t = document.getElementById('toast');
  if (t) t.addEventListener('click', () => { if (_toastClickHandler) { const fn = _toastClickHandler; _toastClickHandler = null; fn(); } });
});
/* ux-16：内联校验 helper——字段红边框 + 字段下红字，替代原生 alert()。
   错误节点挂在输入框的直接父容器下；输入时即清除（ux-26：只动轻量样式，不全量 render）。 */
function setFieldError(input, msg){
  if (!input) return;
  input.classList.add('input-error');
  input.setAttribute('aria-invalid', 'true');
  const wrap = input.closest('.field, .form-row, .checkin-row') || input.parentElement;
  if (!wrap) return;
  let err = wrap.querySelector(':scope > .field-error');
  if (!err) {
    err = document.createElement('div');
    err.className = 'field-error';
    wrap.appendChild(err);
  }
  err.textContent = msg || '';
}
function clearFieldError(input){
  if (!input) return;
  input.classList.remove('input-error');
  input.removeAttribute('aria-invalid');
  const wrap = input.closest('.field, .form-row, .checkin-row') || input.parentElement;
  if (!wrap) return;
  const err = wrap.querySelector(':scope > .field-error');
  if (err) err.remove();
}
function clearAllFieldErrors(scope){
  (scope || document).querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));
  (scope || document).querySelectorAll('.field-error').forEach(el => el.remove());
}
// 输入即清除该字段错误（轻量样式更新，不触发 render/saveStore —— ux-26）
function autoClearFieldError(scope){
  (scope || document).querySelectorAll('input, textarea, select').forEach(el => {
    el.addEventListener('input', () => clearFieldError(el));
    el.addEventListener('change', () => clearFieldError(el));
  });
}
/* ux-17：空状态引导按钮——平滑滚动到录入表单并聚焦第一个输入框 */
function scrollToEntryForm(focusSel){
  const p = cur();
  const exercise = p && p.type === 'exercise';
  const target = exercise ? $('#checkinSection') : $('#reciteForm');
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => {
    const el = $(focusSel);
    if (el) { try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } }
  }, 380);
}
/* ux-18：在复习/记录列表位置渲染 n 条 shimmer 骨架条（数据到达后 render() 自动替换） */
function showListShimmer(n){
  const total = n || 4;
  const row = '<li class="shimmer-row">'
    + '<span class="shimmer-block date"></span>'
    + '<span class="shimmer-block page"></span>'
    + '<span class="shimmer-block delta"></span>'
    + '<span class="shimmer-block del"></span>'
    + '</li>';
  const html = new Array(total + 1).join(row);
  const rl = $('#reviewList'); if (rl && !$('#reviewSection').hidden) rl.innerHTML = html;
  const rec = $('#recordList'); if (rec) rec.innerHTML = html;
}
/* ---- 删除撤销 ---- */
let undoState = null;
let undoTimer = null;
let undoTicks = null;
const UNDO_MS = 5000;

function showUndo(text, undoFn) {
  const bar = $('#undoBar');
  $('#undoText').textContent = text;
  bar.hidden = false;
  undoState = undoFn;
  if (undoTimer) clearTimeout(undoTimer);
  if (undoTicks) clearInterval(undoTicks);
  const t0 = Date.now();
  const paint = () => {
    const remain = Math.max(0, UNDO_MS - (Date.now() - t0));
    $('#undoCount').textContent = Math.ceil(remain / 1000) + 's';
    $('#undoProg').style.width = (remain / UNDO_MS * 100) + '%';
  };
  paint();
  undoTicks = setInterval(paint, 100);
  undoTimer = setTimeout(() => {
    bar.hidden = true;
    undoState = null;
    if (undoTicks) clearInterval(undoTicks);
  }, UNDO_MS);
}

$('#undoBtn').addEventListener('click', () => {
  if (!undoState) return;
  try { undoState(); } catch (e) {}
  $('#undoBar').hidden = true;
  undoState = null;
  if (undoTimer) clearTimeout(undoTimer);
  if (undoTicks) clearInterval(undoTicks);
});

function checkMilestones(p, m) {
  const pct = m.total > 0 ? m.currentPage / m.total * 100 : 0;
  if (!Array.isArray(p.shownMilestones)) p.shownMilestones = [];
  const pending = MILESTONES.filter(ms => pct >= ms.at && !p.shownMilestones.includes(ms.at));
  if (!pending.length) return;
  pending.forEach(ms => p.shownMilestones.push(ms.at));
  saveStore();
  const latest = pending[pending.length - 1];
  // 因材施教：百分比语义随模式不同（刷题=完成、背书=背完、错题=攻克），鼓励语也贴合各自任务
  const verbWord = p.type === 'mistake' ? '攻克' : p.type === 'recite' ? '背完' : '完成';
  const title = latest.at === 100
    ? (p.type === 'mistake' ? '全部攻克！' : p.type === 'recite' ? '全部背完！' : '全部完成！')
    : `${verbWord} ${latest.at}%！`;
  const descByType = {
    exercise: {
      25: '已经推进四分之一，节奏很稳，继续保持。',
      50: '进度过半，最容易松劲的阶段，坚持住就赢了一半。',
      70: '胜利在望，保持节奏，别停下来。',
      90: '只剩最后一程，一鼓作气。',
      100: '全部刷完了，好好犒劳一下自己。'
    },
    recite: {
      25: '已经背完四分之一，记得定期复习，节奏很稳。',
      50: '过半了，新学的同时别忘了回头复习。',
      70: '胜利在望，越到后面越要靠复习巩固。',
      90: '最后一程，新学加复习一起冲。',
      100: '全部背完了，接下来保持复习就不会忘。'
    },
    mistake: {
      25: '已经攻克四分之一的错题，它们正在变成你最稳的得分点。',
      50: '攻克过半，你已经填平了一半曾经的薄弱点。',
      70: '只剩三成错题，胜利在望。',
      90: '只剩最后一成，把它们彻底拿下。',
      100: '收录的错题全部攻克，这些曾经的坑都被你填平了。'
    }
  };
  const desc = (descByType[p.type] && descByType[p.type][latest.at]) || latest.desc;
  setTimeout(() => showToast(latest.icon, title, desc), 450);
}

/* ============ 错题即时反馈：攻克正强化 + 反复错去羞耻化（均按天限频，避免刷屏） ============ */
const __mistakeFbToday = {};     // key: projectId:date:kind → true
const __milestoneFiredToday = {}; // key: projectId:date → true（今天是否已触发百分比里程碑，交给它庆祝）
const _fbKey = (p, kind) => p.id + ':' + todayStr() + ':' + kind;
const _msKey = (p) => p.id + ':' + todayStr();

// 攻克错题：每天首次攻克时强化"实打实进步"；若当天已触发百分比里程碑（25%/50%…），则把庆祝交给里程碑，不重复弹
function checkMistakeMasteryToast(p) {
  if (!p || p.type !== 'mistake') return;
  if (__mistakeFbToday[_fbKey(p, 'master')]) return;
  const today = todayStr();
  const masteredToday = (p.items || []).filter(it => it.masteredDate === today && !it.manualMastered).length;
  if (masteredToday <= 0) return;
  __mistakeFbToday[_fbKey(p, 'master')] = true;
  if (__milestoneFiredToday[_msKey(p)]) return; // 百分比里程碑已给出更强的庆祝
  const title = masteredToday >= 2 ? `今天攻克 ${masteredToday} 道错题` : '又攻克一道错题';
  const desc = masteredToday >= 2
    ? '这些曾经的薄弱点，今天都变成了你的得分点。'
    : '这个薄弱点你彻底拿下了——比刷十道新题更值。';
  setTimeout(() => showToast('🎯', title, desc, 3000), 650);
}

// 反复错（连续 2 次及以上"又错了"）：去羞耻化，把它框定为"考前发现的高频薄弱点"，每个项目每天最多提示一次
function checkMistakeRelapseToast(p, item) {
  if (!p || p.type !== 'mistake' || !item) return;
  if (__mistakeFbToday[_fbKey(p, 'relapse')]) return;
  if ((item.wrongStreak || 0) < 2) return;
  __mistakeFbToday[_fbKey(p, 'relapse')] = true;
  setTimeout(() => showToast('🔍', '这道题反复卡住',
    '说明它是你的高频薄弱点，考前能发现它很值。已排到最近，多过两次就拿下了。', 4800), 520);
}

/* ============ 录入时的学习效果 + 预览 ============ */
let reciteQuality = null;
function gapForQuality(quality, intervals) {
  const first = intervals[0] || 1;
  if (quality === 'fuzzy') return Math.max(1, Math.round(first / 2));
  if (quality === 'forgot') return 1;
  if (quality === 'good') return first;
  return null;
}
function setupReciteQuality() {
  const wrap = $('#reciteQuality');
  if (!wrap || wrap.dataset.bound) return;
  wrap.dataset.bound = '1';
  wrap.querySelectorAll('.rec-qbtn').forEach(btn => {
    btn.addEventListener('click', () => {
      reciteQuality = btn.dataset.q;
      wrap.querySelectorAll('.rec-qbtn').forEach(b => b.classList.toggle('active', b === btn));
      updateRecitePreview();
    });
  });
}
function renderStageOptions(p) {
  setupReciteQuality();
  if (!p) return;
  const labels = p.type === 'mistake'
    ? { good: '做对', fuzzy: '看答案', forgot: '错了' }
    : { good: '记得', fuzzy: '模糊', forgot: '忘记' };
  const wrap = $('#reciteQuality');
  if (wrap) wrap.querySelectorAll('.rec-qbtn').forEach(b => { b.textContent = labels[b.dataset.q]; });
  const outer = wrap?.closest('.field')?.querySelector('span');
  if (outer) outer.textContent = p.type === 'mistake' ? '本次订正效果' : '本次学习效果';
}

function updateRecitePreview() {
  const p = cur();
  if (!p || p.type === 'exercise') return;
  const intervals = getIntervals(p);
  const date = $('#reciteDate').value || todayStr();
  const preview = $('#recitePreview');
  preview.classList.remove('overdue', 'mastered');
  const qLabels = p.type === 'mistake'
    ? { good: '做对了', fuzzy: '看答案', forgot: '错了' }
    : { good: '记得', fuzzy: '模糊', forgot: '忘记' };
  if (!reciteQuality) {
    preview.innerHTML = `请选择本次学习效果（${qLabels.good} / ${qLabels.fuzzy} / ${qLabels.forgot}）`;
    return;
  }
  const gap = gapForQuality(reciteQuality, intervals);
  const next = addDays(date, gap);
  const daysFromNow = diffDays(todayStr(), next);
  const qLabel = qLabels[reciteQuality];
  if (daysFromNow < 0) {
    preview.classList.add('overdue');
    preview.innerHTML = `学习效果：${qLabel}，将进入「今日复习」`;
  } else {
    preview.innerHTML = `学习效果：${qLabel}，提交后系统会自动安排再次复习`;
  }
}

/* ============ 大数字渲染：按字符长度自动降档字号，极端数值也不会撑破卡片 ============ */
function _setBigNum(el, num, unit) {
  if (num === null || num === undefined || num === '—' || num === '') {
    el.textContent = '—';
    el.classList.remove('num-sm', 'num-xs');
    return;
  }
  el.innerHTML = `${num}<small>${unit}</small>`;
  const len = String(num).replace(/[.,\s]/g, '').length;
  el.classList.toggle('num-sm', len >= 5 && len < 7);
  el.classList.toggle('num-xs', len >= 7);
}

/* ============ 今日目标：进度条 + 状态化鼓励 ============ */
function _dgShow(box, fill, line, praise, mood, pct, l, pr) {
  box.hidden = false;
  box.className = 'daily-goal dg-' + mood;
  praise.className = 'dg-praise dg-' + mood;
  fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
  line.textContent = l;
  praise.textContent = pr;
}

/* 在第三张"目标"卡片内，显示今天已做多少 / 还差多少 / 超额多少，并按状态给不同鼓励 */
function renderDailyGoal(p, m) {
  const box = document.getElementById('dailyGoalBox');
  const fill = document.getElementById('dgFill');
  const line = document.getElementById('dgLine');
  const praise = document.getElementById('dgPraise');
  if (!box) return;
  const u = unitName(p);
  const today = todayStr();
  const doneAll = m.currentPage > 0 && m.remaining === 0;
  // 连续天数统一用"活动日"口径（复习/收录/攻克/打卡都算今天学了），避免错题本只复习未攻克时连续清零
  const act = getActivityStreak(p, today);

  /* ---- 错题本：按"今日待解决条数"统计，不看累计页数 ---- */
  if (p.type === 'mistake') {
    const due = getDueItems(p).length;
    let reviewedToday = 0;
    (p.items || []).forEach(it => {
      const revs = it.reviews || [];
      if (revs.length >= 2 && revs[revs.length - 1].date === today) reviewedToday++;
    });
    if (doneAll) {
      _dgShow(box, fill, line, praise, 'done-all', 100, '都完成了', '恭喜拿下整个目标，好好犒劳一下自己~');
      return;
    }
    // 今天清完了但 due=0（最后一条刚做完），也展示一下清零鼓励
    if (due <= 0 && reviewedToday > 0) {
      _dgShow(box, fill, line, praise, 'done', 100, `今天复习了 ${reviewedToday} 条`, '今日错题已全部过完，可以收了~');
      return;
    }
    if (due <= 0) {
      _dgShow(box, fill, line, praise, 'idle', 0, '今天没有到期错题', '📝 暂无到期错题，遇到新错题随时收录~');
      return;
    }
    // 注意：due 是"此刻仍待复习"的条数，已复习的会因 nextReviewDate 被推到未来而离开 due，
    // 所以今日总量 = 剩余 due + 今天已复习，不能直接拿 due 当分母（否则越复习进度越"虚高"）。
    const totalDueToday = due + reviewedToday;
    const pct = totalDueToday > 0 ? Math.min(100, reviewedToday / totalDueToday * 100) : 0;
    if (reviewedToday === 0) {
      const tip = (act.streak >= 2)
        ? Coach.pick(Coach.streak.warm, 'mks') + ` 先从最久没复习的那条开始~`
        : Coach.pick(Coach.progress.early, 'mks0') + ` 从第一条开始~`;
      _dgShow(box, fill, line, praise, 'idle', 0, `今天还有 ${due} 条错题待复习`, tip);
    } else {
      const left = due;
      const ratio = totalDueToday > 0 ? reviewedToday / totalDueToday : 0;
      let mood, tip;
      if (ratio < 0.34) {
        mood = 'progress'; tip = Coach.pick(Coach.progress.early, 'mke') + ` 还剩 ${left} 条~`;
      } else if (ratio < 0.7) {
        mood = 'progress'; tip = Coach.pick(Coach.progress.mid, 'mkm') + ` 还剩 ${left} 条~`;
      } else {
        mood = 'almost'; tip = Coach.pick(Coach.progress.late, 'mkl') + ` 只剩 ${left} 条~`;
      }
      _dgShow(box, fill, line, praise, mood, pct, `已清 ${reviewedToday} / ${totalDueToday} 条`, tip);
    }
    return;
  }

  /* ---- 背书本：复习优先、再学新。复习也是今日学习，复习推进就要计入进度，
     避免"复习了 4 条却显示还没动"。今日目标分两段：① 到期复习（条）② 新学页。 ---- */
  if (p.type === 'recite') {
    const rvDueNow = getDueItems(p).length;
    let rvDoneToday = 0;
    (p.items || []).forEach(it => {
      const revs = it.reviews || [];
      // 与错题同口径：今天对该条做过复习（reviews[0] 是首次学习，至少 2 条且最后一次在今天）
      if (revs.length >= 2 && revs[revs.length - 1].date === today) rvDoneToday++;
    });
    const rvTotal = rvDueNow + rvDoneToday;
    // 新学目标：m.perStudyDay 已按"新学窗口（目标日−完整复习周期）"折算——个性化后用真实节奏，
    // 冷启动也由 getMetrics 按每周 5 个学习日先验给出，故不会把新学误摊到含复习期的全程（前松后紧）。
    // stretch/impossible 时改用与状态卡、看板同源的"最省力按期方案"，避免三处数字打架。
    let newTarget = getDailyTarget(p, m).per;
    // 极端兜底（无截止日等）：退到自然日均摊
    if (newTarget == null && isFinite(m.needPerDay) && m.needPerDay > 0) newTarget = m.needPerDay;
    // 冲刺期不再给固定新学页数（统一"复习优先、挑重点"），避免与冲刺策略冲突、制造额外压力
    if (m.sprint) newTarget = null;
    // 新学与复习联动：每日总容量（条）已含"新学+复习"，复习占用后剩余的才是新学，
    // 复习高峰日新学自动减少、复习少的日子补新学，避免"复习一堆还要求学新 N 页"；
    // 新学欠账会由 perStudyDay/按期均摊在新学窗口内自动追赶，不把压力抛给用户。
    if (newTarget != null) {
      const dayCap = getDailyCapacity(p);
      if (dayCap > 0) {
        const learned = (p.items || []).filter(it => it.learnedDate && it.pageStart != null && it.pageEnd != null);
        let avgPages = 1;
        if (learned.length) {
          const pages = learned.reduce((s, it) => s + Math.max(0, it.pageEnd - it.pageStart + 1), 0);
          avgPages = Math.max(0.5, pages / learned.length);
        }
        const roomItems = Math.max(0, dayCap - rvTotal);
        newTarget = Math.max(0, Math.min(newTarget, roomItems * avgPages));
      }
    }
    const newTargetR = newTarget != null ? Math.round(newTarget * 10) / 10 : null;
    const newDone = m.todayDone || 0;
    const newDoneR = Math.round(newDone * 10) / 10;

    if (doneAll) {
      _dgShow(box, fill, line, praise, 'done-all', 100, '都背完了', '恭喜拿下整个目标，好好犒劳一下自己~');
      return;
    }

    // 阶段一：还有到期复习没清完——复习优先，进度条只反映复习
    if (rvDueNow > 0) {
      const pct = rvTotal > 0 ? Math.min(100, rvDoneToday / rvTotal * 100) : 0;
      let mood, pr;
      if (rvDoneToday === 0) {
        mood = 'idle';
        pr = (act.streak >= 2)
          ? Coach.pick(Coach.streak.warm, 'rvs') + ' 先从最久没复习的那条开始~'
          : Coach.pick(Coach.progress.early, 'rvs0') + ' 先复习再学新，从第一条开始~';
      } else {
        const rr = rvDoneToday / Math.max(1, rvTotal);
        if (rr < 0.5) { mood = 'progress'; pr = Coach.pick(Coach.progress.early, 'rve') + ` 还剩 ${rvDueNow} 条~`; }
        else if (rr < 0.7) { mood = 'progress'; pr = Coach.pick(Coach.progress.mid, 'rvm') + ` 还剩 ${rvDueNow} 条~`; }
        else { mood = 'almost'; pr = Coach.pick(Coach.progress.late, 'rvl') + ` 复习只剩 ${rvDueNow} 条~`; }
      }
      let tail;
      if (m.sprint) tail = '（复习优先，新学挑重点即可）';
      else if (newTargetR == null) tail = '';
      else if (newTargetR > 0.3) tail = `（之后再学新约 ${fmtUnitNum(newTargetR)} 页）`;
      else tail = '（今天复习是重点，新学量力而行）';
      _dgShow(box, fill, line, praise, mood, pct, `复习 ${rvDoneToday}/${rvTotal} 条${tail}`, pr);
      return;
    }

    // 阶段二：今天复习已清完（或本就无复习），进度转向新学页
    const prefix = rvDoneToday > 0 ? '复习已清 ✓ · ' : '';
    if (newTargetR == null || newTargetR <= 0) {
      if (rvDoneToday > 0) {
        _dgShow(box, fill, line, praise, 'done', 100, `今日复习 ${rvDoneToday} 条已清完`, '✅ 今天的复习都过完了，有余力可以学一点新内容~');
      } else {
        _dgShow(box, fill, line, praise, 'idle', 0, '今天没有安排复习', '💡 可以学一点新内容，或先休息~');
      }
      return;
    }
    const nr = newDone / newTarget;
    const npct = Math.min(100, nr * 100);
    let nmood, nl, npr;
    if (newDone <= 0) {
      nmood = 'idle';
      nl = `${prefix}新学 0 / ${fmtUnitNum(newTargetR)} 页`;
      npr = (act.streak >= 3)
        ? `🔥 连续 ${act.streak} 天，复习已清，今天的新学也别落下~`
        : `🎯 复习已清，今天再学 ${fmtUnitNum(newTargetR)} 页就圆满了~`;
    } else if (nr < 1) {
      const nleft = Math.max(0, Math.round((newTarget - newDone) * 10 + 1e-9) / 10);
      nl = `${prefix}新学 ${fmtUnitNum(newDoneR)} / ${fmtUnitNum(newTargetR)} 页`;
      if (nr < 0.5) {
        // “就过半”的剩余量 = 到新学目标一半的量（newTarget/2 - newDone），而非到全部完成的量
        const nToHalf = Math.max(0, Math.round((newTarget / 2 - newDone) * 10 + 1e-9) / 10);
        nmood = 'progress'; npr = Coach.pick(Coach.progress.early,'rne') + ` 再学 ${fmtUnitNum(nToHalf)} 页就过半~`;
      }
      else { nmood = 'almost'; npr = Coach.pick(Coach.progress.late,'rnl') + ` 就差 ${fmtUnitNum(nleft)} 页~`; }
    } else if (Math.abs(nr - 1) < 1e-9) {
      nmood = 'done';
      nl = `${prefix}新学 ${fmtUnitNum(newDoneR)} / ${fmtUnitNum(newTargetR)} 页`;
      npr = Coach.pick(Coach.done, 'rnd');
    } else {
      const over = Math.max(0, Math.round((newDone - newTarget) * 10 + 1e-9) / 10);
      nmood = 'over';
      nl = `${prefix}新学 ${fmtUnitNum(newDoneR)} / ${fmtUnitNum(newTargetR)} 页（超 ${fmtUnitNum(over)}）`;
      npr = Coach.pick(Coach.overSmall, 'rno') + Coach.pick([
        ' 给后续复习留点空间~',
        ' 新学和复习均衡些，记忆更牢~',
        ' 别一次铺太多，后面复习更从容~',
      ], 'rno2');
    }
    _dgShow(box, fill, line, praise, nmood, npct, nl, npr);
    return;
  }
  // stretch/impossible 时与看板、状态卡同源（最省力按期方案）；其余按当前预测频率
  const dt0 = getDailyTarget(p, m);
  const target = (dt0.per != null && dt0.per > 0) ? dt0.per
              : (isFinite(m.needPerDay) && m.needPerDay > 0) ? m.needPerDay
              : null;
  if (doneAll) {
    _dgShow(box, fill, line, praise, 'done-all', 100, '全部完成', '恭喜你拿下整个目标，好好犒劳一下自己~');
    return;
  }
  if (target == null || target <= 0) {
    _dgShow(box, fill, line, praise, 'idle', 0, '当前未设置每日目标', '💡 先做几天，系统会按你的节奏自动计算目标~');
    return;
  }

  const done = m.todayDone || 0;
  const targetR = Math.round(target * 10) / 10;
  const doneR = Math.round(done * 10) / 10;
  const ratio = target > 0 ? done / target : 0;
  const pct = Math.min(100, ratio * 100);

  let mood, l, pr;
  // 启动量：套卷为最小单位 1 套；当目标本身不足 1 套/学习日（如 0.3 套，约几天一套）时，
  // 明确"今天做 1 套就够"，避免与"0.3 套/天"的目标自相矛盾、让用户误以为要补量。
  const isFracPaper = u === '套' && targetR < 1;
  const startUnit = Math.max(1, Math.round(targetR*0.3));
  const slot = coachSlot();
  if (done <= 0) {
    mood = 'idle';
    l = `今天目标 ${fmtUnitNum(targetR)} ${u} · 还没动`;
    const gap = m.prevStudyDate ? Math.max(0, diffDays(m.prevStudyDate, today) - 1) : 0;
    if (m.feasibility === 'impossible') {
      pr = `💪 今天 ${fmtUnitNum(targetR)} ${u}量不小，拆成几次完成，量力而行~`;
    } else if (dt0.heavy) {
      pr = `⚠️ 今天约 ${fmtUnitNum(targetR)} ${u}（平时的 ${dt0.plan.onTime.mult.toFixed(1)} 倍）是冲刺量，量力而行；做不到可在设置里把目标日往后调~`;
    } else if (gap >= 2) {
      pr = Coach.pick(Coach.back, 'back') + (isFracPaper ? ` 今天做 ${startUnit} 套就好~` : ` 先从 ${startUnit} ${u}开始~`);
    } else if (act.streak >= 3) {
      pr = Coach.pick(Coach.streak.hot, 'streak') + (isFracPaper ? ` 今天做 ${startUnit} 套就好~` : ` 先从 ${startUnit} ${u}开始~`);
    } else if (!m.enoughData) {
      pr = Coach.pick(Coach.cold, 'cold') + ` 今天先做约 ${fmtUnitNum(targetR)} ${u}~`;
    } else if (m.feasibility === 'stretch') {
      pr = Coach.pick(Coach.start[slot], 'stretch') + ` 目标 ${fmtUnitNum(targetR)} ${u}，状态好时多做一点~`;
    } else {
      pr = Coach.pick(Coach.start[slot], 'start') + ` 目标 ${fmtUnitNum(targetR)} ${u}~`;
    }
  } else if (ratio < 1) {
    const left = Math.max(0, Math.round((target - done) * 10 + 1e-9) / 10);
    l = `已做 ${fmtUnitNum(doneR)} / ${fmtUnitNum(targetR)} ${u}`;
    if (ratio < 0.34) {
      // “就过半”的剩余量 = 到目标一半的量（target/2 - done），而非到全部完成的量（target - done）
      const toHalf = Math.max(0, Math.round((target / 2 - done) * 10 + 1e-9) / 10);
      mood = 'progress'; pr = Coach.pick(Coach.progress.early, 'pe') + ` 再做 ${fmtUnitNum(toHalf)} ${u}就过半~`;
    } else if (ratio < 0.7) {
      mood = 'progress'; pr = Coach.pick(Coach.progress.mid, 'pm') + ` 还剩 ${fmtUnitNum(left)} ${u}~`;
    } else {
      mood = 'almost'; pr = Coach.pick(Coach.progress.late, 'pl') + ` 就差 ${fmtUnitNum(left)} ${u}~`;
    }
  } else if (Math.abs(ratio - 1) < 1e-9) {
    mood = 'done';
    l = `已做 ${fmtUnitNum(doneR)} / ${fmtUnitNum(targetR)} ${u}`;
    pr = Coach.pick(Coach.done, 'done');
  } else {
    const over = Math.max(0, Math.round((done - target) * 10 + 1e-9) / 10);
    const overPct = Math.round((ratio - 1) * 100);
    mood = 'over';
    l = `已做 ${fmtUnitNum(doneR)} / ${fmtUnitNum(targetR)} ${u}（超 ${fmtUnitNum(over)}）`;
    if (overPct < 20) pr = Coach.pick(Coach.overSmall, 'os');
    else if (overPct < 60) pr = Coach.pick(Coach.overMid, 'os2') + ` 超额${overPct}%~`;
    else pr = Coach.pick(Coach.overBig, 'ob') + ` 超额${overPct}%~`;
  }
  _dgShow(box, fill, line, praise, mood, pct, l, pr);
}

/* ============ 主渲染 ============ */
function render() {
  const p = cur();
  if (!p) {
    document.title = 'Study Tracker';
    $('#welcome').hidden = false;
    $('#app').hidden = true;
    lastRenderedProjectId = null;
    return;
  }
  // 自动均衡：均匀模式下今日待复习超过舒适量时，自动把超额条目均匀摊到未来若干天（每项目每天最多一次）
  try {
    // 清理过期未做的“提前复习”（点了但没做，第二天自动回到原计划日期，不惩罚）
    cleanupExpiredEarlyPulls(p);
    // 背书冲刺期：先把已排到考试之后的沉睡条目拉回考前（classic/balanced 都需要）
    if (p.type === 'recite') {
      const _sprintMoved = rebalanceForSprint(p);
      if (_sprintMoved > 0) saveStore();
    }
    let _ens = 0;
    if (p.type === 'mistake') { _ens = ensureAtLeastOneReview(p); if (_ens > 0) saveStore(); }
    const _moved = autoBalanceIfNeeded(p);
    let _pulled = 0;
    // pullForwardIfNeeded 内部无论是否拉题都会写 lastPullForwardDate，这里统一 saveStore 落盘
    if (p.type === 'mistake') { _pulled = pullForwardIfNeeded(p); saveStore(); }
    let _settled = 0;
    if (p.type === 'mistake') { _settled = settleToday(p); if (_settled > 0) saveStore(); }
    if (_moved > 0) {
      const _abKey = p.id + ':' + todayStr();
      if (!__autoBalanceToastShown[_abKey]) {
        __autoBalanceToastShown[_abKey] = true;
        setTimeout(() => showToast('⚖️', '已自动均衡今日复习', `检测到今天待复习偏多，已把 ${_moved} 条均匀安排到未来几天，避免今天堆积；你也可以在复习区横幅手动调整。`, 3500), 450);
      }
    }
    if (_pulled > 0) {
      const _pfKey = p.id + ':pf:' + todayStr();
      if (!__autoBalanceToastShown[_pfKey]) {
        __autoBalanceToastShown[_pfKey] = true;
        setTimeout(() => showToast('⏩', '趁前期多推进一点', `已把 ${_pulled} 条近期复习提前到今天，前期多消化一些，后面新增错题时会更从容～不想多做也可以顺延，不勉强。`, 3500), 600);
      }
    }
  } catch (e) {}
  // 任务切换时的轻微淡入反馈
  if (lastRenderedProjectId !== p.id) {
    const app = $('#app');
    if (app) {
      app.classList.remove('app-switch');
      void app.offsetWidth; // 触发重排以重启动画
      app.classList.add('app-switch');
    }
    lastRenderedProjectId = p.id;
    // 首次进入错题本时弹出功能引导
    if (p.type === 'mistake' && !store.mistakeGuided) {
      setTimeout(() => {
        $('#mistakeGuideMask').hidden = false;
        modalTop($('#mistakeGuideMask'));
      }, 300);
    }
    // 关联刷题本结构变更检测
    if (p.type === 'mistake' && p.refProjectId && !p.__refStale) {
      const ref = store.projects[p.refProjectId];
      if (ref && !structuresMatch(p, ref)) {
        p.__refStale = true;
        setTimeout(() => {
          const bodyHtml = `
            <div style="font-size:13.5px;line-height:1.8;color:var(--text)">
              <p style="margin:0 0 10px">关联的刷题本「${esc(ref.name)}」结构已变更，错题本结构需要重新对齐。</p>
              <div style="display:flex;gap:10px">
                <button type="button" class="ghost-btn" id="refRealignBtn" style="flex:1">🔄 重新对齐</button>
                <button type="button" class="ghost-btn" id="refUnlinkBtn" style="flex:1">🔗 解除关联</button>
              </div>
            </div>`;
          showGenericConfirm('关联结构已变更', bodyHtml, '取消', null);
          setTimeout(() => {
            const rb = $('#refRealignBtn');
            const ub = $('#refUnlinkBtn');
            if (rb) rb.addEventListener('click', () => {
              $('#genericConfirmMask').hidden = true; unlockBodyScroll();
              applyRefStructure(p, ref);
              p.__refStale = false;
              saveStore();
              render();
              showToast('✅', '已重新对齐', '错题已按新结构归类。', 3000);
            });
            if (ub) ub.addEventListener('click', () => {
              $('#genericConfirmMask').hidden = true; unlockBodyScroll();
              p.refProjectId = null;
              p.__refStale = false;
              saveStore();
              render();
              showToast('✅', '已解除关联', '单元结构保留。', 3000);
            });
          }, 50);
        }, 500);
      }
    }
  }
  $('#welcome').hidden = true;
  $('#app').hidden = false;

  // 每天第一次打开自动弹出今日总览（老用户，新用户不弹）
  try {
    const projectCount = Object.keys(store.projects || {}).length;
    const lastDash = getLocalVal('dash_auto_date', '');
    if (projectCount > 0 && lastDash !== todayStr()) {
      setLocalVal('dash_auto_date', todayStr());
      // 等首屏其他弹窗（备份/数据安全等）关掉后再弹
      const tryShow = (attempt) => {
        if (typeof anyModalOpen === 'function' && anyModalOpen()) {
          if (attempt < 20) setTimeout(() => tryShow(attempt + 1), 300); // 最多等6秒
          return;
        }
        if ($('#dashMask').hidden) openDashboard();
      };
      setTimeout(() => tryShow(0), 800);
    }
  } catch (e) {}

  const m = getMetrics(p);
  lastMetrics = { m, p };
  const type = TYPES[p.type] || TYPES.exercise;

  let dlText = p.deadline ? fmtCN(p.deadline) : '未设置';
  if (p.deadline) {
    if (m.daysLeft > 0) dlText += ` · 还有 ${m.daysLeft} 天`;
    else if (m.daysLeft === 0) dlText += ' · 就是今天';
    else dlText += ` · 已过期 ${-m.daysLeft} 天`;
  }
  $('#deadlineLabel').textContent = p.deadline ? `目标：${p.deadline}（${dlText}）` : '目标：未设置';
  // 自由出处错题本没有"截止日"概念，未设置时直接隐藏目标行，避免显示无意义的"未设置"
  $('#deadlineLabel').style.display = (!p.deadline && p.type === 'mistake' && (!p.mistakeMode || p.mistakeMode === 'free')) ? 'none' : '';

  const isExercise = p.type === 'exercise';
  const setMode = isSetMode(p);
  const u = unitName(p);
  let modeTag = '';
  if (isExercise) {
    modeTag = setMode ? '<span class="mode-badge set">📑 套卷模式</span>' : '<span class="mode-badge">📄 习题册模式</span>';
  } else if (p.type === 'mistake') {
    const mm = p.mistakeMode || 'free';
    if (mm === 'page') modeTag = '<span class="mode-badge">📄 习题册模式</span>';
    else if (mm === 'set') modeTag = '<span class="mode-badge set">📑 套卷模式</span>';
    else modeTag = '<span class="mode-badge mistake-free" id="mistakeModeBadge" style="cursor:pointer" title="点击切换错题本模式">📝 自由出处模式</span>';
  }
  // 关联徽标
  let linkBadge = '';
  if (p.type === 'mistake' && p.refProjectId && store.projects[p.refProjectId]) {
    const refName = store.projects[p.refProjectId].name;
    const short = refName.length > 10 ? refName.substring(0, 10) + '…' : refName;
    linkBadge = `<span class="linked-badge" title="关联刷题本：${esc(refName)}">🔗 关联：${esc(short)}</span>`;
  } else if (p.type === 'exercise') {
    const linkedCount = Object.values(store.projects).filter(o => o.type === 'mistake' && o.refProjectId === p.id).length;
    if (linkedCount > 0) {
      linkBadge = `<span class="linked-badge" title="${linkedCount}个关联错题本">🔗 ${linkedCount}个关联错题本</span>`;
    }
  }
  $('#bookTitle').textContent = p.name;
$('#headBadges').innerHTML = `<span class="type-badge ${type.badgeCls}">${type.icon} ${type.name}</span>${modeTag}${linkBadge}`;

  $('#btnWeakness').style.display = isExercise ? 'none' : '';
  const guideBtn = $('#btnMistakeGuide');
  if (guideBtn) guideBtn.hidden = p.type !== 'mistake';
  // 关联刷题本按钮：仅错题本page/set模式且未关联时显示
  const linkBtn = $('#btnLinkRef');
  if (linkBtn) {
    linkBtn.hidden = !(p.type === 'mistake' && (isMistakePageMode(p) || isMistakeSetMode(p)) && !p.refProjectId);
  }
  // 关联错题本按钮：仅刷题本显示，显示已关联数量
  const linkedBtn = $('#btnLinkedMistakes');
  if (linkedBtn) {
    linkedBtn.hidden = p.type !== 'exercise';
    if (p.type === 'exercise') {
      const linkedCount = Object.values(store.projects).filter(o => o.type === 'mistake' && o.refProjectId === p.id).length;
      linkedBtn.textContent = linkedCount > 0 ? `🔗 ${linkedCount}个关联错题本` : '🔗 关联错题本';
    }
  }
  $('#btnProgress').style.display = isExercise ? '' : 'none';
  $('#exerciseForm').hidden = !isExercise || setMode;
  $('#setForm').hidden = !setMode;
  $('#reciteForm').hidden = isExercise;
  renderReasonDropdown(p);
  $('#reciteErrTagWrap').hidden = (p.type !== 'mistake');
  // 内容输入与提交按钮按类型措辞
  const contentLab = $('#reciteContentLabel');
  if (contentLab) contentLab.textContent = p.type === 'mistake' ? '错题 / 知识点' : '学习内容';
  const contentInput = $('#reciteContent');
  if (contentInput) contentInput.placeholder = p.type === 'mistake'
    ? '例：线代第3题 · 特征值计算'
    : '例：第一章 极限的定义与性质';
  $('#btnReciteAdd').textContent = p.type === 'mistake' ? '+ 记录错题' : '+ 添加内容';
  $('#checkinTitle').textContent = isExercise ? '今日打卡' : (p.type === 'mistake' ? '📝 登记 / 补录错题' : '📖 学习 / 补录内容');
  const noteInput = $('#reciteNote');
  if (p.type === 'mistake') {
    noteInput.placeholder = '例：这道线代题第二问总是卡，多练同类';
  } else {
    noteInput.placeholder = '例：马原第二章矛盾论还混，下次重点看';
  }
  const qBtns = document.querySelectorAll('#reciteQuality .rec-qbtn');
  const qText = p.type === 'mistake' ? ['做对了', '看答案', '错了'] : ['记得', '模糊', '忘记'];
  qBtns.forEach((b, i) => { b.textContent = qText[i]; b.dataset.q = ['good','fuzzy','forgot'][i]; });
  if (isExercise && !setMode) applyPageModeUI();
  if (setMode) {
    if (!$('#inSetDate').value) $('#inSetDate').value = m.t;
    syncSetFormUI(p);
  }
  $('#checkinHint').textContent = !isExercise
    ? (p.type === 'mistake'
      ? (isMistakePageMode(p)
        ? '每次做错题后登记进来，填写错题所在页码（可填范围）。答对了自动推进复习间隔，看答案不进不退，错了自动打回前几轮。'
        : isMistakeSetMode(p)
          ? '每次做错题后登记进来，填写错题来自第几套卷。答对了自动推进复习间隔，看答案不进不退，错了自动打回前几轮。'
          : '每次做错题后登记进来，"出处"可自由填写它来自哪套卷/哪本书哪页（选填）。答对了自动推进复习间隔，看答案不进不退，错了自动打回前几轮。')
      : '每次学完新内容或补录旧内容都在这里登记。页码可以填一个范围。复习评价（记得/模糊/忘记）用来标记掌握程度。')
    : setMode
      ? (getPaperSections(p).length
        ? '选「整套」即完成一整套；或选某个板块并填写这次完成的百分比，同一套可分多次、跨日期补齐。进度按板块权重计算。'
        : '只填套号即完成一整套；只做了部分就补「做了几题 / 共几题」，同一套可分多次补到整套。支持补录过去日期。')
      : '顺序刷题只填结束页即可（学到第几页）；跳着学（先学后面再补前面）时点「按区间录入」补起始页。也可选过去日期补录。';

  if (!isExercise) {
    renderReview(p);
    renderStageOptions(p);
    updateRecitePreview();
  } else {
    $('#reviewSection').hidden = true;
    const _hh = $('#honestHint'); if (_hh) _hh.hidden = true;
  }

  if (isExercise) {
    // 环形进度图
    const pct = m.total > 0 ? Math.min(100, m.currentPage / m.total * 100) : 0;
    const circumference = 2 * Math.PI * 32.5; // r=32.5
    $('#ringPct').textContent = Math.round(pct) + '%';
    $('#ringLab').textContent = '已完成';
    $('#ringFg').style.strokeDashoffset = circumference * (1 - pct / 100);
    // 右侧剩余信息
    $('#mergedSummary').textContent = `共 ${fmtUnitNum(m.total)} ${u} · 剩 ${fmtUnitNum(m.remaining)} ${u}`;
    if (m.remaining === 0 && m.currentPage > 0) {
      $('#labelNeed').textContent = '需平均每天做';
      _setBigNum($('#mNeed'), '0', u); $('#mNeedFoot').textContent = '已经完成啦';
    } else if (!isFinite(m.needPerDay) || m.daysAvailable <= 0) {
      $('#labelNeed').textContent = '每个学习日目标';
      _setBigNum($('#mNeed'), null);
      $('#mNeedFoot').textContent = m.daysAvailable == null
        ? (m.etaDate ? `未设截止日，按当前节奏预计 ${fmtCN(m.etaDate)} 完成` : '未设截止日，可在设置中添加')
        : '今天就是截止日';
    } else if (m.perStudyDay != null) {
      const dt = getDailyTarget(p, m);
      const showPer = dt.per;
      const showWk = dt.wk || Math.max(1, Math.round(m.activityPerWeek));
      $('#labelNeed').textContent = '每个学习日需做';
      _setBigNum($('#mNeed'), (Math.round(showPer * 10) / 10).toFixed(1), u);
      const bits = [];
      if (dt.plan && dt.plan.onTime) {
        // 加量追赶期：大字与状态卡"最省力按期方案"同源，避免看板与卡片数字打架
        if (dt.plan.onTime.heavy) {
          // 硬路径（连每天都学仍需 >2.5 倍强度）：不能轻描淡写"可按期完成"，要诚实警示
          bits.push(`为平时 ${dt.plan.onTime.mult.toFixed(1)} 倍，强度很大，建议看状态卡`);
          if (m.confidence !== 'high') bits.push('早期估算');
        } else {
          bits.push(showWk >= 7 ? '每天都学，可按期完成' : `每周学 ${showWk} 天，可按期完成`);
          if (m.confidence !== 'high') bits.push('早期估算');
          if (m.feasibility === 'impossible' || m.daysLeft < 0) bits.push('强度偏大');
        }
      } else {
        if (m.feasibility === 'stretch') { const _ss = stretchShort(m); if (_ss) bits.push(_ss); }
        else if (m.feasibility === 'impossible' || m.daysLeft < 0) bits.push('时间紧，可微调');
        else bits.push(`约每周 ${showWk} 个学习日`);
      }
      // 套卷每学习日不足 1 套时（如 0.3 套/学习日），换算成"约每周几套 / 每几周 1 套"，避免"做 0.3 套"的困惑
      if (u === '套' && showPer > 0 && showPer < 1) {
        const perWeek = showPer * showWk;
        if (perWeek >= 0.95) bits.push(`约每周 ${perWeek.toFixed(1)} 套`);
        else bits.push(`约每 ${Math.max(1, Math.round(1 / perWeek))} 周 1 套`);
      }
      // 冷启动：此时 perStudyDay 是按每周 5 天先验的粗略值，注明会很快按个人节奏修正
      if (m.confidence === 'low' && bits.length === 0) bits.push(`早期粗略估算 · 再攒 ${m.daysToMedium} 个学习日就按你的节奏调整`);
      $('#mNeedFoot').textContent = bits.join(' · ');
    } else {
      $('#labelNeed').textContent = '需平均每天做';
      _setBigNum($('#mNeed'), (Math.round(m.needPerDay * 10) / 10).toFixed(1), u);
      $('#mNeedFoot').textContent = m.daysToMedium > 0 ? `粗估（剩余÷剩余自然日）· 再攒 ${m.daysToMedium} 个学习日就开始按你的节奏调整` : '再积累几个学习日，将按你的真实节奏给出学习日目标';
    }
  } else {
    const isMistake = p.type === 'mistake';
    const ru = unitName(p); // 错题=条，背书=页
    const due = getDueItems(p).length;
    // 环形进度图
    const pct = m.total > 0 ? Math.min(100, m.currentPage / m.total * 100) : 0;
    const circumference = 2 * Math.PI * 32.5; // 与 SVG 圆环 r=32.5 保持一致
    $('#ringPct').textContent = Math.round(pct) + '%';
    $('#ringLab').textContent = isMistake ? '已攻克' : '已完成';
    $('#ringFg').style.strokeDashoffset = circumference * (1 - pct / 100);
    // 底部总结
    const _mt = (typeof m.total === 'number' && isFinite(m.total)) ? m.total : null;
    const _mc = (typeof m.currentPage === 'number' && isFinite(m.currentPage)) ? m.currentPage : 0;
    $('#mergedSummary').textContent = isMistake
      ? `已收录 ${m.total || 0} 条 · 已攻克 ${_mc} 条`
      : (_mt != null ? `共 ${_mt} 页 · 已完成 ${_mc} 页` : (_mc > 0 ? `已完成 ${_mc} 页` : ''));
    if (isMistake) {
      // 错题本：只列今天要解决的复习条目，不预估"每天订正多少"
      if (due > 0) {
        $('#labelNeed').textContent = '今日待解决';
        _setBigNum($('#mNeed'), due, '条');
        $('#mNeedFoot').textContent = '错题（复习优先，按排期滚动）';
      } else {
        $('#labelNeed').textContent = '今日待解决';
        _setBigNum($('#mNeed'), '0', '条');
        $('#mNeedFoot').textContent = m.remaining === 0 && m.currentPage > 0
          ? '已全部攻克，遇到新错题随时收录'
          : '暂无到期错题 · 已攻克 ' + m.currentPage + ' / 共收录 ' + m.total + ' 道';
      }
    } else if (due > 0) {
      $('#labelNeed').textContent = '今日待复习';
      _setBigNum($('#mNeed'), due, '条');
      $('#mNeedFoot').textContent = '内容（复习优先，按间隔推进）';
    } else if (m.sprint && m.remaining > 0) {
      // 冲刺期当天复习已清完：不再给"新学 N 页"目标（与冲刺策略"先复习、挑重点"保持一致）
      $('#labelNeed').textContent = '今日安排';
      _setBigNum($('#mNeed'), null);
      $('#mNeedFoot').textContent = '冲刺期：复习已清完，有余力挑重点学新';
    } else if (m.remaining === 0 && m.currentPage > 0) {
      $('#labelNeed').textContent = '每个学习日目标';
      _setBigNum($('#mNeed'), '0', u); $('#mNeedFoot').textContent = '已经完成啦';
    } else if (!isFinite(m.needPerDay) || m.daysAvailable <= 0) {
      $('#labelNeed').textContent = '每个学习日目标';
      _setBigNum($('#mNeed'), null);
      $('#mNeedFoot').textContent = m.daysAvailable == null
        ? (m.etaDate ? `未设截止日，按当前节奏预计 ${fmtCN(m.etaDate)} 完成` : '未设截止日，可在设置中添加')
        : '今天就是截止日';
    } else if (m.perStudyDay != null) {
      const dt = getDailyTarget(p, m);
      const showPer = dt.per;
      const showWk = dt.wk || Math.max(1, Math.round(m.activityPerWeek));
      $('#labelNeed').textContent = '每个学习日新学';
      _setBigNum($('#mNeed'), (Math.round(showPer * 10) / 10).toFixed(1), ru);
      const bits = [];
      if (dt.plan && dt.plan.onTime) {
        if (dt.plan.onTime.heavy) {
          bits.push(`为平时 ${dt.plan.onTime.mult.toFixed(1)} 倍，强度很大，建议看状态卡`);
          if (m.confidence !== 'high') bits.push('早期估算');
        } else {
          bits.push(showWk >= 7 ? '每天都学，可按期完成' : `每周学 ${showWk} 天，可按期完成`);
          if (m.confidence !== 'high') bits.push('早期估算');
        }
      } else {
        bits.push(`约每周 ${showWk} 个学习日`);
        if (m.feasibility === 'stretch') { const _ss = stretchShort(m); if (_ss) bits.push(_ss); }
        else if (m.feasibility === 'impossible') bits.push('时间紧，可微调');
        else if (m.confidence === 'low') bits.push('早期粗略估算，会按你的节奏调整');
        else bits.push('按平时节奏即可');
      }
      $('#mNeedFoot').textContent = bits.join(' · ');
    } else {
      $('#labelNeed').textContent = '需平均每天学';
      _setBigNum($('#mNeed'), (Math.round(m.needPerDay * 10) / 10).toFixed(1), u);
      $('#mNeedFoot').textContent = m.daysToMedium > 0 ? `粗估（剩余÷剩余自然日）· 再攒 ${m.daysToMedium} 个学习日就开始按你的节奏调整` : `${ru} / 天`;
    }
  }

  // 第三张卡片内：今日进度条 + 状态化鼓励（覆盖刷题/背书/错题三种类型）
  renderDailyGoal(p, m);

  if (m.daysAvailable == null) {
    if (p.type === 'mistake' && (!p.mistakeMode || p.mistakeMode === 'free')) {
      // 自由出处错题本无截止日：左卡改展示"待攻克错题"，比"可用天数 —"更有意义
      $('#labelDays').textContent = '待攻克错题';
      _setBigNum($('#mDays'), String(m.remaining), '条');
    } else {
      $('#labelDays').textContent = '可用天数';
      _setBigNum($('#mDays'), null, '天');
    }
    // mergedSummary 已在上方按类型生成（共/剩、收录/攻克），这里不再覆盖成"未设截止日"
  } else {
    $('#labelDays').textContent = '可用天数';
    _setBigNum($('#mDays'), String(Math.max(0, m.daysAvailable)), '天');
    // 底部一句话总结：剩余 X 页 / 已积累 Y 个学习日
    const remText = isExercise ? `剩 ${fmtUnitNum(m.remaining)} ${u}` : `剩 ${m.remaining} 条`;
    $('#mergedSummary').textContent = `${remText} · 已积累 ${m.activeDays || 0} 个学习日`;
  }

  const status = getStatusMessage(p, m);
  const card = $('#statusCard');
  card.className = 'card status ' + (status.cls || 'ok');
  $('#statusIcon').textContent = status.icon;
  $('#statusTitle').textContent = status.title;
  $('#statusDesc').innerHTML = status.desc;
  // 常驻算法说明：让用户知道数字怎么来、何时可信
  let algoNote = '';
  const doneAll = m.currentPage > 0 && m.remaining === 0;
  if (!doneAll) {
    if (p.type === 'mistake') {
      // 错题本是滚动复习，不是线性进度：不按"攻克速度"外推完成时间，说明要贴合其机制
      algoNote = '每道错题按记忆间隔（1→2→4→7→15→30天）滚动复习，连续做对才算攻克。均匀模式会自动把每天的量错峰，你只要做完"今天到期"的即可，越往后复习越稀疏、负担越轻，不需要自己算每天做多少。';
    } else if (p.type === 'recite') {
      // 背书本是"新学推进 + 间隔复习"双任务，且要预留完整复习周期，说明与刷题/错题都不同
      if (m.sprint) {
        algoNote = `一轮完整复习约需 ${m.cycleDays} 天（1→2→4→7→15→30 间隔）。现在距目标日不足一个完整周期，已进入冲刺期，系统把"先复习已学、再挑重点学新"放在第一位；你只需按今天的清单做，不用再算新学目标。`;
      } else if (!m.enoughData) {
        algoNote = `背书 = 新学推进 + 按间隔复习，一轮完整复习约需 ${m.cycleDays} 天。系统会算出新学截止日（${m.newLearnEnd ? fmtCN(m.newLearnEnd) : '—'}），之后只做滚动复习；现在数据少，先按粗略目标推进。`;
      } else {
        algoNote = `背书 = 新学 + 按间隔（1→2→4→7→15→30天）滚动复习，一轮约需 ${m.cycleDays} 天。系统按你的节奏安排每天新学页与复习并错峰，避免扎堆；新内容建议在 ${m.newLearnEnd ? fmtCN(m.newLearnEnd) : '—'} 前学完，之后只做滚动复习，到期记得最牢。`;
      }
    } else if (!m.enoughData) {
      algoNote = `系统统计你最近每个"真正学习的日子"推进了多少${u}、每周大约学几天，据此折算目标。满 3 个学习日开始个性化（范围偏宽），满 7 个学习日、跨约 2 周后最可靠；现在数据少，先按粗略目标推进。`;
    } else {
      algoNote = `按你最近的真实节奏（每周约 ${Math.round(m.activityPerWeek)} 个学习日、每次约 ${(Math.round(m.perStudyDayRaw * 10) / 10).toFixed(1)} ${u}）估算；休息日不摊任务，学习日做到目标量即可。节奏一变，数字会自动更新；目标日也可在设置里调整。`;
    }
  }
  $('#statusAlgoNote').textContent = algoNote;

  // 摆烂提醒：连续3天以上没复习/推进时提示，文案按中断天数与模式差异化
  const lazyEl = $('#lazyWarning');
  const lazyTextEl = $('#lazyWarningText');
  if (lazyEl && lazyTextEl) {
    const lazy = getLazyInfo(p);
    const doneAll = m.currentPage > 0 && m.remaining === 0;
    const hasContent = (p.items || []).length > 0 || (p.records || []).length > 0;
    if (!doneAll && lazy.days >= 3 && hasContent) {
      lazyEl.hidden = false;
      lazyTextEl.textContent = getLazyMessage(p, m, lazy);
    } else {
      lazyEl.hidden = true;
    }
  }

  const pct = m.total > 0 ? Math.min(100, m.currentPage / m.total * 100) : 0;
  $('#barFill').style.width = pct + '%';
  $('#progressText').textContent = `${fmtUnitNum(m.currentPage)} / ${fmtUnitNum(m.total)} ${u} · ${pct.toFixed(1)}%`;

  const barTime = $('#barTime');
  if (m.effStart && p.deadline) {
    const totalSpan = diffDays(m.effStart, p.deadline);
    const elapsed = diffDays(m.effStart, m.t);
    if (totalSpan > 0) {
      const tp = Math.max(0, Math.min(100, elapsed / totalSpan * 100));
      barTime.style.left = tp + '%';
      barTime.hidden = false;
    } else barTime.hidden = true;
  } else barTime.hidden = true;

  if (p.unitMode && (p.units || []).length && (p.type !== 'mistake' || isMistakePageMode(p))) {
    // 根据项目类型动态修改标题
    const unitTitle = $('#unitSection').querySelector('h2');
    const unitHint = $('#unitSection').querySelector('.muted');
    if (p.type === 'exercise') {
      unitTitle.textContent = '📂 单元完成进度';
      unitHint.textContent = '颜色 = 完成度';
    } else if (p.type === 'mistake') {
      unitTitle.textContent = '📂 单元错题攻克情况';
      unitHint.textContent = '颜色 = 错题攻克进度';
    } else {
      unitTitle.textContent = '📂 单元掌握情况';
      unitHint.textContent = '颜色 = 复习掌握度';
    }
    renderUnits(p, m);
  } else {
    $('#unitSection').hidden = true;
  }

  if (isExercise) renderExerciseRecords(p);
  else renderReciteRecords(p);

  if (!isExercise) {
    const isMistake = p.type === 'mistake';
    const pageWrap = $('#recitePageRangeWrap');
    const sourceWrap = $('#reciteSourceWrap');
    const setNoWrap = $('#reciteSetNoWrap');
    if (isMistake) {
      // 错题本：根据模式显示不同的定位字段
      if (pageWrap) pageWrap.hidden = !isMistakePageMode(p);
      if (sourceWrap) sourceWrap.hidden = !isMistakeFreeMode(p);
      if (setNoWrap) {
        setNoWrap.hidden = !isMistakeSetMode(p);
        if (isMistakeSetMode(p)) {
          const setInput = $('#reciteSetNo');
          if (setInput) {
            if (p.paperLabelMode === 'year' && p.paperYearStart) {
              setInput.placeholder = `例：${p.paperYearStart}（${paperLabel(p, 1)}）`;
            } else {
              setInput.placeholder = '例：3（第3套）';
            }
          }
        }
      }
    } else {
      // 背书：页码区间
      if (pageWrap) pageWrap.hidden = false;
      if (sourceWrap) sourceWrap.hidden = true;
      if (setNoWrap) setNoWrap.hidden = true;
    }
  }

  requestAnimationFrame(() => drawChart(m, p));
  const _msBefore = Array.isArray(p.shownMilestones) ? p.shownMilestones.length : 0;
  checkMilestones(p, m);
  const _msAfter = Array.isArray(p.shownMilestones) ? p.shownMilestones.length : 0;
  if (_msAfter > _msBefore) __milestoneFiredToday[_msKey(p)] = true;
  if (p.type === 'mistake') checkMistakeMasteryToast(p);

  // 浏览器标签页标题：显示待复习数量
  if (p.type !== 'exercise') {
    const dueCount = getDueItems(p).length;
    document.title = 'Study Tracker';


  } else {
    document.title = 'Study Tracker';
  }
}

function renderReview(p) {
  const list = $('#reviewList');
  const due = getDueItems(p);
  const overdue = getOverdueItems(p);
  const retentionDue = getRetentionDueItems(p);
  const retentionOverdue = getRetentionOverdueItems(p);

  $('#reviewSection').hidden = false;
  // 评价真实性永久提醒（常驻、不指责、无术语）：双向覆盖"选高漏练"和"选低白做"，且点明多数人更易选低
  const honestEl = $('#honestHint');
  if (honestEl) {
    honestEl.hidden = false;
    honestEl.textContent = p.type === 'mistake'
      ? '💡 请如实选择，以便系统为你精准安排复习哦~'
      : '💡 请如实选择，以便系统为你精准安排复习哦~';
  }
  const countEl = $('#reviewCount');
  countEl.textContent = due.length;
  countEl.classList.toggle('overdue', overdue.length > 0);

  // 保持复习计数（独立显示，不计入正常复习数/舒适量）
  const retCountEl = $('#retentionCount');
  if (retCountEl) {
    if (retentionDue.length > 0) {
      retCountEl.hidden = false;
      retCountEl.textContent = `+${retentionDue.length} 保持复习`;
      retCountEl.title = '已掌握内容的定期巩固，快速确认"还记得吗"即可';
    } else retCountEl.hidden = true;
  }

  // 模式切换标签（错题本 / 背书本显示，刷题无复习模式）
  const modeBtn = $('#modeSwitchBtn');
  if (modeBtn) {
    if (p.type === 'mistake' || p.type === 'recite') {
      modeBtn.hidden = false;
      const mode = p.reviewMode || 'classic';
      modeBtn.textContent = mode === 'balanced' ? '⚖️ 均匀分布 ▾' : '📖 经典间隔 ▾';
      modeBtn.classList.toggle('classic', mode === 'classic');
      modeBtn.title = mode === 'balanced'
        ? '当前：均匀分布模式（自动错峰）。点击切换到经典间隔模式。'
        : '当前：经典间隔模式（严格按间隔）。点击切换到均匀分布模式。';
    } else {
      modeBtn.hidden = true;
    }
  }

  const banner = $('#overdueBanner');
  if (overdue.length > 0) {
    banner.hidden = false;
    $('#overdueCount').textContent = overdue.length;
    let maxDays = 0;
    overdue.forEach(it => {
      const d = diffDays(it.nextReviewDate, todayStr());
      if (d > maxDays) maxDays = d;
    });
    $('#overdueSub').textContent = `最早逾期 ${maxDays} 天 · 可一键分散避免今天堆积`;
  } else banner.hidden = true;

  // 超额分散横幅：待复习量超过阈值时显示（只统计正常复习，不含保持复习）
  // 两种显示场景：
  //   A. 主模式：当前待复习量 > 舒适量，还没开始做或做得少
  //   B. 温和模式：今天已开始清大量（已复习若干条），当前量虽降到舒适量内，仍提供"分散剩余"入口
  const threshold = p.spreadThreshold || defaultComfortCap(p);
  const excessBanner = $('#excessBanner');
  if (excessBanner) {
    let todayReviewedItems = 0;
    {
      const _today = todayStr();
      (p.items || []).forEach(it => {
        const revs = it.reviews || [];
        if (revs.length >= 2 && revs[revs.length - 1].date === _today) todayReviewedItems++;
      });
    }
    const todayTotal = due.length + todayReviewedItems; // 今天开始时的待复习总量
    const isMain = due.length > threshold;
    const isGentle = !isMain && todayReviewedItems > 0 && todayTotal > threshold && due.length >= 3;
    const obMain = excessBanner.querySelector('.ob-main');
    const excessSub = $('#excessSub');
    if (isMain) {
      excessBanner.hidden = false;
      if (obMain) obMain.innerHTML = `今天有 <strong id="excessCount">${due.length}</strong> 条待复习，超过舒适量`;
      if (excessSub) {
        excessSub.textContent = due.length > threshold * 1.5
          ? `远超舒适量（${threshold}条），如果每天确实能做这么多，可在设置中调高；也可以分散到未来`
          : '可以先做一部分，剩余分散到未来减轻压力';
      }
      excessBanner.dataset.mode = 'main';
    } else if (isGentle) {
      excessBanner.hidden = false;
      if (obMain) obMain.innerHTML = `今天已复习 <strong>${todayReviewedItems}</strong> 条，还剩 <strong id="excessCount">${due.length}</strong> 条`;
      if (excessSub) {
        excessSub.textContent = '今天投放量本来就偏大，做到这已经不少了；想歇一歇可以把剩余分散到未来';
      }
      excessBanner.dataset.mode = 'gentle';
    } else {
      excessBanner.hidden = true;
      delete excessBanner.dataset.mode;
    }
  }

  const riskBanner = $('#mistakeRiskBanner');
  if (riskBanner) {
    if (p.type === 'mistake') {
      const fe = getMistakeFeasibility(p);
      if (fe.level === 'risk') {
        riskBanner.hidden = false;
        $('#mistakeRiskText').textContent = `按你最近收录错题的速度，即使前期每天多做，${fe.daysLeft} 天内也可能无法把错题都过完`;
      } else riskBanner.hidden = true;
    } else riskBanner.hidden = true;
  }

  if (!due.length && !retentionDue.length) {
    list.innerHTML = '';
    $('#noReviewHint').hidden = false;
    return;
  }
  $('#noReviewHint').hidden = true;

  // ux-23：复习区顶部可关闭的快捷键说明（仅 PC 键盘环境显示，关闭后记住不再弹）
  ensureKbdHintBar(p);

  const today = todayStr();
  due.sort((a, b) => {
    const aOver = a.nextReviewDate < today ? 1 : 0;
    const bOver = b.nextReviewDate < today ? 1 : 0;
    if (aOver !== bOver) return bOver - aOver;
    const dateCmp = a.nextReviewDate.localeCompare(b.nextReviewDate);
    if (dateCmp !== 0) return dateCmp;
    // 同一天到期：背书按书页顺序聚簇（同章节相邻、顺着书背，避免"3-5页、1-2页"的页码跳跃混乱）；
    // 错题无页码顺序，按薄弱程度（分数低=更弱）先做。
    if (p.type === 'recite') {
      const ps = (a.pageStart ?? 0) - (b.pageStart ?? 0);
      if (ps !== 0) return ps;
      return (a.pageEnd ?? 0) - (b.pageEnd ?? 0);
    }
    const sa = getItemScore(a) ?? 0.5, sb = getItemScore(b) ?? 0.5;
    if (sa !== sb) return sa - sb;
    return (a.stage || 0) - (b.stage || 0);
  });

  // 正常复习条目（ux-24：保留为数组，首屏只插前 20 条，其余滚动到底由 IntersectionObserver 分批追加）
  const allNormalHtml = due.map(it => {
    const mastery = getMasteryInfo(it, p);
    const stage = (it.stage || 0) + 1;
    const totalRounds = getItemIntervals(it, p).length;
    const isOverdue = it.nextReviewDate < today;
    const overdueDays = isOverdue ? diffDays(it.nextReviewDate, today) : 0;

    let lastEvalHtml = '';
    if (it.reviews && it.reviews.length) {
      const last = it.reviews[it.reviews.length - 1];
      const isFirstLearn = it.reviews.length === 1; // 只有一次评价=首次学习
      const forgotLabel = isFirstLearn ? '上次：错了' : '上次：又错了';
      const map = p.type === 'mistake'
        ? { good:'上次：做对了', fuzzy:'上次：看答案', forgot: forgotLabel }
        : { good:'上次：记得', fuzzy:'上次：模糊', forgot:'上次：忘记' };
      const cls = last.quality === 'good' ? 'm-good' : (last.quality === 'fuzzy' ? 'm-fuzzy' : 'm-weak');
      lastEvalHtml = `<span class="m-badge ${cls}" style="font-size:10.5px;padding:1px 7px">${map[last.quality]}</span>`;
    }

    const overdueHtml = isOverdue ? `<span class="overdue-tag">逾期 ${overdueDays} 天</span>` : '';
    const errTagHtml = (it.errTags || []).map(reasonPill).join(' ');
    const lastNoteHtml = it.note ? `<span class="ri-lastnote">备注：${esc(it.note)}</span>` : '';
    // 反复错（连续 2 次及以上"又错了"）：标为"关键薄弱点"，把挫败感转成"考前最该拿下的重点"
    const weakKeyHtml = (p.type === 'mistake' && !it.mastered && !it.manualMastered && (it.wrongStreak || 0) >= 3)
      ? `<span class="weak-key-tag">🔑 关键薄弱点</span>` : '';
    // 本轮没做对被打回：用极简计数体现"已重做几次"，做对即进下一轮（错题/背书通用）
    const ws = it.wrongStreak || 0;
    const retryHtml = ws >= 1 ? ` <span class="retry-cnt" title="本轮已重做 ${ws} 次 · 做对后进入下一轮">↻ ${ws}</span>` : '';

    const btnLabels = p.type === 'mistake'
      ? { good: '✓ 做对了', fuzzy: '~ 看答案', forgot: '✗ 又错了' }
      : { good: '✓ 记得', fuzzy: '~ 模糊', forgot: '✗ 忘记' };

    return `<li class="review-item ${mastery.cls}${isOverdue ? ' overdue-item' : ''}" data-id="${esc(it.id)}">
      <div class="ri-main">
        <div class="ri-content">${esc(it.content)}</div>
        <div class="ri-meta">
          ${(loc => loc ? `<span>${esc(loc)}</span><span>·</span>` : '')(fmtItemLocator(p, it))}
          <span>学习于 ${fmtCN(it.learnedDate)}</span>
          <span>·</span>
          <span>第 ${stage} 轮 / 共 ${totalRounds} 轮</span>
          ${retryHtml}
          ${overdueHtml}
          ${weakKeyHtml}
          ${lastEvalHtml}
          ${errTagHtml}
          ${lastNoteHtml}
        </div>
        <input class="ri-note${it.note ? ' prefilled' : ''}" placeholder="备注（选填）" value="${esc(it.note || '')}">
      </div>
      <div class="ri-actions">
        <button class="q-btn q-good" data-quality="good" title="${btnLabels.good}（快捷键 1）">${btnLabels.good}</button>
        <button class="q-btn q-fuzzy" data-quality="fuzzy" title="${btnLabels.fuzzy}（快捷键 2）">${btnLabels.fuzzy}</button>
        <button class="q-btn q-forgot" data-quality="forgot" title="${btnLabels.forgot}（快捷键 3）">${btnLabels.forgot}</button>
        ${p.type === 'mistake' ? `<button class="tag-btn" data-reasonpicker="${it.id}">🏷 错因${(it.errTags||[]).length ? `(${it.errTags.length})` : ''}</button>` : ''}
        <button class="skip-btn" data-skip="${it.id}" title="标记为已熟知（快捷键 S），不再出现在复习列表" aria-label="标记为已熟知 ${esc(it.content)}">已熟知</button>
      </div>
    </li>`;
  });

  // 保持复习条目（已掌握内容的定期巩固，排在正常复习之后）
  let retentionHtml = '';
  if (retentionDue.length) {
    // 逾期的保持复习排前面
    retentionDue.sort((a, b) => (a.retentionDate || '').localeCompare(b.retentionDate || ''));
    const totalRet = retentionDue.length;
    const retExpanded = _retentionExpanded.has(p.id);
    // 默认只展示最早的几条，避免长期未处理时列表冗长造成压力
    const shownRet = retExpanded ? retentionDue : retentionDue.slice(0, RETENTION_SHOWN_CAP);
    const retBtnLabels = { pass: '✓ 还记得', fail: '~ 模糊了' };
    const itemsHtml = shownRet.map(it => {
      const isRetOverdue = it.retentionDate < today;
      const retOverdueHtml = isRetOverdue
        ? `<span class="retention-overdue-tag">巩固逾期 ${diffDays(it.retentionDate, today)} 天</span>` : '';
      const passCount = it.retentionPass || 0;
      const passInfo = passCount > 0 ? `已巩固 ${passCount} 次 · ` : '';
      return `<li class="review-item retention-item" data-id="${esc(it.id)}">
        <div class="ri-main">
          <div class="ri-content">${esc(it.content)}</div>
          <div class="ri-meta">
            <span class="retention-tag">🔖 保持复习</span>
            <span>${passInfo}掌握于 ${fmtCN(it.masteredDate)}</span>
            ${retOverdueHtml}
          </div>
        </div>
        <div class="ri-actions">
          <button class="q-btn q-retention-pass" data-retention="pass">${retBtnLabels.pass}</button>
          <button class="q-btn q-retention-fail" data-retention="fail">${retBtnLabels.fail}</button>
        </div>
      </li>`;
    }).join('');
    const expandHtml = (!retExpanded && totalRet > RETENTION_SHOWN_CAP)
      ? `<li class="retention-expand" data-retention-expand="${p.id}"><span>展开其余 ${totalRet - RETENTION_SHOWN_CAP} 条保持复习</span></li>` : '';
    retentionHtml = `<li class="retention-divider"><span>🔖 保持复习 · 已掌握内容的快速巩固（${totalRet}）</span></li>${itemsHtml}${expandHtml}`;
  }

  // ux-24：首屏只渲染前 REVIEW_BATCH 条，其余用 IntersectionObserver 滚动到底分批追加（判定逻辑不变）
  if (_reviewIO) { try { _reviewIO.disconnect(); } catch (e) {} _reviewIO = null; }
  const REVIEW_BATCH = 20;
  const initialCount = Math.min(REVIEW_BATCH, allNormalHtml.length);
  let html = allNormalHtml.slice(0, initialCount).join('');
  const needMore = allNormalHtml.length > initialCount;
  if (needMore) html += '<li id="reviewSentinel" style="list-style:none;height:1px"></li>';
  list.innerHTML = html + retentionHtml;
  if (needMore) {
    _reviewBatch = { list, items: allNormalHtml, offset: initialCount };
    const sentinel = document.getElementById('reviewSentinel');
    if (sentinel && 'IntersectionObserver' in window) {
      _reviewIO = new IntersectionObserver((entries) => {
        if (entries && entries[0] && entries[0].isIntersecting) appendNextReviewBatch();
      }, { rootMargin: '500px' });
      _reviewIO.observe(sentinel);
    }
  } else {
    _reviewBatch = null;
  }
}

// ux-24：滚动到哨兵后，追加下一批复习条目
const REVIEW_BATCH_SIZE = 20;
let _reviewIO = null;
let _reviewBatch = null;
function appendNextReviewBatch(){
  const st = _reviewBatch;
  if (!st) return;
  const next = st.items.slice(st.offset, st.offset + REVIEW_BATCH_SIZE);
  if (!next.length) return;
  const sentinel = document.getElementById('reviewSentinel');
  const frag = document.createElement('template');
  frag.innerHTML = next.join('');
  while (frag.content.firstChild) {
    st.list.insertBefore(frag.content.firstChild, sentinel);
  }
  st.offset += next.length;
  if (st.offset >= st.items.length) {
    if (sentinel) sentinel.remove();
    if (_reviewIO) { try { _reviewIO.disconnect(); } catch (e) {} _reviewIO = null; }
    _reviewBatch = null;
  }
}

// ux-23：复习区顶部快捷键说明条（可关闭，关闭后记住）。仅在桌面键盘（无触摸）环境显示。
function ensureKbdHintBar(p){
  const section = $('#reviewSection');
  if (!section) return;
  if (getUIFlag('review_kbd_hint_dismissed')) return;
  // 触屏/平板不常驻键盘，不打扰
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return;
  let bar = document.getElementById('reviewKbdHint');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'reviewKbdHint';
    bar.style.cssText = 'display:flex;align-items:center;gap:10px;margin:0 0 10px;padding:8px 12px;background:var(--card);border:1px solid var(--border);border-radius:10px;font-size:12px;color:var(--muted)';
    bar.innerHTML = '<span>⌨️ 键盘快捷：</span>'
      + '<span><b style="color:var(--brand)">1</b> 记得</span>'
      + '<span><b style="color:var(--brand)">2</b> 模糊</span>'
      + '<span><b style="color:var(--brand)">3</b> 忘记</span>'
      + '<span><b style="color:var(--brand)">S</b> 跳过/已熟知</span>'
      + '<button type="button" id="reviewKbdClose" aria-label="关闭快捷键说明" style="margin-left:auto;background:none;border:none;color:var(--muted);cursor:pointer;font-size:15px;line-height:1;padding:2px 6px">×</button>';
    const list = $('#reviewList');
    section.insertBefore(bar, list);
    const close = document.getElementById('reviewKbdClose');
    if (close) close.addEventListener('click', () => { setUIFlag('review_kbd_hint_dismissed'); bar.remove(); });
  }
}

// ux-23/ux-14：全局快捷键——焦点不在输入框、无弹窗时，1/2/3 评价首条（或当前聚焦条目），S 跳过/已熟知；R 手动同步。
document.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target && e.target.isContentEditable)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (typeof anyModalOpen === 'function' && anyModalOpen()) return;
  // ux-14：R 手动同步（任何项目类型都可用）
  if (e.key === 'r' || e.key === 'R') {
    if (typeof STAuth !== 'undefined' && STAuth.isLoggedIn()) { e.preventDefault(); STAuth.triggerSync(); }
    return;
  }
  const p = cur();
  if (!p || p.type === 'exercise') return;
  const list = $('#reviewList');
  if (!list || list.hidden) return;
  const k = e.key;
  let quality = null, skip = false;
  if (k === '1') quality = 'good';
  else if (k === '2') quality = 'fuzzy';
  else if (k === '3') quality = 'forgot';
  else if (k === 's' || k === 'S') skip = true;
  else return;
  // 目标条目：焦点在某条复习项上则作用于该条，否则作用于列表第一条正常复习项
  const active = document.activeElement;
  let itemEl = (active && active.closest && active.closest('.review-item')) ? active.closest('.review-item') : null;
  if (!itemEl) itemEl = list.querySelector('.review-item:not(.retention-item)');
  if (!itemEl) return;
  e.preventDefault();
  if (skip) {
    const sb = itemEl.querySelector('[data-skip]');
    if (sb) sb.click();
  } else {
    const qb = itemEl.querySelector('.q-btn[data-quality="' + quality + '"]');
    if (qb) qb.click();
  }
});

// ux-14：手动同步按钮（PC）
(function(){
  const b = document.getElementById('btnManualSync');
  if (b) b.addEventListener('click', () => {
    if (typeof STAuth !== 'undefined') STAuth.triggerSync();
  });
  // 触屏/平板：列表下拉刷新（pull-to-refresh），松手触发同步
  let touchStartY = 0, pulling = false;
  const recList = document.getElementById('recordList');
  if (recList) {
    recList.addEventListener('touchstart', (e) => {
      if (window.scrollY > 0) return;
      touchStartY = e.touches[0].clientY;
      pulling = true;
    }, { passive: true });
    recList.addEventListener('touchmove', (e) => {
      if (!pulling) return;
      const dy = e.touches[0].clientY - touchStartY;
      if (dy > 60 && window.scrollY <= 0) {
        pulling = false;
        if (typeof STAuth !== 'undefined' && STAuth.isLoggedIn()) {
          STAuth.triggerSync();
          showToast('⟳', '正在刷新', '从云端同步最新数据', 1500);
        }
      }
    }, { passive: true });
    recList.addEventListener('touchend', () => { pulling = false; }, { passive: true });
  }
})();

function renderUnits(p, m) {
  $('#unitSection').hidden = false;
  const list = $('#unitList');
  const isEx = p.type === 'exercise';
  // 练习册：用"已完成页码区间"与单元范围求交集来算进度。
  // 顺序录入下等价于旧公式（currentPage 当作"做到第几页"），但按区间/跳着录入时也正确。
  const doneRanges = isEx ? getBookDoneRanges(p) : [];

  // 递归收集单元的所有页码范围（含子单元）
  function collectPages(unit) {
    let pages = [];
    if (unit.startPage != null && unit.endPage != null) pages.push([unit.startPage, unit.endPage]);
    (unit.children || []).forEach(c => pages = pages.concat(collectPages(c)));
    return pages;
  }
  // 递归收集单元的所有条目（含子单元）
  function collectEntries(unit) {
    let entries = getUnitItemEntries(p, unit);
    (unit.children || []).forEach(c => entries = entries.concat(collectEntries(c)));
    // 去重（同一条目可能被多个单元覆盖）
    const seen = new Set();
    return entries.filter(({ it }) => { if (seen.has(it.id)) return false; seen.add(it.id); return true; });
  }

  function renderUnit(u, level) {
    const indent = level * 16;
    const allPages = collectPages(u);
    const us = allPages.length ? Math.min(...allPages.map(p => p[0])) : (u.startPage || 0);
    const ue = allPages.length ? Math.max(...allPages.map(p => p[1])) : (u.endPage || 0);
    const hasChildren = u.children && u.children.length > 0;

    if (!isEx) {
      // 背书：单元卡按"条目掌握度"（保持原逻辑）
      if (p.type === 'recite') {
        const entries = collectEntries(u);
        const cnt = entries.length;
        const masteredCnt = entries.filter(({ it }) => it.mastered || it.manualMastered).length;
        let score = null;
        if (cnt > 0) {
          let sw = 0, sws = 0;
          entries.forEach(({ it, w }) => {
            const sc = (it.mastered || it.manualMastered) ? 1.0 : (getItemScore(it) ?? 0);
            sw += w; sws += sc * w;
          });
          score = sw > 0 ? sws / sw : 0;
        }
        const pct = score === null ? 0 : Math.round(score * 100);
        const barColor = score === null ? '#e8dfd0' : (score >= 0.8 ? '#096f4e' : (score >= 0.4 ? '#e0a020' : '#e5484d'));
        const mi = masteryFromScore(score);
        const rangeTxt = `P${us} - P${ue} · `;
        const childInfo = hasChildren ? ` · ${u.children.length}个子单元` : '';
        let html = `<li class="unit-item" style="padding-left:${indent}px">
          <div class="unit-head">
            <span class="unit-name">${level > 0 ? '└ ' : ''}${esc(u.name || '未命名单元')}
              <span class="m-badge ${mi.cls}"><span class="dot-sm"></span>${mi.label}</span>
            </span>
            <span class="unit-range">掌握度 ${pct}% · 已掌握 ${masteredCnt}/${cnt} 条</span>
          </div>
          <div class="unit-bar"><div class="unit-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>
          <div class="unit-progress">${rangeTxt}共 ${cnt} 条内容${childInfo}</div>
        </li>`;
        if (hasChildren) u.children.forEach(c => html += renderUnit(c, level + 1));
        return html;
      }

      // 错题本：四态渲染（no-data / unlearned / learned-no-mistake / learned-with-mistake）
      const info = getUnitMastery(p, u);
      const rangeTxt = `P${us} - P${ue} · `;
      const childInfo = hasChildren ? ` · ${u.children.length}个子单元` : '';
      let badgeLabel, badgeCls, barPct, barColor, rangeRight, subText;
      const rup = (typeof info.refUnitPages === 'number' && isFinite(info.refUnitPages)) ? info.refUnitPages : null;
      const rlp = (typeof info.refLearnedPages === 'number' && isFinite(info.refLearnedPages)) ? info.refLearnedPages : 0;

      if (info.state === 'no-data') {
        badgeLabel = '未收录错题'; badgeCls = 'm-new';
        barPct = 0; barColor = '#e6e1d4';
        rangeRight = '';
        subText = `${rangeTxt}暂无错题记录${childInfo}`;
      } else if (info.state === 'unlearned') {
        badgeLabel = '尚未学到'; badgeCls = 'm-new';
        barPct = 0; barColor = '#e6e1d4';
        rangeRight = rup ? `已学 0 / ${rup} 页` : '';
        subText = `${rangeTxt}${rup != null ? `共 ${rup} 页` : ''}${childInfo}`;
      } else if (info.state === 'learned-no-mistake') {
        badgeLabel = '暂无错题'; badgeCls = 'm-good';
        barPct = 100; barColor = '#a7d7b5';
        rangeRight = rup ? `已学 ${rlp} / ${rup} 页` : '';
        subText = `${rangeTxt}${rup != null ? `共 ${rup} 页，` : ''}暂无错题${childInfo}`;
      } else {
        // learned-with-mistake
        const mr = info.masteryRate;
        if (mr >= 0.8) { badgeLabel = '错题基本攻克'; badgeCls = 'm-solid'; }
        else if (mr >= 0.5) { badgeLabel = '错题攻克中'; badgeCls = 'm-fuzzy'; }
        else { badgeLabel = '错题待攻克'; badgeCls = 'm-weak'; }
        barPct = Math.round(mr * 100);
        barColor = mr >= 0.8 ? '#096f4e' : (mr >= 0.5 ? '#e0a020' : '#e5484d');
        // 样本量标注
        let sampleNote = '';
        if (info.mistakeCount <= 2) sampleNote = ' · 样本少';
        else if (info.refLearnedPages && info.mistakeCount / info.refLearnedPages < 0.02) sampleNote = ' · 错题稀疏';
        const refText = info.refUnitPages ? ` · 已学 ${info.refLearnedPages} / ${info.refUnitPages} 页` : '';
        rangeRight = `${info.mistakeCount}道错题 · 攻克 ${info.masteredCount} 道${refText}${sampleNote}`;
        subText = `${rangeTxt}共 ${info.mistakeCount} 道错题${childInfo}`;
      }

      let html = `<li class="unit-item" style="padding-left:${indent}px">
        <div class="unit-head">
          <span class="unit-name">${level > 0 ? '└ ' : ''}${esc(u.name || '未命名单元')}
            <span class="m-badge ${badgeCls}"><span class="dot-sm"></span>${badgeLabel}</span>
          </span>
          <span class="unit-range">${rangeRight}</span>
        </div>
        <div class="unit-bar"><div class="unit-bar-fill" style="width:${barPct}%;background:${barColor}"></div></div>
        <div class="unit-progress">${subText}</div>
      </li>`;
      if (hasChildren) u.children.forEach(c => html += renderUnit(c, level + 1));
      return html;
    }

    // 刷题练习册：按"已完成区间 ∩ 本单元范围"算进度（顺序/区间录入均正确）
    const len = Math.max(1, ue - us + 1);
    let done = 0;
    for (const dr of doneRanges) {
      const s = Math.max(us, dr.start), e = Math.min(ue, dr.end);
      if (e >= s) done += e - s + 1;
    }
    done = Math.min(len, Math.max(0, done));
    const pct = len > 0 ? done / len * 100 : 0;
    const isDone = done >= len;
    const isCurrent = !isDone && done > 0;
    const childInfo = hasChildren ? ` · ${u.children.length}个子单元` : '';
    let html = `<li class="unit-item" style="padding-left:${indent}px">
      <div class="unit-head">
        <span class="unit-name">
          ${level > 0 ? '└ ' : ''}${esc(u.name || '未命名单元')}
          ${isCurrent ? '<span class="unit-current">进行中</span>' : ''}
        </span>
        <span class="unit-range">${done}/${len} 页${isDone ? ' ✓' : ''}</span>
      </div>
      <div class="unit-bar"><div class="unit-bar-fill" style="width:${pct}%"></div></div>
      <div class="unit-progress">P${us} - P${ue}${childInfo}</div>
    </li>`;
    if (hasChildren) u.children.forEach(c => html += renderUnit(c, level + 1));
    return html;
  }

  const units = [...(p.units || [])].sort((a, b) => (a.startPage || 0) - (b.startPage || 0));
  list.innerHTML = units.map(u => renderUnit(u, 0)).join('');
}

/* ux-25：打卡记录/学习记录排序结果的纯前端内存缓存（不挂到项目对象上、不写回 store、不进同步）。
   缓存键 = 项目id + 数据类型 + 记录条数 + 项目 updatedAt；每次增/删/改都会改变条数或 bump updatedAt，
   键变化才重排，避免每次 render() 都 O(n log n) 排序。 */
const _sortCache = { key: '', value: null };
function getSortedCached(p, kind){
  const arr = kind === 'items' ? (p.items || []) : (p.records || []);
  const key = (p.id || '') + '|' + kind + '|' + arr.length + '|' + (p.updatedAt || 0);
  if (_sortCache.key === key) return _sortCache.value;
  let sorted;
  if (kind === 'items') {
    sorted = arr.map((it, idx) => ({ it, idx }))
      .sort((a, b) => {
        const d = (b.it.learnedDate || '').localeCompare(a.it.learnedDate || '');
        return d !== 0 ? d : b.idx - a.idx;
      }).map(x => x.it);
  } else {
    sorted = arr.map((r, idx) => ({ r, idx }))
      .sort((a, b) => {
        const d = b.r.date.localeCompare(a.r.date);
        return d !== 0 ? d : b.idx - a.idx;
      }).map(x => x.r);
  }
  _sortCache.key = key; _sortCache.value = sorted;
  return sorted;
}

function renderExerciseRecords(p) {
  $('#recordTitle').innerHTML = '打卡记录 <span class="muted" id="recCount"></span>';
  // 日期倒序 + 同一天内录入倒序（最新录入的在最上）——结果走缓存（ux-25）
  const recs = getSortedCached(p, 'records');
  const list = $('#recordList');
  list.innerHTML = '';
  $('#recCount').textContent = recs.length ? `共 ${recs.length} 条` : '';

  if (!recs.length) {
    list.innerHTML = '<li class="empty">📊<br>还没有记录，先打个卡吧。'
      + '<div style="margin-top:14px"><button type="button" class="primary-btn" id="emptyCheckinBtn" style="padding:9px 18px;font-size:13px">📖 去打卡</button></div></li>';
    const ecb = document.getElementById('emptyCheckinBtn');
    if (ecb) ecb.addEventListener('click', () => scrollToEntryForm('#inPageEnd'));
    return;
  }

  if (isSetMode(p)) {
    const normSecs = getNormalizedSections(p);
    const state = {};
    const deltaOf = {}, textOf = {};
    // 先按日期升序累积算 delta（和 getSetState 一致），再按倒序显示
    const ascRecs = [...recs].reverse();
    ascRecs.forEach((r, i) => {
      const no = r.set;
      if (!state[no]) state[no] = { secs: {}, legacy: 0 };
      const st = state[no];
      const before = normSecs.length
        ? normSecs.reduce((s, x) => s + ((st.secs[x.id] || 0) / 100) * x.wt, 0)
        : st.legacy;
      if (r.secId != null && r.pct != null) {
        st.secs[r.secId] = Math.max(0, Math.min(100, (st.secs[r.secId] || 0) + Number(r.pct)));
      } else if (r.all === true || (r.done == null && r.q == null)) {
        if (normSecs.length) normSecs.forEach(s => { st.secs[s.id] = 100; });
        st.legacy = 1;
      } else if (r.done != null && r.q != null && r.q > 0) {
        st.legacy = Math.max(0, Math.min(1, r.done / r.q));
      }
      const after = normSecs.length
        ? normSecs.reduce((s, x) => s + ((st.secs[x.id] || 0) / 100) * x.wt, 0)
        : st.legacy;
      deltaOf[i] = after - before;

      const label = paperLabel(p, no);
      if (r.secId != null) {
        const sec = (p.paperSections || []).find(s => s.id === r.secId);
        textOf[i] = `${label} · ${esc(sec ? sec.name : '板块')} ${r.pct}%`;
      } else if (r.done != null && r.q != null) {
        textOf[i] = `${label} · ${r.done}/${r.q} 题`;
      } else {
        textOf[i] = `${label} · 整套`;
      }
    });
    // 按倒序渲染（最新的在上面）
    ascRecs.forEach((r, i) => {
      const d = parseDate(r.date);
      const dl = deltaOf[i];
      const dlStr = dl > 0 ? `+${fmtUnitNum(dl)} 套` : (Math.abs(dl) < 1e-9 ? '±0' : `${fmtUnitNum(dl)} 套`);
      const li = document.createElement('li');
      li.innerHTML =
        `<span class="r-date">${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]}</span>` +
        `<span class="r-page">${textOf[i]}</span>` +
        `<span class="r-delta${dl > 0 ? '' : ' zero'}" style="margin-left:auto">${dlStr}</span>` +
        `<button class="r-del" data-rid="${esc(r.rid || '')}" data-date="${esc(r.date)}" data-set="${esc(r.set)}" title="删除">×</button>`;
      list.insertBefore(li, list.firstChild);
    });
    return;
  }

  // 先按日期正序累积算 delta（和套卷模式一致），再按倒序显示
  // 用 countClippedRanges 与顶部总进度同口径裁剪，避免录了单元外页时 delta 虚高
  let accRanges = [];
  const deltaByIdx = {};
  const ascRecs = [...recs].reverse();
  ascRecs.forEach((r, i) => {
    const before = countClippedRanges(accRanges, p);
    accRanges = mergeRanges(accRanges.concat([getRecordRange(r, p)]));
    const after = countClippedRanges(accRanges, p);
    deltaByIdx[i] = after - before;
  });
  ascRecs.forEach((r, i) => {
    const d = parseDate(r.date);
    const isRange = r.startPage != null;
    const end = r.endPage != null ? r.endPage : (r.page || 0);
    const rangeStr = isRange
      ? `第 ${r.startPage}-${end} 页`
      : `学到第 ${end} 页`;
    const delta = deltaByIdx[i];
    const deltaStr = delta > 0 ? `+${delta} 页` : (delta === 0 ? '±0' : `${delta} 页`);
    const li = document.createElement('li');
    li.innerHTML =
      `<span class="r-date">${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]}</span>` +
      `<span class="r-page">${rangeStr}</span>` +
      `<span class="r-delta${delta > 0 ? '' : ' zero'}" style="margin-left:auto">${deltaStr}</span>` +
      `<button class="r-del" data-rid="${esc(r.rid || '')}" data-date="${esc(r.date)}" title="删除">×</button>`;
    list.insertBefore(li, list.firstChild);
  });
}

/* 记录已展开历史面板的条目 ID，render() 后恢复展开状态 */
const _expandedHistItems = new Set();

function renderReciteRecords(p) {
  $('#recordTitle').innerHTML = '学习记录 <span class="muted" id="recCount"></span>';
  // 日期倒序 + 同一天内录入倒序（最新录入的在最上）——结果走缓存（ux-25）
  const items = getSortedCached(p, 'items');
  const today = todayStr();

  const list = $('#recordList');
  list.innerHTML = '';
  $('#recCount').textContent = items.length ? `共 ${items.length} 条` : '';

  if (!items.length) {
    const ctaText = p.type === 'mistake' ? '📝 去记录一道错题' : '📖 去添加学习内容';
    let emptyHtml = `<li class="empty">📝<br>还没有学习记录，先添加一条吧。
      <div style="margin-top:14px"><button type="button" class="primary-btn" id="emptyAddBtn" style="padding:9px 18px;font-size:13px">${ctaText}</button></div></li>`;
    // ux-7：自由出处错题本空状态——把「升级为习题册/套卷」入口放到显眼处（原仅在设置里，新用户不易发现）
    if (p.type === 'mistake' && isMistakeFreeMode(p)) {
      emptyHtml += `<li class="empty" style="padding:18px 16px">
        <div style="font-size:13px;color:var(--muted);margin-bottom:12px;line-height:1.6">这本错题本当前是「自由出处」模式。<br>如果你习惯按页码或套卷整理，可以现在升级（升级后不可转回）。</div>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          <button type="button" class="primary-btn" id="emptyUpgPage" style="padding:9px 16px;font-size:13px">📄 升级为习题册模式</button>
          <button type="button" class="primary-btn" id="emptyUpgSet" style="padding:9px 16px;font-size:13px">📑 升级为套卷模式</button>
        </div>
      </li>`;
    }
    list.innerHTML = emptyHtml;
    const eab = document.getElementById('emptyAddBtn');
    if (eab) eab.addEventListener('click', () => scrollToEntryForm('#reciteContent'));
    const ep = document.getElementById('emptyUpgPage');
    const es = document.getElementById('emptyUpgSet');
    if (ep) ep.addEventListener('click', () => switchMistakeFormat('page'));
    if (es) es.addEventListener('click', () => switchMistakeFormat('set'));
    return;
  }

  // 单条渲染（提取为内部函数，套卷分组时复用）
  const renderItemLi = (it) => {
    const d = parseDate(it.learnedDate);
    const mastery = getMasteryInfo(it, p);

    let rightBadge;
    if (it.manualMastered) {
      rightBadge = '<span class="badge badge-ok">已熟知</span>';
    } else if (it.mastered) {
      rightBadge = `<span class="badge badge-ok">${p.type === 'mistake' ? '已攻克' : '已掌握'}</span>`;
    } else if (it.nextReviewDate && it.nextReviewDate <= today) {
      const overdue = diffDays(it.nextReviewDate, today);
      rightBadge = overdue > 0
        ? `<span class="badge badge-warn">逾期 ${overdue} 天</span>`
        : '<span class="badge badge-warn">今日复习</span>';
    } else if (it.nextReviewDate) {
      rightBadge = `<span class="badge">${fmtCN(it.nextReviewDate)}复习</span>`;
    } else {
      rightBadge = '<span class="badge badge-muted">—</span>';
    }

    let histHtml = '';
    if (it.reviews && it.reviews.length) {
      const rows = it.reviews.map((r, idx) => {
        const qLabels = p.type === 'mistake'
          ? { good: '做对', fuzzy: '看答案', forgot: '错了' }
          : { good: '记得', fuzzy: '模糊', forgot: '忘记' };
        const noteHtml = r.note ? `<div class="hist-note">📝 ${esc(r.note)}</div>` : '';
        return `<div class="hist-row">
          <span class="hist-date">${fmtCN(r.date)}</span>
          <span class="muted">第${r.stage + 1}轮</span>
          <div class="hist-btns">
            <button class="hist-q-btn ${r.quality === 'good' ? 'active-good' : ''}" data-hist-item="${it.id}" data-hist-idx="${idx}" data-quality="good">${qLabels.good}</button>
            <button class="hist-q-btn ${r.quality === 'fuzzy' ? 'active-fuzzy' : ''}" data-hist-item="${it.id}" data-hist-idx="${idx}" data-quality="fuzzy">${qLabels.fuzzy}</button>
            <button class="hist-q-btn ${r.quality === 'forgot' ? 'active-forgot' : ''}" data-hist-item="${it.id}" data-hist-idx="${idx}" data-quality="forgot">${qLabels.forgot}</button>
          </div>
          ${noteHtml}
        </div>`;
      }).join('');
      histHtml = `<div class="hist-panel" style="display:none">${rows}</div>`;
    }

    const canEarlyReview = !it.mastered && !it.manualMastered && it.nextReviewDate && it.nextReviewDate > today;
    const earlyBtn = canEarlyReview
      ? `<button class="early-review-btn" data-early="${it.id}" title="提前复习这条">⏩ 提前复习</button>`
      : '';

    // 新录入条目（尚未复习过）加「新」标签，与已有复习历史的条目区分
    const isFreshNew = (!it.reviews || it.reviews.length === 0) && !it.mastered && !it.manualMastered;
    const newTag = isFreshNew
      ? '<span class="m-badge" style="background:#e9ebdb;color:#2e6b4f;font-size:10.5px">🆕 新</span>'
      : '';

    // 错题本：补页码/补套号入口（转换后旧条目无定位字段时显示）
    let fillLocBtn = '';
    if (p.type === 'mistake') {
      if (isMistakePageMode(p) && !hasPageLocator(it)) {
        fillLocBtn = `<button class="early-review-btn" data-fill-page="${it.id}" title="补页码" style="background:#e9ebdb;color:#2e6b4f">📍 补页码</button>`;
      } else if (isMistakeSetMode(p) && !hasSetLocator(it)) {
        fillLocBtn = `<button class="early-review-btn" data-fill-set="${it.id}" title="补套号" style="background:#e9ebdb;color:#2e6b4f">📍 补套号</button>`;
      }
    }

    const li = document.createElement('li');
    li.className = mastery.cls;
    li.innerHTML =
      `<div class="r-line" style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">` +
      `<span class="r-date">${d.getMonth() + 1}月${d.getDate()}日</span>` +
      `<span class="r-content" title="${esc(it.content)}">${esc(it.content)}</span>` +
      ((loc => loc ? `<span class="r-page">${esc(loc)}</span>` : '')(fmtItemLocator(p, it))) +
      ((it.errTags || []).map(reasonPill).join('')) +
      newTag +
      `<span class="m-badge ${mastery.cls}" style="font-size:10.5px"><span class="dot-sm"></span>${mastery.label}</span>` +
      rightBadge +
      earlyBtn +
      fillLocBtn +
      (it.reviews && it.reviews.length ? '<button class="hist-toggle">历史</button>' : '') +
      `</div>` +
      `<button class="r-del" data-item="${esc(it.id)}" title="删除">×</button>` +
      histHtml;
    return li;
  };

  // 错题本套卷模式：按套卷号分组
  if (isMistakeSetMode(p)) {
    const groups = {};
    const noSet = [];
    items.forEach(it => {
      const no = hasSetLocator(it) ? String(it.setNo) : null;
      if (no) {
        if (!groups[no]) groups[no] = [];
        groups[no].push(it);
      } else {
        noSet.push(it);
      }
    });
    const sortedNos = Object.keys(groups).sort((a, b) => Number(a) - Number(b));
    sortedNos.forEach(no => {
      const groupItems = groups[no];
      const mastered = groupItems.filter(it => it.mastered || it.manualMastered).length;
      const pct = groupItems.length ? Math.round(mastered / groupItems.length * 100) : 0;
      const barColor = pct >= 80 ? '#096f4e' : (pct >= 40 ? '#e0a020' : '#e5484d');
      const groupHeader = document.createElement('div');
      groupHeader.style.cssText = 'padding:10px 14px;background:var(--bg);border-radius:10px;margin:8px 0 4px;display:flex;align-items:center;gap:10px';
      groupHeader.innerHTML = `
        <span style="font-weight:700;font-size:14px">📑 ${paperLabel(p, Number(no))}</span>
        <span style="font-size:12px;color:var(--muted)">${groupItems.length}道错题 · 已攻克${mastered}道</span>
        <div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${barColor};border-radius:3px"></div>
        </div>
        <span style="font-size:12px;font-weight:600;color:${barColor}">${pct}%</span>`;
      list.appendChild(groupHeader);
      groupItems.forEach(it => list.appendChild(renderItemLi(it)));
    });
    if (noSet.length) {
      const groupHeader = document.createElement('div');
      groupHeader.style.cssText = 'padding:10px 14px;background:var(--bg);border-radius:10px;margin:8px 0 4px;';
      groupHeader.innerHTML = `<span style="font-weight:700;font-size:14px">📂 未归类</span><span style="font-size:12px;color:var(--muted);margin-left:8px">${noSet.length}道（未填写套卷号）</span>`;
      list.appendChild(groupHeader);
      noSet.forEach(it => list.appendChild(renderItemLi(it)));
    }
  } else {
    items.forEach(it => list.appendChild(renderItemLi(it)));
  }

  // 恢复历史面板展开状态
  if (_expandedHistItems.size) {
    list.querySelectorAll('li').forEach(li => {
      const toggle = li.querySelector('.hist-toggle');
      const panel = li.querySelector('.hist-panel');
      if (!toggle || !panel) return;
      const histBtn = panel.querySelector('[data-hist-item]');
      const itemId = histBtn ? histBtn.dataset.histItem : null;
      if (itemId && _expandedHistItems.has(itemId)) {
        panel.style.display = 'block';
        toggle.textContent = '收起';
      }
    });
  }
}

/* ============ 图表 ============ */
function drawChart(m, p) {
  const _lgPlan = document.getElementById('legendPlan');
  if (_lgPlan) _lgPlan.style.display = '';
  const canvas = $('#chart');
  if (!canvas) return;
  const W = canvas.clientWidth || 600;
  const H = 220;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const _isDark = document.documentElement.dataset.theme === 'dark';
  const tickCol  = _isDark ? 'rgba(210,200,180,.8)'  : 'rgba(140,130,115,.85)';
  const gridCol  = _isDark ? 'rgba(210,200,180,.13)' : 'rgba(140,130,115,.13)';
  const planCol  = _isDark ? 'rgba(210,200,180,.4)'  : 'rgba(170,160,145,.45)';
  const todayCol = '#e0a020';

  // total 为 0 时画空图，避免除零
  if (!m.total || m.total <= 0) {
    ctx.fillStyle = tickCol;
    ctx.font = '13px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('暂无数据，开始学习后显示进度曲线', W / 2, H / 2);
    return;
  }

  const u = unitName(p);

  // 收集实际进度点（三种模式统一：exercise→records；recite/mistake→learnedDate+masteredDate）
  let pts = [];
  if (p.type === 'exercise') {
    const dates = [...new Set((p.records || []).map(r => r.date))].sort();
    pts = dates.map(d => ({ date: d, page: getCompletedPagesAtDate(p, d) }));
  } else {
    const dateSet = new Set();
    (p.items || []).forEach(it => {
      if (it.learnedDate) dateSet.add(it.learnedDate);
      if (it.masteredDate) dateSet.add(it.masteredDate);
    });
    const dates = [...dateSet].sort();
    pts = dates.map(d => ({ date: d, page: getCompletedPagesAtDate(p, d) }));
  }
  pts.sort((a, b) => a.date < b.date ? -1 : 1);

  // 错题：按间隔排期模拟"每条题顺利复习时的预计攻克日"（已攻克用实际 masteredDate）。
  // 攻克天然比收录晚约一个复习周期；今天只需清到期复习，实际线贴着预计线即正常，不会显得落后。
  let fPts = [];
  if (p.type === 'mistake') {
    const fdates = [];
    (p.items || []).forEach(it => {
      if (it.masteredDate) { fdates.push(it.masteredDate); return; }
      if (it.mastered || it.manualMastered) { fdates.push(it.masteredDate || m.t); return; }
      const iv = getItemIntervals(it, p);
      let d = null;
      if (it.nextReviewDate) {
        const s = Math.min(it.stage || 0, iv.length - 1);
        let rest = 0; for (let k = s + 1; k <= iv.length - 2; k++) rest += iv[k];
        d = addDays(it.nextReviewDate, rest);
      } else if (it.learnedDate) {
        let tot = 0; for (let k = 0; k <= iv.length - 2; k++) tot += iv[k];
        d = addDays(it.learnedDate, tot);
      }
      if (d) { if (p.deadline && d > p.deadline) d = p.deadline; fdates.push(d); }
    });
    fdates.sort();
    const fmap = {};
    fdates.forEach(d => fmap[d] = (fmap[d] || 0) + 1);
    let fa = 0;
    fPts = Object.keys(fmap).sort().map(d => { fa += fmap[d]; return { date: d, page: fa }; });
  }

  // 右边留出数字标注空间；下边留两行刻度空间（第一行月/起止日期，第二行"今天"）
  const pad = { l: 40, r: 64, t: 20, b: 42 };
  const cw = W - pad.l - pad.r;
  const ch = H - pad.t - pad.b;

  // 起点：优先 startDate，否则第一个点（错题用最早收录日）
  let startD;
  if (p.type === 'mistake') {
    const ld = (p.items || []).map(it => it.learnedDate).filter(Boolean).sort();
    startD = (p.startDate && (!ld.length || p.startDate <= ld[0])) ? p.startDate : (ld.length ? ld[0] : m.t);
  } else {
    startD = (p.startDate && (!pts.length || p.startDate <= pts[0].date)) ? p.startDate : (pts.length ? pts[0].date : m.t);
  }

  // 终点：刷题/背书用未到期 deadline；错题用"最晚预计攻克日"（若 deadline 更早则取 deadline，便于发现来不及）
  let endD;
  if (p.type === 'mistake') {
    endD = fPts.length ? fPts[fPts.length - 1].date : m.t;
    if (endD < m.t) endD = m.t;
    if (p.deadline && p.deadline > m.t && p.deadline < endD) endD = p.deadline;
  } else if (p.deadline && p.deadline > m.t) {
    endD = p.deadline;
  } else {
    endD = m.t;
    if (m.etaDate && m.etaDate > endD) endD = m.etaDate;
  }

  const spanDays = Math.max(1, diffDays(startD, endD));
  const X = d => pad.l + (diffDays(startD, d) / spanDays) * cw;
  const Y = pg => pad.t + ch - (Math.min(Math.max(pg, 0), m.total) / m.total) * ch;

  // ---- 水平网格 + Y 轴刻度 ----
  ctx.font = '11px -apple-system,sans-serif';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const val = m.total * i / 4;
    const y = Y(val);
    ctx.strokeStyle = gridCol;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + cw, y);
    ctx.stroke();
    ctx.fillStyle = tickCol;
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(val), pad.l - 6, y);
  }
  // Y 轴单位（放在最上方刻度右侧，与刻度数字水平错开）
  ctx.font = '10.5px -apple-system,sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(u, pad.l + 4, Y(m.total));

  // ---- X 轴中间月刻度 ----
  const todayX = X(m.t);
  ctx.font = '10.5px -apple-system,sans-serif';
  ctx.textBaseline = 'top';
  {
    const ticks = [];
    const d = new Date(startD + 'T00:00:00');
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    for (;;) {
      const ds = d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-01';
      if (ds >= endD) break;
      ticks.push(ds);
      d.setMonth(d.getMonth() + 1);
    }
    let showTicks = ticks;
    if (ticks.length > 5) {
      const step = Math.ceil(ticks.length / 5);
      showTicks = ticks.filter((_, i) => i % step === 0);
    }
    showTicks.forEach(ds => {
      const x = X(ds);
      if (x < pad.l + 24 || x > pad.l + cw - 24) return;
      if (Math.abs(x - todayX) < 28) return; // 避开"今天"
      ctx.strokeStyle = gridCol;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, pad.t + ch);
      ctx.lineTo(x, pad.t + ch + 4);
      ctx.stroke();
      ctx.fillStyle = tickCol;
      ctx.textAlign = 'center';
      const dt = new Date(ds + 'T00:00:00');
      ctx.fillText((dt.getMonth() + 1) + '月', x, pad.t + ch + 7);
    });
  }

  // ---- 计划线（startD → deadline 的匀速线；startD 已在上面按"填了 startDate 用它，否则用最早打卡日"算好）----
  let idealAtToday = null, planElapsed = 0;
  // 错题本攻克非线性、只按到期复习，不画匀速计划线（否则会与'今日到期已做完'自相矛盾）；背书新学/刷题保留
  if (p.type !== 'mistake' && startD && p.deadline && p.deadline > m.t) {
    const totalSpan = diffDays(startD, p.deadline);
    if (totalSpan > 0) {
      ctx.strokeStyle = planCol;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(X(startD), Y(0));
      ctx.lineTo(X(p.deadline), Y(m.total));
      ctx.stroke();
      ctx.setLineDash([]);
      planElapsed = diffDays(startD, m.t);
      idealAtToday = m.total * Math.max(0, Math.min(1, planElapsed / totalSpan));
    }
  }

  // ---- 今天竖线 ----
  const xt = X(m.t);
  if (xt >= pad.l && xt <= pad.l + cw) {
    ctx.strokeStyle = todayCol;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 1.8;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(xt, pad.t);
    ctx.lineTo(xt, pad.t + ch);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // ---- 错题：预计攻克虚线（按排期模拟，与其他模式的"计划线"同义）----
  if (p.type === 'mistake' && fPts.length) {
    ctx.strokeStyle = planCol;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    fPts.forEach((pt, i) => { const x = X(pt.date), y = Y(pt.page); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ---- 实际进度线 + 面积填充 ----
  const linePts = [];
  if (p.startDate && (!pts.length || p.startDate < pts[0].date)) {
    linePts.push({ date: p.startDate, page: 0 });
  }
  pts.forEach(pt => linePts.push(pt));

  if (linePts.length) {
    // 面积填充（至少两个点才有意义）
    if (linePts.length > 1) {
      const ag = ctx.createLinearGradient(0, pad.t, 0, pad.t + ch);
      ag.addColorStop(0, _isDark ? 'rgba(131,188,169,.20)' : 'rgba(46,107,79,.14)');
      ag.addColorStop(1, 'rgba(46,107,79,0)');
      ctx.beginPath();
      ctx.moveTo(X(linePts[0].date), Y(linePts[0].page));
      linePts.forEach(pt => ctx.lineTo(X(pt.date), Y(pt.page)));
      const lastX = X(linePts[linePts.length - 1].date);
      ctx.lineTo(lastX, pad.t + ch);
      ctx.lineTo(X(linePts[0].date), pad.t + ch);
      ctx.closePath();
      ctx.fillStyle = ag;
      ctx.fill();
    }
    // 折线
    const lg = ctx.createLinearGradient(pad.l, 0, pad.l + cw, 0);
    lg.addColorStop(0, '#2e6b4f');
    lg.addColorStop(1, '#23533d');
    ctx.strokeStyle = lg;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    linePts.forEach((pt, i) => {
      const x = X(pt.date), y = Y(pt.page);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    // 历史数据点
    ctx.fillStyle = '#2e6b4f';
    linePts.forEach(pt => {
      ctx.beginPath();
      ctx.arc(X(pt.date), Y(pt.page), 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // ---- 当前位置（折线末端即当前位置，不额外画大圈）----
  const lastPt = linePts[linePts.length - 1];

  // ---- "应到 X" 标注（今天竖线与计划/预计线交点）----
  let _idealVal = idealAtToday;
  if (p.type === 'mistake') {
    let v = 0; fPts.forEach(q => { if (q.date <= m.t) v = q.page; });
    _idealVal = v;
  }
  if (_idealVal != null && xt >= pad.l && xt <= pad.l + cw && lastPt) {
    const iy = Y(_idealVal);
    ctx.beginPath();
    ctx.arc(xt, iy, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = planCol;
    ctx.fill();
    ctx.font = '11px -apple-system,sans-serif';
    ctx.fillStyle = tickCol;
    ctx.textBaseline = 'middle';
    let ix = xt + 8, ialign = 'left';
    if (xt > pad.l + cw - 70) { ix = xt - 8; ialign = 'right'; }
    ctx.textAlign = ialign;
    // 点太靠下时文字放上方，避免和 X 轴标签重叠
    const below = iy < pad.t + ch - 20;
    let label;
    if (p.type === 'mistake') label = `应攻克 ${fmtUnitNum(_idealVal)} ${u}`;
    else if (planElapsed <= 0) label = '刚启动，继续加油！';
    else if (planElapsed <= 2) label = `应到 ${fmtUnitNum(idealAtToday)} ${u}（早期估算）`;
    else label = `应到 ${fmtUnitNum(idealAtToday)} ${u}`;
    ctx.fillText(label, ix, below ? iy + 13 : iy - 13);
  }

  // ---- X 轴两端日期 ----
  ctx.font = '11px -apple-system,sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillStyle = tickCol;
  ctx.textAlign = 'left';
  ctx.fillText(fmtCN(startD), pad.l, pad.t + ch + 7);
  ctx.textAlign = 'right';
  ctx.fillText(fmtCN(endD), pad.l + cw, pad.t + ch + 7);

  // X 轴下方第二行标"今天"（与第一行起止/月刻度垂直错开，避免压住日期）
  if (xt > pad.l + 24 && xt < pad.l + cw - 24) {
    ctx.textAlign = 'center';
    ctx.fillStyle = todayCol;
    ctx.fillText('今天', xt, pad.t + ch + 24);
  }
}

/* ============ 项目切换 ============ */
function openSwitch() { renderProjectList(); $('#switchMask').hidden = false; modalTop($('#switchMask')); }
function closeSwitch() { const m=$('#switchMask'); if(m.hidden) return; m.hidden=true; unlockBodyScroll(); }

function renderProjectList() {
  const list = $('#projectList');
  const ids = Object.keys(store.projects);
  if (!ids.length) {
    list.innerHTML = '<li class="empty" style="padding:24px 8px;text-align:center">📚<br>还没有任务，点下面「＋新建」开始吧。</li>';
    return;
  }
  const all = ids.map(id => store.projects[id]);
  // 按类型分组：刷题、背书、错题
  const groups = [
    { key: 'exercise', label: '📚 刷题', items: [] },
    { key: 'recite', label: '📖 背书', items: [] },
    { key: 'mistake', label: '📝 错题', items: [] },
  ];
  all.forEach(p => {
    const g = groups.find(g => g.key === p.type);
    if (g) g.items.push(p);
  });
  // 组内按更新时间排序
  groups.forEach(g => g.items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));

  const renderItem = (p) => {
    const m = getMetrics(p);
    const pct = m.total > 0 ? Math.min(100, m.currentPage / m.total * 100) : 0;
    const active = p.id === store.currentId;
    const type = TYPES[p.type] || TYPES.exercise;

    let extra = '';
    if (p.type !== 'exercise') {
      const due = getDueItems(p).length;
      const over = getOverdueItems(p).length;
      if (due > 0) {
        const label = p.type === 'mistake' ? '道待解决' : '条待复习';
        extra = over > 0
          ? ` · <span style="color:#96600c;font-weight:600">${due} ${label}（${over} 逾期）</span>`
          : ` · <span style="color:#96600c;font-weight:600">${due} ${label}</span>`;
      }
    }
    let modeTag = '';
    if (p.type === 'exercise') {
      modeTag = isSetMode(p)
        ? '<span class="type-tag mode-tag-inline set">套卷模式</span>'
        : '<span class="type-tag mode-tag-inline">习题册模式</span>';
    } else if (p.type === 'mistake') {
      const mm = p.mistakeMode || 'free';
      if (mm === 'page') modeTag = '<span class="type-tag mode-tag-inline">习题册模式</span>';
      else if (mm === 'set') modeTag = '<span class="type-tag mode-tag-inline set">套卷模式</span>';
      else modeTag = '<span class="type-tag mode-tag-inline mistake-free">自由出处模式</span>';
    }
    // 关联信息
    let linkInfo = '';
    if (p.type === 'mistake' && p.refProjectId && store.projects[p.refProjectId]) {
      const refName = store.projects[p.refProjectId].name;
      const short = refName.length > 8 ? refName.substring(0, 8) + '…' : refName;
      linkInfo = ` · 🔗 关联：${esc(short)}`;
    } else if (p.type === 'exercise') {
      const linkedCount = Object.values(store.projects).filter(o => o.type === 'mistake' && o.refProjectId === p.id).length;
      if (linkedCount > 0) linkInfo = ` · 🔗 ${linkedCount}个关联错题本`;
    }

    return `<li class="project-item ${type.typeCls}${active ? ' active' : ''}" data-id="${esc(p.id)}">
      <span class="pi-icon">${type.icon}</span>
      <div class="pi-main">
        <div class="pi-name">
          <span class="pi-name-text">${esc(p.name)}</span>
          <span class="type-tag ${type.badgeCls}">${type.name}</span>
          ${modeTag}
        </div>
        <div class="pi-meta">${fmtUnitNum(m.currentPage)} / ${fmtUnitNum(m.total)} ${unitName(p)} · ${pct.toFixed(0)}% · 目标 ${p.deadline}${extra}${linkInfo}</div>
      </div>
      <button class="pi-del" data-del="${p.id}" title="删除">×</button>
    </li>`;
  };

  let html = '';
  groups.forEach(g => {
    if (g.items.length === 0) return;
    html += `<li class="project-group-label" style="padding:8px 4px 4px;font-size:12px;font-weight:700;color:var(--muted);letter-spacing:.5px">${g.label}（${g.items.length}）</li>`;
    html += g.items.map(renderItem).join('');
  });
  list.innerHTML = html;
}

/* ============ 完成情况（进度明细）面板 ============ */
function openProgressBoard() {
  const p = cur();
  if (!p || p.type !== 'exercise') return;
  renderProgressBoard(p);
  $('#progressMask').hidden = false;
  modalTop($('#progressMask'));
}
function closeProgressBoard() { const m=$('#progressMask'); if(m.hidden) return; m.hidden=true; unlockBodyScroll(); }

/* ============ 今日总览 ============ */
const REMIND_KEY = 'study_tracker_remind';
const REMIND_FIRED_KEY = 'study_tracker_remind_fired';
function isValidHHMM(t) { return typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t); }
/* 读取提醒设置：支持多个提醒时间 times[]，并兼容旧版本的单个 time 字段 */
function getReminder() {
  let r = {};
  try { r = JSON.parse(getLocalVal(REMIND_KEY, '{}')); } catch (e) { r = {}; }
  let times = [];
  if (Array.isArray(r.times)) times = r.times.filter(isValidHHMM);
  else if (isValidHHMM(r.time)) times = [r.time];
  times = [...new Set(times)].sort();
  if (!times.length) times = ['20:00'];
  return { enabled: !!r.enabled, times, time: times[0] };
}
function saveReminder(enabled, times) {
  const clean = [...new Set((times || []).filter(isValidHHMM))].sort();
  const t = clean.length ? clean : ['20:00'];
  setLocalVal(REMIND_KEY, JSON.stringify({ enabled: !!enabled, times: t, time: t[0] }));
  return t;
}
/* 当天各时间点是否已弹过（防止同一分钟轮询重复弹、支持一天多个时间各弹一次） */
function getFiredMark() {
  try { const m = JSON.parse(getLocalVal(REMIND_FIRED_KEY, '{}')); if (m && m.date === todayStr() && Array.isArray(m.times)) return m; } catch (e) {}
  return { date: todayStr(), times: [] };
}
function currentStreak(heat, today) {
  // 今天已打卡从今天算；今天还没打卡则从昨天往回算（不因今天尚未学就清零）
  let s = 0, d = heat[today] ? today : addDays(today, -1);
  while (heat[d] && s < 365) { s++; d = addDays(d, -1); } // 加上界避免长期数据大量循环
  return s;
}
function timeGreeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 11) return '早上好';
  if (h >= 11 && h < 14) return '中午好';
  if (h >= 14 && h < 18) return '下午好';
  if (h >= 18 && h < 23) return '晚上好';
  return '夜深了';
}
/* ============ 27考研倒计时 + 每日一句 ============ */
const KY_EXAM_DAY = '2026-12-19';   // 考试第一天
const KY_EXAM_END = '2026-12-20';   // 考试第二天
const KY_START    = '2026-09-19';   // 句子库起点（今天）

// 93句，按时间顺序：前期(31) + 中期(31) + 冲刺(29) + 考试当天(1) + 考试结束(1)
const KY_QUOTES = [
  // ===== 前期 9.19-10.19（慢慢来，扎根）=====
  '因为我有能力跨越，这个考验才会降临。',
  '我知道的，你做什么都会成功。',
  '灵魂的渴望是命运的先知，敢于梦想，甘于孤独。',
  '渴望，那就全力以赴。',
  '大胆去做，你远比想象中的厉害！',
  '你终究会成为你正在成为的人。',
  '你笔下的每一道题，都在铺就上岸的路。',
  '命运反复考验，只为看到一颗坚定自信的心。',
  '前途是光明的，道路是曲折的，只要不放弃，事物总在变得更好。',
  '人只有在进步的时候才会觉得累，别把疲惫当成失败的信号。',
  '你可以一边害怕，一边勇敢。',
  '愿你有前进一寸的勇气，亦有后退一尺的从容。',
  '如果运气不好，那就试试勇气。',
  '勇敢的人，不是不流泪的人，而是流着泪，仍然坚持奔跑的人。',
  '别让困难定义你，你要定义困难。',
  '且视他人疑目如萤火，大胆奔赴自己的前路。',
  '迎万难，赢万难。',
  '纵有狂风拔地起，我亦乘风破万里，不惧前路风浪。',
  '千磨万击还坚劲，任尔东西南北风。',
  '心有鸿鹄凌云志，不惧人间行路难。',
  '去经历，去后悔，去做你想做的。',
  '宁愿被绊倒无数次，也不要规规矩矩的走一辈子。',
  '别在该奋斗的年纪选择安逸，你的努力配得上所有期待。',
  '虽然辛苦，我还是会选择那种滚烫的人生。',
  '这一次我一定要拼尽全力，不为谁，只为给自己一个交代。',
  '看不清未来时，那就坚持得久一点。',
  '慢也好，步子小也好，是在往前走就好。',
  '三十年河东，三十年河西，莫欺少年穷。',
  '看似不起眼的日复一日，会在将来的某一天，突然让你看到坚持的意义。',
  '不是看见希望才坚持，是坚持过后，才会撞见希望。',
  '成功是由日复一日的点滴努力汇聚而成的。',
  // ===== 中期 10.20-11.19（坚持，自律）=====
  '那些日复一日无人看见的努力，终会在某天兑现全部惊喜。',
  '没有白熬的夜，没有白走的路，每一份付出都算数。',
  '每一滴汗水都是浇灌成功的种子。',
  '你的坚持，终将美好。',
  '关关难过关关过，前路漫漫亦灿灿。',
  '半山腰永远拥挤，坚持向上，去山顶独享风景。',
  '追风赶月莫停留，平芜尽处是春山。',
  '路虽远，行则将至；事虽难，做则必成。',
  '知不足而奋进，望远山而力行。',
  '无人问津的日子，都在悄悄扎根，花期未到，只管沉淀自己。',
  '没有一朵花从一开始就是花，你也在慢慢扎根。',
  '当你坚持不下去的时候，困难也快要坚持不住了。',
  '且听风吟，静待花开。',
  '好运藏在努力里。',
  '理想与现实差了十万八千里，我鞭长莫及，却也马不停蹄。',
  '所有的负担都会变成礼物，现在所受的苦，都会照亮未来迷茫的路。',
  '生活先苦，而后回甘。',
  '苦尽甘来终有时，一路向阳待花期。',
  '所谓无底深渊，下去，也是前程万里。',
  '命运给你一个低谷，是为了让你写出绝地反击的故事。',
  '万物皆有裂痕，那是光照进来的地方。',
  '夜色难免黑凉，前行必有曙光。',
  '在隆冬，我终于知道，我身上有一个不可战胜的夏天。',
  '不要慌，不要慌，太阳下山有月光，月亮西沉有朝阳。',
  '请你务必，千次万次，救自己于水火。',
  '失败和失望绝大部分是懒惰的错，成功和成就永远都是坚持拼搏的成果。',
  '别辜负了你受的苦难，又对不起你的野心。',
  '自律和不自律都会吃苦，不同的是，自律的苦会让人生越来越甜。',
  '用行动打败焦虑，用坚持战胜迷茫。',
  '情绪解决不了难题，落地行动，才是治愈焦虑最好的方式。',
  '把行动交给现在，把结果交给时间。',
  // ===== 冲刺期 11.20-12.18（最后一个月）=====
  '没有人可以回到过去，但谁都可以从现在开始。',
  '当你觉得晚了的时候，恰恰是最早的时候。',
  '所有的为时已晚，其实是恰逢其时。',
  '生活原本沉闷，但跑起来就有风，不必困住当下的情绪。',
  '最完美的状态不是你不失误，而是你从没放弃成长。',
  '人生最大的贵人，是努力向上的自己。',
  '把自己活成一束光，自信坦荡，光芒万丈。',
  '发光不是太阳的权利，你也可以。',
  '我自己就是最好的，无需向他人证明。',
  '自己这一页，应是明媚自由，步履生花。',
  '自洽而内求，达观而内醒。',
  '向外求求而不得，向内求生生不息。',
  '人生是旷野，不是轨道，不必被世俗标准困住人生选择。',
  '不用和任何人攀比，你有自己的节奏，有专属的花期。',
  '人生是马拉松，不是短跑，不必因为暂时落后自我否定。',
  '允许偶尔疲惫低落，但是不要停下向前的脚步。',
  '爬到山顶，不是为了被世界看见，而是为了看见全世界。',
  '你踮起脚尖靠近太阳，全世界都挡不住你的光。',
  '满怀希望就会所向披靡。',
  '最好的状态是未来可期。',
  '向前看，轻舟已过万重山。',
  '我们终将上岸，且阳光万里。',
  '人生虽曲折，记得活出精彩。',
  '哪怕身处沟渠，也要仰望星空。',
  '愿你以渺小启程，以伟大结束。',
  '少年不惧岁月长，彼方尚有荣光在。',
  '凡是过往，皆为序章，所有将来，皆是可盼。',
  '与其抱怨黑暗，不如点亮蜡烛。',
  '能坚持到现在，你真的很棒！最后再看看错题翻翻书，早点休息~',
  // ===== 考试当天 12.19 =====
  '风雨兼程终有归期，提笔从容自信，合笔如愿以偿。',
  // ===== 考试结束 12.20 =====
  '一研为定，定为研一。'
];

function getKaoyanInfo() {
  const today = todayStr();
  const now = new Date();
  const todayDate = new Date(today + 'T00:00:00');
  const examDate = new Date(KY_EXAM_DAY + 'T00:00:00');
  const endDate = new Date(KY_EXAM_END + 'T00:00:00');
  const startDate = new Date(KY_START + 'T00:00:00');

  const toExam = Math.ceil((examDate - todayDate) / 86400000);
  const toEnd = Math.ceil((endDate - todayDate) / 86400000);
  const dayIdx = Math.floor((todayDate - startDate) / 86400000);

  let state = 'countdown'; // countdown / exam1 / exam2 / exam2-done / hidden
  if (today > KY_EXAM_END) state = 'hidden';
  else if (today === KY_EXAM_END) {
    // 下午5点后才算考试结束
    state = (now.getHours() >= 17) ? 'exam2-done' : 'exam2';
  }
  else if (today === KY_EXAM_DAY) state = 'exam1';

  const quote = (dayIdx >= 0 && dayIdx < KY_QUOTES.length) ? KY_QUOTES[dayIdx] : '';
  return { days: toExam, daysToEnd: toEnd, state, quote, dayIdx };
}

function getKaoyanHTML() {
  const ky = getKaoyanInfo();
  if (ky.state === 'hidden') return ''; // 12.21 起撤掉
  let cls = '', emoji = '📚', title = '距离27考研还有';
  let daysText = ky.days;
  if (ky.state === 'exam1') {
    cls = ' exam-day';
    emoji = '✍️';
    title = '今天是考研第一天';
    daysText = '上考场';
  } else if (ky.state === 'exam2') {
    cls = ' exam-day';
    emoji = '📝';
    title = '今天是考研第二天';
    daysText = '继续加油';
  } else if (ky.state === 'exam2-done') {
    cls = ' exam-done';
    emoji = '🎉';
    title = '考研结束啦';
    daysText = '好好休息';
  }
  return `
    <div class="kaoyan${cls}">
      <div class="ky-label">${title}</div>
      <div class="ky-days">${daysText}<small>${ky.state === 'countdown' ? '天' : ''}</small></div>
      ${ky.quote ? `<div class="ky-divider"></div><div class="ky-quote-tag">每 日 一 句</div><div class="ky-quote">${ky.quote}</div>` : ''}
    </div>`;
}

/* ============ 每周小结（本周首次打开看板时回顾上周，被动出现、不新增操作） ============ */
function getMondayOf(s) {
  const d = parseDate(s);
  const dow = d.getDay(); // 0=周日
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  return fmtDate(d);
}
const _pick = arr => arr[Math.floor(Math.random() * arr.length)];

/* 每周小结统计：分项目类型统计上周数据 */
function buildWeeklyStats(today) {
  const todayD = parseDate(today);
  const isMonday = todayD.getDay() === 1; // 周一=1
  const thisMon = getMondayOf(today);
  const lastMon = addDays(thisMon, -7);
  const lastSun = addDays(thisMon, -1);
  const beforeWeek = addDays(lastMon, -1);  // 上周开始前一天（用于算进度差）
  const inWeek = d => d && d >= lastMon && d <= lastSun;
  const heat = {};
  let earliest = null;

  // 分类型统计
  let exercisePages = 0, exerciseSets = 0;   // 刷题：页/套
  let reciteNew = 0, reciteReviews = 0;       // 背书：新学条/复习次
  let mistakeNew = 0, mistakeMastered = 0, mistakeReviews = 0; // 错题：新增/攻克/复习

  Object.values(store.projects).forEach(p => {
    /* ===== 刷题本：用"上周结束进度 - 上周开始进度"的差值，天然去重、正确处理板块卷 ===== */
    if (p.type === 'exercise' && Array.isArray(p.records)) {
      p.records.forEach(r => {
        heat[r.date] = (heat[r.date] || 0) + 1;
        if (!earliest || r.date < earliest) earliest = r.date;
      });
      if (isSetMode(p)) {
        // 套卷模式：getCompletedSets 按完成比例返回（板块加权），差值即上周实际完成套数
        exerciseSets += getCompletedSets(p, lastSun) - getCompletedSets(p, beforeWeek);
      } else {
        // 习题册模式：按合并后的页码区间算，差值即上周实际刷的页数
        exercisePages += getCompletedPagesAtDate(p, lastSun) - getCompletedPagesAtDate(p, beforeWeek);
      }
    }

    /* ===== 背书卡 & 错题本：items 结构 ===== */
    (p.items || []).forEach(it => {
      if (it.learnedDate) {
        heat[it.learnedDate] = (heat[it.learnedDate] || 0) + 1;
        if (!earliest || it.learnedDate < earliest) earliest = it.learnedDate;
        if (inWeek(it.learnedDate)) {
          if (p.type === 'recite') reciteNew++;
          else if (p.type === 'mistake') mistakeNew++;
        }
      }
      // reviews[0] 是首次学习，idx>0 才是真正的复习
      (it.reviews || []).forEach((rv, idx) => {
        if (!rv || !rv.date) return;
        heat[rv.date] = (heat[rv.date] || 0) + 1;
        if (!earliest || rv.date < earliest) earliest = rv.date;
        if (idx > 0 && inWeek(rv.date)) {
          if (p.type === 'recite') reciteReviews++;
          else if (p.type === 'mistake') mistakeReviews++;
        }
      });
      // 保持复习评价（已掌握条目的定期回顾）也计入复习次数
      (it.retentionReviews || []).forEach(rv => {
        if (!rv || !rv.date) return;
        heat[rv.date] = (heat[rv.date] || 0) + 1;
        if (!earliest || rv.date < earliest) earliest = rv.date;
        if (inWeek(rv.date)) {
          if (p.type === 'recite') reciteReviews++;
          else if (p.type === 'mistake') mistakeReviews++;
        }
      });
      // 上周攻克的错题
      if (p.type === 'mistake' && (it.mastered || it.manualMastered) && inWeek(it.masteredDate)) {
        mistakeMastered++;
      }
    });
  });

  let activeDays = 0;
  for (let i = 0; i < 7; i++) { if (heat[addDays(lastMon, i)]) activeDays++; }
  const streak = currentStreak(heat, today);
  const ageDays = earliest ? diffDays(earliest, today) + 1 : 0;
  // 汇总（套数/页数统一在累加后取整，避免多个项目各自四舍五入导致虚高）
  exerciseSets = Math.max(0, Math.round(exerciseSets));
  exercisePages = Math.max(0, Math.round(exercisePages));
  const totalReviews = reciteReviews + mistakeReviews;
  const totalNew = reciteNew + mistakeNew;

  return { isMonday, lastMon, lastSun, activeDays, streak, ageDays,
    exercisePages, exerciseSets,
    reciteNew, reciteReviews,
    mistakeNew, mistakeMastered, mistakeReviews,
    totalReviews, totalNew };
}

function getWeeklyReviewHTML() {
  const today = todayStr();
  if (!Object.keys(store.projects || {}).length) return '';
  const s = buildWeeklyStats(today);
  // 只在周一显示上周小结，周一全天展示
  if (!s.isMonday) return '';
  // 完全没有任何学习数据时不显示
  if (s.ageDays <= 0) return '';
  // 上周完全没活动也不显示（没什么可总结的）
  if (s.activeDays === 0 && s.totalReviews === 0 && s.totalNew === 0
      && s.exercisePages === 0 && s.exerciseSets === 0 && s.mistakeMastered === 0) return '';

  // 构建数据描述文本（用于文案填充）：只描述该用户实际做过的事
  const parts = [];
  if (s.exercisePages > 0) parts.push(`刷了 ${s.exercisePages} 页题`);
  if (s.exerciseSets > 0) parts.push(`刷了 ${s.exerciseSets} 套卷`);
  if (s.reciteNew > 0) parts.push(`新背 ${s.reciteNew} 条`);
  if (s.reciteReviews > 0) parts.push(`复习背书 ${s.reciteReviews} 次`);
  if (s.mistakeNew > 0) parts.push(`收录 ${s.mistakeNew} 道错题`);
  if (s.mistakeMastered > 0) parts.push(`攻克错题 ${s.mistakeMastered} 道`);
  if (s.mistakeReviews > 0) parts.push(`复习错题 ${s.mistakeReviews} 次`);
  const whatYouDid = parts.length ? parts.join('、') : '完成了日常复习';

  const fill = t => t
    .replace(/\{days\}/g, s.activeDays)
    .replace(/\{streak\}/g, s.streak)
    .replace(/\{rest\}/g, 7 - s.activeDays)
    .replace(/\{reviews\}/g, s.totalReviews)
    .replace(/\{new\}/g, s.totalNew)
    .replace(/\{what(YouDid)?\}/g, whatYouDid);

  // 冲刺期建议池
  const sprintTips = [
    '进入冲刺阶段，优先保住高频考点和错题本，这是性价比最高的提分点。',
    '最后阶段别再大面积铺新内容，把学过的稳住、错题清零，比什么都强。',
    '越临近考试越要守住睡眠，清醒的头脑比熬夜多背的那点内容值钱得多。',
    '保持手感最重要：每天做点题、过一遍错题，让状态在考试当天到顶点。',
    '冲刺期复习讲究"回炉"，之前标记模糊、错过的内容，这阶段值得多看两遍。'
  ];

  let emoji, title, msgs, tips;
  const isNew = s.ageDays < 7;
  const ky = getKaoyanInfo();
  const isSprint = ky.state === 'countdown' && ky.days >= 0 && ky.days <= 30;

  if (isNew) {
    emoji = '🌱'; title = '第一周 · 起步';
    msgs = [
      '欢迎开始记录！第一步往往最难，你已经迈出来了。',
      '把学习提上日程的这一刻，你就已经和昨天的自己不一样了。',
      '万事开头难，你已经在路上了。先别急着追求完美，把"每天记一点"养起来。'
    ];
    tips = [
      '这周不用追求量，先熟悉"学习→复习→掌握"的流程，节奏会自己长出来。',
      '可以先从一个科目跑通完整流程，再慢慢加量，比一上来就铺满更稳。',
      '把每天的目标定得轻松一点，连续几天都能完成，比一次猛学有用得多。'
    ];
  } else if (s.activeDays === 0) {
    emoji = '🍃'; title = '上周 · 暂停了一下';
    msgs = [
      '上周暂时没有学习记录，没关系，节奏断了随时能接上。',
      '休息本来就是备考的一部分。重要的不是从没停下，而是停下后还愿意回来。',
      '上周留白了，不代表前面的努力白费——学过的还在，捡起来比从零开始快得多。',
      '停了一周？完全来得及。今天打开这个看板，就已经是重新开始了。'
    ];
    tips = [
      '别想着一天补回一周的量，今天先学十几分钟、做几条复习，把状态找回来。',
      '把门槛降到最低：哪怕只复习3条、只看1页，先让"今天学过"这件事发生。',
      '如果确实太累，就允许自己再缓一天，但定一个具体的重启时间，别让暂停变放弃。'
    ];
  } else if (s.activeDays === 7) {
    emoji = '🔥'; title = '上周 · 全勤';
    msgs = [
      `上周7天全勤！${whatYouDid}，这份自律已经超过绝大多数人了。`,
      `一周七天一天不落，${whatYouDid}，你的稳定本身就是最强的竞争力。`,
      `全勤达成！${whatYouDid}，能每天坐下来学，本身就是很了不起的事。`,
      `连续一周都在线——${whatYouDid}，你正在用行动告诉自己"我是能坚持的人"。`
    ];
    tips = [
      '状态正好，也留意疲劳信号，睡够比多刷几道题更影响长期效率。',
      '全勤很燃，记得留一点喘息时间——能稳稳走到12月的节奏才是好节奏。',
      '天数已经拉满，接下来可以把注意力放到薄弱环节的质量上。'
    ];
  } else if (s.streak >= 7 && s.activeDays >= 5) {
    emoji = '💪'; title = '上周 · 稳定输出';
    msgs = [
      `已经连续打卡 {streak} 天，上周{whatYouDid}，坚持正在变成你的习惯。`,
      `连续学了 {streak} 天，上周{whatYouDid}，这种细水长流的稳定最难得。`,
      `{streak} 天的连续记录背后，上周{whatYouDid}，都是一天天攒下来的硬功夫。`
    ];
    tips = [
      '惯性已经建立，继续保持就好，周末也可以心安理得地放松半天。',
      '趁状态稳定，定期回看一眼整体进度，确认方向没有跑偏。',
      '稳定是你的优势，接下来可以在每天的内容质量上再抠细一点。'
    ];
  } else if (s.activeDays >= 5) {
    emoji = '📈'; title = '上周 · 节奏不错';
    msgs = [
      `上周学了 {days} 天，{whatYouDid}，这个节奏相当扎实。`,
      `一周 {days} 天在学习，{whatYouDid}，已经跑赢了大多数人的状态。`,
      `{days} 天的投入——{whatYouDid}——正在悄悄把你和目标的距离一点点缩短。`
    ];
    tips = [
      '离全勤只差一两天，回想那天被什么占住了，能提前安排就更好。',
      '节奏很好，别让偶尔的一两天中断，悄悄连成更长的松懈。',
      '保持这个频率，同时留意复习是否及时，别让欠账在后台累积。'
    ];
  } else if (s.activeDays >= 3) {
    emoji = '🌤️'; title = '上周 · 张弛有度';
    msgs = [
      `上周学了 {days} 天，{whatYouDid}，已经有了一个不错的基本盘。`,
      `{days} 天学习、{rest} 天休整，{whatYouDid}，张弛之间再加一点点就很理想。`,
      `上周有 {days} 天在推进——{whatYouDid}——节奏在线，还有往上走的空间。`
    ];
    tips = [
      '试着把学习固定在每天同一时段，变成像吃饭一样的动作，天数会自然上来。',
      '从最容易上手的科目开始，先坐下、先学十分钟，往往就停不下来了。',
      '一周三到四天是不错的底子，把目标定在五天，踮踮脚就能够到。'
    ];
  } else {
    emoji = '🌦️'; title = '上周 · 刚起步';
    msgs = [
      `上周学了 {days} 天，{whatYouDid}，虽然不多，但至少没有完全空白。`,
      `上周只记录了 {days} 天，{whatYouDid}，没关系，这周从一个小目标重新起步就好。`,
      `有 {days} 天的开始就不算晚，{whatYouDid}，真正可惜的是一直不开始。`
    ];
    tips = [
      '先别定大计划，这周争取比上周多一天，这就是实打实的进步。',
      '把学习材料放到最顺手的地方，减少"开始"那一下的阻力。',
      '哪怕每天只学二十分钟，一周也能攒出两个多小时，关键是先让频率上来。'
    ];
  }
  if (isSprint) tips = sprintTips;

  // 数据格：根据用户实际使用的模式动态显示，没有数据的指标不出现
  const stat = (num, lab) => `<div class="wr-stat"><div class="wr-num">${num}</div><div class="wr-lab">${lab}</div></div>`;
  // 复习卡片：只有一种模式时显示具体名称，两种都有则显示汇总
  let reviewCard = null;
  if (s.reciteReviews > 0 && s.mistakeReviews > 0) reviewCard = stat(s.totalReviews, '复习总次数');
  else if (s.reciteReviews > 0) reviewCard = stat(s.reciteReviews, '复习背书');
  else if (s.mistakeReviews > 0) reviewCard = stat(s.mistakeReviews, '复习错题');
  const statsHtml = [
    stat(s.activeDays + ' / 7', '学习天数'),
    s.exercisePages > 0 ? stat(s.exercisePages, '刷题页数') : null,
    s.exerciseSets > 0 ? stat(s.exerciseSets, '刷题套数') : null,
    s.reciteNew > 0 ? stat(s.reciteNew, '新背内容') : null,
    s.mistakeNew > 0 ? stat(s.mistakeNew, '新增错题') : null,
    reviewCard,
    s.mistakeMastered > 0 ? stat(s.mistakeMastered, '攻克错题') : null,
    stat(s.streak, '连续打卡')
  ].filter(Boolean).join('');

  return `
    <div class="weekly-review">
      <div class="wr-head">
        <span class="wr-title">${emoji} ${title} · 学习小结</span>
        <span class="wr-date">${fmtCN(s.lastMon)} - ${fmtCN(s.lastSun)}</span>
      </div>
      <div class="wr-stats">${statsHtml}</div>
      <div class="wr-msg">${fill(_pick(msgs))}</div>
      <div class="wr-tip">💡 ${fill(_pick(tips))}</div>
    </div>`;
}

// 今天对"已学内容"完成的复习评价数（录入当天的首次评价不算复习）
function getTodayReviewedCount(p) {
  const today = todayStr();
  let n = 0;
  (p.items || []).forEach(it => {
    if (!it.reviews) return;
    const t = it.reviews.filter(r => r.date === today).length;
    if (!t) return;
    n += (it.learnedDate === today) ? Math.max(0, t - 1) : t;
  });
  return n;
}

// 统一的"今日状态"：done 已完成 / partial 进行中 / todo 未开始 / none 今日无安排（所有模式同一口径）
function getTodayStatus(p) {
  const m = getMetrics(p);
  if (p.type === 'exercise') {
    if (m && m.remaining <= 0) return { state: 'done' };
    const target = m ? getDailyTarget(p, m).per : 0;
    const td = m ? (m.todayDone || 0) : 0;
    if (!(target > 0)) return { state: 'none' };
    if (td >= target) return { state: 'done', need: target, done: td };
    if (td > 0) return { state: 'partial', need: target, done: td };
    return { state: 'todo', need: target, done: 0 };
  }
  const due = getDueItems(p).length;
  const reviewed = getTodayReviewedCount(p);
  let nNeed = 0, nDone = 0, hasNew = false;
  if (p.type === 'recite' && m && m.remaining > 0 && m.feasibility !== 'impossible') {
    const plan = getDailyTarget(p, m).per;
    if (plan != null && plan > 0) { hasNew = true; nNeed = plan; nDone = m.todayDone || 0; }
  }
  const revNeed = due + reviewed, totalNeed = revNeed + nNeed;
  if (totalNeed === 0) {
    if (p.type === 'recite' && m && m.remaining <= 0) return { state: 'done' };
    return { state: 'none' };
  }
  if (due === 0 && (!hasNew || nDone >= nNeed)) return { state: 'done', need: totalNeed, done: totalNeed };
  const progress = reviewed + Math.min(nDone, nNeed);
  if (progress > 0) return { state: 'partial', need: totalNeed, done: progress, due };
  return { state: 'todo', need: totalNeed, done: 0, due };
}

function openDashboard() {
  const ps = Object.values(store.projects);
  const today = todayStr();
  let dueTotal = 0, overdueTotal = 0, retentionTotal = 0;
  const heat = {};
  const exRows = [], reRows = [], miRows = [];
  let plannedPageTotal = 0, plannedSetTotal = 0;
  let tasksTotal = 0, tasksDone = 0, tasksInProgress = 0, tasksOver = 0;

  ps.forEach(p => {
    (p.records || []).forEach(r => { heat[r.date] = (heat[r.date] || 0) + 1; });
    (p.items || []).forEach(it => {
      if (it.learnedDate) heat[it.learnedDate] = (heat[it.learnedDate] || 0) + 1;
      (it.reviews || []).forEach(rv => { heat[rv.date] = (heat[rv.date] || 0) + 1; });
    });
    let done = 0, total = 0, pct = 0, unit = '';
    if (p.type === 'exercise') {
      total = (p.unitMode && Array.isArray(p.units) && p.units.length)
        ? countRanges(getTargetPageRanges(p))
        : ((p.bookStartPage != null && p.bookEndPage != null) ? (p.bookEndPage - p.bookStartPage + 1) : (p.total || 0));
      done = isSetMode(p) ? getCompletedSets(p) : getCompletedPages(p);
      unit = isSetMode(p) ? '套' : '页';
      pct = total > 0 ? done / total * 100 : 0;
      const m = getMetrics(p);
      let planned = 0, planFeasible = true;
      if (m) {
        if (m.feasibility === 'impossible') { planFeasible = false; }
        else planned = getDailyTarget(p, m).per;
      }
      if (planFeasible) { if (isSetMode(p)) plannedSetTotal += planned; else plannedPageTotal += planned; }
      const _exSt = getTodayStatus(p);
      exRows.push({ name: p.name, pct, done, total, unit, planned: planFeasible ? planned : -1, st: _exSt });
      if (_exSt.state !== 'none') {
        tasksTotal++;
        if (_exSt.state === 'done') tasksDone++;
        if (_exSt.state === 'partial') tasksInProgress++;
        if (m && m.remaining > 0 && (m.todayDone||0) > getDailyTarget(p, m).per * 1.2) tasksOver++;
      }
    } else {
      const items = p.items || [];
      const due = getDueItems(p).length;
      const over = getOverdueItems(p).length;
      dueTotal += due; overdueTotal += over;
      retentionTotal += getRetentionDueItems(p).length;
      // 进度口径与主页一致：背书按已背页数 / 总页数；错题按已攻克 / 已收录条数
      if (p.type === 'recite') {
        total = (p.unitMode && Array.isArray(p.units) && p.units.length)
          ? countRanges(getTargetPageRanges(p))
          : ((p.bookStartPage != null && p.bookEndPage != null) ? (p.bookEndPage - p.bookStartPage + 1) : (p.total || 0));
        done = getCompletedPages(p);
      }
      else { total = items.length; done = items.filter(it => it.mastered || it.manualMastered).length; }
      pct = total > 0 ? done / total * 100 : 0;
      const mm = getMetrics(p);
      let plan = null, planBad = false, approx = false;
      if (mm && p.type === 'recite') {
        // 背书：每个学习日新学目标，数据不足时退回粗略均摊
        if (mm.feasibility === 'impossible') planBad = true;
        else { plan = getDailyTarget(p, mm).per; approx = !mm.enoughData; }
      }
      const ru = unitName(p);
      const _rvSt = getTodayStatus(p);
      const row = { name: p.name, pct, done, total, due, over, plan, planBad, approx, unit: ru, st: _rvSt };
      if (p.type === 'recite') reRows.push(row); else miRows.push(row);
      if (_rvSt.state !== 'none') {
        tasksTotal++;
        if (_rvSt.state === 'done') tasksDone++;
        if (_rvSt.state === 'partial') tasksInProgress++;
        if (p.type === 'recite' && mm && mm.remaining > 0 && (mm.todayDone||0) > plan * 1.2) tasksOver++;
      }
    }
  });

  const fmtD = v => Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toString();
  let plannedSummary = '';
  if (plannedPageTotal > 0 || plannedSetTotal > 0) {
    plannedSummary = `学习日刷题建议：` +
      (plannedPageTotal > 0 ? `约 ${fmtD(plannedPageTotal)} 页` : '') +
      (plannedPageTotal > 0 && plannedSetTotal > 0 ? ' + ' : '') +
      (plannedSetTotal > 0 ? `约 ${fmtD(plannedSetTotal)} 套` : '') +
      '（休息日不摊任务）';
  }
  const hasPlan = plannedPageTotal > 0 || plannedSetTotal > 0;
  const reviewTotal = dueTotal;

  const streak = currentStreak(heat, today);

  let msg, enc, urgent = false;
  const g = timeGreeting();
  if (overdueTotal > 0) {
    msg = `有 <b>${overdueTotal}</b> 条已逾期，先把这些最该复习的清掉`; urgent = true;
    enc = '越拖越忘，今天搞定就是胜利！';
  } else if (tasksTotal > 0 && tasksDone >= tasksTotal) {
    if (tasksOver > 0) { msg = '今天的任务全部完成，还超额了'; enc = Coach.pick(Coach.overBig, 'dashover'); }
    else { msg = `今天 ${tasksTotal} 个任务全部完成`; enc = Coach.pick(Coach.done, 'dashdone'); }
  } else if (tasksTotal > 0 && tasksDone > 0) {
    msg = `今天已完成 <b>${tasksDone}/${tasksTotal}</b> 个任务，还剩 ${tasksTotal - tasksDone} 个`;
    enc = Coach.pick(Coach.dashPartial, 'dashpartial');
  } else if (tasksInProgress > 0) {
    const _todoN = tasksTotal - tasksDone - tasksInProgress;
    msg = `已经开了个好头：<b>${tasksInProgress}</b> 个进行中` + (_todoN > 0 ? `，还有 <b>${_todoN}</b> 个待开始` : '') + '，顺手做完';
    enc = Coach.pick(Coach.dashPartial, 'dashprogress');
  } else if (tasksTotal > 0) {
    msg = dueTotal > 0
      ? `今天有 <b>${dueTotal}</b> 条待复习，从它开始（共 ${tasksTotal} 个任务）`
      : `今天还有 <b>${tasksTotal}</b> 个任务待完成，从最顺手的开始`;
    enc = '迈出第一步最重要，开个好头～';
  } else if (retentionTotal > 0) {
    msg = `今天任务已清完，还有 <b>${retentionTotal}</b> 条已掌握内容可快速巩固`;
    enc = '花几分钟确认还记得，记忆更牢～';
  } else {
    msg = '今天没有待完成的任务，状态很好';
    enc = '轻松一下，也可以趁机动点新内容！';
  }
  const statusChip = st => {
    if (!st) return '';
    if (st.state === 'done') return '<span class="ts-chip ts-done" title="今天的目标已全部完成">✓ 今日已完成</span>';
    if (st.state === 'partial') return `<span class="ts-chip ts-partial" title="今天已完成 ${fmtD(st.done)} / 共需 ${fmtD(st.need)}">◐ ${fmtD(st.done)}/${fmtD(st.need)}</span>`;
    if (st.state === 'todo') return `<span class="ts-chip ts-todo" title="今天还有目标没完成">● 今日未完成${st.due ? ' · ' + st.due + '条' : ''}</span>`;
    return '<span class="ts-chip ts-none" title="今天没有安排任务">今日无安排</span>';
  };
  const rowHtml = r => `
    <div class="dash-proj">
      <span class="dp-name" title="${esc(r.name)}">${esc(r.name)}</span>
      <div class="dp-bar"><div class="dp-fill" style="width:${Math.max(0, Math.min(100, r.pct)).toFixed(1)}%"></div></div>
      <span class="dp-pct">${r.total === 0 ? '待收录' : fmtD(r.done) + '/' + fmtD(r.total)}</span>
      ${statusChip(r.st)}
    </div>`;
  const section = (title, sub, rows) => `
    <div style="font-weight:600;font-size:14px;margin:14px 0 4px">${title} <span style="font-weight:400;font-size:12px;color:var(--muted)">${sub}</span></div>
    <div>${rows.length ? rows.map(r => rowHtml(r)).join('') : '<div style="color:var(--muted);font-size:12.5px;padding:6px 0">还没有这类任务，新建后会显示在这里~</div>'}</div>`;

  const remind = getReminder();
  const planParts = [];
  if (plannedPageTotal > 0) planParts.push(fmtD(plannedPageTotal) + '页');
  if (plannedSetTotal > 0) planParts.push(fmtD(plannedSetTotal) + '套');
  const planNum = planParts.length ? planParts.join('+') : '—';
  let notifHtml;
  // 始终显示提醒设置界面：系统通知不可用时自动降级为应用内提醒
  const sysNotifOK = 'Notification' in window && Notification.permission === 'granted';
  const sysNotifShort = !('Notification' in window)
    ? '应用内提醒'
    : (Notification.permission === 'granted' ? '系统通知+应用内' : '应用内提醒');
  const timeRows = getReminder().times.map(t =>
    `<div class="rt-row" style="display:flex;gap:6px;align-items:center">
        <input type="time" class="rt-time" value="${t}" style="padding:6px 10px;border:1px solid var(--line);border-radius:8px;font-size:13px">
        <button type="button" class="rt-del ghost-btn" title="删除这个时间" style="padding:6px 10px">×</button>
      </div>`).join('');
  const toggleStyle = remind.enabled
    ? 'background:#e8f5e9;color:#2e7d32;border-color:#a5d6a7;font-weight:600'
    : '';
  const toggleText = remind.enabled ? '已开启' : '未开启';
  notifHtml = `<div style="margin-top:18px;border-top:1px solid var(--line);padding-top:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="font-weight:600;font-size:14px">每日提醒</div>
        <span style="font-size:11px;color:var(--muted);background:var(--bg);padding:3px 8px;border-radius:10px">${sysNotifShort}</span>
      </div>
      <div style="display:flex;gap:12px;align-items:flex-start">
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;color:var(--muted);margin-bottom:6px">提醒时间（可多个）</div>
          <div id="remindTimes" style="display:flex;flex-direction:column;gap:6px">
            ${timeRows}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <button type="button" class="ghost-btn" id="btnAddTime" style="padding:6px 12px;font-size:12px;white-space:nowrap">＋ 添加</button>
          <button class="ghost-btn" id="btnToggleRemind" style="padding:6px 12px;font-size:12px;white-space:nowrap;${toggleStyle}">${toggleText}</button>
          <button class="ghost-btn" id="btnPreviewRemind" style="padding:6px 12px;font-size:12px;white-space:nowrap">预览</button>
        </div>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:10px;line-height:1.6">
        到点按任务分别提醒今日待办。手机端保持页面打开即可，关闭后下次打开会补发错过的提醒。
      </div>
    </div>`;

  $('#dashBody').innerHTML = `
    ${getKaoyanHTML()}
    ${getWeeklyReviewHTML()}
    <div class="dash-hero ${urgent ? 'urgent' : ''}">
      <div class="greet-big">${g}${(typeof STAuth!=="undefined"&&STAuth.isLoggedIn()&&STAuth.getUsername())?"，"+STAuth.getUsername()+"！":""}</div>
      <div class="greet-sub">这是你今天的学习看板</div>
      <div class="hero-status">${msg}</div>
      <div class="hero-enc">${enc}</div>
    </div>
    <div class="dash-grid">
      <div class="dash-card"><div class="dash-num" style="color:${overdueTotal > 0 ? '#b02e24' : 'inherit'}">${reviewTotal}</div><div class="dash-lab">今日待复习（背书+错题）${overdueTotal > 0 ? ' · <b style="color:#b02e24">含' + overdueTotal + '条逾期</b>' : ''}</div></div>
      <div class="dash-card"><div class="dash-num">${planNum}</div><div class="dash-lab">刷题 · 每学习日目标</div></div>
      <div class="dash-card"><div class="dash-num">${streak}</div><div class="dash-lab">连续打卡（天）</div></div>
    </div>
    ${section('刷题', '名称 · 总进度 · 今日状态', exRows)}
    ${section('背书', '名称 · 总进度 · 今日状态', reRows)}
    ${section('错题', '名称 · 总进度 · 今日状态', miRows)}
    ${notifHtml}
  `;
  $('#dashMask').hidden = false;
  modalTop($('#dashMask'));
  const collectTimes = () => [...document.querySelectorAll('#remindTimes .rt-time')]
    .map(i => i.value).filter(isValidHHMM);
  const timesBox = $('#remindTimes');
  if (timesBox) {
    timesBox.addEventListener('click', e => {
      const del = e.target.closest('.rt-del');
      if (!del) return;
      const cur = getReminder();
      const rows = [...document.querySelectorAll('#remindTimes .rt-row')];
      if (rows.length <= 1) { alert('至少保留一个提醒时间～'); return; }
      del.closest('.rt-row').remove();
      saveReminder(cur.enabled, collectTimes());
      openDashboard();
    });
    timesBox.addEventListener('change', e => {
      if (!e.target.classList.contains('rt-time')) return;
      const cur = getReminder();
      saveReminder(cur.enabled, collectTimes());
    });
  }
  const addBtn = $('#btnAddTime');
  if (addBtn) addBtn.addEventListener('click', () => {
    const cur = getReminder();
    const presets = ['08:00', '12:00', '18:00', '21:00', '07:30', '12:30', '22:00'];
    const next = presets.find(t => !cur.times.includes(t)) || '20:00';
    saveReminder(cur.enabled, cur.times.concat(next));
    openDashboard();
  });
  const b = $('#btnToggleRemind');
  if (b) b.addEventListener('click', async () => {
    const curRem = getReminder();
    const times = collectTimes().length ? collectTimes() : curRem.times;
    if (!curRem.enabled) {
      // 尝试请求系统通知权限，但不强制——被拒绝或不支持时自动降级为应用内提醒
      if ('Notification' in window && Notification.permission !== 'granted') {
        try { await Notification.requestPermission(); } catch (e) {}
      }
      if ('Notification' in window && Notification.permission !== 'granted') {
        alert('系统通知权限未授权，已为你开启应用内提醒（页面打开时顶部弹窗+提示音）。下次打开页面时也会补发错过的提醒。');
      }
      saveReminder(true, times);
    } else {
      saveReminder(false, times);
    }
    openDashboard();
  });
  const pv = $('#btnPreviewRemind');
  if (pv) pv.addEventListener('click', () => {
    const body = buildReminderBody();
    fireReminder('Study Tracker 学习提醒（预览）', body);
  });
}
/* iOS/PWA 下 body{overflow:hidden} 无法阻止背景滚动，改用 position:fixed + 记录 scrollTop */
let _bodyScrollY = 0, _bodyLockCount = 0;
function lockBodyScroll() {
  if (_bodyLockCount === 0) {
    _bodyScrollY = window.scrollY || window.pageYOffset || 0;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${_bodyScrollY}px`;
    document.body.style.width = '100%';
  }
  _bodyLockCount++;
}
function unlockBodyScroll() {
  // 防御：计数已<=0但仍有残留style，强制清除（避免某处漏了lock导致body永久fixed）
  if (_bodyLockCount <= 0) {
    _bodyLockCount = 0;
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
    return;
  }
  _bodyLockCount--;
  if (_bodyLockCount === 0) {
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
    window.scrollTo(0, _bodyScrollY);
  }
}
function closeDashboard() { const m=$('#dashMask'); if(m.hidden) return; m.hidden=true; unlockBodyScroll(); }
function modalTop(maskEl){
  // 幂等：弹窗已显示时说明是刷新操作，不重复锁定滚动和压栈（避免lock计数>unlock次数导致body永久fixed无法滚动）
  if (maskEl && !maskEl.hidden) return;
  lockBodyScroll(); // 同步锁定，避免 unlock 先于 lock 执行导致 body 永久锁死
  // 校准遮罩高度：清除上次键盘弹起残留的内联高度，按当前可视区重新设置
  maskEl.style.height = ''; maskEl.style.top = '';
  if (window.visualViewport){
    maskEl.style.height = window.visualViewport.height + 'px';
    maskEl.style.top = window.visualViewport.offsetTop + 'px';
  }
  // 安卓/微信返回键支持：打开弹窗时压入历史栈，按返回键会触发 popstate 关闭弹窗（见下方监听）
  try { history.pushState({ __stModal: true }, ''); } catch (e) {}
  requestAnimationFrame(()=>{ const m=maskEl.querySelector('.modal'); if(m) m.scrollTop=0; });
}

/* 安卓/微信返回键：关闭最上层弹窗（dataSecurityMask 必须点按钮，返回键不关闭） */
window.addEventListener('popstate', () => {
  const openIds = ALL_MODAL_IDS.filter(id => {
    const el = document.getElementById(id);
    return el && !el.hidden;
  });
  if (!openIds.length) return;
  const topId = openIds[openIds.length - 1];
  if (topId === 'dataSecurityMask') {
    // 数据安全提示必须点按钮：返回键不关闭，但要重新压栈补偿，保持弹窗与历史栈对齐
    try { history.pushState({ __stModal: true }, ''); } catch (e) {}
    return;
  }
  const el = document.getElementById(topId);
  if (!el) return;
  el.hidden = true;
  unlockBodyScroll();
});

/* 软键盘（iOS/安卓）人性化适配。键盘弹起时 visualViewport 缩小：
   1) 更新 --vvh 让弹窗高度收缩；2) 让打开的遮罩只占可视区，不被键盘盖住；
   3) 把当前聚焦的输入框滚入视野。 */
function stActiveMask(){
  var masks = document.querySelectorAll('.mask');
  for (var i=0;i<masks.length;i++){ if(!masks[i].hidden) return masks[i]; }
  return null;
}
function stScrollFocused(){
  var ae = document.activeElement;
  if(ae && (ae.tagName==='INPUT'||ae.tagName==='TEXTAREA'||ae.tagName==='SELECT')){
    setTimeout(function(){
      try { ae.scrollIntoView({block:'center', inline:'nearest'}); }
      catch(e){ try{ae.scrollIntoView(false);}catch(_){} }
    }, 320);
  }
}
if (window.visualViewport) {
  var vv = window.visualViewport;
  var onVVChange = function(){
    document.documentElement.style.setProperty('--vvh', vv.height + 'px');
    var m = stActiveMask();
    if(m){ m.style.height = vv.height + 'px'; m.style.top = vv.offsetTop + 'px'; }
    stScrollFocused();
  };
  vv.addEventListener('resize', onVVChange);
  vv.addEventListener('scroll', onVVChange);
}
/* 弹窗内输入框聚焦：等键盘动画结束后自动滚到可视区中部，避免被键盘遮挡 */
document.addEventListener('focusin', function(e){
  var t = e.target;
  if(t && (t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.tagName==='SELECT') && t.closest && t.closest('.mask')){
    setTimeout(function(){
      try { t.scrollIntoView({block:'center', inline:'nearest'}); }
      catch(e){ try{t.scrollIntoView(false);}catch(_){} }
    }, 360);
  }
});

function buildReminderBody() {
  const today = todayStr();
  const projects = Object.values(store.projects);
  
  // 按优先级分组收集
  const overdueItems = [];    // 逾期
  const dueItems = [];        // 今日待复习/待解决
  const planItems = [];       // 今日计划（刷题/背书新学）
  const doneItems = [];       // 今日已达标
  const lazyProjects = [];    // 摆烂提醒
  
  let totalOverdue = 0;
  let hasAnyTask = false;
  
  projects.forEach(p => {
    const m = getMetrics(p);
    const unit = isSetMode(p) ? '套' : (p.type === 'mistake' ? '道' : '页');
    
    // 摆烂检测
    const lazy = getLazyInfo(p);
    if (lazy.days >= 3 && (p.items || []).length > 0 && m && m.remaining > 0) {
      lazyProjects.push({ name: p.name, days: lazy.days });
    }
    
    if (p.type === 'exercise') {
      // 刷题任务
      let need = 0;
      if (m) {
        if (m.feasibility === 'impossible') {
          planItems.push({ name: p.name, text: `截止日紧张，建议调整计划`, urgent: true });
          hasAnyTask = true;
        } else {
          need = getDailyTarget(p, m).per;  // 与主页大字同一口径
        }
      }
      if (need > 0 && m) {
        hasAnyTask = true;
        const done = m.todayDone || 0;
        const needRounded = Math.round(need * 10) / 10;
        if (done >= need) {
          doneItems.push({ name: p.name, type: 'exercise', text: `今日目标${needRounded}${unit}，已完成${done}${unit} ✅` });
        } else {
          planItems.push({ name: p.name, type: 'exercise', text: `今日约${needRounded}${unit}${done > 0 ? `（已完成${done}${unit}）` : ''}`, urgent: false });
        }
      }
    } else {
      // 背书/错题
      const isMistake = p.type === 'mistake';
      const unitLabel = isMistake ? '道' : '条';
      const du = getDueItems(p).length;
      const ov = getOverdueItems(p).length;
      totalOverdue += ov;
      
      if (ov > 0) {
        overdueItems.push({ name: p.name, type: isMistake ? 'mistake' : 'recite', text: `${ov}${unitLabel}逾期${isMistake ? '错题' : '待复习'}` });
        hasAnyTask = true;
      }
      if (du > 0) {
        dueItems.push({ name: p.name, type: isMistake ? 'mistake' : 'recite', text: `${du}${unitLabel}今日${isMistake ? '待解决' : '待复习'}` });
        hasAnyTask = true;
      }
      
      // 错题本：无到期时显示进度
      if (isMistake && du === 0 && ov === 0 && m && m.remaining > 0) {
        doneItems.push({ name: p.name, type: 'mistake', text: `暂无到期错题（已攻克 ${m.currentPage}/${m.total} 道）` });
      }
      
      // 背书：新学计划
      if (!isMistake && m && m.remaining > 0 && m.feasibility !== 'impossible') {
        const need = getDailyTarget(p, m).per;  // 与主页背书大字同一口径
        if (need > 0) {
          hasAnyTask = true;
          const done = m.todayDone || 0;
          const needRounded = Math.round(need * 10) / 10;
          if (done >= need) {
            doneItems.push({ name: p.name, type: 'recite', text: `今日新学目标${needRounded}页，已完成${done}页 ✅` });
          } else {
            planItems.push({ name: p.name, type: 'recite', text: `今日新学约${needRounded}页${done > 0 ? `（已完成${done}页）` : ''}`, urgent: false });
          }
        }
      }
    }
  });
  
  // 构建提醒内容
  const parts = [];
  
  if (overdueItems.length) {
    parts.push('⚠️ 逾期（先清掉）');
    overdueItems.forEach(it => { const icon = it.type === 'mistake' ? '📝' : (it.type === 'recite' ? '📖' : '✏️'); parts.push(`• ${icon} ${it.name}：${it.text}`); });
    parts.push('');
  }
  
  if (dueItems.length) {
    parts.push('📝 今日待复习');
    dueItems.forEach(it => { const icon = it.type === 'mistake' ? '📝' : (it.type === 'recite' ? '📖' : '✏️'); parts.push(`• ${icon} ${it.name}：${it.text}`); });
    parts.push('');
  }
  
  if (planItems.length) {
    parts.push('📖 今日计划');
    planItems.forEach(it => { const icon = it.type === 'mistake' ? '📝' : (it.type === 'recite' ? '📖' : '✏️'); parts.push(`• ${icon} ${it.name}：${it.text}`); });
    parts.push('');
  }
  
  if (doneItems.length && !overdueItems.length && !dueItems.length && !planItems.length) {
    // 全部完成
    parts.push('🎉 今天的任务都达标啦！');
    doneItems.forEach(it => { const icon = it.type === 'mistake' ? '📝' : (it.type === 'recite' ? '📖' : '✏️'); parts.push(`• ${icon} ${it.name}：${it.text}`); });
    parts.push('');
    parts.push('💪 保持节奏，明天继续加油！');
  } else if (doneItems.length) {
    parts.push('✅ 已达标');
    doneItems.forEach(it => { const icon = it.type === 'mistake' ? '📝' : (it.type === 'recite' ? '📖' : '✏️'); parts.push(`• ${icon} ${it.name}：${it.text}`); });
    parts.push('');
  }
  
  if (!hasAnyTask && !lazyProjects.length) {
    return '今天没有待办，轻松一下～';
  }
  
  // 连续学习天数（结尾鼓励按状态走 Coach，时段问候已含在 Coach 里）
  let maxStreak = 0;
  projects.forEach(p => { const m = getMetrics(p); if (m && m.streakNow > maxStreak) maxStreak = m.streakNow; });
  
// 结尾鼓励统一走 Coach：按天哈希，同一天稳定、每天换新，不再 Math.random 跳老套句子
  let cheer = '';
  if (overdueItems.length) cheer = Coach.pick(Coach.back, 'rmback');
  else if (dueItems.length) cheer = Coach.pick(Coach.progress.mid, 'rmdue');
  else if (planItems.length && doneItems.length) cheer = Coach.pick(Coach.dashPartial, 'rmpartial');
  else if (planItems.length) cheer = Coach.pick(Coach.start[coachSlot()], 'rmstart');
  else if (doneItems.length) cheer = Coach.pick(Coach.done, 'rmdone');
  // 连续学习是真实成就，连续较久才带一句（不机械叠加时段问候，Coach 已含时段）
  let streakMsg = '';
  if (maxStreak >= 7) streakMsg = `（已经连续 ${maxStreak} 天，势头很猛）`;
  if (cheer) {
    if (parts.length && parts[parts.length - 1] !== '') parts.push('');
    parts.push(cheer + streakMsg);
  }

  // 摆烂提醒
  if (lazyProjects.length) {
    const names = lazyProjects.map(l => `${l.name}（${l.days}天）`).join('、');
    parts.push('');
    parts.push(`😴 ${names} 好几天没动了，先花几分钟找回状态吧～`);
  }

  return parts.join('\n').trim();
}

/* ---- 应用内提醒（移动端 Notification API 不可用时的兜底，桌面端也同时显示）---- */
function ensureInAppReminderEl() {
  let el = $('#inAppReminder');
  if (!el) {
    el = document.createElement('div');
    el.id = 'inAppReminder';
    el.className = 'inapp-reminder';
    el.innerHTML = '<span class="iar-close">×</span><div class="iar-icon">🔔</div><div class="iar-content"><div class="iar-title"></div><div class="iar-body"></div></div>';
    document.body.appendChild(el);
    const closeIt = () => el.classList.remove('show');
    el.querySelector('.iar-close').addEventListener('click', closeIt);
    el.querySelector('.iar-close').addEventListener('touchstart', e => { e.preventDefault(); closeIt(); }, { passive: false });
  }
  return el;
}
let _iarTimer = null;
function showInAppReminder(title, body) {
  const el = ensureInAppReminderEl();
  el.querySelector('.iar-title').textContent = title;
  el.querySelector('.iar-body').textContent = body;
  el.classList.add('show');
  if (_iarTimer) clearTimeout(_iarTimer);
  // 提醒不自动关闭，需用户手动点×关闭
  try { playReminderBeep(); } catch (e) {}
}
/* 简单提示音（Web Audio API，无需音频文件） */
function playReminderBeep() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try {
    const ctx = new AC();
    // iOS Safari / 微信 X5：AudioContext 创建后默认 suspended，不 resume 就无声
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880; osc.type = 'sine';
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.4);
    // 第二声
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.connect(gain2); gain2.connect(ctx.destination);
    osc2.frequency.value = 1100; osc2.type = 'sine';
    gain2.gain.setValueAtTime(0, ctx.currentTime + 0.25);
    gain2.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 0.27);
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.65);
    osc2.start(ctx.currentTime + 0.25); osc2.stop(ctx.currentTime + 0.65);
    setTimeout(() => { try { ctx.close(); } catch (e) {} }, 800);
  } catch (e) {}
}
/* 统一提醒触发：优先系统通知，同时显示应用内提醒（双保险） */
function fireReminder(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification(title, { body }); } catch (e) {}
  }
  showInAppReminder(title, body);
}
/* 检查并触发到点的提醒（供轮询和页面打开补发共用） */
function checkAndFireReminders() {
  if (_booting) return false; // 数据还在恢复中，避免读到空 store 弹出错误提醒
  const r = getReminder();
  if (!r || !r.enabled) return false;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const mark = getFiredMark();
  let fired = false;
  r.times.forEach(t => {
    const [h, m] = t.split(':').map(Number);
    const planMin = h * 60 + m;
    // 只要当前时间已过计划时间、且今天这个时间点还没发过，就补发
    if (nowMin >= planMin && !mark.times.includes(t)) {
      mark.times.push(t);
      fired = true;
    }
  });
  if (!fired) return false;
  setLocalVal(REMIND_FIRED_KEY, JSON.stringify(mark));
  fireReminder('Study Tracker 学习提醒', buildReminderBody());
  return true;
}
// 每 30 秒轮询（页面打开状态下）
setInterval(checkAndFireReminders, 30000);
// 注意：首次调用已移到 boot() 内 loadStore 之后，避免时序竞争

function rangeText(a, b) { return a === b ? `${a}` : `${a}-${b}`; }
// 获取"需要学习的页码范围"：启用单元模式时是所有单元范围的并集（自动排除习题等），未启用时是整本书正文范围
function getTargetPageRanges(p) {
  if (p.unitMode && Array.isArray(p.units) && p.units.length) {
    // 兼容老数据：无 unitScopeMode 时，若有旧 unitScopeOnly=false 则为 book，否则默认 all（原有行为）
    const mode = p.unitScopeMode || (p.unitScopeOnly === false ? 'book' : 'all');
    if (mode === 'leaf' || mode === 'all') {
      const all = [];
      function collect(u) {
        const hasChildren = u.children && u.children.length;
        if (mode === 'all' || !hasChildren) {
          if (u.startPage != null && u.endPage != null && u.endPage >= u.startPage) {
            all.push({ start: u.startPage, end: u.endPage });
          }
        }
        (u.children || []).forEach(collect);
      }
      p.units.forEach(collect);
      if (all.length) return mergeRanges(all);
    }
  }
  // 轻量"只做部分页"：目标=用户列出的区间（自动合并重叠/去重）
  if (p.scopeMode && Array.isArray(p.targetRanges) && p.targetRanges.length) {
    return mergeRanges(p.targetRanges.map(r => ({ start: r.start, end: r.end })));
  }
  const lo = p.bookStartPage != null ? p.bookStartPage : 1;
  const hi = p.bookEndPage != null ? p.bookEndPage : (p.total || 0);
  if (hi >= lo) return [{ start: lo, end: hi }];
  return [];
}
function getBookDoneRanges(p) {
  let raw;
  if (p.type === 'exercise') raw = (p.records || []).map(r => getRecordRange(r, p));
  else raw = (p.items || []).map(it => ({ start: getItemPageStart(it), end: getItemPageEnd(it) }));
  const targets = getTargetPageRanges(p);
  if (!targets.length) return [];
  const clipped = [];
  mergeRanges(raw).forEach(r => {
    targets.forEach(t => {
      const s = Math.max(t.start, r.start), e = Math.min(t.end, r.end);
      if (e >= s) clipped.push({ start: s, end: e });
    });
  });
  return mergeRanges(clipped);
}
function complementRanges(done, total, start) {
  const gaps = [];
  let cur = start != null ? start : 1;
  done.forEach(r => {
    if (r.start > cur) gaps.push({ start: cur, end: r.start - 1 });
    cur = Math.max(cur, r.end + 1);
  });
  if (cur <= total) gaps.push({ start: cur, end: total });
  return gaps;
}
function countRanges(rs) { return rs.reduce((s, r) => s + (r.end - r.start + 1), 0); }

let ppExpandedSet = {}; // 按 projectId 存储展开的套卷索引，避免切换项目时状态串扰
function renderProgressBoard(p) {
  const m = getMetrics(p);
  const u = unitName(p);
  const pct = m.total > 0 ? Math.min(100, m.currentPage / m.total * 100) : 0;
  $('#ppTitle').textContent = p.type === 'mistake' ? '📊 攻克进度' : (isSetMode(p) ? '📊 套卷完成情况' : '📊 习题册完成情况');

  const doneN = m.currentPage, totalN = m.total;
  $('#ppSummary').innerHTML = `
    <div class="pp-kpi"><div class="n">${fmtUnitNum(doneN)}</div><div class="l">已完成（${u}）</div></div>
    <div class="pp-kpi"><div class="n">${fmtUnitNum(m.remaining)}</div><div class="l">剩余（${u}）</div></div>
    <div class="pp-kpi"><div class="n">${pct.toFixed(1)}%</div><div class="l">总进度</div></div>`;

  const body = $('#ppBody');
  const detail = isSetMode(p) ? renderSetGrid(p) : renderBookBreakdown(p);
  body.innerHTML = renderProgressInsights(p, m) + detail;
}

/* 完成情况看板独有洞察：节奏/坚持、预测、漏做定位 */
function renderProgressInsights(p, m) {
  const u = unitName(p);
  const setMode = isSetMode(p);
  const enough = m.enoughData;
  const num = v => (Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toFixed(1));

  // —— 节奏与坚持卡 ——
  const trendCell = (() => {
    if (m.trendPct == null) return `<div class="pp-stat"><div class="v">—</div><div class="k">近7天节奏<br>数据积累中</div></div>`;
    const pctV = Math.round(m.trendPct * 100);
    if (Math.abs(pctV) < 10) return `<div class="pp-stat"><div class="v">→ 平稳</div><div class="k">近7天 vs 之前</div></div>`;
    if (pctV > 0) return `<div class="pp-stat"><div class="v up">↑ ${pctV}%</div><div class="k">近7天提速</div></div>`;
    return `<div class="pp-stat"><div class="v down">↓ ${-pctV}%</div><div class="k">近7天放缓</div></div>`;
  })();
  const breakCell = m.longestBreak >= 3
    ? `<div class="pp-stat"><div class="v warn">${m.longestBreak} 天</div><div class="k">最长停摆<br>注意别断太久</div></div>`
    : `<div class="pp-stat"><div class="v">${m.longestBreak} 天</div><div class="k">最长停摆</div></div>`;

  // 模式特有统计
  let modeCells = '';
  let gapWarn = '';
  if (setMode) {
    const state = getSetState(p);
    let cDone = 0, cPart = 0, cNone = 0;
    for (let n = 1; n <= p.total; n++) {
      const frac = state[n] ? getSetFraction(p, n, state) : 0;
      if (frac >= 0.999) cDone++; else if (frac > 0.0001) cPart++; else cNone++;
    }
    modeCells = `
      <div class="pp-stat"><div class="v up">${cDone}</div><div class="k">已完成套数</div></div>
      <div class="pp-stat"><div class="v warn">${cPart}</div><div class="k">部分完成</div></div>
      <div class="pp-stat"><div class="v">${cNone}</div><div class="k">未开始</div></div>`;
  } else {
    const doneRanges = getBookDoneRanges(p);
    const targets = getTargetPageRanges(p);
    // 对每个目标范围（单元范围或整本书范围）分别计算未完成，自动排除习题等不在范围内的页
    let undone = [];
    targets.forEach(t => {
      undone = undone.concat(complementRanges(doneRanges, t.end, t.start));
    });
    undone = mergeRanges(undone);
    // “夹在中间”的漏做段：在某个目标范围内，前后都还有内容
    const holes = undone.filter(r => {
      return targets.some(t => r.start > t.start && r.end < t.end);
    });
    const holePages = holes.reduce((s, r) => s + (r.end - r.start + 1), 0);
    modeCells = `<div class="pp-stat"><div class="v ${holes.length ? 'warn' : ''}">${holes.length}</div><div class="k">中间漏做段数</div></div>
      <div class="pp-stat"><div class="v ${holePages ? 'warn' : ''}">${holePages}</div><div class="k">漏做页数（${u}）</div></div>`;
    if (holes.length) {
      const preview = holes.slice(0, 6).map(r => rangeText(r.start, r.end)).join('、') + (holes.length > 6 ? ' 等' : '');
      gapWarn = `<div class="pp-gap-warn">⚠️ 已学范围内有 <b>${holes.length}</b> 段、共 <b>${holePages}</b> 页夹在中间还没做：${preview}。这些通常是当时跳过的难点，建议优先回看。</div>`;
    }
  }

  const _act = getActivityStreak(p, m.t);
  const _actLong = Math.max(_act.streak, _act.priorLongest || 0);
  const statGrid = `<div class="pp-insight-title">📈 学习节奏与坚持（近 ${m.windowDays} 天）</div>
    <div class="pp-stat-grid">
      <div class="pp-stat"><div class="v">${m.activeDays}</div><div class="k">学习日数</div></div>
      <div class="pp-stat"><div class="v">${enough ? num(m.perStudyDayRaw) : '—'}</div><div class="k">每次平均（${u}）</div></div>
      <div class="pp-stat"><div class="v">${enough ? num(m.activityPerWeek) : '—'}</div><div class="k">每周学习天数</div></div>
      <div class="pp-stat"><div class="v">${_act.streak} <span style="font-size:11px;color:var(--muted);font-weight:400">/ 最长${_actLong}</span></div><div class="k">当前连续（天）</div></div>
      ${breakCell}
      ${trendCell}
      ${modeCells}
    </div>
    ${gapWarn}`;

  // —— 完成预测盒 ——
  let etaLines = '';
  if (m.remaining <= 0) {
    etaLines = `🎉 已全部完成，共 ${fmtUnitNum(m.total)} ${u}。可以把目标总量或截止日调整到下一阶段。`;
  } else if (p.type === 'mistake') {
    // 错题本专属：滚动复习、攻克非线性，不做线性 ETA / 可行性判定（小样本"按攻克速度还需X周"会制造无谓焦虑）。
    // 只呈现：攻克进度 + 今日量 + 高频薄弱点，让用户"无脑清今天到期的"即可。
    const _due = getDueItems(p).length, _over = getOverdueItems(p).length;
    const _weak = (p.items || []).filter(it => !it.mastered && !it.manualMastered && (it.wrongStreak || 0) >= 2).length;
    let _dl = '';
    if (p.deadline) {
      const _dl2 = diffDays(m.t, p.deadline);
      if (_dl2 < 0) _dl = `<br>目标日已过 ${-_dl2} 天，错题仍会继续滚动复习，可在设置里调整目标日。`;
      else if (_dl2 <= 14) _dl = `<br>距目标日 ${fmtCN(p.deadline)} 还有 ${_dl2} 天，优先把每天到期的做熟，目标日前多过一轮最划算。`;
    }
    etaLines = `错题本按“收录 → 间隔复习 → 攻克”自动运转，<b>你不需要每天订目标</b>，只要清掉“今日复习”列表里的内容就好。<br>当前已攻克 <b>${fmtUnitNum(m.currentPage)}</b> / 共收录 <b>${fmtUnitNum(m.total)}</b> 道，待攻克 <b>${fmtUnitNum(m.remaining)}</b> 道${_due > 0 ? `，今天到期 <b>${_due}</b> 道${_over > 0 ? `（含逾期 ${_over} 道，会自动分批，不用一次做完）` : ''}` : ''}。${_weak > 0 ? `<br>其中 <b>${_weak}</b> 道反复错过，是你考前最该拿下的高频薄弱点。` : ''}<br>每攻克一道，都是实打实补上一个提分点。${_dl}`;
  } else if (p.type === 'recite' && m.sprint) {
    // 背书本冲刺期：不再给线性"完成区间"，呈现冲刺策略，避免用学新目标制造焦虑
    const _due = getDueItems(p).length;
    etaLines = `⏰ <b>已进入冲刺期</b>：距目标日 ${fmtCN(p.deadline)} 还有 ${m.daysLeft} 天，不足一个完整复习周期（约 ${m.cycleDays} 天）。<br>这段时间的重点不是把新书背完，而是<b>把已学内容牢牢记住</b>：先清每天到期的复习${_due > 0 ? `（今天 <b>${_due}</b> 条）` : ''}，再有余力挑最核心的内容学新。<br>系统会把复习都安排在目标日之前，模糊、忘记的内容会更频繁地出现，你只需按清单做即可。`;
  } else if (!enough) {
    const isMistake = p.type === 'mistake';
    let planNum = null, planNote = '';
    if (!isMistake) {
      // 背书：数据不足时显示粗略新学目标
      if (m.perStudyDay != null) {
        planNum = num(m.perStudyDay);
      } else if (isFinite(m.needPerDay) && m.needPerDay > 0) {
        planNum = num(m.needPerDay);
        planNote = '（粗估：把剩余量均摊到剩余自然日；再攒几个学习日就开始按你的真实节奏修正）';
      }
    }
    // 错题本：不预估"每天攻克多少"，只看今天到期的复习条目
    if (planNum != null) {
      etaLines = `完成时间范围还在估算中：再攒约 <b>${m.daysToMedium}</b> 个学习日就开始给出估算，累计满 7 个学习日（约 2 周）后会给出更可靠的“乐观～保守”完成区间。<br>当前先按每个学习日 <b>${planNum}</b> ${u} 的节奏推进即可${planNote}。`;
    } else if (isMistake) {
      etaLines = `错题本按“收录 → 间隔复习 → 攻克”运转，不需要每天订目标。遇到错题随时收录，到复习日会自动提醒你重做。<br>当前已攻克 <b>${m.currentPage}</b> / 共收录 <b>${m.total}</b> 道，待攻克 <b>${m.remaining}</b> 道。`;
    } else {
      etaLines = `完成时间范围还在估算中：再攒约 <b>${m.daysToMedium}</b> 个学习日就开始给出估算，累计满 7 个学习日（约 2 周）后范围更可靠。<br>当前未设截止日，可先按自己的节奏推进，或在设置里添加截止日获取每学习日目标。`;
    }
    if (m.sparseLogging) {
      etaLines += `<br><span style="color:#96600c">⚠️ 你最近打卡间隔较长（中位数约 ${m.medianGap} 天），产能估计可能有偏差，建议每天记录一次。</span>`;
    }
  } else {
    etaLines = `按你最近每周约 <b>${num(m.activityPerWeek)}</b> 个学习日、每次约 <b>${num(m.perStudyDayRaw)}</b> ${u} 的节奏：<br>预计在 <b>${fmtCN(m.etaEarlyDate)} ～ ${fmtCN(m.etaLateDate)}</b> 之间完成，基准约 <b>${fmtCN(m.etaDate)}</b>。`;
    if (m.feasibility === 'easy') etaLines += `<br><span style="color:var(--ok)">✅ 按当前节奏即可按时完成，保持就好。</span>`;
    else if (m.feasibility === 'stretch') {
      const sf = stretchFull(m);
      // 延期兜底用长期可持续口径，且日期必须晚于当前截止日才有意义
      let delayDate = null;
      if (m.feasibleDaysLong) {
        const d = addDays(m.t, Math.ceil(m.feasibleDaysLong));
        if (p.deadline && d > p.deadline) delayDate = d;
      }
      let body;
      if (sf) body = sf + (delayDate ? `，想更从容也可以把截止日延后到约 ${fmtCN(delayDate)}` : '');
      else body = delayDate
        ? `按你最近的节奏基本能按时完成，想留更多余量的话，可把截止日延后到约 ${fmtCN(delayDate)}`
        : `按你最近的节奏基本能按时完成，偶尔状态起伏也正常，正常推进就好`;
      etaLines += `<br><span style="color:#96600c">⚠️ ${body}。</span>`;
    }
    else if (m.feasibility === 'impossible') {
      const dLong = m.feasibleDaysLong ? addDays(m.t, Math.ceil(m.feasibleDaysLong)) : null;
      etaLines += `<br><span style="color:var(--bad)">🚧 按现在节奏缺口较大，建议增加每周学习天数${dLong ? `，或把截止日延后到约 ${fmtCN(dLong)}` : ''}。</span>`;
    }
    // 相对理想进度（与 getMetrics 同口径：填了 startDate 用它，否则用最早打卡日）
    if (m.effStart && p.deadline && m.total > 0) {
      const span = diffDays(m.effStart, p.deadline);
      const elapsed = diffDays(m.effStart, m.t);
      if (span > 0) {
        const ideal = m.total * Math.max(0, Math.min(1, elapsed / span));
        const g = Math.round(m.currentPage - ideal);
        if (Math.abs(g) >= 1) etaLines += g > 0
          ? `<br>📈 相对“${m.effStart}→${p.deadline} 匀速”的理想进度，<b style="color:var(--ok)">超前约 ${g} ${u}</b>。`
          : `<br>📉 相对理想进度，<b style="color:var(--bad)">慢了约 ${-g} ${u}</b>（这部分已经算进每天目标里，不用额外补）。`;
        else etaLines += `<br>➖ 与理想进度基本同步。`;
      }
    }
  }
  const etaBox = `<div class="pp-insight-title">🔮 完成预测</div><div class="pp-eta-box">${etaLines}</div>`;

  return `<div class="pp-insight">${statGrid}${etaBox}</div>`;
}

function renderSetGrid(p) {
  const secs = getNormalizedSections(p);
  const rawSecs = getPaperSections(p);
  const state = getSetState(p);
  let cells = '';
  let cDone = 0, cPart = 0, cNone = 0;
  for (let n = 1; n <= p.total; n++) {
    const st = state[n];
    const frac = st ? getSetFraction(p, n, state) : 0;
    const pctN = Math.round(frac * 100);
    let cls = 'pp-cell';
    if (frac >= 0.999) { cls += ' done'; cDone++; }
    else if (frac > 0.0001) { cls += ' part'; cPart++; }
    else cNone++;
    const sub = frac >= 0.999 ? '已完成' : (frac > 0.0001 ? `${pctN}%` : '未开始');
    cells += `<div class="${cls}" data-set="${n}">
      <div class="c-no">${esc(paperLabel(p, n))}</div><div class="c-pct">${sub}</div></div>`;
    if (ppExpandedSet[p.id] === n) {
      let detail = '';
      if (secs.length) {
        detail = secs.map(s => {
          const v = st ? (st.secs[s.id] || 0) : 0;
          return `<div class="pp-sec-row">
            <span class="pp-sec-name">${esc(s.name)}<span class="muted" style="font-size:11px"> ·${s.weight}%</span></span>
            <span class="pp-sec-track"><span class="pp-sec-fill" style="width:${v}%"></span></span>
            <span class="pp-sec-val">${Math.round(v)}%</span></div>`;
        }).join('');
      } else {
        const v = st ? Math.round(st.legacy * 100) : 0;
        detail = `<div class="pp-sec-row"><span class="pp-sec-name">完成度</span>
          <span class="pp-sec-track"><span class="pp-sec-fill" style="width:${v}%"></span></span>
          <span class="pp-sec-val">${v}%</span></div>`;
      }
      cells += `<div class="pp-cell-detail open" data-detail="${n}">
        <div style="font-size:12.5px;color:var(--muted);margin-bottom:9px">${esc(paperLabel(p, n))} 各板块完成度${rawSecs.length ? '' : '（未划分板块，按整套/题数记录）'}</div>
        ${detail}</div>`;
    }
  }
  const legend = `<div class="pp-legend">
    <span><i style="background:#fff;border:1.5px solid var(--line)"></i>未开始 ${cNone}</span>
    <span><i style="background:#fdf6e7;border:1.5px solid #f0d29a"></i>部分完成 ${cPart}</span>
    <span><i style="background:#e8f7f0;border:1.5px solid #9fdcc2"></i>已完成 ${cDone}</span>
    <span style="margin-left:auto">点击任意套查看板块明细</span></div>`;
  return `<div class="pp-grid">${cells}</div>${legend}`;
}

function renderBookBreakdown(p) {
  const done = getBookDoneRanges(p);
  const targets = getTargetPageRanges(p);
  // 对每个目标范围分别计算未完成，自动排除习题等不在范围内的页
  let undone = [];
  targets.forEach(t => {
    undone = undone.concat(complementRanges(done, t.end, t.start));
  });
  undone = mergeRanges(undone);
  const useUnit = p.unitMode && (p.units || []).length;

  if (useUnit) {
    // 递归收集单元的所有页码范围（含子单元）
    function collectPages(unit) {
      let pages = [];
      if (unit.startPage != null && unit.endPage != null) pages.push([unit.startPage, unit.endPage]);
      (unit.children || []).forEach(c => pages = pages.concat(collectPages(c)));
      return pages;
    }
    function renderBookUnit(u, level) {
      const allPages = collectPages(u);
      const us = allPages.length ? Math.min(...allPages.map(p => p[0])) : (u.startPage || 0);
      const ue = allPages.length ? Math.max(...allPages.map(p => p[1])) : (u.endPage || 0);
      const len = Math.max(1, ue - us + 1);
      let d = 0;
      done.forEach(r => {
        const s = Math.max(r.start, us), e = Math.min(r.end, ue);
        if (e >= s) d += e - s + 1;
      });
      d = Math.max(0, Math.min(len, d));
      const pctU = len > 0 ? d / len * 100 : 0;
      const indent = level * 16;
      const hasChildren = u.children && u.children.length > 0;
      const childInfo = hasChildren ? ` · ${u.children.length}个子单元` : '';
      let html = `<div class="pp-unit-row" style="padding-left:${indent}px">
        <div class="pp-unit-head">
          <span>${level > 0 ? '└ ' : ''}📁 ${esc(u.name || '未命名单元')} <span class="muted" style="font-size:12px">P${us}-P${ue}</span></span>
          <span class="muted">${d}/${len} 页 · ${pctU.toFixed(0)}%${childInfo}</span>
        </div>
        <div class="pp-unit-track"><div class="pp-unit-fill" style="width:${pctU}%"></div></div>
      </div>`;
      if (hasChildren) u.children.forEach(c => html += renderBookUnit(c, level + 1));
      return html;
    }
    const units = [...p.units].sort((a, b) => (a.startPage || 0) - (b.startPage || 0));
    const unitsHtml = units.map(u => renderBookUnit(u, 0)).join('');
    return `<div>${unitsHtml}</div>
      <div class="pp-ranges" style="margin-top:6px">
        ${rangeChipsBlock('✅ 已完成页码区间', done, 'ok')}
        ${rangeChipsBlock('⬜ 未完成页码区间', undone, 'no')}
      </div>`;
  }

  return `<div class="pp-ranges">
    ${rangeChipsBlock('✅ 已完成', done, 'ok')}
    ${rangeChipsBlock('⬜ 未完成', undone, 'no')}
  </div>`;
}
function rangeChipsBlock(title, ranges, cls) {
  const chips = ranges.length
    ? ranges.map(r => `<span class="pp-chip ${cls}">${rangeText(r.start, r.end)}</span>`).join('')
    : '<span class="muted" style="font-size:12.5px">无</span>';
  return `<div class="pp-range-block">
    <div class="pp-range-t">${title} <span class="muted" style="font-weight:400">（共 ${countRanges(ranges)} 页）</span></div>
    <div class="pp-chips">${chips}</div></div>`;
}

/* ============ 新建 ============ */
function addPaperSecRow(listEl, name, weight, id) {
  const row = document.createElement('div');
  row.className = 'ps-row';
  if (id) row.dataset.sid = id;
  row.innerHTML = `
    <input type="text" class="ps-name" maxlength="12" placeholder="板块名，如 选择/阅读A" value="${esc(name || '')}">
    <input type="number" class="ps-w" min="0" max="100" placeholder="权重" value="${weight === undefined || weight === '' ? '' : weight}">
    <span class="ps-pct">%</span>
    <button type="button" class="ps-del" title="删除">×</button>`;
  row.querySelector('.ps-del').addEventListener('click', () => { row.remove(); refreshPaperSecSum(listEl); });
  row.querySelectorAll('input').forEach(inp => inp.addEventListener('input', () => refreshPaperSecSum(listEl)));
  listEl.appendChild(row);
  refreshPaperSecSum(listEl);
}
function readPaperSecRows(listEl) {
  const secs = [];
  listEl.querySelectorAll('.ps-row').forEach(row => {
    const name = row.querySelector('.ps-name').value.trim();
    const w = parseFloat(row.querySelector('.ps-w').value);
    if (!name) return;
    secs.push({ id: row.dataset.sid || genId(), name, weight: isNaN(w) ? 0 : w });
  });
  return secs;
}
function refreshPaperSecSum(listEl) {
  const sumEl = listEl.parentElement.querySelector('.ps-sum');
  if (!sumEl) return;
  const named = [...listEl.querySelectorAll('.ps-name')].filter(el => el.value.trim()).length;
  if (!named) { sumEl.textContent = '不划分板块时，按「整套 / 部分题数」记录'; sumEl.classList.remove('bad'); return; }
  const sum = [...listEl.querySelectorAll('.ps-w')].reduce((s, el) => s + (parseFloat(el.value) || 0), 0);
  sumEl.textContent = `权重合计 ${sum}%${Math.abs(sum - 100) < 0.001 ? '' : '（建议 100%，系统会自动按比例归一化）'}`;
  sumEl.classList.toggle('bad', Math.abs(sum - 100) >= 0.001);
}

const PAPER_TEMPLATES = {
  math1: ['考研数学一', [['选择题',50],['填空题',30],['解答题·高数',44],['解答题·线代',11],['解答题·概率',15]]],
  math2: ['考研数学二', [['选择题',50],['填空题',30],['解答题·高数',55],['解答题·线代',15]]],
  eng1: ['考研英语一', [['阅读1',10],['阅读2',10],['阅读3',10],['阅读4',10],['完型',10],['新题型',10],['翻译',10],['大作文',20],['小作文',10]]],
  eng2: ['考研英语二', [['阅读1',10],['阅读2',10],['阅读3',10],['阅读4',10],['完型',10],['新题型',10],['翻译',15],['小作文',10],['大作文',15]]],
  ustc843: ['中科大843·信号与系统', [['信号与系统',120],['数字信号处理',30]]],
  cs408: ['408计算机学科专业基础', [['数据结构·选择',22],['组成原理·选择',22],['操作系统·选择',20],['计算机网络·选择',16],['综合应用题',70]]],
  guanzhong: ['管理类综合能力', [['数学·问题求解',45],['数学·条件充分性判断',30],['逻辑',60],['写作·论证有效性分析',30],['写作·论说文',35]]],
  chem315: ['315化学（农）', [['单项选择题',60],['填空题',35],['计算分析与合成题',55]]],
  plant414: ['414植物生理学与生物化学', [['单项选择题',30],['简答题',48],['实验题',20],['分析论述题',52]]],
  politics: ['考研政治', [['单选题',16],['多选题',34],['分析题',50]]],
  // 新高考Ⅰ卷（语数英，满分150）
  xgk_chinese: ['新高考Ⅰ卷·语文', [['现代文阅读Ⅰ',12.7],['现代文阅读Ⅱ',10.7],['文言文阅读',13.3],['古代诗歌阅读',6],['名句名篇默写',4],['语言文字运用',13.3],['写作',40]]],
  xgk_math: ['新高考Ⅰ卷·数学', [['单项选择题',26.7],['多项选择题',12],['填空题',10],['解答题',51.3]]],
  xgk_english: ['新高考Ⅰ卷·英语', [['听力',20],['阅读理解',33.3],['语言运用',20],['写作',26.7]]],
  // 江苏自命题（政史地，满分100）
  js_politics: ['江苏卷·思想政治', [['单项选择题',45],['非选择题',55]]],
  js_history: ['江苏卷·历史', [['单项选择题',45],['非选择题',55]]],
  js_geography: ['江苏卷·地理', [['单项选择题',46],['非选择题',54]]]
};
function applyPaperTemplate(listEl, tplKey) {
  const t = PAPER_TEMPLATES[tplKey];
  if (!t) return;
  listEl.innerHTML = '';
  t[1].forEach(([n, w]) => addPaperSecRow(listEl, n, w));
  refreshPaperSecSum(listEl);
}
(function initPaperTplSelects() {
  ['fPaperTpl', 'sPaperTpl'].forEach((selId, i) => {
    const sel = document.getElementById(selId);
    if (!sel) return;
    refreshPaperTplSelect(sel);
    sel.addEventListener('change', () => {
      const listId = i === 0 ? 'fPaperSecList' : 'sPaperSecList';
      applyPaperTpl(sel.value, document.getElementById(listId));
      sel.value = '';
    });
  });
})();

function formIsPageScope() {
  const type = (document.querySelector('input[name="ptype"]:checked') || {}).value;
  const unit = (document.querySelector('input[name="punit"]:checked') || {}).value || 'page';
  const mm = (document.querySelector('input[name="pmistakemode"]:checked') || {}).value || 'free';
  return (type === 'exercise' && unit === 'page') || (type === 'mistake' && mm === 'page') || type === 'recite';
}
function syncFormUnit() {
  const type = (document.querySelector('input[name="ptype"]:checked') || {}).value || 'exercise';
  const unit = (document.querySelector('input[name="punit"]:checked') || {}).value || 'page';
  const mistakeMode = (document.querySelector('input[name="pmistakemode"]:checked') || {}).value || 'free';
  const isExercise = type === 'exercise';
  const isMistake = type === 'mistake';
  const isSet = isExercise && unit === 'set';
  const isMistakePage = isMistake && mistakeMode === 'page';
  const isMistakeSet = isMistake && mistakeMode === 'set';
  const isAnySet = isSet || isMistakeSet;
  $('#unitRow').hidden = !isExercise;
  $('#paperCfg').hidden = !isAnySet;
  const fPaperSecEditor = $('#fPaperSecEditor');
  if (fPaperSecEditor) fPaperSecEditor.hidden = !isSet;
  $('#fMistakeModeRow').hidden = !isMistake;
  // 关联刷题本：仅错题本page/set模式显示
  const showLinkRef = isMistake && (isMistakePage || isMistakeSet);
  $('#fLinkRefRow').hidden = !showLinkRef;
  if (showLinkRef) {
    const sel = $('#fLinkRef');
    sel.innerHTML = '<option value="">不关联</option>';
    Object.values(store.projects).forEach(other => {
      if (other.type !== 'exercise') return;
      const modeMatch = (isMistakePage && other.unit === 'page') || (isMistakeSet && other.unit === 'set');
      if (!modeMatch) return;
      const opt = document.createElement('option');
      opt.value = other.id;
      opt.textContent = other.name + '（' + (other.unit === 'set' ? '套卷' : '习题册') + '）';
      sel.appendChild(opt);
    });
  }
  // 单元模式：刷题按页码 + 背书 + 错题本习题册模式
  const showUnitMode = (isExercise && unit === 'page') || type === 'recite' || isMistakePage;
  $('#fUnitRow').hidden = !showUnitMode;
  if (!showUnitMode) { $('#fUnitMode').checked = false; $('#fUnitEditor').hidden = true; }
  // 推荐提示文案
  const recEl = $('#fUnitRecommend');
  if (recEl) {
    if (type === 'recite') recEl.innerHTML = '💡 系统推荐开启：背书内容通常按章节划分，单元模式可以按章节追踪掌握进度，复习更有针对性。';
    else if (isMistakePage) recEl.innerHTML = '💡 系统推荐开启：错题按习题册章节归类，薄弱点看板可按单元看错题数量，针对性消灭薄弱章节。';
    else recEl.innerHTML = '💡 系统推荐开启：习题册通常分章节/单元，单元模式可以清晰看到每个章节的完成进度，方便查漏补缺。';
  }
  const isPageExercise = isExercise && unit === 'page';
  $('#fStartPageWrap').hidden = true;
  // 页码范围：刷题习题册 + 背书 + 错题本习题册模式；套卷模式不显示
  const usePageRange = (type !== 'mistake' && !isSet) || isMistakePage;
  // 总套数：只在刷题套卷模式显示；错题本套卷模式不需要（进度按条目数）
  $('#fTotalRow').hidden = !isSet;
  const showScope = isPageExercise || isMistakePage || type === 'recite';
  $('#fScopeWrap').style.display = showScope ? '' : 'none';
  if (!showScope) { $('#fScopeMode').checked = false; $('#fScopeEditor').hidden = true; }
  const _fU = $('#fUnitMode').checked, _fS = $('#fScopeMode').checked;
  // 单元模式与跳着做互斥：开启一个时禁用另一个，避免用户困惑
  $('#fScopeMode').disabled = _fU;
  $('#fUnitMode').disabled = _fS;
  const _fMutexHint = $('#fScopeMutexHint');
  if (_fMutexHint) _fMutexHint.style.display = (_fU && showScope) ? '' : 'none';
  const _fUSM = (document.querySelector('input[name="fUnitScopeMode"]:checked') || {}).value || 'book';
  const _showFBook = usePageRange && !_fS && (!_fU || _fUSM === 'book');
  $('#fBookRangeRow').style.display = _showFBook ? '' : 'none';
  $('#fBookRangeHint').style.display = _showFBook ? '' : 'none';
  $('#fReviewModeRow').hidden = !(isMistake || type === 'recite');
  // 复习模式说明文案按类型区分（错题 / 背书）
  const fRmLab = document.getElementById('fReviewModeHint');
  if (fRmLab) {
    fRmLab.innerHTML = type === 'recite'
      ? '<b>均匀分布</b>：自动把复习错峰到每天，避免某天突然要背一堆，适合批量录入、或一次背诵跨很多页。<br><b>经典间隔</b>：严格按记忆曲线间隔提醒，适合量少、能跟上节奏的情况。'
      : '<b>均匀分布</b>：自动把复习错峰到每天，避免某天突然爆量，适合经常批量录入错题。<br><b>经典间隔</b>：严格按间隔天数提醒，适合量少、能跟上节奏的情况。';
  }
  $('#fTotalLabel').textContent = '总套数';
  $('#fTotal').placeholder = '例：20（共多少套卷）';
  $('#fStartPageLabel').textContent = isAnySet ? '已完成套数（可选）' : '开始页码（可选）';
  $('#fUnitHint').textContent = isSet
    ? '套卷可整套记录，也可只记录某个板块完成的百分比，进度按你设置的板块权重计算。填「开始日期」可立刻估算速度。'
    : isMistakeSet
      ? '错题按套卷号归类，学习记录按套卷分组查看。填「开始日期」可立刻估算速度。'
      : isExercise
        ? '填上「开始日期 + 开始页码」可以立刻估算速度；不填的话，打卡几次后也能自动估算。'
        : isMistakePage
          ? '错题按页码归类到习题册，开启单元模式后薄弱点看板可按单元看错题分布。再攒 3 个学习日就开始按你的节奏估算，满 7 个学习日（约 2 周）后预测最准。'
          : (isMistake
            ? '错题按「已攻克 / 已收录」统计进度：每记录一道错题算 1 条收录，复习到攻克后算攻克。可在「出处」里自由填写它来自哪套卷、哪本书哪页（选填）。再攒 3 个学习日就开始按你的节奏估算，满 7 个学习日（约 2 周）后预测最准。'
            : '背书按页码范围统计进度：一条内容跨多页算多页，同一页建多条只算一页。再攒 3 个学习日就开始按你的节奏估算，满 7 个学习日（约 2 周）后预测最准。');
  const labelMode = (document.querySelector('input[name="ppaperlabel"]:checked') || {}).value || 'index';
  $('#fPaperYear').hidden = !(isAnySet && labelMode === 'year');
}
function openFormCreate() {
  // 关闭其他可能残留的弹窗
  ['settingsMask','genericConfirmMask','modeSwitchConfirmMask','randomReviewConfirmMask','mistakeGuideMask','reviewModeHelpMask','importConfirmMask','skipConfirmMask','confirmMasterMask','tplManagerMask'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  });
  unlockBodyScroll();
  $('#formTitle').textContent = '新建任务';
  $('#fName').value = '';
  $('#fTotal').value = '';
  const d = new Date(); d.setDate(d.getDate() + 100);
  $('#fDeadline').value = fmtDate(d);
  $('#fStartDate').value = '';
  $('#fStartPage').value = '';
  $('#fPaperYear').value = '';
  $('#fPaperSecList').innerHTML = '';
  refreshPaperSecSum($('#fPaperSecList'));
  // 重置单元模式
  $('#fUnitMode').checked = false;
  $('#fUnitEditor').hidden = true;
  $('#fUnitEditList').innerHTML = '';
  const _fDefRadio = document.querySelector('input[name="fUnitScopeMode"][value="book"]');
  if (_fDefRadio) _fDefRadio.checked = true;
  refreshUnitTplSelect($('#fUnitTpl'));
  // 重置只做部分页（跳着做）
  $('#fScopeMode').checked = false;
  $('#fScopeEditor').hidden = true;
  $('#fScopeList').innerHTML = '';
  document.querySelector('input[name="ptype"][value="exercise"]').checked = true;
  document.querySelector('input[name="punit"][value="page"]').checked = true;
  document.querySelector('input[name="ppaperlabel"][value="index"]').checked = true;
  const fLinkRef = $('#fLinkRef');
  if (fLinkRef) fLinkRef.value = '';
  syncFormUnit();
  $('#formMask').hidden = false;
  modalTop($('#formMask'));
  setTimeout(() => $('#fName').focus(), 50);
}
function closeForm() { const m=$('#formMask'); if(m.hidden) return; m.hidden=true; unlockBodyScroll(); document.querySelectorAll('input[name="ptype"]').forEach(r => { r.disabled = false; }); const fLinkRef = $('#fLinkRef'); if (fLinkRef) fLinkRef.disabled = false; }
document.querySelectorAll('input[name="ptype"]').forEach(r => r.addEventListener('change', syncFormUnit));
document.querySelectorAll('input[name="punit"]').forEach(r => r.addEventListener('change', syncFormUnit));
document.querySelectorAll('input[name="pmistakemode"]').forEach(r => r.addEventListener('change', syncFormUnit));
document.querySelectorAll('input[name="ppaperlabel"]').forEach(r => r.addEventListener('change', syncFormUnit));
$('#btnFPaperAddSec').addEventListener('click', () => addPaperSecRow($('#fPaperSecList'), '', ''));
// 新建表单单元模式
$('#fUnitMode').addEventListener('change', e => {
  const on = e.target.checked;
  $('#fUnitEditor').hidden = !on;
  $('#fScopeMode').disabled = on;
  const _h = $('#fScopeMutexHint');
  if (_h) _h.style.display = on ? '' : 'none';
  if (on) {
    if ($('#fScopeMode').checked) { $('#fScopeMode').checked = false; $('#fScopeEditor').hidden = true; }
    const usm = (document.querySelector('input[name="fUnitScopeMode"]:checked') || {}).value || 'book';
    if (usm !== 'book') { $('#fBookRangeRow').style.display = 'none'; $('#fBookRangeHint').style.display = 'none'; }
    else if (formIsPageScope()) { $('#fBookRangeRow').style.display = ''; $('#fBookRangeHint').style.display = ''; }
  } else if (!$('#fScopeMode').checked && formIsPageScope()) {
    $('#fBookRangeRow').style.display = ''; $('#fBookRangeHint').style.display = '';
  }
});
document.querySelectorAll('input[name="fUnitScopeMode"]').forEach(r => r.addEventListener('change', e => {
  if (!$('#fUnitMode').checked) return;
  if (e.target.value !== 'book') { $('#fBookRangeRow').style.display = 'none'; $('#fBookRangeHint').style.display = 'none'; }
  else if (formIsPageScope()) { $('#fBookRangeRow').style.display = ''; $('#fBookRangeHint').style.display = ''; }
}));
$('#fScopeMode').addEventListener('change', e => {
  const on = e.target.checked;
  $('#fScopeEditor').hidden = !on;
  $('#fUnitMode').disabled = on;
  if (on) {
    if ($('#fUnitMode').checked) { $('#fUnitMode').checked = false; $('#fUnitEditor').hidden = true; }
    $('#fBookRangeRow').style.display = 'none'; $('#fBookRangeHint').style.display = 'none';
    if (!$('#fScopeList').querySelectorAll('.scope-row').length) addScopeRow($('#fScopeList'), '', '');
  } else if (!$('#fUnitMode').checked && formIsPageScope()) {
    $('#fBookRangeRow').style.display = ''; $('#fBookRangeHint').style.display = '';
  }
});
$('#btnAddFScope').addEventListener('click', () => addScopeRow($('#fScopeList'), '', ''));
$('#fUnitTpl').addEventListener('change', e => {
  if (e.target.value) {
    const t = (store.unitTemplates || []).find(x => x.id === e.target.value);
    if (t) {
      renderUnitEditor(t.units, $('#fUnitEditList'));
      showToast('📋', '已加载模板', `「${t.name}」共 ${t.units.length} 个一级单元`, 2000);
    }
    e.target.value = '';
  }
});
$('#btnFAddUnitRow').addEventListener('click', () => addUnitRowToList($('#fUnitEditList'), '', '', ''));
/* ============ 设置 ============ */
let editingProjectId = null;

function openSettings() {
  const p = cur();
  if (!p) return;
  editingProjectId = p.id;
  // 暴力重置：关闭所有可能残留的遮罩层，恢复页面滚动
  ['genericConfirmMask','modeSwitchConfirmMask','randomReviewConfirmMask','mistakeGuideMask','reviewModeHelpMask','importConfirmMask','skipConfirmMask','confirmMasterMask'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  });
  // 暴力重置前可能叠开了多个弹窗，锁计数被多次 +1；这里把残留计数清零，避免只 unlock 一次造成 body 永久 fixed
  while (_bodyLockCount > 0) unlockBodyScroll();
  // 先强制显示设置窗口
  const sm = $('#settingsMask');
  sm.hidden = false;
  sm.style.display = '';
  modalTop(sm);
  $('#settingsDirtyBar').hidden = true;

  try {
  $('#sName').value = p.name;
  $('#sTotal').value = p.total || '';
  $('#sDeadline').value = p.deadline || '';
  $('#sStartDate').value = p.startDate || '';
  $('#sStartPage').value = p.startPage || 0;
  $('#sBookStart').value = p.bookStartPage || '';
  $('#sBookEnd').value = p.bookEndPage || '';

  const isExercise = p.type === 'exercise';
  const isRecite = !isExercise;
  const isMistake = p.type === 'mistake';
  const setMode = isSetMode(p);
  $('#intervalSectionTitle').hidden = !isRecite;
  $('#intervalSection').hidden = !isRecite;
  if (isRecite) $('#sIntervals').value = getIntervals(p).join(', ');

  // 复习模式（错题本 / 背书本都有复习模式；刷题本没有）
  const canReviewMode = isMistake || p.type === 'recite';
  $('#reviewModeSectionTitle').hidden = !canReviewMode;
  $('#reviewModeSection').hidden = !canReviewMode;
  // 整本书正文范围（错题本不需要）
  $('#sBookRangeRow').style.display = isMistake ? 'none' : '';
  $('#sBookRangeHint').style.display = isMistake ? 'none' : '';
  if (canReviewMode) {
    const mode = p.reviewMode || 'classic';
    const radio = document.querySelector('input[name="reviewMode"][value="' + mode + '"]');
    if (radio) radio.checked = true;
    const bs = $('#balancedSettings');
    if (bs) bs.hidden = mode !== 'balanced';
    updateIntervalHint(mode);
    // 容量设置
    const cm = $('#sCapacityMode');
    const cf = $('#sCapacityFixed');
    const cfw = $('#sCapacityFixedWrap');
    if (cm) cm.value = p.dailyCapacity != null ? 'fixed' : 'auto';
    if (cf) cf.value = p.dailyCapacity != null ? p.dailyCapacity : '';
    if (cfw) cfw.hidden = p.dailyCapacity == null;
  }

  // 错题本模式切换入口：仅自由出处模式显示
  const showModeSwitch = isMistake && isMistakeFreeMode(p);
  $('#mistakeModeSwitchTitle').hidden = !showModeSwitch;
  $('#mistakeModeSwitchSection').hidden = !showModeSwitch;

  // 错题本关联刷题本：仅 page/set 模式显示
  const showRef = isMistake && (isMistakePageMode(p) || isMistakeSetMode(p));
  $('#refProjectTitle').hidden = !showRef;
  $('#refProjectSection').hidden = !showRef;
  if (showRef) {
    const sel = $('#sRefProject');
    sel.innerHTML = '<option value="">不关联</option>';
    Object.values(store.projects).forEach(other => {
      if (other.type !== 'exercise' || other.id === p.id) return;
      const modeMatch = (isMistakePageMode(p) && other.unit === 'page') || (isMistakeSetMode(p) && other.unit === 'set');
      if (!modeMatch) return;
      const opt = document.createElement('option');
      opt.value = other.id;
      opt.textContent = other.name + '（' + (other.unit === 'set' ? '套卷' : '习题册') + '）';
      if (p.refProjectId === other.id) opt.selected = true;
      sel.appendChild(opt);
    });
    // 已关联信息
    const infoEl = $('#refProjectInfo');
    if (p.refProjectId && store.projects[p.refProjectId]) {
      infoEl.hidden = false;
      $('#refProjectInfoText').textContent = '✅ 已关联「' + store.projects[p.refProjectId].name + '」，单元结构已对齐';
    } else {
      infoEl.hidden = true;
    }
  }

  // 创建关联错题本按钮：仅刷题本显示
  const createLinkedBtn = $('#btnCreateLinkedMistake');
  if (createLinkedBtn) {
    createLinkedBtn.hidden = !isExercise;
    if (isExercise) {
      const linkedCount = Object.values(store.projects).filter(o => o.type === 'mistake' && o.refProjectId === p.id).length;
      if (linkedCount > 0) {
        createLinkedBtn.textContent = `📝 已被 ${linkedCount} 个错题本关联 · 再创建一个`;
      } else {
        createLinkedBtn.textContent = '📝 创建关联错题本';
      }
    }
  }

  // 分散阈值（背书+错题）
  $('#spreadSectionTitle').hidden = !isRecite;
  $('#spreadSection').hidden = !isRecite;
  if (isRecite) {
    $('#sSpreadThreshold').value = p.spreadThreshold || defaultComfortCap(p);
    $('#sSpreadThreshold').placeholder = '如 ' + defaultComfortCap(p);
    renderComfortAdvice(p);
  }

  // 套卷：总套数；练习册/背书：用起始/结束页；错题本习题册/自由出处总量动态，不显示总套数；错题本套卷显示总套数
  const usePageRange = !setMode && (p.type !== 'mistake' || isMistakePageMode(p));
  const showTotalRow = setMode || isMistakeSetMode(p);
  $('#sTotalLabel').textContent = '总套数';
  $('#sTotalRow').hidden = !showTotalRow;
  if (showTotalRow) $('#sTotal').value = p.total || '';
  const _sUnit = !!p.unitMode, _sScope = !!p.scopeMode;
  // 单元模式与跳着做互斥：开启一个时禁用另一个
  $('#sScopeMode').disabled = _sUnit;
  $('#sUnitMode').disabled = _sScope;
  const _sUSM = p.unitScopeMode || (p.unitScopeOnly === false ? 'book' : 'all'); // 老用户默认 all（原有行为）
  const _showBookRange = usePageRange && !_sScope && (!_sUnit || _sUSM === 'book');
  $('#sBookRangeRow').style.display = _showBookRange ? '' : 'none';
  $('#sBookRangeHint').style.display = _showBookRange ? '' : 'none';
  $('#sStartPageLabel').textContent = setMode ? '已完成套数（可选）' : '开始页码（可选）';
  $('#sStartPageWrap').hidden = !(isExercise && !setMode);

  $('#sUnitMode').checked = !!p.unitMode;
  const _sUSMradio = document.querySelector('input[name="sUnitScopeMode"][value="' + _sUSM + '"]');
  if (_sUSMradio) _sUSMradio.checked = true;
  refreshUnitTplSelect($('#sUnitTpl'));
  renderUnitEditor(p.units || []);
  $('#unitEditor').hidden = !p.unitMode;
  // 单元模式：刷题习题册 + 背书 + 错题本习题册模式
  $('#unitSectionWrap').hidden = setMode || (p.type === 'mistake' && !isMistakePageMode(p));
  // 只做部分页（跳着做）回填
  $('#sScopeWrap').style.display = isPageScopeCapable(p) ? '' : 'none';
  $('#sScopeMode').checked = _sScope;
  const _sMutexHint = $('#sScopeMutexHint');
  if (_sMutexHint) _sMutexHint.style.display = (_sUnit && isPageScopeCapable(p)) ? '' : 'none';
  $('#sScopeEditor').hidden = !_sScope;
  renderScopeEditor(p.targetRanges || [], $('#sScopeList'));

  const isMistakeSet = p.type === 'mistake' && isMistakeSetMode(p);
  $('#paperSectionWrap').hidden = !setMode && !isMistakeSet;
  $('#paperSecEditor').hidden = !setMode;
  if (setMode || isMistakeSet) {
    if (setMode) {
      refreshPaperTplSelect($('#sPaperTpl'));
      const secList = $('#sPaperSecList');
      secList.innerHTML = '';
      (p.paperSections || []).forEach(s => addPaperSecRow(secList, s.name, s.weight, s.id));
      refreshPaperSecSum(secList);
    }
    const lm = p.paperLabelMode || 'index';
    const radio = document.querySelector('input[name="spaperlabel"][value="' + lm + '"]');
    if (radio) radio.checked = true;
    $('#sPaperYear').value = p.paperYearStart || '';
    syncSPaperLabel();
  }

  // 记录初始状态，用于未保存检测
  settingsInitialSnapshot = captureSettingsSnapshot();
  $('#settingsDirtyBar').hidden = true;

  // 实时压力评估
  setTimeout(() => {
    updatePressurePanel();
    updateSpreadPressureHint();
  }, 50);
  } catch (e) {
    console.error('openSettings error:', e);
    showToast('⚠️', '设置加载有异常', e.message + '（窗口仍可使用）', 4000);
  }
}
// 捕获设置表单当前状态（用于未保存检测），带安全保护
function captureSettingsSnapshot() {
  try {
    const p = store.projects[editingProjectId];
    if (!p) return null;
    const unitRows = [...document.querySelectorAll('#unitEditList .unit-edit-row')].map(r => {
      const nameEl = r.querySelector('[data-role="uname"]');
      const startEl = r.querySelector('[data-role="ustart"]');
      const endEl = r.querySelector('[data-role="uend"]');
      return {
        name: nameEl ? nameEl.value : '',
        start: startEl ? startEl.value : '',
        end: endEl ? endEl.value : ''
      };
    });
    return {
      name: $('#sName') ? $('#sName').value : '',
      total: $('#sTotal') ? $('#sTotal').value : '',
      bookStart: $('#sBookStart') ? $('#sBookStart').value : '',
      bookEnd: $('#sBookEnd') ? $('#sBookEnd').value : '',
      deadline: $('#sDeadline') ? $('#sDeadline').value : '',
      startDate: $('#sStartDate') ? $('#sStartDate').value : '',
      startPage: $('#sStartPage') ? $('#sStartPage').value : '',
      intervals: $('#sIntervals') ? $('#sIntervals').value : '',
      unitMode: $('#sUnitMode') ? $('#sUnitMode').checked : false,
      unitScopeMode: (document.querySelector('input[name="sUnitScopeMode"]:checked') || {}).value || 'all',
      units: unitRows,
      reviewMode: (document.querySelector('input[name="reviewMode"]:checked') || {}).value || '',
      capacityMode: $('#sCapacityMode') ? $('#sCapacityMode').value : '',
      capacityFixed: $('#sCapacityFixed') ? $('#sCapacityFixed').value : '',
      spreadThreshold: $('#sSpreadThreshold') ? $('#sSpreadThreshold').value : ''
    };
  } catch (e) {
    return null;
  }
}
let settingsInitialSnapshot = null;
function isSettingsDirty() {
  if (!settingsInitialSnapshot) return false;
  const cur = captureSettingsSnapshot();
  return JSON.stringify(cur) !== JSON.stringify(settingsInitialSnapshot);
}
function markSettingsDirty() {
  if (settingsInitialSnapshot && isSettingsDirty()) {
    $('#settingsDirtyBar').hidden = false;
  }
}
function syncSPaperLabel() {
  const lm = (document.querySelector('input[name="spaperlabel"]:checked') || {}).value || 'index';
  $('#sPaperYear').hidden = lm !== 'year';
}
document.querySelectorAll('input[name="spaperlabel"]').forEach(r => r.addEventListener('change', syncSPaperLabel));
$('#btnSPaperAddSec').addEventListener('click', () => addPaperSecRow($('#sPaperSecList'), '', ''));
function closeSettings() {
  if (isSettingsDirty()) {
    showGenericConfirm(
      '有未保存的修改',
      '设置还没保存。<br><br><b>「不保存离开」</b>：关闭设置，修改全部丢弃<br><b>「取消」</b>：返回设置页面继续编辑',
      '不保存离开',
      () => { doCloseSettings(); },
      () => { showToast('✏️', '继续编辑中', '设置窗口仍开着，改完记得点底部「保存」按钮。', 2500); }
    );
    return;
  }
  doCloseSettings();
}
function doCloseSettings() {
  const mask = $('#settingsMask');
  if (mask.hidden) return;
  mask.hidden = true;
  unlockBodyScroll();
  settingsInitialSnapshot = null;
}

function renderUnitEditor(units, targetList) {
  const wrap = targetList || $('#unitEditList');
  wrap.innerHTML = '';
  // 递归展开嵌套结构为扁平列表（带 level）
  const flat = [];
  function flatten(arr, level) {
    (arr || []).forEach(u => {
      flat.push({ ...u, level });
      if (u.children && u.children.length) flatten(u.children, level + 1);
    });
  }
  flatten(units, 0);
  flat.forEach(u => addUnitRowToList(wrap, u.name || '', u.startPage ?? '', u.endPage ?? '', u.level || 0));
}

function addUnitRow(name, startPage, endPage) {
  addUnitRowToList($('#unitEditList'), name, startPage, endPage, 0);
}
function addUnitRowToList(listEl, name, startPage, endPage, level) {
  level = level || 0;
  const row = document.createElement('div');
  row.className = 'unit-edit-row';
  row.dataset.level = level;
  const indent = level * 24;
  const maxLevel = 2; // 最多3级（0,1,2）
  row.innerHTML = `
    <div class="unit-edit-main" style="padding-left:${indent}px">
      ${level > 0 ? '<span class="unit-tree-line">└</span>' : ''}
      <input type="text" class="unit-name-input" placeholder="单元名称，如：第一章 马克思主义哲学" value="${esc(name)}" data-role="uname">
      <div class="unit-page-group">
        <input type="text" class="unit-page-input" placeholder="起" value="${startPage === '' ? '' : esc(startPage)}" data-role="ustart" inputmode="numeric" title="起始页">
        <span class="unit-page-sep">~</span>
        <input type="text" class="unit-page-input" placeholder="止" value="${endPage === '' ? '' : esc(endPage)}" data-role="uend" inputmode="numeric" title="结束页">
      </div>
      <div class="unit-actions">
        ${level < maxLevel ? '<button type="button" class="unit-action-btn" data-action="add-child" title="在此单元下添加子单元">＋</button>' : ''}
        ${level > 0 ? '<button type="button" class="unit-action-btn" data-action="indent-left" title="提升一级">⇤</button>' : ''}
        ${level < maxLevel ? '<button type="button" class="unit-action-btn" data-action="indent-right" title="降级为上一个单元的子单元">⇥</button>' : ''}
        <button type="button" class="unit-action-btn unit-del-btn" data-action="delete" title="删除此单元（含子单元）">🗑</button>
      </div>
    </div>
  `;
  listEl.appendChild(row);
  // 实时校验：结束页不能小于起始页
  const startInput = row.querySelector('[data-role="ustart"]');
  const endInput = row.querySelector('[data-role="uend"]');
  const validatePage = () => {
    const sp = Number(startInput.value), ep = Number(endInput.value);
    if (startInput.value && endInput.value && !isNaN(sp) && !isNaN(ep) && ep < sp) {
      endInput.style.borderColor = '#b02e24';
      endInput.style.background = 'rgba(201,48,56,0.06)';
      endInput.title = '结束页不能小于起始页，保存时将自动修正';
    } else {
      endInput.style.borderColor = '';
      endInput.style.background = '';
      endInput.title = '结束页';
    }
  };
  startInput.addEventListener('input', validatePage);
  endInput.addEventListener('input', validatePage);
  validatePage();
  return row;
}

/* ============ 轻量"只做部分页（跳着做）"区间编辑器（无名称/层级，复用单元行样式） ============ */
function addScopeRow(listEl, start, end) {
  const row = document.createElement('div');
  row.className = 'unit-edit-row scope-row';
  row.innerHTML = `
    <div class="unit-edit-main" style="padding-left:0">
      <div class="unit-page-group">
        <input type="text" class="unit-page-input" placeholder="起" value="${start === '' ? '' : esc(start)}" data-role="sstart" inputmode="numeric" title="起始页">
        <span class="unit-page-sep">~</span>
        <input type="text" class="unit-page-input" placeholder="止" value="${end === '' ? '' : esc(end)}" data-role="send" inputmode="numeric" title="结束页（不填=单页）">
      </div>
      <div class="unit-actions">
        <button type="button" class="unit-action-btn unit-del-btn" data-scope-del title="删除此区间">🗑</button>
      </div>
    </div>`;
  listEl.appendChild(row);
  const si = row.querySelector('[data-role="sstart"]'), ei = row.querySelector('[data-role="send"]');
  const v = () => {
    const sp = Number(si.value), ep = Number(ei.value);
    if (si.value && ei.value && !isNaN(sp) && !isNaN(ep) && ep < sp) {
      ei.style.borderColor = '#b02e24'; ei.style.background = 'rgba(201,48,56,0.06)'; ei.title = '结束页不能小于起始页';
    } else { ei.style.borderColor = ''; ei.style.background = ''; ei.title = '结束页（不填=单页）'; }
    updateScopeCount(listEl);
  };
  si.addEventListener('input', v); ei.addEventListener('input', v); v();
  return row;
}
function readScopeRows(listEl) {
  const out = [];
  listEl.querySelectorAll('.scope-row').forEach(row => {
    const s = row.querySelector('[data-role="sstart"]').value;
    const e = row.querySelector('[data-role="send"]').value;
    if (s === '' && e === '') return;
    const sn = Number(s);
    if (s === '' || isNaN(sn) || sn < 1) return;
    let end;
    if (e === '') end = sn;
    else { const en = Number(e); if (isNaN(en) || en < sn) return; end = en; }
    out.push({ start: sn, end });
  });
  return mergeRanges(out);
}
function renderScopeEditor(ranges, listEl) {
  listEl.innerHTML = '';
  if (!ranges || !ranges.length) addScopeRow(listEl, '', '');
  else ranges.forEach(r => addScopeRow(listEl, r.start, r.end));
  if (!listEl.dataset.bound) {
    listEl.dataset.bound = '1';
    listEl.addEventListener('click', ev => {
      const b = ev.target.closest('[data-scope-del]');
      if (!b) return;
      b.closest('.scope-row').remove();
      if (!listEl.querySelectorAll('.scope-row').length) addScopeRow(listEl, '', '');
      updateScopeCount(listEl);
    });
  }
  updateScopeCount(listEl);
}
function updateScopeCount(listEl) {
  const n = countRanges(readScopeRows(listEl));
  const box = listEl.parentElement;
  const t = box ? box.querySelector('.scope-count-num') : null;
  if (t) t.textContent = n;
}

/* ============ 单元/套卷模板系统 ============ */
function refreshUnitTplSelect(selectEl) {
  if (!selectEl) return;
  const cur = selectEl.value;
  selectEl.innerHTML = '<option value="">从模板加载（可选）</option>';
  (store.unitTemplates || []).forEach(t => {
    const op = document.createElement('option');
    op.value = t.id; op.textContent = t.name + `（${t.units.length}个单元）`;
    selectEl.appendChild(op);
  });
  selectEl.value = cur;
}
function refreshPaperTplSelect(selectEl) {
  if (!selectEl) return;
  const cur = selectEl.value;
  selectEl.innerHTML = '<option value="">套用试卷模板（可选，一键填充）</option>';
  // 预设模板
  Object.keys(PAPER_TEMPLATES).forEach(k => {
    const op = document.createElement('option');
    op.value = 'preset:' + k; op.textContent = '📌 ' + PAPER_TEMPLATES[k][0];
    selectEl.appendChild(op);
  });
  // 自定义模板
  (store.paperTemplates || []).forEach(t => {
    const op = document.createElement('option');
    op.value = 'custom:' + t.id; op.textContent = '💾 ' + t.name + `（${t.sections.length}个板块）`;
    selectEl.appendChild(op);
  });
  selectEl.value = cur;
}
function applyUnitTpl(tplId, listEl) {
  const t = (store.unitTemplates || []).find(x => x.id === tplId);
  if (!t) return;
  renderUnitEditor(t.units, listEl || $('#unitEditList'));
  showToast('📋', '已加载模板', `「${t.name}」共 ${t.units.length} 个单元`, 2000);
}
function applyPaperTpl(val, listEl) {
  if (val.startsWith('preset:')) {
    applyPaperTemplate(listEl, val.slice(7));
  } else if (val.startsWith('custom:')) {
    const t = (store.paperTemplates || []).find(x => x.id === val.slice(7));
    if (t) {
      listEl.innerHTML = '';
      t.sections.forEach(s => addPaperSecRow(listEl, s.name, s.weight, s.id));
      showToast('📋', '已加载模板', `「${t.name}」共 ${t.sections.length} 个板块`, 2000);
    }
  }
}
function saveUnitTplFromEditor(defaultName) {
  const units = readUnitRows();
  if (!units.length) { showToast('⚠️', '无法保存', '请先添加至少一个单元', 2000); return; }
  const name = prompt('模板名称：', defaultName || '');
  if (!name || !name.trim()) return;
  const existing = (store.unitTemplates || []).find(t => t.name === name.trim());
  if (existing) {
    existing.units = JSON.parse(JSON.stringify(units));
    existing.updatedAt = Date.now();
  } else {
    if (!Array.isArray(store.unitTemplates)) store.unitTemplates = [];
    store.unitTemplates.push({ id: genId(), name: name.trim(), units: JSON.parse(JSON.stringify(units)), createdAt: Date.now(), updatedAt: Date.now() });
  }
  saveStore();
  refreshUnitTplSelect($('#sUnitTpl'));
  refreshUnitTplSelect($('#fUnitTpl'));
  showToast('💾', '模板已保存', `「${name.trim()}」共 ${units.length} 个单元`, 2000);
}
function savePaperTplFromEditor(defaultName) {
  const sections = readPaperSecRows($('#sPaperSecList'));
  if (!sections.length) { showToast('⚠️', '无法保存', '请先添加至少一个板块', 2000); return; }
  const name = prompt('模板名称：', defaultName || '');
  if (!name || !name.trim()) return;
  const existing = (store.paperTemplates || []).find(t => t.name === name.trim());
  if (existing) {
    existing.sections = JSON.parse(JSON.stringify(sections));
    existing.updatedAt = Date.now();
  } else {
    if (!Array.isArray(store.paperTemplates)) store.paperTemplates = [];
    store.paperTemplates.push({ id: genId(), name: name.trim(), sections: JSON.parse(JSON.stringify(sections)), createdAt: Date.now(), updatedAt: Date.now() });
  }
  saveStore();
  refreshPaperTplSelect($('#sPaperTpl'));
  refreshPaperTplSelect($('#fPaperTpl'));
  showToast('💾', '模板已保存', `「${name.trim()}」共 ${sections.length} 个板块`, 2000);
}
function readUnitRows() {
  return readUnitRowsFromList($('#unitEditList'));
}
function readUnitRowsFromList(listEl) {
  // 读取扁平列表（带 level），构建嵌套结构
  const flat = [];
  let fixedCount = 0;
  listEl.querySelectorAll('.unit-edit-row').forEach(r => {
    const name = (r.querySelector('[data-role="uname"]') || {}).value || '';
    const start = (r.querySelector('[data-role="ustart"]') || {}).value;
    const end = (r.querySelector('[data-role="uend"]') || {}).value;
    const level = parseInt(r.dataset.level || '0', 10);
    if (name.trim()) {
      const parsePage = v => {
        if (v === '' || v == null) return null;
        const n = Number(v);
        return isNaN(n) ? null : n;
      };
      let sp = parsePage(start), ep = parsePage(end);
      // 校验：结束页不能小于起始页，自动修正
      if (sp != null && ep != null && ep < sp) { ep = sp; fixedCount++; }
      flat.push({ name: name.trim(), startPage: sp, endPage: ep, level, children: [] });
    }
  });
  if (fixedCount > 0) {
    showToast('⚠️', '页码已自动修正', `${fixedCount}个单元的结束页小于起始页，已自动调整为与起始页相同`, 3000);
  }
  // 单元页码重叠检测：同父级（level 相同）的相邻单元间页码范围重叠时警告
  const overlaps = [];
  for (let i = 0; i < flat.length - 1; i++) {
    const a = flat[i], b = flat[i + 1];
    if (a.level !== b.level) continue;
    if (a.startPage == null || a.endPage == null || b.startPage == null || b.endPage == null) continue;
    if (b.startPage <= a.endPage && a.startPage <= b.endPage) {
      overlaps.push(`${a.name}(~${a.endPage}页)与${b.name}(${b.startPage}~页)`);
    }
  }
  if (overlaps.length) {
    showToast('⚠️', '单元页码有重叠', overlaps.slice(0, 3).join('；'), 3000);
  }
  // 构建嵌套树
  const tree = [];
  const stack = []; // 栈中存 {level, node}
  flat.forEach(item => {
    const node = { name: item.name, startPage: item.startPage, endPage: item.endPage, children: [] };
    while (stack.length && stack[stack.length - 1].level >= item.level) stack.pop();
    if (stack.length) stack[stack.length - 1].node.children.push(node);
    else tree.push(node);
    stack.push({ level: item.level, node });
  });
  return tree;
}
/* 模板管理弹窗 */
let tplManagerType = 'unit';
function openTplManager(type) {
  tplManagerType = type;
  $('#tplManagerTitle').textContent = type === 'unit' ? '单元模板管理' : '套卷模板管理';
  renderTplManagerList();
  $('#tplManagerMask').hidden = false;
  modalTop($('#tplManagerMask'));
}
function renderTplManagerList() {
  const list = $('#tplManagerList');
  const templates = tplManagerType === 'unit' ? (store.unitTemplates || []) : (store.paperTemplates || []);
  if (!templates.length) {
    list.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px 0">还没有保存的模板<br><span style="font-size:12px">在设置页编辑好单元/板块后，点「存为模板」即可保存</span></div>';
    return;
  }
  list.innerHTML = templates.map(t => {
    const count = tplManagerType === 'unit' ? t.units.length : t.sections.length;
    const typeLabel = tplManagerType === 'unit' ? '个单元' : '个板块';
    return `<div class="tpl-item" style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px">
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:13.5px">${esc(t.name)}</div>
        <div style="font-size:12px;color:var(--muted)">${count}${typeLabel}</div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="ghost-btn" style="padding:4px 10px;font-size:12px" onclick="editTpl('${t.id}')">编辑</button>
        <button class="ghost-btn" style="padding:4px 10px;font-size:12px" onclick="renameTpl('${t.id}')">重命名</button>
        <button class="ghost-btn" style="padding:4px 10px;font-size:12px;color:#b02e24" onclick="deleteTpl('${t.id}')">删除</button>
      </div>
    </div>`;
  }).join('');
}
function editTpl(id) {
  const templates = tplManagerType === 'unit' ? store.unitTemplates : store.paperTemplates;
  const t = templates.find(x => x.id === id);
  if (!t) return;
  // 判断当前在设置页还是新建表单
  const inSettings = !$('#settingsMask').hidden;
  const inForm = !$('#formMask').hidden;
  if (tplManagerType === 'unit') {
    if (inSettings) {
      renderUnitEditor(t.units);
      $('#unitEditor').hidden = false;
      $('#sUnitMode').checked = true;
    } else if (inForm) {
      renderUnitEditor(t.units, $('#fUnitEditList'));
      $('#fUnitEditor').hidden = false;
      $('#fUnitMode').checked = true;
    }
  } else {
    const listEl = inSettings ? $('#sPaperSecList') : (inForm ? $('#fPaperSecList') : null);
    if (listEl) {
      listEl.innerHTML = '';
      t.sections.forEach(s => addPaperSecRow(listEl, s.name, s.weight, s.id));
    }
  }
  $('#tplManagerMask').hidden = true;
  unlockBodyScroll();
  showToast('✏️', '已加载模板', `「${t.name}」已加载到编辑器，修改后点「存为模板」并输入相同名称即可更新`, 3000);
}
function renameTpl(id) {
  const templates = tplManagerType === 'unit' ? store.unitTemplates : store.paperTemplates;
  const t = templates.find(x => x.id === id);
  if (!t) return;
  const name = prompt('新名称：', t.name);
  if (!name || !name.trim()) return;
  t.name = name.trim();
  t.updatedAt = Date.now();
  saveStore();
  renderTplManagerList();
  if (tplManagerType === 'unit') { refreshUnitTplSelect($('#sUnitTpl')); refreshUnitTplSelect($('#fUnitTpl')); }
  else { refreshPaperTplSelect($('#sPaperTpl')); refreshPaperTplSelect($('#fPaperTpl')); }
}
function deleteTpl(id) {
  const templates = tplManagerType === 'unit' ? store.unitTemplates : store.paperTemplates;
  const idx = templates.findIndex(x => x.id === id);
  if (idx < 0) return;
  const t = templates[idx];
  if (!confirm(`确定删除模板「${t.name}」吗？此操作不可撤销。`)) return;
  templates.splice(idx, 1);
  saveStore();
  renderTplManagerList();
  if (tplManagerType === 'unit') { refreshUnitTplSelect($('#sUnitTpl')); refreshUnitTplSelect($('#fUnitTpl')); }
  else { refreshPaperTplSelect($('#sPaperTpl')); refreshPaperTplSelect($('#fPaperTpl')); }
}

/* ============ 薄弱点看板 ============ */
let wbCurrentFilter = 'all';

function openWeaknessBoard() {
  const p = cur();
  if (!p || p.type === 'exercise') return;
  renderWeaknessBoard(p);
  $('#weaknessMask').hidden = false;
  modalTop($('#weaknessMask'));
}
function closeWeaknessBoard() { const m=$('#weaknessMask'); if(m.hidden) return; m.hidden=true; unlockBodyScroll(); }

function renderWeaknessBoard(p) {
  const items = p.items || [];
  const weakThreshold = p.weakThreshold || 0.4;
  const isMistake = p.type === 'mistake';
  const today = todayStr();
  const word = isMistake ? '题' : '条';

  // 用词统一：错题用"攻克"，背书用"掌握"
  const masteredWord = isMistake ? '攻克' : '掌握';
  document.querySelectorAll('.wb-filter-btn').forEach(btn => {
    const f = btn.dataset.filter;
    if (f === 'mastered') btn.textContent = '已' + masteredWord;
    if (f === 'unmastered') btn.textContent = '未' + masteredWord;
  });
  $('#btnRandomReview').innerHTML = isMistake ? '🎲 随机抽5道重做' : '🎲 随机抽5道复习';
  const randomHint = document.querySelector('#btnRandomReview + .hint');
  if (randomHint) randomHint.textContent = isMistake
    ? '从已攻克中随机抽查，做错了会自动重新加入复习队列'
    : '从已掌握中随机抽查，做错了会自动重新加入复习队列';

  const isMastered = it => it.mastered || it.manualMastered;
  const scoreOf = it => isMastered(it) ? 1.0 : (getItemScore(it) ?? -1);
  const mastered = items.filter(isMastered).length;
  const due = getDueItems(p).length;
  const weak = items.filter(it => {
    if (isMastered(it)) return false;
    const s = getItemScore(it);
    return s !== null && s < weakThreshold;
  }).length;

  // 副标题：讲清这个看板是干什么的、怎么用
  $('#wbSubtitle').textContent = isMistake
    ? '错题复习作战中心：下方按「今天最该重做 → 已攻克」排序，先清逾期/到期和反复错的题；也可以点「未复习」快速筛查刚录入还没做过的题。错因分布按历史累计统计，即使后来做对也保留，帮你盯住自己的系统性弱点。'
    : '记忆复习看板：下方按「今天最该复习 → 已掌握」排序，先清逾期/到期和最生疏的内容；坚持按间隔复习，记忆才牢。';
  $('#wbTotalLab').textContent = isMistake ? '总题数' : '总条目';
  $('#wbListTitle').textContent = isMistake ? '📋 错题明细（越靠前越该先重做）' : '📋 内容明细（越靠前越该先复习）';
  // 统计卡片标签：错题用"攻克"，背书用"掌握"
  const masteredStatLab = document.querySelector('.wb-stat.s-mastered .lab');
  if (masteredStatLab) masteredStatLab.textContent = isMistake ? '已攻克' : '已掌握';

  $('#wbTotal').textContent = items.length;
  $('#wbMastered').textContent = mastered;
  $('#wbDue').textContent = due;
  $('#wbWeak').textContent = weak;

  // —— 掌握度分布堆叠条 ——
  const distDefs = [
    ['new', '未复习', 'var(--m-new)'],
    ['weak', '薄弱', 'var(--m-weak)'],
    ['fuzzy', '需巩固', 'var(--m-fuzzy)'],
    ['good', isMistake ? '基本攻克' : '基本掌握', 'var(--m-good)'],
    ['solid', isMistake ? '牢固攻克' : '牢固掌握', 'var(--m-solid)'],
    ['mastered', isMistake ? '已攻克' : '已掌握', 'var(--m-mastered)']
  ];
  const distCounts = {};
  items.forEach(it => { const k = getMasteryInfo(it).key; distCounts[k] = (distCounts[k] || 0) + 1; });
  const distSegs = distDefs.map(([k, label, color]) => {
    const n = distCounts[k] || 0;
    return n > 0 ? `<div class="wb-dist-seg" style="flex:${n};background:${color}" title="${label}: ${n}"></div>` : '';
  }).join('');
  $('#wbDist').innerHTML = distSegs || '<div style="color:var(--muted);font-size:12.5px;text-align:center;padding:8px">暂无数据</div>';

  // 单条渲染（错题显示错因+出处，背书显示页码）
  const itemLi = ({ it, score }) => {
    const displayScore = (score == null) ? '未复习' : score.toFixed(2);
    const scoreCls = (score == null) ? 's-yellow' : (score < weakThreshold ? 's-red' : (score < 0.8 ? 's-yellow' : 's-green'));
    const mastery = getMasteryInfo(it, p);
    const overdue = it.nextReviewDate && !isMastered(it) && it.nextReviewDate < today
      ? `<span style="color:#96600c;font-weight:600">逾期${diffDays(it.nextReviewDate, today)}天</span>` : '';
    const loc = fmtItemLocator(p, it);
    const tagHtml = isMistake && (it.errTags || []).length
      ? `<span style="color:#8a6a12">${it.errTags.slice(0, 2).map(esc).join('/')}${it.errTags.length > 2 ? '…' : ''}</span><span>·</span>` : '';
    const locHtml = loc ? `<span>${esc(loc)}</span><span>·</span>` : '';
    // 提取逻辑：如果是未复习的条目，提供提前复习按钮
    const isUnreviewed = !isMastered(it) && (it.reviews || []).length <= 1 && (!it.nextReviewDate || it.nextReviewDate > today);
    const earlyBtn = isUnreviewed
      ? `<button class="early-review-btn" data-wb-early="${esc(it.id)}" title="加入今日复习" style="padding:4px 8px;font-size:11px;white-space:nowrap">⏩ 提前复习</button>`
      : '';
    return `<li class="wb-item ${mastery.cls}" data-id="${esc(it.id)}">
      <div class="wb-item-main">
        <div class="wb-item-content">${esc(it.content)}</div>
        <div class="wb-item-meta">
          ${tagHtml}${locHtml}
          <span>${fmtCN(it.learnedDate)}</span>
          <span>·</span>
          <span>${(it.reviews || []).length}次复习</span>
          ${overdue ? '<span>·</span>' + overdue : ''}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex:0 0 auto;margin-left:8px">
        ${earlyBtn}
        <span class="wb-score ${scoreCls}">${displayScore}</span>
      </div>
    </li>`;
  };

  // 按当前过滤器筛选
  const filter = wbCurrentFilter || 'all';
  let filtered = items.map(it => ({ it, score: getItemScore(it) }));
  if (filter === 'weak') {
    filtered = filtered.filter(({ it, score }) => !isMastered(it) && score !== null && score < weakThreshold);
  } else if (filter === 'due') {
    filtered = filtered.filter(({ it }) => !isMastered(it) && it.nextReviewDate && it.nextReviewDate <= today);
  } else if (filter === 'unreviewed') {
    // 未复习：未攻克、reviews <= 1，且没有安排在今天或之前
    filtered = filtered.filter(({ it }) => {
      if (isMastered(it)) return false;
      if ((it.reviews || []).length > 1) return false;
      // 如果已经被提前复习（排到了今天或更早），就不算“未复习”了
      if (it.nextReviewDate && it.nextReviewDate <= today) return false;
      return true;
    });
  } else if (filter === 'unmastered') {
    filtered = filtered.filter(({ it }) => !isMastered(it));
  } else if (filter === 'mastered') {
    filtered = filtered.filter(({ it }) => isMastered(it));
  }

  // 排序：未掌握的按紧急度，已掌握的按最近复习时间倒序
  if (filter === 'mastered') {
    filtered.sort((a, b) => {
      const ra = (a.it.masteredDate || a.it.learnedDate || '');
      const rb = (b.it.masteredDate || b.it.learnedDate || '');
      return rb.localeCompare(ra);
    });
  } else if (filter === 'unreviewed') {
    // 未复习的条目没有紧急度可比，直接按录入时间倒序（最新录入的排前面）
    filtered.sort((a, b) => (b.it.learnedDate || '').localeCompare(a.it.learnedDate || ''));
  } else {
    filtered.sort((a, b) => {
      const aOver = a.it.nextReviewDate && !isMastered(a.it) && a.it.nextReviewDate < today ? 1 : 0;
      const bOver = b.it.nextReviewDate && !isMastered(b.it) && b.it.nextReviewDate < today ? 1 : 0;
      if (aOver !== bOver) return bOver - aOver;
      if (a.score !== b.score) return (a.score ?? 999) - (b.score ?? 999);
      return (a.it.nextReviewDate || '').localeCompare(b.it.nextReviewDate || '');
    });
  }

  // 已掌握过滤器下显示随机抽题按钮
  const masteredActions = $('#wbMasteredActions');
  if (masteredActions) {
    masteredActions.hidden = filter !== 'mastered' || !isMistake;
  }

  const list = $('#wbList');
  const useUnit = p.unitMode && (p.units || []).length && (p.type !== 'mistake' || isMistakePageMode(p));
  if (!filtered.length) {
    list.innerHTML = '<div class="wb-empty">没有符合条件的条目 🎉</div>';
  } else if (useUnit) {
    const units = [...p.units].sort((a, b) => (a.startPage || 0) - (b.startPage || 0));
    const pageOf = it => { const n = parseInt(getItemPageStart(it), 10); return isNaN(n) ? 0 : n; };
    // 递归判断条目是否属于某个单元（含子单元）
    function itemInUnit(it, u) {
      const ranges = getUnitPageRanges(u);
      const pg = pageOf(it);
      return ranges.some(([s, e]) => pg >= s && pg <= e);
    }
    const unitOfItem = it => {
      function find(arr) {
        for (const u of arr) {
          if (itemInUnit(it, u)) return u;
          if (u.children && u.children.length) {
            const found = find(u.children);
            if (found) return found;
          }
        }
        return null;
      }
      return find(units);
    };
    function renderWbUnit(u, level) {
      const ranges = getUnitPageRanges(u);
      const s = ranges.length ? Math.min(...ranges.map(r => r[0])) : (u.startPage || 0);
      const e = ranges.length ? Math.max(...ranges.map(r => r[1])) : (u.endPage || 0);
      const hasChildren = u.children && u.children.length > 0;
      // 关键：有子单元时，父单元只显示"直接属于自己"的条目（页码在父单元自身范围但不在任何子单元范围），避免与子单元重复显示
      let inUnit;
      if (hasChildren) {
        const childRanges = [];
        (u.children || []).forEach(c => childRanges.push(...getUnitPageRanges(c)));
        inUnit = filtered.filter(({ it }) => {
          if (u.startPage == null || u.endPage == null) return false;
          const pg = pageOf(it);
          if (pg < u.startPage || pg > u.endPage) return false;
          return !childRanges.some(([cs, ce]) => pg >= cs && pg <= ce);
        });
      } else {
        inUnit = filtered.filter(({ it }) => itemInUnit(it, u));
      }
      if (!inUnit.length && !hasChildren) return '';
      // 父单元的总条目数（含子单元），与 getUnitMastery 的计算范围一致
      const totalInUnit = filtered.filter(({ it }) => itemInUnit(it, u)).length;
      const info = getUnitMastery(p, u);
      // 四态渲染（仅错题本；背书走旧逻辑）
      let umi, upct, uBarColor;
      if (p.type === 'mistake') {
        if (info.state === 'no-data' || info.state === 'unlearned') {
          umi = { label: info.state === 'unlearned' ? '尚未学到' : '未收录错题', cls: 'm-new' };
          upct = 0; uBarColor = '#e8dfd0';
        } else if (info.state === 'learned-no-mistake') {
          umi = { label: '暂无错题', cls: 'm-good' };
          upct = 100; uBarColor = '#a7d7b5';
        } else {
          const mr = info.masteryRate;
          if (mr >= 0.8) umi = { label: '错题基本攻克', cls: 'm-solid' };
          else if (mr >= 0.5) umi = { label: '错题攻克中', cls: 'm-fuzzy' };
          else umi = { label: '错题待攻克', cls: 'm-weak' };
          upct = Math.round(mr * 100);
          uBarColor = mr >= 0.8 ? '#096f4e' : (mr >= 0.5 ? '#e0a020' : '#e5484d');
        }
      } else {
        // 背书：旧逻辑
        const sc = info.masteryRate;
        umi = masteryFromScore(sc);
        upct = sc === null ? 0 : Math.round(sc * 100);
        uBarColor = sc === null ? '#e8dfd0' : (sc >= 0.8 ? '#096f4e' : (sc >= 0.4 ? '#e0a020' : '#e5484d'));
      }
      const indent = level * 16;
      const childInfo = hasChildren ? ` · ${u.children.length}个子单元` : '';
      let html = `<div class="wb-unit-group" style="margin-left:${indent}px">
        <div class="wb-unit-group-head">
          <span>${level > 0 ? '└ ' : ''}📁 ${esc(u.name || '未命名单元')} <span class="muted" style="font-size:12px">P${s}-P${e} · ${totalInUnit}条${childInfo}</span></span>
          <span style="font-size:12.5px;font-weight:600;color:${uBarColor}">${upct > 0 ? upct + '% · ' : ''}${umi.label}</span>
        </div>
        <div class="wb-unit-group-bar"><div style="height:100%;width:${upct}%;background:${uBarColor};border-radius:3px"></div></div>
        <ul class="wb-unit-items">${inUnit.map(itemLi).join('')}</ul>
      </div>`;
      if (hasChildren) u.children.forEach(c => html += renderWbUnit(c, level + 1));
      return html;
    }
    let html = units.map(u => renderWbUnit(u, 0)).join('');
    const noUnit = filtered.filter(({ it }) => !unitOfItem(it));
    if (noUnit.length) {
      html += `<div class="wb-unit-group">
        <div class="wb-unit-group-head"><span>📂 未归类 <span class="muted" style="font-size:12px">${noUnit.length}条</span></span></div>
        <ul class="wb-unit-items">${noUnit.map(itemLi).join('')}</ul>
      </div>`;
    }
    list.innerHTML = html;
  } else {
    list.innerHTML = filtered.map(itemLi).join('');
  }

  const reasonsEl = $('#wbReasons');
  const detailEl = $('#wbReasonDetail');
  const reasonBlock = $('#wbReasonBlock');
  if (isMistake) {
    reasonBlock.hidden = false;
    const permanentSet = new Set(ERROR_REASONS);
    (p.customErrorReasons || []).forEach(r => { if (r.permanent) permanentSet.add(r.name); });
    const cnt = {};
    const reasonItems = {};
    items.forEach(it => {
      (it.errTags || []).forEach(tag => {
        if (permanentSet.has(tag)) {
          cnt[tag] = (cnt[tag] || 0) + 1;
          (reasonItems[tag] = reasonItems[tag] || []).push(it);
        }
      });
    });
    if (!Array.isArray(p.reasonOrder)) p.reasonOrder = [];
    let arr = Object.entries(cnt).sort((a, b) => {
      const ia = p.reasonOrder.indexOf(a[0]), ib = p.reasonOrder.indexOf(b[0]);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return b[1] - a[1];
    });
    const total = arr.reduce((s, [, n]) => s + n, 0);
    if (!total) {
      reasonsEl.innerHTML = '<div style="font-size:13px;color:var(--muted)">还没有标注错因，录入错题时选一个吧～错因按历史累计统计，做对后仍会保留。</div>';
      detailEl.innerHTML = '';
    } else {
      const R = 70, r = 42, cx = 85, cy = 85;
      let ang = -Math.PI / 2;
      let paths = '';
      arr.forEach(([name, n]) => {
        const frac = n / total;
        const a2 = ang + frac * Math.PI * 2;
        const large = (a2 - ang) > Math.PI ? 1 : 0;
        const x1 = cx + R * Math.cos(ang), y1 = cy + R * Math.sin(ang);
        const x2 = cx + R * Math.cos(a2), y2 = cy + R * Math.sin(a2);
        const x3 = cx + r * Math.cos(a2), y3 = cy + r * Math.sin(a2);
        const x4 = cx + r * Math.cos(ang), y4 = cy + r * Math.sin(ang);
        const [bg] = reasonColor(name);
        paths += `<path d="M${x1} ${y1} A${R} ${R} 0 ${large} 1 ${x2} ${y2} L${x3} ${y3} A${r} ${r} 0 ${large} 0 ${x4} ${y4} Z" fill="${bg}" data-reason="${esc(name)}" style="cursor:pointer"></path>`;
        ang = a2;
      });
      const legend = arr.map(([name, n]) => {
        const [bg] = reasonColor(name);
        const pc = Math.round(n / total * 100);
        const rel = reasonItems[name] || [];
        const relMastered = rel.filter(isMastered).length;
        return `<div class="wb-pie-row" data-reason="${esc(name)}" title="历史累计 ${n} 次 · 涉及 ${rel.length} 题 · 已攻克 ${relMastered} 题">
          <span class="dot" style="background:${bg}"></span>
          <span class="nm">${esc(name)} <span class="muted" style="font-size:11px">✓${relMastered}/${rel.length}</span></span>
          <span class="ct">${n}</span>
          <span class="pc">${pc}%</span></div>`;
      }).join('');
      reasonsEl.innerHTML = `
        <svg class="wb-pie" width="170" height="170" viewBox="0 0 170 170">
          ${paths}
          <text x="85" y="82" text-anchor="middle" font-size="26" font-weight="700" class="wb-pie-num">${total}</text>
          <text x="85" y="100" text-anchor="middle" font-size="11" class="wb-pie-label">累计错次</text>
        </svg>
        <div class="wb-pie-legend">
          <div style="font-size:11.5px;color:var(--muted);margin-bottom:2px">按历史累计统计，做对后仍保留；✓已攻克/涉及题数</div>
          ${legend}
        </div>`;
      const showDetail = name => {
        const matched = (reasonItems[name] || []);
        const mMastered = matched.filter(isMastered).length;
        const head = `<div class="rd-head">${esc(name)} · ${matched.length} 题 · 已攻克 ${mMastered} · 待巩固 ${matched.length - mMastered}</div>`;
        detailEl.innerHTML = head +
          (matched.length ? matched.map(it => {
            const loc = getItemSource(it, p);
            const status = isMastered(it)
              ? '<span style="color:var(--ok);font-weight:600;white-space:nowrap">✓ 已攻克</span>'
              : `<span style="color:${scoreOf(it) < weakThreshold ? '#b02e24' : '#96600c'};font-weight:600;white-space:nowrap">${getMasteryInfo(it).label}</span>`;
            const locTxt = [loc, fmtCN(it.learnedDate)].filter(Boolean).join(' · ');
            return `<div class="rd-item"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.content)}</span><span style="display:flex;gap:8px;align-items:center;flex:0 0 auto"><span class="muted" style="white-space:nowrap">${esc(locTxt)}</span>${status}</span></div>`;
          }).join('')
          : '<div class="muted" style="font-size:12.5px">没有相关条目</div>');
      };
      reasonsEl.onclick = e => {
        const el = e.target.closest('[data-reason]');
        if (el) showDetail(el.dataset.reason);
      };
      showDetail(arr[0][0]);
    }
  } else {
    reasonBlock.hidden = true;
    reasonsEl.innerHTML = '';
    detailEl.innerHTML = '';
  }

  const pad = $('#wbNotePad');
  pad.value = p.notePad || '';
  // 笔记输入高频：立即更新内存值，落盘（含 IndexedDB）做防抖，避免每次按键都全量序列化；
  // 切后台/关闭页面有 visibilitychange/pagehide/beforeunload 强制保存兜底，不丢数据
  pad.oninput = () => {
    p.notePad = pad.value; p.updatedAt = Date.now();
    if (pad._saveT) clearTimeout(pad._saveT);
    pad._saveT = setTimeout(() => { pad._saveT = null; saveStore(); }, 600);
  };

  // 单元掌握度：仅背书且开启单元模式时显示（错题不使用单元）
  const unitBlock = $('#wbUnitBlock');
  const unitsEl = $('#wbUnits');
  if (useUnit) {
    unitBlock.hidden = false;
    const units = [...p.units].sort((a, b) => (a.startPage || 0) - (b.startPage || 0));
    function renderWbUnitRow(u, level) {
      const ranges = getUnitPageRanges(u);
      const s = ranges.length ? Math.min(...ranges.map(r => r[0])) : (u.startPage || 0);
      const e = ranges.length ? Math.max(...ranges.map(r => r[1])) : (u.endPage || 0);
      const info = getUnitMastery(p, u);
      let mi, pct, barColor;
      if (p.type === 'mistake') {
        if (info.state === 'no-data' || info.state === 'unlearned') {
          mi = { label: info.state === 'unlearned' ? '尚未学到' : '未收录错题', cls: 'm-new' };
          pct = 0; barColor = '#e8dfd0';
        } else if (info.state === 'learned-no-mistake') {
          mi = { label: '暂无错题', cls: 'm-good' };
          pct = 100; barColor = '#a7d7b5';
        } else {
          const mr = info.masteryRate;
          if (mr >= 0.8) mi = { label: '错题基本攻克', cls: 'm-solid' };
          else if (mr >= 0.5) mi = { label: '错题攻克中', cls: 'm-fuzzy' };
          else mi = { label: '错题待攻克', cls: 'm-weak' };
          pct = Math.round(mr * 100);
          barColor = mr >= 0.8 ? '#096f4e' : (mr >= 0.5 ? '#e0a020' : '#e5484d');
        }
      } else {
        const sc = info.masteryRate;
        mi = masteryFromScore(sc);
        pct = sc === null ? 0 : Math.round(sc * 100);
        barColor = sc === null ? '#e8dfd0' : (sc >= 0.8 ? '#096f4e' : (sc >= 0.4 ? '#e0a020' : '#e5484d'));
      }
      const indent = level * 16;
      const hasChildren = u.children && u.children.length > 0;
      const childInfo = hasChildren ? ` · ${u.children.length}个子单元` : '';
      let html = `<div class="wb-unit-row" style="margin-left:${indent}px">
        <div class="wb-unit-head">
          <span>${level > 0 ? '└ ' : ''}${esc(u.name || '未命名单元')} <span class="muted">P${s}-P${e}${childInfo}</span></span>
          <span class="muted">${pct > 0 ? pct + '% · ' : ''}${mi.label}</span>
        </div>
        <div class="wb-unit-bar"><div class="wb-unit-fill" style="width:${pct}%;background:${barColor}"></div></div>
      </div>`;
      if (hasChildren) u.children.forEach(c => html += renderWbUnitRow(c, level + 1));
      return html;
    }
    unitsEl.innerHTML = units.map(u => renderWbUnitRow(u, 0)).join('');
  } else {
    unitBlock.hidden = true;
    unitsEl.innerHTML = '';
  }
}

/* ============ 导出 / 导入 ============ */
function showBusy(text){ $('#busyText').textContent = text; $('#busyMask').hidden = false; }
function hideBusy(){ $('#busyMask').hidden = true; }
function exportData() {
  const data = JSON.stringify({
    version: 2,
    exportedAt: new Date().toISOString(),
    store: store
  }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const filename = `study-tracker-${todayStr()}.json`;

  // iOS：优先用 navigator.share 分享文件（iOS Safari 忽略 <a download>，会在新标签页打开 JSON 乱码）
  if (isIOSDevice() && navigator.share) {
    try {
      const file = new File([blob], filename, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: 'Study Tracker 备份' })
          .then(() => { setLocalVal('study_tracker_last_backup', todayStr()); })
          .catch(() => {}); // 用户取消分享不报错
        return;
      }
    } catch (e) {}
  }

  // 桌面端 / 不支持 share 的环境：必须同步执行 a.click()，不能用 setTimeout/Promise
  // 否则会脱离用户手势上下文，iOS Safari 会静默拦截下载
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 3000); // 延长到3秒，避免iOS新标签页加载完前被回收
  setLocalVal('study_tracker_last_backup', todayStr());
}

function importData(file) {
  showBusy('正在读取并解析备份…');
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const obj = JSON.parse(e.target.result);
      let imported = null;
      if (obj && obj.store && obj.store.projects) imported = obj.store;
      else if (obj && obj.projects) imported = obj;
      if (!imported || typeof imported.projects !== 'object') throw new Error('文件格式不正确');
      // 过滤掉非对象的项目值，防止恶意 JSON 注入脏数据导致渲染崩溃
      Object.keys(imported.projects).forEach(pid => {
        const v = imported.projects[pid];
        if (!v || typeof v !== 'object' || Array.isArray(v)) { try { delete imported.projects[pid]; } catch (e) {} }
      });
      if (!Object.keys(imported.projects).length) throw new Error('备份文件里没有有效项目');

      hideBusy();
      // 显示导入确认弹窗
      $('#importProjCount').textContent = Object.keys(imported.projects).length;
      $('#importConfirmMask').hidden = false;
      modalTop($('#importConfirmMask'));
      // 绑定一次性点击
      $('#importMergeCard').onclick = () => {
        $('#importConfirmMask').hidden = true;
        unlockBodyScroll();
        doImport(imported, 'merge');
      };
      $('#importOverwriteCard').onclick = () => {
        $('#importConfirmMask').hidden = true;
        unlockBodyScroll();
        doImport(imported, 'overwrite');
      };
    } catch (err) {
      hideBusy();
      alert('导入失败：' + err.message);
    }
  };
  reader.onerror = () => { hideBusy(); alert('文件读取失败，请重试'); };
  reader.onabort = () => { hideBusy(); };
  reader.readAsText(file);
}

function doImport(imported, mode) {
  showBusy('正在写入数据…');

  // 导入数据净化（复用全局 sanitizeStoreData）：任意损坏/被篡改的备份都不应导致白屏崩溃。
  // 合并模式下先净化当前库（防御历史脏数据），再净化导入数据
  if (mode === 'overwrite') {
    const clean = sanitizeStoreData(imported);
    if (!clean || !Object.keys(clean.projects).length) {
      hideBusy();
      alert('导入失败：备份文件里没有有效项目');
      return;
    }
    store = clean;
  } else {
    sanitizeStoreData(store);
    const cleanImported = sanitizeStoreData(imported);
    if (!cleanImported || !Object.keys(cleanImported.projects).length) {
      hideBusy();
      alert('导入失败：备份文件里没有有效项目');
      return;
    }
    imported = cleanImported;
    // 合并模式：保留现有项目，把备份里的 records / items 追加进来（按 id/rid 去重）
    Object.keys(imported.projects || {}).forEach(pid => {
      const inc = imported.projects[pid];
      if (!inc) return;
      if (!store.projects[pid]) {
        store.projects[pid] = inc;
        return;
      }
      const curP = store.projects[pid];
      curP.records = curP.records || [];
      const seenR = new Set(curP.records.map(r => r.rid).filter(Boolean));
      (inc.records || []).forEach(r => {
        if (r.rid && seenR.has(r.rid)) return;
        if (!r.rid && curP.records.some(x =>
          x.date === r.date && x.endPage === r.endPage &&
          x.startPage === r.startPage && x.set === r.set)) return;
        curP.records.push(r);
        if (r.rid) seenR.add(r.rid);
      });
      curP.items = curP.items || [];
      const seenI = new Set(curP.items.map(it => it.id).filter(Boolean));
      (inc.items || []).forEach(it => {
        if (it.id && seenI.has(it.id)) return;
        curP.items.push(it);
        if (it.id) seenI.add(it.id);
      });
    });
  }

  // ===== 数据迁移 / 补默认字段 =====
  Object.values(store.projects).forEach(p => {
        if (!p || typeof p !== 'object') return;
        (p.items || []).forEach(it => {
          if (!it || typeof it !== 'object') return;
          if (it.pageStart == null && it.page != null) {
            it.pageStart = it.page;
            it.pageEnd = it.page;
          }
          if (it.pageStart == null) it.pageStart = 0;
          if (it.pageEnd == null) it.pageEnd = it.pageStart;
          if (it.manualMastered == null) it.manualMastered = false;
          if (it.wrongStreak == null) it.wrongStreak = 0;
          if (it.customIntervals === undefined) it.customIntervals = null;
          if (it.spreadCount == null) it.spreadCount = 0;
          if (it.lastSpreadDate == null) it.lastSpreadDate = null;
          if (it.earlyReviewed == null) it.earlyReviewed = false;
          if (it.stage == null) it.stage = 0;
          if (it.mastered == null) it.mastered = false;
          if (!Array.isArray(it.reviews)) it.reviews = [];
          if (it.masteredDate === undefined) it.masteredDate = null;
          if (it.learnedDate == null) it.learnedDate = todayStr();
          if (it.finalReviewDate === undefined) it.finalReviewDate = null;
        });
        if (!Array.isArray(p.shownMilestones)) p.shownMilestones = [];
        if (!Array.isArray(p.units)) p.units = [];
        // 递归补全单元 children 字段（旧版备份可能缺失，否则渲染单元编辑器会崩）
        const _ensureImportChildren = arr => (arr || []).forEach(u => { if (!u || typeof u !== 'object') return; if (!Array.isArray(u.children)) u.children = []; if (u.children.length) _ensureImportChildren(u.children); });
        _ensureImportChildren(p.units);
        if (!Array.isArray(p.records)) p.records = [];
        p.records.forEach(r => {
          if (!r || typeof r !== 'object') return;
          if (r.startPage == null && r.endPage == null && r.page != null) { r.endPage = r.page; delete r.page; }
        });
        if (!Array.isArray(p.items)) p.items = [];
        if (!Array.isArray(p.intervals) || !p.intervals.length) p.intervals = [...DEFAULT_INTERVALS];
        if (p.weakThreshold == null) p.weakThreshold = 0.4;
        if (p.lapseRollback == null) p.lapseRollback = 2;
        if (p.skipConfirmDismissed == null) p.skipConfirmDismissed = false;
        if (p.reviewMode == null) p.reviewMode = 'classic';
        if (p.dailyCapacity == null) p.dailyCapacity = null;
        if (p.spreadThreshold == null) p.spreadThreshold = defaultComfortCap(p);
        if (p.totalLocked == null) p.totalLocked = false;
        if (!p.deadline && !(p.type === 'mistake' && (!p.mistakeMode || p.mistakeMode === 'free'))) p.deadline = todayStr();
        if (p.unitMode == null) p.unitMode = false;
        if (p.startDate == null) p.startDate = '';
        if (p.startPage == null) p.startPage = 0;
        if (p.createdAt == null) p.createdAt = Date.now();
        if (p.updatedAt == null) p.updatedAt = Date.now();
        migrateProject(p);
      });

  // 导入后清理指向不存在项目的 refProjectId
  const validIds = new Set(Object.keys(store.projects));
  Object.values(store.projects).forEach(p => {
    if (!p || typeof p !== 'object') return;
    if (p.refProjectId && !validIds.has(p.refProjectId)) p.refProjectId = null;
  });

  if (!store.currentId || !store.projects[store.currentId]) {
    const ids = Object.keys(store.projects);
    store.currentId = ids.length ? ids[0] : null;
  }
  saveStore();
  closeSettings();
  closeForm();
  render();
  hideBusy();
  showToast('✅', '导入成功', '数据已导入完成。', 3000);
}

/* ============ 事件绑定 ============ */
$('#btnSwitch').addEventListener('click', openSwitch);
$('#switchClose').addEventListener('click', closeSwitch);
$('#btnNewProject').addEventListener('click', () => { closeSwitch(); openFormCreate(); });
$('#btnCreateFirst').addEventListener('click', openFormCreate);
$('#btnSettings').addEventListener('click', openSettings);
$('#btnLinkRef').addEventListener('click', () => {
  openSettings();
  // 滚动到关联刷题本区域
  setTimeout(() => {
    const el = $('#refProjectSection');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 200);
});

// 刷题本关联错题本列表
function renderLinkedMistakesPopup() {
  const p = cur();
  if (!p || p.type !== 'exercise') return;
  const linked = Object.values(store.projects).filter(o => o.type === 'mistake' && o.refProjectId === p.id);
  const listEl = $('#linkedMistakesList');
  if (linked.length === 0) {
    listEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:14px">还没有关联的错题本<br><span style="font-size:12.5px">关联后可区分「尚未学到」和「学完暂无错题」</span></div>';
  } else {
    listEl.innerHTML = linked.map(m => {
      const mm = m.mistakeMode || 'free';
      const modeName = mm === 'page' ? '习题册模式' : mm === 'set' ? '套卷模式' : '自由出处';
      const items = m.items || [];
      const mastered = items.filter(it => it.mastered || it.manualMastered).length;
      return `<div style="padding:12px 14px;border:1px solid var(--border);border-radius:10px;margin-bottom:8px;cursor:pointer" data-open="${m.id}">
        <div style="font-weight:600;font-size:14px;margin-bottom:4px">${esc(m.name)}</div>
        <div style="font-size:12.5px;color:var(--muted)">${modeName} · 已攻克 ${mastered}/${items.length} 道</div>
      </div>`;
    }).join('');
    listEl.querySelectorAll('[data-open]').forEach(el => {
      el.addEventListener('click', () => {
        store.currentId = el.dataset.open;
        saveStore();
        $('#linkedMistakesMask').hidden = true;
        unlockBodyScroll();
        render();
      });
    });
  }
  // 隐藏可关联列表
  $('#availableMistakesSection').hidden = true;
}
$('#btnLinkedMistakes').addEventListener('click', () => {
  renderLinkedMistakesPopup();
  $('#linkedMistakesMask').hidden = false;
  modalTop($('#linkedMistakesMask'));
});
$('#linkedMistakesClose').addEventListener('click', () => { $('#linkedMistakesMask').hidden = true; unlockBodyScroll(); });
$('#linkedMistakesMask').addEventListener('click', e => { if (e.target === $('#linkedMistakesMask') && !_mouseDownInModal) { $('#linkedMistakesMask').hidden = true; unlockBodyScroll(); } });

// 关联已有错题本
$('#btnLinkExisting').addEventListener('click', () => {
  const p = cur();
  if (!p || p.type !== 'exercise') return;
  const section = $('#availableMistakesSection');
  const listEl = $('#availableMistakesList');
  // 可关联的错题本：未关联、计量方式一致、page/set模式
  const available = Object.values(store.projects).filter(o => {
    if (o.type !== 'mistake' || o.refProjectId) return false;
    if (p.unit === 'set') return o.mistakeMode === 'set';
    return o.mistakeMode === 'page';
  });
  if (available.length === 0) {
    listEl.innerHTML = '<div style="padding:12px;text-align:center;color:var(--muted);font-size:13px">没有可关联的错题本<br><span style="font-size:12px">需要先创建一个' + (p.unit === 'set' ? '套卷模式' : '习题册模式') + '的错题本</span></div>';
  } else {
    listEl.innerHTML = available.map(m => {
      const mm = m.mistakeMode || 'free';
      const modeName = mm === 'page' ? '习题册模式' : '套卷模式';
      const items = m.items || [];
      const mastered = items.filter(it => it.mastered || it.manualMastered).length;
      return `<div style="padding:10px 12px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;cursor:pointer;display:flex;justify-content:space-between;align-items:center" data-link="${m.id}">
        <div>
          <div style="font-weight:600;font-size:13.5px">${esc(m.name)}</div>
          <div style="font-size:12px;color:var(--muted)">${modeName} · ${items.length}道错题</div>
        </div>
        <span style="font-size:12px;color:#2e6b4f;font-weight:600">关联 →</span>
      </div>`;
    }).join('');
    listEl.querySelectorAll('[data-link]').forEach(el => {
      el.addEventListener('click', () => {
        const m = store.projects[el.dataset.link];
        if (!m) return;
        // 结构不一致时用刷题本结构覆盖
        if (!structuresMatch(m, p)) {
          applyRefStructure(m, p);
        } else {
          m.refProjectId = p.id;
          m.updatedAt = Date.now();
        }
        saveStore();
        $('#linkedMistakesMask').hidden = true;
        unlockBodyScroll();
        render();
        showToast('✅', '已关联', `「${m.name}」已关联到当前刷题本。`, 3000);
      });
    });
  }
  section.hidden = false;
});
$('#btnCreateLinkedFromList').addEventListener('click', () => {
  $('#linkedMistakesMask').hidden = true;
  unlockBodyScroll();
  // 触发创建关联错题本
  const p = cur();
  if (!p || p.type !== 'exercise') return;
  creatingLinkedFrom = p.id;
  openFormCreate();
  $('#fName').value = p.name + ' 错题本';
  document.querySelectorAll('input[name="ptype"]').forEach(r => { r.checked = r.value === 'mistake'; r.disabled = true; });
  const mode = p.unit === 'set' ? 'set' : 'page';
  document.querySelectorAll('input[name="pmistakemode"]').forEach(r => { r.checked = r.value === mode; });
  if (p.unit === 'set' && p.paperLabelMode) {
    const lr = document.querySelector(`input[name="ppaperlabel"][value="${p.paperLabelMode}"]`);
    if (lr) lr.checked = true;
    if (p.paperLabelMode === 'year' && p.paperYearStart) $('#fPaperYear').value = p.paperYearStart;
  }
  syncFormUnit();
  // 自动关联当前刷题本并锁定
  const fLinkRef = $('#fLinkRef');
  if (fLinkRef) {
    fLinkRef.value = p.id;
    fLinkRef.disabled = true;
  }
  if (p.unit !== 'set') {
    if (p.bookStartPage) $('#fBookStart').value = p.bookStartPage;
    if (p.bookEndPage) $('#fBookEnd').value = p.bookEndPage;
  }
  if (p.unitMode && Array.isArray(p.units) && p.units.length) {
    $('#fUnitMode').checked = true;
    $('#fUnitEditor').hidden = false;
    renderUnitEditor(p.units, $('#fUnitEditList'));
  }
  if (p.unit === 'set') $('#fTotal').value = p.total || '';
  showToast('📝', '创建关联错题本', '名称、模式、单元结构已从刷题本复制，保存后自动关联。', 4000);
});

$('#formClose').addEventListener('click', closeForm);
$('#formCancel').addEventListener('click', closeForm);

function submitFormCreate() {
  const name = ($('#fName').value || '').trim();
  const total = parseInt($('#fTotal').value, 10);
  const deadline = $('#fDeadline').value;
  const startDate = $('#fStartDate').value;
  const startPage = parseInt($('#fStartPage').value, 10) || 0;
  const bookStartRaw = $('#fBookStart').value.trim();
  const bookEndRaw = $('#fBookEnd').value.trim();
  const bookStart = bookStartRaw ? parseInt(bookStartRaw, 10) : 1;
  const bookEnd = bookEndRaw ? parseInt(bookEndRaw, 10) : NaN;
  const type = (document.querySelector('input[name="ptype"]:checked') || {}).value || 'exercise';
  const unit = type === 'exercise'
    ? (((document.querySelector('input[name="punit"]:checked') || {}).value) || 'page')
    : 'page';
  const mistakeMode = type === 'mistake'
    ? (((document.querySelector('input[name="pmistakemode"]:checked') || {}).value) || 'free')
    : null;
  const isSet = unit === 'set';
  const isMistakePage = type === 'mistake' && mistakeMode === 'page';
  const isMistakeSet = type === 'mistake' && mistakeMode === 'set';
  const usePageRange = (type !== 'mistake' && !isSet) || isMistakePage;
  // 提前读取"只做部分页"（要在正文结束页校验之前）
  const scopeMode = formIsPageScope() ? !!$('#fScopeMode').checked : false;
  let targetRanges = scopeMode ? readScopeRows($('#fScopeList')) : [];
  const scopePageCount = countRanges(targetRanges);
  // 提前读取单元模式：开启且"只统计单元页码"时，不需要正文结束页
  const unitModeEarly = (type === 'exercise' && unit === 'page') || type === 'recite' || isMistakePage
    ? !!$('#fUnitMode').checked : false;
  const fUnitScopeMode = (document.querySelector('input[name="fUnitScopeMode"]:checked') || {}).value || 'book';
  const needBookEnd = usePageRange && !scopeMode && !(unitModeEarly && fUnitScopeMode !== 'book');
  clearAllFieldErrors();

  if (!name) { setFieldError($('#fName'), '请填写任务名称'); $('#fName').focus(); return; }
  // 同名查重
  if (Object.values(store.projects).some(p => p.name === name)) { setFieldError($('#fName'), '已存在同名任务「' + name + '」，换个名字吧'); $('#fName').focus(); return; }
  if ((isSet || isMistakeSet) && (!total || total < 1)) { setFieldError($('#fTotal'), '请填写有效的总套数'); $('#fTotal').focus(); return; }
  if (needBookEnd && (isNaN(bookEnd) || bookEnd < 1)) { setFieldError($('#fBookEnd'), '请填写正文结束页（资料的最后一页）'); $('#fBookEnd').focus(); return; }
  if (usePageRange && bookStartRaw && (isNaN(bookStart) || bookStart < 1)) { setFieldError($('#fBookStart'), '正文起始页必须 ≥ 1'); $('#fBookStart').focus(); return; }
  if (needBookEnd && bookStart > bookEnd) { setFieldError($('#fBookEnd'), '起始页不能大于结束页'); $('#fBookEnd').focus(); return; }
  if (scopeMode && !scopePageCount) { showToast('⚠️', '请填写页码区间', '至少一个要做的页码区间（只填“起”=单页）', 2800); return; }
  if (!deadline) { setFieldError($('#fDeadline'), '请选择计划完成日期'); $('#fDeadline').focus(); return; }
  if (deadline && diffDays(todayStr(), deadline) < 0) { setFieldError($('#fDeadline'), '计划完成日期不能早于今天'); $('#fDeadline').focus(); return; }
  if (startDate && diffDays(startDate, deadline) < 0) { setFieldError($('#fStartDate'), '开始日期不能晚于截止日期'); $('#fStartDate').focus(); return; }
  if (startDate && diffDays(startDate, todayStr()) < 0) { setFieldError($('#fStartDate'), '开始日期不能晚于今天'); $('#fStartDate').focus(); return; }

  // 错题套卷也要存总套数；错题习题册/自由出处才是动态总量
  let effectiveTotal = usePageRange
    ? (scopeMode ? scopePageCount : bookEnd - bookStart + 1)
    : (isMistakeSet ? (total || 0) : (type === 'mistake' ? 0 : total));

  let paperSections = [];
  let paperLabelMode = 'index';
  let paperYearStart = null;
  if (isSet || isMistakeSet) {
    if (isSet) paperSections = readPaperSecRows($('#fPaperSecList'));
    // 权重和校验：≠100% 时提示将按比例归一化（不阻断，给用户确认机会）
    if (isSet && paperSections.length) {
      const wSum = paperSections.reduce((s, x) => s + (Number(x.weight) || 0), 0);
      if (Math.abs(wSum - 100) > 0.5) {
        if (!confirm(`板块权重和为 ${Math.round(wSum)}%，不是 100%。\n\n提交后会自动按当前比例归一化（各板块权重 ÷ 权重和 × 100%）。\n\n确定继续吗？`)) return;
      }
    }
    paperLabelMode = (document.querySelector('input[name="ppaperlabel"]:checked') || {}).value || 'index';
    if (paperLabelMode === 'year') {
      paperYearStart = parseInt($('#fPaperYear').value, 10);
      if (isNaN(paperYearStart)) return alert('请填写套卷起始年份（如 2005），或改回「第 N 套」命名～');
    }
  }

  // 单元模式：刷题按页码 + 背书 + 错题本习题册模式
  const unitMode = (type === 'exercise' && unit === 'page') || type === 'recite' || isMistakePage
    ? !!$('#fUnitMode').checked : false;
  let units = [];
  if (unitMode) {
    units = readUnitRowsFromList($('#fUnitEditList'));
    if (!units.length) return alert('请至少添加一个单元～');
    const minPage = (usePageRange && fUnitScopeMode === 'book') ? bookStart : 1;
    const maxPage = (usePageRange && fUnitScopeMode === 'book') ? bookEnd : Infinity;
    let minStart = Infinity, maxEnd = -Infinity;
    function validateUnit(u) {
      if (!u.name) return '请填写单元名称～';
      if (u.startPage == null || u.endPage == null) return `单元「${u.name}」的页码不完整～`;
      if (u.startPage > u.endPage) return `单元「${u.name}」起始页不能大于结束页～`;
      minStart = Math.min(minStart, u.startPage);
      maxEnd = Math.max(maxEnd, u.endPage);
      for (const c of (u.children || [])) { const err = validateUnit(c); if (err) return err; }
      return null;
    }
    for (const u of units) { const err = validateUnit(u); if (err) return alert(err); }
    if (minStart < minPage) return alert(`单元起始页最小为第 ${minStart} 页，超出正文范围（正文从第 ${minPage} 页开始）～`);
    if (maxEnd > maxPage) return alert(`单元结束页最大为第 ${maxEnd} 页，超出正文范围（正文到第 ${maxPage} 页结束）～`);
    // 单元模式 + 只统计单元页码：总页数用单元范围并集（修正 effectiveTotal，避免 NaN）
    if (fUnitScopeMode !== 'book') {
      const allRanges = [];
      function collectUnitRange(u) {
        const hasChildren = u.children && u.children.length;
        if (fUnitScopeMode === 'all' || !hasChildren) {
          if (u.startPage != null && u.endPage != null && u.endPage >= u.startPage) allRanges.push({start:u.startPage, end:u.endPage});
        }
        (u.children || []).forEach(collectUnitRange);
      }
      units.forEach(collectUnitRange);
      effectiveTotal = countRanges(mergeRanges(allRanges));
    }
  }

  const id = genId();
  const newProject = {
    id, name, type, unit, total: effectiveTotal, deadline,
    startDate: startDate || '',
    startPage: startPage,
    unitMode: unitMode && !scopeMode,
    units: (unitMode && !scopeMode) ? units : [],
    unitScopeMode: (unitMode && !scopeMode) ? fUnitScopeMode : 'book',
    scopeMode: scopeMode && !unitMode,
    targetRanges: (scopeMode && !unitMode) ? targetRanges : [],
    mistakeMode: mistakeMode,
    intervals: [...DEFAULT_INTERVALS],
    records: [],
    items: [],
    shownMilestones: [],
    weakThreshold: 0.4,
    lapseRollback: 2,
    skipConfirmDismissed: false,
    reviewMode: (type === 'mistake' || type === 'recite')
      ? ((document.querySelector('input[name="freviewmode"]:checked') || {}).value || 'balanced')
      : 'classic',
    dailyCapacity: null,
    spreadThreshold: type === 'recite' ? 6 : 10,
    totalLocked: false,
    bookStartPage: usePageRange ? (bookStart > 1 ? bookStart : null) : null,
    bookEndPage: usePageRange ? bookEnd : null,
    paperSections,
    paperLabelMode,
    paperYearStart,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  // 关联刷题本：从刷题本创建 或 新建表单中选择
  let refId = null;
  if (creatingLinkedFrom && type === 'mistake') {
    refId = creatingLinkedFrom;
  } else if (type === 'mistake' && (isMistakePage || isMistakeSet)) {
    const sel = $('#fLinkRef');
    if (sel && sel.value) refId = sel.value;
  }
  if (refId) {
    const ref = store.projects[refId];
    if (ref) {
      // 结构不一致时用刷题本结构覆盖（新建错题本没有旧数据，直接覆盖无风险）
      if (!structuresMatch({ ...newProject, mistakeMode }, ref)) {
        if (ref.unit === 'set') {
          newProject.paperSections = JSON.parse(JSON.stringify(ref.paperSections || []));
          newProject.total = ref.total;
          newProject.paperLabelMode = ref.paperLabelMode;
          newProject.paperYearStart = ref.paperYearStart;
        } else {
          newProject.units = JSON.parse(JSON.stringify(ref.units || []));
          newProject.bookStartPage = ref.bookStartPage;
          newProject.bookEndPage = ref.bookEndPage;
          newProject.unitMode = !!ref.unitMode;
        }
      }
      newProject.refProjectId = refId;
    }
  }
  store.projects[id] = newProject;
  store.currentId = id;
  saveStore();
  // 恢复类型选择器
  document.querySelectorAll('input[name="ptype"]').forEach(r => { r.disabled = false; });
  creatingLinkedFrom = null;
  closeForm();
  render();
}
$('#formSave').addEventListener('click', submitFormCreate);

// 新建向导：回车自动跳到下一个输入框，最后一个回车保存（统一导航，见 setupEnterNav）

$('#formImport').addEventListener('click', () => $('#importFile').click());

$('#settingsClose').addEventListener('click', closeSettings);
$('#settingsCancel').addEventListener('click', closeSettings);

// 设置页任何修改都标记为未保存
$('#settingsMask').addEventListener('input', markSettingsDirty);
$('#settingsMask').addEventListener('change', markSettingsDirty);

/* 复习模式切换交互 */
document.querySelectorAll('input[name="reviewMode"]').forEach(r => {
  r.addEventListener('change', () => {
    const mode = (document.querySelector('input[name="reviewMode"]:checked') || {}).value;
    const bs = $('#balancedSettings');
    if (bs) bs.hidden = mode !== 'balanced';
    updateIntervalHint(mode);
  });
});
// 根据复习模式更新间隔设置的说明文案
function updateIntervalHint(mode) {
  const hint = $('#intervalHint');
  if (!hint) return;
  if (mode === 'balanced') {
    hint.innerHTML = '这些间隔是<b>排期基础</b>：系统先按间隔算出计划日期，再从该日期起往后找空位错峰（最多顺延间隔天数的一半），避免某天爆量。间隔越短，整体复习越密集。';
  } else {
    hint.innerHTML = '每学习一个新内容后，<b>严格按这些间隔依次提醒复习</b>。每次复习后顺序推进到下一轮，走到最后一轮且最近3次全对时会弹出确认掌握提示。';
  }
}
$('#sCapacityMode').addEventListener('change', e => {
  $('#sCapacityFixedWrap').hidden = e.target.value !== 'fixed';
  updatePressurePanel();
});
$('#sCapacityFixed').addEventListener('input', () => updatePressurePanel());
$('#sSpreadThreshold').addEventListener('input', () => { updateSpreadPressureHint(); updatePressurePanel(); const _p=store.projects[store.currentId]; if(_p) renderComfortAdvice(_p); });
$('#btnReviewModeHelp').addEventListener('click', () => {
  $('#reviewModeHelpMask').hidden = false;
  modalTop($('#reviewModeHelpMask'));
});
$('#reviewModeHelpClose').addEventListener('click', () => { $('#reviewModeHelpMask').hidden = true; unlockBodyScroll(); });
$('#reviewModeHelpOk').addEventListener('click', () => { $('#reviewModeHelpMask').hidden = true; unlockBodyScroll(); });

/* 错题本模式切换：自由出处 → 习题册/套卷（单向，不可逆） */
function switchMistakeFormat(targetMode) {
  const p = cur();
  if (!p || p.type !== 'mistake' || p.mistakeMode !== 'free') return;
  const isPage = targetMode === 'page';
  const modeName = isPage ? '习题册模式' : '套卷模式';
  const modeDesc = isPage ? '之后新录入的错题会带页码，支持单元模式和按单元看薄弱点' : '之后新录入的错题会带套卷号，学习记录按套卷分组';
  const oldCount = (p.items || []).length;
  const bodyHtml = `
    <div style="font-size:13.5px;line-height:1.8;color:var(--text)">
      <p style="margin:0 0 10px">转为「<b>${modeName}</b>」后：</p>
      <ul style="margin:0 0 12px;padding-left:20px">
        <li>${modeDesc}</li>
        <li>已有 <b>${oldCount}</b> 条错题会进入「📂 未归类」分组</li>
        <li>不会丢失任何数据，可之后逐条补${isPage ? '页码' : '套号'}</li>
        <li>原有复习规划（间隔、排期、容量）完全不变</li>
      </ul>
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 12px;margin-bottom:8px">
        <div style="color:#dc2626;font-weight:700;font-size:13px;margin-bottom:4px">⚠️ 此切换不可逆</div>
        <div style="color:#991b1b;font-size:12.5px;line-height:1.6">
          转换后<b>不能</b>从${isPage ? '习题册' : '套卷'}模式转回自由出处模式，也不能在习题册和套卷之间互转。请确认后再操作。
        </div>
      </div>
      <p style="margin:0;color:var(--muted);font-size:12.5px">旧条目的原始出处文本会保留在数据中，只是在新模式下不再显示，可随时补${isPage ? '页码' : '套号'}归类。</p>
    </div>`;
  showGenericConfirm(`转为${modeName}？`, bodyHtml, '我已知晓，确认切换', () => {
    p.mistakeMode = targetMode;
    p.updatedAt = Date.now();
    saveStore();
    closeSettings();
    render();
    showToast('✅', `已转为${modeName}`, `旧错题已进入「未归类」，可逐条补${isPage ? '页码' : '套号'}。`, 4000);
  });
}
$('#btnSwitchToPage').addEventListener('click', () => switchMistakeFormat('page'));
$('#btnSwitchToSet').addEventListener('click', () => switchMistakeFormat('set'));

// 错题本关联刷题本：下拉选择
$('#sRefProject').addEventListener('change', function() {
  const p = store.projects[editingProjectId];
  if (!p || p.type !== 'mistake') return;
  const refId = this.value;
  if (!refId) {
    // 解除关联
    p.refProjectId = null;
    p.updatedAt = Date.now();
    saveStore();
    $('#refProjectInfo').hidden = true;
    showToast('✅', '已解除关联', '单元结构保留，不再读取刷题本进度。', 3000);
    return;
  }
  const ref = store.projects[refId];
  if (!ref) return;
  if (structuresMatch(p, ref)) {
    p.refProjectId = refId;
    p.updatedAt = Date.now();
    saveStore();
    $('#refProjectInfo').hidden = false;
    $('#refProjectInfoText').textContent = '✅ 已关联「' + ref.name + '」，单元结构已对齐';
    showToast('✅', '已关联', '单元卡现在会显示刷题进度。', 3000);
  } else {
    // 结构不一致，二次确认
    const bodyHtml = `
      <div style="font-size:13.5px;line-height:1.8;color:var(--text)">
        <p style="margin:0 0 10px">错题本的单元结构与刷题本不一致。</p>
        <p style="margin:0 0 10px">关联后将：</p>
        <ul style="margin:0 0 12px;padding-left:20px">
          <li>错题本的单元结构将被刷题本替换</li>
          <li>已有错题按页码/套号重新归类到新单元</li>
          <li>归类不到的错题进入「未归类」，不会丢失任何数据</li>
          <li>此操作不可撤销</li>
        </ul>
      </div>`;
    showGenericConfirm('单元结构不一致', bodyHtml, '我已知晓，确认关联', () => {
      applyRefStructure(p, ref);
      saveStore();
      $('#refProjectInfo').hidden = false;
      $('#refProjectInfoText').textContent = '✅ 已关联「' + ref.name + '」并重新归类';
      renderUnitEditor(p.units || []);
      showToast('✅', '已关联并重新归类', '旧错题已按新结构归类，归类不到的进入「未归类」。', 4000);
    }, () => {
      // 用户取消：恢复下拉为原来的值
      this.value = p.refProjectId || '';
    });
  }
});

// 解除关联按钮
$('#btnUnlinkRef').addEventListener('click', () => {
  const p = store.projects[editingProjectId];
  if (!p) return;
  p.refProjectId = null;
  p.updatedAt = Date.now();
  saveStore();
  $('#refProjectInfo').hidden = true;
  $('#sRefProject').value = '';
  showToast('✅', '已解除关联', '单元结构保留，不再读取刷题本进度。', 3000);
});

// 从刷题本创建关联错题本
$('#btnCreateLinkedMistake').addEventListener('click', () => {
  const p = store.projects[editingProjectId];
  if (!p || p.type !== 'exercise') return;
  creatingLinkedFrom = p.id;
  closeSettings();
  openFormCreate();
  // 同步预填表单（不依赖定时器，避免与 openFormCreate 内部的 focus 定时器竞争）
  $('#fName').value = p.name + ' 错题本';
  // 锁定类型为错题本
  document.querySelectorAll('input[name="ptype"]').forEach(r => {
    r.checked = r.value === 'mistake';
    r.disabled = true;
  });
  // 自动设置 mistakeMode
  const mode = p.unit === 'set' ? 'set' : 'page';
  document.querySelectorAll('input[name="pmistakemode"]').forEach(r => {
    r.checked = r.value === mode;
  });
  // 套卷命名方式（必须在 syncFormUnit 之前设置，否则年份输入框不会显示）
  if (p.unit === 'set' && p.paperLabelMode) {
    const lr = document.querySelector(`input[name="ppaperlabel"][value="${p.paperLabelMode}"]`);
    if (lr) lr.checked = true;
    if (p.paperLabelMode === 'year' && p.paperYearStart) {
      $('#fPaperYear').value = p.paperYearStart;
    }
  }
  // 触发模式切换以显示正确的输入框
  syncFormUnit();
  // 自动关联当前刷题本并锁定
  const fLinkRef = $('#fLinkRef');
  if (fLinkRef) {
    fLinkRef.value = p.id;
    fLinkRef.disabled = true;
  }
  // 复制页码范围（page模式）
  if (p.unit !== 'set') {
    if (p.bookStartPage) $('#fBookStart').value = p.bookStartPage;
    if (p.bookEndPage) $('#fBookEnd').value = p.bookEndPage;
  }
  // 复制单元结构
  if (p.unitMode && Array.isArray(p.units) && p.units.length) {
    $('#fUnitMode').checked = true;
    $('#fUnitEditor').hidden = false;
    renderUnitEditor(p.units, $('#fUnitEditList'));
  }
  // 复制套卷结构（错题套卷只需要总套数和命名方式，不需要板块）
  if (p.unit === 'set') {
    $('#fTotal').value = p.total || '';
  }
  showToast('📝', '创建关联错题本', '名称、模式、单元结构已从刷题本复制，保存后自动关联。', 4000);
});

// 主页模式标签点击：弹出模式选择（事件委托，因为元素是动态生成的）
document.addEventListener('click', (e) => {
  const badge = e.target.closest('#mistakeModeBadge');
  if (!badge) return;
  const p = cur();
  if (!p || p.type !== 'mistake' || p.mistakeMode !== 'free') return;
  const bodyHtml = `
    <div style="font-size:13.5px;line-height:1.8;color:var(--text)">
      <p style="margin:0 0 12px">当前是<b>自由出处</b>模式，可切换为以下模式（单向不可逆）：</p>
      <div style="display:flex;gap:10px">
        <button type="button" class="ghost-btn" id="tagSwitchPage" style="flex:1">📄 习题册模式</button>
        <button type="button" class="ghost-btn" id="tagSwitchSet" style="flex:1">📑 套卷模式</button>
      </div>
      <p style="margin:12px 0 0;color:var(--muted);font-size:12.5px">切换后旧错题进入「未归类」，可逐条补录；原有复习规划不变。</p>
    </div>`;
  showGenericConfirm('切换错题本模式', bodyHtml, '取消', null);
  setTimeout(() => {
    const bp = $('#tagSwitchPage');
    const bs = $('#tagSwitchSet');
    if (bp) bp.addEventListener('click', () => { $('#genericConfirmMask').hidden = true; unlockBodyScroll(); switchMistakeFormat('page'); });
    if (bs) bs.addEventListener('click', () => { $('#genericConfirmMask').hidden = true; unlockBodyScroll(); switchMistakeFormat('set'); });
  }, 50);
});

/* 错题本功能引导 */
$('#mistakeGuideClose').addEventListener('click', () => {
  $('#mistakeGuideMask').hidden = true;
  unlockBodyScroll();
  store.mistakeGuided = true;
  saveStore();
});
$('#mistakeGuideOk').addEventListener('click', () => {
  $('#mistakeGuideMask').hidden = true;
  unlockBodyScroll();
  store.mistakeGuided = true;
  saveStore();
});
$('#btnShowMistakeGuide').addEventListener('click', () => {
  $('#mistakeGuideMask').hidden = false;
  modalTop($('#mistakeGuideMask'));
});

/* 复习区标题旁的模式快捷切换 */
$('#modeSwitchBtn').addEventListener('click', () => {
  const p = cur();
  if (!p || (p.type !== 'mistake' && p.type !== 'recite')) return;
  const newMode = (p.reviewMode || 'classic') === 'balanced' ? 'classic' : 'balanced';
  confirmModeSwitch(newMode);
});

/* 模式切换确认弹窗 */
let pendingModeSwitch = null;
function confirmModeSwitch(newMode) {
  const p = cur();
  if (!p) return;
  pendingModeSwitch = newMode;
  const isRecite = p.type === 'recite';
  const itemWord = isRecite ? '背诵内容' : '错题';
  const isBalanced = newMode === 'balanced';
  $('#modeSwitchConfirmTitle').textContent = '切换到' + (isBalanced ? '均匀分布' : '经典间隔') + '模式？';
  $('#modeSwitchConfirmDesc').innerHTML = '当前是<b>' + ((p.reviewMode || 'classic') === 'balanced' ? '均匀分布' : '经典间隔') + '</b>模式。<br>切换后所有未掌握的' + itemWord + '会立即按新模式重新排期，已掌握的不受影响。';
  const target = $('#modeSwitchConfirmTarget');
  if (isBalanced) {
    target.className = 'mode-help-card mode-balanced';
    target.innerHTML = '<div style="font-weight:700;margin-bottom:6px;color:#2e6b4f">⚖️ 均匀分布模式</div>' +
      '<div style="color:var(--muted);font-size:13px;line-height:1.7">自动把复习错峰到每天，避免某天突然要' + (isRecite ? '背' : '做') + '一大堆。<br><b>适合</b>：经常批量录入、希望每天复习量稳定。</div>';
  } else {
    target.className = 'mode-help-card mode-classic';
    target.innerHTML = '<div style="font-weight:700;margin-bottom:6px">📖 经典间隔模式</div>' +
      '<div style="color:var(--muted);font-size:13px;line-height:1.7">严格按间隔天数（1→2→4→7→15→30天）提醒复习。<br><b>适合</b>：量少、能跟上节奏、希望严格遵循记忆曲线。</div>';
  }
  $('#modeSwitchConfirmMask').hidden = false;
  modalTop($('#modeSwitchConfirmMask'));
}
$('#modeSwitchConfirmClose').addEventListener('click', () => { $('#modeSwitchConfirmMask').hidden = true; unlockBodyScroll(); pendingModeSwitch = null; });
$('#modeSwitchConfirmCancel').addEventListener('click', () => { $('#modeSwitchConfirmMask').hidden = true; unlockBodyScroll(); pendingModeSwitch = null; });
$('#modeSwitchConfirmOk').addEventListener('click', () => {
  const p = cur();
  if (!p || !pendingModeSwitch) return;
  const newMode = pendingModeSwitch;
  const isRecite = p.type === 'recite';
  p.reviewMode = newMode;
  p.updatedAt = Date.now();
  saveStore();
  $('#modeSwitchConfirmMask').hidden = true;
  unlockBodyScroll();
  pendingModeSwitch = null;
  // 切换后立即按新模式重新排期所有未攻克条目
  rebalanceAllItems(p);
  render();
  if (newMode === 'balanced') {
    showToast('⚖️', '已切换到均匀分布模式', '今天该复习的内容已保留，之后的复习会按每日容量自动错峰、均匀安排，新录入也会自动错峰。', 3800);
  } else {
    showToast('📖', '已切换到经典间隔模式', '今天该复习的内容已保留，之后严格按记忆间隔提醒，到期就复习。', 3500);
  }
});

function switchMistakeMode() {
  // 保留兼容，实际走 confirmModeSwitch
  const p = cur();
  if (!p || p.type !== 'mistake') return;
  const newMode = (p.reviewMode || 'classic') === 'balanced' ? 'classic' : 'balanced';
  confirmModeSwitch(newMode);
}

$('#sUnitMode').addEventListener('change', e => {
  const on = e.target.checked;
  $('#unitEditor').hidden = !on;
  $('#sScopeMode').disabled = on;
  const _h = $('#sScopeMutexHint');
  if (_h) _h.style.display = on ? '' : 'none';
  if (on) {
    if ($('#sScopeMode').checked) { $('#sScopeMode').checked = false; $('#sScopeEditor').hidden = true; }
    const usm = (document.querySelector('input[name="sUnitScopeMode"]:checked') || {}).value || 'all';
    if (usm !== 'book') { $('#sBookRangeRow').style.display = 'none'; $('#sBookRangeHint').style.display = 'none'; }
    else if (isPageScopeCapable(cur())) { $('#sBookRangeRow').style.display = ''; $('#sBookRangeHint').style.display = ''; }
  } else if (!$('#sScopeMode').checked && isPageScopeCapable(cur())) {
    $('#sBookRangeRow').style.display = ''; $('#sBookRangeHint').style.display = '';
  }
  markSettingsDirty();
});
document.querySelectorAll('input[name="sUnitScopeMode"]').forEach(r => r.addEventListener('change', e => {
  if (!$('#sUnitMode').checked) { markSettingsDirty(); return; }
  if (e.target.value !== 'book') { $('#sBookRangeRow').style.display = 'none'; $('#sBookRangeHint').style.display = 'none'; }
  else if (isPageScopeCapable(cur())) { $('#sBookRangeRow').style.display = ''; $('#sBookRangeHint').style.display = ''; }
  markSettingsDirty();
}));
// 跳着做：与单元模式互斥，开启时隐藏正文页码框
$('#sScopeMode').addEventListener('change', e => {
  const on = e.target.checked;
  $('#sScopeEditor').hidden = !on;
  $('#sUnitMode').disabled = on;
  if (on) {
    if ($('#sUnitMode').checked) { $('#sUnitMode').checked = false; $('#unitEditor').hidden = true; }
    $('#sBookRangeRow').style.display = 'none'; $('#sBookRangeHint').style.display = 'none';
    if (!$('#sScopeList').querySelectorAll('.scope-row').length) addScopeRow($('#sScopeList'), '', '');
  } else if (!$('#sUnitMode').checked && isPageScopeCapable(cur())) {
    $('#sBookRangeRow').style.display = ''; $('#sBookRangeHint').style.display = '';
  }
});
$('#btnAddSScope').addEventListener('click', () => addScopeRow($('#sScopeList'), '', ''));
$('#btnAddUnitRow').addEventListener('click', () => addUnitRow('', '', ''));
$('#unitEditList').addEventListener('click', e => handleUnitEditClick(e, $('#unitEditList')));
// 新建表单的单元编辑器
$('#fUnitEditList').addEventListener('click', e => handleUnitEditClick(e, $('#fUnitEditList')));

function handleUnitEditClick(e, listEl) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const row = btn.closest('.unit-edit-row');
  if (!row) return;
  const action = btn.dataset.action;
  const curLevel = parseInt(row.dataset.level || '0', 10);

  if (action === 'delete') {
    row.remove();
    return;
  }
  if (action === 'add-child') {
    if (curLevel >= 2) { showToast('⚠️', '已达最大层级', '最多支持3级嵌套（章→节→小节）', 1500); return; }
    const newRow = addUnitRowToList(listEl, '', '', '', curLevel + 1);
    // 找到当前单元后面所有连续的子单元，把新子单元追加到最后一个子单元后面（而非紧挨着父单元）
    let insertAfter = row;
    let next = row.nextElementSibling;
    while (next) {
      const nextLevel = parseInt(next.dataset.level || '0', 10);
      if (nextLevel > curLevel) { insertAfter = next; next = next.nextElementSibling; }
      else break;
    }
    insertAfter.after(newRow);
  } else if (action === 'indent-right') {
    if (curLevel >= 2) { showToast('⚠️', '已达最大层级', '最多支持3级嵌套（章→节→小节）', 1500); return; }
    const prev = row.previousElementSibling;
    if (!prev) { showToast('⚠️', '无法降级', '第一个单元不能降级为子单元', 1500); return; }
    const prevLevel = parseInt(prev.dataset.level || '0', 10);
    if (curLevel >= prevLevel + 1) { showToast('⚠️', '无法降级', '只能比上一个单元深一级', 1500); return; }
    row.dataset.level = curLevel + 1;
    row.querySelector('.unit-edit-main').style.paddingLeft = (curLevel + 1) * 24 + 'px';
    const treeLine = row.querySelector('.unit-tree-line');
    if (treeLine) treeLine.style.display = '';
    // 层级变化后重新渲染按钮（添加子单元/降级按钮可能需要隐藏）
    const unitName = row.querySelector('[data-role="uname"]').value;
    const us = row.querySelector('[data-role="ustart"]').value;
    const ue = row.querySelector('[data-role="uend"]').value;
    const newRow = addUnitRowToList(listEl, unitName, us, ue, curLevel + 1);
    row.replaceWith(newRow);
  } else if (action === 'indent-left') {
    if (curLevel <= 0) { showToast('⚠️', '无法升级', '已经是最顶级单元', 1500); return; }
    row.dataset.level = curLevel - 1;
    row.querySelector('.unit-edit-main').style.paddingLeft = (curLevel - 1) * 24 + 'px';
    if (curLevel - 1 <= 0) {
      const treeLine = row.querySelector('.unit-tree-line');
      if (treeLine) treeLine.style.display = 'none';
    }
    // 层级变化后重新渲染按钮
    const unitName = row.querySelector('[data-role="uname"]').value;
    const us = row.querySelector('[data-role="ustart"]').value;
    const ue = row.querySelector('[data-role="uend"]').value;
    const newRow = addUnitRowToList(listEl, unitName, us, ue, curLevel - 1);
    row.replaceWith(newRow);
  }
}
// 单元模板
$('#sUnitTpl').addEventListener('change', e => { if (e.target.value) { applyUnitTpl(e.target.value, $('#unitEditList')); e.target.value = ''; } });
$('#btnSaveUnitTpl').addEventListener('click', () => { const p = cur(); saveUnitTplFromEditor(p ? p.name : ''); });
$('#btnManageUnitTpl').addEventListener('click', () => openTplManager('unit'));
// 套卷模板
$('#btnSavePaperTpl').addEventListener('click', () => { const p = cur(); savePaperTplFromEditor(p ? p.name : ''); });
$('#btnManagePaperTpl').addEventListener('click', () => openTplManager('paper'));
// 模板管理弹窗
$('#tplManagerClose').addEventListener('click', () => { $('#tplManagerMask').hidden = true; unlockBodyScroll(); });
$('#tplManagerDone').addEventListener('click', () => { $('#tplManagerMask').hidden = true; unlockBodyScroll(); });

$('#btnExport').addEventListener('click', exportData);
$('#btnImport').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', e => {
  const f = e.target.files && e.target.files[0];
  if (f) importData(f);
  e.target.value = '';
});

/* 彻底清除全部数据：localStorage + IndexedDB + Cache 三层全清，二次确认后 reload */
$('#btnWipeAll').addEventListener('click', async () => {
  if (!confirm('彻底清除全部数据？\n\n会删除所有项目、记录、设置，不可恢复。\n建议先「导出备份」。\n\n确定继续吗？')) return;
  if (!confirm('再次确认：真的要清空全部数据并重启页面吗？此操作不可逆。')) return;
  try { Object.keys(localStorage).forEach(k => localStorage.removeItem(k)); } catch (e) {}
  try {
    const dbs = await indexedDB.databases();
    for (const d of dbs) {
      await new Promise(res => {
        const req = indexedDB.deleteDatabase(d.name);
        req.onsuccess = req.onerror = req.onblocked = () => res();
      });
    }
  } catch (e) {}
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      for (const k of keys) await caches.delete(k);
    }
  } catch (e) {}
  location.reload();
});

function submitSettings() {
  const p = store.projects[editingProjectId];
  if (!p) return;

  const name = ($('#sName').value || '').trim();
  const total = parseInt($('#sTotal').value, 10);
  const deadline = $('#sDeadline').value;
  const startDate = $('#sStartDate').value;
  const startPage = parseInt($('#sStartPage').value, 10) || 0;
  const bookStartRaw = $('#sBookStart').value.trim();
  const bookEndRaw = $('#sBookEnd').value.trim();
  const bookStart = bookStartRaw ? parseInt(bookStartRaw, 10) : 1;
  const bookEnd = bookEndRaw ? parseInt(bookEndRaw, 10) : NaN;
  const setMode = isSetMode(p);
  const usePageRange = !setMode && (p.type !== 'mistake' || isMistakePageMode(p));
  const isMistakeSet = isMistakeSetMode(p);
  // 提前读取"只做部分页"
  const scopeMode = isPageScopeCapable(p) ? !!$('#sScopeMode').checked : false;
  let targetRanges = scopeMode ? readScopeRows($('#sScopeList')) : [];
  const scopePageCount = countRanges(targetRanges);
  // 单元模式 + 只统计单元页码时，不需要正文结束页
  const sUnitModeEarly = !!$('#sUnitMode').checked;
  const sUnitScopeMode = (document.querySelector('input[name="sUnitScopeMode"]:checked') || {}).value || 'all';
  const needBookEnd = usePageRange && !scopeMode && !(sUnitModeEarly && sUnitScopeMode !== 'book');

  if (!name) return alert('请填写任务名称～');
  if ((setMode || isMistakeSet) && (!total || total < 1)) return alert('请填写有效的总套数～');
  if (needBookEnd && (isNaN(bookEnd) || bookEnd < 1)) return alert('请填写正文结束页（资料的最后一页）；起始页可不填，默认第 1 页～');
  if (needBookEnd && bookStart > bookEnd) return alert('起始页不能大于结束页～');
  if (scopeMode && !scopePageCount) return alert('请至少填写一个要做的页码区间（只填“起”=单页）～');
  if (!deadline) return alert('请选择计划完成日期～');
  if (startDate && diffDays(startDate, deadline) < 0) return alert('开始日期不能晚于截止日期～');

  // 练习册/背书/错题本习题册模式：总页数自动计算
  let effectiveTotal = usePageRange ? (scopeMode ? scopePageCount : bookEnd - bookStart + 1) : total;

  const unitMode = $('#sUnitMode').checked;
  let units = [];
  if (unitMode) {
    units = readUnitRowsFromList($('#unitEditList'));
    if (!units.length) return alert('请至少添加一个单元～');
    const minPage = (usePageRange && sUnitScopeMode === 'book') ? bookStart : 1;
    const maxPage = (usePageRange && sUnitScopeMode === 'book') ? bookEnd : Infinity;
    let minStart = Infinity, maxEnd = -Infinity;
    // 校验：每个单元（含子单元）必须有名称和完整页码；边界只检查最小起始页和最大结束页
    function validateUnit(u) {
      if (!u.name) return '请填写单元名称～';
      if (u.startPage == null || u.endPage == null) return `单元「${u.name}」的页码不完整～`;
      if (u.startPage > u.endPage) return `单元「${u.name}」起始页不能大于结束页～`;
      minStart = Math.min(minStart, u.startPage);
      maxEnd = Math.max(maxEnd, u.endPage);
      for (const c of (u.children || [])) {
        const err = validateUnit(c);
        if (err) return err;
      }
      return null;
    }
    for (const u of units) {
      const err = validateUnit(u);
      if (err) return alert(err);
    }
    if (minStart < minPage) return alert(`单元起始页最小为第 ${minStart} 页，超出正文范围（正文从第 ${minPage} 页开始）～`);
    if (maxEnd > maxPage) return alert(`单元结束页最大为第 ${maxEnd} 页，超出正文范围（正文到第 ${maxPage} 页结束）～`);
    // 单元模式 + 只统计单元页码：总页数用单元范围并集
    if (sUnitScopeMode !== 'book') {
      const allRanges = [];
      function collectUnitRange(u) {
        const hasChildren = u.children && u.children.length;
        if (sUnitScopeMode === 'all' || !hasChildren) {
          if (u.startPage != null && u.endPage != null && u.endPage >= u.startPage) allRanges.push({start:u.startPage, end:u.endPage});
        }
        (u.children || []).forEach(collectUnitRange);
      }
      units.forEach(collectUnitRange);
      effectiveTotal = countRanges(mergeRanges(allRanges));
    }
  }

  let intervals = p.intervals || [...DEFAULT_INTERVALS];
  if (p.type !== 'exercise') {
    const str = $('#sIntervals').value.trim();
    const arr = str.split(/[,，\s]+/).map(s => parseInt(s, 10)).filter(n => !isNaN(n) && n > 0);
    if (!arr.length) return alert('请至少填写一个复习间隔～');
    intervals = arr;
  }

  p.name = name;
  // 错题本习题册/自由出处总量动态（已收录条数），不手动设置；错题本套卷和刷题本设置总套数
  if (p.type !== 'mistake' || isMistakeSet) p.total = effectiveTotal;
  p.deadline = deadline;
  p.startDate = startDate || '';
  p.startPage = startPage;
  p.bookStartPage = usePageRange ? (bookStart > 1 ? bookStart : null) : null;
  p.bookEndPage = usePageRange ? bookEnd : null;
  // 单元模式：刷题习题册 + 背书 + 错题本习题册模式
  const canUseUnits = (p.type === 'exercise' && !setMode) || p.type === 'recite' || isMistakePageMode(p);
  p.unitMode = (canUseUnits && unitMode && !scopeMode) ? unitMode : false; // 跳页与单元互斥
  p.units = p.unitMode ? units : [];
  p.unitScopeMode = p.unitMode ? sUnitScopeMode : 'book';
  if ('unitScopeOnly' in p) delete p.unitScopeOnly;
  const canScope = isPageScopeCapable(p);
  p.scopeMode = (canScope && scopeMode && !p.unitMode) ? scopeMode : false;
  p.targetRanges = p.scopeMode ? targetRanges : [];
  p.intervals = intervals;

  // 复习模式（仅错题本）
  let needRebalance = false;
  if (p.type === 'mistake') {
    const oldMode = p.reviewMode || 'classic';
    const newMode = (document.querySelector('input[name="reviewMode"]:checked') || {}).value || 'classic';
    p.reviewMode = newMode;
    // 容量设置
    if (newMode === 'balanced' && $('#sCapacityMode').value === 'fixed') {
      const cap = parseInt($('#sCapacityFixed').value, 10);
      p.dailyCapacity = isNaN(cap) ? null : Math.max(0, Math.min(50, cap));
    } else {
      p.dailyCapacity = null; // 智能模式
    }
    // 模式变化时需要重新排期
    needRebalance = oldMode !== newMode;
  }

  // 分散阈值（背书+错题）
  if (p.type !== 'exercise') {
    const th = parseInt($('#sSpreadThreshold').value, 10);
    p.spreadThreshold = isNaN(th) || th < 1 ? defaultComfortCap(p) : Math.min(50, th);
  }

  if (isSetMode(p) || isMistakeSetMode(p)) {
    if (isSetMode(p)) p.paperSections = readPaperSecRows($('#sPaperSecList'));
    p.paperLabelMode = (document.querySelector('input[name="spaperlabel"]:checked') || {}).value || 'index';
    if (p.paperLabelMode === 'year') {
      const y = parseInt($('#sPaperYear').value, 10);
      if (isNaN(y)) return alert('请填写套卷起始年份（如 2005），或改回「第 N 套」命名～');
      p.paperYearStart = y;
    } else {
      p.paperYearStart = null;
    }
  }
  p.updatedAt = Date.now();

  saveStore();
  // 保存成功：重置未保存状态，再关闭
  settingsInitialSnapshot = captureSettingsSnapshot();
  $('#settingsDirtyBar').hidden = true;
  doCloseSettings();

  if (needRebalance) {
    // 模式变化时直接按新模式重新排期
    rebalanceAllItems(p);
    render();
    showToast('🔄', '已按新模式重新排期', '今天该复习的内容已保留，其余未攻克条目按新复习模式调整日期。', 3200);
  } else {
    render();
  }
}
$('#settingsSave').addEventListener('click', submitSettings);

// 设置页：回车自动跳到下一个输入框，最后一个回车保存（统一导航，见 setupEnterNav）

/* 清理指向已删除项目的 refProjectId */
function clearRefsTo(deletedId) {
  Object.values(store.projects).forEach(other => {
    if (other.refProjectId === deletedId) other.refProjectId = null;
  });
}

/* 比对两个项目的单元/套卷结构是否一致 */
function structuresMatch(p, ref) {
  if (p.mistakeMode === 'set' || ref.unit === 'set') {
    // 错题套卷：不存板块、不关心套数，只校验命名方式一致（避免"第3套"和"2007年"混用）
    if (p.mistakeMode === 'set') {
      if (p.paperLabelMode !== ref.paperLabelMode) return false;
      if (p.paperLabelMode === 'year' && p.paperYearStart !== ref.paperYearStart) return false;
      return true;
    }
    // 刷题套卷：比对板块、总套数、命名方式
    const a = p.paperSections || [], b = ref.paperSections || [];
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i].name !== b[i].name || a[i].weight !== b[i].weight) return false;
    }
    if (p.total !== ref.total) return false;
    if (p.paperLabelMode !== ref.paperLabelMode) return false;
    return true;
  }
  // 页码模式：比对正文范围 + 递归比对 units
  if (p.bookStartPage !== ref.bookStartPage) return false;
  if (p.bookEndPage !== ref.bookEndPage) return false;
  function cmpUnits(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i].name !== b[i].name || a[i].startPage !== b[i].startPage || a[i].endPage !== b[i].endPage) return false;
      if (!cmpUnits(a[i].children, b[i].children)) return false;
    }
    return true;
  }
  return cmpUnits(p.units || [], ref.units || []);
}

/* 用刷题本的结构覆盖错题本，并重新归类错题 */
function applyRefStructure(p, ref) {
  if (ref.unit === 'set') {
    p.paperSections = JSON.parse(JSON.stringify(ref.paperSections || []));
    p.total = ref.total;
    p.paperLabelMode = ref.paperLabelMode;
    p.paperYearStart = ref.paperYearStart;
    // 套卷模式：setNo 超出范围的进入"未归类"（渲染时动态判断，不改数据）
  } else {
    p.units = JSON.parse(JSON.stringify(ref.units || []));
    p.bookStartPage = ref.bookStartPage;
    p.bookEndPage = ref.bookEndPage;
    p.unitMode = !!ref.unitMode;
    // 页码模式：错题按页码自动归类到单元（渲染时动态判断，不改数据）
  }
  p.refProjectId = ref.id;
  p.updatedAt = Date.now();
}

$('#btnReset').addEventListener('click', () => {
  const p = store.projects[editingProjectId];
  if (!p) return;
  if (!confirm(`确定要删除任务「${p.name}」吗？\n任务及其全部打卡/复习记录都会被移除（删除后 5 秒内可撤销）。`)) return;
  const removedProject = p;
  const wasCurrent = store.currentId === p.id;
  // 快照所有指向该项目的 refProjectId，删除时清空、撤销时写回，避免关联丢失
  const refsToRestore = [];
  Object.values(store.projects).forEach(other => {
    if (other.refProjectId === p.id) refsToRestore.push(other.id);
  });
  delete store.projects[p.id];
  store.tombstones[p.id] = Date.now();
  clearRefsTo(p.id);
  delete ppExpandedSet[p.id]; // 清理进度看板的展开状态缓存
  const ids = Object.keys(store.projects);
  store.currentId = ids.length ? ids[0] : null;
  saveStore();
  closeSettings();
  resetEntryInputs();
  render();
  showUndo(`已删除任务「${removedProject.name}」`, () => {
    store.projects[removedProject.id] = removedProject;
    delete store.tombstones[removedProject.id];
    refsToRestore.forEach(oid => { if (store.projects[oid]) store.projects[oid].refProjectId = removedProject.id; });
    if (wasCurrent) store.currentId = removedProject.id;
    saveStore();
    render();
  });
});

// 修复：在弹窗内拖拽选择文字时鼠标移出弹窗松开，会误触发遮罩层click导致弹窗关闭
let _mouseDownInModal = false;
document.addEventListener('mousedown', e => { _mouseDownInModal = !!e.target.closest('.modal'); }, true);

$('#switchMask').addEventListener('click', e => { if (e.target === $('#switchMask') && !_mouseDownInModal) closeSwitch(); });
$('#formMask').addEventListener('click', e => { if (e.target === $('#formMask') && !_mouseDownInModal) closeForm(); });
$('#settingsMask').addEventListener('click', e => { if (e.target === $('#settingsMask') && !_mouseDownInModal) closeSettings(); });

$('#projectList').addEventListener('click', e => {
  const delBtn = e.target.closest('.pi-del');
  if (delBtn) {
    e.stopPropagation();
    const id = delBtn.dataset.del;
    const p = store.projects[id];
    if (!p) return;
        if (confirm(`确定要删除「${p.name}」吗？\n该任务的全部记录都会被移除（删除后 5 秒内可撤销）。`)) {
      const removedProject = store.projects[id];
      const wasCurrent = store.currentId === id;
      // 快照所有指向该项目的 refProjectId，删除时清空、撤销时写回
      const refsToRestore = [];
      Object.values(store.projects).forEach(other => {
        if (other.refProjectId === id) refsToRestore.push(other.id);
      });
      delete store.projects[id];
      store.tombstones[id] = Date.now();
      clearRefsTo(id);
      delete ppExpandedSet[id]; // 清理进度看板的展开状态缓存
      if (wasCurrent) {
        const rest = Object.keys(store.projects);
        store.currentId = rest.length ? rest[0] : null;
      }
      saveStore();
      closeSwitch();
      resetEntryInputs();
      render();
      showUndo(`已删除任务「${removedProject.name}」`, () => {
        store.projects[id] = removedProject;
        delete store.tombstones[id];
        refsToRestore.forEach(oid => { if (store.projects[oid]) store.projects[oid].refProjectId = id; });
        if (wasCurrent) store.currentId = id;
        saveStore();
        render();
      });
    }
    return;
  }
  const item = e.target.closest('.project-item');
  if (!item) return;
  const id = item.dataset.id;
  if (store.projects[id]) {
    store.currentId = id;
    saveStore();
    closeSwitch();
    resetEntryInputs();
    render();
  }
});

/* 页码录入：顺序 / 区间切换 */
let pageRangeMode = false;
function applyPageModeUI() {
  const lead = $('#piLead'), st = $('#inPageStart'), dash = $('#piDash'),
        end = $('#inPageEnd'), tg = $('#btnToggleRange');
  if (!lead || !st) return;
  let lastEnd = 0;
  const p = cur();
  if (p && p.type === 'exercise' && !isSetMode(p)) {
    (p.records || []).forEach(r => {
      if (r.endPage != null && r.endPage > lastEnd) lastEnd = r.endPage;
    });
  }
  if (pageRangeMode) {
    lead.textContent = '第'; st.hidden = false; dash.hidden = false;
    end.placeholder = '结束页'; tg.textContent = '回到顺序录入';
  } else {
    lead.textContent = '学到第'; st.hidden = true; st.value = ''; dash.hidden = true;
    end.placeholder = lastEnd > 0 ? `上次 ${lastEnd}，本次到` : '页码';
    tg.textContent = '按区间录入（跳着学）';
  }
}
$('#btnToggleRange').addEventListener('click', () => { pageRangeMode = !pageRangeMode; applyPageModeUI(); });

// 日期快捷按钮：一键切到"今天/昨天"
document.querySelectorAll('[data-set-date]').forEach(btn => {
  btn.addEventListener('click', () => {
    const wrap = btn.closest('.date-quick');
    const target = wrap ? wrap.previousElementSibling : null;
    if (!target || target.tagName !== 'INPUT' || target.type !== 'date') return;
    target.value = btn.dataset.setDate === 'today' ? todayStr() : addDays(todayStr(), -1);
  });
});

/* 连续录入：保留输入框的值并以警告色标记为"沿用上次"；值为空则取消标记。
   用户一旦手动改动该框（见下方 input 监听），标记立即消失、颜色恢复正常。 */
function retainEntryValue(el) {
  if (!el) return;
  if (el.value) el.classList.add('page-retained');
  else el.classList.remove('page-retained');
}
['recitePageStart', 'recitePageEnd', 'reciteSetNo'].forEach(id => {
  const el = $(`#${id}`);
  if (el) el.addEventListener('input', () => el.classList.remove('page-retained'));
});

function resetEntryInputs() {
  const t = todayStr();
  pageRangeMode = false; applyPageModeUI();
  ['inPageStart', 'inPageEnd'].forEach(id => { const el = $(`#${id}`); if (el) el.value = ''; });
  if ($('#inDate')) $('#inDate').value = t;
  ['inSetNo', 'inSetDone', 'inSetTotalQ'].forEach(id => { const el = $(`#${id}`); if (el) el.value = ''; });
  setSelectedSecIds = [];
  setSecPct = {};
  if ($('#inSetScopePanel')) $('#inSetScopePanel').hidden = true;
  if ($('#setScopePctList')) { $('#setScopePctList').hidden = true; $('#setScopePctList').innerHTML = ''; }
  if ($('#inSetDate')) $('#inSetDate').value = t;
  ['reciteContent', 'reciteNote', 'reciteSource', 'recitePageStart', 'recitePageEnd', 'reciteSetNo'].forEach(id => { const el = $(`#${id}`); if (el) { el.value = ''; el.classList.remove('page-retained'); } });
  if ($('#reciteDate')) $('#reciteDate').value = t;
  reciteQuality = null;
  document.querySelectorAll('.rec-qbtn.active').forEach(b => b.classList.remove('active'));
  if ($('#reciteErrTagSel')) $('#reciteErrTagSel').value = '';
  if ($('#reasonDDList')) {
    const pp = cur();
    renderReasonDropdown(pp || { customErrorReasons: [], items: [], hiddenReasons: [], reasonOrder: [] });
  }
  if (cur()) updateRecitePreview();
}

/* 套卷打卡表单联动：多选板块 */
let setSelectedSecIds = [];   // 空数组 = 整套
let setSecPct = {};           // { secId: '百分比字符串' }

function syncSetFormUI(p) {
  const secs = getPaperSections(p);
  const hasSec = secs.length > 0;
  $('#setScopeSec').hidden = !hasSec;
  $('#setScopeLegacy').hidden = hasSec;
  $('#inSetLabelHint').textContent = (p.paperLabelMode === 'year' && p.paperYearStart)
    ? `（按年份：第 1 套=${paperLabel(p, 1)}，依次递增，共 ${p.total} 套到 ${paperLabel(p, p.total)}）`
    : `（共 ${p.total} 套 · ${paperLabel(p, 1)}～${paperLabel(p, p.total)}）`;
  if (hasSec) {
    const validIds = new Set(secs.map(s => s.id));
    setSelectedSecIds = setSelectedSecIds.filter(id => validIds.has(id));
    renderSetScopeMulti(p);
    renderSetScopePctList(p);
  }
}

function renderSetScopeMulti(p) {
  const secs = getPaperSections(p);
  const list = $('#inSetScopeList');
  const btn = $('#inSetScopeBtn');
  if (!list || !btn) return;
  list.innerHTML = secs.map(s => {
    const on = setSelectedSecIds.includes(s.id);
    return `<div class="sec-multi-row${on ? ' sel' : ''}" data-sid="${esc(s.id)}">
      <span class="ck">${on ? '✓' : ''}</span>
      <span class="nm">${esc(s.name)}</span>
      <span class="w">权重${s.weight ?? 0}%</span>
    </div>`;
  }).join('');
  if (setSelectedSecIds.length) {
    btn.innerHTML = setSelectedSecIds.map(id => {
      const s = secs.find(x => x.id === id);
      return s ? reasonPill(s.name) : '';
    }).join('');
  } else {
    btn.innerHTML = '<span class="muted">整套（全部板块）</span>';
  }
}

function renderSetScopePctList(p) {
  const secs = getPaperSections(p);
  const box = $('#setScopePctList');
  if (!box) return;
  if (!setSelectedSecIds.length) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  box.hidden = false;
  const rows = setSelectedSecIds.map(id => {
    const s = secs.find(x => x.id === id);
    if (!s) return '';
    const raw = setSecPct[s.id];
    const v = (raw != null && raw !== '') ? raw : 100;
    const vNum = parseInt(v, 10);
    const chips = [25, 50, 75, 100].map(n =>
      `<button type="button" class="pct-chip ssp-chip${vNum === n ? ' active' : ''}" data-pct="${n}" data-sid="${esc(s.id)}">${n}%</button>`
    ).join('');
    return `<div class="ssp-row" data-sid="${esc(s.id)}">
      <span class="ssp-name">${esc(s.name)}</span>
      <span class="ssp-pct">
        <input type="number" class="ssp-input" min="1" max="100" value="${v}" data-sid="${esc(s.id)}"><span>%</span>
      </span>
      <span class="pct-chips">${chips}</span>
    </div>`;
  }).join('');
  box.innerHTML = `<div class="ssp-head">分别填写本次各板块完成度（默认 100%）</div>${rows}`;
}

/* 多选下拉交互 */
$('#inSetScopeBtn').addEventListener('click', () => {
  const panel = $('#inSetScopePanel');
  panel.hidden = !panel.hidden;
});
$('#inSetScopeList').addEventListener('click', e => {
  const row = e.target.closest('.sec-multi-row');
  if (!row) return;
  const sid = row.dataset.sid;
  const i = setSelectedSecIds.indexOf(sid);
  if (i >= 0) setSelectedSecIds.splice(i, 1); else setSelectedSecIds.push(sid);
  const p = cur();
  if (!p) return;
  const order = getPaperSections(p).map(s => s.id);
  setSelectedSecIds.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  renderSetScopeMulti(p);
  renderSetScopePctList(p);
});
$('#inSetScopeAll').addEventListener('click', () => {
  const p = cur(); if (!p) return;
  setSelectedSecIds = getPaperSections(p).map(s => s.id);
  renderSetScopeMulti(p);
  renderSetScopePctList(p);
});
$('#inSetScopeNone').addEventListener('click', () => {
  const p = cur(); if (!p) return;
  setSelectedSecIds = [];
  setSecPct = {};
  renderSetScopeMulti(p);
  renderSetScopePctList(p);
});
$('#setScopePctList').addEventListener('input', e => {
  const inp = e.target.closest('.ssp-input');
  if (!inp) return;
  const sid = inp.dataset.sid;
  setSecPct[sid] = inp.value;
  const v = parseInt(inp.value, 10);
  const row = inp.closest('.ssp-row');
  row.querySelectorAll('.ssp-chip').forEach(c =>
    c.classList.toggle('active', parseInt(c.dataset.pct, 10) === v));
});
$('#setScopePctList').addEventListener('click', e => {
  const chip = e.target.closest('.ssp-chip');
  if (!chip) return;
  const sid = chip.dataset.sid;
  const row = chip.closest('.ssp-row');
  const inp = row.querySelector('.ssp-input');
  if (inp) inp.value = chip.dataset.pct;
  setSecPct[sid] = chip.dataset.pct;
  row.querySelectorAll('.ssp-chip').forEach(c => c.classList.toggle('active', c === chip));
});

/* 套卷打卡 */
$('#btnSetCheckin').addEventListener('click', () => {
  const p = cur();
  if (!p || !isSetMode(p)) return;
  const date = $('#inSetDate').value || todayStr();
  const setNo = parseInt($('#inSetNo').value, 10);
  if (isNaN(setNo) || setNo < 1) return alert('请输入第几套（套号）～');
  if (setNo > p.total) {
    return alert(`第 ${setNo} 套超过了总套数 ${p.total} 套，不予记录。\n\n请先在「设置 → 总套数」里修改，或记录第 1 ~ ${p.total} 套之间的套号～`);
  }
  if (!Array.isArray(p.records)) p.records = [];

  const secs = getPaperSections(p);
  if (secs.length) {
    if (!setSelectedSecIds.length) {
      // 整套打卡：若该套今天已有分板块记录，静默删除会丢失分板块进度，先确认
      const hasSecRec = p.records.some(r => r.set === setNo && r.date === date && r.secId != null);
      if (hasSecRec && !confirm('这套今天已经分板块记录过了。\n按「整套」打卡会清除这些分板块进度，确定吗？')) return;
      p.records = p.records.filter(r => !(r.set === setNo && r.date === date));
      p.records.push({ date, set: setNo, all: true, rid: genId() });
    } else {
      const entries = [];
      for (const sid of setSelectedSecIds) {
        const s = secs.find(x => x.id === sid);
        if (!s) continue;
        const raw = setSecPct[sid];
        const pct = (raw != null && raw !== '') ? parseInt(raw, 10) : 100;
        if (isNaN(pct) || pct < 1 || pct > 100) {
          return alert(`「${s.name}」的完成百分比需在 1-100 之间～`);
        }
        entries.push({ sid, pct });
      }
      // 累加语义：每个被选中的板块各生成一条记录，由 getSetState 封顶 100%
      // 检查累加后是否会超过 100%，超出时弹窗提示
      const stBefore = getSetState(p)[setNo] || { secs: {} };
      const overs = [];
      entries.forEach(en => {
        const s = secs.find(x => x.id === en.sid);
        const existing = (stBefore.secs && stBefore.secs[en.sid]) || 0;
        const total = existing + en.pct;
        if (total > 100) {
          overs.push({ name: s.name, existing: Math.round(existing), pct: en.pct, total: Math.round(total) });
        }
      });
      if (overs.length) {
        // 超 100% 不阻断保存，用 toast 非阻断提示 + 自动封顶（getSetState 已 cap 100%）
        window.__lastSetCapWarn = overs.map(o => o.name).join('、');
      }
      entries.forEach(en => {
        p.records.push({ date, set: setNo, secId: en.sid, pct: en.pct, rid: genId() });
      });
    }
    setSelectedSecIds = [];
    setSecPct = {};
    $('#inSetScopePanel').hidden = true;
    renderSetScopeMulti(p);
    renderSetScopePctList(p);
  } else {
    const doneRaw = $('#inSetDone').value.trim();
    const qRaw = $('#inSetTotalQ').value.trim();
    let done = null, q = null;
    if (doneRaw !== '' || qRaw !== '') {
      done = parseInt(doneRaw, 10); q = parseInt(qRaw, 10);
      if (isNaN(done) || isNaN(q) || done < 0 || q < 1) return alert('请正确填写「做了几题 / 共几题」，或都留空表示整套完成～');
      if (done > q) return alert('做了的题数不能多于这套的总题数～');
    }
    const idx = p.records.findIndex(r => r.date === date && r.set === setNo);
    const rec = { date, set: setNo, rid: genId() };
    if (done != null) { rec.done = done; rec.q = q; } else { rec.all = true; }
    if (idx >= 0) p.records[idx] = rec; else p.records.push(rec);
  }

  p.updatedAt = Date.now();
  saveStore();
  if (window.__lastSetCapWarn) {
    showToast('⚠️', '部分板块已达100%封顶', window.__lastSetCapWarn);
    window.__lastSetCapWarn = null;
  } else {
    showToast('✅', '已记录', `第 ${setNo} 套`);
  }
  $('#inSetDone').value = '';
  $('#inSetTotalQ').value = '';
  render();
  maybeShowProgressPraise(p);
});
// 套卷打卡：回车在 日期→套号→完成题数→总题数 间跳转，最后一个回车记录（统一导航接管）

/* 刷题打卡（按页） */
$('#btnCheckin').addEventListener('click', () => {
  const p = cur();
  if (!p || p.type !== 'exercise' || isSetMode(p)) return;

  const date = $('#inDate').value || todayStr();
  const startStr = $('#inPageStart').value.trim();
  const endStr = $('#inPageEnd').value.trim();
  const startRaw = startStr !== '' ? parseInt(startStr, 10) : NaN;
  const endRaw = endStr !== '' ? parseInt(endStr, 10) : NaN;
  const hasStart = !isNaN(startRaw);
  const hasEnd = !isNaN(endRaw);
  clearAllFieldErrors();

  let startPage = null, endPage = null;
  if (pageRangeMode) {
    // 区间模式：起始页–结束页，与其它页码输入统一——只填一个=单页，两个都填=范围，都不填才提示
    if (!hasStart && !hasEnd) { setFieldError($('#inPageEnd'), '请填写页码（单页填一个，范围填起止两个）'); $('#inPageEnd').focus(); return; }
    if (hasStart && startRaw < 0) { setFieldError($('#inPageStart'), '起始页不能小于 0'); $('#inPageStart').focus(); return; }
    if (hasEnd && endRaw < 0) { setFieldError($('#inPageEnd'), '结束页不能小于 0'); $('#inPageEnd').focus(); return; }
    startPage = hasStart ? startRaw : endRaw;
    endPage = hasEnd ? endRaw : startRaw;
    if (endPage < startPage) { setFieldError($('#inPageEnd'), '结束页不能小于起始页'); $('#inPageEnd').focus(); return; }
  } else {
    // 顺序模式：只填「学到第几页」
    if (!hasEnd || endRaw < 0) { setFieldError($('#inPageEnd'), '请输入「学到第几页」的页码'); $('#inPageEnd').focus(); return; }
    endPage = endRaw;
  }
  const effectiveTotal = (p.bookEndPage != null) ? p.bookEndPage : p.total;
  if (endPage > effectiveTotal) {
    if (!confirm(`你填的第 ${endPage} 页超过了${p.bookEndPage != null ? '正文结束页' : '总页数'} ${effectiveTotal} 页，确定要记录吗？`)) return;
  }
  if (p.bookStartPage != null && endPage < p.bookStartPage && startPage == null) {
    if (!confirm(`你填的第 ${endPage} 页在正文起始页 ${p.bookStartPage} 之前（可能是目录/前言），确定要记录吗？`)) return;
  }
  if (!Array.isArray(p.records)) p.records = [];
  // 顺序录入"学到第N页"隐含从正文开头连续完成到N页。若用户此前用区间跳着学、中间留有空洞，
  // 这次会把跳过的空洞也计入完成。这里只在确实存在"被夹在中间的跳过页"时做事后轻提示（不阻断、不弹确认），
  // 既防呆又不打扰正常连续学习的用户。
  let gapFilled = 0;
  if (startPage == null) {
    try {
      const _done = mergeRanges(getBookDoneRanges(p)).filter(r => r.start <= endPage);
      const _tgt = getTargetPageRanges(p);
      const _bStart = (p.bookStartPage != null) ? p.bookStartPage : (_tgt.length ? _tgt[0].start : 1);
      for (let i = 0; i < _done.length - 1; i++) {
        const gs = _done[i].end + 1;
        const ge = Math.min(_done[i + 1].start - 1, endPage);
        if (ge >= gs && _done[i].start >= _bStart) gapFilled += ge - gs + 1;
      }
    } catch (e) { gapFilled = 0; }
  }
  if (startPage == null) {
    const cp = p.records.find(r => r.date === date && r.startPage == null);
    // 顺序打卡回退：新 endPage < 旧 endPage 会回退进度，先确认
    if (cp && cp.endPage != null && endPage < cp.endPage) {
      if (!confirm(`今天已经学到第 ${cp.endPage} 页，现在改成第 ${endPage} 页会回退进度。\n\n确定要回退吗？`)) return;
    }
    if (cp) cp.endPage = endPage;
    else p.records.push({ rid: genId(), date, endPage });
  } else {
    const dup = p.records.find(r => r.date === date && r.startPage === startPage && r.endPage === endPage);
    if (!dup) p.records.push({ rid: genId(), date, startPage, endPage });
  }
  p.updatedAt = Date.now();
  saveStore();
  const isSinglePage = startPage != null && startPage === endPage;
  showToast('✅', '已记录', startPage != null
    ? (isSinglePage ? `第 ${endPage} 页` : `第 ${startPage}-${endPage} 页`)
    : `学到第 ${endPage} 页`);
  if (gapFilled > 0) {
    // 延后到里程碑表扬（800ms）之后再弹，确保数据口径提示最终可见、不被覆盖
    setTimeout(() => showToast('💡', '检测到此前跳过的页', `按“连续学到第 ${endPage} 页”，之前跳过的 ${gapFilled} 页也已计入完成。如果这些页其实还没做，建议改用「按区间录入」分别记录，进度会更准。`, 4000), 1500);
  }
  $('#inPageStart').value = '';
  $('#inPageEnd').value = '';
  render();
  maybeShowProgressPraise(p);
  markOfflineWrite('checkin'); // ux-28
  // ux-30：首次成功打卡后，触发一次 PWA 安装引导（之后永不自动弹）
  if (typeof STAuth !== 'undefined' && STAuth.tryPromptInstallOnce) STAuth.tryPromptInstallOnce();
});
// 刷题打卡：回车在 日期→起始页→结束页 间跳转，最后一个回车记录（统一导航接管）

/* 背书 / 错题添加 */
$('#btnReciteAdd').addEventListener('click', () => {
  const p = cur();
  if (!p || p.type === 'exercise') return;

  const content = ($('#reciteContent').value || '').trim();
  const errTags = ($('#reciteErrTagSel').value || '').split(',').filter(Boolean);
  const note = ($('#reciteNote').value || '').trim().slice(0, 60);
  const source = ($('#reciteSource') ? $('#reciteSource').value : '').trim().slice(0, 40);
  const isMistake = p.type === 'mistake';
  const date = $('#reciteDate').value || todayStr();
  clearAllFieldErrors();

  let pageStart = 0, pageEnd = 0, setNo = null;
  if (!isMistake || isMistakePageMode(p)) {
    // 背书 + 错题本习题册模式：页码定位。起始页/结束页规则全局统一——
    // 只填任意一个 = 单页（两页相同）；两个都填 = 起止范围；都不填才提示。
    const startRaw = $('#recitePageStart').value.trim();
    const endRaw = $('#recitePageEnd').value.trim();
    if (!startRaw && !endRaw) { setFieldError($('#recitePageStart'), '请填写页码（单页填一个，范围填起止两个）'); return; }
    const sVal = startRaw ? parseInt(startRaw, 10) : NaN;
    const eVal = endRaw ? parseInt(endRaw, 10) : NaN;
    if (startRaw && (isNaN(sVal) || sVal < 0)) { setFieldError($('#recitePageStart'), '请输入有效的起始页'); $('#recitePageStart').focus(); return; }
    if (endRaw && (isNaN(eVal) || eVal < 0)) { setFieldError($('#recitePageEnd'), '请输入有效的结束页'); $('#recitePageEnd').focus(); return; }
    pageStart = startRaw ? sVal : eVal;
    pageEnd = endRaw ? eVal : sVal;
    if (pageEnd < pageStart) { setFieldError($('#recitePageEnd'), '结束页不能小于起始页'); $('#recitePageEnd').focus(); return; }
  }
  if (isMistakeSetMode(p)) {
    setNo = parseInt($('#reciteSetNo').value, 10);
    if (isNaN(setNo) || setNo < 1) { setFieldError($('#reciteSetNo'), '请输入有效的套卷号'); $('#reciteSetNo').focus(); return; }
  }
  if (!content) { setFieldError($('#reciteContent'), isMistake ? '请填写错题内容' : '请填写学习内容'); $('#reciteContent').focus(); return; }
  // 超长文本边界：避免误粘贴整段文章撑爆本地存储与渲染（500 字足够记录一道错题/一个知识点）
  if (content.length > 500) { setFieldError($('#reciteContent'), (isMistake ? '错题内容' : '学习内容') + '超过 500 字，提炼一下关键题干再记录'); $('#reciteContent').focus(); return; }
  if (!reciteQuality) { showToast('⚠️', '请先选择学习效果', '在下方点选「记得/模糊/忘记」后再提交', 2600); return; }
  if (date > todayStr()) { setFieldError($('#reciteDate'), '学习日期不能晚于今天'); $('#reciteDate').focus(); return; }

  const intervals = getIntervals(p);
  const gap = gapForQuality(reciteQuality, intervals);

  if (!Array.isArray(p.items)) p.items = [];
  const firstReview = { date, quality: reciteQuality, stage: 0 };
  if (note) firstReview.note = note;
  const newItem = {
    id: genId(),
    content,
    errTags,
    note,
    learnedDate: date,
    stage: 0,
    nextReviewDate: null,
    reviews: [firstReview],
    mastered: false,
    manualMastered: false,
    wrongStreak: 0,
    customIntervals: null
  };
  if (isMistake) {
    if (isMistakeFreeMode(p) && source) newItem.source = source;
    if (isMistakePageMode(p)) { newItem.pageStart = pageStart; newItem.pageEnd = pageEnd; }
    if (isMistakeSetMode(p)) newItem.setNo = setNo;
  } else {
    newItem.pageStart = pageStart;
    newItem.pageEnd = pageEnd;
  }
  p.items.push(newItem);
  // 错题本均匀模式下，录入时走智能排期（必须在 push 之后，否则批量录入会全排到同一天）
  const firstBase = addDays(date, gap);
  if (isMistake && p.reviewMode === 'balanced') {
    newItem.nextReviewDate = findAvailableDate(p, firstBase, {
      maxForward: Math.max(1, Math.round(gap * 0.25)),
      maxBack: Math.min(2, Math.floor(gap * 0.25)),
      minDate: addDays(date, 1)
    });
  } else {
    newItem.nextReviewDate = firstBase;
  }
  p.updatedAt = Date.now();
  saveStore();

  $('#reciteContent').value = '';
  $('#reciteErrTagSel').value = '';
  $('#reciteNote').value = '';
  if ($('#reciteSource')) $('#reciteSource').value = '';
  // 页码/套卷号保留（同一批连续录入无需重打），并用警告色标记提醒确认，防止忘记改就提交
  retainEntryValue($('#recitePageStart'));
  retainEntryValue($('#recitePageEnd'));
  retainEntryValue($('#reciteSetNo'));
  $('#reciteDate').value = todayStr();
  reciteQuality = null;
  const qWrap = $('#reciteQuality');
  if (qWrap) qWrap.querySelectorAll('.rec-qbtn').forEach(b => b.classList.remove('active'));
  updateRecitePreview();
  if (isMistake) {
    showToast('🎯', '已收录一道错题', `又锁定一个提分点，到复习日会自动提醒你重做`);
  } else {
    showToast('🎉', '已添加', `系统会按记忆节奏自动安排下次复习`);
  }
  render();
  maybeShowProgressPraise(p);
  markOfflineWrite('recite-add'); // ux-28
});

// 背书/错题录入：回车按"当前模式下实际可见的框"顺序跳转，最后一个（学习日期）回车提交（统一导航接管）
$('#reciteDate').addEventListener('change', updateRecitePreview);

/* 新错因：永久/临时按钮选择 */
function finishNewReason(permanent) {
  const p = cur();
  const v = pendingNewReason;
  const forItemId = pendingNewReasonItemId;
  pendingNewReason = null;
  pendingNewReasonItemId = null;

  if (p && v) {
    p.customErrorReasons = p.customErrorReasons || [];
    p.customErrorReasons.push({ name: v, permanent });
    // 如果是从复习弹窗的新增入口来的，直接挂到对应条目上
    if (forItemId) {
      const item = (p.items || []).find(it => it.id === forItemId);
      if (item) {
        if (!Array.isArray(item.errTags)) item.errTags = [];
        if (!item.errTags.includes(v)) item.errTags.push(v);
      }
    }
    p.updatedAt = Date.now();
    saveStore();
  }
  $('#reasonKindMask').hidden = true;
  unlockBodyScroll();
  render();
  // 从录入表单来的：自动在新错因下拉里勾选
  if (v && !forItemId) {
    setTimeout(() => {
      const sel = ($('#reciteErrTagSel').value || '').split(',').filter(Boolean);
      if (!sel.includes(v)) sel.push(v);
      $('#reciteErrTagSel').value = sel.join(',');
      renderReasonDropdown(p);
    }, 0);
  }
}
$('#reasonKindPermanent').addEventListener('click', () => finishNewReason(true));
$('#reasonKindTemp').addEventListener('click', () => finishNewReason(false));
$('#reasonKindClose').addEventListener('click', () => { pendingNewReason = null; pendingNewReasonItemId = null; $('#reasonKindMask').hidden = true; unlockBodyScroll(); });
$('#reasonKindMask').addEventListener('click', e => { if (e.target.id === 'reasonKindMask' && !_mouseDownInModal) { pendingNewReason = null; pendingNewReasonItemId = null; $('#reasonKindMask').hidden = true; unlockBodyScroll(); } });

$('#reasonDDBtn').addEventListener('click', openReasonDropdown);
$('#reasonDDAdd').addEventListener('click', () => {
  const name = prompt('输入新的错因标签：');
  if (name && name.trim()) {
    const v = name.trim().slice(0, 20);
    const p = cur();
    if (ERROR_REASONS.includes(v) || (p.customErrorReasons||[]).some(r => r.name === v)) {
      alert('这个错因已经存在啦～'); return;
    }
    pendingNewReason = v;
    pendingNewReasonItemId = null; // 从录入表单来的，不走条目挂载
    $('#reasonKindMask').hidden = false;
    modalTop($('#reasonKindMask'));
  }
});

/* 复习按钮 */
let pendingSkipItem = null;
let pendingSkipProject = null;

/* ============ 评价小反馈：结果文案 + 条目退场动效（错题/背书通用） ============ */
let __fxFlying = 0;
// 正常复习评价的反馈（good/fuzzy/forgot）；直接毕业时 item.mastered 已为 true
function getReviewFeedback(quality, p, item) {
  const isMistake = p.type === 'mistake';
  if (item.mastered) {
    return { icon: '🎉', text: isMistake ? '攻克啦，偶尔巩固' : '掌握啦，偶尔巩固' };
  }
  let pool;
  if (quality === 'good') {
    pool = isMistake
      ? ['✓ 做对了，下次见', '✓ 稳了，下次见', '✓ 拿下']
      : ['✓ 记住啦，下次见', '✓ 很稳，下次见', '✓ 拿下'];
  } else if (quality === 'fuzzy') {
    pool = isMistake
      ? ['～ 看答案了，下次再练', '～ 差一点，下次巩固', '～ 再眼熟两遍']
      : ['～ 还差一点，下次巩固', '～ 再眼熟两遍', '～ 有点模糊'];
  } else {
    pool = isMistake
      ? ['✗ 没关系，下次重做', '✗ 忘了正常，下次再来', '✗ 多过一次就牢了']
      : ['✗ 忘了正常，下次再来', '✗ 下次再过一遍', '✗ 多过一次就牢了'];
  }
  const full = _pick(pool);
  return { icon: full.slice(0, 1), text: full.slice(2) };
}
// 保持复习评价的反馈
function getRetentionFeedback(item, result) {
  if (result === 'pass') {
    const full = _pick(['✓ 还记得，下次再巩固', '✓ 记得很牢，下次见', '✓ 稳，下次再巩固']);
    return { icon: full.slice(0, 1), text: full.slice(2) };
  }
  const full = _pick(['～ 模糊了，已排到最近重做', '～ 没关系，回到复习列表多过两遍']);
  return { icon: full.slice(0, 1), text: full.slice(2) };
}

// 清理过期未做的"提前复习"：如果用户点提前复习后当天没做，第二天恢复回原计划日期，不惩罚
function cleanupExpiredEarlyPulls(p) {
  const today = todayStr();
  let changed = 0;
  (p.items || []).forEach(it => {
    if (!it.originalNextReviewDate) return;
    // 情况1：日期已经过去（说明用户当天没做）
    if (it.nextReviewDate && it.nextReviewDate < today) {
      // 检查当天之后是否有新的复习记录（做了就走另一条分支）
      const pulledOn = it.nextReviewDate;
      const hasReviewed = (it.reviews || []).some(r => r.date >= pulledOn);
      if (!hasReviewed) {
        // 恢复到原始计划日期，取消"提前"标记
        it.nextReviewDate = it.originalNextReviewDate;
        it.earlyReviewed = false;
        changed++;
      }
      delete it.originalNextReviewDate;
    }
    // 情况2：用户已经复习过（nextReviewDate 会被 scheduleNextReview 改成未来），清掉追踪字段即可
    else if (it.nextReviewDate && it.nextReviewDate > today) {
      delete it.originalNextReviewDate;
    }
  });
  if (changed > 0) {
    p.updatedAt = Date.now();
    saveStore();
  }
  return changed;
}

// 在被点击的条目上覆盖结果反馈，约 1.4s 后统一重渲染
function playReviewFx(itemEl, kind, fb) {
  if (!itemEl || !fb) { render(); return; }
  const pill = document.createElement('div');
  pill.className = 'ri-fx';
  const ic = document.createElement('span'); ic.className = 'ri-fx-ic'; ic.textContent = fb.icon;
  const tx = document.createElement('span'); tx.className = 'ri-fx-tx'; tx.textContent = fb.text;
  pill.appendChild(ic); pill.appendChild(tx);
  itemEl.appendChild(pill);
  itemEl.classList.add('fx-out', 'fx-' + kind);
  __fxFlying++;
  try { if (navigator.vibrate) navigator.vibrate(kind === 'good' ? 8 : kind === 'forgot' ? 22 : 13); } catch (e) {}
  setTimeout(function () {
    __fxFlying = Math.max(0, __fxFlying - 1);
    if (__fxFlying === 0) render();
  }, 1400);
}

$('#reviewList').addEventListener('click', e => {
  // 展开折叠的保持复习条目
  const expandBtn = e.target.closest('[data-retention-expand]');
  if (expandBtn) {
    const p = cur();
    if (!p) return;
    _retentionExpanded.add(p.id);
    render();
    return;
  }

  const skipBtn = e.target.closest('[data-skip]');
  if (skipBtn) {
    const itemId = skipBtn.dataset.skip;
    const p = cur();
    if (!p) return;
    const item = (p.items || []).find(it => it.id === itemId);
    if (!item) return;

    const reviewCount = (item.reviews || []).length;
    const recent = (item.reviews || []).slice(-3);
    const allGood = recent.length >= 1 && recent.every(r => r.quality === 'good');
    const tooFew = reviewCount < 3;

    // 直接标记（不弹窗）条件：已勾选"以后不再提示" + 满3次 + 最近3次全对
    if (p.skipConfirmDismissed && !tooFew && allGood) {
      item.manualMastered = true;
      item.masteredDate = todayStr();
      item.nextReviewDate = null;
      clearRetention(item);
      p.updatedAt = Date.now();
      saveStore();
      playReviewFx(skipBtn.closest('.review-item'), 'good', { icon: '🎉', text: '已熟知，不再出现在复习列表' });
      return;
    }

    // 不满足直接标记条件，按顺序检查并弹窗
    pendingConfirmItem = item;
    pendingConfirmProject = p;
    pendingConfirmFromSkip = true;

    if (tooFew) {
      // 学习次数不满3次 → 弹窗确认
      showConfirmMaster(item, p, recent, 'few');
    } else if (!allGood) {
      // 最近3次并非全对 → 弹窗确认
      showConfirmMaster(item, p, recent, 'notAllGood');
    } else {
      // 满3次且全对，但未勾选"以后不再提示" → 已熟知告知弹窗
      pendingConfirmItem = null;
      pendingConfirmProject = null;
      pendingConfirmFromSkip = false;
      pendingSkipItem = item;
      pendingSkipProject = p;
      $('#confirmMasterMask').hidden = true;
      unlockBodyScroll(); // 关闭 confirmMasterMask 必须解锁，否则打开 skipConfirmMask 时计数 +1 泄漏
      $('#skipConfirmText').innerHTML = `「<strong>${esc(item.content)}</strong>」将不再出现在复习列表。<br>想再复习时，可在下方「学习记录」里找到它。`;
      $('#skipDismissChk').checked = false;
      $('#skipConfirmMask').hidden = false;
      modalTop($('#skipConfirmMask'));
    }
    return;
  }

  const pickBtn = e.target.closest('[data-reasonpicker]');
  if (pickBtn) {
    openReasonPopover(pickBtn, pickBtn.dataset.reasonpicker);
    return;
  }

  const btn = e.target.closest('.q-btn');
  if (!btn) return;
  const itemEl = btn.closest('.review-item');
  if (!itemEl) return;
  const itemId = itemEl.dataset.id;
  const p = cur();
  if (!p) return;
  const item = (p.items || []).find(it => it.id === itemId);
  if (!item) return;

  // 保持复习条目：只有"还记得/模糊了"两个选项，走独立逻辑
  if (btn.dataset.retention) {
    applyRetentionReview(item, btn.dataset.retention, p);
    playReviewFx(itemEl, btn.dataset.retention === 'pass' ? 'good' : 'fuzzy',
      getRetentionFeedback(item, btn.dataset.retention));
    return;
  }

  const noteInput = itemEl.querySelector('.ri-note');
  const note = noteInput ? noteInput.value : '';
  const _quality = btn.dataset.quality;
  applyReview(item, _quality, p, note);
  if ($('#confirmMasterMask').hidden) {
    saveStore();
    playReviewFx(itemEl, _quality, getReviewFeedback(_quality, p, item));
    // 复习完阈值条数后，弹窗提示可分散剩余
    checkReviewMilestone(p);
    // 错题本：连续又错（高频薄弱点）时去羞耻化提示，每天最多一次
    if (p.type === 'mistake' && _quality === 'forgot') checkMistakeRelapseToast(p, item);
    markOfflineWrite('review'); // ux-28
    // ux-30：完成一次复习判定后，触发一次 PWA 安装引导（之后永不自动弹）
    if (typeof STAuth !== 'undefined' && STAuth.tryPromptInstallOnce) STAuth.tryPromptInstallOnce();
  }
});

/* 检查今日复习里程碑：达到阈值且还有剩余时弹窗提示 */
let milestoneFiredToday = {}; // key: projectId + ':' + date
let milestoneCleanedDate = null;
function checkReviewMilestone(p) {
  if (!p || p.type === 'exercise') return;
  const today = todayStr();
  // 跨天时清理旧 key，避免项目删除后 key 泄漏
  if (milestoneCleanedDate !== today) {
    Object.keys(milestoneFiredToday).forEach(k => {
      if (!k.endsWith(':' + today)) delete milestoneFiredToday[k];
    });
    milestoneCleanedDate = today;
  }
  const key = p.id + ':' + today;
  if (milestoneFiredToday[key]) return; // 这个项目今天已经弹过了
  const threshold = p.spreadThreshold || defaultComfortCap(p);
  // 今天复习了多少条（排除首次录入）
  let reviewedToday = 0;
  (p.items || []).forEach(it => {
    const revs = it.reviews || [];
    if (revs.length >= 2 && revs[revs.length - 1].date === today) reviewedToday++;
  });
  const remaining = getDueItems(p).length;
  if (reviewedToday >= threshold && remaining > 0) {
    milestoneFiredToday[key] = true;
    // 均匀模式下每日自动均衡已把今天控制在舒适量内，不再提示手动分散
    let tip;
    if (p.reviewMode === 'balanced' && remaining <= threshold) {
      tip = `今天还剩 ${remaining} 条，在舒适量内，量力而行就好。`;
    } else {
      tip = `还有 ${remaining} 条，可以分散到未来减轻压力。`;
    }
    showToast('🎉', `今天已经复习 ${reviewedToday} 条，辛苦了！`, tip, 5000);
  }
}

$('#overdueBanner').addEventListener('click', e => {
  const btn = e.target.closest('.ob-btn');
  if (!btn) return;
  const days = parseInt(btn.dataset.days, 10);
  if (!days || days < 1) return;
  const p = cur();
  if (!p) return;
  const r = spreadOverdueItems(p, days);
  if (r.moved > 0 || r.blocked > 0) {
    render();
    if (r.moved > 0 && r.blocked > 0) {
      showToast('📅', `已分散 ${r.moved} 条，${r.blocked} 条紧急逾期移回今天`, `可推迟的已均匀安排到未来 ${days} 天；逾期太久或多次推迟的不能再推，建议今天优先完成。`, 5200);
    } else if (r.moved > 0) {
      showToast('📅', `已分散 ${r.moved} 条内容`, `未来 ${days} 天均匀安排，今天不再堆积。`);
    } else {
      showToast('⚠️', `${r.blocked} 条逾期内容不能再推迟了`, '它们逾期太久或已多次推迟，再推会真的忘掉，已移到今天，建议优先清掉。', 4200);
    }
  } else {
    const cap = getComfortCap(p, todayStr());
    const dueN = getDueItems(p).length;
    if (dueN > cap) {
      // 还超舒适量却一条没动：全部被防饥饿锁死（逾期太久），不能再往后推
      showToast('⚠️', '逾期内容不能再推迟了', '这些题逾期太久或已多次推迟，再推会真的忘掉，建议今天先清最上面的几条。', 4200);
    } else {
      showToast('✅', '今天的量在舒适范围内', `共 ${dueN} 条（舒适量 ${cap}），逾期的几条建议今天直接清掉，不必再往后分散。`, 4200);
    }
  }
});

/* 超额分散：保留前N条在今天，其余分散到未来 */
['excessSpread1', 'excessSpread3', 'excessSpread5', 'excessSpread7'].forEach(id => {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.addEventListener('click', () => {
    const days = parseInt(id.replace('excessSpread', ''), 10);
    const p = cur();
    if (!p) return;
    const cap = getComfortCap(p, todayStr());
    const due = getDueItems(p);
    const banner = $('#excessBanner');
    const isGentle = banner && banner.dataset.mode === 'gentle';
    // 主模式：保留舒适量内的量，其余分散；温和模式：保留当前的一半，其余分散
    const count = spreadExcessToday(p, days, isGentle ? 0.5 : null);
    if (count > 0) {
      render();
      if (isGentle) {
        showToast('📋', `已分散 ${count} 条到未来`, `今天保留一半左右继续做，其余 ${days} 天内均匀安排。`);
      } else {
        showToast('📋', `已分散 ${count} 条到未来`, `优先保留最该复习的，其余 ${days} 天内均匀安排。`);
      }
    } else if (due.length > cap) {
      showToast('⚠️', '这些内容不能再推迟了', '它们已经被推迟多次，或逾期超过当前间隔的 2 倍，再推会真的忘掉，建议今天优先完成最上面的几条。', 4200);
    } else if (isGentle) {
      showToast('✅', '剩余量不多', '已经做到这里了，剩下的直接清掉会更轻松。');
    } else {
      showToast('✅', '今天的量刚好', '不需要分散，直接做完就好。');
    }
  });
});

/* 记录删除 + 历史展开 */
$('#recordList').addEventListener('click', e => {
  // 提前复习
  const earlyBtn = e.target.closest('[data-early]');
  if (earlyBtn) {
    const itemId = earlyBtn.dataset.early;
    const p = cur();
    if (!p) return;
    const item = (p.items || []).find(it => it.id === itemId);
    if (!item) return;
    item.nextReviewDate = todayStr();
    item.earlyReviewed = true;
    p.updatedAt = Date.now();
    saveStore();
    render();
    showToast('⏩', '已加入今日复习', '这条内容现在出现在上方「今日复习」列表中。');
    return;
  }

  // 补页码（错题本习题册模式）
  const fillPageBtn = e.target.closest('[data-fill-page]');
  if (fillPageBtn) {
    const itemId = fillPageBtn.dataset.fillPage;
    const p = cur();
    if (!p) return;
    const item = (p.items || []).find(it => it.id === itemId);
    if (!item) return;
    const input = prompt('请填写这道错题所在页码（可填范围，如 23 或 23-25）：', '');
    if (input == null) return;
    const trimmed = input.trim();
    if (!trimmed) return;
    const m = trimmed.match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/);
    if (!m) { alert('请输入有效的页码，如 23 或 23-25'); return; }
    item.pageStart = parseInt(m[1], 10);
    item.pageEnd = m[2] ? parseInt(m[2], 10) : item.pageStart;
    p.updatedAt = Date.now();
    saveStore();
    render();
    showToast('📍', '已补页码', `这道错题已归类到第 ${item.pageStart}${item.pageEnd > item.pageStart ? '-' + item.pageEnd : ''} 页。`);
    return;
  }

  // 补套号（错题本套卷模式）
  const fillSetBtn = e.target.closest('[data-fill-set]');
  if (fillSetBtn) {
    const itemId = fillSetBtn.dataset.fillSet;
    const p = cur();
    if (!p) return;
    const item = (p.items || []).find(it => it.id === itemId);
    if (!item) return;
    const input = prompt('请填写这道错题来自第几套卷：', '');
    if (input == null) return;
    const trimmed = input.trim();
    if (!trimmed) return;
    const no = parseInt(trimmed, 10);
    if (isNaN(no) || no < 1) { alert('请输入有效的套卷号'); return; }
    item.setNo = no;
    p.updatedAt = Date.now();
    saveStore();
    render();
    showToast('📍', '已补套号', `这道错题已归类到第 ${no} 套。`);
    return;
  }

  const histToggle = e.target.closest('.hist-toggle');
  if (histToggle) {
    const li = histToggle.closest('li');
    const panel = li.querySelector('.hist-panel');
    if (panel) {
      const willShow = panel.style.display === 'none';
      panel.style.display = willShow ? 'block' : 'none';
      histToggle.textContent = willShow ? '收起' : '历史';
      // 记录/移除展开状态
      const histBtn = panel.querySelector('[data-hist-item]');
      const itemId = histBtn ? histBtn.dataset.histItem : null;
      if (itemId) {
        if (willShow) _expandedHistItems.add(itemId);
        else _expandedHistItems.delete(itemId);
      }
    }
    return;
  }

  const histBtn = e.target.closest('[data-hist-item]');
  if (histBtn) {
    const itemId = histBtn.dataset.histItem;
    const idx = parseInt(histBtn.dataset.histIdx, 10);
    const quality = histBtn.dataset.quality;
    const p = cur();
    if (!p) return;
    const item = (p.items || []).find(it => it.id === itemId);
    if (!item || !item.reviews || !item.reviews[idx]) return;
    item.reviews[idx].quality = quality;
    recomputeItemMastery(item, p); // 修改历史评价后重算掌握状态
    p.updatedAt = Date.now();
    saveStore();
    render();
    return;
  }

  const btn = e.target.closest('.r-del');
  if (!btn) return;
  const p = cur();
  if (!p) return;

  if (btn.dataset.set) {
    // 套卷：同一天可能有多套/多板块，精确删除这一条
    const rid = btn.dataset.rid, setNo = btn.dataset.set, date = btn.dataset.date;
    if (confirm(`删除 ${fmtCN(date)} 第 ${setNo} 套的记录？`)) {
      const idx = (p.records || []).findIndex(r => r.rid === rid ||
        (!r.rid && r.date === date && String(r.set) === String(setNo)));
      if (idx >= 0) {
        const [removed] = p.records.splice(idx, 1);
        p.updatedAt = Date.now();
        saveStore();
        render();
        showUndo('已删除 1 条套卷记录', () => {
          if (!store.projects[p.id]) return;
          p.records.splice(Math.min(idx, p.records.length), 0, removed);
          p.updatedAt = Date.now();
          saveStore();
          render();
        });
      }
    }
  } else if (btn.dataset.rid) {
    // 习题册：精确删除这一条（同一天可能有多条）
    const rid = btn.dataset.rid;
    if (confirm('删除这一条打卡记录？')) {
      const idx = (p.records || []).findIndex(r => r.rid === rid);
      if (idx >= 0) {
        const [removed] = p.records.splice(idx, 1);
        p.updatedAt = Date.now();
        saveStore();
        render();
        showUndo('已删除 1 条打卡记录', () => {
          if (!store.projects[p.id]) return;
          p.records.splice(Math.min(idx, p.records.length), 0, removed);
          p.updatedAt = Date.now();
          saveStore();
          render();
        });
      }
    }
  } else if (btn.dataset.date) {
    // 旧数据兼容：按日期删除
    const date = btn.dataset.date;
    if (confirm(`删除 ${fmtCN(date)} 的打卡记录？`)) {
      const removed = (p.records || []).filter(r => r.date === date);
      p.records = (p.records || []).filter(r => r.date !== date);
      p.updatedAt = Date.now();
      saveStore();
      render();
      showUndo(`已删除 ${removed.length} 条打卡记录`, () => {
        if (!store.projects[p.id]) return;
        p.records = (p.records || []).concat(removed);
        p.updatedAt = Date.now();
        saveStore();
        render();
      });
    }
  } else if (btn.dataset.item) {
    const id = btn.dataset.item;
    const item = (p.items || []).find(it => it.id === id);
    if (!item) return;
    if (confirm(`删除「${item.content}」及其全部复习记录？`)) {
      const idx = (p.items || []).findIndex(it => it.id === id);
      if (idx >= 0) {
        const [removed] = p.items.splice(idx, 1);
        p.updatedAt = Date.now();
        saveStore();
        render();
        showUndo(`已删除「${removed.content.slice(0, 12)}…」`, () => {
          if (!store.projects[p.id]) return;
          p.items.splice(Math.min(idx, p.items.length), 0, removed);
          p.updatedAt = Date.now();
          saveStore();
          render();
        });
      }
    }
  }
});

/* 薄弱点看板 */
$('#btnWeakness').addEventListener('click', openWeaknessBoard);
$('#btnMistakeGuide').addEventListener('click', () => {
  $('#mistakeGuideMask').hidden = false;
  modalTop($('#mistakeGuideMask'));
});
$('#weaknessClose').addEventListener('click', closeWeaknessBoard);
$('#weaknessMask').addEventListener('click', e => {
  // 关闭弹窗
  if (e.target === $('#weaknessMask') && !_mouseDownInModal) { closeWeaknessBoard(); return; }

  // 提前复习按钮逻辑
  const earlyBtn = e.target.closest('[data-wb-early]');
  if (earlyBtn) {
    const itemId = earlyBtn.dataset.wbEarly;
    const p = cur();
    if (!p) return;
    const item = (p.items || []).find(it => it.id === itemId);
    if (!item) return;

    // 复用核心逻辑：把下次复习日期设为今天，并保留原始日期（防止用户没做时被误判逾期）
    if (!item.originalNextReviewDate) {
      item.originalNextReviewDate = item.nextReviewDate;
    }
    item.nextReviewDate = todayStr();
    item.earlyReviewed = true;
    p.updatedAt = Date.now();
    saveStore();

    // 刷新看板（由于过滤条件改了，它会从“未复习”里消失）
    renderWeaknessBoard(p);

    // 提示
    showToast('⏩', '已加入今日复习', '这条错题现在出现在复习列表中了，关闭看板即可看到。');
  }
});
document.querySelectorAll('.wb-filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.wb-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    wbCurrentFilter = btn.dataset.filter;
    const p = cur();
    if (p) renderWeaknessBoard(p);
  });
});

/* 随机抽题复习：从已掌握中随机选5道，重新加入复习队列 */
$('#btnRandomReview').addEventListener('click', () => {
  const p = cur();
  if (!p || p.type !== 'mistake') return;
  const mastered = (p.items || []).filter(it => it.mastered || it.manualMastered);
  if (mastered.length < 1) {
    showToast('📭', '还没有已攻克的错题', '先攻克一些错题，再来抽查吧～', 3000);
    return;
  }
  const n = Math.min(5, mastered.length);
  $('#randomReviewConfirmDesc').innerHTML =
    `从已攻克的 <b>${mastered.length}</b> 道错题中随机抽出 <b>${n}</b> 道复习。<br>做错了会自动重新加入复习队列，做对了可重新标记为已攻克。`;
  const warn = $('#randomReviewConfirmWarn');
  if (mastered.length < 5) {
    warn.hidden = false;
    warn.textContent = `已攻克的错题不足5道（仅${mastered.length}道），将全部抽出。`;
  } else {
    warn.hidden = true;
  }
  $('#randomReviewConfirmMask').hidden = false;
  modalTop($('#randomReviewConfirmMask'));
});
$('#randomReviewConfirmClose').addEventListener('click', () => { $('#randomReviewConfirmMask').hidden = true; unlockBodyScroll(); });
$('#randomReviewConfirmCancel').addEventListener('click', () => { $('#randomReviewConfirmMask').hidden = true; unlockBodyScroll(); });

/* 通用确认弹窗 */
let genericConfirmCallback = null;
let genericConfirmCancelCallback = null;
function showGenericConfirm(title, bodyHtml, okText, onOk, onCancel) {
  $('#genericConfirmTitle').textContent = title;
  $('#genericConfirmBody').innerHTML = bodyHtml;
  $('#genericConfirmOk').textContent = okText || '确认';
  genericConfirmCallback = onOk;
  genericConfirmCancelCallback = onCancel || null;
  $('#genericConfirmMask').hidden = false;
  modalTop($('#genericConfirmMask'));
}
$('#genericConfirmClose').addEventListener('click', () => {
  $('#genericConfirmMask').hidden = true;
  unlockBodyScroll();
  const cb = genericConfirmCancelCallback;
  genericConfirmCallback = null;
  genericConfirmCancelCallback = null;
  if (cb) cb();
});
$('#genericConfirmCancel').addEventListener('click', () => {
  $('#genericConfirmMask').hidden = true;
  unlockBodyScroll();
  const cb = genericConfirmCancelCallback;
  genericConfirmCallback = null;
  genericConfirmCancelCallback = null;
  if (cb) cb();
});
$('#genericConfirmOk').addEventListener('click', () => {
  $('#genericConfirmMask').hidden = true;
  unlockBodyScroll();
  const cb = genericConfirmCallback;
  genericConfirmCallback = null;
  genericConfirmCancelCallback = null;
  if (cb) cb();
});

/* 导入备份弹窗关闭 */
$('#importConfirmClose').addEventListener('click', () => {
  $('#importConfirmMask').hidden = true;
  unlockBodyScroll();
});
$('#importConfirmCancel').addEventListener('click', () => {
  $('#importConfirmMask').hidden = true;
  unlockBodyScroll();
});
$('#randomReviewConfirmOk').addEventListener('click', () => {
  const p = cur();
  if (!p) return;
  const mastered = (p.items || []).filter(it => it.mastered || it.manualMastered);
  const n = Math.min(5, mastered.length);
  // 随机洗牌取前n个
  const shuffled = [...mastered].sort(() => Math.random() - 0.5);
  const picked = shuffled.slice(0, n);
  const today = todayStr();
  picked.forEach(it => {
    it.mastered = false;
    it.manualMastered = false;
    it.masteredDate = null;
    it.nextReviewDate = today;
    it.spreadCount = 0;
    it.stage = 0; // 抽查当作没攻克过重新过一遍，避免做错后排到30天
    clearRetention(it);
    // 不往 reviews 里塞假记录，避免污染掌握判定、掌握度分数和历史面板
  });
  p.updatedAt = Date.now();
  saveStore();
  $('#randomReviewConfirmMask').hidden = true;
  unlockBodyScroll(); // 补上 randomReviewConfirmMask 的解锁
  closeWeaknessBoard();
  render();
  showToast('🎲', `已从已攻克中随机抽出 ${n} 道`, '做错了会自动继续复习，做对了可重新标记为已攻克。', 4000);
});

/* 完成情况面板 */
$('#btnProgress').addEventListener('click', openProgressBoard);
$('#progressClose').addEventListener('click', closeProgressBoard);
$('#progressMask').addEventListener('click', e => { if (e.target === $('#progressMask') && !_mouseDownInModal) closeProgressBoard(); });
/* 今日总览 */
$('#btnDashboard').addEventListener('click', openDashboard);
$('#dashClose').addEventListener('click', closeDashboard);
$('#dashMask').addEventListener('click', e => { if (e.target === $('#dashMask') && !_mouseDownInModal) closeDashboard(); });

/* 数据安全提示：新用户首次进入只弹这一次，关闭后停留在全屏欢迎页 #welcome */
function checkDataSecurityOnStart() {
  if (getUIFlag(DATA_SECURITY_KEY)) return; // 双写检查：localStorage 或 store.uiFlags 任一为 true 即视为已看过
  setTimeout(openDataSecurity, 350);
}

/* ============ 数据安全提示弹窗（只弹一次，3秒后才能关闭） ============ */
const DATA_SECURITY_KEY = 'study_tracker_data_security_v3';
function isIOSDevice() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/i.test(ua) ||
         // iPadOS 13+ 伪装成 Macintosh：用触点数>0 或 coarse pointer 判断，避免桌面 Mac 触控板误判
         (/Macintosh/i.test(ua) && (navigator.maxTouchPoints > 0 || (window.matchMedia && window.matchMedia('(any-pointer: coarse)').matches)));
}
/* 平台检测：只分三类——iOS、鸿蒙、其他，用于数据安全弹窗的个性化文案 */
function getPlatformInfo() {
  const ua = navigator.userAgent;
  // iOS（直接调用 isIOSDevice，避免重复判断逻辑）
  if (isIOSDevice()) {
    return { name: 'iOS', greeting: '亲爱的 iOS 用户', saveInterval: 10, isMobile: true };
  }
  // 鸿蒙 HarmonyOS / OpenHarmony
  if (/HarmonyOS|OpenHarmony/i.test(ua)) {
    return { name: 'HarmonyOS', greeting: '亲爱的 鸿蒙 用户', saveInterval: 20, isMobile: true };
  }
  // 其他（安卓、Windows、Mac、Linux 等）
  return { name: 'Other', greeting: '同学你好', saveInterval: 20, isMobile: false };
}
function fillDataSecurityContent() {
  const body = $('#dataSecurityBody');
  const plat = getPlatformInfo();

  // 通用：保护措施列表（定时保存秒数随平台变化）
  const protectList = `
    · <strong>双写备份</strong>：数据同时写入 localStorage 和 IndexedDB，互为备份<br>
    · <strong>自动恢复</strong>：启动时检测数据异常，自动从 IndexedDB 备份恢复<br>
    · <strong>定时保存</strong>：每 ${plat.saveInterval} 秒自动保存，页面关闭/切后台时强制保存<br>
    · <strong>持久化请求</strong>：请求浏览器持久化存储，减少被自动清理的概率
  `;

  // 通用：数据丢失场景（移动端说"存储空间"，桌面端说"磁盘空间"）
  const spaceWord = plat.isMobile ? '存储空间' : '磁盘空间';
  const lossList = `
    · 使用<strong>无痕/隐私浏览模式</strong>，关闭浏览器后数据会被清除<br>
    · 手动<strong>清理浏览器缓存或网站数据</strong><br>
    · 更换浏览器、更换设备或更换访问域名<br>
    · 系统${spaceWord}长期极度紧张时，浏览器仍可能回收本地存储
  `;

  // 各平台保护措施卡片的结尾描述
  const protectEnding = {
    iOS: '正常使用下数据可以稳定保存。',
    HarmonyOS: '鸿蒙系统对本地存储支持良好，正常使用下数据稳定可靠。',
    Other: '当前平台对本地存储的保留稳定可靠，正常使用下数据不会丢失。'
  };

  // 各平台保护措施卡片标题
  const protectTitle = {
    iOS: '🛡️ 已针对 iOS 做了多重数据保护',
    HarmonyOS: '🛡️ 已为你开启多重数据保护',
    Other: '🛡️ 已为你开启多重数据保护'
  };

  const ending = protectEnding[plat.name] || protectEnding.Other;
  const title = protectTitle[plat.name] || protectTitle.Other;
  // "同学你好"本身就是问候，不需要再加"欢迎使用"
  const greetLine = plat.name === 'Other' ? `${plat.greeting} 👋` : `${plat.greeting}，欢迎使用 Study Tracker 👋`;

  if (plat.name === 'iOS') {
    // iOS 版：暖黄色提醒卡片（柔和不刺眼）
    body.innerHTML = `
      <p style="font-size:16px;font-weight:700;color:var(--text);margin-bottom:16px">${greetLine}</p>
      <p style="margin-bottom:14px">你的学习数据<strong>全部存储在浏览器本地</strong>，不会上传到任何服务器。</p>
      <div style="background:#e9ebdb;border:1px solid #b9d2c4;border-radius:10px;padding:12px 14px;margin-bottom:14px">
        <p style="font-weight:600;color:#2a6ab0;margin-bottom:8px">${title}</p>
        <p style="color:#3a5a8a;font-size:13.5px;line-height:1.8">
          ${protectList}
          ${ending}
        </p>
      </div>
      <div style="background:#fff8e6;border:1px solid #f5e4b8;border-radius:10px;padding:12px 14px;margin-bottom:14px">
        <p style="font-weight:600;color:#92600a;margin-bottom:6px">📌 由于 iOS 系统的数据安全机制，仍建议</p>
        <p style="color:#7a5a10;font-size:13.5px;line-height:1.75">
          · 定期到「设置 → 导出备份」保存 JSON 文件到 iCloud 云盘或「文件」App<br>
          · 不要使用<strong>无痕/隐私浏览模式</strong>（关闭后数据会被清除）<br>
          · 不要手动<strong>清理浏览器网站数据</strong><br>
          · 设备存储空间不足时，iOS 可能自动清理网站数据，建议保持充足存储空间
        </p>
      </div>
      <p style="color:var(--muted);font-size:13px">导出的备份文件可在换设备、换浏览器或数据异常时导入恢复。</p>
      <p style="text-align:center;margin-top:16px;font-size:14px;color:var(--text)">祝你学习进步，每天都有新收获 🌟</p>
    `;
  } else {
    // 非 iOS 版：浅蓝色丢失场景卡片（柔和好看）
    body.innerHTML = `
      <p style="font-size:16px;font-weight:700;color:var(--text);margin-bottom:16px">${greetLine}</p>
      <p style="margin-bottom:14px">你的学习数据<strong>全部存储在浏览器本地</strong>，不会上传到任何服务器。</p>
      <div style="background:#e9ebdb;border:1px solid #b9d2c4;border-radius:10px;padding:12px 14px;margin-bottom:14px">
        <p style="font-weight:600;color:#2a6ab0;margin-bottom:8px">${title}</p>
        <p style="color:#3a5a8a;font-size:13.5px;line-height:1.8">
          ${protectList}
          ${ending}
        </p>
      </div>
      <div style="background:#f0f4ff;border:1px solid #d4ddf8;border-radius:10px;padding:12px 14px;margin-bottom:14px">
        <p style="font-weight:600;color:#3b4fb8;margin-bottom:6px">📌 以下情况仍会导致数据丢失，请注意</p>
        <p style="color:#4a5a9e;font-size:13.5px;line-height:1.7">
          ${lossList}
        </p>
      </div>
      <p style="color:var(--muted);font-size:13px">建议定期到「设置 → 导出备份」保存一份 JSON 文件，换设备或清理缓存后可导入恢复。</p>
      <p style="text-align:center;margin-top:16px;font-size:14px;color:var(--text)">祝你学习进步，每天都有新收获 🌟</p>
    `;
  }
}
let _dsTimer = null;
function openDataSecurity() {
  fillDataSecurityContent();
  $('#dataSecurityMask').hidden = false;
  modalTop($('#dataSecurityMask')); // modalTop 内部已同步 lockBodyScroll，不要再锁一次
  const btn = $('#dataSecurityOk');
  btn.disabled = true;
  btn.style.opacity = '.5';
  btn.style.cursor = 'not-allowed';
  let sec = 3;
  btn.textContent = `我已知晓（${sec}s）`;
  if (_dsTimer) clearInterval(_dsTimer);
  _dsTimer = setInterval(() => {
    sec--;
    if (sec <= 0) {
      clearInterval(_dsTimer);
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
      btn.textContent = '我已知晓';
    } else {
      btn.textContent = `我已知晓（${sec}s）`;
    }
  }, 1000);
}
function closeDataSecurity() {
  const mask = $('#dataSecurityMask');
  if (mask.hidden) return;
  if (_dsTimer) { clearInterval(_dsTimer); _dsTimer = null; }
  mask.hidden = true;
  unlockBodyScroll();
  setUIFlag(DATA_SECURITY_KEY); // 双写 localStorage + store.uiFlags，iOS 清 localStorage 后仍可从 IndexedDB 恢复
}
$('#dataSecurityOk').addEventListener('click', closeDataSecurity);
// 数据安全弹窗不允许点击遮罩或 Esc 关闭（必须点按钮）

/* ============ 无痕浏览模式检测 ============ */
let _incognitoWarned = false;
// 所有模态弹窗 ID，用于检测是否有其他弹窗打开（避免无痕弹窗与其他弹窗同时出现）
const ALL_MODAL_IDS = ['dataSecurityMask','settingsMask','formMask','switchMask','dashMask','weaknessMask','progressMask','reasonKindMask','modeSwitchConfirmMask','randomReviewConfirmMask','genericConfirmMask','mistakeGuideMask','reviewModeHelpMask','importConfirmMask','confirmMasterMask','skipConfirmMask','tplManagerMask','linkedMistakesMask','installMask'];
function anyModalOpen() {
  for (const id of ALL_MODAL_IDS) {
    const el = document.getElementById(id);
    if (el && !el.hidden) return true;
  }
  return false;
}
function checkIncognito() {
  if (_incognitoWarned) return;
  // 有其他模态弹窗打开时，延迟 2 秒再检查，避免弹窗重叠
  if (anyModalOpen()) { setTimeout(checkIncognito, 2000); return; }
  let incognito = false;
  try {
    const k = '__incog_test__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
  } catch (e) {
    incognito = true;
  }
  // Safari 无痕模式下 localStorage 容量为 0，写入会抛 QuotaExceededError（仅此一项检测即可，webkitRequestFileSystem 在正常模式也会失败，会误报）
  if (incognito) {
    _incognitoWarned = true;
    $('#incognitoMask').hidden = false;
    modalTop($('#incognitoMask')); // modalTop 内部已同步 lockBodyScroll，不要再锁一次
  }
}
function closeIncognito() {
  const mask = $('#incognitoMask');
  if (mask.hidden) return;
  mask.hidden = true;
  unlockBodyScroll();
}
$('#incognitoClose').addEventListener('click', closeIncognito);
$('#incognitoOk').addEventListener('click', closeIncognito);
$('#incognitoMask').addEventListener('click', e => { if (e.target === $('#incognitoMask') && !_mouseDownInModal) closeIncognito(); });

$('#ppBody').addEventListener('click', e => {
  const cell = e.target.closest('.pp-cell');
  if (!cell || !cell.dataset.set) return;
  const n = parseInt(cell.dataset.set, 10);
  const p = cur();
  if (!p) return;
  ppExpandedSet[p.id] = (ppExpandedSet[p.id] === n) ? null : n;
  renderProgressBoard(p);
});

/* 跳过确认弹窗 */
$('#skipCancel').addEventListener('click', () => {
  $('#skipConfirmMask').hidden = true;
  unlockBodyScroll();
  pendingSkipItem = null;
  pendingSkipProject = null;
});
$('#skipConfirmYes').addEventListener('click', () => {
  const item = pendingSkipItem;
  const p = pendingSkipProject;
  if (item && p) {
    if ($('#skipDismissChk').checked) {
      p.skipConfirmDismissed = true;
    }
    item.manualMastered = true;
    item.masteredDate = todayStr();
    item.nextReviewDate = null;
    p.updatedAt = Date.now();
    saveStore();
    render();
  }
  $('#skipConfirmMask').hidden = true;
  unlockBodyScroll();
  pendingSkipItem = null;
  pendingSkipProject = null;
});

/* Esc 关闭弹窗 */
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('#progressMask').hidden) closeProgressBoard();
  else if (!$('#weaknessMask').hidden) closeWeaknessBoard();
  else if (!$('#dashMask').hidden) closeDashboard();
  else if (!$('#reasonKindMask').hidden) { $('#reasonKindClose').click(); }
  else if (!$('#skipConfirmMask').hidden) { $('#skipCancel').click(); }
  // confirmMasterMask 不响应 ESC，必须主动选择一个选项
  else if (!$('#settingsMask').hidden) closeSettings();
  else if (!$('#formMask').hidden) closeForm();
  else if (!$('#switchMask').hidden) closeSwitch();
  else if (!$('#modeSwitchConfirmMask').hidden) { $('#modeSwitchConfirmCancel').click(); }
  else if (!$('#randomReviewConfirmMask').hidden) { $('#randomReviewConfirmCancel').click(); }
  else if (!$('#genericConfirmMask').hidden) { $('#genericConfirmCancel').click(); }
  else if (!$('#mistakeGuideMask').hidden) { $('#mistakeGuideClose').click(); }
  else if (!$('#reviewModeHelpMask').hidden) { $('#reviewModeHelpClose').click(); }
  else if (!$('#importConfirmMask').hidden) { $('#importConfirmCancel').click(); }
  else if (!$('#tplManagerMask').hidden) { $('#tplManagerClose').click(); }
  else if (!$('#incognitoMask').hidden) { closeIncognito(); }
  // dataSecurityMask 不响应 ESC，必须等3秒后点击"我已知晓"
});

/* 统一表单回车导航：回车跳到下一个可见输入框，最后一个回车提交 */
setupEnterNav($('#exerciseForm'), $('#btnCheckin'));
setupEnterNav($('#setForm'), $('#btnSetCheckin'));
setupEnterNav($('#reciteForm'), $('#btnReciteAdd'));
setupEnterNav($('#formMask'), $('#formSave'));
setupEnterNav($('#settingsMask'), $('#settingsSave'));

/* 复习列表键盘快捷键：1=记得/做对，2=模糊/看答案，3=忘记/又错 */
document.addEventListener('keydown', e => {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  // 有任何弹窗打开时不响应
  if (!$('#confirmMasterMask').hidden || !$('#skipConfirmMask').hidden ||
      !$('#settingsMask').hidden || !$('#formMask').hidden ||
      !$('#switchMask').hidden || !$('#dashMask').hidden ||
      !$('#weaknessMask').hidden || !$('#progressMask').hidden ||
      !$('#reasonKindMask').hidden ||
      !$('#modeSwitchConfirmMask').hidden || !$('#randomReviewConfirmMask').hidden ||
      !$('#genericConfirmMask').hidden || !$('#mistakeGuideMask').hidden ||
      !$('#reviewModeHelpMask').hidden || !$('#importConfirmMask').hidden ||
      !$('#tplManagerMask').hidden ||
      !$('#dataSecurityMask').hidden || !$('#incognitoMask').hidden) return;
  if ($('#reviewSection').hidden) return;
  const map = { '1': 'good', '2': 'fuzzy', '3': 'forgot' };
  const q = map[e.key];
  if (!q) return;
  const firstItem = document.querySelector('#reviewList .review-item');
  if (!firstItem) return;
  const btn = firstItem.querySelector(`.q-btn[data-quality="${q}"]`);
  if (btn) { e.preventDefault(); btn.click(); }
});

/* 主题切换：用户可选 跟随系统 / 浅色 / 深色 */
document.querySelectorAll('input[name="theme"]').forEach(r => {
  r.addEventListener('change', () => { if (r.checked) setThemePref(r.value); });
});
/* 当用户选"跟随系统"时，系统偏好变了要跟着切 */
try {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => { if (getThemePref() === 'auto') applyTheme(); };
  if (mq.addEventListener) mq.addEventListener('change', handler);
  else if (mq.addListener) mq.addListener(handler);
} catch (e) {}

/* resize 重绘图表加 debounce，避免拖动窗口时高频重绘卡顿 */
let _resizeT = null;
window.addEventListener('resize', () => {
  if (_resizeT) clearTimeout(_resizeT);
  _resizeT = setTimeout(() => { if (lastMetrics) drawChart(lastMetrics.m, lastMetrics.p); }, 150);
});

/* ============ 启动 ============ */
(async function boot() {
  try {
  // 版本强制下线机制：大版本更新时清除登录态（仅 token/user，学习数据完整保留）
  // 每次需要强制全员重新登录时，修改下方 APP_VERSION 的值即可
  const APP_VERSION = '20261003';
  const VER_KEY = 'st_app_version';
  try {
    const lastVer = localStorage.getItem(VER_KEY);
    if (lastVer !== APP_VERSION) {
      // 仅清除登录态，学习数据（localStorage/IndexedDB）完整保留
      localStorage.removeItem('st_auth_token');
      localStorage.removeItem('st_auth_user');
      localStorage.setItem(VER_KEY, APP_VERSION);
      console.log('[版本更新] 已清除登录态，学习数据保留，需重新登录');
    }
  } catch (e) { /* localStorage 不可用时跳过 */ }
  applyTheme();
  initStorageSafety();
  await loadStore(); // 等待数据恢复完成（防止空数据覆盖 IndexedDB 备份）
  applyTheme(); // 数据恢复后重新应用主题：iOS 清 localStorage 后，store.localData 里的主题偏好从 IndexedDB 恢复，需要重新应用
  _booting = false;  // 恢复完成，允许保存
  // 账号系统：恢复登录状态并同步云端（追加，不影响原有逻辑）
  if (typeof STAuth !== 'undefined') STAuth.initAuth();

  // 数据安全提示不自动跳过：新用户首次进入会在下面弹一次（由 checkDataSecurityOnStart 按 DATA_SECURITY_KEY 控制）
  if (store.currentId && !store.projects[store.currentId]) {
    const ids = Object.keys(store.projects);
    store.currentId = ids.length ? ids[0] : null;
    saveStore();
  }
  $('#inDate').value = todayStr();
  $('#inSetDate').value = todayStr();
  $('#reciteDate').value = todayStr();
  render();
  // ux-16/26：所有表单输入框输入时仅清除对应红字错误（轻量样式），不触发全量 render/saveStore
  try { autoClearFieldError(); } catch (e) {}
  // 页面打开时补发今天错过的提醒（延迟 1.5 秒等页面渲染完成，此时 loadStore 已完成）
  setTimeout(checkAndFireReminders, 1500);
  // 主界面渲染完成后立即隐藏首屏加载界面（消除白屏）
  const splash = document.getElementById('splashScreen');
  if (splash) {
    splash.classList.add('splash-hide');
    setTimeout(() => { try { splash.remove(); } catch (e) {} }, 350);
  }
  // 弹窗逻辑延迟到下一帧，确保主界面先绘制完成
  // 新用户（无任何项目）：直接进入全屏欢迎页 #welcome
  // 老用户（有项目）：直接进入主界面 #app，不弹任何启动/引导/更新弹窗
  // 数据安全提示弹窗已禁用（已有云端账号同步保障数据安全）
  // requestAnimationFrame(() => {
  //   checkDataSecurityOnStart();
  // });
  // 检测无痕浏览模式
  // 无痕浏览检测已禁用（云端账号同步保障数据安全）  // setTimeout(checkIncognito, 1500);
  } catch (e) { console.error('boot 启动失败:', e); }
})();

/* ============ 账号系统 & 云端同步模块（STAuth） ============ */
