# -*- coding: utf-8 -*-
p = r"C:\Users\MXyuan\Doubao\chats\2026-09-22\new-chat\study-tracker-fullstack\frontend\index.html"
with open(p, encoding="utf-8") as f:
    lines = f.readlines()

# 替换 53-62 行（1-based），即 index 52..61
start, end = 53, 62
new_block = """  .head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:18px;padding:0 4px}
  .head-main{min-width:0;flex:1 1 auto}
  h1{font-size:22px;font-weight:700;letter-spacing:-.4px;margin:2px 0 0;line-height:1.3;overflow-wrap:anywhere}
  .head-badges-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:9px;min-width:0}
  .type-badge{font-size:12px;font-weight:600;padding:3px 10px;border-radius:999px;background:#eef0fe;color:#5b6ef5;letter-spacing:0}
  .type-badge.recite{background:#e6f7ee;color:#0ea472}
  .type-badge.mistake{background:#fdf3e2;color:#e08a00}
  .sub{font-size:13px;color:var(--muted);margin-top:7px;line-height:1.5;overflow-wrap:anywhere}
  .head-actions{display:flex;gap:8px;flex:0 0 auto;flex-wrap:wrap;justify-content:flex-end;align-items:center}
  .user-avatar-wrap{background:none;border:none;padding:0;cursor:pointer;flex:0 0 auto;line-height:0;border-radius:50%}
  .user-avatar-btn{width:40px;height:40px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:linear-gradient(135deg,var(--brand),var(--brand2));color:#fff;font-size:16px;font-weight:700;overflow:hidden;box-shadow:0 3px 10px -3px rgba(91,110,245,.55);border:2px solid var(--card);transition:.15s}
  .user-avatar-btn img{width:100%;height:100%;object-fit:cover;border-radius:50%}
  .user-avatar-wrap:hover .user-avatar-btn{transform:translateY(-1px);box-shadow:0 6px 14px -3px rgba(91,110,245,.6)}
  .user-avatar-wrap:active .user-avatar-btn{transform:scale(.95)}
"""
new_lines = lines[:start-1] + [new_block] + lines[end:]
with open(p, "w", encoding="utf-8") as f:
    f.writelines(new_lines)
print("css replaced")
