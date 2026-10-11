/** 订阅价格与试用期，前后端共用，改价只改这里。 */
export const PRICE_PER_MONTH_YUAN = 5;
/** 价格后面跟的说明：现在是试运营期间的价格。正式定价后改这里（或改成空字符串去掉）。 */
export const PRICE_NOTE = "试运营期间价格";
/** 「5 元 / 月（试运营期间价格）」，页面上提到月价的地方都用它。 */
export const PRICE_LABEL = `${PRICE_PER_MONTH_YUAN} 元 / 月${PRICE_NOTE ? `（${PRICE_NOTE}）` : ""}`;
/** 新注册账号送的试用天数。 */
export const TRIAL_DAYS = 30;
/** 可购买的时长（月），按月价直接相乘，不打折。 */
export const PLAN_MONTHS = [1, 3, 6, 12] as const;

export function priceFen(months: number): number {
  return months * PRICE_PER_MONTH_YUAN * 100;
}

export function formatYuan(fen: number): string {
  return Number.isInteger(fen / 100) ? `${fen / 100}` : (fen / 100).toFixed(2);
}
