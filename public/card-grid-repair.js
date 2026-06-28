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
