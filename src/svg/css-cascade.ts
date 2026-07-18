interface RuleCandidate {
    value: string;
    important: boolean;
    specificity: number;
    order: number;
}

const LOCAL_STYLE_RULE_CACHE = new WeakMap<Element, {
    text: string;
    rules: readonly CSSRule[];
}>();

/** CSSOM fallback for DOMs that expose SVG UA defaults from getComputedStyle. */
export function readAuthorRuleProperty(element: SVGElement, name: string): string {
    let winner: RuleCandidate | null = null;
    let order = 0;

    const visit = (rules: CSSRuleList): void => {
        for (const rule of rules) {
            order += 1;
            if ('selectorText' in rule && 'style' in rule) {
                const styleRule = rule as CSSStyleRule;
                const value = styleRule.style.getPropertyValue(name).trim();
                if (!value) continue;
                const specificity = matchingSpecificity(element, styleRule.selectorText);
                if (specificity < 0) continue;
                const candidate: RuleCandidate = {
                    value,
                    important: styleRule.style.getPropertyPriority(name) === 'important',
                    specificity,
                    order,
                };
                if (!winner || ruleCandidateWins(candidate, winner)) winner = candidate;
                continue;
            }

            if ('cssRules' in rule) {
                try {
                    visit((rule as CSSGroupingRule).cssRules);
                } catch {
                    // Ignore inaccessible or unsupported nested rule lists.
                }
            }
        }
    };

    for (const sheet of element.ownerDocument.styleSheets) {
        try {
            visit(sheet.cssRules);
        } catch {
            // Cross-origin sheets are intentionally opaque to page scripts.
        }
    }

    // jsdom and some XML DOMs omit `<style>` inside `<svg>` from styleSheets.
    for (const style of element.ownerDocument.querySelectorAll('svg style')) {
        const attachedSheet = (style as unknown as {sheet?: CSSStyleSheet}).sheet;
        if (attachedSheet) continue;
        visit(asRuleList(parseLocalStyleRules(style)));
    }

    return (winner as RuleCandidate | null)?.value ?? '';
}

function parseLocalStyleRules(style: Element): readonly CSSRule[] {
    const text = style.textContent ?? '';
    const cached = LOCAL_STYLE_RULE_CACHE.get(style);
    if (cached?.text === text) return cached.rules;

    const document = style.ownerDocument;
    const mount = document.head ?? document.documentElement;
    if (!mount) return [];
    const parser = document.createElement('style');
    parser.setAttribute('media', 'not all');
    parser.textContent = text;
    mount.append(parser);
    const rules = Array.from(parser.sheet?.cssRules ?? []);
    parser.remove();
    LOCAL_STYLE_RULE_CACHE.set(style, {text, rules});
    return rules;
}

function asRuleList(rules: readonly CSSRule[]): CSSRuleList {
    return rules as unknown as CSSRuleList;
}

function ruleCandidateWins(candidate: RuleCandidate, current: RuleCandidate): boolean {
    if (candidate.important !== current.important) return candidate.important;
    if (candidate.specificity !== current.specificity) {
        return candidate.specificity > current.specificity;
    }
    return candidate.order > current.order;
}

function matchingSpecificity(element: Element, selectorList: string): number {
    let maximum = -1;
    for (const selector of selectorList.split(',')) {
        try {
            if (!element.matches(selector.trim())) continue;
        } catch {
            continue;
        }
        const withoutWhere = selector.replace(/:where\([^)]*\)/g, '');
        const ids = withoutWhere.match(/#[\w-]+/g)?.length ?? 0;
        const classesAndAttributes = withoutWhere
            .match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g)?.length ?? 0;
        const elements = withoutWhere
            .replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|::?[\w-]+(?:\([^)]*\))?/g, ' ')
            .split(/[\s>+~*]+/)
            .filter(Boolean)
            .length;
        maximum = Math.max(maximum, ids * 10_000 + classesAndAttributes * 100 + elements);
    }
    return maximum;
}
