import 'package:broski/screens/agent/panels/panel_card.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// Something a session has on or off, on the card it sits on: the name, what
/// it does, and a switch to change it. Tapping the card changes the switch.
class ToggleRow extends StatelessWidget {
  const ToggleRow({
    super.key,
    required this.title,
    required this.value,
    required this.onChanged,
    this.description,
    this.note,
    this.monoTitle = false,
    this.descriptionMaxLines = 3,
  });

  final String title;
  final bool value;
  final ValueChanged<bool>? onChanged;
  final String? description;
  final String? note;
  final bool monoTitle;
  final int descriptionMaxLines;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final onChanged = this.onChanged;
    return PanelCard(
      onTap: onChanged == null ? null : () => onChanged(!value),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: _titleStyle(theme)),
                if (description case final description?
                    when description.isNotEmpty)
                  Padding(
                    padding: Insets.topSm,
                    child: Text(
                      description,
                      maxLines: descriptionMaxLines,
                      overflow: TextOverflow.ellipsis,
                      style: AppTypography.label(color: theme.textMuted),
                    ),
                  ),
                if (note case final note?)
                  Padding(
                    padding: Insets.topSm,
                    child: Text(
                      note,
                      style: AppTypography.label(color: theme.warning),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: Spacing.md),
          _Switch(value: value, onChanged: onChanged),
        ],
      ),
    );
  }

  TextStyle _titleStyle(OpenCodeTheme theme) => monoTitle
      ? AppTypography.bodySmall(color: theme.text).copyWith(
          fontFamily: AppTypography.codeFontFamily,
          fontWeight: FontWeight.w600,
        )
      : AppTypography.bodySmall(
          color: theme.text,
        ).copyWith(fontSize: 14, fontWeight: FontWeight.w500);
}

class _Switch extends StatelessWidget {
  const _Switch({required this.value, required this.onChanged});

  final bool value;
  final ValueChanged<bool>? onChanged;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Switch.adaptive(
      value: value,
      onChanged: onChanged,
      thumbColor: WidgetStateProperty.resolveWith(
        (states) => states.contains(WidgetState.selected)
            ? theme.backgroundPanel
            : theme.textMuted,
      ),
      trackColor: WidgetStateProperty.resolveWith(
        (states) => states.contains(WidgetState.selected)
            ? theme.primary
            : theme.backgroundElement,
      ),
      trackOutlineColor: WidgetStateProperty.all(
        value ? theme.primary : theme.borderSubtle,
      ),
    );
  }
}
