type AttributeChange = {
    kind: "attribute";
    element: Element;
    name: string;
    existed: boolean;
    value: string | null;
};

type StyleChange = {
    kind: "style";
    element: SVGElement;
    existed: boolean;
    value: string | null;
};

type Change = AttributeChange | StyleChange;

export type PaintSource = "attribute" | "style" | "computed" | "default";

/** Records the first write to each property so a transform is losslessly reversible. */
export class MutationJournal {
    private readonly changes: Change[] = [];
    private readonly recorded = new WeakMap<Element, Set<string>>();
    private restored = false;

    setPaint(
        element: SVGElement,
        name: string,
        value: string,
        source: PaintSource,
    ): void {
        if (this.restored) {
            throw new Error("Cannot mutate an SVG after its transform session was restored");
        }

        if (source === "attribute") {
            this.recordAttribute(element, name);
            element.setAttribute(name, value);
            return;
        }

        this.recordStyle(element);
        // Important is needed to override author rules such as `.chart text { fill: ... }`.
        element.style.setProperty(name, value, "important");
    }

    restore(): void {
        if (this.restored) return;

        for (let index = this.changes.length - 1; index >= 0; index -= 1) {
            const change = this.changes[index];
            if (!change) continue;
            if (change.kind === "attribute") {
                if (change.existed) {
                    change.element.setAttribute(change.name, change.value ?? "");
                } else {
                    change.element.removeAttribute(change.name);
                }
                continue;
            }

            if (change.existed) {
                change.element.setAttribute("style", change.value ?? "");
            } else {
                change.element.removeAttribute("style");
            }
        }

        this.restored = true;
    }

    private shouldRecord(element: Element, key: string): boolean {
        let keys = this.recorded.get(element);
        if (!keys) {
            keys = new Set<string>();
            this.recorded.set(element, keys);
        }
        if (keys.has(key)) return false;
        keys.add(key);
        return true;
    }

    private recordAttribute(element: Element, name: string): void {
        if (!this.shouldRecord(element, `attribute:${name}`)) return;
        this.changes.push({
            kind: "attribute",
            element,
            name,
            existed: element.hasAttribute(name),
            value: element.getAttribute(name),
        });
    }

    private recordStyle(element: SVGElement): void {
        // Snapshot the complete attribute once. Restoring declarations one by
        // one would preserve meaning but lose source spelling/order/spacing.
        if (!this.shouldRecord(element, "style")) return;
        this.changes.push({
            kind: "style",
            element,
            existed: element.hasAttribute("style"),
            value: element.getAttribute("style"),
        });
    }
}
