# -*- coding: utf-8 -*-
import io, re

path = r"C:\Users\MXyuan\Doubao\chats\2026-09-22\new-chat\study-tracker-fullstack\frontend\index.html"
with io.open(path, "r", encoding="utf-8") as f:
    src = f.read()

changes = []

# === 1. 删除注册页"第一个注册默认管理员"提示文字 ===
old1 = '    <div class="register-hint" id="registerHint">💡 第一个注册的用户自动成为管理员，无需邀请码</div>\n'
if old1 in src:
    src = src.replace(old1, "")
    changes.append("1. 删除注册页管理员提示文字")
else:
    changes.append("1. [SKIP] 未找到registerHint")

# === 2. 禁用无痕浏览检测调用 ===
old2 = "  setTimeout(checkIncognito, 1500);"
new2 = "  // 无痕浏览检测已禁用（云端账号同步保障数据安全）  // setTimeout(checkIncognito, 1500);"
if old2 in src:
    src = src.replace(old2, new2, 1)
    changes.append("2. 禁用无痕浏览检测调用")
else:
    changes.append("2. [SKIP] 未找到checkIncognito调用")

# === 3. 添加密码小眼睛CSS（在login-wall-notice样式后面插入） ===
css_anchor = "  html[data-theme=\"dark\"] .login-wall-notice{background:#1e1e2a}"
pwd_css = """
  /* 密码小眼睛 */
  .pwd-wrap{position:relative;display:flex;align-items:center}
  .pwd-wrap input{flex:1;padding-right:40px !important}
  .pwd-toggle{position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;font-size:16px;color:var(--muted);padding:4px 6px;border-radius:6px;line-height:1;user-select:none}
  .pwd-toggle:hover{color:var(--text);background:var(--bg)}
  html[data-theme="dark"] .pwd-toggle:hover{background:#2a2a3a}"""
if css_anchor in src and ".pwd-wrap" not in src:
    src = src.replace(css_anchor, css_anchor + pwd_css, 1)
    changes.append("3. 添加密码小眼睛CSS")
else:
    changes.append("3. [SKIP] CSS已存在或锚点未找到")

# === 4. 添加密码小眼睛JS逻辑（在STAuth.initAuth函数末尾或initAuth调用后） ===
# 找到 initAuth 函数，在其末尾添加密码小眼睛初始化
js_anchor = "  if (typeof STAuth !== 'undefined') STAuth.initAuth();"
pwd_js = """
  // 初始化所有密码输入框的小眼睛切换
  (function(){
    document.querySelectorAll('input[type="password"]').forEach(function(inp){
      if (inp.parentElement.classList.contains('pwd-wrap')) return;
      var wrap = document.createElement('div');
      wrap.className = 'pwd-wrap';
      inp.parentNode.insertBefore(wrap, inp);
      wrap.appendChild(inp);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pwd-toggle';
      btn.textContent = '👁️';
      btn.title = '显示/隐藏密码';
      btn.addEventListener('click', function(e){
        e.preventDefault();
        if (inp.type === 'password') { inp.type = 'text'; btn.textContent = '🙈'; }
        else { inp.type = 'password'; btn.textContent = '👁️'; }
      });
      wrap.appendChild(btn);
    });
  })();"""
if js_anchor in src and "pwd-toggle" not in src[src.index(js_anchor):src.index(js_anchor)+2000]:
    src = src.replace(js_anchor, js_anchor + "\n" + pwd_js, 1)
    changes.append("4. 添加密码小眼睛JS逻辑")
else:
    changes.append("4. [SKIP] JS已存在或锚点未找到")

with io.open(path, "w", encoding="utf-8") as f:
    f.write(src)

print("=== 修改完成 ===")
for c in changes:
    print(c)
print("文件大小:", len(src), "bytes")
