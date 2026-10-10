import 'dart:async';

import 'package:broski/models/message.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/pi_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/screens/chat/load_earlier.dart';
import 'package:broski/screens/chat/pi_durable_chat_actions.dart';
import 'package:broski/screens/chat/pi_reconnect_hydrate.dart';
import 'package:broski/screens/chat_screen.dart';
import 'package:broski/services/bridge/bridge_pi_transcript.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Convert ChatMessage to raw format for hydrate.
Map<String, dynamic> messageToRaw(ChatMessage m) {
  return {
    'info': {
      'id': m.id,
      'sessionID': m.sessionId,
      'role': m.role == MessageRole.user ? 'user' : 'assistant',
      'time': {'created': m.createdAt.millisecondsSinceEpoch},
    },
    'parts': [
      if (m.text.isNotEmpty) {'type': 'text', 'text': m.text},
      ...m.toolCalls.map(
        (t) => {
          'type': 'tool',
          'id': t.partId,
          'callID': t.callId,
          'tool': t.name,
          'state': {
            'status': t.status,
            'title': t.title,
            'input': t.input,
            'output': t.output,
            'metadata': t.metadata,
          },
        },
      ),
    ],
  };
}

/// Hydrates a chat session by loading messages from bridge or cache.
///
/// Extracted from `_ChatScreenState._hydrateSession` in `chat_screen.dart`.
///
/// [onPaginationLoaded] is called when hydration completes to set
/// `_hasLoadedAllMessages = true` (and optionally `_loadingMoreMessages = false`).
///
/// Returns `true` if `_loadSessionContext()` should be called by the caller.
Future<bool> hydrateSession({
  required WidgetRef ref,
  required ChatScreen widget,
  required bool resyncingAfterReconnect,
  required void Function({required bool loadingMore, required bool loadedAll})
  setPaginationState,
  required void Function({bool animate}) scrollToBottom,
}) async {
  final connection = ref.read(connectionProvider);
  final storage = ref.read(storageServiceProvider);
  final chat = ref.read(chatSessionProvider.notifier);
  // Reset pagination state
  setPaginationState(loadingMore: false, loadedAll: false);

  // Pi Durable: attach the live view and hydrate the committed transcript.
  if (widget.isPiDurable) {
    await hydratePiDurableSession(ref: ref, widget: widget);
    scrollToBottom(animate: false);
    setPaginationState(loadingMore: false, loadedAll: true);
    return false;
  }

  // Claude Code mode
  if (widget.isClaudeCode) {
    final cwd = widget.ccSession?.cwd ?? widget.ccDraftCwd ?? '';
    chat.setCCSession(
      sessionId: widget.ccSession?.id ?? '',
      cwd: cwd,
      model: widget.ccSession?.model ?? widget.ccDraftModel,
      title: widget.ccSession?.displayTitle ?? widget.ccDraftTitle,
    );
    final sessionId = widget.ccSession?.id;
    final parentSessionId = widget.ccSession?.parentSessionId;
    final isSubagent = widget.ccSession?.isSubagentSession == true;
    var ccHasOlder = false;
    if (sessionId != null && sessionId.isNotEmpty) {
      if (connection.isOfflineMode) {
        final cachedMessages = await storage.getCachedCCMessages(sessionId);
        if (cachedMessages.isNotEmpty) {
          chat.hydrate(cachedMessages.map((m) => messageToRaw(m)).toList());
        }
      } else {
        try {
          final bridge = ref.read(bridgeServiceProvider);
          if (isSubagent) {
            // Load subagent messages using parent session ID + agent ID
            final items = await bridge.ccGetSubagentMessages(
              sessionId: parentSessionId!,
              agentId: sessionId,
              cwd: cwd,
            );
            chat.hydrateClaudeCodeTranscript(items);
          } else {
            final page = await bridge.ccGetSessionMessagesPage(
              sessionId,
              cwd: cwd,
              limit: kTranscriptPageLimit,
            );
            chat.hydrateClaudeCodeTranscript(page.items);
            chat.setTranscriptCursor(page.nextCursor);
            ccHasOlder = page.hasOlder;
          }
          final chatState = ref.read(chatSessionProvider);
          if (chatState.messages.isNotEmpty) {
            await storage.cacheCCSessionMessages(sessionId, chatState.messages);
          }
        } catch (_) {
          final cachedMessages = await storage.getCachedCCMessages(sessionId);
          if (cachedMessages.isNotEmpty) {
            chat.hydrate(cachedMessages.map((m) => messageToRaw(m)).toList());
          }
        }
      }
    }
    scrollToBottom(animate: false);
    setPaginationState(loadingMore: false, loadedAll: !ccHasOlder);
    return false; // No need to call _loadSessionContext for CC initial hydrate
  }

  // Codex mode
  if (widget.isCodex) {
    final cwd = widget.cxThread?.cwd ?? widget.cxDraftCwd ?? '';
    final threadId = widget.cxThread?.id ?? '';
    var cxHasOlder = false;
    chat.setCodexThread(
      threadId: threadId,
      cwd: cwd,
      model: widget.cxThread?.modelProvider ?? widget.cxDraftModel,
    );
    if (threadId.isNotEmpty) {
      if (connection.isOfflineMode) {
        final cached = await storage.getCachedCodexMessages(threadId);
        if (cached.isNotEmpty) {
          chat.hydrate(cached.map((m) => messageToRaw(m)).toList());
        }
      } else {
        try {
          final page = await ref
              .read(bridgeServiceProvider)
              .cxGetThreadMessagesPage(threadId, limit: kTranscriptPageLimit);
          chat.hydrateCodexTranscript(page.items);
          chat.setTranscriptCursor(page.nextCursor);
          cxHasOlder = page.hasOlder;
          final chatState = ref.read(chatSessionProvider);
          if (chatState.messages.isNotEmpty) {
            await storage.cacheCodexThreadMessages(
              threadId,
              chatState.messages,
            );
          }
        } catch (_) {
          final cached = await storage.getCachedCodexMessages(threadId);
          if (cached.isNotEmpty) {
            chat.hydrate(cached.map((m) => messageToRaw(m)).toList());
          }
        }
      }
    }
    scrollToBottom(animate: false);
    setPaginationState(loadingMore: false, loadedAll: !cxHasOlder);
    return false;
  }

  // Pi mode
  if (widget.isPi) {
    final cwd = widget.piSession?.cwd ?? widget.piDraftCwd ?? '';
    final widgetSessionId = widget.piSession?.id ?? '';
    final isDraft = widget.piSession == null;
    final piBridge = ref.read(piBridgeServiceProvider);
    final sessionPath = widget.piSession?.path;
    final hasSessionPath = sessionPath != null && sessionPath.isNotEmpty;

    // Read-only mode: view a finished subagent transcript without touching
    // live bridge state. Read from JSONL only — do NOT switchSession,
    // newSession, or getState (those all mutate the Pi instance).
    if (widget.readOnly) {
      chat.setPiSession(
        sessionId: widgetSessionId,
        cwd: cwd,
        model: widget.piSession?.name,
      );
      if (hasSessionPath &&
          widgetSessionId.isNotEmpty &&
          !connection.isOfflineMode) {
        try {
          final items = await piBridge.readSessionMessages(
            sessionPath: sessionPath,
            sessionId: widgetSessionId,
          );
          chat.hydratePiTranscript(items);
        } catch (_) {
          // Best effort — read-only view survives without messages
        }
      }
      scrollToBottom(animate: false);
      setPaginationState(loadingMore: false, loadedAll: true);
      return false; // No need to call _loadSessionContext in read-only
    }

    // On reconnect, the session is already alive in the bridge — don't
    // create a new one or switch sessions. Just re-sync state and hydrate.
    if (resyncingAfterReconnect) {
      var piHasOlder = false;
      if (!connection.isOfflineMode) {
        try {
          final piState = await piBridge.getState(projectPath: cwd);
          chat.setPiModel(
            piState.model != null
                ? '${piState.model!.provider}/${piState.model!.id}'
                : null,
            modelData: piState.model,
          );
          chat.setPiThinkingLevel(piState.thinkingLevel);
        } catch (_) {
          // Best effort
        }
        // Drop the pre-disconnect cursor before the paged read, so a scroll to
        // the top cannot ask for a page from the old boundary.
        chat.setTranscriptCursor(null);
        try {
          piHasOlder = await hydratePiAfterReconnect(
            piBridge: piBridge,
            chat: chat,
            sessionPath: sessionPath,
            sessionId: widgetSessionId,
            projectPath: cwd,
          );
        } catch (_) {
          // Best effort
        }
      }
      scrollToBottom(animate: false);
      setPaginationState(loadingMore: false, loadedAll: !piHasOlder);
      return true; // Call _loadSessionContext
    }

    chat.setPiSession(
      sessionId: widgetSessionId,
      cwd: cwd,
      model: widget.piSession?.name,
    );

    var piHasOlder = false;

    if (isDraft && !connection.isOfflineMode) {
      // New session — create it on the bridge
      try {
        await piBridge.newSession(projectPath: cwd);
      } catch (_) {
        // Best effort — first message will still create one
      }
    } else if (hasSessionPath &&
        widgetSessionId.isNotEmpty &&
        !connection.isOfflineMode) {
      // Existing session: fast path — read messages directly from the
      // JSONL file without building a full AgentSession instance. This
      // skips model resolution, extension loading, etc. and returns
      // messages in ~100ms instead of 2-4 seconds.
      var fastPathWorked = false;
      try {
        final page = await piBridge.readSessionMessagesPage(
          sessionPath: sessionPath,
          sessionId: widgetSessionId,
          limit: kTranscriptPageLimit,
        );
        if (page.items.isNotEmpty) {
          chat.hydratePiTranscript(page.items);
          chat.setTranscriptCursor(page.nextCursor);
          piHasOlder = page.hasOlder;
          scrollToBottom(animate: false);
          fastPathWorked = true;
        }
      } catch (_) {
        // Fast path failed — fall back to full instance path below
      }

      // Background: start the live instance so it's ready when the user
      // sends a message. If the fast path failed, also load messages here.
      unawaited(
        Future(() async {
          await startPiLiveInstance(
            piBridge: piBridge,
            chat: chat,
            sessionId: widgetSessionId,
            sessionPath: sessionPath,
            projectPath: cwd,
            loadMessages: !fastPathWorked,
          );
        }),
      );
    } else if (hasSessionPath) {
      // Has path but no session ID or offline — just switch
      try {
        await piBridge.switchSession(
          sessionPath: sessionPath,
          projectPath: cwd,
        );
      } catch (_) {
        // Best effort
      }
      // Fetch state to sync model/thinking level
      if (!connection.isOfflineMode) {
        try {
          final piState = await piBridge.getState(projectPath: cwd);
          if (piState.sessionId.isNotEmpty && widgetSessionId.isEmpty) {
            chat.setPiSession(
              sessionId: piState.sessionId,
              cwd: cwd,
              model: piState.model != null
                  ? '${piState.model!.provider}/${piState.model!.id}'
                  : null,
              thinkingLevel: piState.thinkingLevel,
            );
          }
          chat.setPiModel(
            piState.model != null
                ? '${piState.model!.provider}/${piState.model!.id}'
                : null,
            modelData: piState.model,
          );
          chat.setPiThinkingLevel(piState.thinkingLevel);
        } catch (_) {
          // Best effort
        }
      }
    }
    scrollToBottom(animate: false);
    setPaginationState(loadingMore: false, loadedAll: !piHasOlder);
    return true; // Call _loadSessionContext
  }

  // OpenCode mode
  chat.setSession(widget.session, projectPath: widget.project.path);
  if (connection.isOfflineMode) {
    final cachedMessages = await storage.getCachedMessages(widget.session.id);
    if (cachedMessages.isNotEmpty) {
      chat.hydrate(cachedMessages.map((m) => messageToRaw(m)).toList());
    }
    setPaginationState(loadingMore: false, loadedAll: true);
    scrollToBottom(animate: false);
    return false;
  }
  final bridge = ref.read(bridgeServiceProvider);
  final messages = await bridge.getSessionMessages(
    widget.session.id,
    projectPath: widget.project.path,
    limit: 20,
  );
  chat.hydrate(messages);
  if (messages.length < 20) {
    setPaginationState(loadingMore: false, loadedAll: true);
  } else {
    setPaginationState(loadingMore: false, loadedAll: false);
  }
  scrollToBottom(animate: false);
  // Cache messages for offline use
  final chatState = ref.read(chatSessionProvider);
  if (chatState.messages.isNotEmpty) {
    await storage.cacheSessionMessages(widget.session.id, chatState.messages);
  }
  return true; // Call _loadSessionContext
}
