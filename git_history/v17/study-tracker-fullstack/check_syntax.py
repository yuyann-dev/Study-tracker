import re, subprocess, sys, os

html_path = r"C:\Users\MXyuan\Doubao\chats\2026-09-22\new-chat\study-tracker-fullstack\frontend\index.html"
with open(html_path, encoding='utf-8') as f:
    html = f.read()

# 提取所有script块（不含src属性的）
blocks = re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', html, re.DOTALL)
print("Script blocks:", len(blocks))

combined = "\n;\n".join(blocks)
tmp = os.path.join(os.environ.get('TEMP', '/tmp'), '_check.js')
with open(tmp, 'w', encoding='utf-8') as f:
    f.write(combined)

r = subprocess.run(['node', '--check', tmp], capture_output=True, text=True)
if r.returncode == 0:
    print("SYNTAX OK, total JS chars:", len(combined))
else:
    print("SYNTAX ERROR:")
    print(r.stderr[:3000])
