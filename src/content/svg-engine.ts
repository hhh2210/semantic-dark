import {mapColor} from '../color/index';
import {transformInlineSvg, type SvgColorRequest, type SvgTransformSession} from '../svg/index';
import type {ThemeConfig} from '../types';

function isTransparent(color: string): boolean {
  const value = color.replaceAll(' ', '').toLowerCase();
  return value === 'transparent' || value.endsWith(',0)') || value.endsWith('/0)');
}

function sourceBackground(svg: SVGSVGElement): string {
  let current: Element | null = svg;
  while (current) {
    const color = getComputedStyle(current).backgroundColor;
    if (!isTransparent(color)) return color;
    current = current.parentElement;
  }
  return '#ffffff';
}

function roleFor(request: SvgColorRequest):
  'text-fill' | 'text-stroke' | 'graphic-fill' | 'graphic-stroke' | 'gradient-stop' {
  if (request.role === 'gradient-stop') return 'gradient-stop';
  if (request.role === 'text' || request.role === 'text-outline') {
    return request.property === 'stroke' ? 'text-stroke' : 'text-fill';
  }
  return request.property === 'stroke' ? 'graphic-stroke' : 'graphic-fill';
}

export class SvgThemeEngine {
  private config: ThemeConfig;
  private readonly sessions = new Map<SVGSVGElement, SvgTransformSession>();
  private observer: MutationObserver | null = null;

  constructor(config: ThemeConfig) {
    this.config = config;
  }

  start(root: Document = document): void {
    if (!this.config.enabled) return;
    this.scan(root);
    this.observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof SVGSVGElement) this.apply(node);
          else if (node instanceof Element) this.scan(node);
        }
      }
    });
    this.observer.observe(root, {subtree: true, childList: true});
  }

  update(config: ThemeConfig): void {
    this.config = config;
    this.restore();
    if (config.enabled) {
      this.scan(document);
      if (!this.observer) this.start(document);
    } else {
      this.observer?.disconnect();
      this.observer = null;
    }
  }

  rescan(): void {
    if (!this.config.enabled) return;
    for (const session of this.sessions.values()) session.restore();
    this.sessions.clear();
    this.scan(document);
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.restore();
  }

  private scan(root: ParentNode): void {
    if (root instanceof SVGSVGElement) this.apply(root);
    for (const svg of root.querySelectorAll<SVGSVGElement>('svg')) this.apply(svg);
  }

  private apply(svg: SVGSVGElement): void {
    if (this.sessions.has(svg) || svg.closest('[data-semantic-dark-ui]')) return;
    const source = sourceBackground(svg);
    const session = transformInlineSvg(svg, {
      darkBackground: this.config.background,
      sourceBackground: source,
      colors: {
        mapColor: (color, request) => mapColor(color, {
          role: roleFor(request),
          background: request.background,
          preserveHue: request.preserveHue,
          ...(request.minContrast == null ? {} : {minContrast: request.minContrast}),
        }),
      },
    });
    svg.setAttribute('data-semantic-dark-svg', '');
    svg.setAttribute('data-semantic-dark-halos', String(session.report.backgroundHalos));
    this.sessions.set(svg, session);
  }

  private restore(): void {
    for (const [svg, session] of this.sessions) {
      session.restore();
      svg.removeAttribute('data-semantic-dark-svg');
      svg.removeAttribute('data-semantic-dark-halos');
    }
    this.sessions.clear();
  }
}
