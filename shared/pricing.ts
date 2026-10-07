/** 订阅价格与试用期，前后端共用，改价只改这里。 */
export const PRICE_PER_MONTH_YUAN = 5;
/** 新注册账号送的试用天数。 */
export const TRIAL_DAYS = 7;
/** 可购买的时长（月），按月价直接相乘，不打折。 */
export const PLAN_MONTHS = [1, 3, 6, 12] as const;

export function priceFen(months: number): number {
  return months * PRICE_PER_MONTH_YUAN * 100;
}

export function formatYuan(fen: number): string {
  return Number.isInteger(fen / 100) ? `${fen / 100}` : (fen / 100).toFixed(2);
}
