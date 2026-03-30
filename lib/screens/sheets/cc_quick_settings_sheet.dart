import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Shows the Claude Code quick settings sheet.
///
/// Allows toggling fast mode, effort level, extended thinking,
/// prompt suggestions, and auto memory mid-session via `ccApplySettings`.
void showCCQuickSettingsSheet(BuildContext context) {
  DetailSheet.show(
    context: context,
    title: 'Quick Settings',
    initialSize: 0.5,
    child: Consumer(
      builder: (context, ref, _) {
        return _CCQuickSettingsContent(ref: ref);
      },
    ),
  );
}

class _CCQuickSettingsContent extends StatefulWidget {
  const _CCQuickSettingsContent({required this.ref});
  final WidgetRef ref;

  @override
  State<_CCQuickSettingsContent> createState() =>
      _CCQuickSettingsContentState();
}

class _CCQuickSettingsContentState extends State<_CCQuickSettingsContent> {
  bool _fastMode = false;
  String _effortLevel = 'medium';
  bool _extendedThinking = false;
  bool _promptSuggestions = true;
  bool _autoMemory = true;

  WidgetRef get ref => widget.ref;

  String? get _sessionId {
    final state = ref.read(chatSessionProvider);
    return state.ccSessionId;
  }

  Future<void> _apply(Map<String, dynamic> settings) async {
    final sid = _sessionId;
    if (sid == null || sid.isEmpty) return;
    final bridge = ref.read(bridgeServiceProvider);
    await bridge.ccApplySettings(sessionId: sid, settings: settings);
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final sid = _sessionId;

    if (sid == null || sid.isEmpty) {
      return Padding(
        padding: Insets.screenAll,
        child: Text(
          'No active Claude Code session',
          style: AppTypography.bodySmall(color: theme.textMuted),
        ),
      );
    }

    return Padding(
      padding: Insets.screenH,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Disclaimer about defaults
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Text(
              'Showing defaults — current values may differ',
              style: TextStyle(
                color: theme.textMuted,
                fontSize: 11,
                fontStyle: FontStyle.italic,
              ),
            ),
          ),

          // Fast Mode
          _SettingsToggle(
            theme: theme,
            label: 'Fast Mode',
            subtitle: 'Use faster responses (may reduce quality)',
            value: _fastMode,
            onChanged: (v) {
              setState(() => _fastMode = v);
              _apply({'fastMode': v});
            },
          ),
          const SizedBox(height: Spacing.sm),

          // Effort Level
          _EffortSelector(
            theme: theme,
            selected: _effortLevel,
            onChanged: (v) {
              setState(() => _effortLevel = v);
              _apply({'effortLevel': v});
            },
          ),
          const SizedBox(height: Spacing.sm),

          // Extended Thinking
          _SettingsToggle(
            theme: theme,
            label: 'Extended Thinking',
            subtitle: 'Enable always-on extended thinking',
            value: _extendedThinking,
            onChanged: (v) {
              setState(() => _extendedThinking = v);
              _apply({'alwaysThinkingEnabled': v});
            },
          ),
          const SizedBox(height: Spacing.sm),

          // Prompt Suggestions
          _SettingsToggle(
            theme: theme,
            label: 'Prompt Suggestions',
            subtitle: 'Show suggested prompts after responses',
            value: _promptSuggestions,
            onChanged: (v) {
              setState(() => _promptSuggestions = v);
              _apply({'promptSuggestionEnabled': v});
            },
          ),
          const SizedBox(height: Spacing.sm),

          // Auto Memory
          _SettingsToggle(
            theme: theme,
            label: 'Auto Memory',
            subtitle: 'Automatically save context to memory files',
            value: _autoMemory,
            onChanged: (v) {
              setState(() => _autoMemory = v);
              _apply({'autoMemoryEnabled': v});
            },
          ),
        ],
      ),
    );
  }
}

/// Toggle row for a boolean setting.
class _SettingsToggle extends StatelessWidget {
  const _SettingsToggle({
    required this.theme,
    required this.label,
    required this.subtitle,
    required this.value,
    required this.onChanged,
  });

  final OpenCodeTheme theme;
  final String label;
  final String subtitle;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return SwitchListTile(
      value: value,
      onChanged: onChanged,
      dense: true,
      contentPadding: EdgeInsets.zero,
      title: Text(
        label,
        style: TextStyle(
          color: theme.text,
          fontSize: 13,
          fontWeight: FontWeight.w600,
        ),
      ),
      subtitle: Text(
        subtitle,
        style: AppTypography.label(color: theme.textMuted),
      ),
      activeThumbColor: theme.primary,
    );
  }
}

/// Segmented control for effort level: Low / Medium / High.
class _EffortSelector extends StatelessWidget {
  const _EffortSelector({
    required this.theme,
    required this.selected,
    required this.onChanged,
  });

  final OpenCodeTheme theme;
  final String selected;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 4, bottom: 8),
          child: Text(
            'Effort Level',
            style: TextStyle(
              color: theme.text,
              fontSize: 13,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        Row(
          children: [
            for (final level in const ['low', 'medium', 'high']) ...[
              if (level != 'low') const SizedBox(width: 8),
              Expanded(
                child: _EffortChip(
                  theme: theme,
                  label: level[0].toUpperCase() + level.substring(1),
                  isSelected: selected == level,
                  onTap: () => onChanged(level),
                ),
              ),
            ],
          ],
        ),
      ],
    );
  }
}

/// Single effort level chip.
class _EffortChip extends StatelessWidget {
  const _EffortChip({
    required this.theme,
    required this.label,
    required this.isSelected,
    required this.onTap,
  });

  final OpenCodeTheme theme;
  final String label;
  final bool isSelected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 8),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: isSelected ? theme.primary : theme.backgroundPanel,
          borderRadius: Radii.brSm,
          border: Border.all(
            color: isSelected
                ? theme.primary
                : theme.borderSubtle.withValues(alpha: 0.3),
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: isSelected ? theme.background : theme.text,
          ),
        ),
      ),
    );
  }
}
