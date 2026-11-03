import 'package:broski/agent/agent_providers.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/models/selected_backend.dart';
import 'package:broski/providers/sessions/contract_title_filters_provider.dart';
import 'package:broski/screens/agent/sessions/session_list_actions.dart';
import 'package:broski/screens/agent/sessions/session_list_header.dart';
import 'package:broski/screens/agent/sessions/session_list_view.dart';
import 'package:broski/screens/ai_backend/selected_backend_label.dart';
import 'package:broski/screens/sessions/contract_title_filters_sheet.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/responsive.dart';
import 'package:broski/widgets/adaptive_container.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The Sessions tab while a contract backend is selected: its sessions from
/// `lib/agent`, in the place the other backends' lists stand.
class ContractSessionsTab extends ConsumerStatefulWidget {
  const ContractSessionsTab({super.key, required this.backend});

  final BackendId backend;

  @override
  ConsumerState<ContractSessionsTab> createState() =>
      _ContractSessionsTabState();
}

class _ContractSessionsTabState extends ConsumerState<ContractSessionsTab> {
  var _archived = false;

  @override
  Widget build(BuildContext context) {
    final backends = ref.watch(backendsProvider);
    final descriptor = backends.backends
        .where((listed) => listed.id == widget.backend)
        .firstOrNull;
    final live = ref.watch(liveProvider);
    final filters = ref.watch(contractTitleFiltersProvider(widget.backend));
    final listKey = (
      backend: widget.backend,
      query: SessionQuery(archived: _archived),
    );
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: SafeArea(
        child: AdaptiveContainer(
          width: ContentWidth.standard,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _SessionsHeader(
                backend: widget.backend,
                descriptor: descriptor,
                live: live,
                archived: _archived,
                onArchivedChanged: (archived) =>
                    setState(() => _archived = archived),
              ),
              Expanded(
                child: descriptor == null
                    ? _Unavailable(
                        backend: widget.backend,
                        loaded: backends.loaded,
                      )
                    : SessionListView(
                        backend: descriptor,
                        listKey: listKey,
                        bottomPadding: 100,
                        hidden: (row) => hiddenByTitleFilters(filters, row),
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SessionsHeader extends ConsumerWidget {
  const _SessionsHeader({
    required this.backend,
    required this.descriptor,
    required this.live,
    required this.archived,
    required this.onArchivedChanged,
  });

  final BackendId backend;
  final BackendDescriptor? descriptor;

  /// Whether the daemon is reachable, so a listing or a new session can ask.
  final bool live;
  final bool archived;
  final ValueChanged<bool> onArchivedChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final descriptor = this.descriptor;
    final listKey = (backend: backend, query: SessionQuery(archived: archived));
    return SessionListHeader(
      backend: backend,
      title:
          '${ContractSelection(backend).displayName} '
          'sessions',
      actions: descriptor == null || !live
          ? null
          : SessionListActions(
              backend: descriptor,
              archived: archived,
              onArchivedChanged: onArchivedChanged,
              onRefresh: () =>
                  ref.read(sessionListProvider(listKey).notifier).refresh(),
            ),
    );
  }
}

String _name(BackendId backend) => ContractSelection(backend).displayName;

class _Unavailable extends StatelessWidget {
  const _Unavailable({required this.backend, required this.loaded});

  final BackendId backend;
  final bool loaded;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final text = loaded
        ? '${_name(backend)} is not available on this Mac.'
        : 'Waiting for the connection to list ${_name(backend)}.';
    return Center(
      child: Padding(
        padding: Insets.screen,
        child: Text(
          text,
          textAlign: TextAlign.center,
          style: TextStyle(color: theme.textMuted, fontSize: 14),
        ),
      ),
    );
  }
}
