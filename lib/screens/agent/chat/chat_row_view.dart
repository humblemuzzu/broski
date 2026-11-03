import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/chat/activity_card.dart';
import 'package:broski/screens/agent/chat/chat_rows.dart';
import 'package:broski/screens/agent/chat/item_actions_sheet.dart';
import 'package:broski/screens/agent/chat/message_views.dart';
import 'package:broski/screens/agent/chat/pending_prompt_view.dart';
import 'package:broski/screens/agent/chat/timeline_entry.dart';
import 'package:broski/screens/agent/chat/turn_view.dart';
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';

/// Where a row's "from here" actions act: forks before [before] or through
/// [through], item operations on [through].
typedef _FromHere = ({
  TranscriptItemId? before,
  TranscriptItemId? through,
  String? text,
});

/// One row of the chat. What a person wrote and what the agent wrote can be
/// long-pressed for their actions: copy, and from a finished item, fork the
/// session there and the backend's item operations.
class ChatRowView extends StatelessWidget {
  const ChatRowView({
    super.key,
    required this.session,
    required this.row,
    required this.capabilities,
    required this.finished,
    required this.onEdit,
  });

  final SessionRef session;
  final ChatRow row;
  final Capabilities? capabilities;
  final Set<TranscriptItemId> finished;
  final ValueChanged<PromptInput> onEdit;

  @override
  Widget build(BuildContext context) {
    final (view, fromHere) = switch (row) {
      final TurnRow turn => (
        TurnView(session: session, row: turn),
        (before: turn.firstBlockId, through: turn.lastBlockId, text: turn.text),
      ),
      EntryRow(:final entry) => (_entryView(entry), _entryFromHere(entry)),
    };
    return _withActions(context, view, fromHere);
  }

  Widget _entryView(TimelineEntry entry) => switch (entry) {
    UserEntry(:final item) => UserMessageView(session: session, item: item),
    PendingPromptEntry(:final prompt) => PendingPromptView(
      session: session,
      prompt: prompt,
      onEdit: onEdit,
    ),
    MarkerEntry(:final item) => MarkerView(item: item),
    ActivityEntry(:final item) => Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: ActivityCard(item: item),
    ),
    DroppedEntry(:final count) => DroppedView(count: count),
    BlockEntry() || ToolEntry() => const SizedBox.shrink(),
  };

  _FromHere _entryFromHere(TimelineEntry entry) => switch (entry) {
    UserEntry(:final item) => (
      before: item.id,
      through: item.id,
      text: item.text,
    ),
    _ => (before: null, through: null, text: null),
  };

  Widget _withActions(BuildContext context, Widget view, _FromHere at) {
    final actions = capabilities;
    final through = at.through;
    final before = at.before ?? through;
    final fromHere =
        actions != null &&
        hasItemActions(actions) &&
        through != null &&
        before != null &&
        finished.contains(through) &&
        finished.contains(before);
    final text = at.text;
    final copyable = text != null && text.trim().isNotEmpty;
    if (!fromHere && !copyable) return view;
    void open() => showItemActions(
      context,
      session,
      itemId: fromHere ? through : null,
      beforeItemId: fromHere ? before : null,
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
