import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/pi.dart';
import '../../providers/pi_provider.dart';

Future<void> showPiSessionSidebarSheet({
  required BuildContext context,
  required String cwd,
  required String currentSessionId,
  required PiState? state,
  required void Function(PiSessionInfo session) onOpenSession,
  required void Function(String entryId) onForkFromEntry,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => _PiSessionSidebarSheet(
      cwd: cwd,
      currentSessionId: currentSessionId,
      state: state,
      onOpenSession: onOpenSession,
      onForkFromEntry: onForkFromEntry,
    ),
  );
}

class _PiSessionSidebarSheet extends ConsumerStatefulWidget {
  const _PiSessionSidebarSheet({
    required this.cwd,
    required this.currentSessionId,
    required this.state,
    required this.onOpenSession,
    required this.onForkFromEntry,
  });

  final String cwd;
  final String currentSessionId;
  final PiState? state;
  final void Function(PiSessionInfo session) onOpenSession;
  final void Function(String entryId) onForkFromEntry;

  @override
  ConsumerState<_PiSessionSidebarSheet> createState() =>
      _PiSessionSidebarSheetState();
}

class _PiSessionSidebarSheetState
    extends ConsumerState<_PiSessionSidebarSheet> {
  bool _loadingForks = true;
  bool _loadingContextFiles = true;
  List<PiForkMessage> _forkMessages = const [];
  List<String> _contextFiles = const [];

  @override
  void initState() {
    super.initState();
    _loadForks();
    _loadContextFiles();
  }

  Future<void> _loadForks() async {
    setState(() => _loadingForks = true);
    try {
      final bridge = ref.read(piBridgeServiceProvider);
      final forks = await bridge.getForkMessages(projectPath: widget.cwd);
      if (!mounted) return;
      setState(() {
        _forkMessages = forks;
        _loadingForks = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _forkMessages = const [];
        _loadingForks = false;
      });
    }
  }

  Future<void> _loadContextFiles() async {
    setState(() => _loadingContextFiles = true);
    try {
      final bridge = ref.read(piBridgeServiceProvider);
      final messages = await bridge.getMessages(projectPath: widget.cwd);
      final files = <String>{};

      for (final message in messages) {
        final toolCalls = message['toolCalls'];
        if (toolCalls is! List<dynamic>) continue;

        for (final call in toolCalls) {
          if (call is! Map<String, dynamic>) continue;
          final arguments = call['arguments'];
          if (arguments is! Map<String, dynamic>) continue;

          for (final key in const ['path', 'file', 'oldPath', 'newPath']) {
            final value = arguments[key];
            if (value is String && value.trim().isNotEmpty) {
              files.add(value.trim());
            }
          }
        }
      }

      if (!mounted) return;
      setState(() {
        _contextFiles = files.toList()..sort();
        _loadingContextFiles = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _contextFiles = const [];
        _loadingContextFiles = false;
      });
    }
  }

  Future<void> _toggleSteeringMode() async {
    final currentState =
        ref.read(piStateProvider(widget.cwd)).valueOrNull ?? widget.state;
    final current = currentState?.steeringMode ?? 'all';
    final next = current == 'all' ? 'one-at-a-time' : 'all';
    final bridge = ref.read(piBridgeServiceProvider);
    await bridge.setSteeringMode(mode: next, projectPath: widget.cwd);
    ref.invalidate(piStateProvider(widget.cwd));
  }

  Future<void> _toggleFollowUpMode() async {
    final currentState =
        ref.read(piStateProvider(widget.cwd)).valueOrNull ?? widget.state;
    final current = currentState?.followUpMode ?? 'all';
    final next = current == 'all' ? 'one-at-a-time' : 'all';
    final bridge = ref.read(piBridgeServiceProvider);
    await bridge.setFollowUpMode(mode: next, projectPath: widget.cwd);
    ref.invalidate(piStateProvider(widget.cwd));
  }

  Future<void> _toggleAutoRetry() async {
    final currentState =
        ref.read(piStateProvider(widget.cwd)).valueOrNull ?? widget.state;
    final current = currentState?.autoRetryEnabled ?? true;
    final bridge = ref.read(piBridgeServiceProvider);
    await bridge.setAutoRetry(enabled: !current, projectPath: widget.cwd);
    ref.invalidate(piStateProvider(widget.cwd));
  }

  Future<void> _toggleAutoCompaction() async {
    final currentState =
        ref.read(piStateProvider(widget.cwd)).valueOrNull ?? widget.state;
    final current = currentState?.autoCompactionEnabled ?? true;
    final bridge = ref.read(piBridgeServiceProvider);
    await bridge.setAutoCompaction(enabled: !current, projectPath: widget.cwd);
    ref.invalidate(piStateProvider(widget.cwd));
  }

  @override
  Widget build(BuildContext context) {
    final sessionsAsync = ref.watch(piSessionsProvider(null));
    final statsAsync = ref.watch(piSessionStatsProvider(widget.cwd));
    final liveState = ref.watch(piStateProvider(widget.cwd)).valueOrNull;
    final effectiveState = liveState ?? widget.state;

    return SafeArea(
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * 0.86,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
          children: [
            Text(
              'Session Sidebar',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 10),
            _ModeRow(
              title: 'Steering mode',
              value: effectiveState?.steeringMode ?? 'all',
              onTap: _toggleSteeringMode,
            ),
            _ModeRow(
              title: 'Follow-up mode',
              value: effectiveState?.followUpMode ?? 'all',
              onTap: _toggleFollowUpMode,
            ),
            _ModeRow(
              title: 'Auto retry',
              value: (effectiveState?.autoRetryEnabled ?? true) ? 'on' : 'off',
              onTap: _toggleAutoRetry,
            ),
            _ModeRow(
              title: 'Auto compaction',
              value: (effectiveState?.autoCompactionEnabled ?? true)
                  ? 'on'
                  : 'off',
              onTap: _toggleAutoCompaction,
            ),
            const Divider(height: 24),
            Text(
              'Session Stats',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            statsAsync.when(
              data: (stats) => Text(
                'Messages: ${stats.totalMessages}\n'
                'Tokens: ${stats.tokens.total}\n'
                'Cost: ${stats.cost.toStringAsFixed(4)}',
              ),
              loading: () => const LinearProgressIndicator(minHeight: 2),
              error: (error, _) => Text('Failed to load stats: $error'),
            ),
            const Divider(height: 24),
            Row(
              children: [
                Text(
                  'Fork Points',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const Spacer(),
                IconButton(
                  tooltip: 'Refresh',
                  icon: const Icon(Icons.refresh),
                  onPressed: _loadForks,
                ),
              ],
            ),
            if (_loadingForks)
              const LinearProgressIndicator(minHeight: 2)
            else if (_forkMessages.isEmpty)
              const Text('No fork points available.')
            else
              ..._forkMessages.take(8).map((entry) {
                return ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  title: Text(
                    entry.text,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  trailing: const Icon(Icons.call_split),
                  onTap: () => widget.onForkFromEntry(entry.entryId),
                );
              }),
            const Divider(height: 24),
            Text(
              'Context Files',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            if (_loadingContextFiles)
              const LinearProgressIndicator(minHeight: 2)
            else if (_contextFiles.isEmpty)
              const Text('No context files captured yet.')
            else
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: _contextFiles
                    .take(18)
                    .map(
                      (path) => Chip(
                        label: Text(path, overflow: TextOverflow.ellipsis),
                      ),
                    )
                    .toList(),
              ),
            const Divider(height: 24),
            Text(
              'Session History',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            sessionsAsync.when(
              data: (sessions) {
                final sorted = [...sessions]
                  ..sort((a, b) => b.modified.compareTo(a.modified));

                return Column(
                  children: sorted.take(12).map((session) {
                    final isCurrent = session.id == widget.currentSessionId;
                    final title = (session.name ?? '').trim().isNotEmpty
                        ? session.name!.trim()
                        : session.firstMessage.trim().isNotEmpty
                        ? session.firstMessage.trim()
                        : session.id;

                    return ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      title: Text(
                        title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      subtitle: Text(
                        '${session.cwd} • ${session.messageCount} msgs',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      trailing: isCurrent
                          ? const Icon(Icons.check_circle_outline)
                          : const Icon(Icons.chevron_right),
                      onTap: () => widget.onOpenSession(session),
                    );
                  }).toList(),
                );
              },
              loading: () => const LinearProgressIndicator(minHeight: 2),
              error: (error, _) => Text('Failed to load sessions: $error'),
            ),
          ],
        ),
      ),
    );
  }
}

class _ModeRow extends StatelessWidget {
  const _ModeRow({
    required this.title,
    required this.value,
    required this.onTap,
  });

  final String title;
  final String value;
  final Future<void> Function() onTap;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      dense: true,
      contentPadding: EdgeInsets.zero,
      title: Text(title),
      subtitle: Text(value),
      trailing: const Icon(Icons.swap_horiz),
      onTap: () => onTap(),
    );
  }
}
