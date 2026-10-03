# -*- coding: utf-8 -*-
"""
任务5：今日总览面板纸感化重设计（仅 frontend/index.html）
- .dash-hero / .kaoyan / .weekly-review：大色块 -> 纸卡(var(--card)) + 墨绿(var(--brand))点缀/细边
- 去掉金色发光、白色大字压顶；文字改用 var(--text)/var(--muted)，深色自动适配
- 清理不和谐 emoji（dashTitle / msg / 分区标题 / 提醒区），不改业务逻辑与 id
保留所有 id 与 JS 钩子。
"""
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
    print(f'[ok] x{n}  {old[:46]!r}')

def L(s):  # 转 CRLF
    return s.replace('\n', NL)

# ---------- 1) .dash-hero 纸卡化 ----------
old_hero = L(""".dash-hero{background:var(--brand);border-radius:16px;padding:24px 26px;margin:0 0 16px;color:#fff;box-shadow:0 10px 26px -14px rgba(35,83,61,.4)}
  .dash-hero .greet-big{font-size:26px;font-weight:800;letter-spacing:1px;line-height:1.2}
  .dash-hero .greet-sub{font-size:12.5px;opacity:.9;margin-top:3px}
  .dash-hero .hero-status{font-size:15.5px;font-weight:600;line-height:1.6;margin-top:14px}
  .dash-hero .hero-enc{font-size:13.5px;opacity:.95;margin-top:6px;line-height:1.5}
  .dash-hero.urgent{background:linear-gradient(135deg,#f59e0b 0%,#e0484f 100%);box-shadow:0 10px 26px -12px rgba(224,72,79,.55)}""")
new_hero = L(""".dash-hero{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:22px 24px;margin:0 0 16px;color:var(--text);box-shadow:var(--shadow)}
  .dash-hero .greet-big{font-size:24px;font-weight:800;letter-spacing:-.3px;line-height:1.2;color:var(--text)}
  .dash-hero .greet-sub{font-size:12.5px;color:var(--muted);margin-top:3px}
  .dash-hero .hero-status{font-size:15px;font-weight:600;line-height:1.6;margin-top:14px;color:var(--brand)}
  .dash-hero .hero-enc{font-size:13px;color:var(--muted);margin-top:6px;line-height:1.5}
  .dash-hero.urgent{border-color:var(--bad)}
  .dash-hero.urgent .hero-status{color:var(--bad)}""")
rep(old_hero, new_hero)

# ---------- 2) .kaoyan 纸卡化（去深绿渐变 + 金色发光） ----------
old_ky = L(""".kaoyan{margin:0 0 16px;background:linear-gradient(160deg,#2e6b4f 0%,#23533d 100%);
    border-radius:16px;padding:26px 28px;color:#fff;
    box-shadow:0 8px 24px -12px rgba(35,83,61,.5), inset 0 1px 0 rgba(255,255,255,.08)}
  .kaoyan .ky-label{font-size:12.5px;color:rgba(255,255,255,.72);letter-spacing:3px;font-weight:600}
  .kaoyan .ky-days{font-size:52px;font-weight:800;letter-spacing:-2px;line-height:1;margin:8px 0 20px;
    color:#f0d890;
    text-shadow:0 0 20px rgba(240,216,144,.35), 0 0 40px rgba(240,216,144,.15)}
  .kaoyan .ky-days small{font-size:18px;font-weight:800;color:rgba(255,255,255,.9);margin-left:8px;letter-spacing:0;
    text-shadow:none;position:relative;top:-4px}
  .kaoyan .ky-divider{height:1px;background:rgba(255,255,255,.12);margin:0 12px 16px}
  .kaoyan .ky-quote-tag{font-size:11px;color:rgba(255,255,255,.6);letter-spacing:4px;margin-bottom:8px;font-weight:600}
  .kaoyan .ky-quote{font-size:16.5px;line-height:1.6;color:rgba(255,255,255,.95);max-width:80%;font-weight:400;overflow-wrap:break-word;word-break:normal;hyphens:auto}
  .kaoyan.exam-day{background:
    radial-gradient(circle at 20% 0%, rgba(255,180,80,.2) 0%, transparent 50%),
    linear-gradient(100deg,#6e1a1a 0%,#a84a15 100%)}
  .kaoyan.exam-done{background:
    radial-gradient(circle at 20% 0%, rgba(80,220,160,.2) 0%, transparent 50%),
    linear-gradient(100deg,#0d5538 0%,#188055 100%)}""")
new_ky = L(""".kaoyan{margin:0 0 16px;background:var(--card);
    border:1px solid var(--line);border-radius:16px;padding:22px 24px;color:var(--text);
    box-shadow:var(--shadow)}
  .kaoyan .ky-label{font-size:12px;color:var(--muted);letter-spacing:2px;font-weight:600}
  .kaoyan .ky-days{font-size:48px;font-weight:800;letter-spacing:-2px;line-height:1;margin:8px 0 18px;color:var(--brand)}
  .kaoyan .ky-days small{font-size:17px;font-weight:800;color:var(--muted);margin-left:8px;letter-spacing:0;position:relative;top:-4px}
  .kaoyan .ky-divider{height:1px;background:var(--line);margin:0 0 16px}
  .kaoyan .ky-quote-tag{font-size:10.5px;color:var(--muted);letter-spacing:3px;margin-bottom:8px;font-weight:600}
  .kaoyan .ky-quote{font-size:15.5px;line-height:1.6;color:var(--text);max-width:100%;font-weight:400;overflow-wrap:break-word;word-break:normal;hyphens:auto}
  .kaoyan.exam-day{border-color:var(--bad)}
  .kaoyan.exam-day .ky-days{color:var(--bad)}
  .kaoyan.exam-done{border-color:var(--ok)}
  .kaoyan.exam-done .ky-days{color:var(--ok)}""")
rep(old_ky, new_ky)

# ---------- 3) .weekly-review 纸卡化 ----------
old_wr = L(""".weekly-review{margin:0 0 16px;border-radius:18px;padding:20px 24px;
    background:linear-gradient(120deg,#fff8ed 0%,#fff3e0 100%);
    border:1px solid #e3cf9a;box-shadow:0 6px 20px -14px rgba(176,122,75,.35)}
  .weekly-review .wr-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:14px;flex-wrap:wrap}
  .weekly-review .wr-title{font-size:15px;font-weight:700;color:#9a6a17}
  .weekly-review .wr-date{font-size:12px;color:#b08a4a}
  .weekly-review .wr-stats{display:flex;gap:10px;margin-bottom:14px}
  .weekly-review .wr-stat{flex:1;background:rgba(255,255,255,.65);border-radius:12px;padding:10px 6px;text-align:center}
  .weekly-review .wr-num{font-size:21px;font-weight:800;color:#c77f1a;line-height:1.1;word-break:keep-all}
  .weekly-review .wr-lab{font-size:11px;color:#a07a40;margin-top:4px}
  .weekly-review .wr-msg{font-size:14px;font-weight:600;color:#5c4419;line-height:1.55;margin-bottom:9px}
  .weekly-review .wr-tip{font-size:12.5px;color:#7a5a28;line-height:1.55;background:rgba(255,255,255,.55);border-radius:10px;padding:9px 12px}""")
new_wr = L(""".weekly-review{margin:0 0 16px;border-radius:16px;padding:18px 22px;
    background:var(--card);border:1px solid var(--line);box-shadow:var(--shadow)}
  .weekly-review .wr-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:14px;flex-wrap:wrap}
  .weekly-review .wr-title{font-size:15px;font-weight:700;color:var(--brand)}
  .weekly-review .wr-date{font-size:12px;color:var(--muted)}
  .weekly-review .wr-stats{display:flex;gap:10px;margin-bottom:14px}
  .weekly-review .wr-stat{flex:1;background:var(--bg);border-radius:12px;padding:10px 6px;text-align:center}
  .weekly-review .wr-num{font-size:21px;font-weight:800;color:var(--brand);line-height:1.1;word-break:keep-all}
  .weekly-review .wr-lab{font-size:11px;color:var(--muted);margin-top:4px}
  .weekly-review .wr-msg{font-size:14px;font-weight:600;color:var(--text);line-height:1.55;margin-bottom:9px}
  .weekly-review .wr-tip{font-size:12.5px;color:var(--muted);line-height:1.55;background:var(--bg);border-radius:10px;padding:9px 12px}""")
rep(old_wr, new_wr)

# ---------- 4) 删除深色下 weekly-review 的琥珀/棕覆盖（新基座已用变量自适应） ----------
old_wrdark = L("""html[data-theme="dark"] .weekly-review{background:linear-gradient(120deg,#2a2318 0%,#2e2515 100%);border-color:#4a3a1f;box-shadow:none}
  html[data-theme="dark"] .weekly-review .wr-title{color:#e8b860}
  html[data-theme="dark"] .weekly-review .wr-date{color:#b89146}
  html[data-theme="dark"] .weekly-review .wr-stat{background:rgba(255,255,255,.05)}
  html[data-theme="dark"] .weekly-review .wr-num{color:#f0c070}
  html[data-theme="dark"] .weekly-review .wr-lab{color:#b89146}
  html[data-theme="dark"] .weekly-review .wr-msg{color:#e8d4a8}
  html[data-theme="dark"] .weekly-review .wr-tip{color:#c9ad78;background:rgba(255,255,255,.05)}""")
rep(old_wrdark, '/* weekly-review 已改用 var(--card)/var(--brand)，深色随变量自适应，无需琥珀覆盖 */')

# ---------- 5) JS：清理不和谐 emoji（不动逻辑与 id） ----------
rep('<h2 id="dashTitle">🏠 今日总览</h2>', '<h2 id="dashTitle">今日总览</h2>')
rep('⚠️ 有 <b>${overdueTotal}</b> 条已逾期', '有 <b>${overdueTotal}</b> 条已逾期')
rep("msg = '🔥 今天的任务全部完成，还超额了'", "msg = '今天的任务全部完成，还超额了'")
rep('✅ 今天 ${tasksTotal} 个任务全部完成', '今天 ${tasksTotal} 个任务全部完成')
rep('📈 今天已完成 <b>${tasksDone}/${tasksTotal}</b>', '今天已完成 <b>${tasksDone}/${tasksTotal}</b>')
rep('📈 已经开了个好头', '已经开了个好头')
rep('📌 今天有 <b>${dueTotal}</b> 条待复习', '今天有 <b>${dueTotal}</b> 条待复习')
rep('🎯 今天还有 <b>${tasksTotal}</b> 个任务待完成', '今天还有 <b>${tasksTotal}</b> 个任务待完成')
rep('🔖 今天任务已清完', '今天任务已清完')
rep("msg = '🎉 今天没有待完成的任务，状态很好'", "msg = '今天没有待完成的任务，状态很好'")
rep("section('✏️ 刷题'", "section('刷题'")
rep("section('📖 背书'", "section('背书'")
rep("section('📝 错题'", "section('错题'")
rep('⏰ 每日提醒', '每日提醒')
rep("remind.enabled ? '✅ 已开启' : '🔕 未开启'", "remind.enabled ? '已开启' : '未开启'")
rep('👁 预览', '预览')

open(P, 'w', encoding='utf-8', newline='').write(html)
print('DONE task5')
