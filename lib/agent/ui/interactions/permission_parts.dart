import 'package:broski/agent/ui/chat/file_change_view.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// What the tool would do: a command, file changes, a host, paths.
class PermissionPreviewView extends StatelessWidget {
  const PermissionPreviewView({super.key, required this.preview});

  final PermissionPreview preview;

  @override
  Widget build(BuildContext context) => Padding(
    padding: Insets.bottomSm,
    child: switch (preview) {
      CommandPreview(:final command, :final cwd) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SelectableText(command, style: AppTypography.code()),
          if (cwd != null) Text('in $cwd', style: AppTypography.caption()),
        ],
      ),
      FileChangesPreview(:final changes) => Column(
        children: [
          for (final change in changes) FileChangeView(change: change),
        ],
      ),
      NetworkPreview(:final host, :final protocol) => Text(
        'Network: ${[?protocol, host].join('://')}',
        style: AppTypography.body(),
      ),
      PathsPreview(:final paths) => Text(
        paths.join('\n'),
        style: AppTypography.codeSmall(),
      ),
    },
  );
}

/// One option the backend offers: allow or deny, how long it holds, the rule
/// it persists, and whether it ends the run.
class PermissionOptionTile extends StatelessWidget {
  const PermissionOptionTile({
    super.key,
    required this.option,
    required this.selected,
    required this.onTap,
  });

  final PermissionOption option;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final color = option.effect == PermissionEffect.allow
        ? theme.success
        : theme.error;
    final details = [
      _scope(option.scope),
      ?option.rule,
      if (option.stopsRun) 'ends the run',
    ];
    return ListTile(
      key: ValueKey('permission-option:${option.id}'),
      dense: true,
      selected: selected,
      leading: Icon(
        selected ? Icons.radio_button_checked : Icons.radio_button_off,
        color: color,
      ),
      title: Text(option.label, style: AppTypography.body(color: color)),
      subtitle: Text(details.join(' · ')),
      onTap: onTap,
    );
  }
}

String _scope(PermissionScope scope) => switch (scope) {
  PermissionScope.once => 'this time',
  PermissionScope.turn => 'for this run',
  PermissionScope.session => 'for this session',
  PermissionScope.always => 'always',
};

String grantText(PermissionGrant grant) => [
  switch (grant.kind) {
    GrantKind.network => 'Network access',
    GrantKind.read => 'Read',
    GrantKind.write => 'Write',
    GrantKind.deny => 'Deny',
  },
  ?grant.target,
].join(' ');
