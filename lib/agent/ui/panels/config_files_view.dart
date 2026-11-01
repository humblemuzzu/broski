import 'package:broski/agent/ui/panels/grouping.dart';
import 'package:broski/agent/ui/panels/pill.dart';
import 'package:broski/agent/ui/shared/text_entry_dialog.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// Opens [file], named [name] when it is a place for a new file.
typedef OpenConfigFile =
    Future<void> Function(ConfigFileEntry file, String? name);

/// A backend's configuration files for a project, under the group the backend
/// names, each with whose it is (the scope) and whether it is there yet or
/// may be changed. A tap opens the file; a place for a new named file asks
/// for the name first.
class ConfigFilesView extends StatelessWidget {
  const ConfigFilesView({
    super.key,
    required this.listed,
    required this.busy,
    required this.onOpen,
  });

  final ConfigFilesListed listed;
  final bool busy;
  final OpenConfigFile onOpen;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final muted = AppTypography.bodySmall(color: theme.textMuted);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (listed.files.isEmpty) Text('No files to show.', style: muted),
        for (final section in groupedInOrder(listed.files, (f) => f.group)) ...[
          Padding(
            padding: Insets.section,
            child: Text(
              section.group ?? '',
              key: ValueKey('config-group:${section.group}'),
              style: AppTypography.labelLarge(),
            ),
          ),
          for (final file in section.items)
            _FileTile(file: file, busy: busy, onOpen: onOpen),
        ],
        if (listed.omitted > 0)
          Padding(
            key: const ValueKey('config-omitted'),
            padding: Insets.chipV,
            child: Text(
              '${listed.omitted} more '
              '${listed.omitted == 1 ? 'file is' : 'files are'} not shown: '
              'the list is at its limit.',
              style: muted,
            ),
          ),
      ],
    );
  }
}

class _FileTile extends StatelessWidget {
  const _FileTile({
    required this.file,
    required this.busy,
    required this.onOpen,
  });

  final ConfigFileEntry file;
  final bool busy;
  final OpenConfigFile onOpen;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return ListTile(
      key: ValueKey('config-file:${file.id}'),
      contentPadding: EdgeInsets.zero,
      leading: file.template
          ? Icon(Icons.add_circle_outline, color: theme.primary)
          : null,
      title: Text(file.label),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            file.path,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppTypography.codeSmall(color: theme.textMuted),
          ),
          Wrap(
            spacing: Spacing.xs,
            children: [
              Pill(text: file.scope, color: theme.info),
              if (file.template) Pill(text: 'add new', color: theme.success),
              if (!file.template && !file.exists)
                Pill(text: 'not there yet', color: theme.textMuted),
              if (!file.editable) Pill(text: 'read-only', color: theme.warning),
            ],
          ),
        ],
      ),
      trailing: Icon(Icons.chevron_right, color: theme.textMuted),
      onTap: busy ? null : () => _open(context),
    );
  }

  Future<void> _open(BuildContext context) async {
    final name = file.template
        ? await askForText(context, title: file.label, action: 'Create')
        : null;
    if (file.template && name == null) return;
    await onOpen(file, name);
  }
}
