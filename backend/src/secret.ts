import crypto from 'crypto';
import path from 'path';
import fs from 'fs';

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const SECRET_FILE = path.join(DATA_DIR, '.jwt_secret');
const PLACEHOLDER = 'change-this-to-a-secure-random-string';

function loadOrGenerateSecret(): string {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET !== PLACEHOLDER) {
    return process.env.JWT_SECRET;
  }

  if (fs.existsSync(SECRET_FILE)) {
    return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  }

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const secret = crypto.randomBytes(32).toString('base64url');
  fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
  console.log('[auth] JWT_SECRET not set — generated and saved to', SECRET_FILE);
  return secret;
}

export const JWT_SECRET = loadOrGenerateSecret();
