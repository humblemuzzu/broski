import 'package:flutter/material.dart';

/// Agent mode indicating how the agent can be used
enum AgentMode {
  primary, // Main agent (build, plan)
  subagent, // Sub-agent spawned by primary agents
  all; // Can be used in any context

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

/// An AI agent from OpenCode (build, plan, general, explore)
class Agent {
  final String name;
  final String? description;
  final String? color;
  final AgentMode mode;

  const Agent({
    required this.name,
    this.description,
    this.color,
    required this.mode,
  });

  factory Agent.fromJson(Map<String, dynamic> json) {
    return Agent(
      name: json['name'] as String? ?? '',
      description: json['description'] as String?,
      color: json['color'] as String?,
      mode: AgentMode.fromString(json['mode'] as String? ?? 'primary'),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'name': name,
      if (description != null) 'description': description,
      if (color != null) 'color': color,
      'mode': mode.name,
    };
  }

  /// Whether this agent is available as a primary agent selection
  bool get isPrimary => mode == AgentMode.primary || mode == AgentMode.all;

  /// Display name with capitalized first letter
  String get displayName {
    if (name.isEmpty) return 'Unknown';
    return name[0].toUpperCase() + name.substring(1);
  }

  /// Short description for UI display
  String get shortDescription {
    if (description != null && description!.isNotEmpty) {
      return description!;
    }
    // Default descriptions for known agents
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

  /// Get the color for this agent (hex string -> Color)
  Color get displayColor {
    if (color != null && color!.startsWith('#')) {
      try {
        final hex = color!.replaceFirst('#', '');
        if (hex.length == 6) {
          return Color(int.parse('FF$hex', radix: 16));
        }
      } catch (_) {
        // Fall through to default
      }
    }
    // Default colors for known agents
    switch (name) {
      case 'build':
        return const Color(0xFF10B981); // Green
      case 'plan':
        return const Color(0xFFF59E0B); // Amber
      case 'general':
        return const Color(0xFF6B7280); // Gray
      case 'explore':
        return const Color(0xFF8B5CF6); // Purple
      default:
        return const Color(0xFF3B82F6); // Blue
    }
  }

  Agent copyWith({
    String? name,
    String? description,
    String? color,
    AgentMode? mode,
  }) {
    return Agent(
      name: name ?? this.name,
      description: description ?? this.description,
      color: color ?? this.color,
      mode: mode ?? this.mode,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is Agent &&
          runtimeType == other.runtimeType &&
          name == other.name &&
          description == other.description &&
          color == other.color &&
          mode == other.mode;

  @override
  int get hashCode =>
      name.hashCode ^ description.hashCode ^ color.hashCode ^ mode.hashCode;

  @override
  String toString() =>
      'Agent(name: $name, description: $description, color: $color, mode: $mode)';
}

/// Default agents when SDK doesn't return any
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
