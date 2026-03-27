import 'skill.dart';

class OpenCodePluginFile {
  final String name;
  final String path;
  final SkillSource source;

  const OpenCodePluginFile({
    required this.name,
    required this.path,
    required this.source,
  });

  factory OpenCodePluginFile.fromJson(Map<String, dynamic> json) {
    return OpenCodePluginFile(
      name: json['name'] as String? ?? '',
      path: json['path'] as String? ?? '',
      source: SkillSource.fromWire(json['source'] as String?),
    );
  }
}
