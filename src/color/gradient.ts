import {compositeSrgb} from './composite';
import {relativeLuminance} from './contrast';
import {formatCssColor, parseCssColor} from './css';
import {mapRoleColor} from './dark-map';
import type {SrgbColor} from './types';

const COLOR_FUNCTIONS = new Set([
  'color',
  'hsl',
  'hsla',
  'oklab',
  'oklch',
  'rgb',
  'rgba',
]);

export interface GradientMapResult {
  css: string;
  /** Brightest mapped stop, flattened over the configured canvas. */
  readabilityBackground: string;
}

/** Rewrite solid color stops in a computed CSS gradient without touching its geometry. */
export function mapCssGradient(
  input: string,
  darkBackground: string,
): GradientMapResult | null {
  if (!/gradient\s*\(/i.test(input)) return null;
  const canvas = parseCssColor(darkBackground);
  if (!canvas) return null;

  let output = '';
  let index = 0;
  let mappedStops = 0;
  let brightest = canvas;

  const mapToken = (token: string): string => {
    const source = parseCssColor(token);
    if (!source || source.a <= 1e-6) return token;
    const mapped = mapRoleColor(source, {
      role: 'surface',
      against: canvas,
      preserveHue: true,
      minContrast: 1,
    });
    const flattened = compositeSrgb(mapped, {...canvas, a: 1});
    if (relativeLuminance(flattened) > relativeLuminance(brightest)) brightest = flattened;
    mappedStops += 1;
    return formatCssColor(mapped);
  };

  while (index < input.length) {
    const character = input[index]!;
    if (character === '"' || character === "'") {
      const end = readStringEnd(input, index);
      output += input.slice(index, end);
      index = end;
      continue;
    }
    if (input.startsWith('/*', index)) {
      const end = readCommentEnd(input, index);
      output += input.slice(index, end);
      index = end;
      continue;
    }
    if (character === '#') {
      const token = readHexColor(input, index);
      if (token) {
        output += mapToken(token);
        index += token.length;
        continue;
      }
    }

    if (/[a-z]/i.test(character)) {
      const end = readIdentifierEnd(input, index);
      const identifier = input.slice(index, end);
      const lowerIdentifier = identifier.toLowerCase();
      if (input[end] === '(' && lowerIdentifier === 'url') {
        const functionEnd = readBalancedFunctionEnd(input, end);
        if (functionEnd !== null) {
          output += input.slice(index, functionEnd);
          index = functionEnd;
          continue;
        }
      }
      if (input[end] === '(' && COLOR_FUNCTIONS.has(lowerIdentifier)) {
        const functionEnd = readBalancedFunctionEnd(input, end);
        if (functionEnd !== null) {
          output += mapToken(input.slice(index, functionEnd));
          index = functionEnd;
          continue;
        }
      }
      output += mapToken(identifier);
      index = end;
      continue;
    }

    output += character;
    index += 1;
  }

  return mappedStops === 0
    ? null
    : {css: output, readabilityBackground: formatCssColor(brightest)};
}

function readHexColor(input: string, start: number): string | null {
  const match = input.slice(start).match(/^#[0-9a-f]+/i)?.[0];
  if (!match) return null;
  for (const length of [9, 7, 5, 4]) {
    const token = match.slice(0, length);
    if (token.length === length && parseCssColor(token)) return token;
  }
  return null;
}

function readIdentifierEnd(input: string, start: number): number {
  let end = start + 1;
  while (end < input.length && /[a-z0-9-]/i.test(input[end]!)) end += 1;
  return end;
}

function readBalancedFunctionEnd(input: string, openingParenthesis: number): number | null {
  let depth = 0;
  for (let index = openingParenthesis; index < input.length; index += 1) {
    if (input[index] === '"' || input[index] === "'") {
      index = readStringEnd(input, index) - 1;
      continue;
    }
    if (input[index] === '(') depth += 1;
    if (input[index] !== ')') continue;
    depth -= 1;
    if (depth === 0) return index + 1;
  }
  return null;
}

function readStringEnd(input: string, start: number): number {
  const quote = input[start];
  let index = start + 1;
  while (index < input.length) {
    if (input[index] === '\\') {
      index += 2;
      continue;
    }
    index += 1;
    if (input[index - 1] === quote) break;
  }
  return index;
}

function readCommentEnd(input: string, start: number): number {
  const end = input.indexOf('*/', start + 2);
  return end === -1 ? input.length : end + 2;
}
