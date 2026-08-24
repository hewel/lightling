export const sanitizeHref = (raw: string | undefined): string | undefined => {
  if (raw === undefined) return undefined;

  const value = raw.trim();
  if (value === '') return undefined;

  try {
    const protocol = new URL(value, 'https://placeholder.invalid').protocol;
    return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:'
      ? value
      : undefined;
  } catch {
    return undefined;
  }
};
