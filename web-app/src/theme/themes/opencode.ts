import type { ThemeInfo } from '../types';

export const opencodeDarkTheme: ThemeInfo = {
  id: 'opencode',
  name: 'Broski Dark',
  description: 'Elegant monochrome - inspired by Codex, Linear, Vercel',
  isLight: false,
  tokens: {
    // Core colors - monochrome with soft blue accent
    primary: '#ffffff',
    secondary: '#3b82f6',
    accent: '#3b82f6',
    error: '#ef4444',
    warning: '#f59e0b',
    success: '#22c55e',
    info: '#3b82f6',
    
    // Text colors - softer contrast
    text: '#e4e4e7',
    textMuted: '#71717a',
    selectedListItemText: '#09090b',
    
    // Background colors - layered depth
    background: '#09090b',
    backgroundPanel: '#141416',
    backgroundElement: '#18181b',
    backgroundMenu: '#1f1f23',
    
    // Extended BG scale
    bgDeep: '#050506',
    bgRaised: '#0f0f11',
    bgSheet: '#141416',
    bgHover: 'rgba(255, 255, 255, 0.04)',
    bgActive: 'rgba(255, 255, 255, 0.08)',
    bgHighlight: 'rgba(59, 130, 246, 0.12)',
    bgOverlay: '#1f1f23',
    bgContrast: '#27272a',
    
    // Border colors - subtle, almost invisible
    border: 'rgba(255, 255, 255, 0.08)',
    borderActive: 'rgba(59, 130, 246, 0.4)',
    borderSubtle: 'rgba(255, 255, 255, 0.06)',
    cardBorderSubtle: 'rgba(255, 255, 255, 0.04)',
    dividerSection: 'rgba(255, 255, 255, 0.06)',
    
    // Card header
    cardHeaderBg: '#18181b',
    cardHeaderBorder: 'rgba(255, 255, 255, 0.06)',
    cardHeaderText: '#a1a1aa',
    
    // Tool colors - soft with backgrounds
    toolThinking: '#818cf8',
    toolEdit: '#fbbf24',
    toolRead: '#22d3ee',
    toolWrite: '#4ade80',
    toolBash: '#94a3b8',
    toolSearch: '#38bdf8',
    toolTodo: '#fb923c',
    toolSubtask: '#2dd4bf',
    
    // Diff colors - elegant
    diffAdded: '#4ade80',
    diffRemoved: '#f87171',
    diffContext: '#71717a',
    diffHunkHeader: '#52525b',
    diffHighlightAdded: '#86efac',
    diffHighlightRemoved: '#fca5a5',
    diffAddedBg: 'rgba(74, 222, 128, 0.1)',
    diffRemovedBg: 'rgba(248, 113, 113, 0.1)',
    diffContextBg: '#141416',
    diffLineNumber: '#52525b',
    diffAddedLineNumberBg: 'rgba(74, 222, 128, 0.08)',
    diffRemovedLineNumberBg: 'rgba(248, 113, 113, 0.08)',
    
    // Markdown colors
    markdownText: '#e4e4e7',
    markdownHeading: '#3b82f6',
    markdownLink: '#60a5fa',
    markdownLinkText: '#3b82f6',
    markdownCode: '#4ade80',
    markdownBlockQuote: '#a1a1aa',
    markdownEmph: '#fbbf24',
    markdownStrong: '#f59e0b',
    markdownHorizontalRule: '#3f3f46',
    markdownListItem: '#a1a1aa',
    markdownListEnumeration: '#71717a',
    markdownImage: '#60a5fa',
    markdownImageText: '#3b82f6',
    markdownCodeBlock: '#e4e4e7',
    
    // Syntax colors - soft palette
    syntaxComment: '#6b7280',
    syntaxKeyword: '#c084fc',
    syntaxFunction: '#60a5fa',
    syntaxVariable: '#f472b6',
    syntaxString: '#4ade80',
    syntaxNumber: '#fbbf24',
    syntaxType: '#22d3ee',
    syntaxOperator: '#94a3b8',
    syntaxPunctuation: '#71717a',
  },
};
