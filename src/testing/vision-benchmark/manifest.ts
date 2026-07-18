import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {PNG} from 'pngjs';
import type {RGBAImage} from '../../vision';
import {
  KNOWN_LABELS,
  type CorpusLabel,
  type CorpusManifestRecord,
  type LocatedCorpusRecord,
  type TargetSplit,
} from './types';

const LABELS = new Set<CorpusLabel>([...KNOWN_LABELS, 'unknown']);
const SPLITS = new Set<TargetSplit>(['train', 'val', 'test']);
const SHA256 = /^[0-9a-f]{64}$/;

export async function loadCorpusManifests(
  manifestPaths: readonly string[],
  split?: TargetSplit,
): Promise<LocatedCorpusRecord[]> {
  const records: LocatedCorpusRecord[] = [];
  const seenIds = new Set<string>();
  for (const manifestValue of manifestPaths) {
    const manifest = path.resolve(manifestValue);
    const root = path.dirname(manifest);
    const text = await readFile(manifest, 'utf8');
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      const record = parseRecord(JSON.parse(line) as unknown, manifest, index + 1);
      if (seenIds.has(record.id)) throw new Error(`Duplicate corpus id: ${record.id}`);
      seenIds.add(record.id);
      if (split && record.target_split !== split) continue;
      const absolutePath = path.resolve(root, record.path);
      if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
        throw new Error(`Corpus path escapes manifest root: ${record.path}`);
      }
      records.push({record, absolutePath});
    }
  }
  return records;
}

export async function readVerifiedPng(item: LocatedCorpusRecord): Promise<RGBAImage> {
  const bytes = await readFile(item.absolutePath);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== item.record.sha256) {
    throw new Error(`Checksum mismatch for ${item.record.id}`);
  }
  const decoded = PNG.sync.read(bytes);
  return {
    width: decoded.width,
    height: decoded.height,
    data: new Uint8ClampedArray(decoded.data),
  };
}

/** Reject exact source or normalized-content reuse across named splits. */
export function assertCorpusDisjoint(records: readonly LocatedCorpusRecord[]): void {
  const groups = new Map<string, Set<TargetSplit>>();
  for (const {record} of records) {
    for (const key of [
      `source-group:${record.source_group}`,
      `normalized-sha256:${record.sha256}`,
      `raw-sha256:${record.raw_sha256}`,
    ]) {
      const splits = groups.get(key) ?? new Set<TargetSplit>();
      splits.add(record.target_split);
      groups.set(key, splits);
    }
  }
  const leaks = [...groups.entries()]
    .filter(([, splits]) => splits.size > 1)
    .map(([key, splits]) => `${key} -> ${[...splits].sort().join(',')}`);
  if (leaks.length > 0) {
    throw new Error(`Corpus leakage detected: ${leaks.slice(0, 5).join('; ')}`);
  }
}

function parseRecord(value: unknown, manifest: string, line: number): CorpusManifestRecord {
  if (!value || typeof value !== 'object') throw invalid(manifest, line, 'row is not an object');
  const row = value as Record<string, unknown>;
  if (row.schema !== 'semantic-dark.corpus.v1') throw invalid(manifest, line, 'bad schema');
  for (const key of [
    'id',
    'source',
    'source_group',
    'path',
    'sha256',
    'raw_sha256',
    'license',
    'revision',
  ] as const) {
    if (typeof row[key] !== 'string' || !row[key].trim()) {
      throw invalid(manifest, line, `${key} is required`);
    }
  }
  if (!LABELS.has(row.label as CorpusLabel)) throw invalid(manifest, line, 'bad label');
  if (!SPLITS.has(row.target_split as TargetSplit)) throw invalid(manifest, line, 'bad split');
  if (!SHA256.test(row.sha256 as string) || !SHA256.test(row.raw_sha256 as string)) {
    throw invalid(manifest, line, 'bad normalized or raw sha256');
  }
  if (!Number.isInteger(row.original_width) || (row.original_width as number) <= 0 ||
      !Number.isInteger(row.original_height) || (row.original_height as number) <= 0) {
    throw invalid(manifest, line, 'bad original dimensions');
  }
  const relative = row.path as string;
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) {
    throw invalid(manifest, line, 'path must be safe and relative');
  }
  return row as unknown as CorpusManifestRecord;
}

function invalid(manifest: string, line: number, reason: string): Error {
  return new Error(`Invalid manifest ${manifest}:${line}: ${reason}`);
}
