import 'package:broski/models/vcs.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/opencode_variant_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/services/haptics_service.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Sends the initial prompt if present and conditions are met.
/// Extracted from `_ChatScreenState._maybeSendInitialPrompt` in `chat_screen.dart`.
///
/// Returns `true` if the initial prompt was consumed (either sent or skipped
/// because the session already has messages), `false` if it could not be sent
/// yet (e.g. not connected, no prompt).
bool maybeSendInitialPrompt({
  required WidgetRef ref,
  required String? initialPrompt,
  required bool alreadySent,
  required TextEditingController controller,
  required void Function(BridgeConnectionState, ChatSessionState) sendMessage,
}) {
  if (alreadySent) return true;
  final prompt = initialPrompt?.trim() ?? '';
  if (prompt.isEmpty) return false;
  final connection = ref.read(connectionProvider);
  if (!connection.isConnected) return false;
  final chatState = ref.read(chatSessionProvider);
  if (chatState.messages.isNotEmpty) return true;
  controller.text = prompt;
  sendMessage(connection, chatState);
  return true;
}

/// Loads VCS/Git info for the session, with offline-cache fallback.
/// Extracted from `_ChatScreenState._loadVcsInfo` in `chat_screen.dart`.
Future<VcsInfo?> loadVcsInfo({
  required WidgetRef ref,
  required String sessionId,
  required String projectPath,
}) async {
  final storage = ref.read(storageServiceProvider);
  final connection = ref.read(connectionProvider);
  // Offline mode — use cached VCS info
  if (connection.isOfflineMode) {
    final cachedVcs = await storage.getCachedSessionVcs(sessionId);
    if (cachedVcs != null) {
      ref.read(chatSessionProvider.notifier).setVcsInfo(cachedVcs);
    }
    return cachedVcs;
  }
  try {
    final bridge = ref.read(bridgeServiceProvider);
    final vcsInfo = await bridge.getVcsInfo(projectPath: projectPath);
    ref.read(chatSessionProvider.notifier).setVcsInfo(vcsInfo);
    if (vcsInfo.isAvailable) {
      await storage.cacheSessionVcs(sessionId, vcsInfo);
    }
    return vcsInfo;
  } catch (e) {
    final cachedVcs = await storage.getCachedSessionVcs(sessionId);
    if (cachedVcs != null) {
      ref.read(chatSessionProvider.notifier).setVcsInfo(cachedVcs);
    }
    return cachedVcs;
  }
}

/// Sets the Claude Code "resume from here" message ID and shows a snackbar.
/// Extracted from `_ChatScreenState._setClaudeResumeFromHere` in `chat_screen.dart`.
void setClaudeResumeFromHere({
  required BuildContext context,
  required String messageId,
  required HapticsService haptics,
  required void Function(String?) onResumeIdChanged,
}) {
  if (messageId.isEmpty) return;
  haptics.lightImpact();
  onResumeIdChanged(messageId);
  showInfo(context, 'Claude will resume from this message on your next send.');
}

/// Loads available variants (thinking levels) for OpenCode models.
/// Extracted from `_ChatScreenState._loadOpenCodeVariants` in `chat_screen.dart`.
Future<void> loadOpenCodeVariants({
  required WidgetRef ref,
  required bool isOpenCode,
}) async {
  if (!isOpenCode) return;
  final bridge = ref.read(bridgeServiceProvider);
  try {
    final providersData = await bridge.listProviders();
    ref
        .read(openCodeVariantProvider.notifier)
        .updateAvailableVariants(providersData);
  } catch (e) {
    // Silently fail — variants are optional
    debugPrint('Failed to load OpenCode variants: $e');
  }
}
