import 'package:broski/agent/agent_providers.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/chat/chat_row_view.dart';
import 'package:broski/screens/agent/chat/chat_rows.dart';
import 'package:broski/screens/agent/chat/timeline_providers.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The finished part of the chat as rows, built once per history.
final historyRowsProvider = Provider.autoDispose
    .family<List<ChatRow>, SessionRef>(
      (ref, session) =>
          chatRowsOf(ref.watch(historyTimelineProvider(session)).entries),
    );

/// The live part as rows, built again only when the live timeline is.
final liveRowsProvider = Provider.autoDispose.family<List<ChatRow>, SessionRef>(
  (ref, session) => chatRowsOf(ref.watch(liveTimelineProvider(session))),
);

/// The conversation, newest at the bottom; earlier messages load once as the
/// list reaches the top, and again whenever the top row is tapped.
class ChatTimeline extends ConsumerStatefulWidget {
  const ChatTimeline({
    super.key,
    required this.session,
    required this.capabilities,
    required this.onEdit,
  });

  final SessionRef session;
  final Capabilities? capabilities;
  final ValueChanged<PromptInput> onEdit;

  @override
  ConsumerState<ChatTimeline> createState() => _ChatTimelineState();
}

class _ChatTimelineState extends ConsumerState<ChatTimeline> {
  /// The page scrolling asked for last: a read that failed is not asked for
  /// again by scrolling, only by a tap.
  Object? _scrolledFor;

  void _loadOlder() =>
      ref.read(sessionProvider(widget.session).notifier).history.loadOlder();

  void _scrolledNearTop(HistoryTimeline history) {
    final cursor = history.history.olderCursor;
    if (!history.olderToLoad || cursor == _scrolledFor) return;
    _scrolledFor = cursor;
    _loadOlder();
  }

  @override
  Widget build(BuildContext context) {
    final session = widget.session;
    final history = ref.watch(historyTimelineProvider(session));
    final finished = ref.watch(historyRowsProvider(session));
    final live = ref.watch(liveRowsProvider(session));
    final shown = live.length + finished.length;
    final older = history.olderToLoad;
    return NotificationListener<ScrollNotification>(
      onNotification: (scroll) {
        if (scroll.metrics.extentAfter < 400) _scrolledNearTop(history);
        return false;
      },
      child: ListView.builder(
        key: const ValueKey('chat-timeline'),
        reverse: true,
        cacheExtent: 500,
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 12),
        itemCount: shown + (older ? 1 : 0),
        itemBuilder: (context, index) {
          if (index == shown) return _LoadEarlier(onTap: _loadOlder);
          final row = index < live.length
              ? live[live.length - 1 - index]
              : finished[shown - 1 - index];
          return KeyedSubtree(
            key: ValueKey(row.key),
            child: ChatRowView(
              session: session,
              row: row,
              capabilities: widget.capabilities,
              finished: history.finished,
              onEdit: widget.onEdit,
            ),
          );
        },
      ),
    );
  }
}

class _LoadEarlier extends StatelessWidget {
  const _LoadEarlier({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => GestureDetector(
    key: const ValueKey('load-earlier'),
    onTap: onTap,
    child: Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Center(
        child: Text(
          '↑ Scroll up to load earlier messages',
          style: TextStyle(
            color: OpenCodeTheme.of(context).textMuted,
            fontSize: 12,
          ),
        ),
      ),
    ),
  );
}
