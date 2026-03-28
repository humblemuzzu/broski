import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class TextFileViewer extends StatelessWidget {
  const TextFileViewer({
    super.key,
    required this.content,
    required this.filename,
  });
  final String content;
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
                Icon(AppIcons.description, size: 16, color: theme.textMuted),
                const SizedBox(width: Spacing.sm),
                Text(
                  '${lines.length} lines',
                  style: AppTypography.label(color: theme.textMuted),
                ),
                const Spacer(),
                IconButton(
                  icon: Icon(AppIcons.copy, size: 18, color: theme.textMuted),
                  onPressed: () {
                    Clipboard.setData(ClipboardData(text: content));
                    showSuccess(context, 'Copied to clipboard');
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
              child: Container(
                width: double.infinity,
                padding: Insets.card,
                decoration: BoxDecoration(
                  color: theme.backgroundPanel,
                  borderRadius: Radii.brMd,
                  border: Border.all(color: theme.borderSubtle),
                ),
                child: SelectableText(
                  content,
                  style: AppTypography.code(
                    color: theme.text,
                  ).copyWith(height: 1.6),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
