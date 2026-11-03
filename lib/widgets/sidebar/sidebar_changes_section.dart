import 'package:broski/models/message.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/widgets/sidebar/sidebar_change_counts.dart';
import 'package:broski/widgets/sidebar/sidebar_diff_file_item.dart';
import 'package:broski/widgets/sidebar/sidebar_divided_list.dart';
import 'package:broski/widgets/sidebar/sidebar_notice.dart';
import 'package:broski/widgets/sidebar/sidebar_section.dart';
import 'package:flutter/material.dart';

/// The session's diffs: every changed file and the totals of the changes.
class ChangesSection extends StatelessWidget {
  const ChangesSection({super.key, required this.diffs, this.onOpenDiff});

  final List<DiffEntry> diffs;
  final void Function(DiffEntry diff)? onOpenDiff;

  @override
  Widget build(BuildContext context) {
    if (diffs.isEmpty) {
      return const SidebarSection(
        title: 'Changes',
        icon: AppIcons.diff,
        children: [SidebarNotice(icon: AppIcons.info, message: 'No diffs yet')],
      );
    }
    var additions = 0;
    var deletions = 0;
    for (final diff in diffs) {
      additions += diff.additions;
      deletions += diff.deletions;
    }
    return SidebarSection(
      title: 'Changes',
      icon: AppIcons.diff,
      trailing: SidebarChangeCounts(additions: additions, deletions: deletions),
      children: [
        SidebarDividedList(
          items: [
            for (final diff in diffs)
              SidebarDiffFileItem(diff: diff, onOpen: onOpenDiff),
          ],
        ),
      ],
    );
  }
}
