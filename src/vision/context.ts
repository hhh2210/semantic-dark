import {policyForVisualResource} from './classifier';
import type {
    ClassificationScores,
    VisualResourceClassification,
    VisualResourceKind,
} from './types';

export interface VisualResourceContext {
    alternativeText?: string;
    title?: string;
    url?: string;
    role?: string;
}

type KnownKind = Exclude<VisualResourceKind, 'unknown'>;

const PATTERNS: Readonly<Record<KnownKind, readonly RegExp[]>> = {
    diagram: [
        /\b(?:bar|line|pie|area|scatter)\s+chart\b/i,
        /\b(?:chart|diagram|histogram|plot|schematic|timeline|flowchart)\b/i,
    ],
    screenshot: [
        /\b(?:screen\s*capture|screenshot|website\s+preview|ui\s+mockup|dashboard)\b/i,
    ],
    icon: [
        /\b(?:icon|glyph|pictogram|app\s+symbol)\b/i,
    ],
    photo: [
        /\b(?:photo|photograph|portrait|landscape\s+photo)\b/i,
    ],
};

const KNOWN_KINDS = ['photo', 'icon', 'diagram', 'screenshot'] as const;

/** Fuse bounded DOM metadata evidence with an existing pixel classification. */
export function refineVisualResourceClassification(
    classification: VisualResourceClassification,
    context: VisualResourceContext,
): VisualResourceClassification {
    const adjustments: Record<KnownKind, number> = {
        photo: 0,
        icon: 0,
        diagram: 0,
        screenshot: 0,
    };
    addEvidence(adjustments, context.alternativeText, 0.38);
    addEvidence(adjustments, context.title, 0.26);
    addEvidence(adjustments, filenameText(context.url), 0.2);
    addEvidence(adjustments, context.role, 0.08);
    const strongestEvidence = Math.max(...Object.values(adjustments));
    if (strongestEvidence === 0) return classification;

    const scores: ClassificationScores = {...classification.scores};
    for (const kind of KNOWN_KINDS) {
        scores[kind] = clamp(scores[kind] + adjustments[kind]);
    }
    scores.unknown = clamp(scores.unknown - strongestEvidence * 0.65);
    const ranked = (Object.entries(scores) as Array<[VisualResourceKind, number]>)
        .sort((left, right) => right[1] - left[1]);
    const [kind, topScore] = ranked[0]!;
    const margin = topScore - ranked[1]![1];
    const confidence = clamp(0.35 + 0.45 * topScore + 0.45 * margin, 0.35, 0.99);
    const evidenceKind = KNOWN_KINDS.reduce((best, candidate) =>
        adjustments[candidate] > adjustments[best] ? candidate : best
    );
    return {
        ...classification,
        kind,
        policy: policyForVisualResource(kind, classification.features),
        confidence,
        scores,
        signals: [...classification.signals, `context:${evidenceKind}`],
    };
}

function addEvidence(
    adjustments: Record<KnownKind, number>,
    value: string | undefined,
    weight: number,
): void {
    if (!value) return;
    for (const kind of KNOWN_KINDS) {
        if (PATTERNS[kind].some((pattern) => pattern.test(value))) {
            adjustments[kind] = clamp(adjustments[kind] + weight);
        }
    }
}

function filenameText(url: string | undefined): string | undefined {
    if (!url) return undefined;
    try {
        return decodeURIComponent(new URL(url, 'https://local.invalid').pathname)
            .split('/').at(-1)?.replace(/[._-]+/g, ' ');
    } catch {
        return url.replace(/[._-]+/g, ' ');
    }
}

function clamp(value: number, minimum = 0, maximum = 1): number {
    return Math.min(maximum, Math.max(minimum, value));
}
