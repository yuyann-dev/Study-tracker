# -*- coding: utf-8 -*-
"""
统一应用图标生成（仅“裁剪 + 缩放”，不重绘）。
唯一来源：<项目根>/../brand/logo-master.png（高清原图，墨绿 S=学位帽+翻开书，暖纸底）。
做法：检测墨绿主体相对暖纸背景的最小包围盒 bbox -> 紧裁 -> 居中放到方形暖纸画布，
主体长边约 83%（短边约 76%），四周安全留白约 8.5%~12% -> LANCZOS 输出各尺寸。
S 的造型/颜色/笔画与原图保持像素一致（仅整体放大），不做任何描摹、改色、透明化或发光。
不生成任何深色/主题变体；删除旧的 icon-logo-dark-512.png。
"""
import os
from PIL import Image
import numpy as np

BASE = os.path.dirname(os.path.abspath(__file__))
FE = os.path.join(BASE, "frontend")

MASTER_CANDIDATES = [
    os.path.join(BASE, "..", "brand", "logo-master.png"),
    r"C:\Users\MXyuan\Doubao\chats\2026-10-01\new-chat\brand\logo-master.png",
]
MASTER = next((p for p in MASTER_CANDIDATES if os.path.exists(p)), None)
assert MASTER, "找不到 logo-master.png"
print("master:", MASTER)

# 主体长边在方形画布中的占比（受原始宽高比约束，短边约为 0.83*aspect）
K_LONG = 0.83
THRESH = 40  # 与背景色差总和阈值

img = Image.open(MASTER).convert("RGB")
W, H = img.size
a = np.asarray(img).astype(int)

corners = np.vstack([
    a[0:8, 0:8].reshape(-1, 3), a[0:8, -8:].reshape(-1, 3),
    a[-8:, 0:8].reshape(-1, 3), a[-8:, -8:].reshape(-1, 3),
])
bg = np.median(corners, axis=0)
print("canvas:", (W, H), "bg rgb:", bg.tolist())

dist = np.abs(a - bg).sum(axis=2)
mask = dist > THRESH
ys, xs = np.where(mask)
x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
cw, ch = x1 - x0 + 1, y1 - y0 + 1
print("bbox: x %d-%d  y %d-%d  (w %d h %d)" % (x0, x1, y0, y1, cw, ch))
print("source occupancy: w %.1f%% h %.1f%%" % (100 * cw / W, 100 * ch / H))

crop = img.crop((x0, y0, x1 + 1, y1 + 1))  # 紧裁
long_edge = float(max(cw, ch))
aspect = min(cw, ch) / long_edge

OUTPUTS = {
    "icon-512.png": 512,
    "icon-192.png": 192,
    "apple-touch-icon.png": 180,
    "favicon-64.png": 64,
}

bg_tuple = tuple(int(round(v)) for v in bg)
results = []
for name, S in OUTPUTS.items():
    target_long = K_LONG * S
    scale = target_long / long_edge
    nw, nh = max(1, int(round(cw * scale))), max(1, int(round(ch * scale)))
    glyph = crop.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGB", (S, S), bg_tuple)
    canvas.paste(glyph, ((S - nw) // 2, (S - nh) // 2))
    out = os.path.join(FE, name)
    # 调色板量化控体积：图形仅墨绿+暖纸两类主色，32 色足以容纳边缘抗锯齿过渡；
    # 关闭抖动以保持边缘干净、无噪点。
    n_colors = 64 if S >= 256 else 32
    q = canvas.quantize(colors=n_colors, method=Image.Quantize.MEDIANCUT,
                        dither=Image.Dither.NONE)
    q.save(out, optimize=True)
    results.append((name, S, nw, nh, os.path.getsize(out)))

# 删除深色专用变体（统一一套，零主题分支）
dark = os.path.join(FE, "icon-logo-dark-512.png")
if os.path.exists(dark):
    os.remove(dark)
    print("removed dark variant:", dark)

print("\n=== outputs ===")
for name, S, nw, nh, size in results:
    print("%-22s %dx%d  glyph %dx%d (long %.1f%% short %.1f%%)  %d bytes"
          % (name, S, S, nw, nh, 100.0 * max(nw, nh) / S,
             100.0 * min(nw, nh) / S, size))

# 复核：成品主体 bbox 与目标占比
print("\n=== verify re-detected bbox on outputs ===")
for name, S, *_ in results:
    im = Image.open(os.path.join(FE, name)).convert("RGB")
    arr = np.asarray(im).astype(int)
    bgm = np.median(np.vstack([arr[0:4, 0:4].reshape(-1, 3), arr[-4:, -4:].reshape(-1, 3)]), axis=0)
    m = np.abs(arr - bgm).sum(axis=2) > THRESH
    yy, xx = np.where(m)
    ww, hh = xx.max() - xx.min() + 1, yy.max() - yy.min() + 1
    print("%-22s bbox w %.1f%% h %.1f%%" % (name, 100 * ww / S, 100 * hh / S))
