export function formatTokens(n: number | null | undefined): string {
  if (!n) return '0';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

export function formatCost(n: number | null | undefined): string {
  if (!n) return '$0.00';
  if (n >= 1000) return `$${(n).toFixed(0)}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

export function formatNumber(n: number | null | undefined): string {
  if (!n) return '0';
  return n.toLocaleString();
}

export function formatPercent(value: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round((value / total) * 100)}%`;
}

export function getDateRange(range: string): { start: string; end: string } {
  const end = new Date();
  const start = new Date();

  switch (range) {
    case '24h':
      start.setHours(start.getHours() - 24);
      // Use full ISO timestamp for precise 24h window
      return {
        start: start.toISOString(),
        end: end.toISOString(),
      };
    case '7d':
      start.setDate(start.getDate() - 7);
      break;
    case '30d':
      start.setDate(start.getDate() - 30);
      break;
    case '180d':
      start.setDate(start.getDate() - 180);
      break;
    case '365d':
      start.setDate(start.getDate() - 365);
      break;
    default:
      start.setDate(start.getDate() - 7);
  }

  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
  };
}
