import 'dart:math' as math;

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

class ConnectionHealthTracker {
  final List<int> _rttHistory = [];
  final List<bool> _connectionAttempts = [];
  DateTime? _lastStableAt;
  int _consecutiveFailures = 0;

  static const int _maxHistorySize = 20;

  void recordRtt(int rttMs) {
    _rttHistory.add(rttMs);
    if (_rttHistory.length > _maxHistorySize) {
      _rttHistory.removeAt(0);
    }
    _consecutiveFailures = 0;
    _lastStableAt = DateTime.now();
  }

  void recordConnectionAttempt(bool success) {
    _connectionAttempts.add(success);
    if (_connectionAttempts.length > _maxHistorySize) {
      _connectionAttempts.removeAt(0);
    }

    if (success) {
      _consecutiveFailures = 0;
      _lastStableAt = DateTime.now();
    } else {
      _consecutiveFailures++;
    }
  }

  void recordDisconnect() {
    _consecutiveFailures++;
  }

  double get healthScore {
    if (_rttHistory.isEmpty && _connectionAttempts.isEmpty) {
      return 0.5;
    }

    double rttScore = 1.0;
    if (_rttHistory.isNotEmpty) {
      final avgRtt = _rttHistory.reduce((a, b) => a + b) / _rttHistory.length;
      rttScore = _clamp(1.0 - (avgRtt / 500), 0, 1);
    }

    double successRate = 1.0;
    if (_connectionAttempts.isNotEmpty) {
      final successes = _connectionAttempts.where((s) => s).length;
      successRate = successes / _connectionAttempts.length;
    }

    double stabilityScore = 0.5;
    if (_lastStableAt != null) {
      final minutesSinceStable = DateTime.now()
          .difference(_lastStableAt!)
          .inMinutes;
      stabilityScore = _clamp(1.0 - (minutesSinceStable / 30), 0, 1);
    }

    return (rttScore * 0.4) + (successRate * 0.4) + (stabilityScore * 0.2);
  }

  bool get isHealthy => healthScore > 0.7;
  bool get isDegraded => healthScore < 0.4;
  bool get shouldSwitchEndpoint => _consecutiveFailures >= 2 || isDegraded;

  int? get averageRtt {
    if (_rttHistory.isEmpty) return null;
    return (_rttHistory.reduce((a, b) => a + b) / _rttHistory.length).round();
  }

  int? get rttVariance {
    if (_rttHistory.length < 2) return null;
    final avg = averageRtt!;
    final sumSquaredDiffs = _rttHistory
        .map((r) => (r - avg) * (r - avg))
        .reduce((a, b) => a + b);
    return (sumSquaredDiffs / _rttHistory.length).round();
  }

  int? get rttJitter {
    if (_rttHistory.length < 2) return null;
    int totalDiff = 0;
    for (int i = 1; i < _rttHistory.length; i++) {
      totalDiff += (_rttHistory[i] - _rttHistory[i - 1]).abs();
    }
    return (totalDiff / (_rttHistory.length - 1)).round();
  }

  void reset() {
    _rttHistory.clear();
    _connectionAttempts.clear();
    _lastStableAt = null;
    _consecutiveFailures = 0;
  }

  double _clamp(double value, double min, double max) {
    return math.max(min, math.min(max, value));
  }
}
