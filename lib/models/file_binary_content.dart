import 'dart:convert';
import 'dart:typed_data';

class FileBinaryContent {
  final String base64Data;
  final String mime;
  final int size;

  const FileBinaryContent({
    required this.base64Data,
    required this.mime,
    required this.size,
  });

  factory FileBinaryContent.fromJson(Map<String, dynamic> json) {
    return FileBinaryContent(
      base64Data: json['base64'] as String? ?? '',
      mime: json['mime'] as String? ?? 'application/octet-stream',
      size: json['size'] as int? ?? 0,
    );
  }

  Uint8List get bytes => base64Decode(base64Data);

  bool get isImage => mime.startsWith('image/');
  bool get isPdf => mime == 'application/pdf';

  String get sizeFormatted {
    if (size < 1024) return '$size B';
    if (size < 1024 * 1024) return '${(size / 1024).toStringAsFixed(1)} KB';
    return '${(size / (1024 * 1024)).toStringAsFixed(1)} MB';
  }
}

class FileTooLargeError {
  final String path;
  final int size;
  final int maxSize;

  const FileTooLargeError({
    required this.path,
    required this.size,
    required this.maxSize,
  });

  factory FileTooLargeError.fromJson(Map<String, dynamic> json) {
    return FileTooLargeError(
      path: json['path'] as String? ?? '',
      size: json['size'] as int? ?? 0,
      maxSize: json['maxSize'] as int? ?? 0,
    );
  }

  String get sizeFormatted {
    if (size < 1024 * 1024) return '${(size / 1024).toStringAsFixed(1)} KB';
    return '${(size / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  String get maxSizeFormatted {
    return '${(maxSize / (1024 * 1024)).toStringAsFixed(0)} MB';
  }
}

sealed class FileBinaryResult {
  const FileBinaryResult();

  factory FileBinaryResult.success(FileBinaryContent content) =
      FileBinarySuccess;
  factory FileBinaryResult.tooLarge(FileTooLargeError error) =
      FileBinaryTooLarge;
}

class FileBinarySuccess extends FileBinaryResult {
  final FileBinaryContent content;
  const FileBinarySuccess(this.content);
}

class FileBinaryTooLarge extends FileBinaryResult {
  final FileTooLargeError error;
  const FileBinaryTooLarge(this.error);
}
