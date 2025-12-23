/// MCP (Model Context Protocol) Server Status
enum McpConnectionStatus { connected, disconnected, connecting, error }

class McpServerStatus {
  final String name;
  final McpConnectionStatus status;
  final String? error;
  final List<String> tools;
  final List<String> resources;

  const McpServerStatus({
    required this.name,
    required this.status,
    this.error,
    this.tools = const [],
    this.resources = const [],
  });

  factory McpServerStatus.fromJson(Map<String, dynamic> json) {
    return McpServerStatus(
      name: json['name'] as String? ?? '',
      status: _parseStatus(json['status'] as String?),
      error: json['error'] as String?,
      tools:
          (json['tools'] as List<dynamic>?)
              ?.map((t) => t.toString())
              .toList() ??
          const [],
      resources:
          (json['resources'] as List<dynamic>?)
              ?.map((r) => r.toString())
              .toList() ??
          const [],
    );
  }

  static McpConnectionStatus _parseStatus(String? status) {
    switch (status) {
      case 'connected':
        return McpConnectionStatus.connected;
      case 'connecting':
        return McpConnectionStatus.connecting;
      case 'error':
        return McpConnectionStatus.error;
      default:
        return McpConnectionStatus.disconnected;
    }
  }

  bool get isConnected => status == McpConnectionStatus.connected;
  bool get isDisconnected => status == McpConnectionStatus.disconnected;
  bool get isConnecting => status == McpConnectionStatus.connecting;
  bool get hasError => status == McpConnectionStatus.error;

  /// Get a display string for the status
  String get statusDisplay {
    switch (status) {
      case McpConnectionStatus.connected:
        return 'Connected';
      case McpConnectionStatus.disconnected:
        return 'Disconnected';
      case McpConnectionStatus.connecting:
        return 'Connecting...';
      case McpConnectionStatus.error:
        return error ?? 'Error';
    }
  }

  /// Get a count of capabilities
  int get capabilityCount => tools.length + resources.length;
}
