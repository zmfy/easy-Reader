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
