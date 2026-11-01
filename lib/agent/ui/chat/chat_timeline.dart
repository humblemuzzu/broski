import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/ui/chat/activity_card.dart';
import 'package:broski/agent/ui/chat/copy_text.dart';
import 'package:broski/agent/ui/chat/entry_views.dart';
import 'package:broski/agent/ui/chat/item_actions_sheet.dart';
import 'package:broski/agent/ui/chat/pending_prompt_view.dart';
import 'package:broski/agent/ui/chat/timeline_entry.dart';
import 'package:broski/agent/ui/chat/timeline_providers.dart';
import 'package:broski/agent/ui/chat/tool_card.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The conversation, newest at the bottom, with older history on demand.
class ChatTimeline extends ConsumerWidget {
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
  Widget build(BuildContext context, WidgetRef ref) {
    final history = ref.watch(historyTimelineProvider(session));
    final live = ref.watch(liveTimelineProvider(session));
    final finished = history.entries;
    final shown = live.length + finished.length;
    return ListView.builder(
      key: const ValueKey('chat-timeline'),
      reverse: true,
      padding: Insets.screen,
      itemCount: shown + (history.olderToLoad ? 1 : 0),
      itemBuilder: (context, index) {
        if (index == shown) {
          return TextButton(
            onPressed: () =>
                ref.read(sessionProvider(session).notifier).history.loadOlder(),
            child: const Text('Load earlier messages'),
          );
        }
        final entry = index < live.length
            ? live[live.length - 1 - index]
            : finished[shown - 1 - index];
        return KeyedSubtree(
          key: ValueKey(entry.key),
          child: _entryView(context, entry, history.finished),
        );
      },
    );
  }

  Widget _entryView(
    BuildContext context,
    TimelineEntry entry,
    Set<TranscriptItemId> finished,
  ) {
    final view = switch (entry) {
      UserEntry(:final item) => UserView(session: session, item: item),
      PendingPromptEntry(:final prompt) => PendingPromptView(
        session: session,
        prompt: prompt,
        onEdit: onEdit,
      ),
      BlockEntry() => BlockView(entry: entry),
      ToolEntry() => ToolCard(session: session, entry: entry),
      MarkerEntry(:final item) => MarkerView(item: item),
      ActivityEntry(:final item) => ActivityCard(item: item),
      DroppedEntry(:final count) => DroppedView(count: count),
    };
    final itemId = switch (entry) {
      UserEntry(:final item) => item.id,
      BlockEntry(:final id) => id,
      _ => null,
    };
    final actions = capabilities;
    final fromHere =
        actions != null &&
        hasItemActions(actions) &&
        itemId != null &&
        finished.contains(itemId);
    final text = copyableTextOf(entry);
    final copyable = text != null && text.trim().isNotEmpty;
    if (!fromHere && !copyable) return view;
    void open() => showItemActions(
      context,
      session,
      itemId: fromHere ? itemId : null,
      text: copyable ? text : null,
      capabilities: actions,
    );
    return Semantics(
      customSemanticsActions: {
        const CustomSemanticsAction(label: 'Actions from here'): open,
      },
      child: GestureDetector(onLongPress: open, child: view),
    );
  }
}
