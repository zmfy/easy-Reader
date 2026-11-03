import fs from 'fs';
import path from 'path';

export function isPathInsideRoot(root: string, target: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (resolvedTarget === resolvedRoot) return false;
  return resolvedTarget.startsWith(resolvedRoot + path.sep);
}

export function assertPathInsideRoot(root: string, target: string): void {
  if (!isPathInsideRoot(root, target)) {
    throw new Error(`Path "${target}" is outside root "${root}"`);
  }
}

/**
 * Resolve symlinks and return the real path if the file actually lives inside
 * root, otherwise null (also null when the file does not exist).
 */
export function resolveRealPathInsideRoot(root: string, target: string): string | null {
  try {
    const realTarget = fs.realpathSync(target);
    const realRoot = fs.realpathSync(root);
    return isPathInsideRoot(realRoot, realTarget) ? realTarget : null;
  } catch {
    return null;
  }
}
