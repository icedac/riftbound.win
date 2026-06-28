export function shouldRepairInitialCardGrid({
  totalCards = 0,
  filteredCards = 0,
  visibleCards = 0,
  repairAlreadyRan = false,
} = {}) {
  return !repairAlreadyRan && totalCards > 0 && filteredCards > 0 && visibleCards > 0;
}
