export const PAGE_SIZE = 96;

export function nextVisibleCount(current, total, pageSize = PAGE_SIZE) {
  if (total <= 0) return 0;
  return Math.min(total, Math.max(0, current) + pageSize);
}

export function hasMoreCards(current, total) {
  return current < total;
}

export function shouldAutoLoad({ sentinelTop, viewportHeight, preloadDistance = 900 }) {
  return sentinelTop <= viewportHeight + preloadDistance;
}

export function nextAutoVisibleCount({
  current,
  total,
  pageSize = PAGE_SIZE,
  sentinelTop,
  viewportHeight,
  preloadDistance = 900,
  estimatedPageHeight = 0,
  maxPages = 8,
}) {
  let next = Math.max(0, current);
  let projectedSentinelTop = sentinelTop;

  for (let pages = 0; pages < maxPages; pages += 1) {
    if (!hasMoreCards(next, total)) break;
    if (!shouldAutoLoad({ sentinelTop: projectedSentinelTop, viewportHeight, preloadDistance })) break;

    const previous = next;
    next = nextVisibleCount(next, total, pageSize);
    if (next === previous) break;
    projectedSentinelTop += Math.max(0, estimatedPageHeight);
  }

  return next;
}
