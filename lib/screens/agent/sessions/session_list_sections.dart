import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/shared/status_look.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/sessions/session_card_text.dart';
import 'package:flutter/material.dart';

/// The sessions running right now, in the panel that stands above the list on
/// the app's sessions tab: what each is doing, where it works, and a tap to
/// watch it.
class RunningSessionsSection extends StatelessWidget {
  const RunningSessionsSection({
    super.key,
    required this.rows,
    required this.onOpen,
  });

  final List<SessionSummary> rows;
  final void Function(SessionSummary row) onOpen;

  @override
  Widget build(BuildContext context) {
    if (rows.isEmpty) return const SizedBox.shrink();
    final theme = OpenCodeTheme.of(context);
    return Container(
      margin: const EdgeInsets.fromLTRB(20, 0, 20, 16),
      padding: Insets.card,
      decoration: BoxDecoration(
        color: theme.backgroundPanel,
        borderRadius: Radii.brLg,
        border: Border.all(color: theme.info.withValues(alpha: 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _RunningHeader(count: rows.length),
          const SizedBox(height: Spacing.md),
          for (final row in rows)
            Padding(
              padding: Insets.bottomSm,
              child: _RunningRow(row: row, onOpen: () => onOpen(row)),
            ),
        ],
      ),
    );
  }
}

class _RunningHeader extends StatelessWidget {
  const _RunningHeader({required this.count});

  final int count;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Row(
      children: [
        Icon(AppIcons.play, color: theme.info, size: 20),
        const SizedBox(width: Spacing.md),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Running',
                style: TextStyle(
                  color: theme.text,
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                ),
              ),
              Text(
                '$count session${count > 1 ? 's' : ''} '
                'active',
                style: TextStyle(color: theme.info, fontSize: 12),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _RunningRow extends StatelessWidget {
  const _RunningRow({required this.row, required this.onOpen});

  final SessionSummary row;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final look = statusLook(row.status, theme);
    return GestureDetector(
      onTap: onOpen,
      child: Container(
        padding: Insets.cardSm,
        decoration: BoxDecoration(
          color: theme.backgroundElement,
          borderRadius: Radii.brMd,
          border: Border.all(color: look.color.withValues(alpha: 0.3)),
        ),
        child: Row(
          children: [
            _LiveDot(color: look.color),
            const SizedBox(width: Spacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    row.title?.text ?? 'Untitled session',
                    style: TextStyle(
                      color: theme.text,
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: Spacing.xxs),
                  _RunningDetail(row: row, theme: theme),
                ],
              ),
            ),
            Icon(
              AppIcons.chevronRight,
              color: theme.textMuted.withValues(alpha: 0.5),
              size: 18,
            ),
          ],
        ),
      ),
    );
  }
}

class _LiveDot extends StatelessWidget {
  const _LiveDot({required this.color});

  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    width: 8,
    height: 8,
    decoration: BoxDecoration(
      color: color,
      shape: BoxShape.circle,
      boxShadow: [
        BoxShadow(
          color: color.withValues(alpha: 0.5),
          blurRadius: 4,
          spreadRadius: 1,
        ),
      ],
    ),
  );
}

class _RunningDetail extends StatelessWidget {
  const _RunningDetail({required this.row, required this.theme});

  final SessionSummary row;
  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Text(
        sessionProjectName(row.cwd),
        style: TextStyle(color: theme.textMuted, fontSize: 11),
      ),
      if (row.status == SessionStatus.waitingForUser) ...[
        const SizedBox(width: Spacing.sm),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
          decoration: BoxDecoration(
            color: theme.warning.withValues(alpha: 0.15),
            borderRadius: Radii.brXs,
          ),
          child: Text(
            'Waiting for you',
            style: TextStyle(
              color: theme.warning,
              fontSize: 9,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      ],
    ],
  );
}

/// The block the highlighted sessions sit in, under the star that says why
/// they are at the top of the list.
class HighlightedSessionsSection extends StatelessWidget {
  const HighlightedSessionsSection({
    super.key,
    required this.accent,
    required this.children,
  });

  final Color accent;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(24, 0, 24, 10),
        child: Row(
          children: [
            Icon(AppIcons.star, size: 14, color: accent),
            const SizedBox(width: 6),
            Text(
              'HIGHLIGHTED',
              style: TextStyle(
                color: accent,
                fontSize: 12,
                fontWeight: FontWeight.w700,
                letterSpacing: 0.5,
              ),
            ),
          ],
        ),
      ),
      ...children,
    ],
  );
}

/// The name a group of sessions shares, with how many of them it holds.
class SessionDirectoryHeader extends StatelessWidget {
  const SessionDirectoryHeader({
    super.key,
    required this.directory,
    required this.count,
  });

  final String? directory;
  final int count;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Padding(
      key: ValueKey('session-directory-header:${directory ?? ''}'),
      padding: const EdgeInsets.fromLTRB(24, 14, 24, 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(AppIcons.folder, size: 12, color: theme.textMuted),
              const SizedBox(width: 6),
              Text(
                '${sessionProjectName(directory)} \u00b7 $count',
                style: TextStyle(
                  color: theme.textMuted,
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.5,
                ),
              ),
            ],
          ),
          if (directory case final path?)
            Text(
              path,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: theme.textMuted, fontSize: 11),
            ),
        ],
      ),
    );
  }
}
