import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../theme/design_tokens.dart';
import '../../theme/markdown_styles.dart';
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
