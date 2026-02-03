import type { ThemeInfo } from '../types';
import { opencodeDarkTheme } from './opencode';

// Export all themes
export { opencodeDarkTheme };

// Theme registry - add all themes here
export const themes: Record<string, ThemeInfo> = {
  opencode: opencodeDarkTheme,
};

// Get theme by ID (with fallback to default)
export function getTheme(id: string): ThemeInfo {
  return themes[id] ?? opencodeDarkTheme;
}

// Get all theme IDs
export function getThemeIds(): string[] {
  return Object.keys(themes);
}

// Get all themes for selector
export function getAllThemes(): ThemeInfo[] {
  return Object.values(themes);
}

// Default theme ID
export const DEFAULT_THEME_ID = 'opencode';