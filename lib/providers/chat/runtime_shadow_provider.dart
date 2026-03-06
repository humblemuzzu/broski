import 'dart:async';
import 'dart:developer' as developer;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/runtime/runtime.dart';
import '../../services/bridge/bridge_runtime.dart';
import '../chat_provider.dart';
import '../connection_provider.dart';
import '../service_providers.dart';
import 'runtime_backend_extensions.dart';
import 'runtime_event_reducer.dart';
import 'runtime_shadow_state.dart';

const _runtimeShadowCompareDelay = Duration(milliseconds: 48);
const _runtimeShadowMismatchConfirmDelay = Duration(milliseconds: 160);
const _runtimeShadowMaxMismatchHistory = 20;

final runtimeShadowProvider =
    StateNotifierProvider<RuntimeShadowNotifier, RuntimeShadowState>((ref) {
      final bridge = ref.watch(bridgeServiceProvider);
      return RuntimeShadowNotifier(ref, bridge);
    });

final runtimeShadowBootstrapProvider = Provider<void>((ref) {
  ref.watch(runtimeShadowProvider.notifier);
});

class RuntimeShadowNotifier extends StateNotifier<RuntimeShadowState> {
  RuntimeShadowNotifier(this._ref, this._bridge)
    : super(const RuntimeShadowState()) {
    _runtimeEventSub = _bridge.runtimeEvents.listen(
      _handleRuntimeEvent,
      onError: _handleShadowStreamError,
    );
    _runtimeStateSub = _bridge.runtimeStates.listen(
      _handleRuntimeState,
      onError: _handleShadowStreamError,
    );

    _ref.listen<ConnectionEvent?>(
      connectionProvider.select((connection) => connection.lastEvent),
      (previous, next) {
        switch (next) {
          case ConnectionEvent.connected:
          case ConnectionEvent.reconnected:
          case ConnectionEvent.disconnected:
          case ConnectionEvent.failed:
            _reset('connection_${next!.name}');
            break;
          case null:
            break;
        }
      },
    );
  }

  final Ref _ref;
  final BridgeService _bridge;
  StreamSubscription<RuntimeEvent>? _runtimeEventSub;
  StreamSubscription<RuntimeState>? _runtimeStateSub;
  Timer? _compareTimer;
  Timer? _confirmMismatchTimer;

  void _handleRuntimeEvent(RuntimeEvent event) {
    final sessionKey = buildRuntimeSessionKeyForEvent(event);
    final currentSession = state.sessions[sessionKey];
    final nextSession = reduceRuntimeEvent(currentSession, event);
    _storeSession(nextSession);
    _scheduleComparison();
  }

  void _handleRuntimeState(RuntimeState runtimeState) {
    final sessionKey = buildRuntimeSessionKeyForState(runtimeState);
    final currentSession = state.sessions[sessionKey];
    final nextSession = reduceRuntimeState(currentSession, runtimeState);
    _storeSession(nextSession);
    _scheduleComparison();
  }

  void _storeSession(RuntimeShadowSessionState session) {
    state = state.copyWith(
      sessions: {...state.sessions, session.sessionKey: session},
    );
  }

  void _scheduleComparison() {
    _compareTimer?.cancel();
    _confirmMismatchTimer?.cancel();
    _compareTimer = Timer(_runtimeShadowCompareDelay, _runComparison);
  }

  void _runComparison() {
    _compareTimer = null;
    _compareAndRecord(confirmMismatch: false);
  }

  void _confirmMismatchComparison() {
    _confirmMismatchTimer = null;
    _compareAndRecord(confirmMismatch: true);
  }

  void _compareAndRecord({required bool confirmMismatch}) {
    final visible = buildVisibleRuntimeSnapshot(_ref.read(chatSessionProvider));
    if (visible == null) return;

    final shadow = state.sessions[visible.sessionKey];
    if (shadow == null ||
        !canCompareShadowSession(shadow: shadow, visible: visible)) {
      return;
    }

    final comparison = compareShadowToVisible(shadow: shadow, visible: visible);
    final comparisonFingerprint =
        '${shadow.revision}|${visible.fingerprint}|${comparison.mismatchFields.join(',')}';
    if (state.lastComparisonFingerprint == comparisonFingerprint) {
      return;
    }

    if (!comparison.isMatch && !confirmMismatch) {
      _confirmMismatchTimer?.cancel();
      _confirmMismatchTimer = Timer(
        _runtimeShadowMismatchConfirmDelay,
        _confirmMismatchComparison,
      );
      return;
    }

    final wasMismatch = state.latestComparison?.isMatch == false;
    final nextRecentMismatches = comparison.isMatch
        ? state.recentMismatches
        : [
            comparison,
            ...state.recentMismatches,
          ].take(_runtimeShadowMaxMismatchHistory).toList();
    final nextMetrics = state.metrics.copyWith(
      totalComparisons: state.metrics.totalComparisons + 1,
      matchCount: state.metrics.matchCount + (comparison.isMatch ? 1 : 0),
      mismatchCount: state.metrics.mismatchCount + (comparison.isMatch ? 0 : 1),
    );

    state = state.copyWith(
      latestComparison: comparison,
      recentMismatches: nextRecentMismatches,
      metrics: nextMetrics,
      lastComparisonFingerprint: comparisonFingerprint,
    );

    if (!comparison.isMatch) {
      developer.log(
        'Runtime shadow mismatch for ${visible.sessionKey}: ${comparison.mismatchFields.join(', ')}',
        name: 'RuntimeShadow',
      );
    } else if (wasMismatch) {
      developer.log(
        'Runtime shadow back in sync for ${visible.sessionKey}',
        name: 'RuntimeShadow',
      );
    }
  }

  void _reset(String reason) {
    _compareTimer?.cancel();
    _compareTimer = null;
    _confirmMismatchTimer?.cancel();
    _confirmMismatchTimer = null;
    state = RuntimeShadowState(lastResetReason: reason);
  }

  void _handleShadowStreamError(Object error, StackTrace stackTrace) {
    developer.log(
      'Runtime shadow stream error: $error',
      name: 'RuntimeShadow',
      stackTrace: stackTrace,
      error: error,
    );
  }

  @override
  void dispose() {
    _compareTimer?.cancel();
    _confirmMismatchTimer?.cancel();
    _runtimeEventSub?.cancel();
    _runtimeStateSub?.cancel();
    super.dispose();
  }
}
