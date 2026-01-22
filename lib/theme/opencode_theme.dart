import 'package:flutter/material.dart';

/// OpenCode-compatible theme colors.
///
/// This class provides ALL semantic color tokens used by OpenCode.
/// Use `OpenCodeTheme.of(context)` to access theme-aware colors.
///
/// Tokens are organized into categories:
/// - Core: primary, secondary, accent, error, warning, success, info
/// - Text: text, textMuted, selectedListItemText
/// - Background: background, backgroundPanel, backgroundElement, backgroundMenu
/// - Extended BG: bgDeep, bgRaised, bgHover, bgActive, bgHighlight, bgOverlay, bgContrast
/// - Border: border, borderActive, borderSubtle
/// - Tool: toolThinking, toolEdit, toolRead, toolWrite, toolBash, toolSearch, toolTodo, toolSubtask
/// - Diff: 12 tokens for diff viewer colors
/// - Markdown: 14 tokens for markdown rendering
/// - Syntax: 9 tokens for syntax highlighting
class OpenCodeTheme extends ThemeExtension<OpenCodeTheme> {
  const OpenCodeTheme({
    // Core colors
    required this.primary,
    required this.secondary,
    required this.accent,
    required this.error,
    required this.warning,
    required this.success,
    required this.info,
    // Text colors
    required this.text,
    required this.textMuted,
    required this.selectedListItemText,
    // Background colors
    required this.background,
    required this.backgroundPanel,
    required this.backgroundElement,
    required this.backgroundMenu,
    // Extended background scale (10 shades for better readability)
    required this.bgDeep,
    required this.bgRaised,
    required this.bgSheet,
    required this.bgHover,
    required this.bgActive,
    required this.bgHighlight,
    required this.bgOverlay,
    required this.bgContrast,
    // Border colors
    required this.border,
    required this.borderActive,
    required this.borderSubtle,
    required this.cardBorderSubtle,
    required this.dividerSection,
    // Tool-specific accent colors (distinct per tool type)
    required this.toolThinking,
    required this.toolEdit,
    required this.toolRead,
    required this.toolWrite,
    required this.toolBash,
    required this.toolSearch,
    required this.toolTodo,
    required this.toolSubtask,
    // Diff colors
    required this.diffAdded,
    required this.diffRemoved,
    required this.diffContext,
    required this.diffHunkHeader,
    required this.diffHighlightAdded,
    required this.diffHighlightRemoved,
    required this.diffAddedBg,
    required this.diffRemovedBg,
    required this.diffContextBg,
    required this.diffLineNumber,
    required this.diffAddedLineNumberBg,
    required this.diffRemovedLineNumberBg,
    // Markdown colors
    required this.markdownText,
    required this.markdownHeading,
    required this.markdownLink,
    required this.markdownLinkText,
    required this.markdownCode,
    required this.markdownBlockQuote,
    required this.markdownEmph,
    required this.markdownStrong,
    required this.markdownHorizontalRule,
    required this.markdownListItem,
    required this.markdownListEnumeration,
    required this.markdownImage,
    required this.markdownImageText,
    required this.markdownCodeBlock,
    // Syntax highlighting
    required this.syntaxComment,
    required this.syntaxKeyword,
    required this.syntaxFunction,
    required this.syntaxVariable,
    required this.syntaxString,
    required this.syntaxNumber,
    required this.syntaxType,
    required this.syntaxOperator,
    required this.syntaxPunctuation,
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Core colors
  // ═══════════════════════════════════════════════════════════════════════════

  /// Main accent color - links, highlights, user actions
  final Color primary;

  /// Secondary accent - badges, secondary buttons
  final Color secondary;

  /// Special emphasis - agent colors, special highlights
  final Color accent;

  /// Error states - failures, removals
  final Color error;

  /// Warning states - cautions, pending
  final Color warning;

  /// Success states - completions, additions
  final Color success;

  /// Info states - links, help, running
  final Color info;

  // ═══════════════════════════════════════════════════════════════════════════
  // Text colors
  // ═══════════════════════════════════════════════════════════════════════════

  /// Primary text - headings, body
  final Color text;

  /// Secondary text - timestamps, hints, comments
  final Color textMuted;

  /// Text on selected/highlighted items
  final Color selectedListItemText;

  // ═══════════════════════════════════════════════════════════════════════════
  // Background colors
  // ═══════════════════════════════════════════════════════════════════════════

  /// Main app background (darkest)
  final Color background;

  /// Panel/card backgrounds (slightly lighter)
  final Color backgroundPanel;

  /// Element backgrounds (input fields, code blocks)
  final Color backgroundElement;

  /// Menu/dropdown backgrounds
  final Color backgroundMenu;

  // ═══════════════════════════════════════════════════════════════════════════
  // Extended background scale (for better readability)
  // ═══════════════════════════════════════════════════════════════════════════

  /// Deepest background - modal overlays, deepest layer
  final Color bgDeep;

  /// Slightly raised from base - message area, content regions
  final Color bgRaised;

  /// Sheet/modal background
  final Color bgSheet;

  /// Hover state background
  final Color bgHover;

  /// Active/pressed state background
  final Color bgActive;

  /// Selected/highlighted items background
  final Color bgHighlight;

  /// Tooltips, popovers background
  final Color bgOverlay;

  /// High contrast elements
  final Color bgContrast;

  // ═══════════════════════════════════════════════════════════════════════════
  // Border colors
  // ═══════════════════════════════════════════════════════════════════════════

  /// Default borders
  final Color border;

  /// Active/focused borders
  final Color borderActive;

  /// Subtle/divider borders
  final Color borderSubtle;

  /// Very subtle border for compact cards (lower opacity than borderSubtle)
  final Color cardBorderSubtle;

  /// Subtle divider between markdown sections
  final Color dividerSection;

  // ═══════════════════════════════════════════════════════════════════════════
  // Tool-specific accent colors
  // ═══════════════════════════════════════════════════════════════════════════

  /// Thinking/reasoning - blue (cognitive, analytical)
  final Color toolThinking;

  /// Edit/patch operations - amber/orange (modification)
  final Color toolEdit;

  /// Read operations - cyan/teal (information retrieval)
  final Color toolRead;

  /// Write operations - green (creation)
  final Color toolWrite;

  /// Bash/shell commands - slate/steel (system)
  final Color toolBash;

  /// Search/glob operations - sky blue (discovery)
  final Color toolSearch;

  /// Todo items - coral/orange (task management)
  final Color toolTodo;

  /// Subtask/delegation - teal (delegated work)
  final Color toolSubtask;

  // ═══════════════════════════════════════════════════════════════════════════
  // Diff colors
  // ═══════════════════════════════════════════════════════════════════════════

  /// Added line text color (green)
  final Color diffAdded;

  /// Removed line text color (red)
  final Color diffRemoved;

  /// Context line text color
  final Color diffContext;

  /// Hunk header text color
  final Color diffHunkHeader;

  /// Highlighted addition
  final Color diffHighlightAdded;

  /// Highlighted removal
  final Color diffHighlightRemoved;

  /// Added line background
  final Color diffAddedBg;

  /// Removed line background
  final Color diffRemovedBg;

  /// Context line background
  final Color diffContextBg;

  /// Line number text color
  final Color diffLineNumber;

  /// Added line number background
  final Color diffAddedLineNumberBg;

  /// Removed line number background
  final Color diffRemovedLineNumberBg;

  // ═══════════════════════════════════════════════════════════════════════════
  // Markdown colors
  // ═══════════════════════════════════════════════════════════════════════════

  final Color markdownText;
  final Color markdownHeading;
  final Color markdownLink;
  final Color markdownLinkText;
  final Color markdownCode;
  final Color markdownBlockQuote;
  final Color markdownEmph;
  final Color markdownStrong;
  final Color markdownHorizontalRule;
  final Color markdownListItem;
  final Color markdownListEnumeration;
  final Color markdownImage;
  final Color markdownImageText;
  final Color markdownCodeBlock;

  // ═══════════════════════════════════════════════════════════════════════════
  // Syntax highlighting colors
  // ═══════════════════════════════════════════════════════════════════════════

  final Color syntaxComment;
  final Color syntaxKeyword;
  final Color syntaxFunction;
  final Color syntaxVariable;
  final Color syntaxString;
  final Color syntaxNumber;
  final Color syntaxType;
  final Color syntaxOperator;
  final Color syntaxPunctuation;

  // ═══════════════════════════════════════════════════════════════════════════
  // Theme access helpers
  // ═══════════════════════════════════════════════════════════════════════════

  /// Get the OpenCode theme from the current context.
  static OpenCodeTheme of(BuildContext context) {
    final theme = Theme.of(context).extension<OpenCodeTheme>();
    if (theme == null) {
      throw Exception(
        'OpenCodeTheme not found in context. '
        'Make sure to wrap your app with a theme that includes OpenCodeTheme.',
      );
    }
    return theme;
  }

  /// Try to get the OpenCode theme, returning null if not found.
  static OpenCodeTheme? maybeOf(BuildContext context) {
    return Theme.of(context).extension<OpenCodeTheme>();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ThemeExtension overrides
  // ═══════════════════════════════════════════════════════════════════════════

  @override
  OpenCodeTheme copyWith({
    // Core colors
    Color? primary,
    Color? secondary,
    Color? accent,
    Color? error,
    Color? warning,
    Color? success,
    Color? info,
    // Text colors
    Color? text,
    Color? textMuted,
    Color? selectedListItemText,
    // Background colors
    Color? background,
    Color? backgroundPanel,
    Color? backgroundElement,
    Color? backgroundMenu,
    // Extended background scale
    Color? bgDeep,
    Color? bgRaised,
    Color? bgSheet,
    Color? bgHover,
    Color? bgActive,
    Color? bgHighlight,
    Color? bgOverlay,
    Color? bgContrast,
    // Border colors
    Color? border,
    Color? borderActive,
    Color? borderSubtle,
    Color? cardBorderSubtle,
    Color? dividerSection,
    // Tool colors
    Color? toolThinking,
    Color? toolEdit,
    Color? toolRead,
    Color? toolWrite,
    Color? toolBash,
    Color? toolSearch,
    Color? toolTodo,
    Color? toolSubtask,
    // Diff colors
    Color? diffAdded,
    Color? diffRemoved,
    Color? diffContext,
    Color? diffHunkHeader,
    Color? diffHighlightAdded,
    Color? diffHighlightRemoved,
    Color? diffAddedBg,
    Color? diffRemovedBg,
    Color? diffContextBg,
    Color? diffLineNumber,
    Color? diffAddedLineNumberBg,
    Color? diffRemovedLineNumberBg,
    // Markdown colors
    Color? markdownText,
    Color? markdownHeading,
    Color? markdownLink,
    Color? markdownLinkText,
    Color? markdownCode,
    Color? markdownBlockQuote,
    Color? markdownEmph,
    Color? markdownStrong,
    Color? markdownHorizontalRule,
    Color? markdownListItem,
    Color? markdownListEnumeration,
    Color? markdownImage,
    Color? markdownImageText,
    Color? markdownCodeBlock,
    // Syntax highlighting
    Color? syntaxComment,
    Color? syntaxKeyword,
    Color? syntaxFunction,
    Color? syntaxVariable,
    Color? syntaxString,
    Color? syntaxNumber,
    Color? syntaxType,
    Color? syntaxOperator,
    Color? syntaxPunctuation,
  }) {
    return OpenCodeTheme(
      primary: primary ?? this.primary,
      secondary: secondary ?? this.secondary,
      accent: accent ?? this.accent,
      error: error ?? this.error,
      warning: warning ?? this.warning,
      success: success ?? this.success,
      info: info ?? this.info,
      text: text ?? this.text,
      textMuted: textMuted ?? this.textMuted,
      selectedListItemText: selectedListItemText ?? this.selectedListItemText,
      background: background ?? this.background,
      backgroundPanel: backgroundPanel ?? this.backgroundPanel,
      backgroundElement: backgroundElement ?? this.backgroundElement,
      backgroundMenu: backgroundMenu ?? this.backgroundMenu,
      bgDeep: bgDeep ?? this.bgDeep,
      bgRaised: bgRaised ?? this.bgRaised,
      bgSheet: bgSheet ?? this.bgSheet,
      bgHover: bgHover ?? this.bgHover,
      bgActive: bgActive ?? this.bgActive,
      bgHighlight: bgHighlight ?? this.bgHighlight,
      bgOverlay: bgOverlay ?? this.bgOverlay,
      bgContrast: bgContrast ?? this.bgContrast,
      border: border ?? this.border,
      borderActive: borderActive ?? this.borderActive,
      borderSubtle: borderSubtle ?? this.borderSubtle,
      cardBorderSubtle: cardBorderSubtle ?? this.cardBorderSubtle,
      dividerSection: dividerSection ?? this.dividerSection,
      toolThinking: toolThinking ?? this.toolThinking,
      toolEdit: toolEdit ?? this.toolEdit,
      toolRead: toolRead ?? this.toolRead,
      toolWrite: toolWrite ?? this.toolWrite,
      toolBash: toolBash ?? this.toolBash,
      toolSearch: toolSearch ?? this.toolSearch,
      toolTodo: toolTodo ?? this.toolTodo,
      toolSubtask: toolSubtask ?? this.toolSubtask,
      diffAdded: diffAdded ?? this.diffAdded,
      diffRemoved: diffRemoved ?? this.diffRemoved,
      diffContext: diffContext ?? this.diffContext,
      diffHunkHeader: diffHunkHeader ?? this.diffHunkHeader,
      diffHighlightAdded: diffHighlightAdded ?? this.diffHighlightAdded,
      diffHighlightRemoved: diffHighlightRemoved ?? this.diffHighlightRemoved,
      diffAddedBg: diffAddedBg ?? this.diffAddedBg,
      diffRemovedBg: diffRemovedBg ?? this.diffRemovedBg,
      diffContextBg: diffContextBg ?? this.diffContextBg,
      diffLineNumber: diffLineNumber ?? this.diffLineNumber,
      diffAddedLineNumberBg:
          diffAddedLineNumberBg ?? this.diffAddedLineNumberBg,
      diffRemovedLineNumberBg:
          diffRemovedLineNumberBg ?? this.diffRemovedLineNumberBg,
      markdownText: markdownText ?? this.markdownText,
      markdownHeading: markdownHeading ?? this.markdownHeading,
      markdownLink: markdownLink ?? this.markdownLink,
      markdownLinkText: markdownLinkText ?? this.markdownLinkText,
      markdownCode: markdownCode ?? this.markdownCode,
      markdownBlockQuote: markdownBlockQuote ?? this.markdownBlockQuote,
      markdownEmph: markdownEmph ?? this.markdownEmph,
      markdownStrong: markdownStrong ?? this.markdownStrong,
      markdownHorizontalRule:
          markdownHorizontalRule ?? this.markdownHorizontalRule,
      markdownListItem: markdownListItem ?? this.markdownListItem,
      markdownListEnumeration:
          markdownListEnumeration ?? this.markdownListEnumeration,
      markdownImage: markdownImage ?? this.markdownImage,
      markdownImageText: markdownImageText ?? this.markdownImageText,
      markdownCodeBlock: markdownCodeBlock ?? this.markdownCodeBlock,
      syntaxComment: syntaxComment ?? this.syntaxComment,
      syntaxKeyword: syntaxKeyword ?? this.syntaxKeyword,
      syntaxFunction: syntaxFunction ?? this.syntaxFunction,
      syntaxVariable: syntaxVariable ?? this.syntaxVariable,
      syntaxString: syntaxString ?? this.syntaxString,
      syntaxNumber: syntaxNumber ?? this.syntaxNumber,
      syntaxType: syntaxType ?? this.syntaxType,
      syntaxOperator: syntaxOperator ?? this.syntaxOperator,
      syntaxPunctuation: syntaxPunctuation ?? this.syntaxPunctuation,
    );
  }

  @override
  OpenCodeTheme lerp(ThemeExtension<OpenCodeTheme>? other, double t) {
    if (other is! OpenCodeTheme) return this;
    return OpenCodeTheme(
      primary: Color.lerp(primary, other.primary, t)!,
      secondary: Color.lerp(secondary, other.secondary, t)!,
      accent: Color.lerp(accent, other.accent, t)!,
      error: Color.lerp(error, other.error, t)!,
      warning: Color.lerp(warning, other.warning, t)!,
      success: Color.lerp(success, other.success, t)!,
      info: Color.lerp(info, other.info, t)!,
      text: Color.lerp(text, other.text, t)!,
      textMuted: Color.lerp(textMuted, other.textMuted, t)!,
      selectedListItemText: Color.lerp(
        selectedListItemText,
        other.selectedListItemText,
        t,
      )!,
      background: Color.lerp(background, other.background, t)!,
      backgroundPanel: Color.lerp(backgroundPanel, other.backgroundPanel, t)!,
      backgroundElement: Color.lerp(
        backgroundElement,
        other.backgroundElement,
        t,
      )!,
      backgroundMenu: Color.lerp(backgroundMenu, other.backgroundMenu, t)!,
      bgDeep: Color.lerp(bgDeep, other.bgDeep, t)!,
      bgRaised: Color.lerp(bgRaised, other.bgRaised, t)!,
      bgSheet: Color.lerp(bgSheet, other.bgSheet, t)!,
      bgHover: Color.lerp(bgHover, other.bgHover, t)!,
      bgActive: Color.lerp(bgActive, other.bgActive, t)!,
      bgHighlight: Color.lerp(bgHighlight, other.bgHighlight, t)!,
      bgOverlay: Color.lerp(bgOverlay, other.bgOverlay, t)!,
      bgContrast: Color.lerp(bgContrast, other.bgContrast, t)!,
      border: Color.lerp(border, other.border, t)!,
      borderActive: Color.lerp(borderActive, other.borderActive, t)!,
      borderSubtle: Color.lerp(borderSubtle, other.borderSubtle, t)!,
      cardBorderSubtle: Color.lerp(
        cardBorderSubtle,
        other.cardBorderSubtle,
        t,
      )!,
      dividerSection: Color.lerp(dividerSection, other.dividerSection, t)!,
      toolThinking: Color.lerp(toolThinking, other.toolThinking, t)!,
      toolEdit: Color.lerp(toolEdit, other.toolEdit, t)!,
      toolRead: Color.lerp(toolRead, other.toolRead, t)!,
      toolWrite: Color.lerp(toolWrite, other.toolWrite, t)!,
      toolBash: Color.lerp(toolBash, other.toolBash, t)!,
      toolSearch: Color.lerp(toolSearch, other.toolSearch, t)!,
      toolTodo: Color.lerp(toolTodo, other.toolTodo, t)!,
      toolSubtask: Color.lerp(toolSubtask, other.toolSubtask, t)!,
      diffAdded: Color.lerp(diffAdded, other.diffAdded, t)!,
      diffRemoved: Color.lerp(diffRemoved, other.diffRemoved, t)!,
      diffContext: Color.lerp(diffContext, other.diffContext, t)!,
      diffHunkHeader: Color.lerp(diffHunkHeader, other.diffHunkHeader, t)!,
      diffHighlightAdded: Color.lerp(
        diffHighlightAdded,
        other.diffHighlightAdded,
        t,
      )!,
      diffHighlightRemoved: Color.lerp(
        diffHighlightRemoved,
        other.diffHighlightRemoved,
        t,
      )!,
      diffAddedBg: Color.lerp(diffAddedBg, other.diffAddedBg, t)!,
      diffRemovedBg: Color.lerp(diffRemovedBg, other.diffRemovedBg, t)!,
      diffContextBg: Color.lerp(diffContextBg, other.diffContextBg, t)!,
      diffLineNumber: Color.lerp(diffLineNumber, other.diffLineNumber, t)!,
      diffAddedLineNumberBg: Color.lerp(
        diffAddedLineNumberBg,
        other.diffAddedLineNumberBg,
        t,
      )!,
      diffRemovedLineNumberBg: Color.lerp(
        diffRemovedLineNumberBg,
        other.diffRemovedLineNumberBg,
        t,
      )!,
      markdownText: Color.lerp(markdownText, other.markdownText, t)!,
      markdownHeading: Color.lerp(markdownHeading, other.markdownHeading, t)!,
      markdownLink: Color.lerp(markdownLink, other.markdownLink, t)!,
      markdownLinkText: Color.lerp(
        markdownLinkText,
        other.markdownLinkText,
        t,
      )!,
      markdownCode: Color.lerp(markdownCode, other.markdownCode, t)!,
      markdownBlockQuote: Color.lerp(
        markdownBlockQuote,
        other.markdownBlockQuote,
        t,
      )!,
      markdownEmph: Color.lerp(markdownEmph, other.markdownEmph, t)!,
      markdownStrong: Color.lerp(markdownStrong, other.markdownStrong, t)!,
      markdownHorizontalRule: Color.lerp(
        markdownHorizontalRule,
        other.markdownHorizontalRule,
        t,
      )!,
      markdownListItem: Color.lerp(
        markdownListItem,
        other.markdownListItem,
        t,
      )!,
      markdownListEnumeration: Color.lerp(
        markdownListEnumeration,
        other.markdownListEnumeration,
        t,
      )!,
      markdownImage: Color.lerp(markdownImage, other.markdownImage, t)!,
      markdownImageText: Color.lerp(
        markdownImageText,
        other.markdownImageText,
        t,
      )!,
      markdownCodeBlock: Color.lerp(
        markdownCodeBlock,
        other.markdownCodeBlock,
        t,
      )!,
      syntaxComment: Color.lerp(syntaxComment, other.syntaxComment, t)!,
      syntaxKeyword: Color.lerp(syntaxKeyword, other.syntaxKeyword, t)!,
      syntaxFunction: Color.lerp(syntaxFunction, other.syntaxFunction, t)!,
      syntaxVariable: Color.lerp(syntaxVariable, other.syntaxVariable, t)!,
      syntaxString: Color.lerp(syntaxString, other.syntaxString, t)!,
      syntaxNumber: Color.lerp(syntaxNumber, other.syntaxNumber, t)!,
      syntaxType: Color.lerp(syntaxType, other.syntaxType, t)!,
      syntaxOperator: Color.lerp(syntaxOperator, other.syntaxOperator, t)!,
      syntaxPunctuation: Color.lerp(
        syntaxPunctuation,
        other.syntaxPunctuation,
        t,
      )!,
    );
  }
}
