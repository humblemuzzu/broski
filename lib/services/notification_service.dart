import 'dart:developer' as developer;
import 'dart:io';

import 'package:broski/services/notifications/notification_tap_relay.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

/// Service for showing local notifications when background sessions complete.
///
/// Used to alert users when an AI task finishes while they're away from the app.
class NotificationService {
  NotificationService._();

  static final NotificationService instance = NotificationService._();

  final FlutterLocalNotificationsPlugin _plugin =
      FlutterLocalNotificationsPlugin();

  bool _initialized = false;

  /// Whether we've already requested OS-level notification permissions
  bool _permissionsRequested = false;

  /// Whether notifications are enabled (controlled by settings)
  bool _enabled = true;

  /// Set whether notifications are enabled
  set enabled(bool value) => _enabled = value;

  /// Channel ID for background session notifications
  static const String _channelId = 'background_sessions';
  static const String _channelName = 'Background Sessions';
  static const String _channelDescription =
      'Notifications for completed AI tasks running in the background';

  /// Initialize the notification service.
  /// Must be called before showing any notifications.
  Future<bool> initialize() async {
    if (_initialized) return true;

    try {
      // Android initialization settings
      const androidSettings = AndroidInitializationSettings(
        '@mipmap/ic_launcher',
      );

      // iOS/macOS initialization settings
      // NOTE: Do NOT auto-request permissions here. Apple rejects apps that
      // request notification permissions without user context. Permissions are
      // requested later via requestPermissions() when the user enables
      // notifications or when a notification is first needed.
      const darwinSettings = DarwinInitializationSettings(
        requestAlertPermission: false,
        requestBadgePermission: false,
        requestSoundPermission: false,
      );

      const settings = InitializationSettings(
        android: androidSettings,
        iOS: darwinSettings,
        macOS: darwinSettings,
      );

      final result = await _plugin.initialize(
        settings,
        onDidReceiveNotificationResponse: _onNotificationTapped,
      );

      _initialized = result ?? false;

      if (kDebugMode) {
        developer.log(
          'NotificationService initialized: $_initialized',
          name: 'NotificationService',
        );
      }

      return _initialized;
    } catch (e) {
      developer.log(
        'Failed to initialize NotificationService: $e',
        name: 'NotificationService',
      );
      return false;
    }
  }

  /// Request notification permissions (iOS/Android 13+).
  /// Returns true if permission was granted.
  Future<bool> requestPermissions() async {
    if (Platform.isIOS || Platform.isMacOS) {
      final result = await _plugin
          .resolvePlatformSpecificImplementation<
            IOSFlutterLocalNotificationsPlugin
          >()
          ?.requestPermissions(alert: true, badge: true, sound: true);
      return result ?? false;
    }

    if (Platform.isAndroid) {
      final androidPlugin = _plugin
          .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin
          >();

      // Android 13+ requires explicit permission request
      final result = await androidPlugin?.requestNotificationsPermission();
      return result ?? true; // Pre-Android 13 doesn't require permission
    }

    return true;
  }

  /// Show notification when a session completes (busy → idle)
  /// Includes duration, last tool used, and change summary
  Future<void> showSessionCompleted({
    required String sessionId,
    required String title,
    required String projectName,
    Duration? duration,
    String? lastTool,
    int? additions,
    int? deletions,
    String? payload,
  }) async {
    // Check if notifications are enabled
    if (!_enabled) return;

    if (!_initialized) {
      await initialize();
    }

    // Request permissions on first notification attempt (contextual request).
    // This ensures the OS permission dialog only appears when the user has
    // a clear reason to see it (their AI session just completed).
    if (!_permissionsRequested) {
      _permissionsRequested = true;
      await requestPermissions();
    }

    // Build the body with context
    final body = _formatNotificationBody(
      title: title,
      duration: duration,
      lastTool: lastTool,
      additions: additions,
      deletions: deletions,
    );

    await _showNotification(
      id: sessionId.hashCode,
      title: projectName,
      body: body,
      payload: payload ?? sessionId,
    );
  }

  /// Format notification body with available context
  String _formatNotificationBody({
    required String title,
    Duration? duration,
    String? lastTool,
    int? additions,
    int? deletions,
  }) {
    final parts = <String>[title];

    // Build stats line
    final stats = <String>[];

    // Duration: "2m 30s" or "45s"
    if (duration != null) {
      stats.add(_formatDuration(duration));
    }

    // Last tool: "edit" or "bash"
    if (lastTool != null && lastTool.isNotEmpty) {
      stats.add(lastTool);
    }

    // Changes: "+45 -12"
    if (additions != null || deletions != null) {
      final add = additions ?? 0;
      final del = deletions ?? 0;
      if (add > 0 || del > 0) {
        stats.add('+$add -$del');
      }
    }

    // Join stats with separator
    if (stats.isNotEmpty) {
      parts.add(stats.join(' · '));
    }

    return parts.join('\n');
  }

  /// Format duration as "2m 30s" or "45s"
  String _formatDuration(Duration duration) {
    final minutes = duration.inMinutes;
    final seconds = duration.inSeconds % 60;

    if (minutes > 0) {
      return seconds > 0 ? '${minutes}m ${seconds}s' : '${minutes}m';
    }
    return '${seconds}s';
  }

  /// Internal method to show a notification.
  Future<void> _showNotification({
    required int id,
    required String title,
    required String body,
    String? payload,
  }) async {
    const androidDetails = AndroidNotificationDetails(
      _channelId,
      _channelName,
      channelDescription: _channelDescription,
      importance: Importance.high,
      priority: Priority.high,
      showWhen: true,
      enableVibration: true,
      playSound: true,
    );

    const darwinDetails = DarwinNotificationDetails(
      presentAlert: true,
      presentBadge: true,
      presentSound: true,
    );

    const details = NotificationDetails(
      android: androidDetails,
      iOS: darwinDetails,
      macOS: darwinDetails,
    );

    await _plugin.show(id, title, body, details, payload: payload);

    if (kDebugMode) {
      developer.log('Showed notification: $title', name: 'NotificationService');
    }
  }

  /// Cancel a specific notification.
  Future<void> cancel(int id) async {
    await _plugin.cancel(id);
  }

  /// Cancel all notifications.
  Future<void> cancelAll() async {
    await _plugin.cancelAll();
  }

  /// Handle notification tapped.
  void _onNotificationTapped(NotificationResponse response) {
    final payload = response.payload;
    if (kDebugMode) {
      developer.log(
        'Notification tapped: ${response.payload}',
        name: 'NotificationService',
      );
    }

    // The payload contains the sessionId.
    // Navigation to the session will be handled by the app's navigation system.
    // This can be wired up with a stream or callback if needed.
    _notificationTappedSessionId = payload;
    NotificationTapRelay.instance.add(payload);
  }

  /// The session ID from the last tapped notification.
  /// Check this on app resume to navigate to the session.
  String? _notificationTappedSessionId;

  /// Get and clear the tapped session ID.
  String? consumeTappedSessionId() {
    final id = _notificationTappedSessionId;
    _notificationTappedSessionId = null;
    return id;
  }
}
