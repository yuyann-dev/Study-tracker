/* Study Tracker — 应用入口（ES Modules）
 * 导入子模块，组装公共 API 到 window（供 auth.js classic script 访问），
 * 导入 events.js 执行事件绑定副作用，执行 boot() 启动应用。
 */

// ===== 工具 =====
import {
  $, esc, todayStr, fmtDate, parseDate, diffDays, addDays, fmtCN,
  applyTheme, setThemePref, getThemePref, resolveTheme,
  reasonColor, reasonPill, reasonOptionList, deleteReasonByName,
  renderReasonDropdown, openReasonDropdown, openReasonPopover,
  TYPES, DEFAULT_INTERVALS, ERROR_REASONS, REASON_COLORS, WEEK,
  pendingNewReason, pendingNewReasonItemId,
} from './utils.js';

// ===== 存储 =====
import {
  store, saveStore, loadStore, cur, genId, STORE_KEY, IDB_NAME, CACHE_NAME,
  sanitizeStoreData, sanitizeProjectData, initStorageSafety, _booting, replaceStore,
  getLocalVal, setLocalVal, getUIFlag, setUIFlag,
  migrateProject, buildPresetUnits, getPresetUnitTemplates,
  idbOpen, idbPut, idbGetAll, idbDel,
  showOfflineBar, hideOfflineBar, markOfflineWrite,
  showStorageWarning, isLocalStorageAvailable, isSafariLike, isPWAMode,
  ensureAppleTouchIconPNG, lastMetrics, creatingLinkedFrom, lastRenderedProjectId,
} from './storage.js';

// ===== 复习算法 =====
import {
  showToast, setFieldError, clearFieldError, clearAllFieldErrors, autoClearFieldError,
  scrollToEntryForm, showListShimmer, showUndo,
  getMetrics, getIntervals, getReviewCycleDays, calcNextReviewDateFromLearn,
  isSetMode, isMistakeFreeMode, isMistakePageMode, isMistakeSetMode,
  isPageScopeCapable, mistakeUsesUnits, unitName, fmtUnitNum,
  mergeRanges, countMergedPages, countClippedRanges, getRecordRange,
  getPaperSections, getNormalizedSections, paperLabel, getSetState,
  getSetFraction, getCompletedSets, getCompletedPages, getCompletedPagesAtDate,
  getDueItems, getOverdueItems, getRetentionGap, staggerRetentionDate,
  scheduleRetention, clearRetention, getRetentionDueItems, getRetentionOverdueItems,
  applyRetentionReview, compareItemPriority, spreadOverdueItems, spreadItems,
  spreadExcessToday, rebalanceAllItems, getReviewCountsByDate,
  getActivityCountsByDate, getStudyDayRatio, getDeadlineLevelCap,
  defaultComfortCap, getComfortCap, getComfortAdvice, renderComfortAdvice,
  getSpreadDayCap, getBacklogCatchUp, getDailyCapacity, getWeekdayAwareCap,
  getReviewLoadOnDate, updatePressurePanel, updateSpreadPressureHint,
  getActivityDateSet, getActivityStreak, getLazyInfo, getLazyMessage,
  findAvailableDate, scheduleNextReview, rebalanceForSprint,
  getMistakeCollectRate, getMistakeDayPlan, getMistakeFeasibility,
  pullForwardIfNeeded, ensureAtLeastOneReview, settleToday, autoBalanceIfNeeded,
  canBeSpread, getItemIntervals, transitionReview, recomputeItemMastery,
  applyReview, showConfirmMaster, confirmMasterItem, closeConfirmMaster,
  getItemScore, getMasteryInfo, getUnitItemEntries, getUnitPageRanges,
  getRefUnitProgress, getUnitMastery, masteryFromScore,
  stretchShort, stretchFull, getCatchUpPlan, getDailyTarget,
  coachSlot, fmtDaysLeft, getStatusMessage, checkProgressPraise,
  maybeShowProgressPraise, checkMilestones, checkMistakeMasteryToast,
  checkMistakeRelapseToast, gapForQuality, setupReciteQuality,
  renderStageOptions, updateRecitePreview, renderDailyGoal,
  getItemPageStart, getItemPageEnd, hasPageLocator, hasSetLocator,
  fmtPageRange, getItemSource, fmtItemLocator, getNavFields, setupEnterNav,
  _navFieldVisible, pendingConfirmItem, pendingConfirmProject,
  pendingConfirmFromSkip, reciteQuality,
} from './review.js';

// ===== 渲染 =====
import {
  render, renderReview, appendNextReviewBatch, ensureKbdHintBar,
  renderUnits, getSortedCached, renderExerciseRecords, renderReciteRecords,
  drawChart, openSwitch, closeSwitch, renderProjectList,
  openProgressBoard, closeProgressBoard,
} from './render.js';

// ===== UI 组件 =====
import {
  isValidHHMM, getReminder, saveReminder, getFiredMark, currentStreak,
  timeGreeting, getKaoyanInfo, getKaoyanHTML, getMondayOf, buildWeeklyStats,
  getWeeklyReviewHTML, getTodayReviewedCount, getTodayStatus,
  openDashboard, closeDashboard, lockBodyScroll, unlockBodyScroll, modalTop,
  stActiveMask, stScrollFocused, buildReminderBody, ensureInAppReminderEl,
  showInAppReminder, playReminderBeep, fireReminder, checkAndFireReminders,
  rangeText, getTargetPageRanges, getBookDoneRanges, complementRanges,
  countRanges, renderProgressBoard, renderProgressInsights, renderSetGrid,
  renderBookBreakdown, rangeChipsBlock, addPaperSecRow, readPaperSecRows,
  refreshPaperSecSum, applyPaperTemplate, formIsPageScope, syncFormUnit,
  openFormCreate, closeForm, openSettings, captureSettingsSnapshot,
  isSettingsDirty, markSettingsDirty, syncSPaperLabel, closeSettings,
  doCloseSettings, renderUnitEditor, addUnitRow, addUnitRowToList,
  addScopeRow, readScopeRows, renderScopeEditor, updateScopeCount,
  refreshUnitTplSelect, refreshPaperTplSelect, applyUnitTpl, applyPaperTpl,
  saveUnitTplFromEditor, savePaperTplFromEditor, readUnitRows,
  readUnitRowsFromList, openTplManager, renderTplManagerList, editTpl,
  renameTpl, deleteTpl, openWeaknessBoard, closeWeaknessBoard,
  renderWeaknessBoard, ppExpandedSet, editingProjectId, settingsInitialSnapshot,
  tplManagerType, wbCurrentFilter,
} from './ui.js';

// ===== 事件绑定（副作用：执行所有 addEventListener） =====
import './events.js';

// 从 events.js 导入需要在 boot / window 暴露的符号
import {
  showBusy, hideBusy, exportData, importData, doImport,
  renderLinkedMistakesPopup, submitFormCreate, updateIntervalHint,
  switchMistakeFormat, confirmModeSwitch, switchMistakeMode,
  handleUnitEditClick, submitSettings, clearRefsTo, structuresMatch,
  applyRefStructure, applyPageModeUI, retainEntryValue, resetEntryInputs,
  syncSetFormUI, renderSetScopeMulti, renderSetScopePctList,
  finishNewReason, getReviewFeedback, getRetentionFeedback,
  cleanupExpiredEarlyPulls, playReviewFx, checkReviewMilestone,
  showGenericConfirm, checkDataSecurityOnStart, isIOSDevice,
  getPlatformInfo, fillDataSecurityContent, openDataSecurity,
  closeDataSecurity, anyModalOpen, checkIncognito, closeIncognito,
  pageRangeMode, setSelectedSecIds, setSecPct, pendingModeSwitch,
  pendingSkipItem, pendingSkipProject, genericConfirmCallback,
  genericConfirmCancelCallback, milestoneFiredToday, milestoneCleanedDate,
} from './events.js';

/* ===== 暴露到 window（供 auth.js classic script 和内联 onclick 访问） ===== */
// store 用活引用暴露：getter 返回模块内当前 store，setter 调 replaceStore（重置去重签名）。
// 这样 auth.js 里的 store = merged / store = {...} 会自动走 replaceStore，
// loadStore 后模块内 store 重绑定也能通过 getter 反映到 auth.js，不会出现"过期快照"。
Object.defineProperty(window, 'store', {
  get: () => store,
  set: (v) => { replaceStore(v); },
  configurable: true,
});
window.replaceStore = replaceStore;

const __APP__ = {
  // 存储（store 已通过 defineProperty 暴露，不在此重复）
  saveStore, loadStore, cur, genId, STORE_KEY, IDB_NAME, CACHE_NAME,
  sanitizeStoreData, sanitizeProjectData, replaceStore,
  // 渲染
  render, renderUnits, renderReview, renderExerciseRecords, renderReciteRecords,
  renderProjectList, drawChart,
  // UI
  showToast, openSettings, closeSettings, openFormCreate, closeForm,
  openSwitch, closeSwitch, openDashboard, closeDashboard,
  openProgressBoard, closeProgressBoard, openWeaknessBoard, closeWeaknessBoard,
  openDataSecurity, closeDataSecurity, showGenericConfirm,
  showBusy, hideBusy, exportData, importData,
  // 工具
  esc, todayStr, fmtDate, parseDate, diffDays, addDays, fmtCN,
  applyTheme, setThemePref, getThemePref, $,
  // 复习
  applyReview, scheduleNextReview, getIntervals, getMetrics,
  // 事件
  setupEnterNav,
};
for (const _k of Object.keys(__APP__)) {
  window[_k] = __APP__[_k];
}

/* ============ 启动 ============ */
(async function boot() {
  try {
  applyTheme();
  initStorageSafety();
  await loadStore(); // 等待数据恢复完成（防止空数据覆盖 IndexedDB 备份）
  applyTheme(); // 数据恢复后重新应用主题：iOS 清 localStorage 后，store.localData 里的主题偏好从 IndexedDB 恢复，需要重新应用
  _booting = false;  // 恢复完成，允许保存
  // 账号系统：恢复登录状态并同步云端（追加，不影响原有逻辑）
  if (typeof STAuth !== 'undefined') STAuth.initAuth();

  if (store.currentId && !store.projects[store.currentId]) {
    const ids = Object.keys(store.projects);
    store.currentId = ids.length ? ids[0] : null;
    saveStore();
  }
  $('#inDate').value = todayStr();
  $('#inSetDate').value = todayStr();
  $('#reciteDate').value = todayStr();
  render();
  try { autoClearFieldError(); } catch (e) {}
  setTimeout(checkAndFireReminders, 1500);
  const splash = document.getElementById('splashScreen');
  if (splash) {
    splash.classList.add('splash-hide');
    setTimeout(() => { try { splash.remove(); } catch (e) {} }, 350);
  }
  } catch (e) { console.error('boot 启动失败:', e); }
})();
