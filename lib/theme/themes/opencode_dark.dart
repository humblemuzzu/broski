import 'package:flutter/material.dart';
import '../opencode_theme.dart';

/// The default OpenCode theme - warm peach accent on dark background.
///
/// This theme matches the official OpenCode CLI default theme exactly,
/// providing visual consistency between the mobile app and CLI.
///
/// Color values sourced from:
/// - docs/mvp/Design/OPENCODE_BRANDING_DESIGN_SYSTEM.md
/// - OpenCode packages/opencode/src/cli/cmd/tui/context/theme/opencode.json
const opencodeDark = OpenCodeTheme(
  // ═══════════════════════════════════════════════════════════════════════════
  // Core colors - OpenCode's warm peach primary
  // ═══════════════════════════════════════════════════════════════════════════
  primary: Color(0xFFfab283), // Warm Peach
  secondary: Color(0xFF5c9cf5), // Blue
  accent: Color(0xFF9d7cd8), // Purple
  error: Color(0xFFe06c75), // Coral Red
  warning: Color(0xFFf5a742), // Orange
  success: Color(0xFF7fd88f), // Green
  info: Color(0xFF56b6c2), // Cyan
  // ═══════════════════════════════════════════════════════════════════════════
  // Text colors - OpenCode's gray scale
  // ═══════════════════════════════════════════════════════════════════════════
  text: Color(0xFFeeeeee), // Light Gray
  textMuted: Color(0xFF808080), // Gray
  selectedListItemText: Color(0xFF0a0a0a), // Near Black (contrast on primary)
  // ═══════════════════════════════════════════════════════════════════════════
  // Background colors - OpenCode's dark gray scale
  // ═══════════════════════════════════════════════════════════════════════════
  background: Color(0xFF0a0a0a), // Near Black (darkStep1)
  backgroundPanel: Color(0xFF141414), // Dark Gray (darkStep2)
  backgroundElement: Color(0xFF1e1e1e), // Darker Gray (darkStep3)
  backgroundMenu: Color(0xFF1e1e1e), // Same as element
  // ═══════════════════════════════════════════════════════════════════════════
  // Border colors - OpenCode's border scale
  // ═══════════════════════════════════════════════════════════════════════════
  border: Color(0xFF484848), // Medium Gray (darkStep7)
  borderActive: Color(0xFF606060), // Light Gray (darkStep8)
  borderSubtle: Color(0xFF3c3c3c), // Dark Gray (darkStep6)
  // ═══════════════════════════════════════════════════════════════════════════
  // Diff colors - OpenCode's diff color scheme
  // ═══════════════════════════════════════════════════════════════════════════
  diffAdded: Color(0xFF4fd6be), // Teal-green for additions
  diffRemoved: Color(0xFFc53b53), // Red for removals
  diffContext: Color(0xFF828bb8), // Muted blue-gray for context
  diffHunkHeader: Color(0xFF828bb8), // Same as context
  diffHighlightAdded: Color(0xFFb8db87), // Lighter green
  diffHighlightRemoved: Color(0xFFe26a75), // Lighter red
  diffAddedBg: Color(0xFF20303b), // Dark teal background
  diffRemovedBg: Color(0xFF37222c), // Dark red background
  diffContextBg: Color(0xFF141414), // Same as panel
  diffLineNumber: Color(0xFF1e1e1e), // Element background
  diffAddedLineNumberBg: Color(0xFF1b2b34), // Darker teal
  diffRemovedLineNumberBg: Color(0xFF2d1f26), // Darker red
  // ═══════════════════════════════════════════════════════════════════════════
  // Markdown colors
  // ═══════════════════════════════════════════════════════════════════════════
  markdownText: Color(0xFFeeeeee), // text
  markdownHeading: Color(0xFF9d7cd8), // accent
  markdownLink: Color(0xFFfab283), // primary
  markdownLinkText: Color(0xFF56b6c2), // cyan
  markdownCode: Color(0xFF7fd88f), // green
  markdownBlockQuote: Color(0xFFe5c07b), // yellow
  markdownEmph: Color(0xFFe5c07b), // yellow
  markdownStrong: Color(0xFFf5a742), // orange
  markdownHorizontalRule: Color(0xFF808080), // textMuted
  markdownListItem: Color(0xFFfab283), // primary
  markdownListEnumeration: Color(0xFF56b6c2), // cyan
  markdownImage: Color(0xFFfab283), // primary
  markdownImageText: Color(0xFF56b6c2), // cyan
  markdownCodeBlock: Color(0xFFeeeeee), // text
  // ═══════════════════════════════════════════════════════════════════════════
  // Syntax highlighting colors
  // ═══════════════════════════════════════════════════════════════════════════
  syntaxComment: Color(0xFF808080), // textMuted
  syntaxKeyword: Color(0xFF9d7cd8), // accent
  syntaxFunction: Color(0xFFfab283), // primary
  syntaxVariable: Color(0xFFe06c75), // red
  syntaxString: Color(0xFF7fd88f), // green
  syntaxNumber: Color(0xFFf5a742), // orange
  syntaxType: Color(0xFFe5c07b), // yellow
  syntaxOperator: Color(0xFF56b6c2), // cyan
  syntaxPunctuation: Color(0xFFeeeeee), // text
);

/// Slightly adjusted theme for mobile that uses the same colors but with
/// very subtle adjustments for mobile screens (deeper blacks, slightly
/// higher contrast for outdoor visibility).
const opencodeMobileDark = OpenCodeTheme(
  // Same core colors as opencodeDark
  primary: Color(0xFFfab283),
  secondary: Color(0xFF5c9cf5),
  accent: Color(0xFF9d7cd8),
  error: Color(0xFFe06c75),
  warning: Color(0xFFf5a742),
  success: Color(0xFF7fd88f),
  info: Color(0xFF56b6c2),

  // Slightly brighter text for mobile visibility
  text: Color(0xFFF0F0F0),
  textMuted: Color(0xFF888888),
  selectedListItemText: Color(0xFF0a0a0a),

  // Slightly deeper backgrounds for true blacks on OLED
  background: Color(0xFF000000), // Pure black for OLED
  backgroundPanel: Color(0xFF121212), // Slightly lighter
  backgroundElement: Color(0xFF1a1a1a), // Element
  backgroundMenu: Color(0xFF1a1a1a),

  // Same borders
  border: Color(0xFF484848),
  borderActive: Color(0xFF606060),
  borderSubtle: Color(0xFF3c3c3c),

  // Same diff colors
  diffAdded: Color(0xFF4fd6be),
  diffRemoved: Color(0xFFc53b53),
  diffContext: Color(0xFF828bb8),
  diffHunkHeader: Color(0xFF828bb8),
  diffHighlightAdded: Color(0xFFb8db87),
  diffHighlightRemoved: Color(0xFFe26a75),
  diffAddedBg: Color(0xFF20303b),
  diffRemovedBg: Color(0xFF37222c),
  diffContextBg: Color(0xFF121212),
  diffLineNumber: Color(0xFF1a1a1a),
  diffAddedLineNumberBg: Color(0xFF1b2b34),
  diffRemovedLineNumberBg: Color(0xFF2d1f26),

  // Same markdown colors
  markdownText: Color(0xFFF0F0F0),
  markdownHeading: Color(0xFF9d7cd8),
  markdownLink: Color(0xFFfab283),
  markdownLinkText: Color(0xFF56b6c2),
  markdownCode: Color(0xFF7fd88f),
  markdownBlockQuote: Color(0xFFe5c07b),
  markdownEmph: Color(0xFFe5c07b),
  markdownStrong: Color(0xFFf5a742),
  markdownHorizontalRule: Color(0xFF888888),
  markdownListItem: Color(0xFFfab283),
  markdownListEnumeration: Color(0xFF56b6c2),
  markdownImage: Color(0xFFfab283),
  markdownImageText: Color(0xFF56b6c2),
  markdownCodeBlock: Color(0xFFF0F0F0),

  // Same syntax colors
  syntaxComment: Color(0xFF888888),
  syntaxKeyword: Color(0xFF9d7cd8),
  syntaxFunction: Color(0xFFfab283),
  syntaxVariable: Color(0xFFe06c75),
  syntaxString: Color(0xFF7fd88f),
  syntaxNumber: Color(0xFFf5a742),
  syntaxType: Color(0xFFe5c07b),
  syntaxOperator: Color(0xFF56b6c2),
  syntaxPunctuation: Color(0xFFF0F0F0),
);
