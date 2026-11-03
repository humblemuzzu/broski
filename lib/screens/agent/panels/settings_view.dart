import 'package:broski/agent/client/requests/op_call.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/panels/panel_card.dart';
import 'package:broski/screens/agent/panels/result_actions.dart';
import 'package:broski/screens/agent/panels/toggle_row.dart';
import 'package:broski/screens/agent/shared/select_pill.dart';
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
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      for (final setting in settings)
        Padding(
          padding: Insets.bottomMd,
          child: switch (setting) {
            final ToggleSetting toggle => ToggleRow(
              key: ValueKey('setting:${toggle.key}'),
              title: toggle.label,
              description: toggle.description,
              note: toggle.note,
              value: toggle.enabled,
              onChanged: actions.busy ? null : (on) => _toggle(toggle, on),
            ),
            final ChoiceSetting choice => _ChoiceRow(
              setting: choice,
              actions: actions,
            ),
          },
        ),
    ],
  );

  void _toggle(ToggleSetting setting, bool enabled) => actions.call(
    (target) => opCall(
      target.session,
      SessionSettingsOp(
        sessionId: target.session.sessionId,
        change: ToggleChange(key: setting.key, enabled: enabled),
      ),
    ),
  );
}

/// A setting with a short list of values: what it is called, what it does,
/// and one capsule per value, the one in use filled in.
class _ChoiceRow extends StatelessWidget {
  const _ChoiceRow({required this.setting, required this.actions});

  final ChoiceSetting setting;
  final ResultActions actions;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return PanelCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            setting.label,
            style: AppTypography.bodySmall(
              color: theme.text,
            ).copyWith(fontSize: 14, fontWeight: FontWeight.w500),
          ),
          if (setting.description case final description?)
            Padding(
              padding: Insets.topSm,
              child: Text(
                description,
                style: AppTypography.label(color: theme.textMuted),
              ),
            ),
          if (setting.note case final note?)
            Padding(
              padding: Insets.topSm,
              child: Text(
                note,
                style: AppTypography.label(color: theme.warning),
              ),
            ),
          Padding(
            padding: Insets.topSm,
            child: Wrap(
              spacing: Spacing.sm,
              runSpacing: Spacing.sm,
              children: [
                for (final option in setting.options)
                  SelectPill(
                    dense: true,
                    key: ValueKey('setting:${setting.key}:${option.value}'),
                    label: option.label,
                    selected: option.value == setting.value,
                    onTap: actions.busy ? null : () => _choose(option),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  void _choose(Option option) => actions.call(
    (target) => opCall(
      target.session,
      SessionSettingsOp(
        sessionId: target.session.sessionId,
        change: ChoiceChange(key: setting.key, value: option.value),
      ),
    ),
  );
}
