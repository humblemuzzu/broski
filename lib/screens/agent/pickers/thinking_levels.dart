import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/shared/select_pill.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

const _shortNames = {
  'none': 'None',
  'minimal': 'Min',
  'low': 'Low',
  'medium': 'Med',
  'high': 'High',
  'xhigh': 'XHigh',
  'max': 'Max',
};

/// The short name the composer gives a thinking level: `minimal` is `Min`, and
/// a level it does not know keeps its own spelling.
String thinkingLevelLabel(String value) {
  if (value.isEmpty) return 'Auto';
  final name = value.toLowerCase();
  return _shortNames[name] ?? value[0].toUpperCase() + value.substring(1);
}

/// A model's thinking scale as the composer's chips, the level in force
/// filled, and what that level does written under them.
class ThinkingLevelPicker extends StatelessWidget {
  const ThinkingLevelPicker({
    super.key,
    required this.options,
    required this.current,
    required this.onPick,
  });

  final List<ThinkingOption> options;
  final String? current;
  final ValueChanged<String> onPick;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final chosen = options
        .where((option) => option.value == current)
        .firstOrNull;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: Spacing.xs,
          runSpacing: Spacing.xs,
          children: [
            for (final option in options)
              SelectPill(
                look: SelectPillLook.filled,
                key: ValueKey('thinking:${option.value}'),
                label: thinkingLevelLabel(option.label ?? option.value),
                selected: option.value == current,
                onTap: () => onPick(option.value),
              ),
          ],
        ),
        if (chosen?.description case final description?)
          Padding(
            padding: const EdgeInsets.only(top: Spacing.sm),
            child: Text(
              description,
              style: AppTypography.label(color: theme.textMuted),
            ),
          ),
      ],
    );
  }
}
