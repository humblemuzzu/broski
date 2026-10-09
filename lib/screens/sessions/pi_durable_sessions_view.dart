import 'dart:async';

import 'package:broski/models/agent_type.dart';
import 'package:broski/models/pi_durable/pi_durable_session.dart';
import 'package:broski/models/project.dart';
import 'package:broski/models/runtime/runtime_session_summary.dart';
import 'package:broski/providers/pi_durable/pi_durable_providers.dart';
import 'package:broski/providers/selection_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/screens/chat_screen.dart';
import 'package:broski/screens/sheets/pi_durable_new_session_sheet.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:broski/widgets/pi_branding.dart';
import 'package:broski/widgets/sessions/sessions_search_bar.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Session list for the durable Pi backend. Reads the same `unified_sessions`
/// payload the other backends receive, so it renders runtime session summaries
/// instead of a backend-specific model.
class PiDurableSessionsView extends ConsumerStatefulWidget {
  const PiDurableSessionsView({super.key, required this.onRefresh});

  final Future<void> Function() onRefresh;

  @override
  ConsumerState<PiDurableSessionsView> createState() =>
      _PiDurableSessionsViewState();
}

class _PiDurableSessionsViewState extends ConsumerState<PiDurableSessionsView> {
  final _searchController = TextEditingController();
  Timer? _searchDebounce;
  String _searchQuery = '';

  @override
  void dispose() {
    _searchDebounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  void _onSearchChanged(String value) {
    _searchDebounce?.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 250), () {
      if (!mounted) return;
      setState(() => _searchQuery = value.trim().toLowerCase());
    });
  }

  Future<void> _refresh() async {
    ref.invalidate(piDurableSessionsProvider);
    await widget.onRefresh();
  }

  void _openSession(RuntimeSessionSummary session) {
    final cwd = session.cwd;
    final parts = cwd.split('/').where((part) => part.isNotEmpty).toList();
    final project = ProjectSummary(
      id: '',
      name: parts.isEmpty ? 'Project' : parts.last,
      path: cwd,
    );
    ref.read(selectionProvider.notifier).selectProject(project);
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => ChatScreen(
          project: project,
          session: sessionSummaryOf(session),
          isPiDurable: true,
        ),
      ),
    );
  }

  void _showNewSessionSheet() {
    showPiDurableNewSessionSheet(
      context: context,
      onCreated: (project, session) {
        ref.read(selectionProvider.notifier).selectProject(project);
        ref.invalidate(piDurableSessionsProvider);
        Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => ChatScreen(
              project: project,
              session: session,
              isPiDurable: true,
            ),
          ),
        );
      },
    );
  }

  Future<void> _deleteSession(RuntimeSessionSummary session) async {
    final theme = OpenCodeTheme.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: Theme.of(dialogContext).colorScheme.surface,
        title: const Text('Delete Session?'),
        content: const Text(
          'The durable session and its transcript are removed from your Mac. '
          'This cannot be undone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: Text('Delete', style: TextStyle(color: theme.error)),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    final deleted = await ref
        .read(bridgeServiceProvider)
        .unifiedDeleteSession(
          backend: AgentType.piDurable,
          sessionId: session.id,
        );
    if (!mounted) return;
    if (!deleted) {
      showError(context, 'Session is busy or could not be deleted');
      return;
    }
    ref.invalidate(piDurableSessionsProvider);
    showSuccess(context, 'Session deleted');
  }

  List<RuntimeSessionSummary> _visible(List<RuntimeSessionSummary> all) {
    final filtered = _searchQuery.isEmpty
        ? all
        : all
              .where(
                (session) =>
                    session.title.toLowerCase().contains(_searchQuery) ||
                    session.cwd.toLowerCase().contains(_searchQuery),
              )
              .toList();
    return filtered..sort((a, b) => b.updatedAtMs.compareTo(a.updatedAtMs));
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final sessionsAsync = ref.watch(piDurableSessionsProvider);

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: Row(
            children: [
              const PiDurableBadge(label: 'PI DURABLE'),
              const SizedBox(width: Spacing.sm),
              Expanded(
                child: Text(
                  'Sessions live on your Mac and resume after a restart',
                  style: TextStyle(color: theme.textMuted, fontSize: 12),
                ),
              ),
              TextButton.icon(
                onPressed: _showNewSessionSheet,
                icon: Icon(AppIcons.add, size: 16, color: theme.primary),
                label: Text(
                  'New',
                  style: TextStyle(color: theme.primary, fontSize: 13),
                ),
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: SessionsSearchBar(
            controller: _searchController,
            onChanged: _onSearchChanged,
            hintText: 'Search durable sessions...',
          ),
        ),
        const SizedBox(height: Spacing.md),
        Expanded(
          child: RefreshIndicator(
            onRefresh: _refresh,
            child: sessionsAsync.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (error, _) => _Message(
                icon: AppIcons.error,
                text: 'Could not load sessions: $error',
              ),
              data: (all) {
                final sessions = _visible(all);
                if (sessions.isEmpty) {
                  return const _Message(
                    icon: AppIcons.science,
                    text: 'No durable sessions yet',
                  );
                }
                return ListView.builder(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                  itemCount: sessions.length,
                  itemBuilder: (context, index) {
                    final session = sessions[index];
                    return Padding(
                      padding: const EdgeInsets.only(bottom: Spacing.sm),
                      child: _SessionTile(
                        session: session,
                        onTap: () => _openSession(session),
                        onDelete: () => _deleteSession(session),
                      ),
                    );
                  },
                );
              },
            ),
          ),
        ),
      ],
    );
  }
}

class _SessionTile extends StatelessWidget {
  const _SessionTile({
    required this.session,
    required this.onTap,
    required this.onDelete,
  });

  final RuntimeSessionSummary session;
  final VoidCallback onTap;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final active = session.isActive == true;
    return InkWell(
      onTap: onTap,
      onLongPress: onDelete,
      borderRadius: Radii.brMd,
      child: Container(
        padding: Insets.card,
        decoration: BoxDecoration(
          color: theme.backgroundPanel,
          borderRadius: Radii.brMd,
          border: Border.all(color: theme.borderSubtle),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    session.title.isEmpty ? session.id : session.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: theme.text,
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                if (active) Icon(AppIcons.play, size: 14, color: theme.success),
              ],
            ),
            const SizedBox(height: Spacing.xs),
            Text(
              session.cwd,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: theme.textMuted, fontSize: 12),
            ),
            if (session.modelLabel != null && session.modelLabel!.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: Spacing.xs),
                child: Text(
                  session.modelLabel!,
                  style: TextStyle(color: theme.textMuted, fontSize: 12),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _Message extends StatelessWidget {
  const _Message({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return ListView(
      padding: const EdgeInsets.all(32),
      children: [
        Center(
          child: Column(
            children: [
              Icon(icon, size: 48, color: theme.textMuted),
              const SizedBox(height: Spacing.lg),
              Text(
                text,
                textAlign: TextAlign.center,
                style: TextStyle(color: theme.textMuted, fontSize: 14),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
