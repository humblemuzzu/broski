import 'package:broski/screens/chat/pi_durable_chat_actions.dart';
import 'package:broski/widgets/chat/pi_durable_actions_content.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Routes the durable actions sheet's ids to their handlers. Stop, model and
/// compact come from the chat screen; copy and delete own their own dialogs.
void handlePiDurableMenuAction(
  BuildContext context,
  WidgetRef ref,
  String value, {
  required VoidCallback onStop,
  required VoidCallback onShowModel,
}) {
  dispatchPiDurableAction(
    value,
    PiDurableActionHandlers(
      onStop: onStop,
      onShowModel: onShowModel,
      onCompact: () => pdCompactSession(context: context, ref: ref),
      onCopySessionId: () => pdCopySessionId(context: context, ref: ref),
      onDelete: () => pdDeleteSession(context: context, ref: ref),
    ),
  );
}
