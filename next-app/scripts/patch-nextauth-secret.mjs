import { randomBytes } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(process.cwd(), '.env.local');
let content = readFileSync(envPath, 'utf8');

const weak = /your-secret-key-change-this|REPLACE_WITH/i;
if (!weak.test(content)) {
  console.log('NEXTAUTH_SECRET already looks configured.');
  process.exit(0);
}

const secret = randomBytes(32).toString('base64');
content = content.replace(
  /NEXTAUTH_SECRET="[^"]*"/,
  `NEXTAUTH_SECRET="${secret}"`,
);
writeFileSync(envPath, content);
console.log('NEXTAUTH_SECRET updated in .env.local');
