"""首页「你好，桌友。」旁边的信封（pixflux 同步出图），点开是站长写给新朋友的信。
几种风格各出几张，结果在 out/envelope/。选的是 stamp-c1（蓝邮票 + 红火漆，和站标的蓝金红一致），
裁掉透明边后放进 src/assets/pixel/envelope.png（50×34）。"""
from __future__ import annotations

import sys

import pixellab

OUT = pixellab.ART / "out" / "envelope"

# 风格: 提示词。都是正面平放的一只信封、透明背景、黑色描边；配色取站里的金、红、靛蓝，放在深紫底上要显眼。
STYLES = {
    "wax": "a single closed cream paper envelope seen from the front, triangular flap sealed with a round red wax seal, game icon",
    "gold": "a single closed parchment envelope seen from the front, flap sealed with a gold wax seal stamped with a star, game icon",
    "stamp": "a single closed old letter envelope seen from the front, small blue postage stamp in the corner and a red wax seal on the flap, game icon",
    "heart": "a single closed cream envelope seen from the front, flap sealed with a small red heart shaped wax seal, cute game icon",
}
SEEDS = (701, 702, 703)


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
