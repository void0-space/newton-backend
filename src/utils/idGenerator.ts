import { randomBytes } from 'crypto';

/**
 * Generate a unique ID using crypto.randomBytes
 * @param length - The length of the generated ID (default: 16)
 * @returns A random string ID
 */
export function generateId(length: number = 16): string {
  return randomBytes(length).toString('hex');
}