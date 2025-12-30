import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/claude_code.dart';
import '../services/bridge_service.dart';
import 'service_providers.dart';

final ccSessionsProvider =
    StateNotifierProvider<
      CCSessionsNotifier,
      AsyncValue<List<ClaudeCodeSession>>
    >((ref) {
      final bridge = ref.watch(bridgeServiceProvider);
      return CCSessionsNotifier(bridge);
    });

class CCSessionsNotifier
    extends StateNotifier<AsyncValue<List<ClaudeCodeSession>>> {
  CCSessionsNotifier(this._bridge) : super(const AsyncValue.loading());

  final BridgeService _bridge;

  Future<void> load({String? cwd}) async {
    state = const AsyncValue.loading();
    try {
      final sessions = await _bridge.ccListSessions(cwd: cwd);
      state = AsyncValue.data(sessions);
    } catch (e, st) {
      state = AsyncValue.error(e, st);
    }
  }

  Future<void> refresh({String? cwd}) async {
    try {
      final sessions = await _bridge.ccListSessions(cwd: cwd);
      state = AsyncValue.data(sessions);
    } catch (e, st) {
      state = AsyncValue.error(e, st);
    }
  }

  Future<bool> deleteSession(String sessionId, {String? cwd}) async {
    try {
      final deleted = await _bridge.ccDeleteSession(sessionId, cwd: cwd);
      if (deleted) {
        state = state.whenData(
          (sessions) => sessions.where((s) => s.id != sessionId).toList(),
        );
      }
      return deleted;
    } catch (_) {
      return false;
    }
  }
}

final ccSkillsProvider = FutureProvider.family<List<ClaudeCodeSkill>, String?>((
  ref,
  cwd,
) async {
  final bridge = ref.watch(bridgeServiceProvider);
  return bridge.ccListSkills(cwd: cwd);
});

final ccHooksProvider = FutureProvider.family<List<ClaudeCodeHook>, String?>((
  ref,
  cwd,
) async {
  final bridge = ref.watch(bridgeServiceProvider);
  return bridge.ccListHooks(cwd: cwd);
});

final ccCommandsProvider =
    FutureProvider.family<List<ClaudeCodeCommand>, String?>((ref, cwd) async {
      final bridge = ref.watch(bridgeServiceProvider);
      return bridge.ccListCommands(cwd: cwd);
    });

final ccConfigProvider =
    StateNotifierProvider<CCConfigNotifier, AsyncValue<ClaudeCodeConfig>>((
      ref,
    ) {
      final bridge = ref.watch(bridgeServiceProvider);
      return CCConfigNotifier(bridge);
    });

class CCConfigNotifier extends StateNotifier<AsyncValue<ClaudeCodeConfig>> {
  CCConfigNotifier(this._bridge) : super(const AsyncValue.loading());

  final BridgeService _bridge;

  Future<void> load() async {
    state = const AsyncValue.loading();
    try {
      final config = await _bridge.ccGetConfig();
      state = AsyncValue.data(config);
    } catch (e, st) {
      state = AsyncValue.error(e, st);
    }
  }

  Future<void> updateConfig(ClaudeCodeConfig config) async {
    try {
      final updated = await _bridge.ccSetConfig(config);
      state = AsyncValue.data(updated);
    } catch (e, st) {
      state = AsyncValue.error(e, st);
    }
  }

  /// Set the model for Claude Code (null for Auto)
  Future<void> setModel(String? model) async {
    final current = state.valueOrNull;
    if (current == null) return;

    final updated = current.copyWith(model: model);
    await updateConfig(updated);
  }

  /// Set the permission mode for Claude Code
  Future<void> setPermissionMode(ClaudeCodePermissionMode mode) async {
    final current = state.valueOrNull;
    if (current == null) return;

    final updated = current.copyWith(permissionMode: mode);
    await updateConfig(updated);
  }
}

class CCChatState {
  final String? sessionId;
  final List<ClaudeCodeStreamMessage> messages;
  final bool isStreaming;
  final String? error;

  const CCChatState({
    this.sessionId,
    this.messages = const [],
    this.isStreaming = false,
    this.error,
  });

  CCChatState copyWith({
    String? sessionId,
    List<ClaudeCodeStreamMessage>? messages,
    bool? isStreaming,
    String? error,
  }) {
    return CCChatState(
      sessionId: sessionId ?? this.sessionId,
      messages: messages ?? this.messages,
      isStreaming: isStreaming ?? this.isStreaming,
      error: error,
    );
  }
}

final ccChatProvider = StateNotifierProvider<CCChatNotifier, CCChatState>((
  ref,
) {
  final bridge = ref.watch(bridgeServiceProvider);
  return CCChatNotifier(bridge);
});

class CCChatNotifier extends StateNotifier<CCChatState> {
  CCChatNotifier(this._bridge) : super(const CCChatState()) {
    _subscription = _bridge.ccStreamMessages.listen(_handleStreamMessage);
  }

  final BridgeService _bridge;
  StreamSubscription<ClaudeCodeStreamMessage>? _subscription;

  void sendMessage({
    required String sessionId,
    required String prompt,
    String? cwd,
    String? model,
    ClaudeCodePermissionMode? permissionMode,
  }) {
    state = state.copyWith(
      sessionId: sessionId,
      isStreaming: true,
      error: null,
    );

    _bridge.ccChat(
      sessionId: sessionId,
      prompt: prompt,
      cwd: cwd,
      model: model,
      permissionMode: permissionMode,
    );
  }

  void abort() {
    if (state.sessionId != null) {
      _bridge.ccAbort(state.sessionId!);
      state = state.copyWith(isStreaming: false);
    }
  }

  void _handleStreamMessage(ClaudeCodeStreamMessage message) {
    if (message is CCSessionCreated) {
      state = state.copyWith(sessionId: message.sessionId);
    } else if (message is CCError) {
      state = state.copyWith(isStreaming: false, error: message.message);
    }

    state = state.copyWith(messages: [...state.messages, message]);

    if (message is CCTokenUsage) {
      state = state.copyWith(isStreaming: false);
    }
  }

  void clearMessages() {
    state = const CCChatState();
  }

  void setSession(String sessionId) {
    state = CCChatState(sessionId: sessionId);
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }
}
