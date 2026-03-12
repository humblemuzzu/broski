/// A memory entry from ~/.claude/memory/ (user), .claude/memory/ (project),
/// or ~/.claude/memory-local/ (local).
class ClaudeCodeMemoryEntry {
  final String scope; // 'user' | 'project' | 'local'
  final String filename;
  final String content;
  final String? createdAt;
  final String path;
  final String? source; // 'auto' | 'manual' | 'unknown'

  const ClaudeCodeMemoryEntry({
    required this.scope,
    required this.filename,
    required this.content,
    this.createdAt,
    required this.path,
    this.source,
  });

  factory ClaudeCodeMemoryEntry.fromJson(Map<String, dynamic> json) {
    return ClaudeCodeMemoryEntry(
      scope: json['scope'] as String? ?? 'user',
      filename: json['filename'] as String? ?? '',
      content: json['content'] as String? ?? '',
      createdAt: json['createdAt'] as String?,
      path: json['path'] as String? ?? '',
      source: json['source'] as String?,
    );
  }
}
