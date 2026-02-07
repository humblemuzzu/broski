/// Remote skill from the Codex public skills marketplace.
///
/// Matches SDK type: `RemoteSkillSummary = { id, name, description }`
class CodexRemoteSkill {
  final String id;
  final String name;
  final String description;

  const CodexRemoteSkill({
    required this.id,
    required this.name,
    required this.description,
  });

  factory CodexRemoteSkill.fromJson(Map<String, dynamic> json) {
    return CodexRemoteSkill(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      description: json['description'] as String? ?? '',
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'description': description,
  };
}
