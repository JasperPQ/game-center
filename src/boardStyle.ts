import { useCallback, useState } from "react";

/**
 * 画面风格：像素版（默认）或原始版本。只影响自己看到的画面，记在本机浏览器里。
 * 和宝石商人（/gem）用同一个存储键，同一站点下在哪里切换，另一边也跟着变。
 */
export type BoardStyle = "pixel" | "classic";

const STORAGE_KEY = "gm-board-style";

export function readBoardStyle(): BoardStyle {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "classic" ? "classic" : "pixel";
  } catch {
    return "pixel";
  }
}

export function useBoardStyle(): [BoardStyle, () => void] {
  const [style, setStyle] = useState(readBoardStyle);
  const toggle = useCallback(() => {
    const next: BoardStyle = style === "pixel" ? "classic" : "pixel";
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // 存不了就只在本次页面内生效。
    }
    setStyle(next);
  }, [style]);
  return [style, toggle];
}
