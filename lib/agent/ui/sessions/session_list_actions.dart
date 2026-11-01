import 'package:broski/agent/ui/panels/panels_sheet.dart';
import 'package:broski/agent/ui/sessions/new_session_sheet.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:flutter/material.dart';

/// What a backend's session list offers above it, as far as the backend can:
/// its own operations, the archived sessions, a new session.
class SessionListActions extends StatelessWidget {
  const SessionListActions({
    super.key,
    required this.backend,
    required this.archived,
    required this.onArchivedChanged,
  });

  final BackendDescriptor backend;

  /// Whether the list shows the archived sessions.
  final bool archived;
  final ValueChanged<bool> onArchivedChanged;

  @override
  Widget build(BuildContext context) {
    final panels = backendPanels(backend);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (panels.isNotEmpty)
          IconButton(
            key: const ValueKey('backend-panels'),
            tooltip: 'More',
            icon: const Icon(AppIcons.moreVertical),
            onPressed: () =>
                showPanelsSheet(context, panels, backendWide(backend)),
          ),
        if (backend.capabilities.archive)
          IconButton(
            key: const ValueKey('toggle-archived'),
            tooltip: archived ? 'Show active' : 'Show archived',
            icon: Icon(archived ? AppIcons.unarchive : AppIcons.archive),
            onPressed: () => onArchivedChanged(!archived),
          ),
        if (!archived)
          IconButton(
            tooltip: 'New session',
            icon: const Icon(AppIcons.add),
            onPressed: () => showNewSessionSheet(context, backend),
          ),
      ],
    );
  }
}
