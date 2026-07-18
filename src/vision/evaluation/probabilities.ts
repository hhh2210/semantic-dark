export function assertValidLabels<Label extends string>(labels: readonly Label[]): void {
    if (labels.length === 0) throw new RangeError('Evaluation requires at least one label');
    const unique = new Set<string>();
    for (const label of labels) {
        if (!label.trim()) throw new TypeError('Evaluation labels must not be empty');
        if (unique.has(label)) throw new TypeError(`Duplicate evaluation label: ${label}`);
        unique.add(label);
    }
}

export function createLabelRecord<Label extends string, Value>(
    labels: readonly Label[],
    create: (label: Label) => Value,
): Record<Label, Value> {
    const record = Object.create(null) as Record<Label, Value>;
    for (const label of labels) record[label] = create(label);
    return record;
}

/** Normalize arbitrary non-negative scores without silently repairing invalid values. */
export function normalizeClassScores<Label extends string>(
    labels: readonly Label[],
    scores: Readonly<Partial<Record<Label, number>>>,
): Record<Label, number> {
    assertValidLabels(labels);
    const normalized = createLabelRecord(labels, () => 0);
    let total = 0;
    for (const label of labels) {
        const score = scores[label] ?? 0;
        if (!Number.isFinite(score) || score < 0) {
            throw new RangeError(`Invalid score for label "${label}": ${score}`);
        }
        normalized[label] = score;
        total += score;
    }
    if (!(total > 0) || !Number.isFinite(total)) {
        throw new RangeError('Class scores must have a finite positive sum');
    }
    for (const label of labels) normalized[label] /= total;
    return normalized;
}

/** Deterministic argmax: ties retain the order declared by `labels`. */
export function mostLikelyLabel<Label extends string>(
    labels: readonly Label[],
    probabilities: Readonly<Record<Label, number>>,
): Label {
    assertValidLabels(labels);
    let best = labels[0]!;
    for (const label of labels.slice(1)) {
        if (probabilities[label] > probabilities[best]) best = label;
    }
    return best;
}
