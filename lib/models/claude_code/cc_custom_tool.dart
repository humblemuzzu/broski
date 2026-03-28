// =============================================================================
// Custom Tool Types
// =============================================================================

/// Parameter type for custom tool parameters
enum CustomToolParameterType {
  string,
  number,
  boolean,
  array,
  object;

  String get wireValue => name;

  static CustomToolParameterType fromWireValue(String? value) {
    switch (value) {
      case 'number':
        return CustomToolParameterType.number;
      case 'boolean':
        return CustomToolParameterType.boolean;
      case 'array':
        return CustomToolParameterType.array;
      case 'object':
        return CustomToolParameterType.object;
      default:
        return CustomToolParameterType.string;
    }
  }

  String get displayName {
    switch (this) {
      case CustomToolParameterType.string:
        return 'Text';
      case CustomToolParameterType.number:
        return 'Number';
      case CustomToolParameterType.boolean:
        return 'Boolean';
      case CustomToolParameterType.array:
        return 'Array';
      case CustomToolParameterType.object:
        return 'Object';
    }
  }
}

/// Handler type for custom tools
enum CustomToolHandlerType {
  http,
  script,
  builtin;

  String get wireValue => name;

  static CustomToolHandlerType fromWireValue(String? value) {
    switch (value) {
      case 'script':
        return CustomToolHandlerType.script;
      case 'builtin':
        return CustomToolHandlerType.builtin;
      default:
        return CustomToolHandlerType.http;
    }
  }

  String get displayName {
    switch (this) {
      case CustomToolHandlerType.http:
        return 'HTTP Request';
      case CustomToolHandlerType.script:
        return 'Script/Command';
      case CustomToolHandlerType.builtin:
        return 'Built-in';
    }
  }

  String get description {
    switch (this) {
      case CustomToolHandlerType.http:
        return 'Make HTTP requests to external APIs';
      case CustomToolHandlerType.script:
        return 'Execute local scripts or commands';
      case CustomToolHandlerType.builtin:
        return 'Reserved for built-in tools';
    }
  }
}

class BuiltinHandlerConfig {
  final String action;
  final Map<String, dynamic> config;

  const BuiltinHandlerConfig({required this.action, this.config = const {}});

  factory BuiltinHandlerConfig.fromJson(Map<String, dynamic> json) {
    return BuiltinHandlerConfig(
      action: json['action'] as String? ?? '',
      config: json['config'] is Map<String, dynamic>
          ? json['config'] as Map<String, dynamic>
          : const {},
    );
  }

  Map<String, dynamic> toJson() {
    return {'action': action, if (config.isNotEmpty) 'config': config};
  }
}

/// HTTP method for HTTP handler
enum HttpMethod {
  get,
  post,
  put,
  delete,
  patch;

  String get wireValue => name.toUpperCase();

  static HttpMethod fromWireValue(String? value) {
    switch (value?.toUpperCase()) {
      case 'POST':
        return HttpMethod.post;
      case 'PUT':
        return HttpMethod.put;
      case 'DELETE':
        return HttpMethod.delete;
      case 'PATCH':
        return HttpMethod.patch;
      default:
        return HttpMethod.get;
    }
  }

  String get displayName => wireValue;
}

/// Custom tool parameter definition
class CustomToolParameter {
  final String name;
  final CustomToolParameterType type;
  final String? description;
  final bool required;
  final dynamic defaultValue;
  final List<String>? enumValues;

  const CustomToolParameter({
    required this.name,
    required this.type,
    this.description,
    this.required = false,
    this.defaultValue,
    this.enumValues,
  });

  factory CustomToolParameter.fromJson(Map<String, dynamic> json) {
    return CustomToolParameter(
      name: json['name'] as String? ?? '',
      type: CustomToolParameterType.fromWireValue(json['type'] as String?),
      description: json['description'] as String?,
      required: json['required'] as bool? ?? false,
      defaultValue: json['default'],
      enumValues: (json['enum'] as List<dynamic>?)?.cast<String>(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'name': name,
      'type': type.wireValue,
      if (description != null && description!.isNotEmpty)
        'description': description,
      if (required) 'required': required,
      if (defaultValue != null) 'default': defaultValue,
      if (enumValues != null && enumValues!.isNotEmpty) 'enum': enumValues,
    };
  }

  CustomToolParameter copyWith({
    String? name,
    CustomToolParameterType? type,
    String? description,
    bool? required,
    dynamic defaultValue,
    List<String>? enumValues,
  }) {
    return CustomToolParameter(
      name: name ?? this.name,
      type: type ?? this.type,
      description: description ?? this.description,
      required: required ?? this.required,
      defaultValue: defaultValue ?? this.defaultValue,
      enumValues: enumValues ?? this.enumValues,
    );
  }
}

/// HTTP handler configuration
class HttpHandlerConfig {
  final String url;
  final HttpMethod method;
  final Map<String, String>? headers;
  final String? bodyTemplate;

  const HttpHandlerConfig({
    required this.url,
    required this.method,
    this.headers,
    this.bodyTemplate,
  });

  factory HttpHandlerConfig.fromJson(Map<String, dynamic> json) {
    return HttpHandlerConfig(
      url: json['url'] as String? ?? '',
      method: HttpMethod.fromWireValue(json['method'] as String?),
      headers: (json['headers'] as Map<String, dynamic>?)
          ?.cast<String, String>(),
      bodyTemplate: json['bodyTemplate'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'url': url,
      'method': method.wireValue,
      if (headers != null && headers!.isNotEmpty) 'headers': headers,
      if (bodyTemplate != null && bodyTemplate!.isNotEmpty)
        'bodyTemplate': bodyTemplate,
    };
  }

  HttpHandlerConfig copyWith({
    String? url,
    HttpMethod? method,
    Map<String, String>? headers,
    String? bodyTemplate,
  }) {
    return HttpHandlerConfig(
      url: url ?? this.url,
      method: method ?? this.method,
      headers: headers ?? this.headers,
      bodyTemplate: bodyTemplate ?? this.bodyTemplate,
    );
  }
}

/// Script handler configuration
class ScriptHandlerConfig {
  final String command;
  final List<String>? args;
  final String? cwd;
  final int? timeout;
  final bool shell;

  const ScriptHandlerConfig({
    required this.command,
    this.args,
    this.cwd,
    this.timeout,
    this.shell = true,
  });

  factory ScriptHandlerConfig.fromJson(Map<String, dynamic> json) {
    return ScriptHandlerConfig(
      command: json['command'] as String? ?? '',
      args: (json['args'] as List<dynamic>?)?.cast<String>(),
      cwd: json['cwd'] as String?,
      timeout: json['timeout'] as int?,
      shell: json['shell'] as bool? ?? true,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'command': command,
      if (args != null && args!.isNotEmpty) 'args': args,
      if (cwd != null && cwd!.isNotEmpty) 'cwd': cwd,
      if (timeout != null) 'timeout': timeout,
      if (!shell) 'shell': shell,
    };
  }

  ScriptHandlerConfig copyWith({
    String? command,
    List<String>? args,
    String? cwd,
    int? timeout,
    bool? shell,
  }) {
    return ScriptHandlerConfig(
      command: command ?? this.command,
      args: args ?? this.args,
      cwd: cwd ?? this.cwd,
      timeout: timeout ?? this.timeout,
      shell: shell ?? this.shell,
    );
  }
}

/// Custom tool definition
class ClaudeCodeCustomTool {
  final String id;
  final String name;
  final String description;
  final List<CustomToolParameter> parameters;
  final CustomToolHandlerType handler;
  final dynamic
  handlerConfig; // HttpHandlerConfig | ScriptHandlerConfig | BuiltinHandlerConfig
  final bool enabled;
  final int createdAt;
  final int updatedAt;

  const ClaudeCodeCustomTool({
    required this.id,
    required this.name,
    required this.description,
    required this.parameters,
    required this.handler,
    required this.handlerConfig,
    required this.enabled,
    required this.createdAt,
    required this.updatedAt,
  });

  /// Get HTTP handler config (if handler type is HTTP)
  HttpHandlerConfig? get httpConfig => handler == CustomToolHandlerType.http
      ? handlerConfig as HttpHandlerConfig
      : null;

  /// Get script handler config (if handler type is script)
  ScriptHandlerConfig? get scriptConfig =>
      handler == CustomToolHandlerType.script
      ? handlerConfig as ScriptHandlerConfig
      : null;

  BuiltinHandlerConfig? get builtinConfig =>
      handler == CustomToolHandlerType.builtin
      ? handlerConfig as BuiltinHandlerConfig
      : null;

  /// Get the MCP tool name as it will appear in Claude Code
  String get mcpToolName => 'mcp__broski-custom-tools__$name';

  factory ClaudeCodeCustomTool.fromJson(Map<String, dynamic> json) {
    final handlerType = CustomToolHandlerType.fromWireValue(
      json['handler'] as String?,
    );
    final configJson = json['handlerConfig'] as Map<String, dynamic>? ?? {};

    final dynamic config = switch (handlerType) {
      CustomToolHandlerType.http => HttpHandlerConfig.fromJson(configJson),
      CustomToolHandlerType.script => ScriptHandlerConfig.fromJson(configJson),
      CustomToolHandlerType.builtin => BuiltinHandlerConfig.fromJson(
        configJson,
      ),
    };

    return ClaudeCodeCustomTool(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      description: json['description'] as String? ?? '',
      parameters:
          (json['parameters'] as List<dynamic>?)
              ?.map(
                (e) => CustomToolParameter.fromJson(e as Map<String, dynamic>),
              )
              .toList() ??
          const [],
      handler: handlerType,
      handlerConfig: config,
      enabled: json['enabled'] as bool? ?? true,
      createdAt: json['createdAt'] as int? ?? 0,
      updatedAt: json['updatedAt'] as int? ?? 0,
    );
  }

  Map<String, dynamic> toJson() {
    final dynamic configJson = switch (handler) {
      CustomToolHandlerType.http =>
        (handlerConfig as HttpHandlerConfig).toJson(),
      CustomToolHandlerType.script =>
        (handlerConfig as ScriptHandlerConfig).toJson(),
      CustomToolHandlerType.builtin =>
        (handlerConfig as BuiltinHandlerConfig).toJson(),
    };

    return {
      'id': id,
      'name': name,
      'description': description,
      'parameters': parameters.map((e) => e.toJson()).toList(),
      'handler': handler.wireValue,
      'handlerConfig': configJson,
      'enabled': enabled,
      'createdAt': createdAt,
      'updatedAt': updatedAt,
    };
  }

  ClaudeCodeCustomTool copyWith({
    String? id,
    String? name,
    String? description,
    List<CustomToolParameter>? parameters,
    CustomToolHandlerType? handler,
    dynamic handlerConfig,
    bool? enabled,
    int? createdAt,
    int? updatedAt,
  }) {
    return ClaudeCodeCustomTool(
      id: id ?? this.id,
      name: name ?? this.name,
      description: description ?? this.description,
      parameters: parameters ?? this.parameters,
      handler: handler ?? this.handler,
      handlerConfig: handlerConfig ?? this.handlerConfig,
      enabled: enabled ?? this.enabled,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }

  /// Create a new empty custom tool with HTTP handler
  factory ClaudeCodeCustomTool.empty() {
    return const ClaudeCodeCustomTool(
      id: '',
      name: '',
      description: '',
      parameters: [],
      handler: CustomToolHandlerType.http,
      handlerConfig: HttpHandlerConfig(url: '', method: HttpMethod.get),
      enabled: true,
      createdAt: 0,
      updatedAt: 0,
    );
  }

  /// Validate the tool definition
  List<String> validate() {
    final errors = <String>[];

    if (name.isEmpty) {
      errors.add('Tool name is required');
    } else if (!RegExp(r'^[a-zA-Z_][a-zA-Z0-9_]*$').hasMatch(name)) {
      errors.add(
        'Tool name must start with a letter or underscore and contain only alphanumeric characters',
      );
    }

    if (description.isEmpty) {
      errors.add('Tool description is required');
    }

    if (handler == CustomToolHandlerType.http) {
      final config = httpConfig;
      if (config == null || config.url.isEmpty) {
        errors.add('HTTP URL is required');
      }
    } else if (handler == CustomToolHandlerType.script) {
      final config = scriptConfig;
      if (config == null || config.command.isEmpty) {
        errors.add('Script command is required');
      }
    }

    // Validate parameters
    final paramNames = <String>{};
    for (final param in parameters) {
      if (param.name.isEmpty) {
        errors.add('Parameter name is required');
      } else if (paramNames.contains(param.name)) {
        errors.add('Duplicate parameter name: ${param.name}');
      }
      paramNames.add(param.name);
    }

    return errors;
  }

  bool get isValid => validate().isEmpty;
}

/// Test result for custom tool
class CustomToolTestResult {
  final bool success;
  final String? result;
  final String? error;

  const CustomToolTestResult({required this.success, this.result, this.error});

  factory CustomToolTestResult.fromJson(Map<String, dynamic> json) {
    return CustomToolTestResult(
      success: json['success'] as bool? ?? false,
      result: json['result'] as String?,
      error: json['error'] as String?,
    );
  }
}
