// Shared alias-aware matching, backed by data/aliases.json. Used by any tool that filters on a
// member/group name, so "릭구"/"위시"/romanized names resolve the same way everywhere.
export function norm(value: string | undefined | null): string {
  return (value ?? "").toString().trim().toLowerCase();
}

export function fieldMatches(canonicalValue: string, filter: string, aliasMap: Record<string, string[]>): boolean {
  if (!filter) return true;
  const canonLower = norm(canonicalValue);
  if (canonLower.includes(filter)) return true;
  const aliases = (aliasMap[canonicalValue] ?? []).map(norm);
  return aliases.some((alias) => alias === filter || alias.includes(filter) || filter.includes(alias));
}
