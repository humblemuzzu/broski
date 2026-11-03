import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/shared/status_look.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/sessions/session_card_text.dart';
import 'package:broski/widgets/sessions/session_card_view.dart';
import 'package:flutter/material.dart';

/// One session of a list, drawn as the app's session card: its title, where it
/// stands, what it is doing, and the project and model that say what it is.
class SessionRow extends StatelessWidget {
  const SessionRow({
    super.key,
    required this.row,
    required this.onOpen,
    this.onActions,
    this.onDelete,
    this.highlight,
  });

  final SessionSummary row;
  final VoidCallback onOpen;

  /// Null when the backend allows no action on this row.
  final VoidCallback? onActions;

  /// Swipes this row to delete, where the backend allows deleting it.
  final VoidCallback? onDelete;
  final SessionCardHighlight? highlight;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final id = row.session.sessionId;
    return SessionCardView(
      key: ValueKey('session-row:$id'),
      title: row.title?.text ?? 'Untitled session',
      preview: _details,
      timeText: sessionTimeText(row.updatedAt),
      state: _state(theme),
      highlight: highlight,
      isChild: row.parent != null,
      meta: SessionCardMeta(
        icon: AppIcons.terminal,
        iconColor: theme.accent,
        project: sessionProjectName(row.cwd),
        model: row.modelId?.split('/').last,
      ),
      onTap: onOpen,
      onLongPress: onActions,
      onActions: onActions,
      onDelete: onDelete,
      dismissKey: ValueKey('session-dismiss:$id'),
    );
  }

  String? get _details {
    final details = [
      if (row.parent case SessionParent(:final kind)) kind.wire,
      if (row.origin == SessionOrigin.external) 'started elsewhere',
      ?row.source,
    ];
    return details.isEmpty ? null : details.join(' \u00b7 ');
  }

  SessionCardState? _state(OpenCodeTheme theme) {
    if (row.status == SessionStatus.running) {
      return SessionCardState(
        label: 'Working',
        color: theme.info,
        working: true,
      );
    }
    if (row.status == SessionStatus.idle ||
        row.status == SessionStatus.unknown) {
      return null;
    }
    final look = statusLook(row.status, theme);
    return SessionCardState(label: look.label, color: look.color);
  }
}
