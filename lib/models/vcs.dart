/// A file-level diff.
/// Contains full before/after content and line-change counts.
class VcsDiffFile {
  final String file;
  final String before;
  final String after;
  final int additions;
  final int deletions;
  final String? status; // "added" | "deleted" | "modified"

  const VcsDiffFile({
    required this.file,
    this.before = '',
    this.after = '',
    this.additions = 0,
    this.deletions = 0,
    this.status,
  });

  factory VcsDiffFile.fromJson(Map<String, dynamic> json) {
    return VcsDiffFile(
      file: json['file'] as String? ?? '',
      before: json['before'] as String? ?? '',
      after: json['after'] as String? ?? '',
      additions: json['additions'] as int? ?? 0,
      deletions: json['deletions'] as int? ?? 0,
      status: json['status'] as String?,
    );
  }

  /// Just the filename, without directory path
  String get filename => file.split('/').last;

  /// Short status label: A, D, M, or ?
  String get statusLabel => switch (status) {
    'added' => 'A',
    'deleted' => 'D',
    'modified' => 'M',
    _ => '?',
  };

  bool get isAdded => status == 'added';
  bool get isDeleted => status == 'deleted';
  bool get isModified => status == 'modified';

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is VcsDiffFile &&
          runtimeType == other.runtimeType &&
          file == other.file &&
          status == other.status;

  @override
  int get hashCode => Object.hash(file, status);

  @override
  String toString() =>
      'VcsDiffFile($statusLabel $file +$additions -$deletions)';
}
