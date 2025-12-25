import 'dart:typed_data';

class FileAttachment {
  FileAttachment({
    required this.path,
    this.isDirectory = false,
    this.mimeType,
    this.base64Data,
    this.thumbnailBytes,
  });

  /// Create from a file path (for @ tagging files/folders)
  factory FileAttachment.fromPath(String path) {
    return FileAttachment(path: path, isDirectory: path.endsWith('/'));
  }

  /// Create from an image picked from gallery/camera
  factory FileAttachment.fromImage({
    required String filename,
    required String mimeType,
    required String base64Data,
    Uint8List? thumbnailBytes,
  }) {
    return FileAttachment(
      path: filename,
      isDirectory: false,
      mimeType: mimeType,
      base64Data: base64Data,
      thumbnailBytes: thumbnailBytes,
    );
  }

  factory FileAttachment.fromJson(Map<String, dynamic> json) {
    return FileAttachment(
      path: json['path'] as String? ?? '',
      isDirectory: json['isDirectory'] as bool? ?? false,
      mimeType: json['mimeType'] as String?,
      base64Data: json['base64Data'] as String?,
    );
  }

  final String path;
  final bool isDirectory;

  /// MIME type for images (e.g., "image/png", "image/jpeg")
  final String? mimeType;

  /// Base64 encoded image data (for images picked from gallery/camera)
  final String? base64Data;

  /// Thumbnail bytes for preview (optional, for UI display)
  final Uint8List? thumbnailBytes;

  /// Check if this is an image attachment
  bool get isImage => mimeType?.startsWith('image/') ?? false;

  /// Check if this is a local file (no base64 data, uses file:// URL)
  bool get isLocalFile => base64Data == null;

  String get displayPath => isImage ? filename : '@$path';

  String get filename {
    final cleanPath = path.endsWith('/')
        ? path.substring(0, path.length - 1)
        : path;
    return cleanPath.split('/').last;
  }

  String get directory {
    final parts = path.split('/');
    if (parts.length <= 1) return '';
    return '${parts.sublist(0, parts.length - 1).join('/')}/';
  }

  Map<String, dynamic> toJson() => {
    'path': path,
    'isDirectory': isDirectory,
    if (mimeType != null) 'mimeType': mimeType,
    if (base64Data != null) 'base64Data': base64Data,
  };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is FileAttachment &&
          runtimeType == other.runtimeType &&
          path == other.path &&
          base64Data == other.base64Data;

  @override
  int get hashCode => Object.hash(path, base64Data);

  @override
  String toString() =>
      'FileAttachment($path, isDir: $isDirectory, isImage: $isImage)';
}
