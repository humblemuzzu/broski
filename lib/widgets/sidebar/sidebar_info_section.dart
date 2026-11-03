import 'package:broski/theme/app_icons.dart';
import 'package:broski/widgets/sidebar/sidebar_divided_list.dart';
import 'package:broski/widgets/sidebar/sidebar_info_row.dart';
import 'package:broski/widgets/sidebar/sidebar_notice.dart';
import 'package:broski/widgets/sidebar/sidebar_section.dart';
import 'package:flutter/material.dart';

/// What the session is: the facts its chat screen names, as label/value rows.
class InfoSection extends StatelessWidget {
  const InfoSection({super.key, required this.rows});

  final List<({IconData icon, String label, String value})> rows;

  @override
  Widget build(BuildContext context) {
    return SidebarSection(
      title: 'Session Info',
      icon: AppIcons.info,
      children: [
        if (rows.isEmpty)
          const SidebarNotice(
            icon: AppIcons.hourglass,
            message: 'Waiting for session...',
          )
        else
          SidebarDividedList(
            items: [
              for (final row in rows)
                SidebarInfoRow(
                  icon: row.icon,
                  label: row.label,
                  value: row.value,
                ),
            ],
          ),
      ],
    );
  }
}
