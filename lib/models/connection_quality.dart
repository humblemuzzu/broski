import 'package:flutter/material.dart';

enum ConnectionType { local, tailscale, magicDNS, unknown }

enum ConnectionQuality { excellent, good, fair, poor, disconnected }

class ConnectionMetrics {
  final ConnectionType type;
  final int rttMs;
  final ConnectionQuality quality;
  final DateTime lastPingAt;
  final String? connectedHost;

  const ConnectionMetrics({
    required this.type,
    required this.rttMs,
    required this.quality,
    required this.lastPingAt,
    this.connectedHost,
  });

  static ConnectionQuality calculateQuality(int rttMs) {
    if (rttMs < 30) return ConnectionQuality.excellent;
    if (rttMs < 100) return ConnectionQuality.good;
    if (rttMs < 200) return ConnectionQuality.fair;
    return ConnectionQuality.poor;
  }

  String get qualityLabel {
    switch (quality) {
      case ConnectionQuality.excellent:
        return 'Excellent';
      case ConnectionQuality.good:
        return 'Good';
      case ConnectionQuality.fair:
        return 'Fair';
      case ConnectionQuality.poor:
        return 'Poor';
      case ConnectionQuality.disconnected:
        return 'Disconnected';
    }
  }

  Color get qualityColor {
    switch (quality) {
      case ConnectionQuality.excellent:
        return const Color(0xFF10B981);
      case ConnectionQuality.good:
        return const Color(0xFF22C55E);
      case ConnectionQuality.fair:
        return const Color(0xFFF59E0B);
      case ConnectionQuality.poor:
        return const Color(0xFFEF4444);
      case ConnectionQuality.disconnected:
        return const Color(0xFF6B7280);
    }
  }

  int get signalBars {
    switch (quality) {
      case ConnectionQuality.excellent:
        return 4;
      case ConnectionQuality.good:
        return 3;
      case ConnectionQuality.fair:
        return 2;
      case ConnectionQuality.poor:
        return 1;
      case ConnectionQuality.disconnected:
        return 0;
    }
  }

  String get typeLabel {
    switch (type) {
      case ConnectionType.local:
        return 'Local';
      case ConnectionType.tailscale:
        return 'Tailscale';
      case ConnectionType.magicDNS:
        return 'MagicDNS';
      case ConnectionType.unknown:
        return 'Connected';
    }
  }

  IconData get typeIcon {
    switch (type) {
      case ConnectionType.local:
        return Icons.wifi;
      case ConnectionType.tailscale:
        return Icons.vpn_lock;
      case ConnectionType.magicDNS:
        return Icons.dns;
      case ConnectionType.unknown:
        return Icons.signal_cellular_alt;
    }
  }

  String get displayString {
    if (quality == ConnectionQuality.disconnected) {
      return 'Disconnected';
    }
    return '$typeLabel • ${rttMs}ms';
  }

  ConnectionMetrics copyWith({
    ConnectionType? type,
    int? rttMs,
    ConnectionQuality? quality,
    DateTime? lastPingAt,
    String? connectedHost,
  }) {
    return ConnectionMetrics(
      type: type ?? this.type,
      rttMs: rttMs ?? this.rttMs,
      quality: quality ?? this.quality,
      lastPingAt: lastPingAt ?? this.lastPingAt,
      connectedHost: connectedHost ?? this.connectedHost,
    );
  }
}
