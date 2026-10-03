# -*- coding: utf-8 -*-
"""头像前端加固：img 加载失败时回退默认图标（不改接口契约）。"""
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(ROOT, 'frontend', 'index.html')
html = open(P, encoding='utf-8', newline='').read()

def rep(old, new, expect=1):
    global html
    n = html.count(old)
    if n != expect:
        raise SystemExit(f'[FAIL] 期望{expect} 实际{n}: {old[:80]!r}')
    html = html.replace(old, new)
    print(f'[ok] x{n}  {old[:50]!r}')

# 顶栏头像图：加载失败回退 👤 默认
rep("btn.innerHTML = '<span class=\"user-avatar-btn\"><img src=\"' + avatar + '\" alt=\"\"></span>';",
    "btn.innerHTML = '<span class=\"user-avatar-btn\"><img src=\"' + avatar + '\" alt=\"\" onerror=\"this.outerHTML=\\'👤\\'\"></span>';")

# 个人中心头像图（渲染时）：失败回退 🐱
rep("avEl.innerHTML = '<img src=\"' + av + '\" alt=\"头像\">';",
    "avEl.innerHTML = '<img src=\"' + av + '\" alt=\"头像\" onerror=\"this.outerHTML=\\'🐱\\'\">';")

# 上传成功后立即写入的头像图：同样回退
rep("document.getElementById('profileAvatar').innerHTML = '<img src=\"' + data.avatar + '\" alt=\"头像\">';",
    "document.getElementById('profileAvatar').innerHTML = '<img src=\"' + data.avatar + '\" alt=\"头像\" onerror=\"this.outerHTML=\\'🐱\\'\">';")

open(P, 'w', encoding='utf-8', newline='').write(html)
print('DONE avatar hardening')
