# -*- coding: utf-8 -*-
"""把 index.html body::before 的 SVG 高频噪点替换为真实水彩纸/牛皮纸位图。"""
import os
import re

BASE = os.path.dirname(os.path.abspath(__file__))
P = os.path.join(BASE, 'frontend', 'index.html')

with open(P, 'r', encoding='utf-8', newline='') as f:
    html = f.read()

new_light = ('body::before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;\r\n'
             '    background-image:url("paper-warm.jpg");background-repeat:repeat;background-size:760px 760px}')
new_dark = ('html[data-theme="dark"] body::before{'
            'background-image:url("paper-kraft.jpg");background-repeat:repeat;background-size:760px 760px}')

html, n1 = re.subn(r'body::before\{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;.*?opacity:\.05\}',
                   new_light, html, count=1, flags=re.S)
html, n2 = re.subn(r'html\[data-theme="dark"\] body::before\{.*?opacity:\.07\}',
                   new_dark, html, count=1, flags=re.S)

print('light replaced:', n1, 'dark replaced:', n2)
assert n1 == 1 and n2 == 1, '替换数量异常'

with open(P, 'w', encoding='utf-8', newline='') as f:
    f.write(html)

# 验证：body::before 已引用新纸纹，且旧 feTurbulence 在背景规则中不再出现
print('paper-warm ref count:', html.count('url("paper-warm.jpg")'))
print('paper-kraft ref count:', html.count('url("paper-kraft.jpg")'))
# 全局是否还有 feTurbulence（其他地方可能合法使用，仅报告）
print('feTurbulence total in file:', html.count('feTurbulence'))
