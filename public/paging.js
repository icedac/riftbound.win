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
