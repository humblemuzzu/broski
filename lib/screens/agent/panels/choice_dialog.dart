import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// Asks which of [options] to go ahead with: what is being asked, why, and
/// one row per answer, named by the label it is given. Null when the person
/// backs out.
Future<T?> askChoice<T>(
  BuildContext context, {
  required String title,
  required String body,
  required Map<String, T> options,
}) => showDialog<T>(
  context: context,
  builder: (context) => Dialog(
    backgroundColor: Colors.transparent,
    insetPadding: Insets.card,
    child: _ChoiceDialog<T>(title: title, body: body, options: options),
  ),
);

class _ChoiceDialog<T> extends StatelessWidget {
  const _ChoiceDialog({
    required this.title,
    required this.body,
    required this.options,
  });

  final String title;
  final String body;
  final Map<String, T> options;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      padding: Insets.screenAll,
      decoration: BoxDecoration(
        color: theme.backgroundPanel,
        borderRadius: Radii.brLg,
        border: Border.all(color: theme.borderSubtle),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: AppTypography.h3(color: theme.text)),
          const SizedBox(height: Spacing.sm),
          Text(body, style: AppTypography.bodySmall(color: theme.textMuted)),
          const SizedBox(height: Spacing.lg),
          for (final MapEntry(key: label, :value) in options.entries)
            Padding(
              padding: Insets.bottomMd,
              child: _OptionRow(
                label: label,
                onTap: () => Navigator.of(context).pop(value),
              ),
            ),
        ],
      ),
    );
  }
}

/// One answer offered, as the app draws a row that leads somewhere.
class _OptionRow extends StatelessWidget {
  const _OptionRow({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        padding: Insets.cardSm,
        decoration: BoxDecoration(
          color: theme.backgroundElement,
          borderRadius: Radii.brSm,
          border: Border.all(color: theme.borderSubtle),
        ),
        child: Row(
          children: [
            Expanded(child: Text(label, style: AppTypography.labelLarge())),
            Icon(AppIcons.chevronRight, size: 18, color: theme.textMuted),
          ],
        ),
      ),
    );
  }
}
