# -*- coding: utf-8 -*-
import re, subprocess, os
html_path = r'C:\Users\MXyuan\Doubao\chats\2026-10-01\new-chat\study-tracker-fullstack\frontend\index.html'
html = open(html_path, encoding='utf-8').read()
blocks = re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', html, re.DOTALL)
combined = "\n;\n".join(blocks)
tmp = os.path.join(os.environ.get('TEMP', '/tmp'), '_check_fe.js')
open(tmp, 'w', encoding='utf-8').write(combined)
r = subprocess.run(['node', '--check', tmp], capture_output=True, text=True)
print('script blocks:', len(blocks))
if r.returncode == 0:
    print('SYNTAX OK, JS chars:', len(combined))
else:
    print('SYNTAX ERROR:\n', r.stderr[:3000])
