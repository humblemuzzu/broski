import 'package:broski/models/claude_code.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/sidebar/sidebar_section.dart';
import 'package:flutter/material.dart';

/// The MCP servers a Claude Code session connected, twelve of them at most.
class CCMcpSection extends StatelessWidget {
  const CCMcpSection({super.key, required this.init});

  final CCSessionInit init;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final servers = init.mcpServers;
    return SidebarSection(
      title: 'MCP Servers',
      icon: AppIcons.dns,
      children: [
        for (final server in servers.take(12))
          _McpServerRow(
            name: '${server['name'] ?? ''}',
            status: '${server['status'] ?? ''}',
          ),
        if (servers.length > 12)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              '+${servers.length - 12} more',
              style: AppTypography.label(color: theme.textMuted),
            ),
          ),
      ],
    );
  }
}

class _McpServerRow extends StatelessWidget {
  const _McpServerRow({required this.name, required this.status});

  final String name;
  final String status;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Padding(
      padding: Insets.bottomSm,
      child: Row(
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              color: _statusColor(theme),
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              name.isEmpty ? 'server' : name,
              style: AppTypography.bodySmall(color: theme.text),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(width: 10),
          Text(
            status.isEmpty ? 'unknown' : status,
            style: AppTypography.label(color: theme.textMuted),
          ),
        ],
      ),
    );
  }

  Color _statusColor(OpenCodeTheme theme) {
    final st = status.toLowerCase();
    if (st.contains('connected') || st == 'ok') {
      return theme.success;
    }
    if (st.contains('needs_auth') || st.contains('auth')) {
      return theme.warning;
    }
    if (st.contains('registration') || st.contains('failed')) {
      return theme.error;
    }
    return theme.textMuted;
  }
}
