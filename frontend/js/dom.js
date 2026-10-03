/* Study Tracker — DOM 查询工具（独立无依赖模块，避免循环依赖 TDZ） */
export const $ = s => document.querySelector(s);
