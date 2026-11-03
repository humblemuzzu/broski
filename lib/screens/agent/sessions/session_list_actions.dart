import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/panels/panels_sheet.dart';
import 'package:broski/screens/agent/sessions/new_session_sheet.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// The buttons a session list carries in its head, as far as the backend can:
/// a new session, a fresh read, the archived sessions, and the backend's own
/// operations.
class SessionListActions extends StatelessWidget {
  const SessionListActions({
    super.key,
    required this.backend,
    required this.archived,
    required this.onArchivedChanged,
    required this.onRefresh,
  });

  final BackendDescriptor backend;

  /// Whether the list shows the archived sessions.
  final bool archived;
  final ValueChanged<bool> onArchivedChanged;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final panels = backendPanels(backend);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (!archived)
          _HeaderButton(
            icon: AppIcons.add,
            colour: theme.text,
            tooltip: 'New session',
            onPressed: () => showNewSessionSheet(context, backend),
          ),
        _HeaderButton(
          icon: AppIcons.refresh,
          colour: theme.textMuted,
          tooltip: 'Refresh',
          onPressed: onRefresh,
        ),
        if (backend.capabilities.archive)
          _HeaderButton(
            key: const ValueKey('toggle-archived'),
            icon: archived ? AppIcons.unarchive : AppIcons.archive,
            colour: archived ? theme.primary : theme.textMuted,
            tooltip: archived ? 'Show active' : 'Show archived',
            onPressed: () => onArchivedChanged(!archived),
          ),
        if (panels.isNotEmpty)
          _HeaderButton(
            key: const ValueKey('backend-panels'),
            icon: AppIcons.moreVertical,
            colour: theme.textMuted,
            tooltip: 'More',
            onPressed: () =>
                showPanelsSheet(context, panels, backendWide(backend)),
          ),
      ],
    );
  }
}

class _HeaderButton extends StatelessWidget {
  const _HeaderButton({
    super.key,
    required this.icon,
    required this.colour,
    required this.tooltip,
    required this.onPressed,
  });

  final IconData icon;
  final Color colour;
  final String tooltip;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => Tooltip(
    message: tooltip,
    child: InkWell(
      onTap: onPressed,
      borderRadius: BorderRadius.circular(18),
      child: Padding(
        padding: const EdgeInsets.all(8),
        child: Icon(icon, size: 20, color: colour),
      ),
    ),
  );
}
