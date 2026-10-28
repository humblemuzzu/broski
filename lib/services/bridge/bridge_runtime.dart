import 'dart:async';

import 'package:broski/models/runtime/runtime.dart';
import 'package:broski/services/bridge/bridge_pending_prompts.dart';
import 'package:broski/services/bridge/runtime_replay_tracker.dart';
import 'package:broski/services/bridge_service.dart';

extension BridgeServiceRuntime on BridgeService {
  Stream<RuntimeEvent> get runtimeEvents => messages.expand((message) {
    if (message['type'] == 'sessions_active') {
      return pendingPromptPayloads(message['data']).map(RuntimeEvent.fromJson);
    }
    if (message['type'] != 'runtime_event') {
      return const Iterable<RuntimeEvent>.empty();
    }

    final payload = _extractRuntimePayload(message);
    if (payload == null) {
      return const Iterable<RuntimeEvent>.empty();
    }

    final event = RuntimeEvent.fromJson(payload);
    RuntimeReplayTracker.instance.remember(event);
    return [event];
  });

  Stream<RuntimeState> get runtimeStates => messages.expand((message) {
    if (message['type'] != 'runtime_state') {
      return const Iterable<RuntimeState>.empty();
    }

    final payload = _extractRuntimePayload(message);
    if (payload == null) {
      return const Iterable<RuntimeState>.empty();
    }

    return [RuntimeState.fromJson(payload)];
  });

  Stream<RuntimeCapabilities> get runtimeCapabilities =>
      runtimeStates.map((state) => state.capabilities);
}

Map<String, dynamic>? _extractRuntimePayload(Map<String, dynamic> message) {
  final data = message['data'];
  if (data is! Map) return null;

  final payload = data.map((key, value) => MapEntry(key.toString(), value));

  final backend = message['backend'];
  if (backend is String && backend.isNotEmpty && payload['backend'] == null) {
    payload['backend'] = backend;
  }

  return payload;
}
