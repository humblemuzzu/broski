import 'dart:async';

import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/pi_provider.dart';
import 'package:broski/screens/chat/hydration/hydration.dart';
import 'package:broski/screens/chat/load_earlier.dart';
import 'package:broski/screens/chat/pi_reconnect_hydrate.dart';
import 'package:broski/services/bridge/bridge_page_fetch.dart';
import 'package:broski/services/bridge/bridge_pi_transcript.dart';

/// Opens a Pi chat: a page of its transcript, then the live instance behind it.
Future<bool> hydratePi(
  Hydration h, {
  required bool resyncingAfterReconnect,
}) async {
  final ref = h.ref;
  final widget = h.widget;
  final chat = h.chat;
  final connection = ref.read(connectionProvider);
  final setPaginationState = h.setPaginationState;
  final scrollToBottom = h.scrollToBottom;
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
        final page = await fetchBridgePage(
          (limit) => piBridge.readSessionMessagesPage(
            sessionPath: sessionPath,
            sessionId: widgetSessionId,
            limit: limit,
          ),
          limit: kTranscriptPageLimit,
        );
        chat.hydratePiTranscript(page.items);
      } catch (_) {
        transcriptUnavailable();
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
        transcriptUnavailable();
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
      final page = await fetchBridgePage(
        (limit) => piBridge.readSessionMessagesPage(
          sessionPath: sessionPath,
          sessionId: widgetSessionId,
          limit: limit,
        ),
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
      // Fast path failed — the live instance below reads a page of its own
    }

    // Background: start the live instance so it's ready when the user
    // sends a message. If the fast path failed, it loads a page too.
    unawaited(
      Future(() async {
        try {
          final hasOlder = await startPiLiveInstance(
            piBridge: piBridge,
            chat: chat,
            sessionId: widgetSessionId,
            sessionPath: sessionPath,
            projectPath: cwd,
            loadMessages: !fastPathWorked,
          );
          if (hasOlder != null) {
            setPaginationState(loadingMore: false, loadedAll: !hasOlder);
          }
        } catch (_) {
          transcriptUnavailable();
        }
      }),
    );
  } else if (hasSessionPath) {
    // Has path but no session ID or offline — just switch
    try {
      await piBridge.switchSession(sessionPath: sessionPath, projectPath: cwd);
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
