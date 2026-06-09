/** Opaque cache validator for a list: changes whenever its source changes.
 *  Built from a parent's updatedAt (epoch ms) and item count. */
export function listValidator(updatedAt?: number, count?: number): string {
  return `${updatedAt ?? 0}:${count ?? 0}`;
}
