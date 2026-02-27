import 'package:flutter/material.dart';

import '../../theme/app_typography.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';

class OpenCodeSessionBehaviorCard extends StatelessWidget {
  const OpenCodeSessionBehaviorCard({
    super.key,
    required this.autoCompaction,
    required this.pruneCompaction,
    required this.shareMode,
    required this.saving,
    required this.onAutoCompactionChanged,
    required this.onPruneCompactionChanged,
    required this.onShareModeChanged,
  });

  final bool autoCompaction;
  final bool pruneCompaction;
  final String shareMode;
  final bool saving;
  final ValueChanged<bool> onAutoCompactionChanged;
  final ValueChanged<bool> onPruneCompactionChanged;
  final ValueChanged<String> onShareModeChanged;

  @override
  Widget build(BuildContext context) {
    final oc = OpenCodeTheme.of(context);
    return Card(
      color: oc.backgroundElement,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: Radii.brMd,
        side: BorderSide(color: oc.border),
      ),
      child: Padding(
        padding: Insets.card,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Session behavior',
                        style: TextStyle(
                          color: oc.text,
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      SizedBox(height: Spacing.xxs),
                      Text(
                        'Control context compaction and session sharing defaults.',
                        style: AppTypography.label(color: oc.textMuted),
                      ),
                    ],
                  ),
                ),
                if (saving)
                  SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: oc.primary,
                    ),
                  ),
              ],
            ),
            SizedBox(height: Spacing.md),
            SwitchListTile(
              value: autoCompaction,
              onChanged: saving ? null : onAutoCompactionChanged,
              dense: true,
              contentPadding: EdgeInsets.zero,
              title: Text(
                'Auto compact',
                style: TextStyle(
                  color: oc.text,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
              subtitle: Text(
                'Automatically compact long sessions when context is near full.',
                style: AppTypography.label(color: oc.textMuted),
              ),
              activeThumbColor: oc.primary,
            ),
            SwitchListTile(
              value: pruneCompaction,
              onChanged: saving ? null : onPruneCompactionChanged,
              dense: true,
              contentPadding: EdgeInsets.zero,
              title: Text(
                'Prune old tool output',
                style: TextStyle(
                  color: oc.text,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
              subtitle: Text(
                'Drop stale heavy tool output to keep context lightweight.',
                style: AppTypography.label(color: oc.textMuted),
              ),
              activeThumbColor: oc.primary,
            ),
            SizedBox(height: Spacing.sm),
            Text(
              'Share mode',
              style: TextStyle(
                color: oc.textMuted,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
            SizedBox(height: Spacing.sm),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: _shareModes.map((mode) {
                final selected = shareMode == mode.value;
                return ChoiceChip(
                  selected: selected,
                  onSelected: saving || selected
                      ? null
                      : (_) => onShareModeChanged(mode.value),
                  label: Text(mode.label),
                  tooltip: mode.description,
                  labelStyle: TextStyle(
                    color: selected ? oc.background : oc.text,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                  selectedColor: oc.primary,
                  backgroundColor: oc.background,
                  shape: RoundedRectangleBorder(
                    borderRadius: Radii.brMd,
                    side: BorderSide(color: oc.borderSubtle),
                  ),
                );
              }).toList(),
            ),
          ],
        ),
      ),
    );
  }
}

class _ShareModeMeta {
  const _ShareModeMeta({
    required this.value,
    required this.label,
    required this.description,
  });

  final String value;
  final String label;
  final String description;
}

const List<_ShareModeMeta> _shareModes = [
  _ShareModeMeta(
    value: 'manual',
    label: 'Manual',
    description: 'Create share links only when explicitly requested.',
  ),
  _ShareModeMeta(
    value: 'auto',
    label: 'Auto',
    description: 'Automatically enable session sharing.',
  ),
  _ShareModeMeta(
    value: 'disabled',
    label: 'Disabled',
    description: 'Disable session sharing for this workspace.',
  ),
];
