/* Study Tracker — 主渲染、图表、项目切换、进度面板 */
/* 自动从 app.js 拆分，对应原文件 L5131-6869 */

import { TYPES, addDays, diffDays, esc, fmtCN, parseDate, reasonPill, renderReasonDropdown, todayStr } from './utils.js';
import { $ } from './dom.js';
import { cur, getLocalVal, getUIFlag, lastMetrics, lastRenderedProjectId, saveStore, setLocalVal, setUIFlag, store } from './storage.js';
import { RETENTION_SHOWN_CAP, __autoBalanceToastShown, __milestoneFiredToday, _msKey, _retentionExpanded, _setBigNum, autoBalanceIfNeeded, checkMilestones, checkMistakeMasteryToast, countClippedRanges, defaultComfortCap, ensureAtLeastOneReview, fmtItemLocator, getCompletedPagesAtDate, getDailyTarget, getDueItems, getItemIntervals, getItemScore, getLazyInfo, getLazyMessage, getMasteryInfo, getMetrics, getMistakeFeasibility, getNormalizedSections, getOverdueItems, getPaperSections, getRecordRange, getRetentionDueItems, getRetentionOverdueItems, getStatusMessage, getUnitItemEntries, getUnitMastery, hasPageLocator, hasSetLocator, isMistakeFreeMode, isMistakePageMode, isMistakeSetMode, isSetMode, masteryFromScore, mergeRanges, paperLabel, pullForwardIfNeeded, rebalanceForSprint, renderDailyGoal, renderStageOptions, scrollToEntryForm, settleToday, showToast, stretchShort, unitName, updateRecitePreview } from './review.js';
import { getBookDoneRanges, modalTop, openDashboard, renderProgressBoard, unlockBodyScroll } from './ui.js';
import { anyModalOpen, applyPageModeUI, applyRefStructure, cleanupExpiredEarlyPulls, showGenericConfirm, structuresMatch, switchMistakeFormat, syncSetFormUI } from './events.js';

/* ============ 主渲染 ============ */
export function render() {
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

export function renderReview(p) {
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
export const REVIEW_BATCH_SIZE = 20;
export let _reviewIO = null;
export let _reviewBatch = null;
export function appendNextReviewBatch(){
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
export function ensureKbdHintBar(p){
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

export function renderUnits(p, m) {
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
export const _sortCache = { key: '', value: null };
export function getSortedCached(p, kind){
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

export function renderExerciseRecords(p) {
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
export const _expandedHistItems = new Set();

export function renderReciteRecords(p) {
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
export function drawChart(m, p) {
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
export function openSwitch() { renderProjectList(); $('#switchMask').hidden = false; modalTop($('#switchMask')); }
export function closeSwitch() { const m=$('#switchMask'); if(m.hidden) return; m.hidden=true; unlockBodyScroll(); }

export function renderProjectList() {
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
export function openProgressBoard() {
  const p = cur();
  if (!p || p.type !== 'exercise') return;
  renderProgressBoard(p);
  $('#progressMask').hidden = false;
  modalTop($('#progressMask'));
}
export function closeProgressBoard() { const m=$('#progressMask'); if(m.hidden) return; m.hidden=true; unlockBodyScroll(); }

