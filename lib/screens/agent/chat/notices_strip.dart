import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/session/agent_session_state.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/shared/status_look.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Notices and errors the session raised, each in the chat's banner style
/// and dismissible, and the live extras its backend declares (contract §13):
/// rate-limit windows. The next prompt the backend suggests is the
/// composer's chip, not a line here.
class NoticesStrip extends ConsumerWidget {
  const NoticesStrip({super.key, required this.session, required this.state});

  final SessionRef session;
  final AgentSessionState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.read(sessionProvider(session).notifier);
    final theme = OpenCodeTheme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final notice in state.notices)
            _NoticeBanner(
              key: ValueKey('notice:${notice.id}'),
              text: notice.text,
              color: noticeColor(notice.level, theme),
              onDismiss: () => controller.dismissNotice(notice.id),
            ),
          for (final extension in state.extensions.values)
            _ExtensionRow(extension: extension),
        ],
      ),
    );
  }
}

class _NoticeBanner extends StatelessWidget {
  const _NoticeBanner({
    super.key,
    required this.text,
    required this.color,
    required this.onDismiss,
  });

  final String text;
  final Color color;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      margin: const EdgeInsets.only(bottom: Spacing.xs),
      padding: const EdgeInsets.fromLTRB(14, 8, 6, 8),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: Radii.brMd,
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          Icon(AppIcons.info, color: color, size: 16),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              text,
              style: TextStyle(color: theme.text, fontSize: 13),
            ),
          ),
          IconButton(
            tooltip: 'Dismiss',
            visualDensity: VisualDensity.compact,
            icon: Icon(AppIcons.close, size: 16, color: theme.textMuted),
            onPressed: onDismiss,
          ),
        ],
      ),
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
          padding: const EdgeInsets.only(bottom: Spacing.xs),
          child: Text(
            [
              'Rate limit $window',
              ?status?.wire,
              if (usedPercent != null)
                '${usedPercent.toStringAsFixed(0)}% used',
            ].join(' · '),
            style: TextStyle(color: theme.textMuted, fontSize: 11),
          ),
        ),
      PromptSuggestion() => const SizedBox.shrink(),
    };
  }
}
