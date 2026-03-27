import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/pi.dart';
import '../../providers/chat_provider.dart';
import '../../providers/pi_provider.dart';
import '../sheets/pi_session_sidebar_sheet.dart';

/// Compact the Pi session context.
/// Extracted from `_ChatScreenState._piCompact`.
Future<void> piCompact({
  required BuildContext context,
  required WidgetRef ref,
}) async {
  final piBridge = ref.read(piBridgeServiceProvider);
  final chatState = ref.read(chatSessionProvider);
  try {
    await piBridge.compact(projectPath: chatState.piCwd);
    if (context.mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Context compacted')));
    }
  } catch (e) {
    if (context.mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('Compact failed: $e')));
    }
  }
}

/// Create a new Pi session.
/// Extracted from `_ChatScreenState._piNewSession`.
Future<void> piNewSession({
  required BuildContext context,
  required WidgetRef ref,
}) async {
  final piBridge = ref.read(piBridgeServiceProvider);
  final chatState = ref.read(chatSessionProvider);
  final cwd = chatState.piCwd ?? '';
  try {
    await piBridge.newSession(projectPath: cwd);
    final piState = await piBridge.getState(projectPath: cwd);
    ref
        .read(chatSessionProvider.notifier)
        .setPiSession(
          sessionId: piState.sessionId,
          cwd: cwd,
          model: piState.model != null
              ? '${piState.model!.provider}/${piState.model!.id}'
              : null,
          thinkingLevel: piState.thinkingLevel,
        );
    ref.invalidate(piSessionsProvider(null));
    if (context.mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('New session created')));
    }
  } catch (e) {
    if (context.mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('Failed: $e')));
    }
  }
}

/// Cycle the Pi thinking level to the next value.
/// Extracted from `_ChatScreenState._cyclePiThinkingLevel`.
Future<void> cyclePiThinkingLevel({
  required BuildContext context,
  required WidgetRef ref,
}) async {
  final piBridge = ref.read(piBridgeServiceProvider);
  final chatState = ref.read(chatSessionProvider);
  try {
    final newLevel = await piBridge.cycleThinkingLevel(
      projectPath: chatState.piCwd,
    );
    ref.read(chatSessionProvider.notifier).setPiThinkingLevel(newLevel);
  } catch (e) {
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Failed to cycle thinking level: $e')),
    );
  }
}

/// Fork a Pi session from a specific entry.
/// Extracted from `_ChatScreenState._forkPiSessionFromEntry`.
Future<void> forkPiSessionFromEntry({
  required BuildContext context,
  required WidgetRef ref,
  required String entryId,
}) async {
  final piBridge = ref.read(piBridgeServiceProvider);
  final chatState = ref.read(chatSessionProvider);
  try {
    final result = await piBridge.fork(
      entryId: entryId,
      projectPath: chatState.piCwd,
    );
    if (!context.mounted) return;
    if (!result.cancelled) {
      ref.invalidate(piStateProvider(chatState.piCwd));
      ref.invalidate(piSessionsProvider(null));
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Session forked')));
    }
  } catch (e) {
    if (!context.mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text('Failed to fork session: $e')));
  }
}

/// Set Pi thinking level by wire value string.
/// Extracted from `_ChatScreenState._setPiThinkingLevel`.
void setPiThinkingLevel({required WidgetRef ref, required String? wireValue}) {
  if (wireValue == null) return;
  final level = PiThinkingLevel.fromWireValue(wireValue);
  final piBridge = ref.read(piBridgeServiceProvider);
  final chatState = ref.read(chatSessionProvider);
  piBridge
      .setThinkingLevel(level: level, projectPath: chatState.piCwd)
      .then(
        (_) => ref.read(chatSessionProvider.notifier).setPiThinkingLevel(level),
      );
}

/// Show the Pi sidebar sheet for session management.
/// Extracted from `_ChatScreenState._showPiSidebarSheet`.
void showPiSidebarSheetAction({
  required BuildContext context,
  required WidgetRef ref,
  required void Function(String entryId) onForkFromEntry,
}) {
  final chatState = ref.read(chatSessionProvider);
  final cwd = chatState.piCwd;
  if (cwd == null || cwd.isEmpty) return;
  showPiSessionSidebarSheet(
    context: context,
    cwd: cwd,
    currentSessionId: chatState.piSessionId ?? '',
    state: null,
    onOpenSession: (session) {
      Navigator.pop(context);
      ref
          .read(chatSessionProvider.notifier)
          .setPiSession(sessionId: session.id, cwd: session.cwd);
    },
    onForkFromEntry: (entryId) {
      Navigator.pop(context);
      onForkFromEntry(entryId);
    },
  );
}
