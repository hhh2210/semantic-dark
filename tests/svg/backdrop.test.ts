import {beforeEach, describe, expect, it} from 'vitest';

import {transformInlineSvg} from '../../src/svg';
import type {SvgColorRequest, SvgColorTransformer} from '../../src/svg';

type MappingCall = {color: string; request: SvgColorRequest};

function recordingTransformer(): {calls: MappingCall[]; colors: SvgColorTransformer} {
    const calls: MappingCall[] = [];
    return {
        calls,
        colors: {
            mapColor(color, request) {
                calls.push({color, request});
                return '#8aa7c4';
            },
        },
    };
}

function mountSvg(markup: string): SVGSVGElement {
    document.body.innerHTML = markup;
    const svg = document.querySelector('svg');
    if (!(svg instanceof SVGSVGElement)) throw new Error('Fixture did not contain an SVG');
    return svg;
}

describe('SVG backdrop recognition', () => {
    beforeEach(() => document.body.replaceChildren());

    it('maps only large opaque background-colored rects as backdrops', () => {
        const svg = mountSvg(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
              <rect id="backdrop" width="80%" height="100%"
                    fill="#fafafa" stroke="#cccccc"/>
              <rect id="panel" width="79" height="100" fill="#fff"/>
              <rect id="transformed" width="100" height="100" fill="#fff"
                    transform="translate(0 0)"/>
            </svg>
        `);
        const backdrop = svg.querySelector<SVGRectElement>('#backdrop');
        const panel = svg.querySelector<SVGRectElement>('#panel');
        const transformed = svg.querySelector<SVGRectElement>('#transformed');
        if (!backdrop || !panel || !transformed) throw new Error('Missing rect fixture nodes');
        const {calls, colors} = recordingTransformer();

        const session = transformInlineSvg(svg, {
            colors,
            darkBackground: '#121212',
            sourceBackground: '#ffffff',
        });

        expect(backdrop.getAttribute('fill')).toBe('#121212');
        expect(backdrop.getAttribute('stroke')).toBe('#8aa7c4');
        expect(panel.getAttribute('fill')).toBe('#8aa7c4');
        expect(transformed.getAttribute('fill')).toBe('#8aa7c4');
        expect(session.report.backdrops).toBe(1);
        expect(calls.some((call) => call.color === '#fafafa')).toBe(false);

        session.restore();
        expect(backdrop.getAttribute('fill')).toBe('#fafafa');
        expect(backdrop.getAttribute('stroke')).toBe('#cccccc');
        expect(panel.getAttribute('fill')).toBe('#fff');
        expect(transformed.getAttribute('fill')).toBe('#fff');
    });

    it('maps a nearly full-canvas rect as background while leaving a card graphic', () => {
        const svg = mountSvg(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60">
              <rect id="backdrop" x="1" y="1" width="98" height="58" fill="#fff"/>
              <rect id="small-card" x="20" y="15" width="30" height="20" fill="#fff"/>
            </svg>
        `);
        const backdrop = svg.querySelector<SVGRectElement>('#backdrop');
        const smallCard = svg.querySelector<SVGRectElement>('#small-card');
        if (!backdrop || !smallCard) throw new Error('Missing canvas fixture nodes');
        const {colors} = recordingTransformer();

        const session = transformInlineSvg(svg, {
            colors,
            sourceBackground: '#ffffff',
            darkBackground: '#111416',
        });

        expect(backdrop.getAttribute('fill')).toBe('#111416');
        expect(smallCard.getAttribute('fill')).toBe('#8aa7c4');
        expect(session.report.backdrops).toBe(1);
    });
});
