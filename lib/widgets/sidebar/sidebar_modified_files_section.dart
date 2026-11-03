import 'package:broski/models/session_context.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/sidebar/sidebar_change_counts.dart';
import 'package:broski/widgets/sidebar/sidebar_divided_list.dart';
import 'package:broski/widgets/sidebar/sidebar_modified_file_item.dart';
import 'package:broski/widgets/sidebar/sidebar_notice.dart';
import 'package:broski/widgets/sidebar/sidebar_section.dart';
import 'package:flutter/material.dart';

/// The files the session has written: each one and the totals of the writes.
class ModifiedFilesSection extends StatelessWidget {
  const ModifiedFilesSection({super.key, required this.files});

  final List<ModifiedFile> files;

  @override
  Widget build(BuildContext context) {
    if (files.isEmpty) {
      return SidebarSection(
        title: 'Modified Files',
        icon: AppIcons.edit,
        children: [
          SidebarNotice(
            icon: AppIcons.checkCircle,
            message: 'No files modified yet',
            iconColor: OpenCodeTheme.of(context).success,
          ),
        ],
      );
    }
    var additions = 0;
    var deletions = 0;
    for (final file in files) {
      additions += file.additions;
      deletions += file.deletions;
    }
    return SidebarSection(
      title: 'Modified Files',
      icon: AppIcons.edit,
      trailing: SidebarChangeCounts(additions: additions, deletions: deletions),
      children: [
        SidebarDividedList(
          items: [
            for (final file in files) SidebarModifiedFileItem(file: file),
          ],
        ),
      ],
    );
  }
}
