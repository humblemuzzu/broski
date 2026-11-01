import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/ui/backend_label.dart';
import 'package:broski/agent/ui/sessions/session_list_actions.dart';
import 'package:broski/agent/ui/sessions/session_list_view.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/design_tokens.dart';
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
    final theme = Theme.of(context);
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: SafeArea(
        child: AdaptiveContainer(
          width: ContentWidth.standard,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 16, 12, 8),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        '${backendLabel(widget.backend)} sessions',
                        style: TextStyle(
                          color: theme.colorScheme.onSurface,
                          fontSize: 28,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    if (descriptor != null && live)
                      SessionListActions(
                        backend: descriptor,
                        archived: _archived,
                        onArchivedChanged: (archived) =>
                            setState(() => _archived = archived),
                      ),
                  ],
                ),
              ),
              Expanded(
                child: descriptor == null
                    ? _Unavailable(
                        backend: widget.backend,
                        loaded: backends.loaded,
                      )
                    : SessionListView(
                        backend: descriptor,
                        listKey: (
                          backend: widget.backend,
                          query: SessionQuery(archived: _archived),
                        ),
                        bottomPadding: 100,
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Unavailable extends StatelessWidget {
  const _Unavailable({required this.backend, required this.loaded});

  final BackendId backend;
  final bool loaded;

  @override
  Widget build(BuildContext context) {
    final text = loaded
        ? '${backendLabel(backend)} is not available on this Mac.'
        : 'Waiting for the connection to list ${backendLabel(backend)}.';
    return Center(
      child: Padding(
        padding: Insets.screen,
        child: Text(text, textAlign: TextAlign.center),
      ),
    );
  }
}
