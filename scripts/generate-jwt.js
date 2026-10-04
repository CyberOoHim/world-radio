#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Read .env if present
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx > 0) {
      const k = trimmed.slice(0, idx).trim();
      let v = trimmed.slice(idx + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!(k in process.env)) process.env[k] = v;
    }
  }
}

const secret = (process.env.JWT_SECRET || 'world-radio-jwt-secret-key-32chars!!').trim();
const now = Math.floor(Date.now() / 1000);
const exp = now + 86400 * 30; // 30 days

const header = { alg: 'HS256', typ: 'JWT' };
const payload = {
  sub: 'authorized_user',
  role: 'listener',
  iat: now,
  exp: exp,
};

const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
const signatureInput = `${encodedHeader}.${encodedPayload}`;
const signature = crypto.createHmac('sha256', secret).update(signatureInput).digest('base64url');
const token = `${signatureInput}.${signature}`;

console.log('\n=== World Radio JWT String ===');
console.log(token);
console.log('==============================\n');
console.log(`Expires: ${new Date(exp * 1000).toISOString()}`);
console.log('Use with Authorization Header:  Authorization: Bearer ' + token);
console.log('Use with Query Parameter:       ?token=' + token + '\n');
