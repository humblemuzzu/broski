import 'package:broski/models/pi.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// One model of Pi's full catalogue, as `pi --list-models` prints it.
class PiCatalogueModelTile extends StatelessWidget {
  const PiCatalogueModelTile({
    super.key,
    required this.model,
    required this.selected,
    this.onTap,
  });

  final PiModel model;

  /// The model the session is on right now.
  final bool selected;

  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return ListTile(
      dense: true,
      contentPadding: EdgeInsets.zero,
      onTap: onTap,
      leading: Icon(
        selected ? AppIcons.radioChecked : AppIcons.radioUnchecked,
        size: 18,
        color: selected ? theme.accent : theme.textMuted,
      ),
      title: Row(
        children: [
          Expanded(
            child: Text(
              model.name.isNotEmpty ? model.name : model.id,
              style: AppTypography.bodySmall(color: theme.text),
            ),
          ),
          if (model.reasoning)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
              decoration: BoxDecoration(
                color: theme.warning.withValues(alpha: 0.12),
                borderRadius: Radii.brXs,
              ),
              child: Text(
                'Thinking',
                style: TextStyle(
                  color: theme.warning,
                  fontSize: 9,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          if (model.supportsImages) ...[
            const SizedBox(width: Spacing.xs),
            Icon(AppIcons.image, size: 12, color: theme.info),
          ],
        ],
      ),
      subtitle: Text(
        piModelDetailLine(model),
        style: AppTypography.label(color: theme.textMuted),
      ),
    );
  }
}

/// `1M · $3.00/$15.00 per MTok`, the metadata line under a model's name.
String piModelDetailLine(PiModel model) {
  final context = _formatContextWindow(model.contextWindow);
  final price = model.cost.input > 0
      ? ' • \$${model.cost.input.toStringAsFixed(2)}/\$${model.cost.output.toStringAsFixed(2)} per MTok'
      : '';
  return '$context$price';
}

String _formatContextWindow(int tokens) {
  if (tokens >= 1000000) {
    return '${(tokens / 1000000).toStringAsFixed(0)}M context';
  }
  if (tokens >= 1000) return '${(tokens / 1000).toStringAsFixed(0)}K context';
  return '$tokens context';
}
