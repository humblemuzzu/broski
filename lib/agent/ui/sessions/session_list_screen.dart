import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/catalog/session_actions.dart';
import 'package:broski/agent/catalog/session_list_controller.dart';
import 'package:broski/agent/ui/backend_label.dart';
import 'package:broski/agent/ui/chat/agent_chat_screen.dart';
import 'package:broski/agent/ui/sessions/new_session_sheet.dart';
import 'package:broski/agent/ui/sessions/session_actions_sheet.dart';
import 'package:broski/agent/ui/sessions/session_row.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// One backend's sessions, newest first, paged; or one session's children.
class SessionListScreen extends ConsumerStatefulWidget {
  const SessionListScreen({super.key, required this.backend, this.parent});

  final BackendDescriptor backend;

  /// Lists this session's children instead of the top level.
  final SessionSummary? parent;

  @override
  ConsumerState<SessionListScreen> createState() => _SessionListScreenState();
}

class _SessionListScreenState extends ConsumerState<SessionListScreen> {
  var _archived = false;

  SessionListKey get _key => (
    backend: widget.backend.id,
    query: SessionQuery(archived: _archived, parent: widget.parent?.session),
  );

  AppBar _appBar() {
    final parent = widget.parent;
    return AppBar(
      title: Text(
        parent == null
            ? backendLabel(widget.backend.id)
            : 'Subagents of ${parent.title?.text ?? 'this session'}',
      ),
      actions: [
        if (widget.backend.capabilities.archive && parent == null)
          IconButton(
            key: const ValueKey('toggle-archived'),
            tooltip: _archived ? 'Show active' : 'Show archived',
            icon: Icon(_archived ? AppIcons.unarchive : AppIcons.archive),
            onPressed: () => setState(() => _archived = !_archived),
          ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final list = ref.watch(sessionListProvider(_key));
    final controller = ref.read(sessionListProvider(_key).notifier);
    return Scaffold(
      appBar: _appBar(),
      floatingActionButton: widget.parent == null && !_archived
          ? FloatingActionButton(
              tooltip: 'New session',
              onPressed: () => showNewSessionSheet(context, widget.backend),
              child: const Icon(AppIcons.add),
            )
          : null,
      body: RefreshIndicator(
        onRefresh: controller.refresh,
        child: ListView(
          children: [
            if (list.problem case final problem?)
              Padding(padding: Insets.screen, child: Text(problem)),
            for (final row in list.rows) _row(row),
            if (list.loaded && list.rows.isEmpty)
              const Padding(padding: Insets.screen, child: Text('No sessions')),
            if (!list.complete && list.loaded)
              TextButton(
                onPressed: list.loading ? null : controller.loadMore,
                child: Text(list.loading ? 'Loading…' : 'Load more'),
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
      ),
    );
  }

  Widget _row(SessionSummary row) => SessionRow(
    row: row,
    onOpen: () => openSession(context, row.session),
    onActions: rowActions(row, widget.backend.capabilities).isEmpty
        ? null
        : () => showSessionActions(
            context,
            ref,
            row: row,
            backend: widget.backend,
            listKey: _key,
          ),
  );
}
