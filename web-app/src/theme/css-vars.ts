import type { ThemeTokens } from './types';
import { TOKEN_KEYS, tokenToCssVar } from './types';

/**
 * Generate CSS custom properties string from theme tokens
 */
export function generateCssVars(tokens: ThemeTokens): string {
  return TOKEN_KEYS.map(key => {
    const cssVar = tokenToCssVar(key);
    const value = tokens[key];
    return `${cssVar}: ${value};`;
  }).join('\n  ');
}

/**
 * Apply theme tokens as CSS custom properties to an element
 */
export function applyTheme(tokens: ThemeTokens, element: HTMLElement = document.documentElement): void {
  TOKEN_KEYS.forEach(key => {
    const cssVar = tokenToCssVar(key);
    const value = tokens[key];
    element.style.setProperty(cssVar, value);
  });
}

/**
 * Remove all theme CSS custom properties from an element
 */
export function removeTheme(element: HTMLElement = document.documentElement): void {
  TOKEN_KEYS.forEach(key => {
    const cssVar = tokenToCssVar(key);
    element.style.removeProperty(cssVar);
  });
}

/**
 * Get the current value of a theme token from CSS
 */
export function getTokenValue(key: keyof ThemeTokens, element: HTMLElement = document.documentElement): string {
  const cssVar = tokenToCssVar(key);
  return getComputedStyle(element).getPropertyValue(cssVar).trim();
}