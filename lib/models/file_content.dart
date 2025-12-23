/// File content from the read file API
class FileContent {
  final String content;
  final String mime;

  const FileContent({required this.content, required this.mime});

  factory FileContent.fromJson(Map<String, dynamic> json) {
    return FileContent(
      content: json['content'] as String? ?? '',
      mime: json['mime'] as String? ?? 'text/plain',
    );
  }

  /// Check if the file is a text file
  bool get isText =>
      mime.startsWith('text/') ||
      mime.contains('json') ||
      mime.contains('xml') ||
      mime.contains('javascript') ||
      mime.contains('typescript');

  /// Check if the file is an image
  bool get isImage => mime.startsWith('image/');

  /// Get a language hint for syntax highlighting based on mime type
  String get languageHint {
    if (mime.contains('dart')) return 'dart';
    if (mime.contains('typescript')) return 'typescript';
    if (mime.contains('javascript')) return 'javascript';
    if (mime.contains('python')) return 'python';
    if (mime.contains('java')) return 'java';
    if (mime.contains('kotlin')) return 'kotlin';
    if (mime.contains('swift')) return 'swift';
    if (mime.contains('rust')) return 'rust';
    if (mime.contains('go')) return 'go';
    if (mime.contains('ruby')) return 'ruby';
    if (mime.contains('php')) return 'php';
    if (mime.contains('c++') || mime.contains('cpp')) return 'cpp';
    if (mime.contains('c') && !mime.contains('css')) return 'c';
    if (mime.contains('css')) return 'css';
    if (mime.contains('html')) return 'html';
    if (mime.contains('xml')) return 'xml';
    if (mime.contains('json')) return 'json';
    if (mime.contains('yaml') || mime.contains('yml')) return 'yaml';
    if (mime.contains('markdown') || mime.contains('md')) return 'markdown';
    if (mime.contains('sql')) return 'sql';
    if (mime.contains('shell') || mime.contains('bash')) return 'bash';
    return 'plaintext';
  }

  /// Get language hint from file extension
  static String languageFromPath(String path) {
    final ext = path.split('.').last.toLowerCase();
    switch (ext) {
      case 'dart':
        return 'dart';
      case 'ts':
      case 'tsx':
        return 'typescript';
      case 'js':
      case 'jsx':
        return 'javascript';
      case 'py':
        return 'python';
      case 'java':
        return 'java';
      case 'kt':
      case 'kts':
        return 'kotlin';
      case 'swift':
        return 'swift';
      case 'rs':
        return 'rust';
      case 'go':
        return 'go';
      case 'rb':
        return 'ruby';
      case 'php':
        return 'php';
      case 'cpp':
      case 'cc':
      case 'cxx':
      case 'hpp':
        return 'cpp';
      case 'c':
      case 'h':
        return 'c';
      case 'css':
      case 'scss':
      case 'sass':
        return 'css';
      case 'html':
      case 'htm':
        return 'html';
      case 'xml':
        return 'xml';
      case 'json':
        return 'json';
      case 'yaml':
      case 'yml':
        return 'yaml';
      case 'md':
      case 'markdown':
        return 'markdown';
      case 'sql':
        return 'sql';
      case 'sh':
      case 'bash':
        return 'bash';
      case 'gradle':
        return 'groovy';
      case 'toml':
        return 'toml';
      default:
        return 'plaintext';
    }
  }
}
