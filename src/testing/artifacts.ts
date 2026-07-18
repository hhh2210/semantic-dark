import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';

export function resolveScratchOutput(value: string, label = 'Artifact'): string {
  const scratch = path.resolve(homedir(), 'scratch-data');
  const output = path.resolve(value.replace(/^~(?=$|\/)/, homedir()));
  if (output === scratch || !output.startsWith(`${scratch}${path.sep}`)) {
    throw new Error(`${label} output must be a subdirectory of ${scratch}`);
  }
  return output;
}

export async function prepareScratchOutput(value: string, label = 'Artifact'): Promise<string> {
  const output = resolveScratchOutput(value, label);
  await mkdir(output, {recursive: true});
  return output;
}

export function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function serializeCanonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

export async function writeJson(value: unknown, destination: string): Promise<void> {
  await writeFile(destination, serializeJson(value), 'utf8');
}

export async function writeCanonicalJson(value: unknown, destination: string): Promise<void> {
  await writeFile(destination, serializeCanonicalJson(value), 'utf8');
}

export async function writeJsonLines(
  rows: readonly unknown[],
  destination: string,
  canonical = false,
): Promise<void> {
  const values = canonical
    ? rows.map((row) => JSON.stringify(canonicalize(row)))
    : rows.map((row) => JSON.stringify(row));
  await writeFile(destination, `${values.join('\n')}\n`, 'utf8');
}

export function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function sha256File(filePath: string): Promise<string> {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

function canonicalize(value: unknown, location = '$'): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`Non-finite number at ${location}`);
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => canonicalize(item, `${location}[${index}]`));
  }
  if (typeof value === 'object') {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      if (input[key] === undefined) throw new TypeError(`Undefined value at ${location}.${key}`);
      output[key] = canonicalize(input[key], `${location}.${key}`);
    }
    return output;
  }
  throw new TypeError(`Unsupported canonical JSON value at ${location}: ${typeof value}`);
}
