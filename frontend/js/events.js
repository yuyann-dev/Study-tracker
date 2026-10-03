/* Study Tracker — 事件绑定、导入导出、反馈动效、弹窗 */
/* 自动从 app.js 拆分，对应原文件 L9574-12303 */

import { DEFAULT_INTERVALS, ERROR_REASONS, addDays, applyTheme, diffDays, getThemePref, openReasonDropdown, openReasonPopover, pendingNewReason, pendingNewReasonItemId, reasonPill, renderReasonDropdown, setThemePref, todayStr } from './utils.js';
import { $ } from './dom.js';
import { creatingLinkedFrom, cur, genId, getUIFlag, lastMetrics, markOfflineWrite, migrateProject, replaceStore, sanitizeStoreData, saveStore, setLocalVal, setUIFlag, store } from './storage.js';
import { _retentionExpanded, applyRetentionReview, applyReview, checkMistakeRelapseToast, clearAllFieldErrors, clearRetention, defaultComfortCap, findAvailableDate, gapForQuality, getComfortCap, getDueItems, getIntervals, getPaperSections, getSetState, isMistakeFreeMode, isMistakePageMode, isMistakeSetMode, isPageScopeCapable, isSetMode, maybeShowProgressPraise, mergeRanges, pendingConfirmFromSkip, pendingConfirmItem, pendingConfirmProject, rebalanceAllItems, reciteQuality, recomputeItemMastery, renderComfortAdvice, setFieldError, setupEnterNav, showConfirmMaster, showToast, showUndo, spreadExcessToday, spreadOverdueItems, unitName, updatePressurePanel, updateRecitePreview, updateSpreadPressureHint } from './review.js';
import { _expandedHistItems, closeProgressBoard, closeSwitch, drawChart, openProgressBoard, openSwitch, render } from './render.js';
import { _pick, addScopeRow, addUnitRow, addUnitRowToList, applyUnitTpl, captureSettingsSnapshot, closeDashboard, closeForm, closeSettings, closeWeaknessBoard, countRanges, doCloseSettings, editingProjectId, formIsPageScope, getBookDoneRanges, getTargetPageRanges, markSettingsDirty, modalTop, openDashboard, openFormCreate, openSettings, openTplManager, openWeaknessBoard, ppExpandedSet, readPaperSecRows, readScopeRows, readUnitRowsFromList, renderProgressBoard, renderUnitEditor, renderWeaknessBoard, savePaperTplFromEditor, saveUnitTplFromEditor, settingsInitialSnapshot, syncFormUnit, unlockBodyScroll, wbCurrentFilter } from './ui.js';

/* ============ 导出 / 导入 ============ */
export function showBusy(text){ $('#busyText').textContent = text; $('#busyMask').hidden = false; }
export function hideBusy(){ $('#busyMask').hidden = true; }
export function exportData() {
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

export function importData(file) {
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

export function doImport(imported, mode) {
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
    replaceStore(clean);
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
export function renderLinkedMistakesPopup() {
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

export function submitFormCreate() {
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
export function updateIntervalHint(mode) {
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
export function switchMistakeFormat(targetMode) {
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
export let pendingModeSwitch = null;
export function confirmModeSwitch(newMode) {
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

export function switchMistakeMode() {
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

export function handleUnitEditClick(e, listEl) {
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

export function submitSettings() {
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
export function clearRefsTo(deletedId) {
  Object.values(store.projects).forEach(other => {
    if (other.refProjectId === deletedId) other.refProjectId = null;
  });
}

/* 比对两个项目的单元/套卷结构是否一致 */
export function structuresMatch(p, ref) {
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
export function applyRefStructure(p, ref) {
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
export let _mouseDownInModal = false;
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
export let pageRangeMode = false;
export function applyPageModeUI() {
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
export function retainEntryValue(el) {
  if (!el) return;
  if (el.value) el.classList.add('page-retained');
  else el.classList.remove('page-retained');
}
['recitePageStart', 'recitePageEnd', 'reciteSetNo'].forEach(id => {
  const el = $(`#${id}`);
  if (el) el.addEventListener('input', () => el.classList.remove('page-retained'));
});

export function resetEntryInputs() {
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
export let setSelectedSecIds = [];   // 空数组 = 整套
export let setSecPct = {};           // { secId: '百分比字符串' }

export function syncSetFormUI(p) {
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

export function renderSetScopeMulti(p) {
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

export function renderSetScopePctList(p) {
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
export function finishNewReason(permanent) {
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
export let pendingSkipItem = null;
export let pendingSkipProject = null;

/* ============ 评价小反馈：结果文案 + 条目退场动效（错题/背书通用） ============ */
export let __fxFlying = 0;
// 正常复习评价的反馈（good/fuzzy/forgot）；直接毕业时 item.mastered 已为 true
export function getReviewFeedback(quality, p, item) {
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
export function getRetentionFeedback(item, result) {
  if (result === 'pass') {
    const full = _pick(['✓ 还记得，下次再巩固', '✓ 记得很牢，下次见', '✓ 稳，下次再巩固']);
    return { icon: full.slice(0, 1), text: full.slice(2) };
  }
  const full = _pick(['～ 模糊了，已排到最近重做', '～ 没关系，回到复习列表多过两遍']);
  return { icon: full.slice(0, 1), text: full.slice(2) };
}

// 清理过期未做的"提前复习"：如果用户点提前复习后当天没做，第二天恢复回原计划日期，不惩罚
export function cleanupExpiredEarlyPulls(p) {
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
export function playReviewFx(itemEl, kind, fb) {
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
export let milestoneFiredToday = {}; // key: projectId + ':' + date
export let milestoneCleanedDate = null;
export function checkReviewMilestone(p) {
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
export let genericConfirmCallback = null;
export let genericConfirmCancelCallback = null;
export function showGenericConfirm(title, bodyHtml, okText, onOk, onCancel) {
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
export function checkDataSecurityOnStart() {
  if (getUIFlag(DATA_SECURITY_KEY)) return; // 双写检查：localStorage 或 store.uiFlags 任一为 true 即视为已看过
  setTimeout(openDataSecurity, 350);
}

/* ============ 数据安全提示弹窗（只弹一次，3秒后才能关闭） ============ */
export const DATA_SECURITY_KEY = 'study_tracker_data_security_v3';
export function isIOSDevice() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/i.test(ua) ||
         // iPadOS 13+ 伪装成 Macintosh：用触点数>0 或 coarse pointer 判断，避免桌面 Mac 触控板误判
         (/Macintosh/i.test(ua) && (navigator.maxTouchPoints > 0 || (window.matchMedia && window.matchMedia('(any-pointer: coarse)').matches)));
}
/* 平台检测：只分三类——iOS、鸿蒙、其他，用于数据安全弹窗的个性化文案 */
export function getPlatformInfo() {
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
export function fillDataSecurityContent() {
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
export let _dsTimer = null;
export function openDataSecurity() {
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
export function closeDataSecurity() {
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
export let _incognitoWarned = false;
// 所有模态弹窗 ID，用于检测是否有其他弹窗打开（避免无痕弹窗与其他弹窗同时出现）
export const ALL_MODAL_IDS = ['dataSecurityMask','settingsMask','formMask','switchMask','dashMask','weaknessMask','progressMask','reasonKindMask','modeSwitchConfirmMask','randomReviewConfirmMask','genericConfirmMask','mistakeGuideMask','reviewModeHelpMask','importConfirmMask','confirmMasterMask','skipConfirmMask','tplManagerMask','linkedMistakesMask','installMask'];
export function anyModalOpen() {
  for (const id of ALL_MODAL_IDS) {
    const el = document.getElementById(id);
    if (el && !el.hidden) return true;
  }
  return false;
}
export function checkIncognito() {
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
export function closeIncognito() {
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
export let _resizeT = null;
window.addEventListener('resize', () => {
  if (_resizeT) clearTimeout(_resizeT);
  _resizeT = setTimeout(() => { if (lastMetrics) drawChart(lastMetrics.m, lastMetrics.p); }, 150);
});

