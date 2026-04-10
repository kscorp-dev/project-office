/**
 * Safely extract a query/param value as a non-empty string.
 * Returns '' when the value is undefined, an array, or a nested object.
 */
export function qs(val: unknown): string {
  if (typeof val === 'string') return val;
  if (Array.isArray(val) && typeof val[0] === 'string') return val[0];
  return '';
}

/**
 * Safely extract a query/param value as string | undefined.
 * Returns undefined when the value is missing, an array, or a nested object.
 */
export function qsOpt(val: unknown): string | undefined {
  if (typeof val === 'string') return val;
  if (Array.isArray(val) && typeof val[0] === 'string') return val[0];
  return undefined;
}
