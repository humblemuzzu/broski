import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/service_providers.dart';
import '../../theme/app_icons.dart';
import '../../theme/app_typography.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import '../../utils/error_utils.dart';
import '../../widgets/chat/detail_sheet.dart';

/// Shows the Codex MCP servers sheet. Extracted from chat_screen.dart.
void showCodexMcpSheet(BuildContext context, WidgetRef ref) {
  final theme = OpenCodeTheme.of(context);
  DetailSheet.show(
    context: context,
    title: 'MCP Servers',
    initialSize: 0.5,
    child: FutureBuilder<List<Map<String, dynamic>>>(
      future: ref.read(bridgeServiceProvider).cxListMcpServerStatus(),
      builder: (context, snapshot) {
        final loading = snapshot.connectionState == ConnectionState.waiting;
        final servers = snapshot.data ?? const <Map<String, dynamic>>[];
        return Padding(
          padding: Insets.screenH,
          child: loading
              ? const Padding(
                  padding: EdgeInsets.symmetric(vertical: 24),
                  child: Center(child: CircularProgressIndicator()),
                )
              : snapshot.hasError
              ? Padding(
                  padding: Insets.screenV,
                  child: Text(
                    'Failed to load MCP servers: ${humanizeError(snapshot.error ?? "Unknown error")}',
                    style: AppTypography.label(color: theme.textMuted),
                  ),
                )
              : servers.isEmpty
              ? Padding(
                  padding: Insets.screenV,
                  child: Text(
                    'No MCP servers configured.',
                    style: AppTypography.bodySmall(color: theme.textMuted),
                  ),
                )
              : Column(
                  mainAxisSize: MainAxisSize.min,
                  children: servers.asMap().entries.map((entry) {
                    final index = entry.key;
                    final s = entry.value;
                    final name = (s['name'] ?? '').toString();
                    final auth = (s['authStatus'] ?? '').toString();
                    final tools = (s['tools'] is Map)
                        ? (s['tools'] as Map).length
                        : (s['tools'] as List?)?.length ?? 0;
                    final resources = (s['resources'] as List?)?.length ?? 0;
                    final templates =
                        (s['resourceTemplates'] as List?)?.length ?? 0;
                    return Column(
                      children: [
                        if (index > 0)
                          Divider(
                            color: theme.borderSubtle.withValues(alpha: 0.35),
                          ),
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: Icon(
                            AppIcons.hub,
                            color: theme.accent,
                            size: 18,
                          ),
                          title: Text(
                            name.isEmpty ? 'server' : name,
                            style: TextStyle(
                              color: theme.text,
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          subtitle: Text(
                            '$auth • $tools tools • $resources resources • $templates templates',
                            style: TextStyle(
                              color: theme.textMuted,
                              fontSize: 12,
                            ),
                          ),
                          trailing: null,
                        ),
                      ],
                    );
                  }).toList(),
                ),
        );
      },
    ),
  );
}
