import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

let file: string | undefined;

export function setLogFile(path: string | undefined): void {
  file = path;
}

function redact(text: string): string {
  return text.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]');
}

export function describeError(error: unknown): string {
  const lines: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && !seen.has(current) && lines.length < 8) {
    seen.add(current);
    if (current instanceof Error) {
      const code = 'code' in current && current.code != null ? ` [${String(current.code)}]` : '';
      lines.push(`${current.name}${code}: ${current.message}`);
      current = 'cause' in current ? current.cause : undefined;
    } else {
      lines.push(String(current));
      break;
    }
  }
  return redact(lines.join('\n'));
}

export function logInfo(message: string): void {
  write('INFO', redact(message));
}

export function logError(error: unknown): void {
  write('ERROR', describeError(error));
}

function write(level: string, message: string): void {
  const line = `${new Date().toISOString()} ${level} ${message}`;
  if (level === 'ERROR') console.error(line);
  else console.log(line);
  if (!file) return;
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, line + '\n');
  } catch (writeError) {
    console.error(describeError(writeError));
  }
}
