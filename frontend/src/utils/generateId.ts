/* Generate a random UUID v4 */

export function generateId(): string {
  return crypto.randomUUID();
}
