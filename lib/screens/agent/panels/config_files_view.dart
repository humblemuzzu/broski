import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/panels/grouping.dart';
import 'package:broski/screens/agent/panels/panel_card.dart';
import 'package:broski/screens/agent/panels/pill.dart';
import 'package:broski/screens/agent/shared/text_entry_dialog.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/section_header.dart' show SectionHeader;
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
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (listed.files.isEmpty)
          Padding(
            padding: Insets.chipV,
            child: Text(
              'No files to show.',
              style: AppTypography.bodySmall(color: theme.textMuted),
            ),
          ),
        for (final section in groupedInOrder(listed.files, (f) => f.group)) ...[
          if (section.group case final group?)
            Padding(
              padding: Insets.bottomSm,
              child: SectionHeader(
                key: ValueKey('config-group:$group'),
                title: group,
                theme: theme,
              ),
            ),
          for (final file in section.items)
            Padding(
              padding: Insets.bottomMd,
              child: _FileRow(file: file, busy: busy, onOpen: onOpen),
            ),
        ],
        if (listed.omitted > 0)
          _Footnote(
            key: const ValueKey('config-omitted'),
            text:
                '${listed.omitted} more '
                '${listed.omitted == 1 ? 'file is' : 'files are'} not shown: '
                'the list is at its limit.',
          ),
      ],
    );
  }
}

/// One configuration file, as the app lists a file: its name, where it is,
/// and what is true of it.
class _FileRow extends StatelessWidget {
  const _FileRow({
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
    final tone = file.template ? theme.primary : theme.textMuted;
    return PanelCard(
      key: ValueKey('config-file:${file.id}'),
      onTap: busy ? null : () => _open(context),
      child: Row(
        children: [
          _FileIcon(template: file.template, tone: tone),
          const SizedBox(width: Spacing.md),
          Expanded(
            child: _FileDetails(file: file, theme: theme),
          ),
          Icon(AppIcons.chevronRight, size: 18, color: theme.textMuted),
        ],
      ),
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

class _FileIcon extends StatelessWidget {
  const _FileIcon({required this.template, required this.tone});

  final bool template;
  final Color tone;

  @override
  Widget build(BuildContext context) => Container(
    padding: Insets.cardXs,
    decoration: BoxDecoration(
      color: tone.withValues(alpha: 0.1),
      borderRadius: Radii.brSm,
    ),
    child: Icon(
      template ? AppIcons.filePlus : AppIcons.fileText,
      size: 18,
      color: tone,
    ),
  );
}

class _FileDetails extends StatelessWidget {
  const _FileDetails({required this.file, required this.theme});

  final ConfigFileEntry file;
  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        file.label,
        style: AppTypography.bodySmall(
          color: theme.text,
        ).copyWith(fontSize: 14, fontWeight: FontWeight.w500),
      ),
      Text(
        file.path,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: AppTypography.codeSmall(color: theme.textMuted),
      ),
      Padding(
        padding: Insets.topSm,
        child: Wrap(
          spacing: Spacing.xs,
          runSpacing: Spacing.xs,
          children: [
            Pill(text: file.scope, color: theme.info),
            if (file.template) Pill(text: 'add new', color: theme.success),
            if (!file.template && !file.exists)
              Pill(text: 'not there yet', color: theme.textMuted),
            if (!file.editable) Pill(text: 'read-only', color: theme.warning),
          ],
        ),
      ),
    ],
  );
}

class _Footnote extends StatelessWidget {
  const _Footnote({super.key, required this.text});

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: Insets.chipV,
    child: Text(
      text,
      style: AppTypography.label(color: OpenCodeTheme.of(context).textMuted),
    ),
  );
}
