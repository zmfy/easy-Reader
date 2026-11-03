import fs from 'fs';
import os from 'os';
import path from 'path';
import { collectFiles, findOrphanBookIds } from '../../src/services/scan-walker';

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

describe('scan orphan detection with unreadable subdirectories', () => {
  let root: string;
  let lockedDir: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-walk-'));
    fs.writeFileSync(path.join(root, 'ok.txt'), 'x');
    lockedDir = path.join(root, 'locked');
    fs.mkdirSync(lockedDir);
    fs.writeFileSync(path.join(lockedDir, 'hidden.txt'), 'x');
    fs.chmodSync(lockedDir, 0o000);
  });
  afterEach(() => {
    fs.chmodSync(lockedDir, 0o755);
    fs.rmSync(root, { recursive: true, force: true });
  });

  (isRoot ? it.skip : it)('reports unreadable directories instead of silently skipping them', () => {
    const walk = collectFiles(root);
    expect(walk.files).toEqual([path.join(root, 'ok.txt')]);
    expect(walk.unreadableDirs).toEqual([lockedDir]);
  });

  (isRoot ? it.skip : it)('does not treat books inside an unreadable directory as orphans', () => {
    const walk = collectFiles(root);
    const rows = [
      { id: 'ok', file_path: path.join(root, 'ok.txt') },
      { id: 'hidden', file_path: path.join(lockedDir, 'hidden.txt') },
      { id: 'gone', file_path: path.join(root, 'deleted.txt') },
    ];
    expect(findOrphanBookIds(rows, walk)).toEqual(['gone']);
  });
});

describe('findOrphanBookIds', () => {
  it('only matches whole directory prefixes', () => {
    const rows = [
      { id: 'a', file_path: '/books/locked/a.txt' },
      { id: 'b', file_path: '/books/locked2/b.txt' },
    ];
    expect(findOrphanBookIds(rows, { files: [], unreadableDirs: ['/books/locked'] })).toEqual(['b']);
  });
});

describe('collectFiles supported formats', () => {
  it('includes every format the reader can open (txt / epub / pdf / umd)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-formats-'));
    for (const f of ['a.txt', 'b.EPUB', 'c.pdf', 'd.umd', 'e.docx']) fs.writeFileSync(path.join(root, f), 'x');
    const names = collectFiles(root).files.map(f => path.basename(f)).sort();
    fs.rmSync(root, { recursive: true, force: true });
    expect(names).toEqual(['a.txt', 'b.EPUB', 'c.pdf', 'd.umd']);
  });
});
