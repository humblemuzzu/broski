import 'package:broski/models/pi.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/pi_provider.dart';
import 'package:broski/screens/sheets/pi_session_sidebar_sheet.dart';
import 'package:broski/services/pi_bridge_service.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

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
      showInfo(context, 'Context compacted');
    }
  } catch (e) {
    if (context.mounted) {
      showInfo(context, 'Compact failed: $e');
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
    ref.read(piSessionsProvider(null).notifier).refresh();
    if (context.mounted) {
      showInfo(context, 'New session created');
    }
  } catch (e) {
    if (context.mounted) {
      showInfo(context, 'Failed: $e');
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
    showInfo(context, 'Failed to cycle thinking level: $e');
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
      ref.read(piSessionsProvider(null).notifier).refresh();
      showInfo(context, 'Session forked');
    }
  } catch (e) {
    if (!context.mounted) return;
    showInfo(context, 'Failed to fork session: $e');
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

/// Export the current Pi session (HTML format).
Future<void> piExportSession({
  required BuildContext context,
  required WidgetRef ref,
}) async {
  final piBridge = ref.read(piBridgeServiceProvider);
  final chatState = ref.read(chatSessionProvider);
  try {
    final path = await piBridge.exportHtml(projectPath: chatState.piCwd);
    if (context.mounted) {
      showInfo(context, 'Exported to $path');
    }
  } catch (e) {
    if (context.mounted) {
      showError(context, 'Export failed: $e');
    }
  }
}

/// Abort compaction for the current Pi session.
Future<void> piAbortCompaction({
  required BuildContext context,
  required WidgetRef ref,
}) async {
  final piBridge = ref.read(piBridgeServiceProvider);
  final chatState = ref.read(chatSessionProvider);
  try {
    await piBridge.abortCompaction(projectPath: chatState.piCwd);
    if (context.mounted) {
      showInfo(context, 'Compaction cancelled');
    }
  } catch (e) {
    if (context.mounted) {
      showError(context, 'Cancel failed: $e');
    }
  }
}

/// Abort retry for the current Pi session.
Future<void> piAbortRetry({
  required BuildContext context,
  required WidgetRef ref,
}) async {
  final piBridge = ref.read(piBridgeServiceProvider);
  final chatState = ref.read(chatSessionProvider);
  try {
    await piBridge.abortRetry(projectPath: chatState.piCwd);
    if (context.mounted) {
      showInfo(context, 'Retry cancelled');
    }
  } catch (e) {
    if (context.mounted) {
      showError(context, 'Cancel failed: $e');
    }
  }
}

/// Copy the last Pi assistant response to clipboard.
Future<void> piCopyLastResponse({
  required BuildContext context,
  required WidgetRef ref,
}) async {
  final piBridge = ref.read(piBridgeServiceProvider);
  final chatState = ref.read(chatSessionProvider);
  try {
    final text = await piBridge.getLastAssistantText(
      projectPath: chatState.piCwd,
    );
    if (text != null && text.isNotEmpty) {
      await Clipboard.setData(ClipboardData(text: text));
      if (context.mounted) {
        showInfo(context, 'Copied to clipboard');
      }
    } else {
      if (context.mounted) {
        showInfo(context, 'No assistant response to copy');
      }
    }
  } catch (e) {
    if (context.mounted) {
      showError(context, 'Copy failed: $e');
    }
  }
}
