import 'package:broski/agent/agent_providers.dart' show liveProvider;
import 'package:broski/agent/catalog/session_list_controller.dart';
import 'package:broski/agent/ui/backend_label.dart';
import 'package:broski/agent/ui/sessions/new_session_sheet.dart';
import 'package:broski/agent/ui/sessions/session_list_view.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_icons.dart';
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

  AppBar _appBar(bool live) {
    final parent = widget.parent;
    return AppBar(
      title: Text(
        parent == null
            ? backendLabel(widget.backend.id)
            : 'Subagents of ${parent.title?.text ?? 'this session'}',
      ),
      actions: [
        if (live && widget.backend.capabilities.archive && parent == null)
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
    final live = ref.watch(liveProvider);
    return Scaffold(
      appBar: _appBar(live),
      floatingActionButton: live && widget.parent == null && !_archived
          ? FloatingActionButton(
              tooltip: 'New session',
              onPressed: () => showNewSessionSheet(context, widget.backend),
              child: const Icon(AppIcons.add),
            )
          : null,
      body: SessionListView(backend: widget.backend, listKey: _key),
    );
  }
}
