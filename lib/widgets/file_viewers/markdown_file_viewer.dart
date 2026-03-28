import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/markdown_styles.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:url_launcher/url_launcher.dart';

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
        styleSheet: MarkdownStyles.fileViewer(theme),
        onTapLink: (text, href, title) {
          if (href != null) {
            launchUrl(Uri.parse(href), mode: LaunchMode.externalApplication);
          }
        },
        padding: Insets.card,
      ),
    );
  }
}
