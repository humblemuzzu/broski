
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_highlight/flutter_highlight.dart';
import 'package:flutter_highlight/themes/atom-one-dark.dart';
import '../../theme/app_typography.dart';
import '../../theme/design_tokens.dart';

import '../../theme/opencode_theme.dart';
import 'package:broski/theme/app_icons.dart';
class CodeFileViewer extends StatelessWidget {
  const CodeFileViewer({
    super.key,
    required this.content,
    required this.language,
    required this.filename,
  });
  final String content;
  final String language;
  final String filename;
  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final lines = content.split('\n');
    return Container(
      color: theme.background,
      child: Column(
        children: [
          Container(
            padding: Insets.listItemDense,
            color: theme.backgroundPanel,
            child: Row(
              children: [
                Icon(AppIcons.code, size: 16, color: theme.textMuted),
                SizedBox(width: Spacing.sm),
                Text(
                  '${lines.length} lines',
                  style: AppTypography.label(color: theme.textMuted),
                ),
                const Spacer(),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: theme.primary.withValues(alpha: 0.15),
                    borderRadius: Radii.brXs,
                  ),
                  child: Text(
                    language.toUpperCase(),
                    style: TextStyle(
                      color: theme.primary,
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                SizedBox(width: Spacing.sm),
                IconButton(
                  icon: Icon(AppIcons.copy, size: 18, color: theme.textMuted),
                  onPressed: () {
                    Clipboard.setData(ClipboardData(text: content));
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: const Text('Copied to clipboard'),
                        backgroundColor: theme.backgroundPanel,
                        behavior: SnackBarBehavior.floating,
                        duration: const Duration(seconds: 2),
                      ),
                    );
                  },
                  tooltip: 'Copy',
                  constraints: const BoxConstraints(),
                  padding: Insets.cardXs,
                ),
              ],
            ),
          ),
          Expanded(
            child: SingleChildScrollView(
              padding: Insets.card,
              child: SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(
                      width: 48,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: List.generate(
                          lines.length,
                          (index) => Text(
                            '${index + 1}',
                            style: AppTypography.code(color: theme.textMuted.withValues(alpha: 0.5)).copyWith(
                              height: 1.6,
                            ),
                          ),
                        ),
                      ),
                    ),
                    SizedBox(width: Spacing.lg),
                    HighlightView(
                      content,
                      language: language,
                      theme: atomOneDarkTheme,
                      textStyle: AppTypography.code().copyWith(
                        height: 1.6,
                      ),
                      padding: EdgeInsets.zero,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
