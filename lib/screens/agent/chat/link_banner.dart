import 'package:broski/agent/client/contract_state.dart';
import 'package:broski/agent/session/session_link.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// Says when the conversation shown is not live: reconnecting, attaching,
/// trying again, gone, or a Mac that speaks another protocol, which no
/// reconnect fixes. Nothing while it is live.
class LinkBanner extends StatelessWidget {
  const LinkBanner({
    super.key,
    required this.link,
    required this.contract,
    required this.onRetry,
  });

  final SessionLink link;
  final ContractState? contract;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final (text, color, retry) = switch ((link, contract)) {
      (LinkLive() || LinkReplaced(), _) => (null, theme.textMuted, false),
      (_, ContractIncompatible(:final detail)) => (detail, theme.error, false),
      (LinkWaiting(problem: final problem?), _) => (
        'Could not follow this session: $problem \u00b7 trying again',
        theme.warning,
        true,
      ),
      (LinkWaiting(), _) => (
        'Waiting for the connection\u2026',
        theme.warning,
        false,
      ),
      (LinkAttaching(), _) => ('Catching up\u2026', theme.info, false),
      (LinkLost(:final reason), _) => (reason, theme.error, true),
    };
    if (text == null) return const SizedBox.shrink();
    return Container(
      key: const ValueKey('link-banner'),
      margin: const EdgeInsets.fromLTRB(16, 0, 16, Spacing.sm),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: Radii.brMd,
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          Icon(AppIcons.wifiOff, size: 16, color: color),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              text,
              style: TextStyle(color: theme.text, fontSize: 13),
            ),
          ),
          if (retry)
            GestureDetector(
              onTap: onRetry,
              child: Text(
                'Try again',
                style: TextStyle(
                  color: color,
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
        ],
      ),
    );
  }
}
