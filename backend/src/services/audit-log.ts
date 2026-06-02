import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db';
import { AuditAction, AuditLog } from '../types';

export interface WriteAuditInput {
  user_id: string;
  action: AuditAction;
  resource_id?: string | null;
  file_path?: string | null;
  details?: Record<string, unknown> | null;
}

export function writeAudit(input: WriteAuditInput): AuditLog {
  const id = uuidv4();
  getDb().prepare(
    `INSERT INTO audit_log (id, user_id, action, resource_id, file_path, details)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.user_id,
    input.action,
    input.resource_id ?? null,
    input.file_path ?? null,
    input.details ? JSON.stringify(input.details) : null,
  );
  return getDb().prepare('SELECT * FROM audit_log WHERE id = ?').get(id) as AuditLog;
}

export interface AuditQuery {
  user_id?: string;
  action?: AuditAction;
  limit?: number;
  offset?: number;
}

export function queryAudit(q: AuditQuery): { logs: AuditLog[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.user_id) { where.push('user_id = ?'); params.push(q.user_id); }
  if (q.action) { where.push('action = ?'); params.push(q.action); }
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const total = (getDb().prepare(`SELECT COUNT(*) as cnt FROM audit_log ${whereClause}`).get(...params) as { cnt: number }).cnt;
  const limit = q.limit ?? 50;
  const offset = q.offset ?? 0;
  const logs = getDb().prepare(
    `SELECT * FROM audit_log ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as AuditLog[];
  return { logs, total };
}
