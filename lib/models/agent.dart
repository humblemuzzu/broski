import 'package:flutter/material.dart';

import '../theme/opencode_theme.dart';

/// Agent mode indicating how the agent can be used.
enum AgentMode {
  primary,
  subagent,
  all;

  static AgentMode fromString(String m) {
    switch (m) {
      case 'subagent':
        return AgentMode.subagent;
      case 'all':
        return AgentMode.all;
      default:
        return AgentMode.primary;
    }
  }

  String get displayName {
    switch (this) {
      case AgentMode.primary:
        return 'Primary';
      case AgentMode.subagent:
        return 'Sub-agent';
      case AgentMode.all:
        return 'All';
    }
  }
}

class AgentModelRef {
  final String providerID;
  final String modelID;

  const AgentModelRef({required this.providerID, required this.modelID});

  factory AgentModelRef.fromJson(Map<String, dynamic> json) {
    return AgentModelRef(
      providerID: json['providerID'] as String? ?? '',
      modelID: json['modelID'] as String? ?? '',
    );
  }

  String get displayName {
    if (providerID.isEmpty) return modelID;
    return '$providerID/$modelID';
  }
}

/// An AI agent from OpenCode.
class Agent {
  final String name;
  final String? description;
  final String? color;
  final AgentMode mode;
  final bool native;
  final bool hidden;
  final double? topP;
  final double? temperature;
  final AgentModelRef? model;
  final String? variant;
  final String? prompt;
  final int? steps;

  const Agent({
    required this.name,
    this.description,
    this.color,
    required this.mode,
    this.native = false,
    this.hidden = false,
    this.topP,
    this.temperature,
    this.model,
    this.variant,
    this.prompt,
    this.steps,
  });

  factory Agent.fromJson(Map<String, dynamic> json) {
    final modelJson = json['model'] as Map<String, dynamic>?;
    return Agent(
      name: json['name'] as String? ?? '',
      description: json['description'] as String?,
      color: json['color'] as String?,
      mode: AgentMode.fromString(json['mode'] as String? ?? 'primary'),
      native: json['native'] as bool? ?? false,
      hidden: json['hidden'] as bool? ?? false,
      topP: (json['topP'] as num?)?.toDouble(),
      temperature: (json['temperature'] as num?)?.toDouble(),
      model: modelJson == null ? null : AgentModelRef.fromJson(modelJson),
      variant: json['variant'] as String?,
      prompt: json['prompt'] as String?,
      steps: json['steps'] as int?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'name': name,
      if (description != null) 'description': description,
      if (color != null) 'color': color,
      'mode': mode.name,
      if (native) 'native': native,
      if (hidden) 'hidden': hidden,
      if (topP != null) 'topP': topP,
      if (temperature != null) 'temperature': temperature,
      if (model != null)
        'model': {'providerID': model!.providerID, 'modelID': model!.modelID},
      if (variant != null) 'variant': variant,
      if (prompt != null) 'prompt': prompt,
      if (steps != null) 'steps': steps,
    };
  }

  bool get isPrimary => mode == AgentMode.primary || mode == AgentMode.all;

  String get displayName {
    if (name.isEmpty) return 'Unknown';
    return name[0].toUpperCase() + name.substring(1);
  }

  String get shortDescription {
    if (description != null && description!.isNotEmpty) {
      return description!;
    }
    switch (name) {
      case 'build':
        return 'Full access agent for development';
      case 'plan':
        return 'Read-only agent for analysis';
      case 'general':
        return 'General-purpose sub-agent';
      case 'explore':
        return 'Code exploration sub-agent';
      default:
        return 'AI agent';
    }
  }

  Color get displayColor {
    final token = color?.trim().toLowerCase();
    switch (token) {
      case 'primary':
        return const Color(0xFF3B82F6);
      case 'secondary':
        return const Color(0xFF8B5CF6);
      case 'accent':
        return const Color(0xFFEC4899);
      case 'success':
        return const Color(0xFF10B981);
      case 'warning':
        return const Color(0xFFF59E0B);
      case 'error':
        return const Color(0xFFEF4444);
      case 'info':
        return const Color(0xFF0EA5E9);
    }

    if (color != null && color!.startsWith('#')) {
      try {
        final hex = color!.replaceFirst('#', '');
        if (hex.length == 6) {
          return Color(int.parse('FF$hex', radix: 16));
        }
      } catch (_) {
        // Fall through to defaults.
      }
    }

    switch (name) {
      case 'build':
        return const Color(0xFF10B981);
      case 'plan':
        return const Color(0xFFF59E0B);
      case 'general':
        return const Color(0xFF6B7280);
      case 'explore':
        return const Color(0xFF8B5CF6);
      default:
        return const Color(0xFF3B82F6);
    }
  }

  Color resolveColor(OpenCodeTheme theme) {
    final token = color?.trim().toLowerCase();
    switch (token) {
      case 'primary':
        return theme.primary;
      case 'secondary':
        return theme.secondary;
      case 'accent':
        return theme.accent;
      case 'success':
        return theme.success;
      case 'warning':
        return theme.warning;
      case 'error':
        return theme.error;
      case 'info':
        return theme.info;
      default:
        return displayColor;
    }
  }

  Agent copyWith({
    String? name,
    String? description,
    String? color,
    AgentMode? mode,
    bool? native,
    bool? hidden,
    double? topP,
    double? temperature,
    AgentModelRef? model,
    String? variant,
    String? prompt,
    int? steps,
  }) {
    return Agent(
      name: name ?? this.name,
      description: description ?? this.description,
      color: color ?? this.color,
      mode: mode ?? this.mode,
      native: native ?? this.native,
      hidden: hidden ?? this.hidden,
      topP: topP ?? this.topP,
      temperature: temperature ?? this.temperature,
      model: model ?? this.model,
      variant: variant ?? this.variant,
      prompt: prompt ?? this.prompt,
      steps: steps ?? this.steps,
    );
  }
}

const kDefaultAgents = [
  Agent(
    name: 'build',
    description: 'Full access agent for development work',
    mode: AgentMode.primary,
  ),
  Agent(
    name: 'plan',
    description: 'Read-only agent for analysis and exploration',
    mode: AgentMode.primary,
  ),
];
