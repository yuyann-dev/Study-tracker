# -*- coding: utf-8 -*-
"""前端补丁：1) 浅色 body::before 接真实水彩纸；2) 深色接深牛皮纸；3) admin-56 自动刷新隐藏即停。"""
import re

P = r'C:\Users\MXyuan\Doubao\chats\2026-10-01\new-chat\study-tracker-fullstack\frontend\index.html'
s = open(P, 'r', encoding='utf-8', newline='').read()

pat1 = re.compile(r'background-image:url\("data:image/svg\+xml;utf8,[^)]*\);background-size:140px 140;opacity:\.05\}')
s, n1 = pat1.subn(
    'background-image:url("paper-warm.jpg");background-repeat:repeat;background-size:760px 760;opacity:1}', s)

pat2 = re.compile(r'background-image:url\("data:image/svg\+xml;utf8,[^)]*\);opacity:\.07\}')
s, n2 = pat2.subn(
    'background-image:url("paper-kraft.jpg");background-repeat:repeat;background-size:760px 760;opacity:1}', s)

old3 = '    adminAutoTimer = setInterval(function(){'
new3 = old3 + '\r\n      if (document.hidden) return;'
n3 = s.count(old3)
s = s.replace(old3, new3, 1)

open(P, 'w', encoding='utf-8', newline='').write(s)
print('light_paper=%d dark_kraft=%d admin56_hidden=%d' % (n1, n2, n3))
