function median(sortedValues) {
  if (sortedValues.length === 0) return 0;
  const middle = Math.floor(sortedValues.length / 2);
  return sortedValues.length % 2 === 0
    ? (sortedValues[middle - 1] + sortedValues[middle]) / 2
    : sortedValues[middle];
}

export function summarizeAmountsByCurrency(rows) {
  const groups = new Map();

  for (const row of rows) {
    const currency = row.currency_code || "UNKNOWN";
    const group = groups.get(currency) || [];
    group.push(row);
    groups.set(currency, group);
  }

  return Object.fromEntries(
    [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, currencyRows]) => {
        const amounts = currencyRows
          .map((row) => Number(row.amount) || 0)
          .sort((left, right) => left - right);
        const initiatedAt = currencyRows
          .map((row) => row.initiated_at)
          .filter(Boolean)
          .sort();
        const spanDays = initiatedAt.length > 1
          ? (new Date(initiatedAt.at(-1)) - new Date(initiatedAt[0])) / 86400000 + 1
          : 0;
        const total = amounts.reduce((sum, amount) => sum + amount, 0);

        return [currency, {
          count: currencyRows.length,
          total,
          average: currencyRows.length ? total / currencyRows.length : 0,
          median: median(amounts),
          span_days: spanDays,
          annualized_case_run_rate: spanDays
            ? currencyRows.length / spanDays * 365
            : 0,
          annualized_disputed_value_run_rate: spanDays
            ? total / spanDays * 365
            : 0,
          first_initiated_at: initiatedAt[0] || null,
          last_initiated_at: initiatedAt.at(-1) || null,
        }];
      }),
  );
}

export function singleCurrencySummary(amountsByCurrency) {
  const entries = Object.entries(amountsByCurrency);
  return entries.length === 1 && entries[0][0] !== "UNKNOWN"
    ? entries[0][1]
    : null;
}
