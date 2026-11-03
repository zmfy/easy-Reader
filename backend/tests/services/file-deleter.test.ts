import fs from 'fs';
import path from 'path';
import { deleteBookCascade, DeleteRequest, _setRootForTesting } from '../../src/services/file-deleter';

const TMP = path.join(__dirname, '__test-deleter-tmp');

beforeEach(() => {
  if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  _setRootForTesting(TMP);
});

afterEach(() => {
  if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true, force: true });
  _setRootForTesting(null);
});

describe('deleteBookCascade safety checks', () => {
  it('throws when file_path is outside root', () => {
    const req: DeleteRequest = {
      file_path: '/etc/passwd',
      book_id: 'x',
      cascade_duplicate_ids: [],
      cascade_duplicate_paths: [],
      user_id: 'u',
    };
    expect(() => deleteBookCascade(req, { dryRun: true })).toThrow(/outside root/i);
  });

  it('throws when file_path contains traversal', () => {
    const req: DeleteRequest = {
      file_path: path.join(TMP, '../escape.txt'),
      book_id: 'x',
      cascade_duplicate_ids: [],
      cascade_duplicate_paths: [],
      user_id: 'u',
    };
    expect(() => deleteBookCascade(req, { dryRun: true })).toThrow(/outside root/i);
  });

  it('deletes file and returns count when path is inside root', () => {
    const p = path.join(TMP, 'a.txt');
    fs.writeFileSync(p, 'content');
    const req: DeleteRequest = {
      file_path: p,
      book_id: 'x',
      cascade_duplicate_ids: [],
      cascade_duplicate_paths: [],
      user_id: 'u',
    };
    const r = deleteBookCascade(req, { dryRun: false, skipDbOps: true });
    expect(r.files_deleted).toBe(1);
    expect(fs.existsSync(p)).toBe(false);
  });

  it('handles missing files gracefully', () => {
    const req: DeleteRequest = {
      file_path: path.join(TMP, 'nonexistent.txt'),
      book_id: 'x',
      cascade_duplicate_ids: [],
      cascade_duplicate_paths: [],
      user_id: 'u',
    };
    const r = deleteBookCascade(req, { dryRun: false, skipDbOps: true });
    expect(r.files_deleted).toBe(0);
    expect(r.warnings).toContain('file not found');
  });
});
