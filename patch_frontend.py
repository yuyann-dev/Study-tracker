# -*- coding: utf-8 -*-
import io

path = r"C:\Users\MXyuan\Doubao\chats\2026-09-22\new-chat\study-tracker-fullstack\frontend\index.html"
with io.open(path, "r", encoding="utf-8") as f:
    src = f.read()

changes = 0

# 1. 删除 registerHint div
old1 = '    <div class="register-hint" id="registerHint">💡 第一个注册的用户自动成为管理员，无需邀请码</div>\n'
if old1 in src:
    src = src.replace(old1, '')
    changes += 1
    print("1. 删除 registerHint div")
else:
    print("1. MISS registerHint div")

# 2. 删除 registerHint JS 引用
old2 = """    var rh = document.getElementById('registerHint');
    if (rh) rh.classList.toggle('show', mode === 'register');
"""
if old2 in src:
    src = src.replace(old2, '')
    changes += 1
    print("2. 删除 registerHint JS")
else:
    print("2. MISS registerHint JS")

# 3. 禁用数据安全弹窗自动弹出（注释掉调用）
old3 = """  requestAnimationFrame(() => {
    checkDataSecurityOnStart();
  });"""
new3 = """  // 数据安全提示弹窗已禁用（已有云端账号同步保障数据安全）
  // requestAnimationFrame(() => {
  //   checkDataSecurityOnStart();
  // });"""
if old3 in src:
    src = src.replace(old3, new3)
    changes += 1
    print("3. 禁用数据安全弹窗自动弹出")
else:
    print("3. MISS checkDataSecurityOnStart call")

# 4. 更新启动流程注释
old4 = """  // 新用户（无任何项目）：只弹数据安全提示，关闭后停留在全屏欢迎页 #welcome
  // 老用户（有项目）：直接进入主界面 #app，不弹任何启动/引导/更新弹窗"""
new4 = """  // 新用户（无任何项目）：直接进入全屏欢迎页 #welcome
  // 老用户（有项目）：直接进入主界面 #app，不弹任何启动/引导/更新弹窗"""
if old4 in src:
    src = src.replace(old4, new4)
    changes += 1
    print("4. 更新启动流程注释")
else:
    print("4. MISS boot comment")

with io.open(path, "w", encoding="utf-8") as f:
    f.write(src)

print(f"\n完成 {changes}/4 处修改，文件大小: {len(src)} bytes")
