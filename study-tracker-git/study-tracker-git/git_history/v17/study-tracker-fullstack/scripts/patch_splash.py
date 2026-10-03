# -*- coding: utf-8 -*-
"""splash 图标统一：去掉 light/dark 双图与深色分支，改为单一统一图标。"""
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(ROOT, 'frontend', 'index.html')
html = open(P, encoding='utf-8', newline='').read()
NL = '\r\n' if '\r\n' in html else '\n'

def rep(old, new, expect=1):
    global html
    n = html.count(old)
    if n != expect:
        raise SystemExit(f'[FAIL] 期望{expect} 实际{n}: {old[:80]!r}')
    html = html.replace(old, new)
    print(f'[ok] x{n}  {old[:50]!r}')

# 1) splash 结构：双图 -> 单图
rep('<div class="splash-logo"><img class="splash-logo-light" src="icon-192.png" alt="Study Tracker"><img class="splash-logo-dark" src="icon-logo-dark-512.png" alt="Study Tracker"></div>',
    '<div class="splash-logo"><img src="icon-192.png" alt="Study Tracker"></div>')

# 2) 删除深色分支 CSS（保留 .splash-logo / .splash-logo img 基础规则与深色 splash 背景 #282623）
rep('.splash-logo-dark{display:none}' + NL, '')
rep('html[data-theme="dark"] .splash-logo-light{display:none}' + NL, '')
rep('html[data-theme="dark"] .splash-logo-dark{display:block}' + NL, '')

open(P, 'w', encoding='utf-8', newline='').write(html)
print('DONE splash unify')
