/** Formats whole-rand amounts, e.g. 12500 -> "R12 500". Amounts are fictional demo values. */
export function formatMoney(amount: number, symbol = "R"): string {
  const sign = amount < 0 ? "-" : "";
  const digits = Math.abs(Math.round(amount))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${sign}${symbol}${digits}`;
}
