import 'dart:async';

import '../../models/runtime/runtime.dart';
import '../bridge_service.dart';

extension BridgeServiceRuntime on BridgeService {
  Stream<RuntimeEvent> get runtimeEvents => messages.expand((message) {
    if (message['type'] != 'runtime_event') {
      return const Iterable<RuntimeEvent>.empty();
    }

    final payload = _extractRuntimePayload(message);
    if (payload == null) {
      return const Iterable<RuntimeEvent>.empty();
    }

    return [RuntimeEvent.fromJson(payload)];
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

  Stream<List<RuntimeSessionSummary>> get runtimeSessions =>
      messages.expand((message) {
        if (message['type'] != 'runtime_sessions') {
          return const Iterable<List<RuntimeSessionSummary>>.empty();
        }

        final payload = _extractRuntimePayloadList(message);
        if (payload == null) {
          return const Iterable<List<RuntimeSessionSummary>>.empty();
        }

        return [payload.map(RuntimeSessionSummary.fromJson).toList()];
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

List<Map<String, dynamic>>? _extractRuntimePayloadList(
  Map<String, dynamic> message,
) {
  final data = message['data'];
  if (data is! List) return null;

  final backend = message['backend'];
  return data.whereType<Map>().map((entry) {
    final payload = entry.map((key, value) => MapEntry(key.toString(), value));
    if (backend is String && backend.isNotEmpty && payload['backend'] == null) {
      payload['backend'] = backend;
    }
    return payload;
  }).toList();
}
