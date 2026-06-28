export function currentTableFromList(tables = [], selectedTableId = "") {
  const list = Array.isArray(tables) ? tables : [];
  if (selectedTableId) return list.find((table) => table.id === selectedTableId) || null;
  return list[0] || null;
}

export function selectedTableIdAfterListLoad(tables = [], selectedTableId = "") {
  if (selectedTableId) return selectedTableId;
  const list = Array.isArray(tables) ? tables : [];
  return list[0]?.id || "";
}

export function shouldFetchSelectedTable(tables = [], selectedTableId = "") {
  if (!selectedTableId) return false;
  const list = Array.isArray(tables) ? tables : [];
  return !list.some((table) => table.id === selectedTableId);
}

export function tableDetailUrl(tableId, basePath = "/api/playground/tables") {
  return `${basePath}/${encodeURIComponent(String(tableId || ""))}`;
}
