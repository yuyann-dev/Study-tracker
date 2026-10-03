/* Study Tracker — 存储层、数据安全、预设模板、IndexedDB/Cache */
/* 自动从 app.js 拆分，对应原文件 L286-1497 */

import { $, DEFAULT_INTERVALS, addDays, todayStr } from './utils.js';
import { defaultComfortCap, showToast, staggerRetentionDate } from './review.js';

/* ============ 存储 ============ */
export const STORE_KEY = 'study_tracker_v2';
export let store = { currentId: null, projects: {}, unitTemplates: [], paperTemplates: [], tombstones: {} };
export let lastMetrics = null;
export let creatingLinkedFrom = null; // 从刷题本创建关联错题本时，存储刷题本ID

/**
 * 安全替换 store 引用（ES Module 导入绑定只读，外部模块不可直接 store = xxx）。
 * 供 events.js 覆盖式导入、auth.js 云端合并/登出清数据调用。
 * @param {object} data - 新的 store 对象
 */
export function replaceStore(data) {
  store = data;
  _lastSaveSig = '';
}

export function migrateProject(p) {
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
export function buildPresetUnits(chapters) {
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
export function getPresetUnitTemplates() {
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
export function sanitizeProjectData(p) {
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
export function sanitizeStoreData(s) {
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

export async function loadStore() {
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
export const IDB_NAME = 'study_tracker_safe';
export const IDB_STORE = 'snapshots';
export const IDB_QUEUE = 'opqueue'; // ux-28：离线写操作队列
export const IDB_VER = 2;
export const MAX_SNAPSHOTS = 5;
export let _idb = null;
export function idbOpen() {
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
export function idbPut(record) {
  return idbOpen().then(db => new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = e => reject(e.target.error);
    } catch (e) { reject(e); }
  }));
}
export function idbGetAll() {
  return idbOpen().then(db => new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = e => reject(e.target.error);
    } catch (e) { reject(e); }
  }));
}
export function idbDel(id) {
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
export let _offlineBar = null;
export function showOfflineBar(){
  if (_offlineBar) return;
  const bar = document.createElement('div');
  bar.id = 'offlineBar';
  bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99998;background:var(--warn);color:#fff;padding:10px 16px;font-size:13px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.2)';
  bar.textContent = '📡 离线模式，改动已保存在本地，联网后自动同步';
  document.body.appendChild(bar);
  _offlineBar = bar;
  document.body.style.paddingTop = '56px';
}
export function hideOfflineBar(){
  if (_offlineBar) { _offlineBar.remove(); _offlineBar = null; document.body.style.paddingTop = ''; }
}
// 离线时记录一条写操作（仅在离线时入队；本地数据早已落盘）
export function markOfflineWrite(type){
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
export const CACHE_NAME = 'study-tracker-data-v1';
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
export let _lastSaveSig = '';
export let _booting = true; // 启动恢复期间禁止写入，防止空数据覆盖备份
export function saveStore() {
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
export function getUIFlag(name) {
  try { if (localStorage.getItem(name) === '1') return true; } catch (e) {}
  return !!(store && store.uiFlags && store.uiFlags[name] === true);
}
export function setUIFlag(name) {
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
export function getLocalVal(key, defaultValue) {
  try {
    const v = localStorage.getItem(key);
    if (v !== null) return v;
  } catch (e) {}
  if (store && store.localData && store.localData[key] !== undefined) return store.localData[key];
  return defaultValue;
}
export function setLocalVal(key, value) {
  try { localStorage.setItem(key, value); } catch (e) {}
  if (store) {
    if (!store.localData || typeof store.localData !== 'object') store.localData = {};
    store.localData[key] = value;
    saveStore(); // 触发 IndexedDB + Cache 备份
  }
}

// ---- 顶部警告条 ----
export let _storageWarnShown = false;
export function showStorageWarning(html) {
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
export function isLocalStorageAvailable() {
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
export function isSafariLike() {
  return /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent) ||
         (navigator.vendor && navigator.vendor.indexOf('Apple') > -1 && !/CriOS|FxiOS/.test(navigator.userAgent));
}
/* 检测是否为"添加到主屏幕"的独立模式（iOS PWA）——此模式下与 Safari 存储隔离且可能被清理 */
export let _isPWA = false;
export function isPWAMode() {
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
export function ensureAppleTouchIconPNG() {
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
export function initStorageSafety() {
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
export function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
export function cur() { return store.currentId ? (store.projects[store.currentId] || null) : null; }
export let lastRenderedProjectId = null;

