export interface SourceTagged {
    source: string;
}

export interface SourceLeak {
    source: string;
    splits: readonly string[];
    sampleCounts: Readonly<Record<string, number>>;
}

export interface SourceDisjointValidation {
    valid: boolean;
    totalSamples: number;
    uniqueSources: number;
    leakedSourceCount: number;
    leaks: readonly SourceLeak[];
}

export interface SourceDisjointOptions {
    /** Optional canonicalizer for grouping variants such as frames from one URL. */
    sourceKey?: (source: string) => string;
}

/** Validate that no canonical source appears in more than one named split. */
export function validateSourceDisjointSplits<Sample extends SourceTagged>(
    splits: Readonly<Record<string, readonly Sample[]>>,
    options: SourceDisjointOptions = {},
): SourceDisjointValidation {
    const sourceKey = options.sourceKey ?? ((source: string) => source.trim());
    const sources = new Map<string, {source: string; counts: Map<string, number>}>();
    let totalSamples = 0;

    for (const [split, samples] of Object.entries(splits)) {
        if (!split.trim()) throw new TypeError('Split names must not be empty');
        for (const sample of samples) {
            totalSamples += 1;
            const key = sourceKey(sample.source);
            if (!key.trim()) throw new TypeError(`Sample source must not be empty in split "${split}"`);
            const entry = sources.get(key) ?? {source: sample.source, counts: new Map<string, number>()};
            entry.counts.set(split, (entry.counts.get(split) ?? 0) + 1);
            sources.set(key, entry);
        }
    }

    const leaks = [...sources.values()]
        .filter((entry) => entry.counts.size > 1)
        .map((entry): SourceLeak => {
            const splitNames = [...entry.counts.keys()].sort();
            return {
                source: entry.source,
                splits: splitNames,
                sampleCounts: Object.fromEntries(
                    splitNames.map((split) => [split, entry.counts.get(split)!]),
                ),
            };
        })
        .sort((left, right) => left.source.localeCompare(right.source));

    return {
        valid: leaks.length === 0,
        totalSamples,
        uniqueSources: sources.size,
        leakedSourceCount: leaks.length,
        leaks,
    };
}

export function assertSourceDisjointSplits<Sample extends SourceTagged>(
    splits: Readonly<Record<string, readonly Sample[]>>,
    options: SourceDisjointOptions = {},
): void {
    const result = validateSourceDisjointSplits(splits, options);
    if (result.valid) return;
    const summary = result.leaks
        .slice(0, 5)
        .map((leak) => `"${leak.source}" in ${leak.splits.join(', ')}`)
        .join('; ');
    throw new Error(`Source leakage detected across splits: ${summary}`);
}
