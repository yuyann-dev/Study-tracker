# -*- coding: utf-8 -*-
"""
Study Tracker 前端视觉修复补丁（任务1 深色中性化 + 任务2 进度条/环形可见性）
仅改动 frontend/index.html。用 open(newline='') 读写，保留 CRLF。
每个替换都带计数断言，未命中即报错，避免静默失败。
"""
import io, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(ROOT, 'frontend', 'index.html')

html = open(P, encoding='utf-8', newline='').read()
orig_len = len(html)

def rep(old, new, expect=None, count=0):
    """精确字符串替换；expect=期望出现次数，count=至少次数。"""
    global html
    n = html.count(old)
    if expect is not None and n != expect:
        raise SystemExit(f'[FAIL] 期望 {expect} 次，实际 {n} 次: {old[:70]!r}')
    if count and n < count:
        raise SystemExit(f'[FAIL] 至少 {count} 次，实际 {n} 次: {old[:70]!r}')
    if n == 0:
        raise SystemExit(f'[FAIL] 未命中: {old[:80]!r}')
    html = html.replace(old, new)
    print(f'[ok] x{n}  {old[:50]!r} -> {new[:50]!r}')

# ============================================================
# 任务1：深色暖橙褐 -> 中性墨褐/炭褐（R≈G≈B，B 略低，保留一丝暖调）
# 旧 ramp -> 新 ramp（全部为小写 hex，逐一全局替换）
#   bg      #2c2620 (44,38,32)  -> #282623 (40,38,35)
#   card    #373027 (55,48,39)  -> #34312e (52,49,46)
#   line    #4b4235 (75,66,53)  -> #4c4843 (76,72,67)
#   elev/focus #423a2f (66,58,47) -> #3b3733 (59,55,51)
#   input   #30291f (48,41,31)  -> #2e2b27 (46,43,39)
#   badge   #3a332a (58,51,42)  -> #38342f (56,52,47)
#   暖警告底 #2a2418 (42,36,24) -> #2a2723 (42,39,35) 中性化
# ============================================================
rep('#2c2620', '#282623', expect=5)
rep('#373027', '#34312e', expect=32)
rep('#4b4235', '#4c4843', expect=18)
rep('#423a2f', '#3b3733', expect=19)
rep('#30291f', '#2e2b27', expect=14)
rep('#3a332a', '#38342f', expect=11)
rep('#2a2418', '#2a2723', expect=15)

# ============================================================
# 任务2-A：环形 ringGrad 深色专用亮绿渐变
# 浅色保持原墨绿 #2e6b4f->#23533d；深色切亮绿 #8fbf9f->#6aae90
# ============================================================
# 1) 在 SVG defs 里新增 ringGradDark
old_defs = ('<linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">\n'
            '                <stop offset="0%" stop-color="#2e6b4f"/>\n'
            '                <stop offset="100%" stop-color="#23533d"/>\n'
            '              </linearGradient>')
# 注意原文件是 CRLF；上面用 \n 可能不匹配，改为读取后再判断
if old_defs not in html:
    old_defs = old_defs.replace('\n', '\r\n')
new_defs = old_defs + '\r\n              <linearGradient id="ringGradDark" x1="0%" y1="0%" x2="100%" y2="100%">\r\n                <stop offset="0%" stop-color="#8fbf9f"/>\r\n                <stop offset="100%" stop-color="#6aae90"/>\r\n              </linearGradient>'
rep(old_defs, new_defs, expect=1)

# 2) CSS：深色下 ring-fg 切到亮绿渐变；ring-bg 轨道略微提亮
old_ringfg = '.ring-fg{fill:none;stroke:url(#ringGrad);stroke-width:7;stroke-linecap:round;transition:stroke-dashoffset .5s}'
new_ringfg = ('.ring-fg{fill:none;stroke:url(#ringGrad);stroke-width:7;stroke-linecap:round;transition:stroke-dashoffset .5s}\n'
              '  html[data-theme="dark"] .ring-fg{stroke:url(#ringGradDark)}\n'
              '  html[data-theme="dark"] .ring-bg{stroke:rgba(255,255,255,.16)}')
rep(old_ringfg, new_ringfg, expect=1)

# ============================================================
# 任务2-B：深色进度条轨道可见性 + 浅色轨道中性化
# 原深色轨道块（#30291f 已被上面全局替换为 #2e2b27，与 bg 太接近）
# 重写为更可见的中性轨道 #38342f；并从轨道组里误纳入的 .unit-bar-fill（填充）剔除
# ============================================================
old_darktrack = ('html[data-theme="dark"] .bar{background:#2e2b27}\r\n'
                 '  html[data-theme="dark"] .unit-bar,\r\n'
                 '  html[data-theme="dark"] .unit-bar-fill,\r\n'
                 '  html[data-theme="dark"] .dash-proj .dp-bar,\r\n'
                 '  html[data-theme="dark"] .pp-sec-track,\r\n'
                 '  html[data-theme="dark"] .pp-unit-track,\r\n'
                 '  html[data-theme="dark"] .wb-unit-bar,\r\n'
                 '  html[data-theme="dark"] .wb-unit-group-bar,\r\n'
                 '  html[data-theme="dark"] .pp-dist-bar{background:#2e2b27}')
if old_darktrack not in html:
    # 兼容 LF
    old_darktrack = old_darktrack.replace('\r\n', '\n')
new_darktrack = ('html[data-theme="dark"] .bar{background:#38342f}\r\n'
                 '  html[data-theme="dark"] .unit-bar,\r\n'
                 '  html[data-theme="dark"] .dash-proj .dp-bar,\r\n'
                 '  html[data-theme="dark"] .pp-sec-track,\r\n'
                 '  html[data-theme="dark"] .pp-unit-track,\r\n'
                 '  html[data-theme="dark"] .wb-unit-bar,\r\n'
                 '  html[data-theme="dark"] .wb-unit-group-bar,\r\n'
                 '  html[data-theme="dark"] .pp-dist-bar{background:#38342f}')
rep(old_darktrack, new_darktrack, expect=1)

# 深色 storage-bar / sys-meter / trend zero 用的是 #4b4235(已->#4c4843=line)，可见度OK，无需改

# 浅色轨道紫灰 #eeeefa -> 暖中性（与纸调一致）
rep('background:#eeeefa', 'background:#ebe3d4', expect=4)
# 浅色 dp-bar / pp-sec-track 紫灰 #ecebf5 -> 暖中性
rep('background:#ecebf5', 'background:#ebe3d4', expect=4)
# 浅色 dash-card 偏紫 #fafafe -> 暖纸白
rep('background:#fafafe', 'background:#fbf6ec', expect=1)

# ============================================================
# 任务2-C：dg-fill 各状态去发光（box-shadow -> none），保留哑光纯色
# ============================================================
rep('.daily-goal.dg-almost .dg-fill{background:var(--warn);box-shadow:0 0 8px rgba(224,138,0,.35)}',
    '.daily-goal.dg-almost .dg-fill{background:var(--warn);box-shadow:none}', expect=1)
rep('.daily-goal.dg-done .dg-fill{background:var(--ok);box-shadow:0 0 8px rgba(14,164,114,.35)}',
    '.daily-goal.dg-done .dg-fill{background:var(--ok);box-shadow:none}', expect=1)
rep('.daily-goal.dg-over .dg-fill{background:var(--warn);box-shadow:0 0 8px rgba(224,138,0,.35)}',
    '.daily-goal.dg-over .dg-fill{background:var(--warn);box-shadow:none}', expect=1)
rep('.daily-goal.dg-done-all .dg-fill{background:var(--ok);box-shadow:0 0 8px rgba(14,164,114,.35)}',
    '.daily-goal.dg-done-all .dg-fill{background:var(--ok);box-shadow:none}', expect=1)

open(P, 'w', encoding='utf-8', newline='').write(html)
print('DONE. len', orig_len, '->', len(html))
