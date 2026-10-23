export function matchesClipSearch(
  parts: readonly (string | undefined)[],
  query: string,
): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return parts.some((part) =>
    part ? part.toLocaleLowerCase().includes(needle) : false,
  );
}
