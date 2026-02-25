import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../services/auth_service.dart';
import '../services/bridge_service.dart';
import '../services/convex_service.dart';
import '../services/network_monitor_service.dart';
import '../services/notification_service.dart';
import '../services/purchase_service.dart';
import '../services/storage_service.dart';
import '../services/websocket_service.dart';

export '../services/bridge_service.dart';

final storageServiceProvider = Provider<StorageService>((ref) {
  return StorageService();
});

final convexServiceProvider = Provider<ConvexService>((ref) {
  return ConvexService();
});

final authServiceProvider = Provider<AuthService>((ref) {
  return AuthService(
    storage: ref.watch(storageServiceProvider),
    convex: ref.watch(convexServiceProvider),
  );
});

final purchaseServiceProvider = Provider<PurchaseService>((ref) {
  return PurchaseService();
});

final webSocketServiceProvider = Provider<WebSocketService>((ref) {
  final service = WebSocketService();
  ref.onDispose(service.dispose);
  return service;
});

final bridgeServiceProvider = Provider<BridgeService>((ref) {
  final socket = ref.watch(webSocketServiceProvider);
  final bridge = BridgeService(socket);
  ref.onDispose(bridge.dispose);
  return bridge;
});

final networkMonitorServiceProvider = Provider<NetworkMonitorService>((ref) {
  final service = NetworkMonitorService();
  // Start monitoring immediately
  service.startMonitoring();
  ref.onDispose(service.dispose);
  return service;
});

/// Provider for notifications enabled setting (default: true)
final notificationsEnabledProvider =
    StateNotifierProvider<NotificationsEnabledNotifier, bool>((ref) {
      final storage = ref.watch(storageServiceProvider);
      return NotificationsEnabledNotifier(storage);
    });

class NotificationsEnabledNotifier extends StateNotifier<bool> {
  NotificationsEnabledNotifier(this._storage) : super(true) {
    _load();
  }

  final StorageService _storage;

  Future<void> _load() async {
    state = await _storage.getNotificationsEnabled();
    // Sync to NotificationService
    NotificationService.instance.enabled = state;
  }

  Future<void> toggle() async {
    state = !state;
    await _storage.setNotificationsEnabled(state);
    // Sync to NotificationService
    NotificationService.instance.enabled = state;
  }

  Future<void> setEnabled(bool enabled) async {
    state = enabled;
    await _storage.setNotificationsEnabled(enabled);
    // Sync to NotificationService
    NotificationService.instance.enabled = enabled;
  }
}
