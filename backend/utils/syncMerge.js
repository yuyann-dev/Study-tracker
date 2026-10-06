/**
 * utils/syncMerge.js — 服务端多设备数据合并（与前端 mergeStores 保持同一套语义）
 *
 * 作用：PUT 上传时不做全量覆盖，而是把「云端现有数据」与「客户端上传数据」
 *      对称合并，从根本上防止一台设备的全量推送冲掉另一台设备的删除/修改。
 *
 * ── 当前合并边界（务必与论文/答辩口径一致，thesis-1.1 / thesis-2.4）──
 *   本系统是「LWW（Last-Write-Wins）+ 墓碑」的工程变体，不是 CRDT / OT：
 *     · 顶层 tombstones   —— 按 id 取 max 墓碑（删除标记对称合并，旧推送不能复活已删数据）；
 *     · projects          —— 项目级 updatedAt LWW：两端都有同一项目时以 updatedAt 较新者为基底；
 *     · records（打卡记录）—— 按 rid 做集合 union（两端各补对方没有的 rid）；
 *     · items（背书条目/错题）—— 按 id 做集合 union；同一 id 两端都有时按
 *           item.updatedAt（缺失则比 reviews 数组长度，再缺失保留 base）做整对象 LWW
 *           （选 updatedAt 较新的整条 item 覆盖，不是字段级合并），并按 tombstones
 *           过滤已删条目；保证「两台设备改不同 item」互不覆盖（thesis-57 / items 合并）。
 *
 * ── 已知局限（thesis-62，仅在文档/注释承认，不改协议）──
 *   1. 项目级字段冲突（两端同时改项目名）会丢一个修改——项目字段整体随 LWW 基底走；
 *   2. updatedAt 用的是**客户端 wall-clock 时间戳**，设备时钟漂移会误判谁更新；
 *      服务端已在 PUT 响应返回服务端 updated_at，但客户端下次同步尚未以其重算。
 *      这是明确记录的未来工作（引入 per-item 逻辑时钟 / 版本向量）。
 */

function clone(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

function mergeTombstones(a, b) {
  var out = {};
  [a || {}, b || {}].forEach(function (src) {
    Object.keys(src).forEach(function (id) {
      var t = Number(src[id]) || 0;
      if (!out[id] || t > out[id]) out[id] = t;
    });
  });
  return out;
}

/**
 * 墓碑 GC：删除 N 天前的墓碑，防止服务端 tombstones 无限增长（thesis-1.5）。
 * 与前端 pruneTombstones（frontend/index.html:15684）对齐阈值，默认 30 天。
 * 墓碑值是客户端 Date.now()（epoch 毫秒）。
 * @param {object} store 完整 store（就地修改其 tombstones 后返回）
 * @param {number} [days=30] 保留最近 N 天
 * @returns {object} 处理后的 store
 */
function pruneTombstones(store, days) {
  if (!store || typeof store !== 'object') return store || {};
  days = days == null ? 30 : Number(days);
  var cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  var t = store.tombstones;
  if (t && typeof t === 'object') {
    Object.keys(t).forEach(function (id) {
      if ((Number(t[id]) || 0) < cutoff) delete t[id];
    });
  }
  return store;
}

function mergeTemplates(a, b) {
  var out = [];
  var seen = new Set();
  [a || [], b || []].forEach(function (arr) {
    if (!Array.isArray(arr)) return;
    arr.forEach(function (t) {
      if (!t || !t.id || String(t.id).indexOf('preset_') === 0) return;
      if (seen.has(t.id)) return;
      seen.add(t.id);
      out.push(clone(t));
    });
  });
  return out;
}

/**
 * 合并同一项目两端的 items：按 id 做集合 union；同 id 两端都存在时做整对象 LWW
 * （选 updatedAt 较新的整条 item 覆盖，不是字段级合并）。
 * LWW 比较优先级：
 *   1) item.updatedAt 较大者胜（都没有 updatedAt 时视为 0，打平进入下一步）；
 *   2) reviews 数组较长者胜（复习评价更多，状态更新）；
 *   3) 仍打平则保留已积累的 base（先入为主，避免抖动）。
 * 墓碑过滤：条目删除即终态，不支持复活（条目无 updatedAt 字段，删除胜出）；
 *   只要 tombstones 中存在该 item.id，就抑制，不进入结果。
 * @param {Array} aItems 基底一端的 items
 * @param {Array} bItems 另一端的 items
 * @param {Object} [tombstones] 按 itemId 索引的删除墓碑（epoch 毫秒）
 * @returns {Array} 合并后的 items（新数组）
 */
function mergeItems(aItems, bItems, tombstones) {
  var byId = new Map();
  var order = [];

  function consider(it) {
    if (!it || !it.id) return;
    // 墓碑过滤：条目删除即终态，不支持复活（条目无 updatedAt 字段，删除胜出）；
    // 只要 tombstones 中存在该 id，就抑制，不进入合并结果（防已删 item 同步时复活）。
    if (tombstones && tombstones[it.id]) return;
    if (!byId.has(it.id)) {
      var fresh = clone(it);
      byId.set(it.id, fresh);
      order.push(it.id);
      return;
    }
    var existing = byId.get(it.id);
    // 同 id 两端都有：按 updatedAt → reviews 长度 → 保留 base 做 LWW
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
    if (winner !== existing) {
      // 把胜出方的字段整体覆盖进 existing（保持 Map/order 引用稳定）
      var merged = clone(winner);
      Object.keys(existing).forEach(function (k) { delete existing[k]; });
      Object.keys(merged).forEach(function (k) { existing[k] = merged[k]; });
    }
  }

  [aItems, bItems].forEach(function (arr) {
    if (Array.isArray(arr)) arr.forEach(consider);
  });
  return order.map(function (id) { return byId.get(id); });
}

function mergeProjects(existingProjects, incomingProjects, tombstones) {
  var ep = existingProjects || {};
  var ip = incomingProjects || {};
  var out = {};
  var allIds = new Set(Object.keys(ep).concat(Object.keys(ip)));

  allIds.forEach(function (id) {
    var a = ep[id] ? clone(ep[id]) : null;
    var b = ip[id] ? clone(ip[id]) : null;
    var deletedAt = tombstones[id] ? Number(tombstones[id]) : 0;

    // 应用墓碑：项目不新于删除时间则视为已删除
    if (a && deletedAt && (Number(a.updatedAt) || 0) <= deletedAt) a = null;
    if (b && deletedAt && (Number(b.updatedAt) || 0) <= deletedAt) b = null;
    if (!a && !b) return;
    if (!a) { out[id] = b; return; }
    if (!b) { out[id] = a; return; }

    // 双方都有：以 updatedAt 较新者为基底（项目级 LWW），再合并 records 与 items
    var au = Number(a.updatedAt) || 0;
    var bu = Number(b.updatedAt) || 0;
    var base = bu > au ? b : a;
    var other = bu > au ? a : b;
    var bumped = false;
    var mergedP = base;

    // records：按 rid 集合 union，按日期排序
    if (Array.isArray(base.records) && Array.isArray(other.records)) {
      var have = new Set(base.records.map(function (r) { return r.rid; }).filter(Boolean));
      // 记录无 updatedAt，墓碑即永久抑制（记录不可编辑，删除即终态）
      var extra = other.records.filter(function (r) {
        return r.rid && !have.has(r.rid) && !(tombstones && tombstones[r.rid]);
      });
      if (extra.length) {
        mergedP.records = base.records.concat(extra);
        mergedP.records.sort(function (x, y) {
          var dx = String(x.date || ''), dy = String(y.date || '');
          return dx < dy ? -1 : dx > dy ? 1 : 0;
        });
        bumped = true;
      }
    }

    // items：按 id 集合 union + 整对象 LWW（thesis-57，防两端改不同 item 互相覆盖）+ 墓碑过滤
    if (Array.isArray(base.items) || Array.isArray(other.items)) {
      mergedP.items = mergeItems(base.items, other.items, tombstones);
      bumped = true;
    }

    if (bumped) mergedP.updatedAt = Math.max(au, bu);
    out[id] = mergedP;
  });
  return out;
}

/**
 * 对称合并两份完整 store
 * @param {object|null} existing 云端现有 store
 * @param {object|null} incoming 客户端上传 store
 */
function mergeStoresServer(existing, incoming) {
  existing = existing && typeof existing === 'object' ? existing : {};
  incoming = incoming && typeof incoming === 'object' ? incoming : {};

  var tombstones = mergeTombstones(existing.tombstones, incoming.tombstones);
  var projects = mergeProjects(existing.projects, incoming.projects, tombstones);

  var out = {};
  // 保留双方其余顶层字段（incoming 优先）
  Object.keys(existing).forEach(function (k) {
    if (['projects', 'tombstones', 'unitTemplates', 'paperTemplates', 'currentId'].indexOf(k) === -1) {
      out[k] = clone(existing[k]);
    }
  });
  Object.keys(incoming).forEach(function (k) {
    if (['projects', 'tombstones', 'unitTemplates', 'paperTemplates', 'currentId'].indexOf(k) === -1) {
      out[k] = clone(incoming[k]);
    }
  });

  out.tombstones = tombstones;
  out.projects = projects;
  out.unitTemplates = mergeTemplates(existing.unitTemplates, incoming.unitTemplates);
  out.paperTemplates = mergeTemplates(existing.paperTemplates, incoming.paperTemplates);

  // currentId：优先上传方有效 currentId，其次云端，最后第一个任务
  out.currentId = incoming.currentId && projects[incoming.currentId]
    ? incoming.currentId
    : existing.currentId && projects[existing.currentId]
      ? existing.currentId
      : Object.keys(projects)[0] || null;

  return out;
}

module.exports = { mergeStoresServer, mergeTombstones, mergeProjects, mergeItems, pruneTombstones, clone };
