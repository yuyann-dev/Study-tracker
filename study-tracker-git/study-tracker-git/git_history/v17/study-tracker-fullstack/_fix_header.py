# -*- coding: utf-8 -*-
p = r"C:\Users\MXyuan\Doubao\chats\2026-09-22\new-chat\study-tracker-fullstack\frontend\index.html"
with open(p, encoding="utf-8") as f:
    s = f.read()

old = "$('#bookTitle').innerHTML = `<span class=\"book-name\">${esc(p.name)}</span><span class=\"head-badges\"><span class=\"type-badge ${type.badgeCls}\">${type.icon} ${type.name}</span>${modeTag}${linkBadge}</span>`;"
new = "$('#bookTitle').textContent = p.name;\n$('#headBadges').innerHTML = `<span class=\"type-badge ${type.badgeCls}\">${type.icon} ${type.name}</span>${modeTag}${linkBadge}`;"

print("found:", s.count(old))
s = s.replace(old, new)
with open(p, "w", encoding="utf-8") as f:
    f.write(s)
print("done")
