export const DOM_ATTRIBUTE = {
  color: 'data-semantic-dark-color',
  background: 'data-semantic-dark-background',
  backgroundImage: 'data-semantic-dark-background-image',
  border: 'data-semantic-dark-border',
  decoration: 'data-semantic-dark-decoration',
  beforeColor: 'data-semantic-dark-before-color',
  beforeBackground: 'data-semantic-dark-before-background',
  beforeBackgroundImage: 'data-semantic-dark-before-background-image',
  beforeBorder: 'data-semantic-dark-before-border',
  afterColor: 'data-semantic-dark-after-color',
  afterBackground: 'data-semantic-dark-after-background',
  afterBackgroundImage: 'data-semantic-dark-after-background-image',
  afterBorder: 'data-semantic-dark-after-border',
  updating: 'data-semantic-dark-updating',
} as const;

export const DOM_VARIABLE = {
  color: '--semantic-dark-color',
  background: '--semantic-dark-background',
  backgroundImage: '--semantic-dark-background-image',
  borderTop: '--semantic-dark-border-top',
  borderRight: '--semantic-dark-border-right',
  borderBottom: '--semantic-dark-border-bottom',
  borderLeft: '--semantic-dark-border-left',
  decoration: '--semantic-dark-decoration',
  caret: '--semantic-dark-caret',
  beforeColor: '--semantic-dark-before-color',
  beforeBackground: '--semantic-dark-before-background',
  beforeBackgroundImage: '--semantic-dark-before-background-image',
  beforeBorderTop: '--semantic-dark-before-border-top',
  beforeBorderRight: '--semantic-dark-before-border-right',
  beforeBorderBottom: '--semantic-dark-before-border-bottom',
  beforeBorderLeft: '--semantic-dark-before-border-left',
  afterColor: '--semantic-dark-after-color',
  afterBackground: '--semantic-dark-after-background',
  afterBackgroundImage: '--semantic-dark-after-background-image',
  afterBorderTop: '--semantic-dark-after-border-top',
  afterBorderRight: '--semantic-dark-after-border-right',
  afterBorderBottom: '--semantic-dark-after-border-bottom',
  afterBorderLeft: '--semantic-dark-after-border-left',
} as const;
export const DOCUMENT_PROBE_ATTRIBUTE = 'data-semantic-dark-probing';

export function domOverrideCss(documentScoped: boolean): string {
  const attribute = DOM_ATTRIBUTE;
  const variable = DOM_VARIABLE;
  const selector = (name: string, suffix = ''): string => documentScoped
    ? `:root[data-semantic-dark-active][${name}]${suffix}, :root[data-semantic-dark-active] [${name}]${suffix}`
    : `[${name}]${suffix}`;
  const pseudoRules = (
    pseudo: 'before' | 'after',
    attributes: {
      color: string;
      background: string;
      backgroundImage: string;
      border: string;
    },
    variables: {
      color: string;
      background: string;
      backgroundImage: string;
      borderTop: string;
      borderRight: string;
      borderBottom: string;
      borderLeft: string;
    },
  ): string => {
    const suffix = `::${pseudo}`;
    return `
${selector(attributes.color, suffix)} { color: var(${variables.color}) !important; }
${selector(attributes.background, suffix)} { background-color: var(${variables.background}) !important; }
${selector(attributes.backgroundImage, suffix)} { background-image: var(${variables.backgroundImage}) !important; }
${selector(attributes.border, suffix)} {
  border-top-color: var(${variables.borderTop}) !important;
  border-right-color: var(${variables.borderRight}) !important;
  border-bottom-color: var(${variables.borderBottom}) !important;
  border-left-color: var(${variables.borderLeft}) !important;
}`;
  };
  const selection = documentScoped
    ? ':root[data-semantic-dark-active]::selection, :root[data-semantic-dark-active] ::selection'
    : '::selection';
  return `
${selector(attribute.updating)},
${selector(attribute.updating, '::before')},
${selector(attribute.updating, '::after')} { transition: none !important; }
${selector(attribute.color)} { color: var(${variable.color}) !important; }
${selector(attribute.background)} { background-color: var(${variable.background}) !important; }
${selector(attribute.backgroundImage)} { background-image: var(${variable.backgroundImage}) !important; }
${selector(attribute.border)} {
  border-top-color: var(${variable.borderTop}) !important;
  border-right-color: var(${variable.borderRight}) !important;
  border-bottom-color: var(${variable.borderBottom}) !important;
  border-left-color: var(${variable.borderLeft}) !important;
}
${selector(attribute.decoration)} {
  text-decoration-color: var(${variable.decoration}) !important;
  caret-color: var(${variable.caret}) !important;
}
${pseudoRules('before', {
    color: attribute.beforeColor,
    background: attribute.beforeBackground,
    backgroundImage: attribute.beforeBackgroundImage,
    border: attribute.beforeBorder,
  }, {
    color: variable.beforeColor,
    background: variable.beforeBackground,
    backgroundImage: variable.beforeBackgroundImage,
    borderTop: variable.beforeBorderTop,
    borderRight: variable.beforeBorderRight,
    borderBottom: variable.beforeBorderBottom,
    borderLeft: variable.beforeBorderLeft,
  })}
${pseudoRules('after', {
    color: attribute.afterColor,
    background: attribute.afterBackground,
    backgroundImage: attribute.afterBackgroundImage,
    border: attribute.afterBorder,
  }, {
    color: variable.afterColor,
    background: variable.afterBackground,
    backgroundImage: variable.afterBackgroundImage,
    borderTop: variable.afterBorderTop,
    borderRight: variable.afterBorderRight,
    borderBottom: variable.afterBorderBottom,
    borderLeft: variable.afterBorderLeft,
  })}
${selection} { background: #31536b !important; color: #f5f8fa !important; }
`;
}

export function beginDomStyleUpdate(element: HTMLElement): void {
  element.setAttribute(DOM_ATTRIBUTE.updating, '');
  void getComputedStyle(element).transitionDuration;
}

export function endDomStyleUpdate(element: HTMLElement): void {
  void getComputedStyle(element).color;
  element.removeAttribute(DOM_ATTRIBUTE.updating);
}

export function beginDocumentTransitionGuard(root: HTMLElement): void {
  root.setAttribute(DOCUMENT_PROBE_ATTRIBUTE, '');
  flushDocumentStyle(root);
}

export function endDocumentTransitionGuard(root: HTMLElement): void {
  flushDocumentStyle(root);
  root.removeAttribute(DOCUMENT_PROBE_ATTRIBUTE);
}

export function flushDocumentStyle(root: HTMLElement): void {
  void getComputedStyle(root).color;
}
