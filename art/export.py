"""把 selection.json 里选定的彩蛋裁好，放进 src/assets/pixel/egg.png。

四种候选的大小不一样，统一放进 42×58 的透明画布（水平居中、贴底），页面上按整数倍显示。
"""
from __future__ import annotations

import json
import pathlib

from PIL import Image

ART = pathlib.Path(__file__).resolve().parent
CANVAS = (42, 58)


def fit(source: pathlib.Path) -> Image.Image:
    """裁掉透明边，放进统一大小的画布。"""
    image = Image.open(source).convert("RGBA")
    egg = image.crop(image.getchannel("A").getbbox())
    if egg.width > CANVAS[0] or egg.height > CANVAS[1]:
        raise ValueError(f"{source.name} 裁出来 {egg.size}，比画布 {CANVAS} 大")
    canvas = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    canvas.paste(egg, ((CANVAS[0] - egg.width) // 2, CANVAS[1] - egg.height), egg)
    return canvas


def export() -> pathlib.Path:
    choice = json.loads((ART / "selection.json").read_text())["egg"]
    target = ART.parent / "src" / "assets" / "pixel" / "egg.png"
    fit(ART / "out" / choice).save(target, optimize=True)
    return target


if __name__ == "__main__":
    print(export())
