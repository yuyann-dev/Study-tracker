# -*- coding: utf-8 -*-
"""
gen_kraft.py — 复刻 paper-warm.jpg / 旧 paper-kraft.jpg 的纸张纤维+颗粒质感，
产出 760x760、四边可无缝拼接的深色牛皮纸纹理，并把全图 RGB 均值校准到新的
深色 --bg（逐通道差值 <=1）。

用法：
    python scripts/gen_kraft.py [目标bgHex]
默认目标 = #282623（与 index.html 深色 --bg 一致）。

原理：用 numpy FFT 生成频谱成形的随机场——ifft2 天然周期，故左右/上下边界严格相接，
无接缝。再叠加一层更细的周期颗粒与极淡的纸纤维走向，最后把整图均值平移到目标色。
"""
import sys, os
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'frontend', 'paper-kraft.jpg')
SIZE = 760

def hex2rgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i+2], 16) for i in (0, 2, 4)], dtype=np.float64)

def periodic_noise(n, rng, octaves=(6, 18, 60), amps=(1.0, 0.45, 0.18)):
    """合成多倍频周期噪声（FFT 天然无缝）。返回 [-1,1] 量级的二维场。"""
    field = np.zeros((n, n), dtype=np.float64)
    for freq, amp in zip(octaves, amps):
        # 在 [0,n) 网格上随机相位 + 半径约 freq 的低通谱 -> 逆变换周期场
        spec = np.zeros((n, n), dtype=np.complex128)
        # 只保留低频圆内分量
        cy = cx = n // 2
        yy, xx = np.mgrid[0:n, 0:n]
        r = np.sqrt((yy - cy) ** 2 + (xx - cx) ** 2)
        mask = r <= freq
        phase = rng.uniform(0, 2 * np.pi, (n, n))
        mag = np.where(mask, rng.uniform(0.3, 1.0, (n, n)), 0.0)
        spec = mag * np.exp(1j * phase)
        # 厄米对称保证实场
        spec = (spec + np.conj(np.roll(spec[::-1, ::-1], (1, 1), (0, 1)))) / 2
        img = np.fft.ifft2(np.fft.ifftshift(spec)).real
        # 归一化到 [-1,1]
        m, s = img.mean(), img.std() + 1e-9
        img = (img - m) / s
        field += amp * img
    return field

def main():
    target_hex = sys.argv[1] if len(sys.argv) > 1 else '#282623'
    target = hex2rgb(target_hex)
    rng = np.random.default_rng(20261002)

    # 三层：大块纸色斑驳(低频) + 中等起伏 + 细颗粒
    base = periodic_noise(SIZE, rng, octaves=(5, 16, 55), amps=(1.0, 0.5, 0.22))
    # 极淡的纵向纸纤维（用周期正弦叠加，方向轻微倾斜）
    yy, xx = np.mgrid[0:SIZE, 0:SIZE]
    fiber = (np.sin((xx * 0.9 + yy * 0.18) * (2 * np.pi / 37.0)) * 0.10
             + np.sin((xx * -0.4 + yy * 1.0) * (2 * np.pi / 53.0)) * 0.06)
    field = base + fiber
    # 压到合适对比（纸张质感：std ~ 7/255 量级）
    field = field / (field.std() + 1e-9)

    # 通道：R/G/B 都围绕目标均值，B 略低、G 居中（保留一丝暖调但不发黄）
    # 各通道共用同一亮度场，只加极轻的通道差，避免脏色
    grain = rng.normal(0, 0.35, (SIZE, SIZE))  # 细微通道噪声
    img = np.zeros((SIZE, SIZE, 3), dtype=np.float64)
    contrast = 7.5  # 每通道明暗起伏
    for c in range(3):
        img[:, :, c] = target[c] + contrast * field + grain * (1 if c == 0 else 0.6)

    # 校准：JPEG 暗部 DC 量化会让 R/B 均值系统性下移 ~0.9，且反馈会跨过量化边界振荡。
    # 改为开环网格搜索：在 R/B 上枚举小偏移，保存后实测，选「与目标欧氏距离最小」的一张。
    base_img = img.copy()
    best = None  # (dist, offset)
    for dr in [0, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0]:
        for db in [0, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0]:
            offset = np.array([dr, 0.0, db])
            cur = np.clip(base_img + offset, 0, 255).round().astype(np.uint8)
            Image.fromarray(cur, 'RGB').save(OUT, quality=88, optimize=True)
            saved = np.array(Image.open(OUT).convert('RGB')).reshape(-1, 3).mean(axis=0)
            dist = np.sqrt(((saved - target) ** 2).sum())
            if best is None or dist < best[0]:
                best = (dist, offset.copy(), saved.copy())
    # 用最优偏移最终落盘
    offset = best[1]
    cur = np.clip(base_img + offset, 0, 255).round().astype(np.uint8)
    Image.fromarray(cur, 'RGB').save(OUT, quality=88, optimize=True)
    print('  [calib] best offset=', offset.round(3), 'saved=', best[2].round(3))
    img = np.array(Image.open(OUT).convert('RGB'))

    # ---- 校验报告 ----
    chk = np.array(Image.open(OUT).convert('RGB'))
    meas = chk.reshape(-1, 3).mean(axis=0)
    print('目标 bg        :', target_hex, target.round(1))
    print('实测 RGB 均值  :', meas.round(2), ' 逐通道差:', (meas - target).round(2))

    # 无缝性：比较左/右列、上/下行的平均差（理想 ~0，JPEG 压缩后应很小）
    left = chk[:, 0, :].astype(float)
    right = chk[:, -1, :].astype(float)
    top = chk[0, :, :].astype(float)
    bottom = chk[-1, :, :].astype(float)
    ewr = np.abs(left - right).mean()
    etb = np.abs(top - bottom).mean()
    print(f'无缝性校验 左右边平均像素差: {ewr:.2f}/255   上下边平均像素差: {etb:.2f}/255')
    print('输出:', OUT, Image.open(OUT).size)

if __name__ == '__main__':
    main()
