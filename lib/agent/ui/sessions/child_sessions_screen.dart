import 'package:broski/agent/catalog/session_list_controller.dart';
import 'package:broski/agent/ui/sessions/session_list_view.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter/material.dart';

/// One session's children, newest first, paged: the sessions its subagents
/// and forks ran in.
class ChildSessionsScreen extends StatelessWidget {
  const ChildSessionsScreen({
    super.key,
    required this.backend,
    required this.parent,
  });

  final BackendDescriptor backend;
  final SessionSummary parent;

  @override
  Widget build(BuildContext context) {
    final SessionListKey key = (
      backend: backend.id,
      query: SessionQuery(archived: false, parent: parent.session),
    );
    return Scaffold(
      appBar: AppBar(
        title: Text('Under ${parent.title?.text ?? 'this session'}'),
      ),
      body: SessionListView(backend: backend, listKey: key, tools: false),
    );
  }
}
