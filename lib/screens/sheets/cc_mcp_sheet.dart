import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:broski/theme/app_icons.dart';
import '../../providers/chat_provider.dart';
import '../../providers/claude_code_provider.dart';
import '../../theme/app_typography.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import '../../widgets/chat/detail_sheet.dart';

/// Shows the Claude Code MCP servers sheet. Extracted from chat_screen.dart.
///
/// [fallbackCwd] is used when the chat state's ccCwd is null — typically
/// derived from `widget.ccSession?.cwd ?? widget.ccDraftCwd` in the caller.
void showCcMcpSheet(BuildContext context, {String? fallbackCwd}) {
  final theme = OpenCodeTheme.of(context);
  DetailSheet.show(
    context: context,
    title: 'MCP Servers',
    initialSize: 0.5,
    child: Consumer(
      builder: (context, ref, _) {
        final chatState = ref.watch(chatSessionProvider);
        final init = chatState.ccInit;
        final cwd = chatState.ccCwd ?? fallbackCwd;
        final statusesAsync = ref.watch(ccMcpServerStatusProvider(cwd));
        final initServers = init?.mcpServers ?? const [];
        return Padding(
          padding: Insets.screenH,
          child: statusesAsync.when(
            data: (statuses) {
              if (statuses.isNotEmpty) {
                return Column(
                  mainAxisSize: MainAxisSize.min,
                  children: statuses
                      .map(
                        (status) => ListTile(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          leading: Icon(
                            status.status == 'connected'
                                ? AppIcons.checkCircle
                                : status.status == 'needs-auth'
                                ? AppIcons.lock
                                : status.status == 'pending'
                                ? AppIcons.pending
                                : AppIcons.error,
                            color: status.status == 'connected'
                                ? theme.success
                                : status.status == 'needs-auth'
                                ? theme.warning
                                : status.status == 'pending'
                                ? theme.accent
                                : theme.error,
                            size: 18,
                          ),
                          title: Text(
                            status.name,
                            style: AppTypography.bodySmall(color: theme.text),
                          ),
                          subtitle: Text(
                            status.serverName != null &&
                                    status.serverVersion != null
                                ? '${status.status} • ${status.serverName} ${status.serverVersion}'
                                : status.status,
                            style: TextStyle(
                              color: theme.textMuted,
                              fontSize: 12,
                            ),
                          ),
                        ),
                      )
                      .toList(),
                );
              }
              if (initServers.isEmpty) {
                return Padding(
                  padding: Insets.topSm,
                  child: Text(
                    'No MCP servers reported yet (start a turn to initialize).',
                    style: AppTypography.bodySmall(color: theme.textMuted),
                  ),
                );
              }
              return Column(
                mainAxisSize: MainAxisSize.min,
                children: initServers
                    .map(
                      (s) => ListTile(
                        dense: true,
                        contentPadding: EdgeInsets.zero,
                        title: Text(
                          s['name']?.toString() ?? 'server',
                          style: AppTypography.bodySmall(color: theme.text),
                        ),
                        subtitle: Text(
                          s['status']?.toString() ?? '',
                          style: TextStyle(
                            color: theme.textMuted,
                            fontSize: 12,
                          ),
                        ),
                      ),
                    )
                    .toList(),
              );
            },
            loading: () => Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Center(
                child: CircularProgressIndicator(color: theme.accent),
              ),
            ),
            error: (_, __) => Padding(
              padding: Insets.topSm,
              child: Text(
                'Unable to load MCP server status.',
                style: AppTypography.bodySmall(color: theme.textMuted),
              ),
            ),
          ),
        );
      },
    ),
  );
}
