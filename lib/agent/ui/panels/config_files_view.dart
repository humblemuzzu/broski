import 'package:broski/agent/client/requests/op_call.dart';
import 'package:broski/agent/ui/panels/config_inputs.dart';
import 'package:broski/agent/ui/panels/result_actions.dart';
import 'package:broski/agent/ui/shared/text_entry_dialog.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// A backend's configuration files for a project, listed by the group the
/// backend names; a tap opens one in this sheet. A place for a new named file
/// asks for the name first.
class ConfigFilesView extends StatelessWidget {
  const ConfigFilesView({
    super.key,
    required this.listed,
    required this.actions,
  });

  final ConfigFilesListed listed;
  final ResultActions actions;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final muted = AppTypography.bodySmall(color: theme.textMuted);
    final files = listed.files;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final (index, file) in files.indexed) ...[
          if (index == 0 || files[index - 1].group != file.group)
            Padding(
              padding: Insets.section,
              child: Text(file.group, style: AppTypography.labelLarge()),
            ),
          ListTile(
            key: ValueKey('config-file:${file.id}'),
            contentPadding: EdgeInsets.zero,
            title: Text(file.label),
            subtitle: Text(
              [
                file.scope,
                if (file.template) 'new' else if (!file.exists) 'not there yet',
                if (!file.editable) 'read-only',
              ].join(' · '),
              style: muted,
            ),
            onTap: actions.busy ? null : () => _open(context, file),
          ),
        ],
        if (listed.omitted > 0)
          Text('${listed.omitted} more not listed.', style: muted),
      ],
    );
  }

  Future<void> _open(BuildContext context, ConfigFileEntry file) async {
    final name = file.template
        ? await askForText(context, title: file.label, action: 'Create')
        : null;
    if (file.template && name == null) return;
    await actions.call(
      (target) => opCall(
        target.session,
        ConfigFileOp(cwd: projectOf(target), fileId: file.id, name: name),
      ),
    );
  }
}
