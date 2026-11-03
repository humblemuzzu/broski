import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/session/agent_session_state.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/chat/copy_text.dart';
import 'package:broski/screens/agent/panels/panel_registry.dart';
import 'package:broski/screens/agent/panels/panels_sheet.dart';
import 'package:broski/screens/agent/sessions/session_openers.dart';
import 'package:broski/screens/agent/shared/text_entry_dialog.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The chat's More sheet: what can be done with the conversation (copy it,
/// compact it, go on in a fork), then the backend's operations on the
/// session and its project, each where the capabilities allow it.
void showChatMore(
  BuildContext context,
  WidgetRef ref, {
  required SessionRef session,
  required AgentSessionState state,
  required Capabilities capabilities,
}) => showPanelsSheet(
  context,
  _panels(state, capabilities),
  sessionTarget(session, cwd: state.summary?.cwd),
  entries: _entries(
    ref,
    session,
    state,
    capabilities,
    ref.read(lastAnswerProvider(session)),
  ),
);

/// Whether the More sheet would hold anything; without, the chat offers no
/// way to it. Called while building, so it follows the newest answer.
bool chatMoreOffers(
  WidgetRef ref, {
  required SessionRef session,
  required AgentSessionState state,
  required Capabilities capabilities,
}) =>
    _panels(state, capabilities).isNotEmpty ||
    _entries(
      ref,
      session,
      state,
      capabilities,
      ref.watch(lastAnswerProvider(session)),
    ).isNotEmpty;

List<OpPanel> _panels(AgentSessionState state, Capabilities capabilities) => [
  ...panelsAt(capabilities, OpPlace.session, controllable: state.controllable),
  if (state.summary?.cwd != null) ...panelsAt(capabilities, OpPlace.project),
];

List<SheetEntry> _entries(
  WidgetRef ref,
  SessionRef session,
  AgentSessionState state,
  Capabilities capabilities,
  String? lastAnswer,
) {
  return [
    if (lastAnswer != null) ...[
      (
        key: 'chat-copy-last',
        icon: AppIcons.copy,
        label: 'Copy last answer',
        detail: 'What the agent said last',
        run: (screen) => copyToClipboard(screen, lastAnswer),
      ),
      (
        key: 'chat-copy-conversation',
        icon: AppIcons.fileText,
        label: 'Copy conversation',
        detail: 'What was said so far, as Markdown',
        run: (screen) async {
          final text = conversationNow(ref, session);
          if (text != null) await copyToClipboard(screen, text);
        },
      ),
    ],
    if (state.controllable && (state.capabilities?.compact ?? false))
      (
        key: 'chat-compact',
        icon: AppIcons.compress,
        label: 'Compact',
        detail: 'Summarise the conversation to free the context',
        run: (screen) => _compact(screen, ref, session),
      ),
    if (capabilities.fork)
      (
        key: 'chat-open-as-fork',
        icon: AppIcons.callSplit,
        label: 'Open as fork',
        detail: 'A copy to go on with; this session stays as it is',
        run: (screen) => openAsFork(screen, ref, session),
      ),
  ];
}

Future<void> _compact(
  BuildContext context,
  WidgetRef ref,
  SessionRef session,
) async {
  final instructions = await askForText(
    context,
    title: 'Compact the conversation',
    action: 'Compact',
    hint: 'Instructions (optional)',
    allowEmpty: true,
  );
  if (instructions == null) return;
  await ref
      .read(sessionProvider(session).notifier)
      .controls
      .compact(instructions: instructions.isEmpty ? null : instructions);
}
