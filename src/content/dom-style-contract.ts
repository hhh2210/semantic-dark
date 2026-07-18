export const DOM_ATTRIBUTE = {
  color: 'data-semantic-dark-color',
  background: 'data-semantic-dark-background',
  backgroundImage: 'data-semantic-dark-background-image',
  border: 'data-semantic-dark-border',
  decoration: 'data-semantic-dark-decoration',
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
} as const;
export const DOCUMENT_PROBE_ATTRIBUTE = 'data-semantic-dark-probing';

export function domOverrideCss(documentScoped: boolean): string {
  const attribute = DOM_ATTRIBUTE;
  const variable = DOM_VARIABLE;
  const selector = (name: string): string => documentScoped
    ? `:root[data-semantic-dark-active][${name}], :root[data-semantic-dark-active] [${name}]`
    : `[${name}]`;
  const selection = documentScoped
    ? ':root[data-semantic-dark-active]::selection, :root[data-semantic-dark-active] ::selection'
    : '::selection';
  return `
${selector(attribute.updating)} { transition: none !important; }
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
