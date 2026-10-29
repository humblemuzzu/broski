import 'package:broski/agent/ui/shared/status_look.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// One session list row: title, directory, status, and where it came from.
class SessionRow extends StatelessWidget {
  const SessionRow({
    super.key,
    required this.row,
    required this.onOpen,
    this.onActions,
  });

  final SessionSummary row;
  final VoidCallback onOpen;

  /// Null when the backend allows no action on a row.
  final VoidCallback? onActions;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final status = statusLook(row.status, theme);
    final details = [
      ?row.cwd,
      if (row.parent case SessionParent(:final kind)) kind.wire,
      if (row.origin == SessionOrigin.external) 'started elsewhere',
      ?row.source,
    ];
    return ListTile(
      key: ValueKey('session-row:${row.session.sessionId}'),
      contentPadding: Insets.cardH,
      onTap: onOpen,
      onLongPress: onActions,
      title: Text(
        row.title?.text ?? 'Untitled session',
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: AppTypography.body(color: theme.text),
      ),
      subtitle: details.isEmpty
          ? null
          : Text(
              details.join(' · '),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppTypography.caption(color: theme.textMuted),
            ),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (row.status != SessionStatus.idle)
            StatusPill(label: status.label, color: status.color),
          if (onActions case final open?)
            IconButton(
              tooltip: 'Actions',
              icon: const Icon(AppIcons.moreVertical),
              onPressed: open,
            ),
        ],
      ),
    );
  }
}
