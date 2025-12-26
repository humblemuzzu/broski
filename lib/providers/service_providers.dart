import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../services/bridge_service.dart';
import '../services/network_monitor_service.dart';
import '../services/storage_service.dart';
import '../services/websocket_service.dart';

final storageServiceProvider = Provider<StorageService>((ref) {
  return StorageService();
});

final webSocketServiceProvider = Provider<WebSocketService>((ref) {
  final service = WebSocketService();
  ref.onDispose(service.dispose);
  return service;
});

final bridgeServiceProvider = Provider<BridgeService>((ref) {
  final socket = ref.watch(webSocketServiceProvider);
  return BridgeService(socket);
});

final networkMonitorServiceProvider = Provider<NetworkMonitorService>((ref) {
  final service = NetworkMonitorService();
  // Start monitoring immediately
  service.startMonitoring();
  ref.onDispose(service.dispose);
  return service;
});
