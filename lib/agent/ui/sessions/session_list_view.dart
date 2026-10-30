import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/catalog/session_actions.dart';
import 'package:broski/agent/catalog/session_list_controller.dart';
import 'package:broski/agent/ui/chat/agent_chat_screen.dart';
import 'package:broski/agent/ui/sessions/session_actions_sheet.dart';
import 'package:broski/agent/ui/sessions/session_row.dart';
import 'package:broski/agent/ui/shared/offline_banner.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The rows of one list of sessions, paged, with the row actions the backend
/// has; the saved copy, marked, while the bridge cannot be reached.
class SessionListView extends ConsumerWidget {
  const SessionListView({
    super.key,
    required this.backend,
    required this.listKey,
    this.bottomPadding = 0,
  });

  final BackendDescriptor backend;
  final SessionListKey listKey;

  /// Room below the last row, for what floats over the list.
  final double bottomPadding;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final list = ref.watch(sessionListProvider(listKey));
    final controller = ref.read(sessionListProvider(listKey).notifier);
    final live = ref.watch(liveProvider);
    return RefreshIndicator(
      onRefresh: controller.refresh,
      child: ListView(
        padding: EdgeInsets.only(bottom: bottomPadding),
        children: [
          if (!live && list.loaded)
            OfflineBanner(savedAt: list.savedAt)
          else if (list.problem case final problem?)
            Padding(padding: Insets.screen, child: Text(problem)),
          for (final row in list.rows) _row(context, ref, row, live),
          if (list.loaded && list.rows.isEmpty)
            const Padding(padding: Insets.screen, child: Text('No sessions')),
          if (!list.complete && list.loaded && live)
            TextButton(
              onPressed: list.loading ? null : controller.loadMore,
              child: Text(list.loading ? 'Loading\u2026' : 'Load more'),
            ),
          if (!list.loaded)
            const Padding(
              padding: Insets.screen,
              child: Center(
                child: CircularProgressIndicator(
                  semanticsLabel: 'Loading the sessions',
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _row(
    BuildContext context,
    WidgetRef ref,
    SessionSummary row,
    bool live,
  ) {
    final actionable = live && rowActions(row, backend.capabilities).isNotEmpty;
    return SessionRow(
      row: row,
      onOpen: () => openSession(context, row.session),
      onActions: actionable
          ? () => showSessionActions(
              context,
              ref,
              row: row,
              backend: backend,
              listKey: listKey,
            )
          : null,
    );
  }
}
