import type { ThemeInfo } from '../types';

export const opencodeDarkTheme: ThemeInfo = {
  id: 'opencode',
  name: 'OpenCode',
  description: 'Warm peach - the default Broski theme',
  isLight: false,
  tokens: {
    // Core colors
    primary: '#fab283',
    secondary: '#5c9cf5',
    accent: '#56b6c2',
    error: '#e06c75',
    warning: '#f5a742',
    success: '#7fd88f',
    info: '#56b6c2',
    
    // Text colors
    text: '#eeeeee',
    textMuted: '#808080',
    selectedListItemText: '#0a0a0a',
    
    // Background colors
    background: '#0a0a0a',
    backgroundPanel: '#141414',
    backgroundElement: '#1e1e1e',
    backgroundMenu: '#1e1e1e',
    
    // Extended BG scale
    bgDeep: '#050505',
    bgRaised: '#0f0f0f',
    bgSheet: '#141414',
    bgHover: '#1a1a1a',
    bgActive: '#242424',
    bgHighlight: '#2a2a2a',
    bgOverlay: '#303030',
    bgContrast: '#383838',
    
    // Border colors
    border: '#484848',
    borderActive: '#606060',
    borderSubtle: '#3c3c3c',
    cardBorderSubtle: 'rgba(60, 60, 60, 0.4)',
    dividerSection: 'rgba(128, 128, 128, 0.12)',
    
    // Card header
    cardHeaderBg: '#1a1a1a',
    cardHeaderBorder: '#404040',
    cardHeaderText: '#b0b0b0',
    
    // Tool colors
    toolThinking: '#5c9cf5',
    toolEdit: '#f5a742',
    toolRead: '#56b6c2',
    toolWrite: '#7fd88f',
    toolBash: '#94a3b8',
    toolSearch: '#38bdf8',
    toolTodo: '#fb923c',
    toolSubtask: '#2dd4bf',
    
    // Diff colors
    diffAdded: '#4fd6be',
    diffRemoved: '#c53b53',
    diffContext: '#828bb8',
    diffHunkHeader: '#828bb8',
    diffHighlightAdded: '#b8db87',
    diffHighlightRemoved: '#e26a75',
    diffAddedBg: '#20303b',
    diffRemovedBg: '#37222c',
    diffContextBg: '#141414',
    diffLineNumber: '#1e1e1e',
    diffAddedLineNumberBg: '#1b2b34',
    diffRemovedLineNumberBg: '#2d1f26',
    
    // Markdown colors
    markdownText: '#eeeeee',
    markdownHeading: '#56b6c2',
    markdownLink: '#fab283',
    markdownLinkText: '#56b6c2',
    markdownCode: '#7fd88f',
    markdownBlockQuote: '#e5c07b',
    markdownEmph: '#e5c07b',
    markdownStrong: '#f5a742',
    markdownHorizontalRule: '#808080',
    markdownListItem: '#fab283',
    markdownListEnumeration: '#56b6c2',
    markdownImage: '#fab283',
    markdownImageText: '#56b6c2',
    markdownCodeBlock: '#eeeeee',
    
    // Syntax colors
    syntaxComment: '#808080',
    syntaxKeyword: '#56b6c2',
    syntaxFunction: '#fab283',
    syntaxVariable: '#e06c75',
    syntaxString: '#7fd88f',
    syntaxNumber: '#f5a742',
    syntaxType: '#e5c07b',
    syntaxOperator: '#56b6c2',
    syntaxPunctuation: '#eeeeee',
  },
};