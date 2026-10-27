class DeviceInfo {
  final String deviceId;
  final String deviceName;
  final String platform;
  final int rttMs;
  final int connectedAt;
  final DeviceView? currentView;

  const DeviceInfo({
    required this.deviceId,
    required this.deviceName,
    required this.platform,
    required this.rttMs,
    required this.connectedAt,
    this.currentView,
  });

  factory DeviceInfo.fromJson(Map<String, dynamic> json) {
    return DeviceInfo(
      deviceId: json['deviceId'] as String? ?? '',
      deviceName: json['deviceName'] as String? ?? 'Unknown Device',
      platform: json['platform'] as String? ?? 'unknown',
      rttMs: json['rttMs'] as int? ?? 0,
      connectedAt: json['connectedAt'] as int? ?? 0,
      currentView: json['currentView'] != null
          ? DeviceView.fromJson(json['currentView'] as Map<String, dynamic>)
          : null,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'deviceId': deviceId,
      'deviceName': deviceName,
      'platform': platform,
      'rttMs': rttMs,
      'connectedAt': connectedAt,
      if (currentView != null) 'currentView': currentView!.toJson(),
    };
  }

  String get platformIcon {
    switch (platform.toLowerCase()) {
      case 'ios':
        return 'phone_iphone';
      case 'android':
        return 'phone_android';
      case 'macos':
        return 'laptop_mac';
      case 'windows':
        return 'laptop_windows';
      case 'linux':
        return 'computer';
      case 'web':
        return 'web';
      default:
        return 'devices';
    }
  }

  Duration get connectedDuration {
    final now = DateTime.now().millisecondsSinceEpoch;
    return Duration(milliseconds: now - connectedAt);
  }

  String get connectedDurationText {
    final duration = connectedDuration;
    if (duration.inDays > 0) {
      return '${duration.inDays}d ago';
    } else if (duration.inHours > 0) {
      return '${duration.inHours}h ago';
    } else if (duration.inMinutes > 0) {
      return '${duration.inMinutes}m ago';
    }
    return 'Just now';
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is DeviceInfo &&
          runtimeType == other.runtimeType &&
          deviceId == other.deviceId;

  @override
  int get hashCode => deviceId.hashCode;
}

class DeviceView {
  final String? projectPath;
  final String? sessionId;

  const DeviceView({this.projectPath, this.sessionId});

  factory DeviceView.fromJson(Map<String, dynamic> json) {
    return DeviceView(
      projectPath: json['projectPath'] as String?,
      sessionId: json['sessionId'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      if (projectPath != null) 'projectPath': projectPath,
      if (sessionId != null) 'sessionId': sessionId,
    };
  }
}
