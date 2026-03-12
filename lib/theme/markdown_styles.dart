import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';

import 'app_typography.dart';
import 'design_tokens.dart';
import 'opencode_theme.dart';

/// Shared markdown style factories for consistent rendering across the app.
///
/// Two variants:
/// - [assistant] — full-size AI response in chat (15px body)
/// - [compact] — tool output, agent cards, nested content (14px body)
///
/// Both are tuned for mobile screens (320–414px):
/// - Tighter code block padding (12h × 10v vs desktop 16 × 16)
/// - Compact list indent (20px vs 24px) for readable nested lists
/// - Blockquote with vertical padding + italic muted text
/// - Heading scale with sufficient differentiation at mobile DPI
abstract final class MarkdownStyles {
  /// Full-size style for main AI assistant messages.
  static MarkdownStyleSheet assistant(OpenCodeTheme theme) {
    return MarkdownStyleSheet(
      // -- Paragraph --
      p: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 15,
        color: theme.markdownText,
        height: 1.6,
      ),

      // -- Headings — wider scale so h3 is distinguishable from body --
      h1: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 22,
        fontWeight: FontWeight.w700,
        color: theme.markdownHeading,
        height: 1.3,
      ),
      h2: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 19,
        fontWeight: FontWeight.w600,
        color: theme.markdownHeading,
        height: 1.35,
      ),
      h3: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 17,
        fontWeight: FontWeight.w600,
        color: theme.markdownHeading,
        height: 1.4,
      ),
      h1Padding: EdgeInsets.only(top: Spacing.xxl, bottom: Spacing.md),
      h2Padding: EdgeInsets.only(top: Spacing.xl, bottom: 10),
      h3Padding: EdgeInsets.only(top: Spacing.lg, bottom: Spacing.sm),

      // -- Inline formatting --
      strong: TextStyle(
        fontWeight: FontWeight.w600,
        color: theme.markdownStrong,
      ),
      em: TextStyle(fontStyle: FontStyle.italic, color: theme.markdownEmph),
      a: TextStyle(
        color: theme.markdownLink,
        decoration: TextDecoration.underline,
      ),

      // -- Inline code --
      code: AppTypography.codeLarge(color: theme.markdownCode)
          .copyWith(backgroundColor: theme.backgroundElement),

      // -- Code blocks — tighter padding for mobile --
      codeblockPadding:
          const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      codeblockDecoration: BoxDecoration(
        color: theme.backgroundElement,
        borderRadius: Radii.brMd,
        border: Border.all(color: theme.borderSubtle),
      ),

      // -- Lists — 20px indent saves 4px/level vs 24 --
      listBullet: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 15,
        color: theme.markdownListItem,
      ),
      listIndent: 20,

      // -- Blockquotes — vertical padding + distinct style --
      blockquote: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 15,
        color: theme.textMuted,
        fontStyle: FontStyle.italic,
        height: 1.6,
      ),
      blockquotePadding:
          const EdgeInsets.only(left: 16, top: 8, bottom: 8),
      blockquoteDecoration: BoxDecoration(
        border: Border(
          left: BorderSide(color: theme.markdownBlockQuote, width: 3),
        ),
      ),

      // -- Horizontal rule --
      horizontalRuleDecoration: BoxDecoration(
        border:
            Border(top: BorderSide(color: theme.dividerSection, width: 1)),
      ),

      // -- Tables (fallback — AdaptiveTable handles most tables) --
      tableHead: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 14,
        fontWeight: FontWeight.w600,
        color: theme.text,
      ),
      tableBody: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 14,
        color: theme.text,
      ),
      tableBorder: TableBorder.all(color: theme.borderSubtle, width: 1),
      tableCellsPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),

      // -- Block spacing --
      blockSpacing: Spacing.lg,
    );
  }

  /// Compact style for tool output, agent cards, and nested content.
  static MarkdownStyleSheet compact(OpenCodeTheme theme) {
    return MarkdownStyleSheet(
      // -- Paragraph --
      p: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 14,
        color: theme.text,
        height: 1.5,
      ),

      // -- Headings --
      h1: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 18,
        fontWeight: FontWeight.w600,
        color: theme.text,
        height: 1.4,
      ),
      h2: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 16,
        fontWeight: FontWeight.w600,
        color: theme.text,
        height: 1.4,
      ),
      h3: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 15,
        fontWeight: FontWeight.w600,
        color: theme.text,
        height: 1.4,
      ),
      h1Padding: EdgeInsets.only(top: Spacing.lg, bottom: Spacing.sm),
      h2Padding: EdgeInsets.only(top: Spacing.md, bottom: Spacing.xs),
      h3Padding: EdgeInsets.only(top: Spacing.sm, bottom: Spacing.xs),

      // -- Inline formatting --
      strong: TextStyle(fontWeight: FontWeight.w600, color: theme.text),
      em: TextStyle(fontStyle: FontStyle.italic, color: theme.textMuted),
      a: TextStyle(
        color: theme.markdownLink,
        decoration: TextDecoration.underline,
      ),

      // -- Inline code — 13px (readable) instead of 11px --
      code: AppTypography.code(color: theme.accent)
          .copyWith(backgroundColor: theme.backgroundElement),

      // -- Code blocks --
      codeblockPadding:
          const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      codeblockDecoration: BoxDecoration(
        color: theme.backgroundElement,
        borderRadius: Radii.brSm,
        border: Border.all(color: theme.borderSubtle),
      ),

      // -- Lists --
      listBullet: TextStyle(color: theme.textMuted),
      listIndent: 20,

      // -- Blockquotes --
      blockquote: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 14,
        color: theme.textMuted,
        fontStyle: FontStyle.italic,
        height: 1.5,
      ),
      blockquotePadding:
          const EdgeInsets.only(left: 12, top: 6, bottom: 6),
      blockquoteDecoration: BoxDecoration(
        border: Border(
          left: BorderSide(color: theme.borderSubtle, width: 3),
        ),
      ),

      // -- Tables (fallback) --
      tableHead: TextStyle(fontWeight: FontWeight.w600, color: theme.text),
      tableBody: TextStyle(color: theme.text),
      tableBorder: TableBorder.all(color: theme.borderSubtle, width: 1),
      tableCellsPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
    );
  }
}
