import 'package:broski/agent/ui/panels/result_actions.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// A session's settings as the result lists them: a switch for each on/off
/// setting, a row of choices for each setting with a short list of values.
/// What a setting is called and what it may be is all in the data.
class SessionSettingsView extends StatelessWidget {
  const SessionSettingsView({
    super.key,
    required this.settings,
    required this.actions,
  });

  final List<SessionSetting> settings;
  final ResultActions actions;

  @override
  Widget build(BuildContext context) => Column(
    children: [
      for (final setting in settings)
        switch (setting) {
          final ToggleSetting toggle => _ToggleRow(
            setting: toggle,
            actions: actions,
          ),
          final ChoiceSetting choice => _ChoiceRow(
            setting: choice,
            actions: actions,
          ),
        },
    ],
  );
}

class _ToggleRow extends StatelessWidget {
  const _ToggleRow({required this.setting, required this.actions});

  final ToggleSetting setting;
  final ResultActions actions;

  @override
  Widget build(BuildContext context) => SwitchListTile(
    key: ValueKey('setting:${setting.key}'),
    title: Text(setting.label),
    subtitle: _Described(description: setting.description, note: setting.note),
    value: setting.enabled,
    onChanged: actions.busy
        ? null
        : (enabled) => actions.call(
            (sessionId) => PiCall(
              op: SessionSettingsOp(
                sessionId: sessionId,
                change: ToggleChange(key: setting.key, enabled: enabled),
              ),
            ),
          ),
  );
}

class _ChoiceRow extends StatelessWidget {
  const _ChoiceRow({required this.setting, required this.actions});

  final ChoiceSetting setting;
  final ResultActions actions;

  @override
  Widget build(BuildContext context) => ListTile(
    title: Text(setting.label),
    subtitle: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _Described(description: setting.description, note: setting.note),
        Wrap(
          spacing: Spacing.xs,
          children: [
            for (final option in setting.options)
              ChoiceChip(
                key: ValueKey('setting:${setting.key}:${option.value}'),
                label: Text(option.label),
                selected: option.value == setting.value,
                onSelected: actions.busy
                    ? null
                    : (_) => actions.call(
                        (sessionId) => PiCall(
                          op: SessionSettingsOp(
                            sessionId: sessionId,
                            change: ChoiceChange(
                              key: setting.key,
                              value: option.value,
                            ),
                          ),
                        ),
                      ),
              ),
          ],
        ),
      ],
    ),
  );
}

class _Described extends StatelessWidget {
  const _Described({this.description, this.note});

  final String? description;
  final String? note;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (description != null) Text(description!),
        if (note != null)
          Text(note!, style: AppTypography.bodySmall(color: theme.warning)),
      ],
    );
  }
}
