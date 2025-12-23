import 'dart:convert';

class ConnectionInfo {
  const ConnectionInfo({
    required this.port,
    this.localIP,
    this.tailscaleIP,
    this.version,
  });

  final String? localIP;
  final String? tailscaleIP;
  final int port;
  final String? version;

  String get preferredHost => tailscaleIP ?? localIP ?? '';

  Uri toWebSocketUri({bool preferTailscale = true}) {
    final host = preferTailscale
        ? (tailscaleIP ?? localIP)
        : (localIP ?? tailscaleIP);
    if (host == null || host.isEmpty) {
      return Uri.parse('');
    }
    return Uri.parse('ws://$host:$port');
  }

  Map<String, dynamic> toJson() => {
    'localIP': localIP,
    'tailscaleIP': tailscaleIP,
    'port': port,
    'version': version,
  };

  static ConnectionInfo? parseQrPayload(String raw) {
    try {
      final data = jsonDecode(raw) as Map<String, dynamic>;
      final port = data['p'] is int
          ? data['p'] as int
          : int.tryParse('${data['p']}');
      if (port == null) return null;
      return ConnectionInfo(
        localIP: data['l'] as String?,
        tailscaleIP: data['t'] as String?,
        port: port,
        version: data['v'] as String?,
      );
    } catch (_) {
      return null;
    }
  }

  static ConnectionInfo? fromJson(Map<String, dynamic>? json) {
    if (json == null) return null;
    final port = json['port'] is int
        ? json['port'] as int
        : int.tryParse('${json['port']}');
    if (port == null) return null;
    return ConnectionInfo(
      localIP: json['localIP'] as String?,
      tailscaleIP: json['tailscaleIP'] as String?,
      port: port,
      version: json['version'] as String?,
    );
  }
}
