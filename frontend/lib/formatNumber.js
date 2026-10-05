// Locale-aware number formatting (STYLE.md §2) - use these instead of
// building "42%" strings by hand.

const percentFormatter = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 });

// count as a share of total, e.g. formatPercent(1, 3) -> "33.3%". An
// em dash when total is 0, rather than a misleading 0% or NaN.
export function formatPercent(count, total) {
  if (!total) return '—';
  return percentFormatter.format(count / total);
}
