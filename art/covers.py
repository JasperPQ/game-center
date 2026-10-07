"""大厅游戏卡片的封面图：每个游戏一张 384×192 的像素插画（PixelLab pixflux）。

每个游戏先出三个候选到 art/out/covers/（被 gitignore），挑好后写进 selection.json 的 covers，
再运行 python covers.py export 复制成 src/assets/pixel/covers/<游戏>.png。
用法：python covers.py [游戏 id ...]   不带参数就全部生成。
"""
from __future__ import annotations

import json
import pathlib
import shutil
import sys
from concurrent.futures import ThreadPoolExecutor

import pixellab

OUT = pixellab.ART / "out" / "covers"
TARGET = pixellab.ART.parent / "src" / "assets" / "pixel" / "covers"
SIZE = {"width": 384, "height": 192}
SEEDS = (811, 812, 813)

# 统一的画风后缀，六张封面放在一起才像一套
STYLE = (
    "cozy 16-bit pixel art game cover illustration, rich warm colors, soft lighting, "
    "crisp clean pixels, no text, no letters, no logo"
)

COVERS = {
    "gem-merchant": (
        "a renaissance gem merchant's shop counter, large sparkling faceted gemstones: green emerald, blue sapphire, "
        "red ruby, white diamond and black onyx in small velvet trays, a brass balance scale, scattered gold coins, "
        "an open ledger, warm candlelight, a window with a medieval town behind"
    ),
    "guandan": (
        "a lively Chinese card game on a red felt table seen from above, two decks of playing cards fanned out, "
        "a bomb of four aces, two jokers, teacups with steaming tea, sunflower seeds, warm evening light"
    ),
    "poker": (
        "a Texas hold'em poker table with green felt seen from above, five face-up community cards in a row, "
        "a pair of aces in front, tall stacks of red, blue and black poker chips, a dealer button, "
        "dramatic overhead lamp light, dark casino background"
    ),
    "camel": (
        "a camel race in the Egyptian desert at sunset, colorful racing camels in red, blue, green and yellow "
        "running on a sandy track, two camels stacked riding on top of another camel, a black camel running "
        "backwards, pyramids and palm trees in the background, orange sky"
    ),
    "azul": (
        "Portuguese azulejo mosaic tiles on a wooden table seen from above, a player board with a 5 by 5 tile wall "
        "half filled with blue, yellow, red, black and white square tiles, round ceramic factory discs holding "
        "four tiles each, a small potted plant, warm daylight"
    ),
    "ttr": (
        "a vintage steam locomotive pulling colorful train cars across a stylized map of North America, "
        "railway routes in many colors connecting cities, mountains and plains, a ticket card, golden hour light"
    ),
    "cantstop": (
        "tiny mountain climbers in red, blue, green and yellow jackets scaling a stepped rocky mountain made of "
        "stone pillars of different heights, small tents pitched on ledges, colorful flags planted on the snowy "
        "summits, four big white dice in the foreground, alpine peaks and a pink dawn sky behind"
    ),
}


def generate(game: str, seed: int) -> pathlib.Path:
    return pixellab.generate_image(f"{game}-s{seed}", {
        "description": f"{COVERS[game]}, {STYLE}",
        "image_size": SIZE,
        "no_background": False,
        "seed": seed,
    }, OUT)


def export() -> None:
    choice = json.loads((pixellab.ART / "selection.json").read_text())["covers"]
    TARGET.mkdir(parents=True, exist_ok=True)
    for game, name in choice.items():
        shutil.copyfile(OUT / name, TARGET / f"{game}.png")
        print(game, "←", name)


if __name__ == "__main__":
    args = sys.argv[1:]
    if args == ["export"]:
        export()
        sys.exit(0)
    games = args or list(COVERS)
    jobs = [(game, seed) for game in games for seed in SEEDS]
    # PixelLab 免费档同一时间只能跑 1 个生成，多开会 429
    with ThreadPoolExecutor(max_workers=1) as pool:
        for path in pool.map(lambda job: generate(*job), jobs):
            print(path.name, "spent", round(pixellab.spent_usd(), 4), flush=True)
