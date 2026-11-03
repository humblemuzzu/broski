import 'package:broski/models/claude_code.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/widgets/sidebar/sidebar_divided_list.dart';
import 'package:broski/widgets/sidebar/sidebar_info_row.dart';
import 'package:broski/widgets/sidebar/sidebar_notice.dart';
import 'package:broski/widgets/sidebar/sidebar_section.dart';
import 'package:flutter/material.dart';

/// What a Claude Code session announced when it started: its model, the
/// permission mode, how many tools it has and the account behind it.
class CCInfoSection extends StatelessWidget {
  const CCInfoSection({super.key, this.init});

  final CCSessionInit? init;

  @override
  Widget build(BuildContext context) {
    final init = this.init;
    if (init == null) {
      return const SidebarSection(
        title: 'Session Info',
        icon: AppIcons.info,
        children: [
          SidebarNotice(
            icon: AppIcons.hourglass,
            message: 'Waiting for session...',
          ),
        ],
      );
    }
    return SidebarSection(
      title: 'Claude Code',
      icon: AppIcons.agent,
      children: [SidebarDividedList(items: _rows(init))],
    );
  }

  List<Widget> _rows(CCSessionInit init) {
    final account = init.accountInfo;
    final accountLabels = [
      if ((account?.subscriptionType ?? '').isNotEmpty)
        account!.subscriptionType!,
      if ((account?.apiKeySource ?? '').isNotEmpty) account!.apiKeySource!,
    ];
    return [
      SidebarInfoRow(
        icon: AppIcons.memory,
        label: 'Model',
        value: init.model.isNotEmpty ? init.model : 'sonnet',
      ),
      SidebarInfoRow(
        icon: AppIcons.security,
        label: 'Mode',
        value: init.permissionMode.displayName,
      ),
      SidebarInfoRow(
        icon: AppIcons.build,
        label: 'Tools',
        value: '${init.tools.length} enabled',
      ),
      if (init.mcpServers.isNotEmpty)
        SidebarInfoRow(
          icon: AppIcons.dns,
          label: 'MCP Servers',
          value: '${init.mcpServers.length} connected',
        ),
      if (init.claudeCodeVersion case final version?)
        SidebarInfoRow(icon: AppIcons.info, label: 'Version', value: version),
      if (accountLabels.isNotEmpty)
        SidebarInfoRow(
          icon: AppIcons.person,
          label: 'Account',
          value: accountLabels.join(' • '),
        ),
    ];
  }
}
