/// A collaboration mode preset fetched from the Codex app-server.
///
/// Protocol type: `CollaborationModeMask` (snake_case on wire — no rename_all).
/// Wire shape: `{ name, mode?, model?, reasoning_effort?, developer_instructions? }`
class CodexCollabModePreset {
  final String name;

  /// SDK `ModeKind`: `"plan"` | `"default"`.
  final String? mode;

  final String? model;
  final String? reasoningEffort;
  final String? developerInstructions;

  const CodexCollabModePreset({
    required this.name,
    this.mode,
    this.model,
    this.reasoningEffort,
    this.developerInstructions,
  });

  factory CodexCollabModePreset.fromJson(Map<String, dynamic> json) {
    return CodexCollabModePreset(
      name: json['name'] as String? ?? '',
      mode: json['mode'] as String?,
      model: json['model'] as String?,
      // Wire uses snake_case (CollaborationModeMask has no rename_all)
      reasoningEffort: (json['reasoning_effort'] ?? json['reasoningEffort'])
          as String?,
      developerInstructions:
          (json['developer_instructions'] ?? json['developerInstructions'])
              as String?,
    );
  }

  /// The wire value to send in `turn/start.collaborationMode.mode`.
  /// Falls back to `"default"` if the server didn't specify one.
  String get wireMode => mode ?? 'default';

  /// Human-friendly label for the UI.
  String get displayName =>
      name.isNotEmpty ? name : (mode == 'plan' ? 'Plan' : 'Default');

  /// Short description for subtitle text.
  String get description {
    final parts = <String>[];
    if (mode != null) parts.add(mode!);
    if (model != null) parts.add(model!);
    if (reasoningEffort != null) parts.add('effort: $reasoningEffort');
    return parts.isEmpty ? '' : parts.join(' · ');
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is CodexCollabModePreset &&
          runtimeType == other.runtimeType &&
          name == other.name &&
          mode == other.mode;

  @override
  int get hashCode => Object.hash(name, mode);
}
