class ClaudeCodeSandboxNetworkConfig {
  final List<String>? allowedDomains;
  final bool? allowManagedDomainsOnly;
  final List<String>? allowUnixSockets;
  final bool? allowAllUnixSockets;
  final bool? allowLocalBinding;
  final int? httpProxyPort;
  final int? socksProxyPort;

  const ClaudeCodeSandboxNetworkConfig({
    this.allowedDomains,
    this.allowManagedDomainsOnly,
    this.allowUnixSockets,
    this.allowAllUnixSockets,
    this.allowLocalBinding,
    this.httpProxyPort,
    this.socksProxyPort,
  });

  factory ClaudeCodeSandboxNetworkConfig.fromJson(Map<String, dynamic> json) {
    return ClaudeCodeSandboxNetworkConfig(
      allowedDomains: (json['allowedDomains'] as List<dynamic>?)
          ?.map((e) => '$e')
          .toList(),
      allowManagedDomainsOnly: json['allowManagedDomainsOnly'] as bool?,
      allowUnixSockets: (json['allowUnixSockets'] as List<dynamic>?)
          ?.map((e) => '$e')
          .toList(),
      allowAllUnixSockets: json['allowAllUnixSockets'] as bool?,
      allowLocalBinding: json['allowLocalBinding'] as bool?,
      httpProxyPort: (json['httpProxyPort'] as num?)?.toInt(),
      socksProxyPort: (json['socksProxyPort'] as num?)?.toInt(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      if (allowedDomains != null) 'allowedDomains': allowedDomains,
      if (allowManagedDomainsOnly != null)
        'allowManagedDomainsOnly': allowManagedDomainsOnly,
      if (allowUnixSockets != null) 'allowUnixSockets': allowUnixSockets,
      if (allowAllUnixSockets != null)
        'allowAllUnixSockets': allowAllUnixSockets,
      if (allowLocalBinding != null) 'allowLocalBinding': allowLocalBinding,
      if (httpProxyPort != null) 'httpProxyPort': httpProxyPort,
      if (socksProxyPort != null) 'socksProxyPort': socksProxyPort,
    };
  }
}

class ClaudeCodeSandboxFilesystemConfig {
  final List<String>? allowWrite;
  final List<String>? denyWrite;
  final List<String>? denyRead;

  const ClaudeCodeSandboxFilesystemConfig({
    this.allowWrite,
    this.denyWrite,
    this.denyRead,
  });

  factory ClaudeCodeSandboxFilesystemConfig.fromJson(
    Map<String, dynamic> json,
  ) {
    return ClaudeCodeSandboxFilesystemConfig(
      allowWrite: (json['allowWrite'] as List<dynamic>?)
          ?.map((e) => '$e')
          .toList(),
      denyWrite: (json['denyWrite'] as List<dynamic>?)
          ?.map((e) => '$e')
          .toList(),
      denyRead: (json['denyRead'] as List<dynamic>?)?.map((e) => '$e').toList(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      if (allowWrite != null) 'allowWrite': allowWrite,
      if (denyWrite != null) 'denyWrite': denyWrite,
      if (denyRead != null) 'denyRead': denyRead,
    };
  }
}

class ClaudeCodeSandboxSettings {
  final bool? enabled;
  final bool? autoAllowBashIfSandboxed;
  final bool? allowUnsandboxedCommands;
  final ClaudeCodeSandboxNetworkConfig? network;
  final ClaudeCodeSandboxFilesystemConfig? filesystem;
  final Map<String, List<String>>? ignoreViolations;
  final bool? enableWeakerNestedSandbox;
  final List<String>? excludedCommands;
  final Map<String, dynamic>? ripgrep;

  const ClaudeCodeSandboxSettings({
    this.enabled,
    this.autoAllowBashIfSandboxed,
    this.allowUnsandboxedCommands,
    this.network,
    this.filesystem,
    this.ignoreViolations,
    this.enableWeakerNestedSandbox,
    this.excludedCommands,
    this.ripgrep,
  });

  factory ClaudeCodeSandboxSettings.fromJson(Map<String, dynamic> json) {
    final ignoreRaw = json['ignoreViolations'];
    final ignore = <String, List<String>>{};
    if (ignoreRaw is Map) {
      for (final entry in ignoreRaw.entries) {
        final key = '${entry.key}';
        final value = entry.value;
        if (value is List) {
          ignore[key] = value.map((e) => '$e').toList();
        }
      }
    }

    return ClaudeCodeSandboxSettings(
      enabled: json['enabled'] as bool?,
      autoAllowBashIfSandboxed: json['autoAllowBashIfSandboxed'] as bool?,
      allowUnsandboxedCommands: json['allowUnsandboxedCommands'] as bool?,
      network: json['network'] is Map<String, dynamic>
          ? ClaudeCodeSandboxNetworkConfig.fromJson(
              json['network'] as Map<String, dynamic>,
            )
          : json['network'] is Map
          ? ClaudeCodeSandboxNetworkConfig.fromJson(
              (json['network'] as Map).cast<String, dynamic>(),
            )
          : null,
      filesystem: json['filesystem'] is Map<String, dynamic>
          ? ClaudeCodeSandboxFilesystemConfig.fromJson(
              json['filesystem'] as Map<String, dynamic>,
            )
          : json['filesystem'] is Map
          ? ClaudeCodeSandboxFilesystemConfig.fromJson(
              (json['filesystem'] as Map).cast<String, dynamic>(),
            )
          : null,
      ignoreViolations: ignore.isNotEmpty ? ignore : null,
      enableWeakerNestedSandbox: json['enableWeakerNestedSandbox'] as bool?,
      excludedCommands: (json['excludedCommands'] as List<dynamic>?)
          ?.map((e) => '$e')
          .toList(),
      ripgrep: json['ripgrep'] is Map
          ? (json['ripgrep'] as Map).cast<String, dynamic>()
          : null,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      if (enabled != null) 'enabled': enabled,
      if (autoAllowBashIfSandboxed != null)
        'autoAllowBashIfSandboxed': autoAllowBashIfSandboxed,
      if (allowUnsandboxedCommands != null)
        'allowUnsandboxedCommands': allowUnsandboxedCommands,
      if (network != null) 'network': network!.toJson(),
      if (filesystem != null) 'filesystem': filesystem!.toJson(),
      if (ignoreViolations != null) 'ignoreViolations': ignoreViolations,
      if (enableWeakerNestedSandbox != null)
        'enableWeakerNestedSandbox': enableWeakerNestedSandbox,
      if (excludedCommands != null) 'excludedCommands': excludedCommands,
      if (ripgrep != null) 'ripgrep': ripgrep,
    };
  }
}
