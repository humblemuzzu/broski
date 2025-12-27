import 'dart:convert';

class ConnectionInfo {
  const ConnectionInfo({
    required this.port,
    this.localIP,
    this.tailscaleIP,
    this.magicDNSHostname,
    this.funnelURL,
    this.version,
    this.authToken,
  });

  final String? localIP;
  final String? tailscaleIP;
  final String? magicDNSHostname;
  final String? funnelURL;
  final int port;
  final String? version;
  final String? authToken;

  String get preferredHost => tailscaleIP ?? localIP ?? '';

  bool get hasFunnel => funnelURL != null && funnelURL!.isNotEmpty;

  Uri toWebSocketUri({
    bool preferTailscale = true,
    bool useMagicDNS = false,
    bool useFunnel = false,
  }) {
    if (useFunnel && funnelURL != null) {
      final wsUrl = funnelURL!.replaceFirst('https://', 'wss://');
      return Uri.parse(wsUrl);
    }

    String? host;
    if (useMagicDNS && magicDNSHostname != null) {
      host = magicDNSHostname;
    } else if (preferTailscale) {
      host = tailscaleIP ?? localIP;
    } else {
      host = localIP ?? tailscaleIP;
    }

    if (host == null || host.isEmpty) {
      return Uri.parse('');
    }
    return Uri.parse('ws://$host:$port');
  }

  Map<String, dynamic> toJson() => {
    'localIP': localIP,
    'tailscaleIP': tailscaleIP,
    'magicDNSHostname': magicDNSHostname,
    'funnelURL': funnelURL,
    'port': port,
    'version': version,
    'authToken': authToken,
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
        magicDNSHostname: data['m'] as String?,
        funnelURL: data['f'] as String?,
        port: port,
        version: data['v'] as String?,
        authToken: data['a'] as String?,
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
      magicDNSHostname: json['magicDNSHostname'] as String?,
      funnelURL: json['funnelURL'] as String?,
      port: port,
      version: json['version'] as String?,
      authToken: json['authToken'] as String?,
    );
  }
}
