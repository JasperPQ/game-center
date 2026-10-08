import type { DayPalette } from "./day-theme";

/**
 * 白天版调色表（游戏中心，和宝石商人、掼蛋、德州扑克同一套紫灰色）。
 * 深色底、面板、按钮 → 白底浅色；黑色像素描边保留；浅色字 → 深色字。
 * 按钮里的金色、红色，徽章的绿色，头像颜色这些内容色不换。
 */
export const palette: DayPalette = {
  files: ["center-pixel.css"],
  colors: {
    "#0e0c13": "#ffffff", // 底色、输入框
    "#13101a": "#f9f8fb", // 底色的棋盘纹
    "#1c1826": "#f6f4f9", // 面板
    "#262033": "#eae6f0", // 面板 2、分隔线
    "#332b44": "#e2ddea", // 普通按钮、分隔线
    "#241d16": "#fbf4e4", // 管理员区（暖色）
    "#050408": "#2b2536", // 像素描边
    "#4a3f63": "#ffffff", // 面板亮边
    "#0b0a10": "#d5d0de", // 面板暗边
    "#6b5c8f": "#ffffff", // 按钮亮边
    "#141119": "#b8b1c6", // 按钮暗边
  },
  text: {
    "#f1ece0": "#26212f",
    "#9a93ad": "#6c6580",
    "#5f5876": "#a59fb5", // 输入框占位字
  },
  values: {
    // 不能点的按钮：夜间是压暗，白底上压暗成了泥色，改成褪成浅灰
    "grayscale(0.6) brightness(0.7)": "grayscale(0.85) brightness(1.15)",
    "grayscale(0.7) brightness(0.6)": "grayscale(0.85) brightness(1.15)",
  },
  textShadows: {
    // 大标题的投影：夜间是黑色，白底上换成浅金色
    "calc(var(--px) * 2) calc(var(--px) * 2) 0 var(--edge)": "calc(var(--px) * 2) calc(var(--px) * 2) 0 #f0d890",
  },
  textVarColors: {
    "--gold": "#94650a",
    "--gold-2": "#94650a",
    "--ok": "#1f8a45",
    "--bad": "#d1303f",
  },
};
