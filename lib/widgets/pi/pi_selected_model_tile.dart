import 'package:broski/models/pi.dart';
import 'package:broski/models/pi_model_catalogue.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/pi/pi_catalogue_model_tile.dart';
import 'package:flutter/material.dart';

/// One row of the user's own Pi model list (`enabledModels`), in the order they saved it.
///
/// A model Pi can run is tappable. An entry Pi cannot run — a provider nobody signed in for, or a stale
/// entry — stays muted and inert, with its real name and the reason it is missing (the environment variable
/// the provider reads, or that it needs a `pi` sign-in), so the row never turns into a bare pattern.
class PiSelectedModelTile extends StatelessWidget {
  const PiSelectedModelTile({
    super.key,
    required this.selection,
    required this.selected,
    this.model,
    this.thinkingLevel,
    this.onTap,
  });

  final PiModelSelection selection;

  /// The model the session is on right now.
  final bool selected;

  /// The catalogue entry, present only when Pi can run it here.
  final PiModel? model;

  /// The level to show next to the row: the session's for the current model, else the entry's own.
  final PiThinkingLevel? thinkingLevel;

  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final model = this.model;
    final available = model != null && selection.available;
    return ListTile(
      dense: true,
      contentPadding: EdgeInsets.zero,
      enabled: available,
      onTap: available ? onTap : null,
      leading: Icon(
        selected ? AppIcons.radioChecked : AppIcons.radioUnchecked,
        size: 18,
        color: selected && available ? theme.accent : theme.textMuted,
      ),
      title: Row(
        children: [
          Expanded(
            child: Text(
              model?.name.isNotEmpty == true
                  ? model!.name
                  : selection.displayName,
              style: AppTypography.bodySmall(
                color: available ? theme.text : theme.textMuted,
              ).copyWith(fontWeight: selected ? FontWeight.w600 : null),
            ),
          ),
          if (thinkingLevel != null) ...[
            const SizedBox(width: Spacing.xs),
            _LevelChip(theme: theme, level: thinkingLevel!, muted: !available),
          ],
          if (!available) ...[
            const SizedBox(width: Spacing.xs),
            Text(
              'unavailable',
              style: AppTypography.label(
                color: theme.warning,
              ).copyWith(fontStyle: FontStyle.italic),
            ),
          ],
        ],
      ),
      subtitle: Text(
        available
            ? '${model.provider} • ${piModelDetailLine(model)}'
            : _unavailableLine(),
        style: AppTypography.label(color: theme.textMuted),
      ),
    );
  }

  /// The reason Pi gave for the row, prefixed with the provider when the name came from the full catalogue.
  String _unavailableLine() {
    final reason =
        selection.unavailableReason ?? 'not available on this machine';
    final provider = selection.provider;
    return provider == null ? reason : '$provider • $reason';
  }
}

class _LevelChip extends StatelessWidget {
  const _LevelChip({
    required this.theme,
    required this.level,
    required this.muted,
  });

  final OpenCodeTheme theme;
  final PiThinkingLevel level;
  final bool muted;

  @override
  Widget build(BuildContext context) {
    final color = muted ? theme.textMuted : theme.accent;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: Radii.brXs,
      ),
      child: Text(
        level.displayName,
        style: TextStyle(
          color: color,
          fontSize: 9,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}
