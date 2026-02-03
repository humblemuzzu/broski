/**
 * Broski Theme System - Type Definitions
 * 
 * 80+ semantic color tokens matching the Flutter OpenCodeTheme exactly.
 * Organized into categories:
 * - Core: primary, secondary, accent, error, warning, success, info
 * - Text: text, textMuted, selectedListItemText
 * - Background: background, backgroundPanel, backgroundElement, backgroundMenu
 * - Extended BG: bgDeep, bgRaised, bgSheet, bgHover, bgActive, bgHighlight, bgOverlay, bgContrast
 * - Border: border, borderActive, borderSubtle, cardBorderSubtle, dividerSection
 * - Card Header: cardHeaderBg, cardHeaderBorder, cardHeaderText
 * - Tool: toolThinking, toolEdit, toolRead, toolWrite, toolBash, toolSearch, toolTodo, toolSubtask
 * - Diff: 12 tokens for diff viewer colors
 * - Markdown: 14 tokens for markdown rendering
 * - Syntax: 9 tokens for syntax highlighting
 */

/**
 * Complete theme token interface - all 80+ tokens
 */
export interface ThemeTokens {
  // ═══════════════════════════════════════════════════════════════════════════
  // Core colors
  // ═══════════════════════════════════════════════════════════════════════════
  
  /** Main accent color - links, highlights, user actions */
  primary: string;
  /** Secondary accent - badges, secondary buttons */
  secondary: string;
  /** Special emphasis - agent colors, special highlights */
  accent: string;
  /** Error states - failures, removals */
  error: string;
  /** Warning states - cautions, pending */
  warning: string;
  /** Success states - completions, additions */
  success: string;
  /** Info states - links, help, running */
  info: string;

  // ═══════════════════════════════════════════════════════════════════════════
  // Text colors
  // ═══════════════════════════════════════════════════════════════════════════
  
  /** Primary text - headings, body */
  text: string;
  /** Secondary text - timestamps, hints, comments */
  textMuted: string;
  /** Text on selected/highlighted items */
  selectedListItemText: string;

  // ═══════════════════════════════════════════════════════════════════════════
  // Background colors
  // ═══════════════════════════════════════════════════════════════════════════
  
  /** Main app background (darkest) */
  background: string;
  /** Panel/card backgrounds (slightly lighter) */
  backgroundPanel: string;
  /** Element backgrounds (input fields, code blocks) */
  backgroundElement: string;
  /** Menu/dropdown backgrounds */
  backgroundMenu: string;

  // ═══════════════════════════════════════════════════════════════════════════
  // Extended background scale (for better readability)
  // ═══════════════════════════════════════════════════════════════════════════
  
  /** Deepest background - modal overlays, deepest layer */
  bgDeep: string;
  /** Slightly raised from base - message area, content regions */
  bgRaised: string;
  /** Sheet/modal background */
  bgSheet: string;
  /** Hover state background */
  bgHover: string;
  /** Active/pressed state background */
  bgActive: string;
  /** Selected/highlighted items background */
  bgHighlight: string;
  /** Tooltips, popovers background */
  bgOverlay: string;
  /** High contrast elements */
  bgContrast: string;

  // ═══════════════════════════════════════════════════════════════════════════
  // Border colors
  // ═══════════════════════════════════════════════════════════════════════════
  
  /** Default borders */
  border: string;
  /** Active/focused borders */
  borderActive: string;
  /** Subtle/divider borders */
  borderSubtle: string;
  /** Very subtle border for compact cards (lower opacity) */
  cardBorderSubtle: string;
  /** Subtle divider between markdown sections */
  dividerSection: string;

  // ═══════════════════════════════════════════════════════════════════════════
  // Card header theming
  // ═══════════════════════════════════════════════════════════════════════════
  
  /** Distinct header background for tool cards */
  cardHeaderBg: string;
  /** Visible border for card headers */
  cardHeaderBorder: string;
  /** Header label text color (high contrast) */
  cardHeaderText: string;

  // ═══════════════════════════════════════════════════════════════════════════
  // Tool-specific accent colors
  // ═══════════════════════════════════════════════════════════════════════════
  
  /** Thinking/reasoning - blue (cognitive, analytical) */
  toolThinking: string;
  /** Edit/patch operations - amber/orange (modification) */
  toolEdit: string;
  /** Read operations - cyan/teal (information retrieval) */
  toolRead: string;
  /** Write operations - green (creation) */
  toolWrite: string;
  /** Bash/shell commands - slate/steel (system) */
  toolBash: string;
  /** Search/glob operations - sky blue (discovery) */
  toolSearch: string;
  /** Todo items - coral/orange (task management) */
  toolTodo: string;
  /** Subtask/delegation - teal (delegated work) */
  toolSubtask: string;

  // ═══════════════════════════════════════════════════════════════════════════
  // Diff colors
  // ═══════════════════════════════════════════════════════════════════════════
  
  /** Added line text color (green) */
  diffAdded: string;
  /** Removed line text color (red) */
  diffRemoved: string;
  /** Context line text color */
  diffContext: string;
  /** Hunk header text color */
  diffHunkHeader: string;
  /** Highlighted addition */
  diffHighlightAdded: string;
  /** Highlighted removal */
  diffHighlightRemoved: string;
  /** Added line background */
  diffAddedBg: string;
  /** Removed line background */
  diffRemovedBg: string;
  /** Context line background */
  diffContextBg: string;
  /** Line number text color */
  diffLineNumber: string;
  /** Added line number background */
  diffAddedLineNumberBg: string;
  /** Removed line number background */
  diffRemovedLineNumberBg: string;

  // ═══════════════════════════════════════════════════════════════════════════
  // Markdown colors
  // ═══════════════════════════════════════════════════════════════════════════
  
  markdownText: string;
  markdownHeading: string;
  markdownLink: string;
  markdownLinkText: string;
  markdownCode: string;
  markdownBlockQuote: string;
  markdownEmph: string;
  markdownStrong: string;
  markdownHorizontalRule: string;
  markdownListItem: string;
  markdownListEnumeration: string;
  markdownImage: string;
  markdownImageText: string;
  markdownCodeBlock: string;

  // ═══════════════════════════════════════════════════════════════════════════
  // Syntax highlighting colors
  // ═══════════════════════════════════════════════════════════════════════════
  
  syntaxComment: string;
  syntaxKeyword: string;
  syntaxFunction: string;
  syntaxVariable: string;
  syntaxString: string;
  syntaxNumber: string;
  syntaxType: string;
  syntaxOperator: string;
  syntaxPunctuation: string;
}

/**
 * Theme metadata for display in theme selector
 */
export interface ThemeInfo {
  /** Unique theme identifier */
  id: string;
  /** Display name */
  name: string;
  /** Optional description */
  description?: string;
  /** Whether this is a light theme */
  isLight: boolean;
  /** The theme tokens */
  tokens: ThemeTokens;
}

/**
 * All token keys for iteration
 */
export const TOKEN_KEYS: (keyof ThemeTokens)[] = [
  // Core
  'primary', 'secondary', 'accent', 'error', 'warning', 'success', 'info',
  // Text
  'text', 'textMuted', 'selectedListItemText',
  // Background
  'background', 'backgroundPanel', 'backgroundElement', 'backgroundMenu',
  // Extended BG
  'bgDeep', 'bgRaised', 'bgSheet', 'bgHover', 'bgActive', 'bgHighlight', 'bgOverlay', 'bgContrast',
  // Border
  'border', 'borderActive', 'borderSubtle', 'cardBorderSubtle', 'dividerSection',
  // Card header
  'cardHeaderBg', 'cardHeaderBorder', 'cardHeaderText',
  // Tool
  'toolThinking', 'toolEdit', 'toolRead', 'toolWrite', 'toolBash', 'toolSearch', 'toolTodo', 'toolSubtask',
  // Diff
  'diffAdded', 'diffRemoved', 'diffContext', 'diffHunkHeader', 'diffHighlightAdded', 'diffHighlightRemoved',
  'diffAddedBg', 'diffRemovedBg', 'diffContextBg', 'diffLineNumber', 'diffAddedLineNumberBg', 'diffRemovedLineNumberBg',
  // Markdown
  'markdownText', 'markdownHeading', 'markdownLink', 'markdownLinkText', 'markdownCode', 'markdownBlockQuote',
  'markdownEmph', 'markdownStrong', 'markdownHorizontalRule', 'markdownListItem', 'markdownListEnumeration',
  'markdownImage', 'markdownImageText', 'markdownCodeBlock',
  // Syntax
  'syntaxComment', 'syntaxKeyword', 'syntaxFunction', 'syntaxVariable', 'syntaxString',
  'syntaxNumber', 'syntaxType', 'syntaxOperator', 'syntaxPunctuation',
];

/**
 * Convert camelCase token key to CSS variable name
 * e.g., 'backgroundPanel' -> '--background-panel'
 */
export function tokenToCssVar(key: keyof ThemeTokens): string {
  return '--' + key.replace(/([A-Z])/g, '-$1').toLowerCase();
}

/**
 * Convert CSS variable name to token key
 * e.g., '--background-panel' -> 'backgroundPanel'
 */
export function cssVarToToken(cssVar: string): keyof ThemeTokens {
  const withoutPrefix = cssVar.replace(/^--/, '');
  return withoutPrefix.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) as keyof ThemeTokens;
}
