class ClaudeCodeMcpServerStatus {
  final String name;
  final String status; // connected | failed | needs-auth | pending | disabled
  final String? serverName;
  final String? serverVersion;
  final String? error;
  final Map<String, dynamic>? config;
  final String? scope;
  final List<ClaudeCodeMcpTool>? tools;

  const ClaudeCodeMcpServerStatus({
    required this.name,
    required this.status,
    this.serverName,
    this.serverVersion,
    this.error,
    this.config,
    this.scope,
    this.tools,
  });

  factory ClaudeCodeMcpServerStatus.fromJson(Map<String, dynamic> json) {
    final infoRaw = json['serverInfo'];
    final info = infoRaw is Map<String, dynamic>
        ? infoRaw
        : infoRaw is Map
        ? infoRaw.cast<String, dynamic>()
        : null;
    final rawTools = json['tools'] as List<dynamic>?;
    return ClaudeCodeMcpServerStatus(
      name: json['name'] as String? ?? '',
      status: json['status'] as String? ?? '',
      serverName: info?['name'] as String?,
      serverVersion: info?['version'] as String?,
      error: json['error'] as String?,
      config: json['config'] is Map<String, dynamic>
          ? json['config'] as Map<String, dynamic>
          : json['config'] is Map
          ? (json['config'] as Map).cast<String, dynamic>()
          : null,
      scope: json['scope'] as String?,
      tools: rawTools
          ?.map(
            (t) => ClaudeCodeMcpTool.fromJson(
              t is Map<String, dynamic>
                  ? t
                  : (t as Map).cast<String, dynamic>(),
            ),
          )
          .toList(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'name': name,
      'status': status,
      if (serverName != null || serverVersion != null)
        'serverInfo': {
          if (serverName != null) 'name': serverName,
          if (serverVersion != null) 'version': serverVersion,
        },
      if (error != null) 'error': error,
      if (config != null) 'config': config,
      if (scope != null) 'scope': scope,
      if (tools != null) 'tools': tools!.map((t) => t.toJson()).toList(),
    };
  }

  bool get isDisabled => status == 'disabled';
  bool get isConnected => status == 'connected';
  bool get isFailed => status == 'failed';
}

class ClaudeCodeMcpToolAnnotations {
  final bool? readOnly;
  final bool? destructive;
  final bool? openWorld;

  const ClaudeCodeMcpToolAnnotations({
    this.readOnly,
    this.destructive,
    this.openWorld,
  });

  factory ClaudeCodeMcpToolAnnotations.fromJson(Map<String, dynamic> json) {
    return ClaudeCodeMcpToolAnnotations(
      readOnly: json['readOnly'] as bool?,
      destructive: json['destructive'] as bool?,
      openWorld: json['openWorld'] as bool?,
    );
  }

  Map<String, dynamic> toJson() => {
    if (readOnly != null) 'readOnly': readOnly,
    if (destructive != null) 'destructive': destructive,
    if (openWorld != null) 'openWorld': openWorld,
  };
}

class ClaudeCodeMcpTool {
  final String name;
  final String? description;
  final ClaudeCodeMcpToolAnnotations? annotations;

  const ClaudeCodeMcpTool({
    required this.name,
    this.description,
    this.annotations,
  });

  factory ClaudeCodeMcpTool.fromJson(Map<String, dynamic> json) {
    final rawAnn = json['annotations'];
    return ClaudeCodeMcpTool(
      name: json['name'] as String? ?? '',
      description: json['description'] as String?,
      annotations: rawAnn is Map<String, dynamic>
          ? ClaudeCodeMcpToolAnnotations.fromJson(rawAnn)
          : rawAnn is Map
          ? ClaudeCodeMcpToolAnnotations.fromJson(
              rawAnn.cast<String, dynamic>(),
            )
          : null,
    );
  }

  Map<String, dynamic> toJson() => {
    'name': name,
    if (description != null) 'description': description,
    if (annotations != null) 'annotations': annotations!.toJson(),
  };

  bool get isDestructive => annotations?.destructive == true;
  bool get isReadOnly => annotations?.readOnly == true;
}
