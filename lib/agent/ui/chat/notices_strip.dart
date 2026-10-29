import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/session/agent_session_state.dart';
import 'package:broski/agent/ui/chat/file_change_view.dart';
import 'package:broski/agent/ui/shared/status_look.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/detail_sheet.dart' show DetailSheet;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Notices and errors the session raised, each dismissible, and the live
/// extras its backend declares (contract §13): rate-limit windows, the run's
/// aggregated diff.
class NoticesStrip extends ConsumerWidget {
  const NoticesStrip({super.key, required this.session, required this.state});

  final SessionRef session;
  final AgentSessionState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = OpenCodeTheme.of(context);
    final controller = ref.read(sessionProvider(session).notifier);
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final notice in state.notices)
          Container(
            key: ValueKey('notice:${notice.id}'),
            padding: Insets.chip,
            color: noticeColor(notice.level, theme).withValues(alpha: 0.08),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    notice.text,
                    style: AppTypography.bodySmall(
                      color: noticeColor(notice.level, theme),
                    ),
                  ),
                ),
                IconButton(
                  tooltip: 'Dismiss',
                  icon: const Icon(AppIcons.close, size: 16),
                  onPressed: () => controller.dismissNotice(notice.id),
                ),
              ],
            ),
          ),
        for (final extension in state.extensions.values)
          _ExtensionRow(extension: extension),
      ],
    );
  }
}

class _ExtensionRow extends StatelessWidget {
  const _ExtensionRow({required this.extension});

  final BackendExtension extension;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return switch (extension) {
      RateLimitUpdate(:final window, :final status, :final usedPercent) =>
        Padding(
          padding: Insets.chip,
          child: Text(
            [
              'Rate limit $window',
              ?status?.wire,
              if (usedPercent != null)
                '${usedPercent.toStringAsFixed(0)}% used',
            ].join(' · '),
            style: AppTypography.caption(color: theme.textMuted),
          ),
        ),
      CodexTurnDiff(:final diff) => TextButton(
        onPressed: () => DetailSheet.show<void>(
          context: context,
          title: 'Changes in this run',
          child: FileChangeView(
            change: FileChange(
              path: 'this run',
              change: FileChangeKind.modified,
              diff: diff,
            ),
          ),
        ),
        child: const Text('Changes in this run'),
      ),
    };
  }
}
