export const applyOrderOverride = (defaultIds: string[], override: string[]): string[] => {
  if (override.length === 0) return defaultIds;

  const defaultSet = new Set(defaultIds);
  const seen = new Set<string>();
  const orderedIds: string[] = [];

  override.forEach((id) => {
    if (!defaultSet.has(id) || seen.has(id)) return;
    seen.add(id);
    orderedIds.push(id);
  });

  defaultIds.forEach((id) => {
    if (seen.has(id)) return;
    seen.add(id);
    orderedIds.push(id);
  });

  return orderedIds;
};
