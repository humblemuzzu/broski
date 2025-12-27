import 'package:flutter/material.dart';
import '../opencode_theme.dart';

// ═══════════════════════════════════════════════════════════════════════════════
// OpenCode Theme Definitions
// All 30+ themes matching OpenCode CLI exactly
// ═══════════════════════════════════════════════════════════════════════════════

/// Theme metadata for display in selector
class ThemeInfo {
  const ThemeInfo({
    required this.id,
    required this.name,
    required this.theme,
    this.description,
    this.isLight = false,
  });

  final String id;
  final String name;
  final OpenCodeTheme theme;
  final String? description;

  /// Whether this is a light theme (affects base ThemeData)
  final bool isLight;

  /// Primary color for display in theme list
  Color get primaryColor => theme.primary;
}

// ═══════════════════════════════════════════════════════════════════════════════
// OPENCODE LIGHT - Clean, Eye-Friendly Light Theme for Coding
// Inspired by expense_tracker: warm off-white, proper contrast, refined palette
// ═══════════════════════════════════════════════════════════════════════════════
const opencodeLightTheme = OpenCodeTheme(
  // Core colors - adjusted for light mode visibility
  primary: Color(0xFFD97706), // Warm amber/orange - visible on light bg
  secondary: Color(0xFF2563EB), // Blue - links, accents
  accent: Color(0xFF0D9488), // Teal - special highlights (no purple)
  error: Color(0xFFDC2626), // Red - refined, not too harsh
  warning: Color(0xFFD97706), // Amber - warnings
  success: Color(0xFF059669), // Green - success states
  info: Color(0xFF0891B2), // Cyan - info states
  // Text colors - high contrast but not harsh
  text: Color(0xFF1C1C1E), // Near-black, soft
  textMuted: Color(0xFF6B7280), // Medium gray for secondary text
  selectedListItemText: Color(0xFFFFFFFF), // White on selected items
  // Background colors - warm off-white, easy on eyes
  background: Color(0xFFFAFAF9), // Warm off-white (not pure white)
  backgroundPanel: Color(0xFFFFFFFF), // Pure white for cards
  backgroundElement: Color(0xFFF5F5F4), // Slightly darker for inputs
  backgroundMenu: Color(0xFFFFFFFF), // White for menus
  // Extended background scale for light theme
  bgDeep: Color(0xFFFFFFFF), // Pure white - deepest layer
  bgRaised: Color(0xFFFAFAF9), // Off-white - raised content
  bgHover: Color(0xFFF5F5F4), // Hover state
  bgActive: Color(0xFFE5E5E5), // Active/pressed
  bgHighlight: Color(0xFFFEF3C7), // Amber highlight
  bgOverlay: Color(0xFFFFFFFF), // Overlays
  bgContrast: Color(0xFFE5E5E5), // High contrast
  // Border colors - subtle grays
  border: Color(0xFFE5E5E5), // Light gray
  borderActive: Color(0xFFD97706), // Amber when active
  borderSubtle: Color(0xFFF0F0F0), // Very subtle
  // Tool-specific colors for light theme (readable, professional)
  toolThinking: Color(0xFF2563EB), // Blue - cognitive
  toolEdit: Color(0xFFD97706), // Amber - modification
  toolRead: Color(0xFF0891B2), // Cyan - reading
  toolWrite: Color(0xFF059669), // Green - creation
  toolBash: Color(0xFF475569), // Slate - terminal
  toolSearch: Color(0xFF0284C7), // Sky blue - search
  toolTodo: Color(0xFFEA580C), // Orange - tasks
  toolSubtask: Color(0xFF0D9488), // Teal - subtasks
  // Diff colors - proper light theme diff colors
  diffAdded: Color(0xFF166534), // Dark green text
  diffRemoved: Color(0xFFB91C1C), // Dark red text
  diffContext: Color(0xFF6B7280), // Gray context
  diffHunkHeader: Color(0xFF4B5563), // Darker gray for headers
  diffHighlightAdded: Color(0xFF22C55E), // Bright green highlight
  diffHighlightRemoved: Color(0xFFEF4444), // Bright red highlight
  diffAddedBg: Color(0xFFDCFCE7), // Light green background
  diffRemovedBg: Color(0xFFFEE2E2), // Light red background
  diffContextBg: Color(0xFFFAFAFA), // Near white
  diffLineNumber: Color(0xFF9CA3AF), // Gray line numbers
  diffAddedLineNumberBg: Color(0xFFD1FAE5), // Light green
  diffRemovedLineNumberBg: Color(0xFFFECACA), // Light red
  // Markdown colors - readable on light background
  markdownText: Color(0xFF1C1C1E),
  markdownHeading: Color(0xFF0D9488), // Teal headings
  markdownLink: Color(0xFF2563EB), // Blue links
  markdownLinkText: Color(0xFF0891B2), // Cyan link text
  markdownCode: Color(0xFF059669), // Green code
  markdownBlockQuote: Color(0xFF6B7280), // Gray quotes
  markdownEmph: Color(0xFFD97706), // Amber emphasis
  markdownStrong: Color(0xFFEA580C), // Orange strong
  markdownHorizontalRule: Color(0xFFE5E5E5), // Light gray
  markdownListItem: Color(0xFFD97706), // Amber bullets
  markdownListEnumeration: Color(0xFF0891B2), // Cyan numbers
  markdownImage: Color(0xFF2563EB), // Blue image
  markdownImageText: Color(0xFF0891B2), // Cyan alt text
  markdownCodeBlock: Color(0xFF1C1C1E), // Dark text in code blocks
  // Syntax highlighting - designed for light backgrounds
  syntaxComment: Color(0xFF6B7280), // Gray comments
  syntaxKeyword: Color(0xFF0D9488), // Teal keywords
  syntaxFunction: Color(0xFF2563EB), // Blue functions
  syntaxVariable: Color(0xFFDC2626), // Red variables
  syntaxString: Color(0xFF059669), // Green strings
  syntaxNumber: Color(0xFFD97706), // Amber numbers
  syntaxType: Color(0xFF0891B2), // Cyan types
  syntaxOperator: Color(0xFF4B5563), // Dark gray operators
  syntaxPunctuation: Color(0xFF374151), // Medium gray punctuation
);

// ═══════════════════════════════════════════════════════════════════════════════
// OPENCODE (Default) - Warm Peach
// ═══════════════════════════════════════════════════════════════════════════════
const opencodeDarkTheme = OpenCodeTheme(
  primary: Color(0xFFfab283),
  secondary: Color(0xFF5c9cf5),
  accent: Color(0xFF56b6c2), // Teal instead of purple
  error: Color(0xFFe06c75),
  warning: Color(0xFFf5a742),
  success: Color(0xFF7fd88f),
  info: Color(0xFF56b6c2),
  text: Color(0xFFeeeeee),
  textMuted: Color(0xFF808080),
  selectedListItemText: Color(0xFF0a0a0a),
  background: Color(0xFF0a0a0a),
  backgroundPanel: Color(0xFF141414),
  backgroundElement: Color(0xFF1e1e1e),
  backgroundMenu: Color(0xFF1e1e1e),
  // Extended background scale (10 shades for better readability)
  bgDeep: Color(0xFF050505), // Deepest
  bgRaised: Color(0xFF0f0f0f), // Slightly raised
  bgHover: Color(0xFF1a1a1a), // Hover
  bgActive: Color(0xFF242424), // Active
  bgHighlight: Color(0xFF2a2a2a), // Highlight
  bgOverlay: Color(0xFF303030), // Overlay
  bgContrast: Color(0xFF383838), // High contrast
  border: Color(0xFF484848),
  borderActive: Color(0xFF606060),
  borderSubtle: Color(0xFF3c3c3c),
  // Tool-specific colors (professional, readable - no purple/pink)
  toolThinking: Color(0xFF5c9cf5), // Blue - cognitive
  toolEdit: Color(0xFFf5a742), // Amber - modification
  toolRead: Color(0xFF56b6c2), // Cyan - reading
  toolWrite: Color(0xFF7fd88f), // Green - creation
  toolBash: Color(0xFF94a3b8), // Slate - terminal
  toolSearch: Color(0xFF38bdf8), // Sky blue - search
  toolTodo: Color(0xFFfb923c), // Orange - tasks
  toolSubtask: Color(0xFF2dd4bf), // Teal - subtasks
  diffAdded: Color(0xFF4fd6be),
  diffRemoved: Color(0xFFc53b53),
  diffContext: Color(0xFF828bb8),
  diffHunkHeader: Color(0xFF828bb8),
  diffHighlightAdded: Color(0xFFb8db87),
  diffHighlightRemoved: Color(0xFFe26a75),
  diffAddedBg: Color(0xFF20303b),
  diffRemovedBg: Color(0xFF37222c),
  diffContextBg: Color(0xFF141414),
  diffLineNumber: Color(0xFF1e1e1e),
  diffAddedLineNumberBg: Color(0xFF1b2b34),
  diffRemovedLineNumberBg: Color(0xFF2d1f26),
  markdownText: Color(0xFFeeeeee),
  markdownHeading: Color(0xFF56b6c2), // Teal headings
  markdownLink: Color(0xFFfab283),
  markdownLinkText: Color(0xFF56b6c2),
  markdownCode: Color(0xFF7fd88f),
  markdownBlockQuote: Color(0xFFe5c07b),
  markdownEmph: Color(0xFFe5c07b),
  markdownStrong: Color(0xFFf5a742),
  markdownHorizontalRule: Color(0xFF808080),
  markdownListItem: Color(0xFFfab283),
  markdownListEnumeration: Color(0xFF56b6c2),
  markdownImage: Color(0xFFfab283),
  markdownImageText: Color(0xFF56b6c2),
  markdownCodeBlock: Color(0xFFeeeeee),
  syntaxComment: Color(0xFF808080),
  syntaxKeyword: Color(0xFF56b6c2), // Teal keywords
  syntaxFunction: Color(0xFFfab283),
  syntaxVariable: Color(0xFFe06c75),
  syntaxString: Color(0xFF7fd88f),
  syntaxNumber: Color(0xFFf5a742),
  syntaxType: Color(0xFFe5c07b),
  syntaxOperator: Color(0xFF56b6c2),
  syntaxPunctuation: Color(0xFFeeeeee),
);

// ═══════════════════════════════════════════════════════════════════════════════
// TOKYO NIGHT - Cool Blue
// ═══════════════════════════════════════════════════════════════════════════════
const tokyonightDarkTheme = OpenCodeTheme(
  primary: Color(0xFF82aaff),
  secondary: Color(0xFF86e1fc),
  accent: Color(0xFFff966c),
  error: Color(0xFFff757f),
  warning: Color(0xFFff966c),
  success: Color(0xFFc3e88d),
  info: Color(0xFF82aaff),
  text: Color(0xFFc8d3f5),
  textMuted: Color(0xFF828bb8),
  selectedListItemText: Color(0xFF1a1b26),
  background: Color(0xFF1a1b26),
  backgroundPanel: Color(0xFF1e2030),
  backgroundElement: Color(0xFF222436),
  backgroundMenu: Color(0xFF222436),
  bgDeep: Color(0xFF16161e),
  bgRaised: Color(0xFF1a1b26),
  bgHover: Color(0xFF1e2030),
  bgActive: Color(0xFF282a3f),
  bgHighlight: Color(0xFF2d3050),
  bgOverlay: Color(0xFF32354a),
  bgContrast: Color(0xFF3b3f5c),
  border: Color(0xFF737aa2),
  borderActive: Color(0xFF9099b2),
  borderSubtle: Color(0xFF545c7e),
  toolThinking: Color(0xFF82aaff), // Blue
  toolEdit: Color(0xFFff966c), // Orange
  toolRead: Color(0xFF86e1fc), // Cyan
  toolWrite: Color(0xFFc3e88d), // Green
  toolBash: Color(0xFF828bb8), // Slate
  toolSearch: Color(0xFF7dcfff), // Sky
  toolTodo: Color(0xFFffc777), // Amber
  toolSubtask: Color(0xFF4fd6be), // Teal
  diffAdded: Color(0xFF4fd6be),
  diffRemoved: Color(0xFFc53b53),
  diffContext: Color(0xFF828bb8),
  diffHunkHeader: Color(0xFF828bb8),
  diffHighlightAdded: Color(0xFFb8db87),
  diffHighlightRemoved: Color(0xFFe26a75),
  diffAddedBg: Color(0xFF20303b),
  diffRemovedBg: Color(0xFF37222c),
  diffContextBg: Color(0xFF1e2030),
  diffLineNumber: Color(0xFF222436),
  diffAddedLineNumberBg: Color(0xFF1b2b34),
  diffRemovedLineNumberBg: Color(0xFF2d1f26),
  markdownText: Color(0xFFc8d3f5),
  markdownHeading: Color(0xFF82aaff),
  markdownLink: Color(0xFF82aaff),
  markdownLinkText: Color(0xFF86e1fc),
  markdownCode: Color(0xFFc3e88d),
  markdownBlockQuote: Color(0xFFffc777),
  markdownEmph: Color(0xFFffc777),
  markdownStrong: Color(0xFFff966c),
  markdownHorizontalRule: Color(0xFF828bb8),
  markdownListItem: Color(0xFF82aaff),
  markdownListEnumeration: Color(0xFF86e1fc),
  markdownImage: Color(0xFF82aaff),
  markdownImageText: Color(0xFF86e1fc),
  markdownCodeBlock: Color(0xFFc8d3f5),
  syntaxComment: Color(0xFF828bb8),
  syntaxKeyword: Color(0xFF86e1fc),
  syntaxFunction: Color(0xFF82aaff),
  syntaxVariable: Color(0xFFff757f),
  syntaxString: Color(0xFFc3e88d),
  syntaxNumber: Color(0xFFff966c),
  syntaxType: Color(0xFFffc777),
  syntaxOperator: Color(0xFF86e1fc),
  syntaxPunctuation: Color(0xFFc8d3f5),
);

// ═══════════════════════════════════════════════════════════════════════════════
// DRACULA - Classic Purple
// ═══════════════════════════════════════════════════════════════════════════════
const draculaDarkTheme = OpenCodeTheme(
  primary: Color(0xFF8be9fd),
  secondary: Color(0xFF50fa7b),
  accent: Color(0xFF8be9fd),
  error: Color(0xFFff5555),
  warning: Color(0xFFf1fa8c),
  success: Color(0xFF50fa7b),
  info: Color(0xFFffb86c),
  text: Color(0xFFf8f8f2),
  textMuted: Color(0xFF6272a4),
  selectedListItemText: Color(0xFF282a36),
  background: Color(0xFF282a36),
  backgroundPanel: Color(0xFF21222c),
  backgroundElement: Color(0xFF44475a),
  backgroundMenu: Color(0xFF44475a),
  bgDeep: Color(0xFF1e1f29),
  bgRaised: Color(0xFF282a36),
  bgHover: Color(0xFF2d303f),
  bgActive: Color(0xFF363949),
  bgHighlight: Color(0xFF3d4050),
  bgOverlay: Color(0xFF44475a),
  bgContrast: Color(0xFF4d5066),
  border: Color(0xFF44475a),
  borderActive: Color(0xFF8be9fd),
  borderSubtle: Color(0xFF191a21),
  toolThinking: Color(0xFF8be9fd), // Cyan
  toolEdit: Color(0xFFffb86c), // Orange
  toolRead: Color(0xFF8be9fd), // Cyan
  toolWrite: Color(0xFF50fa7b), // Green
  toolBash: Color(0xFF6272a4), // Slate
  toolSearch: Color(0xFF8be9fd), // Cyan
  toolTodo: Color(0xFFf1fa8c), // Yellow
  toolSubtask: Color(0xFF50fa7b), // Green
  diffAdded: Color(0xFF50fa7b),
  diffRemoved: Color(0xFFff5555),
  diffContext: Color(0xFF6272a4),
  diffHunkHeader: Color(0xFF6272a4),
  diffHighlightAdded: Color(0xFF50fa7b),
  diffHighlightRemoved: Color(0xFFff5555),
  diffAddedBg: Color(0xFF1a3a1a),
  diffRemovedBg: Color(0xFF3a1a1a),
  diffContextBg: Color(0xFF21222c),
  diffLineNumber: Color(0xFF44475a),
  diffAddedLineNumberBg: Color(0xFF1a3a1a),
  diffRemovedLineNumberBg: Color(0xFF3a1a1a),
  markdownText: Color(0xFFf8f8f2),
  markdownHeading: Color(0xFF8be9fd),
  markdownLink: Color(0xFF8be9fd),
  markdownLinkText: Color(0xFF50fa7b),
  markdownCode: Color(0xFF50fa7b),
  markdownBlockQuote: Color(0xFF6272a4),
  markdownEmph: Color(0xFFf1fa8c),
  markdownStrong: Color(0xFFffb86c),
  markdownHorizontalRule: Color(0xFF6272a4),
  markdownListItem: Color(0xFF8be9fd),
  markdownListEnumeration: Color(0xFF8be9fd),
  markdownImage: Color(0xFF8be9fd),
  markdownImageText: Color(0xFF50fa7b),
  markdownCodeBlock: Color(0xFFf8f8f2),
  syntaxComment: Color(0xFF6272a4),
  syntaxKeyword: Color(0xFF8be9fd),
  syntaxFunction: Color(0xFF50fa7b),
  syntaxVariable: Color(0xFFf8f8f2),
  syntaxString: Color(0xFFf1fa8c),
  syntaxNumber: Color(0xFFffb86c),
  syntaxType: Color(0xFF8be9fd),
  syntaxOperator: Color(0xFF8be9fd),
  syntaxPunctuation: Color(0xFFf8f8f2),
);

// ═══════════════════════════════════════════════════════════════════════════════
// CATPPUCCIN (Mocha) - Soft Pastel Blue
// ═══════════════════════════════════════════════════════════════════════════════
const catppuccinDarkTheme = OpenCodeTheme(
  primary: Color(0xFF89b4fa),
  secondary: Color(0xFF89dceb),
  accent: Color(0xFF94e2d5),
  error: Color(0xFFf38ba8),
  warning: Color(0xFFf9e2af),
  success: Color(0xFFa6e3a1),
  info: Color(0xFF94e2d5),
  text: Color(0xFFcdd6f4),
  textMuted: Color(0xFFbac2de),
  selectedListItemText: Color(0xFF1e1e2e),
  background: Color(0xFF1e1e2e),
  backgroundPanel: Color(0xFF181825),
  backgroundElement: Color(0xFF11111b),
  backgroundMenu: Color(0xFF11111b),
  bgDeep: Color(0xFF0c0c14),
  bgRaised: Color(0xFF1e1e2e),
  bgHover: Color(0xFF24243a),
  bgActive: Color(0xFF2a2a42),
  bgHighlight: Color(0xFF313244),
  bgOverlay: Color(0xFF363850),
  bgContrast: Color(0xFF45475a),
  border: Color(0xFF313244),
  borderActive: Color(0xFF45475a),
  borderSubtle: Color(0xFF585b70),
  toolThinking: Color(0xFF89b4fa), // Blue
  toolEdit: Color(0xFFfab387), // Peach/Orange
  toolRead: Color(0xFF89dceb), // Sky
  toolWrite: Color(0xFFa6e3a1), // Green
  toolBash: Color(0xFF9399b2), // Overlay
  toolSearch: Color(0xFF74c7ec), // Sapphire
  toolTodo: Color(0xFFf9e2af), // Yellow
  toolSubtask: Color(0xFF94e2d5), // Teal
  diffAdded: Color(0xFFa6e3a1),
  diffRemoved: Color(0xFFf38ba8),
  diffContext: Color(0xFF9399b2),
  diffHunkHeader: Color(0xFFfab387),
  diffHighlightAdded: Color(0xFFa6e3a1),
  diffHighlightRemoved: Color(0xFFf38ba8),
  diffAddedBg: Color(0xFF24312b),
  diffRemovedBg: Color(0xFF3c2a32),
  diffContextBg: Color(0xFF181825),
  diffLineNumber: Color(0xFF45475a),
  diffAddedLineNumberBg: Color(0xFF1e2a25),
  diffRemovedLineNumberBg: Color(0xFF32232a),
  markdownText: Color(0xFFcdd6f4),
  markdownHeading: Color(0xFF89b4fa),
  markdownLink: Color(0xFF89b4fa),
  markdownLinkText: Color(0xFF89dceb),
  markdownCode: Color(0xFFa6e3a1),
  markdownBlockQuote: Color(0xFFf9e2af),
  markdownEmph: Color(0xFFf9e2af),
  markdownStrong: Color(0xFFfab387),
  markdownHorizontalRule: Color(0xFFa6adc8),
  markdownListItem: Color(0xFF89b4fa),
  markdownListEnumeration: Color(0xFF89dceb),
  markdownImage: Color(0xFF89b4fa),
  markdownImageText: Color(0xFF89dceb),
  markdownCodeBlock: Color(0xFFcdd6f4),
  syntaxComment: Color(0xFF9399b2),
  syntaxKeyword: Color(0xFF89dceb),
  syntaxFunction: Color(0xFF89b4fa),
  syntaxVariable: Color(0xFFf38ba8),
  syntaxString: Color(0xFFa6e3a1),
  syntaxNumber: Color(0xFFfab387),
  syntaxType: Color(0xFFf9e2af),
  syntaxOperator: Color(0xFF89dceb),
  syntaxPunctuation: Color(0xFFcdd6f4),
);

// ═══════════════════════════════════════════════════════════════════════════════
// NORD - Arctic Frost Blue
// ═══════════════════════════════════════════════════════════════════════════════
const nordDarkTheme = OpenCodeTheme(
  primary: Color(0xFF88C0D0),
  secondary: Color(0xFF81A1C1),
  accent: Color(0xFF8FBCBB),
  error: Color(0xFFBF616A),
  warning: Color(0xFFD08770),
  success: Color(0xFFA3BE8C),
  info: Color(0xFF88C0D0),
  text: Color(0xFFECEFF4),
  textMuted: Color(0xFF8B95A7),
  selectedListItemText: Color(0xFF2E3440),
  background: Color(0xFF2E3440),
  backgroundPanel: Color(0xFF3B4252),
  backgroundElement: Color(0xFF434C5E),
  backgroundMenu: Color(0xFF434C5E),
  bgDeep: Color(0xFF242933),
  bgRaised: Color(0xFF2E3440),
  bgHover: Color(0xFF353c4a),
  bgActive: Color(0xFF3B4252),
  bgHighlight: Color(0xFF434C5E),
  bgOverlay: Color(0xFF4C566A),
  bgContrast: Color(0xFF5E6779),
  border: Color(0xFF434C5E),
  borderActive: Color(0xFF4C566A),
  borderSubtle: Color(0xFF434C5E),
  toolThinking: Color(0xFF81A1C1), // Blue
  toolEdit: Color(0xFFD08770), // Orange
  toolRead: Color(0xFF88C0D0), // Frost
  toolWrite: Color(0xFFA3BE8C), // Green
  toolBash: Color(0xFF8B95A7), // Gray
  toolSearch: Color(0xFF5E81AC), // Blue darker
  toolTodo: Color(0xFFEBCB8B), // Yellow
  toolSubtask: Color(0xFF8FBCBB), // Teal
  diffAdded: Color(0xFFA3BE8C),
  diffRemoved: Color(0xFFBF616A),
  diffContext: Color(0xFF8B95A7),
  diffHunkHeader: Color(0xFF8B95A7),
  diffHighlightAdded: Color(0xFFA3BE8C),
  diffHighlightRemoved: Color(0xFFBF616A),
  diffAddedBg: Color(0xFF3B4252),
  diffRemovedBg: Color(0xFF3B4252),
  diffContextBg: Color(0xFF3B4252),
  diffLineNumber: Color(0xFF434C5E),
  diffAddedLineNumberBg: Color(0xFF3B4252),
  diffRemovedLineNumberBg: Color(0xFF3B4252),
  markdownText: Color(0xFFD8DEE9),
  markdownHeading: Color(0xFF88C0D0),
  markdownLink: Color(0xFF81A1C1),
  markdownLinkText: Color(0xFF8FBCBB),
  markdownCode: Color(0xFFA3BE8C),
  markdownBlockQuote: Color(0xFF8B95A7),
  markdownEmph: Color(0xFFD08770),
  markdownStrong: Color(0xFFEBCB8B),
  markdownHorizontalRule: Color(0xFF8B95A7),
  markdownListItem: Color(0xFF88C0D0),
  markdownListEnumeration: Color(0xFF8FBCBB),
  markdownImage: Color(0xFF81A1C1),
  markdownImageText: Color(0xFF8FBCBB),
  markdownCodeBlock: Color(0xFFD8DEE9),
  syntaxComment: Color(0xFF8B95A7),
  syntaxKeyword: Color(0xFF81A1C1),
  syntaxFunction: Color(0xFF88C0D0),
  syntaxVariable: Color(0xFF8FBCBB),
  syntaxString: Color(0xFFA3BE8C),
  syntaxNumber: Color(0xFFD08770),
  syntaxType: Color(0xFF8FBCBB),
  syntaxOperator: Color(0xFF81A1C1),
  syntaxPunctuation: Color(0xFFD8DEE9),
);

// ═══════════════════════════════════════════════════════════════════════════════
// GRUVBOX - Retro Warm
// ═══════════════════════════════════════════════════════════════════════════════
const gruvboxDarkTheme = OpenCodeTheme(
  primary: Color(0xFF83a598),
  secondary: Color(0xFF8ec07c),
  accent: Color(0xFF8ec07c),
  error: Color(0xFFfb4934),
  warning: Color(0xFFfe8019),
  success: Color(0xFFb8bb26),
  info: Color(0xFFfabd2f),
  text: Color(0xFFebdbb2),
  textMuted: Color(0xFF928374),
  selectedListItemText: Color(0xFF282828),
  background: Color(0xFF282828),
  backgroundPanel: Color(0xFF3c3836),
  backgroundElement: Color(0xFF504945),
  backgroundMenu: Color(0xFF504945),
  bgDeep: Color(0xFF1d2021),
  bgRaised: Color(0xFF282828),
  bgHover: Color(0xFF32302f),
  bgActive: Color(0xFF3c3836),
  bgHighlight: Color(0xFF504945),
  bgOverlay: Color(0xFF665c54),
  bgContrast: Color(0xFF7c6f64),
  border: Color(0xFF665c54),
  borderActive: Color(0xFFebdbb2),
  borderSubtle: Color(0xFF504945),
  toolThinking: Color(0xFF83a598), // Aqua
  toolEdit: Color(0xFFfe8019), // Orange
  toolRead: Color(0xFF83a598), // Aqua
  toolWrite: Color(0xFFb8bb26), // Green
  toolBash: Color(0xFF928374), // Gray
  toolSearch: Color(0xFF458588), // Blue
  toolTodo: Color(0xFFfabd2f), // Yellow
  toolSubtask: Color(0xFF8ec07c), // Aqua light
  diffAdded: Color(0xFF98971a),
  diffRemoved: Color(0xFFcc241d),
  diffContext: Color(0xFF928374),
  diffHunkHeader: Color(0xFF689d6a),
  diffHighlightAdded: Color(0xFFb8bb26),
  diffHighlightRemoved: Color(0xFFfb4934),
  diffAddedBg: Color(0xFF32302f),
  diffRemovedBg: Color(0xFF322929),
  diffContextBg: Color(0xFF3c3836),
  diffLineNumber: Color(0xFF665c54),
  diffAddedLineNumberBg: Color(0xFF2a2827),
  diffRemovedLineNumberBg: Color(0xFF2a2222),
  markdownText: Color(0xFFebdbb2),
  markdownHeading: Color(0xFF83a598),
  markdownLink: Color(0xFF8ec07c),
  markdownLinkText: Color(0xFFb8bb26),
  markdownCode: Color(0xFFfabd2f),
  markdownBlockQuote: Color(0xFF928374),
  markdownEmph: Color(0xFFfe8019),
  markdownStrong: Color(0xFFfe8019),
  markdownHorizontalRule: Color(0xFF928374),
  markdownListItem: Color(0xFF83a598),
  markdownListEnumeration: Color(0xFF8ec07c),
  markdownImage: Color(0xFF8ec07c),
  markdownImageText: Color(0xFFb8bb26),
  markdownCodeBlock: Color(0xFFebdbb2),
  syntaxComment: Color(0xFF928374),
  syntaxKeyword: Color(0xFF83a598),
  syntaxFunction: Color(0xFFb8bb26),
  syntaxVariable: Color(0xFF83a598),
  syntaxString: Color(0xFFfabd2f),
  syntaxNumber: Color(0xFFfe8019),
  syntaxType: Color(0xFF8ec07c),
  syntaxOperator: Color(0xFFfe8019),
  syntaxPunctuation: Color(0xFFebdbb2),
);

// ═══════════════════════════════════════════════════════════════════════════════
// AURA - Vibrant Purple
// ═══════════════════════════════════════════════════════════════════════════════
const auraDarkTheme = OpenCodeTheme(
  primary: Color(0xFF61ffca), // Teal instead of purple
  secondary: Color(0xFF82e0ff),
  accent: Color(0xFF61ffca),
  error: Color(0xFFff6767),
  warning: Color(0xFFffca85),
  success: Color(0xFF61ffca),
  info: Color(0xFF82e0ff),
  text: Color(0xFFedecee),
  textMuted: Color(0xFF6d6d6d),
  selectedListItemText: Color(0xFF0f0f0f),
  background: Color(0xFF0f0f0f),
  backgroundPanel: Color(0xFF15141b),
  backgroundElement: Color(0xFF15141b),
  backgroundMenu: Color(0xFF15141b),
  bgDeep: Color(0xFF080808),
  bgRaised: Color(0xFF0f0f0f),
  bgHover: Color(0xFF181820),
  bgActive: Color(0xFF1e1e28),
  bgHighlight: Color(0xFF252530),
  bgOverlay: Color(0xFF2d2d38),
  bgContrast: Color(0xFF383840),
  border: Color(0xFF2d2d2d),
  borderActive: Color(0xFF6d6d6d),
  borderSubtle: Color(0xFF2d2d2d),
  toolThinking: Color(0xFF82e0ff), // Blue
  toolEdit: Color(0xFFffca85), // Amber
  toolRead: Color(0xFF61ffca), // Teal
  toolWrite: Color(0xFF9dff65), // Green
  toolBash: Color(0xFF6d6d6d), // Gray
  toolSearch: Color(0xFF82e0ff), // Sky
  toolTodo: Color(0xFFffca85), // Orange
  toolSubtask: Color(0xFF61ffca), // Teal
  diffAdded: Color(0xFF61ffca),
  diffRemoved: Color(0xFFff6767),
  diffContext: Color(0xFF6d6d6d),
  diffHunkHeader: Color(0xFF6d6d6d),
  diffHighlightAdded: Color(0xFF61ffca),
  diffHighlightRemoved: Color(0xFFff6767),
  diffAddedBg: Color(0xFF354933),
  diffRemovedBg: Color(0xFF3f191a),
  diffContextBg: Color(0xFF15141b),
  diffLineNumber: Color(0xFF2d2d2d),
  diffAddedLineNumberBg: Color(0xFF162620),
  diffRemovedLineNumberBg: Color(0xFF26161a),
  markdownText: Color(0xFFedecee),
  markdownHeading: Color(0xFF61ffca),
  markdownLink: Color(0xFF82e0ff),
  markdownLinkText: Color(0xFF61ffca),
  markdownCode: Color(0xFF61ffca),
  markdownBlockQuote: Color(0xFF6d6d6d),
  markdownEmph: Color(0xFFffca85),
  markdownStrong: Color(0xFFffca85),
  markdownHorizontalRule: Color(0xFF6d6d6d),
  markdownListItem: Color(0xFF61ffca),
  markdownListEnumeration: Color(0xFF82e0ff),
  markdownImage: Color(0xFF82e0ff),
  markdownImageText: Color(0xFF61ffca),
  markdownCodeBlock: Color(0xFFedecee),
  syntaxComment: Color(0xFF6d6d6d),
  syntaxKeyword: Color(0xFF82e0ff),
  syntaxFunction: Color(0xFF61ffca),
  syntaxVariable: Color(0xFF61ffca),
  syntaxString: Color(0xFF61ffca),
  syntaxNumber: Color(0xFF9dff65),
  syntaxType: Color(0xFF82e0ff),
  syntaxOperator: Color(0xFF82e0ff),
  syntaxPunctuation: Color(0xFFedecee),
);

// ═══════════════════════════════════════════════════════════════════════════════
// MONOKAI - Classic Code Orange
// ═══════════════════════════════════════════════════════════════════════════════
const monokaiDarkTheme = OpenCodeTheme(
  primary: Color(0xFF66d9ef),
  secondary: Color(0xFFa6e22e),
  accent: Color(0xFFa6e22e),
  error: Color(0xFFf92672),
  warning: Color(0xFFe6db74),
  success: Color(0xFFa6e22e),
  info: Color(0xFFfd971f),
  text: Color(0xFFf8f8f2),
  textMuted: Color(0xFF75715e),
  selectedListItemText: Color(0xFF272822),
  background: Color(0xFF272822),
  backgroundPanel: Color(0xFF1e1f1c),
  backgroundElement: Color(0xFF3e3d32),
  backgroundMenu: Color(0xFF3e3d32),
  bgDeep: Color(0xFF1a1b16),
  bgRaised: Color(0xFF272822),
  bgHover: Color(0xFF2f302a),
  bgActive: Color(0xFF3e3d32),
  bgHighlight: Color(0xFF49483e),
  bgOverlay: Color(0xFF555449),
  bgContrast: Color(0xFF626155),
  border: Color(0xFF3e3d32),
  borderActive: Color(0xFF66d9ef),
  borderSubtle: Color(0xFF1e1f1c),
  toolThinking: Color(0xFF66d9ef), // Cyan
  toolEdit: Color(0xFFfd971f), // Orange
  toolRead: Color(0xFF66d9ef), // Cyan
  toolWrite: Color(0xFFa6e22e), // Green
  toolBash: Color(0xFF75715e), // Gray
  toolSearch: Color(0xFF66d9ef), // Cyan
  toolTodo: Color(0xFFe6db74), // Yellow
  toolSubtask: Color(0xFFa6e22e), // Green
  diffAdded: Color(0xFFa6e22e),
  diffRemoved: Color(0xFFf92672),
  diffContext: Color(0xFF75715e),
  diffHunkHeader: Color(0xFF75715e),
  diffHighlightAdded: Color(0xFFa6e22e),
  diffHighlightRemoved: Color(0xFFf92672),
  diffAddedBg: Color(0xFF1a3a1a),
  diffRemovedBg: Color(0xFF3a1a1a),
  diffContextBg: Color(0xFF1e1f1c),
  diffLineNumber: Color(0xFF3e3d32),
  diffAddedLineNumberBg: Color(0xFF1a3a1a),
  diffRemovedLineNumberBg: Color(0xFF3a1a1a),
  markdownText: Color(0xFFf8f8f2),
  markdownHeading: Color(0xFF66d9ef),
  markdownLink: Color(0xFF66d9ef),
  markdownLinkText: Color(0xFFa6e22e),
  markdownCode: Color(0xFFa6e22e),
  markdownBlockQuote: Color(0xFF75715e),
  markdownEmph: Color(0xFFe6db74),
  markdownStrong: Color(0xFFfd971f),
  markdownHorizontalRule: Color(0xFF75715e),
  markdownListItem: Color(0xFF66d9ef),
  markdownListEnumeration: Color(0xFFa6e22e),
  markdownImage: Color(0xFF66d9ef),
  markdownImageText: Color(0xFFa6e22e),
  markdownCodeBlock: Color(0xFFf8f8f2),
  syntaxComment: Color(0xFF75715e),
  syntaxKeyword: Color(0xFF66d9ef),
  syntaxFunction: Color(0xFFa6e22e),
  syntaxVariable: Color(0xFFf8f8f2),
  syntaxString: Color(0xFFe6db74),
  syntaxNumber: Color(0xFFfd971f),
  syntaxType: Color(0xFF66d9ef),
  syntaxOperator: Color(0xFF66d9ef),
  syntaxPunctuation: Color(0xFFf8f8f2),
);

// ═══════════════════════════════════════════════════════════════════════════════
// FLEXOKI - Warm Orange
// ═══════════════════════════════════════════════════════════════════════════════
const flexokiDarkTheme = OpenCodeTheme(
  primary: Color(0xFFda702c),
  secondary: Color(0xFF4385BE),
  accent: Color(0xFF8B7EC8),
  error: Color(0xFFD14D41),
  warning: Color(0xFFda702c),
  success: Color(0xFF879A39),
  info: Color(0xFF3AA99F),
  text: Color(0xFFCECDC3),
  textMuted: Color(0xFF6F6E69),
  selectedListItemText: Color(0xFF100F0F),
  background: Color(0xFF100F0F),
  backgroundPanel: Color(0xFF1C1B1A),
  backgroundElement: Color(0xFF282726),
  backgroundMenu: Color(0xFF282726),
  bgDeep: Color(0xFF080808),
  bgRaised: Color(0xFF100F0F),
  bgHover: Color(0xFF1C1B1A),
  bgActive: Color(0xFF282726),
  bgHighlight: Color(0xFF343331),
  bgOverlay: Color(0xFF403E3C),
  bgContrast: Color(0xFF575653),
  border: Color(0xFF575653),
  borderActive: Color(0xFF6F6E69),
  borderSubtle: Color(0xFF403E3C),
  toolThinking: Color(0xFF4385BE), // Blue
  toolEdit: Color(0xFFda702c), // Orange
  toolRead: Color(0xFF3AA99F), // Teal
  toolWrite: Color(0xFF879A39), // Green
  toolBash: Color(0xFF6F6E69), // Gray
  toolSearch: Color(0xFF4385BE), // Blue
  toolTodo: Color(0xFFD0A215), // Yellow
  toolSubtask: Color(0xFF3AA99F), // Teal
  diffAdded: Color(0xFF879A39),
  diffRemoved: Color(0xFFD14D41),
  diffContext: Color(0xFF6F6E69),
  diffHunkHeader: Color(0xFF4385BE),
  diffHighlightAdded: Color(0xFF879A39),
  diffHighlightRemoved: Color(0xFFD14D41),
  diffAddedBg: Color(0xFF1A2D1A),
  diffRemovedBg: Color(0xFF2D1A1A),
  diffContextBg: Color(0xFF1C1B1A),
  diffLineNumber: Color(0xFF6F6E69),
  diffAddedLineNumberBg: Color(0xFF152515),
  diffRemovedLineNumberBg: Color(0xFF251515),
  markdownText: Color(0xFFCECDC3),
  markdownHeading: Color(0xFF8B7EC8),
  markdownLink: Color(0xFF4385BE),
  markdownLinkText: Color(0xFF3AA99F),
  markdownCode: Color(0xFF3AA99F),
  markdownBlockQuote: Color(0xFFD0A215),
  markdownEmph: Color(0xFFD0A215),
  markdownStrong: Color(0xFFda702c),
  markdownHorizontalRule: Color(0xFF6F6E69),
  markdownListItem: Color(0xFFda702c),
  markdownListEnumeration: Color(0xFF3AA99F),
  markdownImage: Color(0xFFCE5D97),
  markdownImageText: Color(0xFF3AA99F),
  markdownCodeBlock: Color(0xFFCECDC3),
  syntaxComment: Color(0xFF6F6E69),
  syntaxKeyword: Color(0xFF879A39),
  syntaxFunction: Color(0xFFda702c),
  syntaxVariable: Color(0xFF4385BE),
  syntaxString: Color(0xFF3AA99F),
  syntaxNumber: Color(0xFF8B7EC8),
  syntaxType: Color(0xFFD0A215),
  syntaxOperator: Color(0xFFB7B5AC),
  syntaxPunctuation: Color(0xFFB7B5AC),
);

// ═══════════════════════════════════════════════════════════════════════════════
// ONE DARK - Atom Inspired Blue
// ═══════════════════════════════════════════════════════════════════════════════
const oneDarkTheme = OpenCodeTheme(
  primary: Color(0xFF61afef),
  secondary: Color(0xFFc678dd),
  accent: Color(0xFF56b6c2),
  error: Color(0xFFe06c75),
  warning: Color(0xFFe5c07b),
  success: Color(0xFF98c379),
  info: Color(0xFF61afef),
  text: Color(0xFFabb2bf),
  textMuted: Color(0xFF5c6370),
  selectedListItemText: Color(0xFF282c34),
  background: Color(0xFF282c34),
  backgroundPanel: Color(0xFF21252b),
  backgroundElement: Color(0xFF2c313a),
  backgroundMenu: Color(0xFF2c313a),
  bgDeep: Color(0xFF1b1d23),
  bgRaised: Color(0xFF282c34),
  bgHover: Color(0xFF2c313a),
  bgActive: Color(0xFF3e4451),
  bgHighlight: Color(0xFF4b5263),
  bgOverlay: Color(0xFF5c6370),
  bgContrast: Color(0xFF6b7280),
  border: Color(0xFF3e4451),
  borderActive: Color(0xFF61afef),
  borderSubtle: Color(0xFF2c313a),
  toolThinking: Color(0xFF61afef), // Blue
  toolEdit: Color(0xFFd19a66), // Orange
  toolRead: Color(0xFF56b6c2), // Cyan
  toolWrite: Color(0xFF98c379), // Green
  toolBash: Color(0xFF5c6370), // Gray
  toolSearch: Color(0xFF61afef), // Blue
  toolTodo: Color(0xFFe5c07b), // Yellow
  toolSubtask: Color(0xFF56b6c2), // Teal
  diffAdded: Color(0xFF98c379),
  diffRemoved: Color(0xFFe06c75),
  diffContext: Color(0xFF5c6370),
  diffHunkHeader: Color(0xFF5c6370),
  diffHighlightAdded: Color(0xFF98c379),
  diffHighlightRemoved: Color(0xFFe06c75),
  diffAddedBg: Color(0xFF2d3c2d),
  diffRemovedBg: Color(0xFF3c2d2d),
  diffContextBg: Color(0xFF21252b),
  diffLineNumber: Color(0xFF3e4451),
  diffAddedLineNumberBg: Color(0xFF253425),
  diffRemovedLineNumberBg: Color(0xFF342525),
  markdownText: Color(0xFFabb2bf),
  markdownHeading: Color(0xFFe06c75),
  markdownLink: Color(0xFF61afef),
  markdownLinkText: Color(0xFF56b6c2),
  markdownCode: Color(0xFF98c379),
  markdownBlockQuote: Color(0xFF5c6370),
  markdownEmph: Color(0xFFe5c07b),
  markdownStrong: Color(0xFFd19a66),
  markdownHorizontalRule: Color(0xFF5c6370),
  markdownListItem: Color(0xFF61afef),
  markdownListEnumeration: Color(0xFF56b6c2),
  markdownImage: Color(0xFF61afef),
  markdownImageText: Color(0xFF56b6c2),
  markdownCodeBlock: Color(0xFFabb2bf),
  syntaxComment: Color(0xFF5c6370),
  syntaxKeyword: Color(0xFFc678dd),
  syntaxFunction: Color(0xFF61afef),
  syntaxVariable: Color(0xFFe06c75),
  syntaxString: Color(0xFF98c379),
  syntaxNumber: Color(0xFFd19a66),
  syntaxType: Color(0xFFe5c07b),
  syntaxOperator: Color(0xFF56b6c2),
  syntaxPunctuation: Color(0xFFabb2bf),
);

// ═══════════════════════════════════════════════════════════════════════════════
// SOLARIZED DARK
// ═══════════════════════════════════════════════════════════════════════════════
const solarizedDarkTheme = OpenCodeTheme(
  primary: Color(0xFF268bd2),
  secondary: Color(0xFF6c71c4),
  accent: Color(0xFF2aa198),
  error: Color(0xFFdc322f),
  warning: Color(0xFFcb4b16),
  success: Color(0xFF859900),
  info: Color(0xFF268bd2),
  text: Color(0xFF839496),
  textMuted: Color(0xFF586e75),
  selectedListItemText: Color(0xFF002b36),
  background: Color(0xFF002b36),
  backgroundPanel: Color(0xFF073642),
  backgroundElement: Color(0xFF073642),
  backgroundMenu: Color(0xFF073642),
  bgDeep: Color(0xFF001f27),
  bgRaised: Color(0xFF002b36),
  bgHover: Color(0xFF073642),
  bgActive: Color(0xFF094150),
  bgHighlight: Color(0xFF0b5260),
  bgOverlay: Color(0xFF586e75),
  bgContrast: Color(0xFF657b83),
  border: Color(0xFF586e75),
  borderActive: Color(0xFF268bd2),
  borderSubtle: Color(0xFF073642),
  toolThinking: Color(0xFF268bd2), // Blue
  toolEdit: Color(0xFFcb4b16), // Orange
  toolRead: Color(0xFF2aa198), // Cyan
  toolWrite: Color(0xFF859900), // Green
  toolBash: Color(0xFF586e75), // Gray
  toolSearch: Color(0xFF268bd2), // Blue
  toolTodo: Color(0xFFb58900), // Yellow
  toolSubtask: Color(0xFF2aa198), // Teal
  diffAdded: Color(0xFF859900),
  diffRemoved: Color(0xFFdc322f),
  diffContext: Color(0xFF586e75),
  diffHunkHeader: Color(0xFF586e75),
  diffHighlightAdded: Color(0xFF859900),
  diffHighlightRemoved: Color(0xFFdc322f),
  diffAddedBg: Color(0xFF073642),
  diffRemovedBg: Color(0xFF073642),
  diffContextBg: Color(0xFF073642),
  diffLineNumber: Color(0xFF586e75),
  diffAddedLineNumberBg: Color(0xFF073642),
  diffRemovedLineNumberBg: Color(0xFF073642),
  markdownText: Color(0xFF839496),
  markdownHeading: Color(0xFF268bd2),
  markdownLink: Color(0xFF6c71c4),
  markdownLinkText: Color(0xFF2aa198),
  markdownCode: Color(0xFF859900),
  markdownBlockQuote: Color(0xFF586e75),
  markdownEmph: Color(0xFFb58900),
  markdownStrong: Color(0xFFcb4b16),
  markdownHorizontalRule: Color(0xFF586e75),
  markdownListItem: Color(0xFF268bd2),
  markdownListEnumeration: Color(0xFF2aa198),
  markdownImage: Color(0xFF6c71c4),
  markdownImageText: Color(0xFF2aa198),
  markdownCodeBlock: Color(0xFF839496),
  syntaxComment: Color(0xFF586e75),
  syntaxKeyword: Color(0xFF859900),
  syntaxFunction: Color(0xFF268bd2),
  syntaxVariable: Color(0xFF268bd2),
  syntaxString: Color(0xFF2aa198),
  syntaxNumber: Color(0xFFd33682),
  syntaxType: Color(0xFFb58900),
  syntaxOperator: Color(0xFF859900),
  syntaxPunctuation: Color(0xFF839496),
);

// ═══════════════════════════════════════════════════════════════════════════════
// GITHUB DARK
// ═══════════════════════════════════════════════════════════════════════════════
const githubDarkTheme = OpenCodeTheme(
  primary: Color(0xFF58a6ff),
  secondary: Color(0xFFbc8cff),
  accent: Color(0xFF39d353),
  error: Color(0xFFf85149),
  warning: Color(0xFFd29922),
  success: Color(0xFF3fb950),
  info: Color(0xFF58a6ff),
  text: Color(0xFFc9d1d9),
  textMuted: Color(0xFF8b949e),
  selectedListItemText: Color(0xFF0d1117),
  background: Color(0xFF0d1117),
  backgroundPanel: Color(0xFF161b22),
  backgroundElement: Color(0xFF21262d),
  backgroundMenu: Color(0xFF21262d),
  bgDeep: Color(0xFF010409),
  bgRaised: Color(0xFF0d1117),
  bgHover: Color(0xFF161b22),
  bgActive: Color(0xFF21262d),
  bgHighlight: Color(0xFF30363d),
  bgOverlay: Color(0xFF484f58),
  bgContrast: Color(0xFF6e7681),
  border: Color(0xFF30363d),
  borderActive: Color(0xFF58a6ff),
  borderSubtle: Color(0xFF21262d),
  toolThinking: Color(0xFF58a6ff), // Blue
  toolEdit: Color(0xFFf0883e), // Orange
  toolRead: Color(0xFF79c0ff), // Cyan
  toolWrite: Color(0xFF3fb950), // Green
  toolBash: Color(0xFF8b949e), // Gray
  toolSearch: Color(0xFF58a6ff), // Blue
  toolTodo: Color(0xFFd29922), // Yellow
  toolSubtask: Color(0xFF39d353), // Teal/Green
  diffAdded: Color(0xFF3fb950),
  diffRemoved: Color(0xFFf85149),
  diffContext: Color(0xFF8b949e),
  diffHunkHeader: Color(0xFF8b949e),
  diffHighlightAdded: Color(0xFF3fb950),
  diffHighlightRemoved: Color(0xFFf85149),
  diffAddedBg: Color(0xFF1b2e1f),
  diffRemovedBg: Color(0xFF2d1619),
  diffContextBg: Color(0xFF161b22),
  diffLineNumber: Color(0xFF30363d),
  diffAddedLineNumberBg: Color(0xFF162419),
  diffRemovedLineNumberBg: Color(0xFF251215),
  markdownText: Color(0xFFc9d1d9),
  markdownHeading: Color(0xFF58a6ff),
  markdownLink: Color(0xFF58a6ff),
  markdownLinkText: Color(0xFF39d353),
  markdownCode: Color(0xFF3fb950),
  markdownBlockQuote: Color(0xFF8b949e),
  markdownEmph: Color(0xFFd29922),
  markdownStrong: Color(0xFFf0883e),
  markdownHorizontalRule: Color(0xFF8b949e),
  markdownListItem: Color(0xFF58a6ff),
  markdownListEnumeration: Color(0xFF39d353),
  markdownImage: Color(0xFF58a6ff),
  markdownImageText: Color(0xFF39d353),
  markdownCodeBlock: Color(0xFFc9d1d9),
  syntaxComment: Color(0xFF8b949e),
  syntaxKeyword: Color(0xFFff7b72),
  syntaxFunction: Color(0xFFd2a8ff),
  syntaxVariable: Color(0xFF79c0ff),
  syntaxString: Color(0xFFa5d6ff),
  syntaxNumber: Color(0xFF79c0ff),
  syntaxType: Color(0xFF7ee787),
  syntaxOperator: Color(0xFFff7b72),
  syntaxPunctuation: Color(0xFFc9d1d9),
);

// ═══════════════════════════════════════════════════════════════════════════════
// MATRIX - Hacker Green
// ═══════════════════════════════════════════════════════════════════════════════
const matrixDarkTheme = OpenCodeTheme(
  primary: Color(0xFF2eff6a),
  secondary: Color(0xFF00ff00),
  accent: Color(0xFF2eff6a),
  error: Color(0xFFff3333),
  warning: Color(0xFFffff00),
  success: Color(0xFF2eff6a),
  info: Color(0xFF00ffff),
  text: Color(0xFF2eff6a),
  textMuted: Color(0xFF006600),
  selectedListItemText: Color(0xFF000000),
  background: Color(0xFF000000),
  backgroundPanel: Color(0xFF0a0a0a),
  backgroundElement: Color(0xFF111111),
  backgroundMenu: Color(0xFF111111),
  bgDeep: Color(0xFF000000),
  bgRaised: Color(0xFF050505),
  bgHover: Color(0xFF0a0a0a),
  bgActive: Color(0xFF111111),
  bgHighlight: Color(0xFF1a1a1a),
  bgOverlay: Color(0xFF222222),
  bgContrast: Color(0xFF2a2a2a),
  border: Color(0xFF003300),
  borderActive: Color(0xFF2eff6a),
  borderSubtle: Color(0xFF001a00),
  toolThinking: Color(0xFF00ffff), // Cyan
  toolEdit: Color(0xFFffff00), // Yellow
  toolRead: Color(0xFF2eff6a), // Green
  toolWrite: Color(0xFF00ff00), // Bright green
  toolBash: Color(0xFF006600), // Dark green
  toolSearch: Color(0xFF00ffff), // Cyan
  toolTodo: Color(0xFFffff00), // Yellow
  toolSubtask: Color(0xFF2eff6a), // Green
  diffAdded: Color(0xFF2eff6a),
  diffRemoved: Color(0xFFff3333),
  diffContext: Color(0xFF006600),
  diffHunkHeader: Color(0xFF006600),
  diffHighlightAdded: Color(0xFF2eff6a),
  diffHighlightRemoved: Color(0xFFff3333),
  diffAddedBg: Color(0xFF001a00),
  diffRemovedBg: Color(0xFF1a0000),
  diffContextBg: Color(0xFF0a0a0a),
  diffLineNumber: Color(0xFF003300),
  diffAddedLineNumberBg: Color(0xFF001100),
  diffRemovedLineNumberBg: Color(0xFF110000),
  markdownText: Color(0xFF2eff6a),
  markdownHeading: Color(0xFF00ff00),
  markdownLink: Color(0xFF00ffff),
  markdownLinkText: Color(0xFF2eff6a),
  markdownCode: Color(0xFF2eff6a),
  markdownBlockQuote: Color(0xFF006600),
  markdownEmph: Color(0xFFffff00),
  markdownStrong: Color(0xFF00ff00),
  markdownHorizontalRule: Color(0xFF006600),
  markdownListItem: Color(0xFF2eff6a),
  markdownListEnumeration: Color(0xFF00ffff),
  markdownImage: Color(0xFF00ffff),
  markdownImageText: Color(0xFF2eff6a),
  markdownCodeBlock: Color(0xFF2eff6a),
  syntaxComment: Color(0xFF006600),
  syntaxKeyword: Color(0xFF00ff00),
  syntaxFunction: Color(0xFF2eff6a),
  syntaxVariable: Color(0xFF2eff6a),
  syntaxString: Color(0xFF00ffff),
  syntaxNumber: Color(0xFFffff00),
  syntaxType: Color(0xFF00ff00),
  syntaxOperator: Color(0xFF2eff6a),
  syntaxPunctuation: Color(0xFF2eff6a),
);

// ═══════════════════════════════════════════════════════════════════════════════
// SYNTHWAVE 84 - Retro Neon
// ═══════════════════════════════════════════════════════════════════════════════
const synthwave84DarkTheme = OpenCodeTheme(
  primary: Color(0xFF36f9f6),
  secondary: Color(0xFFff7edb),
  accent: Color(0xFFfede5d),
  error: Color(0xFFfe4450),
  warning: Color(0xFFfede5d),
  success: Color(0xFF72f1b8),
  info: Color(0xFF36f9f6),
  text: Color(0xFFffffff),
  textMuted: Color(0xFF848bbd),
  selectedListItemText: Color(0xFF2a2139),
  background: Color(0xFF2a2139),
  backgroundPanel: Color(0xFF241b2f),
  backgroundElement: Color(0xFF34294f),
  backgroundMenu: Color(0xFF34294f),
  bgDeep: Color(0xFF1a1525),
  bgRaised: Color(0xFF2a2139),
  bgHover: Color(0xFF34294f),
  bgActive: Color(0xFF3e3360),
  bgHighlight: Color(0xFF495495),
  bgOverlay: Color(0xFF5a60a0),
  bgContrast: Color(0xFF6b70b0),
  border: Color(0xFF495495),
  borderActive: Color(0xFF36f9f6),
  borderSubtle: Color(0xFF34294f),
  toolThinking: Color(0xFF36f9f6), // Cyan
  toolEdit: Color(0xFFfede5d), // Yellow
  toolRead: Color(0xFF36f9f6), // Cyan
  toolWrite: Color(0xFF72f1b8), // Green
  toolBash: Color(0xFF848bbd), // Muted
  toolSearch: Color(0xFF36f9f6), // Cyan
  toolTodo: Color(0xFFfede5d), // Yellow
  toolSubtask: Color(0xFF72f1b8), // Mint
  diffAdded: Color(0xFF72f1b8),
  diffRemoved: Color(0xFFfe4450),
  diffContext: Color(0xFF848bbd),
  diffHunkHeader: Color(0xFF848bbd),
  diffHighlightAdded: Color(0xFF72f1b8),
  diffHighlightRemoved: Color(0xFFfe4450),
  diffAddedBg: Color(0xFF1a3a2a),
  diffRemovedBg: Color(0xFF3a1a1a),
  diffContextBg: Color(0xFF241b2f),
  diffLineNumber: Color(0xFF495495),
  diffAddedLineNumberBg: Color(0xFF152a1f),
  diffRemovedLineNumberBg: Color(0xFF2a1515),
  markdownText: Color(0xFFffffff),
  markdownHeading: Color(0xFFff7edb),
  markdownLink: Color(0xFF36f9f6),
  markdownLinkText: Color(0xFFfede5d),
  markdownCode: Color(0xFF72f1b8),
  markdownBlockQuote: Color(0xFF848bbd),
  markdownEmph: Color(0xFFfede5d),
  markdownStrong: Color(0xFFff7edb),
  markdownHorizontalRule: Color(0xFF848bbd),
  markdownListItem: Color(0xFF36f9f6),
  markdownListEnumeration: Color(0xFFfede5d),
  markdownImage: Color(0xFF36f9f6),
  markdownImageText: Color(0xFFfede5d),
  markdownCodeBlock: Color(0xFFffffff),
  syntaxComment: Color(0xFF848bbd),
  syntaxKeyword: Color(0xFFff7edb),
  syntaxFunction: Color(0xFF36f9f6),
  syntaxVariable: Color(0xFFff7edb),
  syntaxString: Color(0xFFfede5d),
  syntaxNumber: Color(0xFFf97e72),
  syntaxType: Color(0xFF72f1b8),
  syntaxOperator: Color(0xFFff7edb),
  syntaxPunctuation: Color(0xFFffffff),
);

// ═══════════════════════════════════════════════════════════════════════════════
// VESPER - Minimal Warm Peach
// ═══════════════════════════════════════════════════════════════════════════════
const vesperDarkTheme = OpenCodeTheme(
  primary: Color(0xFFFFC799),
  secondary: Color(0xFF99FFE4),
  accent: Color(0xFFFFD6B3),
  error: Color(0xFFFF6F6F),
  warning: Color(0xFFFFC799),
  success: Color(0xFF99FFE4),
  info: Color(0xFF99D0FF),
  text: Color(0xFFffffff),
  textMuted: Color(0xFF7B7B7B),
  selectedListItemText: Color(0xFF101010),
  background: Color(0xFF101010),
  backgroundPanel: Color(0xFF181818),
  backgroundElement: Color(0xFF232323),
  backgroundMenu: Color(0xFF232323),
  bgDeep: Color(0xFF080808),
  bgRaised: Color(0xFF101010),
  bgHover: Color(0xFF181818),
  bgActive: Color(0xFF232323),
  bgHighlight: Color(0xFF2e2e2e),
  bgOverlay: Color(0xFF333333),
  bgContrast: Color(0xFF444444),
  border: Color(0xFF333333),
  borderActive: Color(0xFFFFC799),
  borderSubtle: Color(0xFF232323),
  toolThinking: Color(0xFF99D0FF), // Blue
  toolEdit: Color(0xFFFFC799), // Peach
  toolRead: Color(0xFF99FFE4), // Teal
  toolWrite: Color(0xFF99FFE4), // Mint
  toolBash: Color(0xFF7B7B7B), // Gray
  toolSearch: Color(0xFF99D0FF), // Blue
  toolTodo: Color(0xFFFFD6B3), // Warm
  toolSubtask: Color(0xFF99FFE4), // Teal
  diffAdded: Color(0xFF99FFE4),
  diffRemoved: Color(0xFFFF6F6F),
  diffContext: Color(0xFF7B7B7B),
  diffHunkHeader: Color(0xFF7B7B7B),
  diffHighlightAdded: Color(0xFF99FFE4),
  diffHighlightRemoved: Color(0xFFFF6F6F),
  diffAddedBg: Color(0xFF1a2a25),
  diffRemovedBg: Color(0xFF2a1a1a),
  diffContextBg: Color(0xFF181818),
  diffLineNumber: Color(0xFF333333),
  diffAddedLineNumberBg: Color(0xFF15221e),
  diffRemovedLineNumberBg: Color(0xFF221515),
  markdownText: Color(0xFFffffff),
  markdownHeading: Color(0xFFFFC799),
  markdownLink: Color(0xFF99D0FF),
  markdownLinkText: Color(0xFF99FFE4),
  markdownCode: Color(0xFF99FFE4),
  markdownBlockQuote: Color(0xFF7B7B7B),
  markdownEmph: Color(0xFFFFD6B3),
  markdownStrong: Color(0xFFFFC799),
  markdownHorizontalRule: Color(0xFF7B7B7B),
  markdownListItem: Color(0xFFFFC799),
  markdownListEnumeration: Color(0xFF99FFE4),
  markdownImage: Color(0xFF99D0FF),
  markdownImageText: Color(0xFF99FFE4),
  markdownCodeBlock: Color(0xFFffffff),
  syntaxComment: Color(0xFF7B7B7B),
  syntaxKeyword: Color(0xFFFFC799),
  syntaxFunction: Color(0xFF99D0FF),
  syntaxVariable: Color(0xFFFFD6B3),
  syntaxString: Color(0xFF99FFE4),
  syntaxNumber: Color(0xFFFFB3B3),
  syntaxType: Color(0xFF99D0FF),
  syntaxOperator: Color(0xFFFFC799),
  syntaxPunctuation: Color(0xFFffffff),
);

// ═══════════════════════════════════════════════════════════════════════════════
// ROSEPINE - Elegant Soft
// ═══════════════════════════════════════════════════════════════════════════════
const rosepineDarkTheme = OpenCodeTheme(
  primary: Color(0xFF9ccfd8),
  secondary: Color(0xFFc4a7e7),
  accent: Color(0xFFebbcba),
  error: Color(0xFFeb6f92),
  warning: Color(0xFFf6c177),
  success: Color(0xFF31748f),
  info: Color(0xFF9ccfd8),
  text: Color(0xFFe0def4),
  textMuted: Color(0xFF908caa),
  selectedListItemText: Color(0xFF191724),
  background: Color(0xFF191724),
  backgroundPanel: Color(0xFF1f1d2e),
  backgroundElement: Color(0xFF26233a),
  backgroundMenu: Color(0xFF26233a),
  bgDeep: Color(0xFF11101a),
  bgRaised: Color(0xFF191724),
  bgHover: Color(0xFF1f1d2e),
  bgActive: Color(0xFF26233a),
  bgHighlight: Color(0xFF312e45),
  bgOverlay: Color(0xFF403d52),
  bgContrast: Color(0xFF524f67),
  border: Color(0xFF403d52),
  borderActive: Color(0xFF9ccfd8),
  borderSubtle: Color(0xFF26233a),
  toolThinking: Color(0xFF9ccfd8), // Foam
  toolEdit: Color(0xFFf6c177), // Gold
  toolRead: Color(0xFF9ccfd8), // Foam
  toolWrite: Color(0xFF31748f), // Pine
  toolBash: Color(0xFF908caa), // Muted
  toolSearch: Color(0xFF9ccfd8), // Foam
  toolTodo: Color(0xFFf6c177), // Gold
  toolSubtask: Color(0xFF31748f), // Pine
  diffAdded: Color(0xFF31748f),
  diffRemoved: Color(0xFFeb6f92),
  diffContext: Color(0xFF908caa),
  diffHunkHeader: Color(0xFF908caa),
  diffHighlightAdded: Color(0xFF9ccfd8),
  diffHighlightRemoved: Color(0xFFeb6f92),
  diffAddedBg: Color(0xFF1a2830),
  diffRemovedBg: Color(0xFF2d1f27),
  diffContextBg: Color(0xFF1f1d2e),
  diffLineNumber: Color(0xFF403d52),
  diffAddedLineNumberBg: Color(0xFF152025),
  diffRemovedLineNumberBg: Color(0xFF251a20),
  markdownText: Color(0xFFe0def4),
  markdownHeading: Color(0xFFc4a7e7),
  markdownLink: Color(0xFF9ccfd8),
  markdownLinkText: Color(0xFFebbcba),
  markdownCode: Color(0xFF31748f),
  markdownBlockQuote: Color(0xFF908caa),
  markdownEmph: Color(0xFFf6c177),
  markdownStrong: Color(0xFFebbcba),
  markdownHorizontalRule: Color(0xFF908caa),
  markdownListItem: Color(0xFF9ccfd8),
  markdownListEnumeration: Color(0xFFebbcba),
  markdownImage: Color(0xFF9ccfd8),
  markdownImageText: Color(0xFFebbcba),
  markdownCodeBlock: Color(0xFFe0def4),
  syntaxComment: Color(0xFF908caa),
  syntaxKeyword: Color(0xFFc4a7e7),
  syntaxFunction: Color(0xFF9ccfd8),
  syntaxVariable: Color(0xFFeb6f92),
  syntaxString: Color(0xFFebbcba),
  syntaxNumber: Color(0xFFf6c177),
  syntaxType: Color(0xFF31748f),
  syntaxOperator: Color(0xFFebbcba),
  syntaxPunctuation: Color(0xFFe0def4),
);

// ═══════════════════════════════════════════════════════════════════════════════
// VERCEL - Clean Modern Blue
// ═══════════════════════════════════════════════════════════════════════════════
const vercelDarkTheme = OpenCodeTheme(
  primary: Color(0xFF0070F3),
  secondary: Color(0xFF7928CA),
  accent: Color(0xFF00DFD8),
  error: Color(0xFFEE0000),
  warning: Color(0xFFF5A623),
  success: Color(0xFF0070F3),
  info: Color(0xFF0070F3),
  text: Color(0xFFffffff),
  textMuted: Color(0xFF888888),
  selectedListItemText: Color(0xFF000000),
  background: Color(0xFF000000),
  backgroundPanel: Color(0xFF111111),
  backgroundElement: Color(0xFF1a1a1a),
  backgroundMenu: Color(0xFF1a1a1a),
  bgDeep: Color(0xFF000000),
  bgRaised: Color(0xFF0a0a0a),
  bgHover: Color(0xFF111111),
  bgActive: Color(0xFF1a1a1a),
  bgHighlight: Color(0xFF262626),
  bgOverlay: Color(0xFF333333),
  bgContrast: Color(0xFF444444),
  border: Color(0xFF333333),
  borderActive: Color(0xFF0070F3),
  borderSubtle: Color(0xFF222222),
  toolThinking: Color(0xFF0070F3), // Blue
  toolEdit: Color(0xFFF5A623), // Orange
  toolRead: Color(0xFF00DFD8), // Cyan
  toolWrite: Color(0xFF0070F3), // Blue
  toolBash: Color(0xFF888888), // Gray
  toolSearch: Color(0xFF0070F3), // Blue
  toolTodo: Color(0xFFF5A623), // Orange
  toolSubtask: Color(0xFF00DFD8), // Cyan
  diffAdded: Color(0xFF0070F3),
  diffRemoved: Color(0xFFEE0000),
  diffContext: Color(0xFF888888),
  diffHunkHeader: Color(0xFF888888),
  diffHighlightAdded: Color(0xFF0070F3),
  diffHighlightRemoved: Color(0xFFEE0000),
  diffAddedBg: Color(0xFF001833),
  diffRemovedBg: Color(0xFF330000),
  diffContextBg: Color(0xFF111111),
  diffLineNumber: Color(0xFF333333),
  diffAddedLineNumberBg: Color(0xFF001225),
  diffRemovedLineNumberBg: Color(0xFF250000),
  markdownText: Color(0xFFffffff),
  markdownHeading: Color(0xFF0070F3),
  markdownLink: Color(0xFF0070F3),
  markdownLinkText: Color(0xFF00DFD8),
  markdownCode: Color(0xFF00DFD8),
  markdownBlockQuote: Color(0xFF888888),
  markdownEmph: Color(0xFFF5A623),
  markdownStrong: Color(0xFF7928CA),
  markdownHorizontalRule: Color(0xFF888888),
  markdownListItem: Color(0xFF0070F3),
  markdownListEnumeration: Color(0xFF00DFD8),
  markdownImage: Color(0xFF0070F3),
  markdownImageText: Color(0xFF00DFD8),
  markdownCodeBlock: Color(0xFFffffff),
  syntaxComment: Color(0xFF888888),
  syntaxKeyword: Color(0xFF7928CA),
  syntaxFunction: Color(0xFF0070F3),
  syntaxVariable: Color(0xFFFF0080),
  syntaxString: Color(0xFF00DFD8),
  syntaxNumber: Color(0xFFF5A623),
  syntaxType: Color(0xFF0070F3),
  syntaxOperator: Color(0xFF7928CA),
  syntaxPunctuation: Color(0xFFffffff),
);

// ═══════════════════════════════════════════════════════════════════════════════
// COBALT2 - High Contrast Blue
// ═══════════════════════════════════════════════════════════════════════════════
const cobalt2DarkTheme = OpenCodeTheme(
  primary: Color(0xFF0088ff),
  secondary: Color(0xFFff9d00),
  accent: Color(0xFF80ffbb),
  error: Color(0xFFff628c),
  warning: Color(0xFFff9d00),
  success: Color(0xFF3ad900),
  info: Color(0xFF0088ff),
  text: Color(0xFFffffff),
  textMuted: Color(0xFF0d3a58),
  selectedListItemText: Color(0xFF193549),
  background: Color(0xFF193549),
  backgroundPanel: Color(0xFF122738),
  backgroundElement: Color(0xFF1d3b53),
  backgroundMenu: Color(0xFF1d3b53),
  bgDeep: Color(0xFF0a1f2e),
  bgRaised: Color(0xFF193549),
  bgHover: Color(0xFF1d3b53),
  bgActive: Color(0xFF254a68),
  bgHighlight: Color(0xFF2d5a7a),
  bgOverlay: Color(0xFF356a8c),
  bgContrast: Color(0xFF3d7a9e),
  border: Color(0xFF0d3a58),
  borderActive: Color(0xFF0088ff),
  borderSubtle: Color(0xFF0d3a58),
  toolThinking: Color(0xFF0088ff), // Blue
  toolEdit: Color(0xFFff9d00), // Orange
  toolRead: Color(0xFF80ffbb), // Mint
  toolWrite: Color(0xFF3ad900), // Green
  toolBash: Color(0xFF0d3a58), // Dark
  toolSearch: Color(0xFF0088ff), // Blue
  toolTodo: Color(0xFFffc600), // Yellow
  toolSubtask: Color(0xFF80ffbb), // Mint
  diffAdded: Color(0xFF3ad900),
  diffRemoved: Color(0xFFff628c),
  diffContext: Color(0xFF0d3a58),
  diffHunkHeader: Color(0xFF0d3a58),
  diffHighlightAdded: Color(0xFF3ad900),
  diffHighlightRemoved: Color(0xFFff628c),
  diffAddedBg: Color(0xFF1a3020),
  diffRemovedBg: Color(0xFF301a25),
  diffContextBg: Color(0xFF122738),
  diffLineNumber: Color(0xFF0d3a58),
  diffAddedLineNumberBg: Color(0xFF15251a),
  diffRemovedLineNumberBg: Color(0xFF251520),
  markdownText: Color(0xFFffffff),
  markdownHeading: Color(0xFFff9d00),
  markdownLink: Color(0xFF0088ff),
  markdownLinkText: Color(0xFF80ffbb),
  markdownCode: Color(0xFF3ad900),
  markdownBlockQuote: Color(0xFF0d3a58),
  markdownEmph: Color(0xFFff9d00),
  markdownStrong: Color(0xFFff9d00),
  markdownHorizontalRule: Color(0xFF0d3a58),
  markdownListItem: Color(0xFF0088ff),
  markdownListEnumeration: Color(0xFF80ffbb),
  markdownImage: Color(0xFF0088ff),
  markdownImageText: Color(0xFF80ffbb),
  markdownCodeBlock: Color(0xFFffffff),
  syntaxComment: Color(0xFF0d3a58),
  syntaxKeyword: Color(0xFFff9d00),
  syntaxFunction: Color(0xFF0088ff),
  syntaxVariable: Color(0xFF9effff),
  syntaxString: Color(0xFF3ad900),
  syntaxNumber: Color(0xFFff628c),
  syntaxType: Color(0xFFffc600),
  syntaxOperator: Color(0xFFff9d00),
  syntaxPunctuation: Color(0xFFffffff),
);

// ═══════════════════════════════════════════════════════════════════════════════
// NIGHTOWL - Night Coding Blue
// ═══════════════════════════════════════════════════════════════════════════════
const nightowlDarkTheme = OpenCodeTheme(
  primary: Color(0xFF82AAFF),
  secondary: Color(0xFFC792EA),
  accent: Color(0xFF7fdbca),
  error: Color(0xFFef5350),
  warning: Color(0xFFffcb6b),
  success: Color(0xFFc3e88d),
  info: Color(0xFF82AAFF),
  text: Color(0xFFd6deeb),
  textMuted: Color(0xFF637777),
  selectedListItemText: Color(0xFF011627),
  background: Color(0xFF011627),
  backgroundPanel: Color(0xFF0b2942),
  backgroundElement: Color(0xFF0b2942),
  backgroundMenu: Color(0xFF0b2942),
  bgDeep: Color(0xFF000d1a),
  bgRaised: Color(0xFF011627),
  bgHover: Color(0xFF0b2942),
  bgActive: Color(0xFF1d3b53),
  bgHighlight: Color(0xFF234d68),
  bgOverlay: Color(0xFF2a5f7d),
  bgContrast: Color(0xFF327192),
  border: Color(0xFF1d3b53),
  borderActive: Color(0xFF82AAFF),
  borderSubtle: Color(0xFF0b2942),
  toolThinking: Color(0xFF82AAFF), // Blue
  toolEdit: Color(0xFFf78c6c), // Orange
  toolRead: Color(0xFF7fdbca), // Cyan
  toolWrite: Color(0xFFc3e88d), // Green
  toolBash: Color(0xFF637777), // Gray
  toolSearch: Color(0xFF82AAFF), // Blue
  toolTodo: Color(0xFFffcb6b), // Yellow
  toolSubtask: Color(0xFF7fdbca), // Cyan
  diffAdded: Color(0xFFc3e88d),
  diffRemoved: Color(0xFFef5350),
  diffContext: Color(0xFF637777),
  diffHunkHeader: Color(0xFF637777),
  diffHighlightAdded: Color(0xFFc3e88d),
  diffHighlightRemoved: Color(0xFFef5350),
  diffAddedBg: Color(0xFF0b3020),
  diffRemovedBg: Color(0xFF300b15),
  diffContextBg: Color(0xFF0b2942),
  diffLineNumber: Color(0xFF1d3b53),
  diffAddedLineNumberBg: Color(0xFF08251a),
  diffRemovedLineNumberBg: Color(0xFF250810),
  markdownText: Color(0xFFd6deeb),
  markdownHeading: Color(0xFFC792EA),
  markdownLink: Color(0xFF82AAFF),
  markdownLinkText: Color(0xFF7fdbca),
  markdownCode: Color(0xFFc3e88d),
  markdownBlockQuote: Color(0xFF637777),
  markdownEmph: Color(0xFFffcb6b),
  markdownStrong: Color(0xFFf78c6c),
  markdownHorizontalRule: Color(0xFF637777),
  markdownListItem: Color(0xFF82AAFF),
  markdownListEnumeration: Color(0xFF7fdbca),
  markdownImage: Color(0xFF82AAFF),
  markdownImageText: Color(0xFF7fdbca),
  markdownCodeBlock: Color(0xFFd6deeb),
  syntaxComment: Color(0xFF637777),
  syntaxKeyword: Color(0xFFC792EA),
  syntaxFunction: Color(0xFF82AAFF),
  syntaxVariable: Color(0xFFf78c6c),
  syntaxString: Color(0xFFecc48d),
  syntaxNumber: Color(0xFFf78c6c),
  syntaxType: Color(0xFF7fdbca),
  syntaxOperator: Color(0xFFC792EA),
  syntaxPunctuation: Color(0xFFd6deeb),
);

// ═══════════════════════════════════════════════════════════════════════════════
// PALENIGHT - Soft Purple
// ═══════════════════════════════════════════════════════════════════════════════
const palenightDarkTheme = OpenCodeTheme(
  primary: Color(0xFF82aaff),
  secondary: Color(0xFFc792ea),
  accent: Color(0xFF89ddff),
  error: Color(0xFFff5370),
  warning: Color(0xFFffcb6b),
  success: Color(0xFFc3e88d),
  info: Color(0xFF82aaff),
  text: Color(0xFFa6accd),
  textMuted: Color(0xFF676e95),
  selectedListItemText: Color(0xFF292d3e),
  background: Color(0xFF292d3e),
  backgroundPanel: Color(0xFF1b1e2b),
  backgroundElement: Color(0xFF32374d),
  backgroundMenu: Color(0xFF32374d),
  bgDeep: Color(0xFF15171f),
  bgRaised: Color(0xFF292d3e),
  bgHover: Color(0xFF32374d),
  bgActive: Color(0xFF3b4158),
  bgHighlight: Color(0xFF444267),
  bgOverlay: Color(0xFF545880),
  bgContrast: Color(0xFF646999),
  border: Color(0xFF444267),
  borderActive: Color(0xFF82aaff),
  borderSubtle: Color(0xFF32374d),
  toolThinking: Color(0xFF82aaff), // Blue
  toolEdit: Color(0xFFf78c6c), // Orange
  toolRead: Color(0xFF89ddff), // Cyan
  toolWrite: Color(0xFFc3e88d), // Green
  toolBash: Color(0xFF676e95), // Gray
  toolSearch: Color(0xFF82aaff), // Blue
  toolTodo: Color(0xFFffcb6b), // Yellow
  toolSubtask: Color(0xFF89ddff), // Cyan
  diffAdded: Color(0xFFc3e88d),
  diffRemoved: Color(0xFFff5370),
  diffContext: Color(0xFF676e95),
  diffHunkHeader: Color(0xFF676e95),
  diffHighlightAdded: Color(0xFFc3e88d),
  diffHighlightRemoved: Color(0xFFff5370),
  diffAddedBg: Color(0xFF2d3c2d),
  diffRemovedBg: Color(0xFF3c2d35),
  diffContextBg: Color(0xFF1b1e2b),
  diffLineNumber: Color(0xFF444267),
  diffAddedLineNumberBg: Color(0xFF253425),
  diffRemovedLineNumberBg: Color(0xFF34252a),
  markdownText: Color(0xFFa6accd),
  markdownHeading: Color(0xFFc792ea),
  markdownLink: Color(0xFF82aaff),
  markdownLinkText: Color(0xFF89ddff),
  markdownCode: Color(0xFFc3e88d),
  markdownBlockQuote: Color(0xFF676e95),
  markdownEmph: Color(0xFFffcb6b),
  markdownStrong: Color(0xFFf78c6c),
  markdownHorizontalRule: Color(0xFF676e95),
  markdownListItem: Color(0xFF82aaff),
  markdownListEnumeration: Color(0xFF89ddff),
  markdownImage: Color(0xFF82aaff),
  markdownImageText: Color(0xFF89ddff),
  markdownCodeBlock: Color(0xFFa6accd),
  syntaxComment: Color(0xFF676e95),
  syntaxKeyword: Color(0xFFc792ea),
  syntaxFunction: Color(0xFF82aaff),
  syntaxVariable: Color(0xFFf07178),
  syntaxString: Color(0xFFc3e88d),
  syntaxNumber: Color(0xFFf78c6c),
  syntaxType: Color(0xFFffcb6b),
  syntaxOperator: Color(0xFF89ddff),
  syntaxPunctuation: Color(0xFFa6accd),
);

// ═══════════════════════════════════════════════════════════════════════════════
// CATPPUCCIN FRAPPE - Muted Pastel
// ═══════════════════════════════════════════════════════════════════════════════
const catppuccinFrappeDarkTheme = OpenCodeTheme(
  primary: Color(0xFF8da4e2),
  secondary: Color(0xFFca9ee6),
  accent: Color(0xFFf4b8e4),
  error: Color(0xFFe78284),
  warning: Color(0xFFe5c890),
  success: Color(0xFFa6d189),
  info: Color(0xFF81c8be),
  text: Color(0xFFc6d0f5),
  textMuted: Color(0xFFb5bfe2),
  selectedListItemText: Color(0xFF303446),
  background: Color(0xFF303446),
  backgroundPanel: Color(0xFF292c3c),
  backgroundElement: Color(0xFF232634),
  backgroundMenu: Color(0xFF232634),
  bgDeep: Color(0xFF1e2030),
  bgRaised: Color(0xFF303446),
  bgHover: Color(0xFF363a4f),
  bgActive: Color(0xFF414559),
  bgHighlight: Color(0xFF51576d),
  bgOverlay: Color(0xFF626880),
  bgContrast: Color(0xFF737994),
  border: Color(0xFF414559),
  borderActive: Color(0xFF51576d),
  borderSubtle: Color(0xFF626880),
  toolThinking: Color(0xFF8da4e2), // Blue
  toolEdit: Color(0xFFef9f76), // Orange/Peach
  toolRead: Color(0xFF81c8be), // Teal
  toolWrite: Color(0xFFa6d189), // Green
  toolBash: Color(0xFF949cbb), // Overlay
  toolSearch: Color(0xFF8da4e2), // Blue
  toolTodo: Color(0xFFe5c890), // Yellow
  toolSubtask: Color(0xFF81c8be), // Teal
  diffAdded: Color(0xFFa6d189),
  diffRemoved: Color(0xFFe78284),
  diffContext: Color(0xFF949cb8),
  diffHunkHeader: Color(0xFFef9f76),
  diffHighlightAdded: Color(0xFFa6d189),
  diffHighlightRemoved: Color(0xFFe78284),
  diffAddedBg: Color(0xFF29342b),
  diffRemovedBg: Color(0xFF3a2a31),
  diffContextBg: Color(0xFF292c3c),
  diffLineNumber: Color(0xFF51576d),
  diffAddedLineNumberBg: Color(0xFF223025),
  diffRemovedLineNumberBg: Color(0xFF2f242b),
  markdownText: Color(0xFFc6d0f5),
  markdownHeading: Color(0xFFca9ee6),
  markdownLink: Color(0xFF8da4e2),
  markdownLinkText: Color(0xFF99d1db),
  markdownCode: Color(0xFFa6d189),
  markdownBlockQuote: Color(0xFFe5c890),
  markdownEmph: Color(0xFFe5c890),
  markdownStrong: Color(0xFFef9f76),
  markdownHorizontalRule: Color(0xFFa5adce),
  markdownListItem: Color(0xFF8da4e2),
  markdownListEnumeration: Color(0xFF99d1db),
  markdownImage: Color(0xFF8da4e2),
  markdownImageText: Color(0xFF99d1db),
  markdownCodeBlock: Color(0xFFc6d0f5),
  syntaxComment: Color(0xFF949cb8),
  syntaxKeyword: Color(0xFFca9ee6),
  syntaxFunction: Color(0xFF8da4e2),
  syntaxVariable: Color(0xFFe78284),
  syntaxString: Color(0xFFa6d189),
  syntaxNumber: Color(0xFFef9f76),
  syntaxType: Color(0xFFe5c890),
  syntaxOperator: Color(0xFF99d1db),
  syntaxPunctuation: Color(0xFFc6d0f5),
);

// ═══════════════════════════════════════════════════════════════════════════════
// CATPPUCCIN MACCHIATO - Medium Pastel
// ═══════════════════════════════════════════════════════════════════════════════
const catppuccinMacchiatoDarkTheme = OpenCodeTheme(
  primary: Color(0xFF8aadf4),
  secondary: Color(0xFFc6a0f6),
  accent: Color(0xFFf5bde6),
  error: Color(0xFFed8796),
  warning: Color(0xFFeed49f),
  success: Color(0xFFa6da95),
  info: Color(0xFF8bd5ca),
  text: Color(0xFFcad3f5),
  textMuted: Color(0xFFb8c0e0),
  selectedListItemText: Color(0xFF24273a),
  background: Color(0xFF24273a),
  backgroundPanel: Color(0xFF1e2030),
  backgroundElement: Color(0xFF181926),
  backgroundMenu: Color(0xFF181926),
  bgDeep: Color(0xFF141620),
  bgRaised: Color(0xFF24273a),
  bgHover: Color(0xFF2a2d42),
  bgActive: Color(0xFF363a4f),
  bgHighlight: Color(0xFF494d64),
  bgOverlay: Color(0xFF5b6078),
  bgContrast: Color(0xFF6e738d),
  border: Color(0xFF363a4f),
  borderActive: Color(0xFF494d64),
  borderSubtle: Color(0xFF5b6078),
  toolThinking: Color(0xFF8aadf4), // Blue
  toolEdit: Color(0xFFf5a97f), // Peach
  toolRead: Color(0xFF8bd5ca), // Teal
  toolWrite: Color(0xFFa6da95), // Green
  toolBash: Color(0xFF939ab7), // Overlay
  toolSearch: Color(0xFF8aadf4), // Blue
  toolTodo: Color(0xFFeed49f), // Yellow
  toolSubtask: Color(0xFF8bd5ca), // Teal
  diffAdded: Color(0xFFa6da95),
  diffRemoved: Color(0xFFed8796),
  diffContext: Color(0xFF939ab7),
  diffHunkHeader: Color(0xFFf5a97f),
  diffHighlightAdded: Color(0xFFa6da95),
  diffHighlightRemoved: Color(0xFFed8796),
  diffAddedBg: Color(0xFF29342b),
  diffRemovedBg: Color(0xFF3a2a31),
  diffContextBg: Color(0xFF1e2030),
  diffLineNumber: Color(0xFF494d64),
  diffAddedLineNumberBg: Color(0xFF223025),
  diffRemovedLineNumberBg: Color(0xFF2f242b),
  markdownText: Color(0xFFcad3f5),
  markdownHeading: Color(0xFFc6a0f6),
  markdownLink: Color(0xFF8aadf4),
  markdownLinkText: Color(0xFF91d7e3),
  markdownCode: Color(0xFFa6da95),
  markdownBlockQuote: Color(0xFFeed49f),
  markdownEmph: Color(0xFFeed49f),
  markdownStrong: Color(0xFFf5a97f),
  markdownHorizontalRule: Color(0xFFa5adcb),
  markdownListItem: Color(0xFF8aadf4),
  markdownListEnumeration: Color(0xFF91d7e3),
  markdownImage: Color(0xFF8aadf4),
  markdownImageText: Color(0xFF91d7e3),
  markdownCodeBlock: Color(0xFFcad3f5),
  syntaxComment: Color(0xFF939ab7),
  syntaxKeyword: Color(0xFFc6a0f6),
  syntaxFunction: Color(0xFF8aadf4),
  syntaxVariable: Color(0xFFed8796),
  syntaxString: Color(0xFFa6da95),
  syntaxNumber: Color(0xFFf5a97f),
  syntaxType: Color(0xFFeed49f),
  syntaxOperator: Color(0xFF91d7e3),
  syntaxPunctuation: Color(0xFFcad3f5),
);

// ═══════════════════════════════════════════════════════════════════════════════
// MATERIAL - Material Design
// ═══════════════════════════════════════════════════════════════════════════════
const materialDarkTheme = OpenCodeTheme(
  primary: Color(0xFF82aaff),
  secondary: Color(0xFFc792ea),
  accent: Color(0xFF89ddff),
  error: Color(0xFFf07178),
  warning: Color(0xFFffcb6b),
  success: Color(0xFFc3e88d),
  info: Color(0xFFf78c6c),
  text: Color(0xFFeeffff),
  textMuted: Color(0xFF546e7a),
  selectedListItemText: Color(0xFF263238),
  background: Color(0xFF263238),
  backgroundPanel: Color(0xFF1e272c),
  backgroundElement: Color(0xFF37474f),
  backgroundMenu: Color(0xFF37474f),
  bgDeep: Color(0xFF151c20),
  bgRaised: Color(0xFF263238),
  bgHover: Color(0xFF2e3c42),
  bgActive: Color(0xFF37474f),
  bgHighlight: Color(0xFF455a64),
  bgOverlay: Color(0xFF546e7a),
  bgContrast: Color(0xFF607d8b),
  border: Color(0xFF37474f),
  borderActive: Color(0xFF82aaff),
  borderSubtle: Color(0xFF1e272c),
  toolThinking: Color(0xFF82aaff), // Blue
  toolEdit: Color(0xFFf78c6c), // Orange
  toolRead: Color(0xFF89ddff), // Cyan
  toolWrite: Color(0xFFc3e88d), // Green
  toolBash: Color(0xFF546e7a), // Gray
  toolSearch: Color(0xFF82aaff), // Blue
  toolTodo: Color(0xFFffcb6b), // Yellow
  toolSubtask: Color(0xFF89ddff), // Cyan
  diffAdded: Color(0xFFc3e88d),
  diffRemoved: Color(0xFFf07178),
  diffContext: Color(0xFF546e7a),
  diffHunkHeader: Color(0xFF89ddff),
  diffHighlightAdded: Color(0xFFc3e88d),
  diffHighlightRemoved: Color(0xFFf07178),
  diffAddedBg: Color(0xFF2e3c2b),
  diffRemovedBg: Color(0xFF3c2b2b),
  diffContextBg: Color(0xFF1e272c),
  diffLineNumber: Color(0xFF37474f),
  diffAddedLineNumberBg: Color(0xFF2e3c2b),
  diffRemovedLineNumberBg: Color(0xFF3c2b2b),
  markdownText: Color(0xFFeeffff),
  markdownHeading: Color(0xFF82aaff),
  markdownLink: Color(0xFF89ddff),
  markdownLinkText: Color(0xFFc792ea),
  markdownCode: Color(0xFFc3e88d),
  markdownBlockQuote: Color(0xFF546e7a),
  markdownEmph: Color(0xFFffcb6b),
  markdownStrong: Color(0xFFf78c6c),
  markdownHorizontalRule: Color(0xFF37474f),
  markdownListItem: Color(0xFF82aaff),
  markdownListEnumeration: Color(0xFF89ddff),
  markdownImage: Color(0xFF89ddff),
  markdownImageText: Color(0xFFc792ea),
  markdownCodeBlock: Color(0xFFeeffff),
  syntaxComment: Color(0xFF546e7a),
  syntaxKeyword: Color(0xFFc792ea),
  syntaxFunction: Color(0xFF82aaff),
  syntaxVariable: Color(0xFFeeffff),
  syntaxString: Color(0xFFc3e88d),
  syntaxNumber: Color(0xFFf78c6c),
  syntaxType: Color(0xFFffcb6b),
  syntaxOperator: Color(0xFF89ddff),
  syntaxPunctuation: Color(0xFFeeffff),
);

// ═══════════════════════════════════════════════════════════════════════════════
// EVERFOREST - Nature Calm
// ═══════════════════════════════════════════════════════════════════════════════
const everforestDarkTheme = OpenCodeTheme(
  primary: Color(0xFFa7c080),
  secondary: Color(0xFF7fbbb3),
  accent: Color(0xFFd699b6),
  error: Color(0xFFe67e80),
  warning: Color(0xFFe69875),
  success: Color(0xFFa7c080),
  info: Color(0xFF83c092),
  text: Color(0xFFd3c6aa),
  textMuted: Color(0xFF7a8478),
  selectedListItemText: Color(0xFF2d353b),
  background: Color(0xFF2d353b),
  backgroundPanel: Color(0xFF333c43),
  backgroundElement: Color(0xFF343f44),
  backgroundMenu: Color(0xFF343f44),
  bgDeep: Color(0xFF232a2e),
  bgRaised: Color(0xFF2d353b),
  bgHover: Color(0xFF333c43),
  bgActive: Color(0xFF3d484d),
  bgHighlight: Color(0xFF475258),
  bgOverlay: Color(0xFF515c62),
  bgContrast: Color(0xFF5b666c),
  border: Color(0xFF859289),
  borderActive: Color(0xFF9da9a0),
  borderSubtle: Color(0xFF7a8478),
  toolThinking: Color(0xFF7fbbb3), // Blue-green
  toolEdit: Color(0xFFe69875), // Orange
  toolRead: Color(0xFF7fbbb3), // Aqua
  toolWrite: Color(0xFFa7c080), // Green
  toolBash: Color(0xFF7a8478), // Gray
  toolSearch: Color(0xFF7fbbb3), // Aqua
  toolTodo: Color(0xFFdbbc7f), // Yellow
  toolSubtask: Color(0xFF83c092), // Teal
  diffAdded: Color(0xFF4fd6be),
  diffRemoved: Color(0xFFc53b53),
  diffContext: Color(0xFF828bb8),
  diffHunkHeader: Color(0xFF828bb8),
  diffHighlightAdded: Color(0xFFb8db87),
  diffHighlightRemoved: Color(0xFFe26a75),
  diffAddedBg: Color(0xFF20303b),
  diffRemovedBg: Color(0xFF37222c),
  diffContextBg: Color(0xFF333c43),
  diffLineNumber: Color(0xFF343f44),
  diffAddedLineNumberBg: Color(0xFF1b2b34),
  diffRemovedLineNumberBg: Color(0xFF2d1f26),
  markdownText: Color(0xFFd3c6aa),
  markdownHeading: Color(0xFFd699b6),
  markdownLink: Color(0xFFa7c080),
  markdownLinkText: Color(0xFF83c092),
  markdownCode: Color(0xFFa7c080),
  markdownBlockQuote: Color(0xFFdbbc7f),
  markdownEmph: Color(0xFFdbbc7f),
  markdownStrong: Color(0xFFe69875),
  markdownHorizontalRule: Color(0xFF7a8478),
  markdownListItem: Color(0xFFa7c080),
  markdownListEnumeration: Color(0xFF83c092),
  markdownImage: Color(0xFFa7c080),
  markdownImageText: Color(0xFF83c092),
  markdownCodeBlock: Color(0xFFd3c6aa),
  syntaxComment: Color(0xFF7a8478),
  syntaxKeyword: Color(0xFFd699b6),
  syntaxFunction: Color(0xFFa7c080),
  syntaxVariable: Color(0xFFe67e80),
  syntaxString: Color(0xFFa7c080),
  syntaxNumber: Color(0xFFe69875),
  syntaxType: Color(0xFFdbbc7f),
  syntaxOperator: Color(0xFF83c092),
  syntaxPunctuation: Color(0xFFd3c6aa),
);

// ═══════════════════════════════════════════════════════════════════════════════
// KANAGAWA - Japanese Aesthetic
// ═══════════════════════════════════════════════════════════════════════════════
const kanagawaDarkTheme = OpenCodeTheme(
  primary: Color(0xFF7E9CD8),
  secondary: Color(0xFF957FB8),
  accent: Color(0xFFD27E99),
  error: Color(0xFFE82424),
  warning: Color(0xFFD7A657),
  success: Color(0xFF98BB6C),
  info: Color(0xFF76946A),
  text: Color(0xFFDCD7BA),
  textMuted: Color(0xFF727169),
  selectedListItemText: Color(0xFF1F1F28),
  background: Color(0xFF1F1F28),
  backgroundPanel: Color(0xFF2A2A37),
  backgroundElement: Color(0xFF363646),
  backgroundMenu: Color(0xFF363646),
  bgDeep: Color(0xFF16161D),
  bgRaised: Color(0xFF1F1F28),
  bgHover: Color(0xFF2A2A37),
  bgActive: Color(0xFF363646),
  bgHighlight: Color(0xFF43435A),
  bgOverlay: Color(0xFF54546D),
  bgContrast: Color(0xFF626279),
  border: Color(0xFF54546D),
  borderActive: Color(0xFFC38D9D),
  borderSubtle: Color(0xFF363646),
  toolThinking: Color(0xFF7E9CD8), // Blue
  toolEdit: Color(0xFFD7A657), // Gold
  toolRead: Color(0xFF7E9CD8), // Blue
  toolWrite: Color(0xFF98BB6C), // Green
  toolBash: Color(0xFF727169), // Gray
  toolSearch: Color(0xFF7E9CD8), // Blue
  toolTodo: Color(0xFFD7A657), // Gold
  toolSubtask: Color(0xFF76946A), // Green/Teal
  diffAdded: Color(0xFF98BB6C),
  diffRemoved: Color(0xFFE82424),
  diffContext: Color(0xFF727169),
  diffHunkHeader: Color(0xFF2D4F67),
  diffHighlightAdded: Color(0xFFA9D977),
  diffHighlightRemoved: Color(0xFFF24A4A),
  diffAddedBg: Color(0xFF252E25),
  diffRemovedBg: Color(0xFF362020),
  diffContextBg: Color(0xFF2A2A37),
  diffLineNumber: Color(0xFF54546D),
  diffAddedLineNumberBg: Color(0xFF202820),
  diffRemovedLineNumberBg: Color(0xFF2D1C1C),
  markdownText: Color(0xFFDCD7BA),
  markdownHeading: Color(0xFF957FB8),
  markdownLink: Color(0xFF7E9CD8),
  markdownLinkText: Color(0xFF76946A),
  markdownCode: Color(0xFF98BB6C),
  markdownBlockQuote: Color(0xFF727169),
  markdownEmph: Color(0xFFC38D9D),
  markdownStrong: Color(0xFFD7A657),
  markdownHorizontalRule: Color(0xFF727169),
  markdownListItem: Color(0xFF7E9CD8),
  markdownListEnumeration: Color(0xFF76946A),
  markdownImage: Color(0xFF7E9CD8),
  markdownImageText: Color(0xFF76946A),
  markdownCodeBlock: Color(0xFFDCD7BA),
  syntaxComment: Color(0xFF727169),
  syntaxKeyword: Color(0xFF957FB8),
  syntaxFunction: Color(0xFF7E9CD8),
  syntaxVariable: Color(0xFFDCD7BA),
  syntaxString: Color(0xFF98BB6C),
  syntaxNumber: Color(0xFFD7A657),
  syntaxType: Color(0xFFC38D9D),
  syntaxOperator: Color(0xFFD27E99),
  syntaxPunctuation: Color(0xFFDCD7BA),
);

// ═══════════════════════════════════════════════════════════════════════════════
// ZENBURN - Low Contrast
// ═══════════════════════════════════════════════════════════════════════════════
const zenburnDarkTheme = OpenCodeTheme(
  primary: Color(0xFF8cd0d3),
  secondary: Color(0xFFdc8cc3),
  accent: Color(0xFF93e0e3),
  error: Color(0xFFcc9393),
  warning: Color(0xFFf0dfaf),
  success: Color(0xFF7f9f7f),
  info: Color(0xFFdfaf8f),
  text: Color(0xFFdcdccc),
  textMuted: Color(0xFF9f9f9f),
  selectedListItemText: Color(0xFF3f3f3f),
  background: Color(0xFF3f3f3f),
  backgroundPanel: Color(0xFF4f4f4f),
  backgroundElement: Color(0xFF5f5f5f),
  backgroundMenu: Color(0xFF5f5f5f),
  bgDeep: Color(0xFF2f2f2f),
  bgRaised: Color(0xFF3f3f3f),
  bgHover: Color(0xFF4f4f4f),
  bgActive: Color(0xFF5f5f5f),
  bgHighlight: Color(0xFF6f6f6f),
  bgOverlay: Color(0xFF7f7f7f),
  bgContrast: Color(0xFF8f8f8f),
  border: Color(0xFF5f5f5f),
  borderActive: Color(0xFF8cd0d3),
  borderSubtle: Color(0xFF4f4f4f),
  toolThinking: Color(0xFF8cd0d3), // Cyan
  toolEdit: Color(0xFFdfaf8f), // Orange
  toolRead: Color(0xFF93e0e3), // Light cyan
  toolWrite: Color(0xFF7f9f7f), // Green
  toolBash: Color(0xFF9f9f9f), // Gray
  toolSearch: Color(0xFF8cd0d3), // Cyan
  toolTodo: Color(0xFFf0dfaf), // Yellow
  toolSubtask: Color(0xFF93e0e3), // Light cyan
  diffAdded: Color(0xFF7f9f7f),
  diffRemoved: Color(0xFFcc9393),
  diffContext: Color(0xFF9f9f9f),
  diffHunkHeader: Color(0xFF93e0e3),
  diffHighlightAdded: Color(0xFF8fb28f),
  diffHighlightRemoved: Color(0xFFdca3a3),
  diffAddedBg: Color(0xFF4f5f4f),
  diffRemovedBg: Color(0xFF5f4f4f),
  diffContextBg: Color(0xFF4f4f4f),
  diffLineNumber: Color(0xFF6f6f6f),
  diffAddedLineNumberBg: Color(0xFF4f5f4f),
  diffRemovedLineNumberBg: Color(0xFF5f4f4f),
  markdownText: Color(0xFFdcdccc),
  markdownHeading: Color(0xFFf0dfaf),
  markdownLink: Color(0xFF8cd0d3),
  markdownLinkText: Color(0xFF93e0e3),
  markdownCode: Color(0xFF7f9f7f),
  markdownBlockQuote: Color(0xFF9f9f9f),
  markdownEmph: Color(0xFFe0cf9f),
  markdownStrong: Color(0xFFdfaf8f),
  markdownHorizontalRule: Color(0xFF9f9f9f),
  markdownListItem: Color(0xFF8cd0d3),
  markdownListEnumeration: Color(0xFF93e0e3),
  markdownImage: Color(0xFF8cd0d3),
  markdownImageText: Color(0xFF93e0e3),
  markdownCodeBlock: Color(0xFFdcdccc),
  syntaxComment: Color(0xFF7f9f7f),
  syntaxKeyword: Color(0xFFf0dfaf),
  syntaxFunction: Color(0xFF8cd0d3),
  syntaxVariable: Color(0xFFdcdccc),
  syntaxString: Color(0xFFcc9393),
  syntaxNumber: Color(0xFF8fb28f),
  syntaxType: Color(0xFF93e0e3),
  syntaxOperator: Color(0xFFf0dfaf),
  syntaxPunctuation: Color(0xFFdcdccc),
);

// ═══════════════════════════════════════════════════════════════════════════════
// MERCURY - Clean Purple
// ═══════════════════════════════════════════════════════════════════════════════
const mercuryDarkTheme = OpenCodeTheme(
  primary: Color(0xFF8da4f5),
  secondary: Color(0xFFa7b6f8),
  accent: Color(0xFF8da4f5),
  error: Color(0xFFfc92b4),
  warning: Color(0xFFfc9b6f),
  success: Color(0xFF77c599),
  info: Color(0xFF77becf),
  text: Color(0xFFdddde5),
  textMuted: Color(0xFF9d9da8),
  selectedListItemText: Color(0xFF171721),
  background: Color(0xFF171721),
  backgroundPanel: Color(0xFF10101a),
  backgroundElement: Color(0xFF272735),
  backgroundMenu: Color(0xFF272735),
  bgDeep: Color(0xFF0a0a12),
  bgRaised: Color(0xFF171721),
  bgHover: Color(0xFF1e1e2a),
  bgActive: Color(0xFF272735),
  bgHighlight: Color(0xFF323242),
  bgOverlay: Color(0xFF3d3d4f),
  bgContrast: Color(0xFF48485c),
  border: Color(0x1Fb4b7c8),
  borderActive: Color(0xFF8da4f5),
  borderSubtle: Color(0x14b4b7c8),
  toolThinking: Color(0xFF8da4f5), // Blue
  toolEdit: Color(0xFFfc9b6f), // Orange
  toolRead: Color(0xFF77becf), // Cyan
  toolWrite: Color(0xFF77c599), // Green
  toolBash: Color(0xFF9d9da8), // Gray
  toolSearch: Color(0xFF8da4f5), // Blue
  toolTodo: Color(0xFFfc9b6f), // Orange
  toolSubtask: Color(0xFF77becf), // Cyan
  diffAdded: Color(0xFF77c599),
  diffRemoved: Color(0xFFfc92b4),
  diffContext: Color(0xFF9d9da8),
  diffHunkHeader: Color(0xFF9d9da8),
  diffHighlightAdded: Color(0xFF77c599),
  diffHighlightRemoved: Color(0xFFfc92b4),
  diffAddedBg: Color(0x3377c599),
  diffRemovedBg: Color(0x33fc92b4),
  diffContextBg: Color(0xFF1e1e2a),
  diffLineNumber: Color(0xFFc3c3cc),
  diffAddedLineNumberBg: Color(0x3377c599),
  diffRemovedLineNumberBg: Color(0x33fc92b4),
  markdownText: Color(0xFFdddde5),
  markdownHeading: Color(0xFFffffff),
  markdownLink: Color(0xFF8da4f5),
  markdownLinkText: Color(0xFFa7b6f8),
  markdownCode: Color(0xFF77c599),
  markdownBlockQuote: Color(0xFF9d9da8),
  markdownEmph: Color(0xFFfc9b6f),
  markdownStrong: Color(0xFFf4f5f9),
  markdownHorizontalRule: Color(0x1Fb4b7c8),
  markdownListItem: Color(0xFFffffff),
  markdownListEnumeration: Color(0xFF8da4f5),
  markdownImage: Color(0xFF8da4f5),
  markdownImageText: Color(0xFFa7b6f8),
  markdownCodeBlock: Color(0xFFdddde5),
  syntaxComment: Color(0xFF9d9da8),
  syntaxKeyword: Color(0xFF8da4f5),
  syntaxFunction: Color(0xFF8da4f5),
  syntaxVariable: Color(0xFF77becf),
  syntaxString: Color(0xFF77c599),
  syntaxNumber: Color(0xFFfc9b6f),
  syntaxType: Color(0xFF77becf),
  syntaxOperator: Color(0xFF8da4f5),
  syntaxPunctuation: Color(0xFFdddde5),
);

// ═══════════════════════════════════════════════════════════════════════════════
// CURSOR - Cursor Inspired
// ═══════════════════════════════════════════════════════════════════════════════
const cursorDarkTheme = OpenCodeTheme(
  primary: Color(0xFF88c0d0),
  secondary: Color(0xFF81a1c1),
  accent: Color(0xFF88c0d0),
  error: Color(0xFFe34671),
  warning: Color(0xFFf1b467),
  success: Color(0xFF3fa266),
  info: Color(0xFF81a1c1),
  text: Color(0xFFe4e4e4),
  textMuted: Color(0x5Ee4e4e4),
  selectedListItemText: Color(0xFF181818),
  background: Color(0xFF181818),
  backgroundPanel: Color(0xFF141414),
  backgroundElement: Color(0xFF262626),
  backgroundMenu: Color(0xFF262626),
  bgDeep: Color(0xFF0c0c0c),
  bgRaised: Color(0xFF181818),
  bgHover: Color(0xFF1e1e1e),
  bgActive: Color(0xFF262626),
  bgHighlight: Color(0xFF303030),
  bgOverlay: Color(0xFF3a3a3a),
  bgContrast: Color(0xFF444444),
  border: Color(0x13e4e4e4),
  borderActive: Color(0xFF88c0d0),
  borderSubtle: Color(0xFF0f0f0f),
  toolThinking: Color(0xFF81a1c1), // Blue
  toolEdit: Color(0xFFf1b467), // Orange
  toolRead: Color(0xFF88c0d0), // Cyan
  toolWrite: Color(0xFF3fa266), // Green
  toolBash: Color(0x5Ee4e4e4), // Muted
  toolSearch: Color(0xFF88c0d0), // Cyan
  toolTodo: Color(0xFFF8C762), // Yellow
  toolSubtask: Color(0xFF82D2CE), // Teal
  diffAdded: Color(0xFF3fa266),
  diffRemoved: Color(0xFFe34671),
  diffContext: Color(0x5Ee4e4e4),
  diffHunkHeader: Color(0x5Ee4e4e4),
  diffHighlightAdded: Color(0xFF70b489),
  diffHighlightRemoved: Color(0xFFfc6b83),
  diffAddedBg: Color(0x333fa266),
  diffRemovedBg: Color(0x33b80049),
  diffContextBg: Color(0xFF141414),
  diffLineNumber: Color(0x42e4e4e4),
  diffAddedLineNumberBg: Color(0x333fa266),
  diffRemovedLineNumberBg: Color(0x33b80049),
  markdownText: Color(0xFFe4e4e4),
  markdownHeading: Color(0xFFAAA0FA),
  markdownLink: Color(0xFF82D2CE),
  markdownLinkText: Color(0xFF81a1c1),
  markdownCode: Color(0xFFE394DC),
  markdownBlockQuote: Color(0x5Ee4e4e4),
  markdownEmph: Color(0xFF82D2CE),
  markdownStrong: Color(0xFFF8C762),
  markdownHorizontalRule: Color(0x5Ee4e4e4),
  markdownListItem: Color(0xFFe4e4e4),
  markdownListEnumeration: Color(0xFF88c0d0),
  markdownImage: Color(0xFF88c0d0),
  markdownImageText: Color(0xFF81a1c1),
  markdownCodeBlock: Color(0xFFe4e4e4),
  syntaxComment: Color(0x5Ee4e4e4),
  syntaxKeyword: Color(0xFF82D2CE),
  syntaxFunction: Color(0xFFEFB080),
  syntaxVariable: Color(0xFFe4e4e4),
  syntaxString: Color(0xFFE394DC),
  syntaxNumber: Color(0xFFF8C762),
  syntaxType: Color(0xFFEFB080),
  syntaxOperator: Color(0xFFe4e4e4),
  syntaxPunctuation: Color(0xFFe4e4e4),
);

// ═══════════════════════════════════════════════════════════════════════════════
// AYU - Warm Minimal
// ═══════════════════════════════════════════════════════════════════════════════
const ayuDarkTheme = OpenCodeTheme(
  primary: Color(0xFF59C2FF),
  secondary: Color(0xFFD2A6FF),
  accent: Color(0xFFE6B450),
  error: Color(0xFFD95757),
  warning: Color(0xFFE6B673),
  success: Color(0xFF7FD962),
  info: Color(0xFF39BAE6),
  text: Color(0xFFBFBDB6),
  textMuted: Color(0xFF565B66),
  selectedListItemText: Color(0xFF0B0E14),
  background: Color(0xFF0B0E14),
  backgroundPanel: Color(0xFF0F131A),
  backgroundElement: Color(0xFF0D1017),
  backgroundMenu: Color(0xFF0D1017),
  bgDeep: Color(0xFF05080c),
  bgRaised: Color(0xFF0B0E14),
  bgHover: Color(0xFF0F131A),
  bgActive: Color(0xFF151920),
  bgHighlight: Color(0xFF1c2128),
  bgOverlay: Color(0xFF252930),
  bgContrast: Color(0xFF2e3238),
  border: Color(0xFF6C7380),
  borderActive: Color(0xFF6C7380),
  borderSubtle: Color(0xFF11151C),
  toolThinking: Color(0xFF59C2FF), // Blue
  toolEdit: Color(0xFFFFB454), // Orange
  toolRead: Color(0xFF39BAE6), // Cyan
  toolWrite: Color(0xFF7FD962), // Green
  toolBash: Color(0xFF565B66), // Gray
  toolSearch: Color(0xFF59C2FF), // Blue
  toolTodo: Color(0xFFE6B673), // Yellow
  toolSubtask: Color(0xFF39BAE6), // Cyan
  diffAdded: Color(0xFF7FD962),
  diffRemoved: Color(0xFFF26D78),
  diffContext: Color(0xFFACB6BF),
  diffHunkHeader: Color(0xFFACB6BF),
  diffHighlightAdded: Color(0xFFAAD94C),
  diffHighlightRemoved: Color(0xFFF07178),
  diffAddedBg: Color(0xFF20303b),
  diffRemovedBg: Color(0xFF37222c),
  diffContextBg: Color(0xFF0F131A),
  diffLineNumber: Color(0xFF6C7380),
  diffAddedLineNumberBg: Color(0xFF1b2b34),
  diffRemovedLineNumberBg: Color(0xFF2d1f26),
  markdownText: Color(0xFFBFBDB6),
  markdownHeading: Color(0xFFD2A6FF),
  markdownLink: Color(0xFF59C2FF),
  markdownLinkText: Color(0xFF39BAE6),
  markdownCode: Color(0xFFAAD94C),
  markdownBlockQuote: Color(0xFFE6B673),
  markdownEmph: Color(0xFFE6B673),
  markdownStrong: Color(0xFFFFB454),
  markdownHorizontalRule: Color(0xFF565B66),
  markdownListItem: Color(0xFF59C2FF),
  markdownListEnumeration: Color(0xFF39BAE6),
  markdownImage: Color(0xFF59C2FF),
  markdownImageText: Color(0xFF39BAE6),
  markdownCodeBlock: Color(0xFFBFBDB6),
  syntaxComment: Color(0xFFACB6BF),
  syntaxKeyword: Color(0xFFFF8F40),
  syntaxFunction: Color(0xFFFFB454),
  syntaxVariable: Color(0xFF59C2FF),
  syntaxString: Color(0xFFAAD94C),
  syntaxNumber: Color(0xFFD2A6FF),
  syntaxType: Color(0xFFE6B673),
  syntaxOperator: Color(0xFFF29668),
  syntaxPunctuation: Color(0xFFBFBDB6),
);

// ═══════════════════════════════════════════════════════════════════════════════
// ORNG - Bold Orange
// ═══════════════════════════════════════════════════════════════════════════════
const orngDarkTheme = OpenCodeTheme(
  primary: Color(0xFFEC5B2B),
  secondary: Color(0xFFEE7948),
  accent: Color(0xFFFFF7F1),
  error: Color(0xFFe06c75),
  warning: Color(0xFFEC5B2B),
  success: Color(0xFF6ba1e6),
  info: Color(0xFF56b6c2),
  text: Color(0xFFeeeeee),
  textMuted: Color(0xFF808080),
  selectedListItemText: Color(0xFF0a0a0a),
  background: Color(0xFF0a0a0a),
  backgroundPanel: Color(0xFF141414),
  backgroundElement: Color(0xFF1e1e1e),
  backgroundMenu: Color(0xFF1e1e1e),
  bgDeep: Color(0xFF050505),
  bgRaised: Color(0xFF0a0a0a),
  bgHover: Color(0xFF141414),
  bgActive: Color(0xFF1e1e1e),
  bgHighlight: Color(0xFF282828),
  bgOverlay: Color(0xFF323232),
  bgContrast: Color(0xFF3c3c3c),
  border: Color(0xFFEC5B2B),
  borderActive: Color(0xFFEE7948),
  borderSubtle: Color(0xFF3c3c3c),
  toolThinking: Color(0xFF56b6c2), // Cyan
  toolEdit: Color(0xFFEC5B2B), // Orange
  toolRead: Color(0xFF56b6c2), // Cyan
  toolWrite: Color(0xFF6ba1e6), // Blue
  toolBash: Color(0xFF808080), // Gray
  toolSearch: Color(0xFF56b6c2), // Cyan
  toolTodo: Color(0xFFEE7948), // Orange light
  toolSubtask: Color(0xFF56b6c2), // Cyan
  diffAdded: Color(0xFF6ba1e6),
  diffRemoved: Color(0xFFc53b53),
  diffContext: Color(0xFF828bb8),
  diffHunkHeader: Color(0xFF828bb8),
  diffHighlightAdded: Color(0xFF6ba1e6),
  diffHighlightRemoved: Color(0xFFe26a75),
  diffAddedBg: Color(0xFF1a2a3d),
  diffRemovedBg: Color(0xFF37222c),
  diffContextBg: Color(0xFF141414),
  diffLineNumber: Color(0xFF1e1e1e),
  diffAddedLineNumberBg: Color(0xFF162535),
  diffRemovedLineNumberBg: Color(0xFF2d1f26),
  markdownText: Color(0xFFeeeeee),
  markdownHeading: Color(0xFFEC5B2B),
  markdownLink: Color(0xFFEC5B2B),
  markdownLinkText: Color(0xFF56b6c2),
  markdownCode: Color(0xFF6ba1e6),
  markdownBlockQuote: Color(0xFFFFF7F1),
  markdownEmph: Color(0xFFe5c07b),
  markdownStrong: Color(0xFFEE7948),
  markdownHorizontalRule: Color(0xFF808080),
  markdownListItem: Color(0xFFEC5B2B),
  markdownListEnumeration: Color(0xFF56b6c2),
  markdownImage: Color(0xFFEC5B2B),
  markdownImageText: Color(0xFF56b6c2),
  markdownCodeBlock: Color(0xFFeeeeee),
  syntaxComment: Color(0xFF808080),
  syntaxKeyword: Color(0xFFEC5B2B),
  syntaxFunction: Color(0xFFEE7948),
  syntaxVariable: Color(0xFFe06c75),
  syntaxString: Color(0xFF6ba1e6),
  syntaxNumber: Color(0xFFFFF7F1),
  syntaxType: Color(0xFFe5c07b),
  syntaxOperator: Color(0xFF56b6c2),
  syntaxPunctuation: Color(0xFFeeeeee),
);

// ═══════════════════════════════════════════════════════════════════════════════
// LUCENT ORNG - Transparent Orange
// ═══════════════════════════════════════════════════════════════════════════════
const lucentOrngDarkTheme = OpenCodeTheme(
  primary: Color(0xFFEC5B2B),
  secondary: Color(0xFFEE7948),
  accent: Color(0xFFFFF7F1),
  error: Color(0xFFe06c75),
  warning: Color(0xFFEC5B2B),
  success: Color(0xFF6ba1e6),
  info: Color(0xFF56b6c2),
  text: Color(0xFFeeeeee),
  textMuted: Color(0xFF808080),
  selectedListItemText: Color(0xFF0a0a0a),
  background: Color(0x00000000),
  backgroundPanel: Color(0x00000000),
  backgroundElement: Color(0x00000000),
  backgroundMenu: Color(0x00000000),
  bgDeep: Color(0x00000000),
  bgRaised: Color(0x00000000),
  bgHover: Color(0x10ffffff),
  bgActive: Color(0x20ffffff),
  bgHighlight: Color(0x30ffffff),
  bgOverlay: Color(0x40ffffff),
  bgContrast: Color(0x50ffffff),
  border: Color(0xFFEC5B2B),
  borderActive: Color(0xFFEE7948),
  borderSubtle: Color(0xFF3c3c3c),
  toolThinking: Color(0xFF56b6c2), // Cyan
  toolEdit: Color(0xFFEC5B2B), // Orange
  toolRead: Color(0xFF56b6c2), // Cyan
  toolWrite: Color(0xFF6ba1e6), // Blue
  toolBash: Color(0xFF808080), // Gray
  toolSearch: Color(0xFF56b6c2), // Cyan
  toolTodo: Color(0xFFEE7948), // Orange light
  toolSubtask: Color(0xFF56b6c2), // Cyan
  diffAdded: Color(0xFF6ba1e6),
  diffRemoved: Color(0xFFc53b53),
  diffContext: Color(0xFF828bb8),
  diffHunkHeader: Color(0xFF828bb8),
  diffHighlightAdded: Color(0xFF6ba1e6),
  diffHighlightRemoved: Color(0xFFe26a75),
  diffAddedBg: Color(0x00000000),
  diffRemovedBg: Color(0x00000000),
  diffContextBg: Color(0x00000000),
  diffLineNumber: Color(0xFF666666),
  diffAddedLineNumberBg: Color(0x00000000),
  diffRemovedLineNumberBg: Color(0x00000000),
  markdownText: Color(0xFFeeeeee),
  markdownHeading: Color(0xFFEC5B2B),
  markdownLink: Color(0xFFEC5B2B),
  markdownLinkText: Color(0xFF56b6c2),
  markdownCode: Color(0xFF6ba1e6),
  markdownBlockQuote: Color(0xFFFFF7F1),
  markdownEmph: Color(0xFFe5c07b),
  markdownStrong: Color(0xFFEE7948),
  markdownHorizontalRule: Color(0xFF808080),
  markdownListItem: Color(0xFFEC5B2B),
  markdownListEnumeration: Color(0xFF56b6c2),
  markdownImage: Color(0xFFEC5B2B),
  markdownImageText: Color(0xFF56b6c2),
  markdownCodeBlock: Color(0xFFeeeeee),
  syntaxComment: Color(0xFF808080),
  syntaxKeyword: Color(0xFFEC5B2B),
  syntaxFunction: Color(0xFFEE7948),
  syntaxVariable: Color(0xFFe06c75),
  syntaxString: Color(0xFF6ba1e6),
  syntaxNumber: Color(0xFFFFF7F1),
  syntaxType: Color(0xFFe5c07b),
  syntaxOperator: Color(0xFF56b6c2),
  syntaxPunctuation: Color(0xFFeeeeee),
);

// ═══════════════════════════════════════════════════════════════════════════════
// ALL THEMES - Export List
// ═══════════════════════════════════════════════════════════════════════════════
final allThemes = <ThemeInfo>[
  ThemeInfo(
    id: 'opencode',
    name: 'OpenCode',
    theme: opencodeDarkTheme,
    description: 'Warm peach, professional',
  ),
  ThemeInfo(
    id: 'opencode-light',
    name: 'OpenCode Light',
    theme: opencodeLightTheme,
    description: 'Clean, eye-friendly light',
    isLight: true,
  ),
  ThemeInfo(
    id: 'tokyonight',
    name: 'Tokyo Night',
    theme: tokyonightDarkTheme,
    description: 'Cool blue, modern',
  ),
  ThemeInfo(
    id: 'dracula',
    name: 'Dracula',
    theme: draculaDarkTheme,
    description: 'Classic purple',
  ),
  ThemeInfo(
    id: 'catppuccin',
    name: 'Catppuccin',
    theme: catppuccinDarkTheme,
    description: 'Soft pastel',
  ),
  ThemeInfo(
    id: 'nord',
    name: 'Nord',
    theme: nordDarkTheme,
    description: 'Arctic frost',
  ),
  ThemeInfo(
    id: 'gruvbox',
    name: 'Gruvbox',
    theme: gruvboxDarkTheme,
    description: 'Retro warm',
  ),
  ThemeInfo(
    id: 'aura',
    name: 'Aura',
    theme: auraDarkTheme,
    description: 'Vibrant purple',
  ),
  ThemeInfo(
    id: 'monokai',
    name: 'Monokai',
    theme: monokaiDarkTheme,
    description: 'Classic code',
  ),
  ThemeInfo(
    id: 'flexoki',
    name: 'Flexoki',
    theme: flexokiDarkTheme,
    description: 'Warm orange',
  ),
  ThemeInfo(
    id: 'one-dark',
    name: 'One Dark',
    theme: oneDarkTheme,
    description: 'Atom inspired',
  ),
  ThemeInfo(
    id: 'solarized',
    name: 'Solarized',
    theme: solarizedDarkTheme,
    description: 'Classic scheme',
  ),
  ThemeInfo(
    id: 'github',
    name: 'GitHub',
    theme: githubDarkTheme,
    description: 'GitHub style',
  ),
  ThemeInfo(
    id: 'matrix',
    name: 'Matrix',
    theme: matrixDarkTheme,
    description: 'Hacker green',
  ),
  ThemeInfo(
    id: 'synthwave84',
    name: 'Synthwave 84',
    theme: synthwave84DarkTheme,
    description: 'Retro neon',
  ),
  ThemeInfo(
    id: 'vesper',
    name: 'Vesper',
    theme: vesperDarkTheme,
    description: 'Minimal warm',
  ),
  ThemeInfo(
    id: 'rosepine',
    name: 'Rosé Pine',
    theme: rosepineDarkTheme,
    description: 'Elegant soft',
  ),
  ThemeInfo(
    id: 'vercel',
    name: 'Vercel',
    theme: vercelDarkTheme,
    description: 'Clean modern',
  ),
  ThemeInfo(
    id: 'cobalt2',
    name: 'Cobalt2',
    theme: cobalt2DarkTheme,
    description: 'High contrast',
  ),
  ThemeInfo(
    id: 'nightowl',
    name: 'Night Owl',
    theme: nightowlDarkTheme,
    description: 'Night coding',
  ),
  ThemeInfo(
    id: 'palenight',
    name: 'Palenight',
    theme: palenightDarkTheme,
    description: 'Soft purple',
  ),
  ThemeInfo(
    id: 'catppuccin-frappe',
    name: 'Catppuccin Frappé',
    theme: catppuccinFrappeDarkTheme,
    description: 'Muted pastel',
  ),
  ThemeInfo(
    id: 'catppuccin-macchiato',
    name: 'Catppuccin Macchiato',
    theme: catppuccinMacchiatoDarkTheme,
    description: 'Medium pastel',
  ),
  ThemeInfo(
    id: 'material',
    name: 'Material',
    theme: materialDarkTheme,
    description: 'Material design',
  ),
  ThemeInfo(
    id: 'everforest',
    name: 'Everforest',
    theme: everforestDarkTheme,
    description: 'Nature calm',
  ),
  ThemeInfo(
    id: 'kanagawa',
    name: 'Kanagawa',
    theme: kanagawaDarkTheme,
    description: 'Japanese aesthetic',
  ),
  ThemeInfo(
    id: 'zenburn',
    name: 'Zenburn',
    theme: zenburnDarkTheme,
    description: 'Low contrast',
  ),
  ThemeInfo(
    id: 'mercury',
    name: 'Mercury',
    theme: mercuryDarkTheme,
    description: 'Clean purple',
  ),
  ThemeInfo(
    id: 'cursor',
    name: 'Cursor',
    theme: cursorDarkTheme,
    description: 'Cursor inspired',
  ),
  ThemeInfo(
    id: 'ayu',
    name: 'Ayu',
    theme: ayuDarkTheme,
    description: 'Warm minimal',
  ),
  ThemeInfo(
    id: 'orng',
    name: 'Orng',
    theme: orngDarkTheme,
    description: 'Bold orange',
  ),
  ThemeInfo(
    id: 'lucent-orng',
    name: 'Lucent Orng',
    theme: lucentOrngDarkTheme,
    description: 'Transparent orange',
  ),
];

/// Get a theme by its ID
OpenCodeTheme? getThemeById(String id) {
  final info = allThemes.where((t) => t.id == id).firstOrNull;
  return info?.theme;
}

/// Get theme info by ID
ThemeInfo? getThemeInfoById(String id) {
  return allThemes.where((t) => t.id == id).firstOrNull;
}

/// Default theme ID
const defaultThemeId = 'opencode';
