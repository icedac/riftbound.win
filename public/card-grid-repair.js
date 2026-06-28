export const GRID_RECOVERY_WATCHDOG_MS = 15000;

export function shouldRepairInitialCardGrid({
  totalCards = 0,
  filteredCards = 0,
  visibleCards = 0,
  repairAlreadyRan = false,
} = {}) {
  return !repairAlreadyRan && totalCards > 0 && filteredCards > 0 && visibleCards > 0;
}

export function shouldRecoverRenderedCardGrid({
  totalCards = 0,
  filteredCards = 0,
  visibleCards = 0,
  renderedCards = 0,
} = {}) {
  const expectedVisible = Math.min(Math.max(0, visibleCards), Math.max(0, filteredCards));
  return (
    totalCards > 0 &&
    filteredCards > 0 &&
    expectedVisible > 0 &&
    Math.max(0, renderedCards) < expectedVisible
  );
}

export function shouldResetStaleCardScroll({
  hasHash = false,
  scrollY = 0,
  renderedCards = 0,
  userScrollStarted = false,
} = {}) {
  if (
    hasHash ||
    userScrollStarted ||
    Math.max(0, scrollY) <= 0 ||
    Math.max(0, renderedCards) <= 0
  ) {
    return false;
  }

  return true;
}

export function shouldKeepCardGridRecoveryWatchdog({
  totalCards = 0,
  elapsedMs = 0,
  maxMs = GRID_RECOVERY_WATCHDOG_MS,
} = {}) {
  return totalCards > 0 && Math.max(0, elapsedMs) < Math.max(0, maxMs);
}
