import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';

/// Shared markdown style factories for consistent rendering across the app.
///
/// Three variants:
/// - [assistant] — full-size AI response in chat (15px body)
/// - [compact] — tool output, agent cards, nested content (14px body)
/// - [fileViewer] — reading .md files, skill docs (15px body, larger headings)
///
/// All variants use the semantic `theme.markdown*` tokens so every surface
/// in the app renders with the theme's chosen color language.
///
/// Tuned for mobile screens (320–414px):
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
      h1Padding: const EdgeInsets.only(top: Spacing.xxl, bottom: Spacing.md),
      h2Padding: const EdgeInsets.only(top: Spacing.xl, bottom: 10),
      h3Padding: const EdgeInsets.only(top: Spacing.lg, bottom: Spacing.sm),

      // -- Inline formatting --
      strong: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontWeight: FontWeight.w600,
        color: theme.markdownStrong,
      ),
      em: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontStyle: FontStyle.italic,
        color: theme.markdownEmph,
      ),
      a: TextStyle(
        color: theme.markdownLink,
        decoration: TextDecoration.underline,
      ),

      // -- Inline code --
      code: AppTypography.codeLarge(
        color: theme.markdownCode,
      ).copyWith(backgroundColor: theme.backgroundElement),

      // -- Code blocks — tighter padding for mobile --
      codeblockPadding: const EdgeInsets.symmetric(
        horizontal: 12,
        vertical: 10,
      ),
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
      blockquotePadding: const EdgeInsets.only(left: 16, top: 8, bottom: 8),
      blockquoteDecoration: BoxDecoration(
        border: Border(
          left: BorderSide(color: theme.markdownBlockQuote, width: 3),
        ),
      ),

      // -- Horizontal rule --
      horizontalRuleDecoration: BoxDecoration(
        border: Border(top: BorderSide(color: theme.dividerSection, width: 1)),
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
  ///
  /// Uses the same semantic markdown color tokens as [assistant] so cards
  /// and tool results get the same rich formatting — just at a smaller
  /// scale (14px body vs 15px).
  static MarkdownStyleSheet compact(OpenCodeTheme theme) {
    return MarkdownStyleSheet(
      // -- Paragraph --
      p: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 14,
        color: theme.markdownText,
        height: 1.5,
      ),

      // -- Headings — same color tokens as assistant, smaller scale --
      h1: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 18,
        fontWeight: FontWeight.w600,
        color: theme.markdownHeading,
        height: 1.4,
      ),
      h2: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 16,
        fontWeight: FontWeight.w600,
        color: theme.markdownHeading,
        height: 1.4,
      ),
      h3: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 15,
        fontWeight: FontWeight.w600,
        color: theme.markdownHeading,
        height: 1.4,
      ),
      h1Padding: const EdgeInsets.only(top: Spacing.lg, bottom: Spacing.sm),
      h2Padding: const EdgeInsets.only(top: Spacing.md, bottom: Spacing.xs),
      h3Padding: const EdgeInsets.only(top: Spacing.sm, bottom: Spacing.xs),

      // -- Inline formatting — rich tokens, not flat white --
      strong: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontWeight: FontWeight.w600,
        color: theme.markdownStrong,
      ),
      em: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontStyle: FontStyle.italic,
        color: theme.markdownEmph,
      ),
      a: TextStyle(
        color: theme.markdownLink,
        decoration: TextDecoration.underline,
      ),

      // -- Inline code — 13px, uses markdownCode token --
      code: AppTypography.code(
        color: theme.markdownCode,
      ).copyWith(backgroundColor: theme.backgroundElement),

      // -- Code blocks --
      codeblockPadding: const EdgeInsets.symmetric(
        horizontal: 12,
        vertical: 10,
      ),
      codeblockDecoration: BoxDecoration(
        color: theme.backgroundElement,
        borderRadius: Radii.brSm,
        border: Border.all(color: theme.borderSubtle),
      ),

      // -- Lists — rich token --
      listBullet: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 14,
        color: theme.markdownListItem,
      ),
      listIndent: 20,

      // -- Blockquotes — rich token for left border --
      blockquote: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 14,
        color: theme.textMuted,
        fontStyle: FontStyle.italic,
        height: 1.5,
      ),
      blockquotePadding: const EdgeInsets.only(left: 12, top: 6, bottom: 6),
      blockquoteDecoration: BoxDecoration(
        border: Border(
          left: BorderSide(color: theme.markdownBlockQuote, width: 3),
        ),
      ),

      // -- Horizontal rule --
      horizontalRuleDecoration: BoxDecoration(
        border: Border(top: BorderSide(color: theme.dividerSection, width: 1)),
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
      blockSpacing: Spacing.md,
    );
  }

  /// File viewer / skill doc style — larger heading scale for reading
  /// documents, still uses semantic markdown tokens for color consistency.
  static MarkdownStyleSheet fileViewer(OpenCodeTheme theme) {
    return MarkdownStyleSheet(
      // -- Paragraph --
      p: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 15,
        color: theme.markdownText,
        height: 1.6,
      ),

      // -- Headings — larger scale for document reading --
      h1: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 28,
        fontWeight: FontWeight.w700,
        color: theme.markdownHeading,
        height: 1.3,
      ),
      h2: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 24,
        fontWeight: FontWeight.w600,
        color: theme.markdownHeading,
        height: 1.3,
      ),
      h3: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 20,
        fontWeight: FontWeight.w600,
        color: theme.markdownHeading,
        height: 1.4,
      ),
      h4: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 17,
        fontWeight: FontWeight.w600,
        color: theme.markdownHeading,
        height: 1.4,
      ),
      h5: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 15,
        fontWeight: FontWeight.w600,
        color: theme.markdownHeading,
        height: 1.4,
      ),
      h6: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 14,
        fontWeight: FontWeight.w600,
        color: theme.textMuted,
        height: 1.4,
      ),
      h1Padding: const EdgeInsets.only(top: Spacing.xxl, bottom: Spacing.lg),
      h2Padding: const EdgeInsets.only(top: Spacing.xl, bottom: Spacing.md),
      h3Padding: const EdgeInsets.only(top: Spacing.lg, bottom: Spacing.sm),

      // -- Inline formatting --
      strong: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontWeight: FontWeight.w600,
        color: theme.markdownStrong,
      ),
      em: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontStyle: FontStyle.italic,
        color: theme.markdownEmph,
      ),
      a: TextStyle(
        color: theme.markdownLink,
        decoration: TextDecoration.underline,
      ),

      // -- Inline code --
      code: AppTypography.code(
        color: theme.markdownCode,
      ).copyWith(backgroundColor: theme.backgroundPanel),

      // -- Code blocks --
      codeblockDecoration: BoxDecoration(
        color: theme.backgroundPanel,
        borderRadius: Radii.brSm,
        border: Border.all(color: theme.borderSubtle),
      ),
      codeblockPadding: Insets.cardSm,

      // -- Blockquotes --
      blockquote: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 15,
        color: theme.textMuted,
        fontStyle: FontStyle.italic,
        height: 1.6,
      ),
      blockquoteDecoration: BoxDecoration(
        border: Border(
          left: BorderSide(color: theme.markdownBlockQuote, width: 3),
        ),
      ),
      blockquotePadding: const EdgeInsets.only(left: 16, top: 8, bottom: 8),

      // -- Lists --
      listBullet: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 15,
        color: theme.markdownListItem,
      ),
      listIndent: 24,

      // -- Tables --
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
      tableHeadAlign: TextAlign.left,
      tableCellsPadding: const EdgeInsets.symmetric(
        horizontal: 12,
        vertical: 8,
      ),

      // -- Horizontal rule --
      horizontalRuleDecoration: BoxDecoration(
        border: Border(top: BorderSide(color: theme.dividerSection, width: 1)),
      ),

      // -- Block spacing --
      blockSpacing: Spacing.lg,
    );
  }
}
