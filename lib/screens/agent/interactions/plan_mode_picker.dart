import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/interactions/ask_field.dart';
import 'package:broski/screens/agent/shared/select_pill.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// The mode the session continues in once the plan is approved: one of the
/// values the request offers (`modeOptions`), the backend's own default
/// chosen to begin with.
class PlanModePicker extends StatelessWidget {
  const PlanModePicker({
    super.key,
    required this.options,
    required this.selected,
    required this.onSelected,
  });

  final PlanModeOptions options;
  final String? selected;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final description = [
      for (final option in options.options)
        if (option.value == selected) ?option.description,
    ].firstOrNull;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Padding(
          padding: Insets.topSm,
          child: AskFieldLabel(text: 'Then continue in'),
        ),
        Wrap(
          spacing: Spacing.sm,
          runSpacing: Spacing.sm,
          children: [
            for (final option in options.options)
              SelectPill(
                key: ValueKey('plan-mode:${option.value}'),
                label: option.label,
                selected: option.value == selected,
                onTap: () => onSelected(option.value),
              ),
          ],
        ),
        if (description != null)
          Padding(
            padding: Insets.topSm,
            child: Text(
              description,
              key: const ValueKey('plan-mode-description'),
              style: AppTypography.caption(color: theme.textMuted),
            ),
          ),
      ],
    );
  }
}

/// The value the picker starts on: the request's default when it is one of
/// the options, otherwise none, and the backend then takes its own.
String? initialPlanMode(PlanModeOptions? options) {
  final fallback = options?.defaultValue;
  if (options == null || fallback == null) return null;
  return options.options.any((option) => option.value == fallback)
      ? fallback
      : null;
}
