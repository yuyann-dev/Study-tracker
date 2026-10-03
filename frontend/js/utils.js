/* Study Tracker — 工具函数、常量、主题、错因管理 */
/* 自动从 app.js 拆分，对应原文件 L1-285 */

import { saveStore, cur } from './storage.js';
import { modalTop } from './ui.js';

/* ============ 工具 ============ */
export const $ = s => document.querySelector(s);
export const pad2 = n => String(n).padStart(2, '0');
export const fmtDate = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const todayStr = () => fmtDate(new Date());
export const parseDate = s => { if (!s) return new Date(); const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const diffDays = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000);
export const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return fmtDate(d); };
export const fmtCN = s => { if (!s) return '未设置'; const d = parseDate(s); return `${d.getMonth() + 1}月${d.getDate()}日`; };
export const WEEK = ['周日','周一','周二','周三','周四','周五','周六'];
export const esc = s => String(s == null ? '' : s).replace(/[&<>"'\\]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','\\':'&#92;' }[c]));

/* ============ 主题管理 ============ */
export const THEME_KEY = 'study_tracker_theme';
export function getThemePref() {
  return getLocalVal(THEME_KEY, 'auto');
}
export function resolveTheme(pref) {
  if (pref === 'light' || pref === 'dark') return pref;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
export function applyTheme() {
  const pref = getThemePref();
  const resolved = resolveTheme(pref);
  document.documentElement.setAttribute('data-theme', resolved);
  // theme-color 随主题切换：深色用深色背景色，浅色用品牌紫，避免浏览器状态栏与页面割裂
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#273859' : '#2e6b4f');
  const radio = document.querySelector(`input[name="theme"][value="${pref}"]`);
  if (radio) radio.checked = true;
}
export function setThemePref(pref) {
  setLocalVal(THEME_KEY, pref);
  applyTheme();
}

export const TYPES = {
  exercise: { name:'刷题', icon:'✏️', badgeCls:'', typeCls:'type-exercise' },
  recite:   { name:'背书', icon:'📖', badgeCls:'recite', typeCls:'type-recite' },
  mistake:  { name:'错题', icon:'📝', badgeCls:'mistake', typeCls:'type-mistake' }
};

export const DEFAULT_INTERVALS = [1, 2, 4, 7, 15, 30];
export const ERROR_REASONS = [
  '概念不清 / 定义混淆',
  '公式记错',
  '计算失误',
  '审题不清 / 漏看条件',
  '思路卡壳 / 没思路',
  '知识点遗忘',
  '粗心 / 笔误',
  '其他'
];
export const REASON_COLORS = [
  ['#f8e5de', '#b02e24'], ['#fbf0da', '#96600c'], ['#e9ebdb', '#2e6b4f'],
  ['#e4ecd5', '#096f4e'], ['#f5e3dd', '#b04a5a'], ['#e4efe9', '#2a7a5c'],
  ['#f0e4d2', '#a06838'], ['#e9f6ef', '#15803d'], ['#fff3e0', '#b45309'],
  ['#e0f2f1', '#0f766e'], ['#fce8e6', '#b3261e'], ['#e9ebdb', '#2e6b4f'],
  ['#ffe9d6', '#c2410c'], ['#dcfce7', '#166534'], ['#f3e2d5', '#b0503a'],
  ['#e0ede6', '#1f6b4f'], ['#fef9c3', '#854d0e'], ['#e0efe8', '#0f766e'],
  ['#fce7f3', '#be185d'], ['#ecfccb', '#4d7c0f'],
  ['#ffedd5', '#9a3412'], ['#f3e7d8', '#b07a4b'], ['#ece5d6', '#5a4e3a']
];
export function reasonColor(name) {
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return REASON_COLORS[h % REASON_COLORS.length];
}
export function deleteReasonByName(p, name) {
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
export function reasonPill(name) {
  if (!name) return '';
  const [bg, fg] = reasonColor(name);
  // 深色模式下浅底白亮刺眼：把浅底降到 ~18% 透明度，文字色保持（深色卡上呈淡色晕）
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const bgCss = dark ? bg + '2e' : bg;
  return `<span class="reason-pill" style="background:${bgCss};color:${fg}">${esc(name)}</span>`;
}
export function reasonOptionList(p) {
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
export function renderReasonDropdown(p) {
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
export function openReasonDropdown() {
  const panel = $('#reasonDDPanel');
  panel.hidden = !panel.hidden;
}
// 记录当前打开 popover 所属的 itemId，用于"新增错因"直接挂到条目上
export let pendingNewReason = null;
export let pendingNewReasonItemId = null;

export function openReasonPopover(anchor, itemId) {
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

