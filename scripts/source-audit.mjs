import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'dist-ssr', 'data']);
const textExtensions = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.mjs',
  '.ts',
  '.tsx',
  '.md',
  '.yml',
  '.yaml',
]);

const forbiddenContent = [
  { name: 'hosted backend client reference', pattern: new RegExp('supa' + 'base', 'i') },
  { name: 'hosted backend environment variable', pattern: new RegExp('VITE_' + 'SUPA' + 'BASE', 'i') },
  { name: 'demo email identity', pattern: new RegExp('demo' + '@', 'i') },
  { name: 'demo user fallback id', pattern: new RegExp('demo' + '-user', 'i') },
  { name: 'production random calculation value', pattern: new RegExp('Math' + '\\.' + 'random') },
  { name: 'patch conflict marker', pattern: new RegExp('<'.repeat(7) + '|' + '>'.repeat(7)) },
  { name: 'corrupt patch hunk marker', pattern: /^@@/m },
  { name: 'corrupt added import marker', pattern: /^\+import/m },
];

const errors = [];

const hasTextExtension = (filePath) => {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('package-lock.json')) return true;
  const dot = lower.lastIndexOf('.');
  return dot >= 0 && textExtensions.has(lower.slice(dot));
};

const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    const rel = relative(root, fullPath).replaceAll('\\', '/');

    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) walk(fullPath);
      continue;
    }

    if (entry.name === '.env' || (entry.name.startsWith('.env.') && entry.name !== '.env.example')) {
      errors.push(`${rel}: checked-in environment file is not allowed`);
    }

    if (!entry.isFile() || !hasTextExtension(fullPath)) continue;
    if (statSync(fullPath).size > 5_000_000) continue;

    const content = readFileSync(fullPath, 'utf8');
    for (const rule of forbiddenContent) {
      if (rule.pattern.test(content)) {
        errors.push(`${rel}: ${rule.name}`);
      }
    }
  }
};

walk(root);

if (errors.length > 0) {
  console.error('Source audit failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Source audit passed.');
