import 'package:flutter/material.dart';

import '../../theme/app_typography.dart';
import '../../theme/opencode_theme.dart';

/// Lightweight inline markdown parser for streaming text.
///
/// Handles only bold, italic, inline code, and bold-italic — the three
/// highest-impact inline elements in AI responses. Produces a single
/// [TextSpan] tree suitable for [Text.rich], which renders in one
/// [RenderParagraph] — same performance tier as plain [Text].
///
/// Does NOT handle block-level elements (headings, lists, tables, code
/// blocks, blockquotes). Those require widget-level layout and are handled
/// by [AdaptiveMarkdownBody] after streaming completes.
///
/// Regex runs are O(n) and take <1ms even on 10K+ character strings.
/// [TextSpan] objects are data, not widgets — no build/layout overhead.
TextSpan buildInlineMarkdown(String text, OpenCodeTheme theme) {
  final baseStyle = TextStyle(
    fontFamily: AppTypography.uiFontFamily,
    fontSize: 15,
    color: theme.markdownText,
    height: 1.6,
  );

  if (text.isEmpty) return TextSpan(text: '', style: baseStyle);

  final spans = <InlineSpan>[];
  final pattern = RegExp(
    r'(`[^`\n]+`)' // Group 1: inline code
    r'|(\*\*\*(.+?)\*\*\*)' // Group 2+3: bold-italic
    r'|(\*\*(.+?)\*\*)' // Group 4+5: bold
    r'|(\*(.+?)\*)', // Group 6+7: italic
  );

  int cursor = 0;
  for (final match in pattern.allMatches(text)) {
    // Add plain text before this match.
    if (match.start > cursor) {
      spans.add(
        TextSpan(text: text.substring(cursor, match.start), style: baseStyle),
      );
    }

    if (match.group(1) != null) {
      // Inline code — strip the backticks.
      final code = match.group(1)!;
      spans.add(
        TextSpan(
          text: code.substring(1, code.length - 1),
          style: AppTypography.codeLarge(
            color: theme.markdownCode,
          ).copyWith(backgroundColor: theme.backgroundElement),
        ),
      );
    } else if (match.group(3) != null) {
      // Bold-italic (***text***).
      spans.add(
        TextSpan(
          text: match.group(3),
          style: baseStyle.copyWith(
            fontWeight: FontWeight.w600,
            fontStyle: FontStyle.italic,
            color: theme.markdownStrong,
          ),
        ),
      );
    } else if (match.group(5) != null) {
      // Bold (**text**).
      spans.add(
        TextSpan(
          text: match.group(5),
          style: baseStyle.copyWith(
            fontWeight: FontWeight.w600,
            color: theme.markdownStrong,
          ),
        ),
      );
    } else if (match.group(7) != null) {
      // Italic (*text*).
      spans.add(
        TextSpan(
          text: match.group(7),
          style: baseStyle.copyWith(
            fontStyle: FontStyle.italic,
            color: theme.markdownEmph,
          ),
        ),
      );
    }

    cursor = match.end;
  }

  // Remaining text after last match.
  if (cursor < text.length) {
    spans.add(TextSpan(text: text.substring(cursor), style: baseStyle));
  }

  // Fast path: no formatting found — return single span.
  if (spans.isEmpty) return TextSpan(text: text, style: baseStyle);
  if (spans.length == 1 && spans.first is TextSpan) {
    return spans.first as TextSpan;
  }

  return TextSpan(children: spans);
}
