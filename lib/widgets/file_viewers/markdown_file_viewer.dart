import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import '../../theme/app_typography.dart';
import '../../theme/design_tokens.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../theme/opencode_theme.dart';

class MarkdownFileViewer extends StatelessWidget {
  const MarkdownFileViewer({
    super.key,
    required this.content,
    required this.filename,
  });

  final String content;
  final String filename;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);

    return Container(
      color: theme.background,
      child: Markdown(
        data: content,
        selectable: true,
        styleSheet: _buildMarkdownStyle(theme),
        onTapLink: (text, href, title) {
          if (href != null) {
            launchUrl(Uri.parse(href), mode: LaunchMode.externalApplication);
          }
        },
        padding: Insets.card,
      ),
    );
  }

  MarkdownStyleSheet _buildMarkdownStyle(OpenCodeTheme theme) {
    return MarkdownStyleSheet(
      p: TextStyle(fontFamily: AppTypography.uiFontFamily, fontSize: 15, color: theme.text, height: 1.6),
      h1: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 28,
        fontWeight: FontWeight.w700,
        color: theme.text,
        height: 1.3,
      ),
      h2: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 24,
        fontWeight: FontWeight.w600,
        color: theme.text,
        height: 1.3,
      ),
      h3: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 20,
        fontWeight: FontWeight.w600,
        color: theme.text,
        height: 1.4,
      ),
      h4: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 17,
        fontWeight: FontWeight.w600,
        color: theme.text,
        height: 1.4,
      ),
      h5: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 15,
        fontWeight: FontWeight.w600,
        color: theme.text,
        height: 1.4,
      ),
      h6: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 14,
        fontWeight: FontWeight.w600,
        color: theme.textMuted,
        height: 1.4,
      ),
      code: AppTypography.code(color: theme.primary).copyWith(
        backgroundColor: theme.backgroundPanel,
      ),
      codeblockDecoration: BoxDecoration(
        color: theme.backgroundPanel,
        borderRadius: Radii.brSm,
        border: Border.all(color: theme.borderSubtle),
      ),
      codeblockPadding: Insets.cardSm,
      blockquoteDecoration: BoxDecoration(
        border: Border(left: BorderSide(color: theme.primary, width: 3)),
      ),
      blockquotePadding: const EdgeInsets.only(left: 16, top: 8, bottom: 8),
      blockquote: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 15,
        color: theme.textMuted,
        fontStyle: FontStyle.italic,
        height: 1.6,
      ),
      a: TextStyle(color: theme.primary, decoration: TextDecoration.underline),
      listBullet: TextStyle(fontFamily: AppTypography.uiFontFamily, fontSize: 15, color: theme.text),
      tableHead: TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 14,
        fontWeight: FontWeight.w600,
        color: theme.text,
      ),
      tableBody: TextStyle(fontFamily: AppTypography.uiFontFamily, fontSize: 14, color: theme.text),
      tableBorder: TableBorder.all(color: theme.borderSubtle, width: 1),
      tableHeadAlign: TextAlign.left,
      tableCellsPadding: const EdgeInsets.symmetric(
        horizontal: 12,
        vertical: 8,
      ),
      horizontalRuleDecoration: BoxDecoration(
        border: Border(top: BorderSide(color: theme.borderSubtle, width: 1)),
      ),
    );
  }
}
