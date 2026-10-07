"""首页的晶脉入口：一颗彩蛋（pixflux 同步出图）。几种风格各出几张，结果在 out/egg/，挑选用 gallery.py。"""
from __future__ import annotations

import sys

import pixellab

OUT = pixellab.ART / "out" / "egg"

# 风格: 提示词。都是竖着立的一颗蛋、透明背景、黑色描边，颜色取晶脉里宝石的青、赤、紫、金。
STYLES = {
    "paint": "a single decorated easter egg standing upright, painted with zigzag bands and dots in teal, crimson, purple and gold, game icon",
    "vein": "a single dark stone egg standing upright, glowing crystal veins in teal, crimson and gold crack across its shell, game icon",
    "geode": "a single egg standing upright with the top broken open, sparkling purple and teal crystals growing inside like a geode, game icon",
    "jewel": "a single ornate golden egg standing upright, inlaid with teal, crimson and purple gemstones in a jeweled pattern, game icon",
}
SEEDS = (601, 602, 603)


def make(style: str, seed: int) -> None:
    pixellab.generate_image(f"{style}-c{seed % 10}", {
        "description": STYLES[style],
        "image_size": {"width": 64, "height": 64},
        "no_background": True,
        "outline": "single color black outline",
        "seed": seed,
    }, OUT)


if __name__ == "__main__":
    for style in sys.argv[1:] or list(STYLES):
        for seed in SEEDS:
            make(style, seed)
        print(style, "done; spent", round(pixellab.spent_usd(), 4), flush=True)
