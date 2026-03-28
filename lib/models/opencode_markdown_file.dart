import 'package:broski/models/skill.dart';

class OpenCodeMarkdownFile {
  final String name;
  final String path;
  final SkillSource source;
  final String? description;

  const OpenCodeMarkdownFile({
    required this.name,
    required this.path,
    required this.source,
    this.description,
  });

  factory OpenCodeMarkdownFile.fromJson(Map<String, dynamic> json) {
    return OpenCodeMarkdownFile(
      name: json['name'] as String? ?? '',
      path: json['path'] as String? ?? '',
      source: SkillSource.fromWire(json['source'] as String?),
      description: json['description'] as String?,
    );
  }
}
