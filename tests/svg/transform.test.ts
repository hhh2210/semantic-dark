import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

import {beforeEach, describe, expect, it} from 'vitest';

import {transformInlineSvg} from '../../src/svg';
import type {SvgColorRequest, SvgColorTransformer} from '../../src/svg';

const haloFixture = readFileSync(
    resolve(process.cwd(), 'fixtures/svg/semantic-halo-regression.svg'),
    'utf8',
);

type MappingCall = {color: string; request: SvgColorRequest};

function recordingTransformer(
    map: (color: string, request: SvgColorRequest) => string = (_color, request) => {
        if (request.role === 'text') return '#d9dde4';
        if (request.role === 'text-outline') return '#858b95';
        return '#8aa7c4';
    },
): {calls: MappingCall[]; colors: SvgColorTransformer} {
    const calls: MappingCall[] = [];
    return {
        calls,
        colors: {
            mapColor(color, request) {
                calls.push({color, request});
                return map(color, request);
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

describe('transformInlineSvg', () => {
    beforeEach(() => {
        document.body.replaceChildren();
    });

    it('repairs a background-colored text halo without changing its geometry', () => {
        const svg = mountSvg(haloFixture);
        const label = svg.querySelector<SVGTextElement>('#stage-label');
        if (!label) throw new Error('Missing synthetic halo label');
        const originalStyle = label.getAttribute('style');
        const originalStrokeWidth = getComputedStyle(label).getPropertyValue('stroke-width');
        const originalPaintOrder = getComputedStyle(label).getPropertyValue('paint-order');
        const {calls, colors} = recordingTransformer();

        const session = transformInlineSvg(svg, {
            colors,
            darkBackground: '#121212',
            sourceBackground: '#ffffff',
        });

        expect(label.style.getPropertyValue('fill')).toBe('rgb(217, 221, 228)');
        expect(label.style.getPropertyValue('stroke')).toBe('rgb(18, 18, 18)');
        expect(label.style.getPropertyPriority('fill')).toBe('important');
        expect(label.style.getPropertyPriority('stroke')).toBe('important');
        expect(getComputedStyle(label).getPropertyValue('stroke-width')).toBe(originalStrokeWidth);
        expect(getComputedStyle(label).getPropertyValue('paint-order')).toBe(originalPaintOrder);
        expect(session.report.backgroundHalos).toBeGreaterThanOrEqual(4);

        const textCall = calls.find((call) =>
            call.request.role === 'text' &&
            call.request.relatedPaints?.fill === 'rgb(74, 79, 87)'
        );
        expect(textCall?.request.relatedPaints).toMatchObject({
            fill: 'rgb(74, 79, 87)',
            stroke: 'rgb(255, 255, 255)',
            paintOrder: 'stroke',
            strokeWidth: 4,
        });

        session.restore();
        expect(label.getAttribute('style')).toBe(originalStyle);
        expect(svg.querySelector('style')?.textContent).toContain('fill:#4A4F57');
        expect(svg.querySelector('style')?.textContent).toContain('stroke:#FFFFFF');
    });

    it('rewrites presentation attributes and restores their exact source values', () => {
        const svg = mountSvg(`
            <svg xmlns="http://www.w3.org/2000/svg">
              <text id="label" fill="#20242a" stroke="#fff"
                    stroke-width="4" paint-order="stroke">label</text>
            </svg>
        `);
        const label = svg.querySelector<SVGTextElement>('#label');
        if (!label) throw new Error('Missing label');
        const {colors} = recordingTransformer();

        const session = transformInlineSvg(svg, {colors, darkBackground: '#101214'});

        expect(label.getAttribute('fill')).toBe('#d9dde4');
        expect(label.getAttribute('stroke')).toBe('#101214');
        expect(label.getAttribute('stroke-width')).toBe('4');
        expect(label.getAttribute('paint-order')).toBe('stroke');

        session.restore();
        expect(label.getAttribute('fill')).toBe('#20242a');
        expect(label.getAttribute('stroke')).toBe('#fff');
        expect(label.getAttribute('style')).toBeNull();
    });

    it('uses the shared OKLCH color engine when no adapter is supplied', () => {
        const svg = mountSvg(`
            <svg xmlns="http://www.w3.org/2000/svg">
              <text id="label" fill="#20242a" stroke="#fff"
                    stroke-width="4" paint-order="stroke">label</text>
            </svg>
        `);
        const label = svg.querySelector<SVGTextElement>('#label');
        if (!label) throw new Error('Missing label');

        transformInlineSvg(svg, {darkBackground: '#121212'});

        expect(label.getAttribute('fill')).not.toBe('#20242a');
        expect(label.getAttribute('fill')).toMatch(/^rgb\(/);
        expect(label.getAttribute('stroke')).toBe('#121212');
    });

    it('treats inherited tspan and textPath paints as complete text groups', () => {
        const svg = mountSvg(`
            <svg xmlns="http://www.w3.org/2000/svg">
              <defs><path id="curve" d="M0 20 H200"/></defs>
              <text fill="#30343b" stroke="#fff" stroke-width="4" paint-order="stroke">
                <tspan id="span">nested</tspan>
                <textPath id="path-label" href="#curve">on a path</textPath>
              </text>
            </svg>
        `);
        const span = svg.querySelector<SVGTSpanElement>('#span');
        const pathLabel = svg.querySelector<SVGTextPathElement>('#path-label');
        if (!span || !pathLabel) throw new Error('Missing nested text nodes');
        const {colors} = recordingTransformer();

        const session = transformInlineSvg(svg, {colors, darkBackground: '#121212'});

        for (const element of [span, pathLabel]) {
            expect(element.style.getPropertyValue('fill')).toBe('rgb(217, 221, 228)');
            expect(element.style.getPropertyValue('stroke')).toBe('rgb(18, 18, 18)');
        }
        expect(session.report.backgroundHalos).toBe(3);

        session.restore();
        expect(span.getAttribute('style')).toBeNull();
        expect(pathLabel.getAttribute('style')).toBeNull();
    });

    it('resolves currentColor before requesting a semantic mapping', () => {
        const svg = mountSvg(`
            <svg xmlns="http://www.w3.org/2000/svg">
              <circle id="status" color="#e63946" fill="currentColor" r="4"/>
              <g color="#2a9d8f"><circle id="inherited" fill="currentColor" r="4"/></g>
            </svg>
        `);
        const circle = svg.querySelector<SVGCircleElement>('#status');
        const inherited = svg.querySelector<SVGCircleElement>('#inherited');
        if (!circle || !inherited) throw new Error('Missing circle');
        const {calls, colors} = recordingTransformer(() => '#f06a73');

        const session = transformInlineSvg(svg, {colors, darkBackground: '#121212'});

        expect(calls).toContainEqual(expect.objectContaining({color: '#e63946'}));
        expect(calls).toContainEqual(expect.objectContaining({color: '#2a9d8f'}));
        expect(calls.find((call) => call.color === '#e63946')?.request).toMatchObject({
            role: 'graphic',
            preserveHue: true,
        });
        expect(circle.getAttribute('fill')).toBe('#f06a73');
        expect(inherited.getAttribute('fill')).toBe('#f06a73');
        expect(session.report.currentColorResolutions).toBeGreaterThanOrEqual(2);

        session.restore();
        expect(circle.getAttribute('fill')).toBe('currentColor');
        expect(circle.getAttribute('color')).toBe('#e63946');
        expect(inherited.getAttribute('fill')).toBe('currentColor');
    });

    it('maps local gradient stops while preserving the paint-server reference', () => {
        const svg = mountSvg(`
            <svg xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="heat">
                  <stop id="warm" offset="0" stop-color="#e63946"/>
                  <stop id="cool" offset="1" style="stop-color:#457b9d !important"/>
                </linearGradient>
              </defs>
              <rect id="bar" width="100" height="20" fill="url(#heat)"/>
            </svg>
        `);
        const bar = svg.querySelector<SVGRectElement>('#bar');
        const warm = svg.querySelector<SVGStopElement>('#warm');
        const cool = svg.querySelector<SVGStopElement>('#cool');
        if (!bar || !warm || !cool) throw new Error('Missing gradient fixture nodes');
        const {calls, colors} = recordingTransformer((color) =>
            color.toLowerCase() === '#e63946' ? '#ef6670' : '#72a8c7'
        );

        const session = transformInlineSvg(svg, {colors, darkBackground: '#121212'});

        expect(bar.getAttribute('fill')).toBe('url(#heat)');
        expect(warm.getAttribute('stop-color')).toBe('#ef6670');
        expect(cool.style.getPropertyValue('stop-color')).toBe('rgb(114, 168, 199)');
        expect(cool.style.getPropertyPriority('stop-color')).toBe('important');
        expect(session.report.gradientStops).toBe(2);
        expect(calls
            .filter((call) => call.request.role === 'gradient-stop')
            .every((call) => call.request.preserveHue))
            .toBe(true);

        session.restore();
        expect(warm.getAttribute('stop-color')).toBe('#e63946');
        expect(cool.getAttribute('style')).toBe('stop-color:#457b9d !important');
    });

    it('uses one preserve-hue palette mapping for a repeated chart color', () => {
        const svg = mountSvg(`
            <svg xmlns="http://www.w3.org/2000/svg">
              <rect id="series" fill="#c0392b" stroke="#c0392b" stroke-width="2"/>
            </svg>
        `);
        const series = svg.querySelector<SVGRectElement>('#series');
        if (!series) throw new Error('Missing series');
        const {calls, colors} = recordingTransformer((_color, request) =>
            request.property === 'fill' ? '#d76559' : '#00ffff'
        );

        transformInlineSvg(svg, {colors, darkBackground: '#121212'});

        expect(series.getAttribute('fill')).toBe('#d76559');
        expect(series.getAttribute('stroke')).toBe('#d76559');
        expect(calls.filter((call) => call.color === '#c0392b')).toHaveLength(1);
        expect(calls[0]?.request).toMatchObject({role: 'graphic', preserveHue: true});
    });

    it('restores pre-existing inline values and priorities exactly and only once', () => {
        const svg = mountSvg(`
            <svg xmlns="http://www.w3.org/2000/svg">
              <text id="label" style="fill:#252a30 !important;stroke:#fff;stroke-width:4;paint-order:stroke">x</text>
            </svg>
        `);
        const label = svg.querySelector<SVGTextElement>('#label');
        if (!label) throw new Error('Missing label');
        const originalStyle = label.getAttribute('style');
        const {colors} = recordingTransformer();

        const session = transformInlineSvg(svg, {colors, darkBackground: '#121212'});
        session.restore();
        session.restore();

        expect(label.getAttribute('style')).toBe(originalStyle);
        expect(label.style.getPropertyPriority('fill')).toBe('important');
        expect(label.style.getPropertyPriority('stroke')).toBe('');
    });
});
