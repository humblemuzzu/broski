class FileContent {
  final String content;
  final String mime;
  final String type;
  final String? encoding;

  const FileContent({
    required this.content,
    required this.mime,
    this.type = 'text',
    this.encoding,
  });

  factory FileContent.fromJson(Map<String, dynamic> json) {
    final mime =
        (json['mimeType'] as String?) ??
        (json['mime'] as String?) ??
        'text/plain';
    return FileContent(
      content: json['content'] as String? ?? '',
      mime: mime,
      type: (json['type'] as String? ?? 'text'),
      encoding: json['encoding'] as String?,
    );
  }

  bool get isBinary => type == 'binary';

  bool get isText =>
      !isBinary &&
      (mime.startsWith('text/') ||
          mime.contains('json') ||
          mime.contains('xml') ||
          mime.contains('javascript') ||
          mime.contains('typescript'));

  bool get isImage => mime.startsWith('image/');

  bool get isPdf => mime == 'application/pdf';

  bool get isCsv => mime.contains('csv') || mime == 'text/csv';

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

  static bool isImagePath(String path) {
    final ext = path.split('.').last.toLowerCase();
    return [
      'png',
      'jpg',
      'jpeg',
      'gif',
      'webp',
      'bmp',
      'ico',
      'svg',
    ].contains(ext);
  }

  static bool isPdfPath(String path) {
    return path.toLowerCase().endsWith('.pdf');
  }

  static bool isMarkdownPath(String path) {
    final ext = path.split('.').last.toLowerCase();
    return ['md', 'markdown'].contains(ext);
  }

  static bool isCsvPath(String path) {
    return path.toLowerCase().endsWith('.csv');
  }

  static bool isBinaryPath(String path) {
    return isImagePath(path) || isPdfPath(path);
  }

  static bool isCodePath(String path) {
    final ext = path.split('.').last.toLowerCase();
    return [
      'dart',
      'ts',
      'tsx',
      'js',
      'jsx',
      'py',
      'java',
      'kt',
      'kts',
      'swift',
      'rs',
      'go',
      'rb',
      'php',
      'cpp',
      'cc',
      'cxx',
      'hpp',
      'c',
      'h',
      'css',
      'scss',
      'sass',
      'html',
      'htm',
      'xml',
      'json',
      'yaml',
      'yml',
      'sql',
      'sh',
      'bash',
      'gradle',
      'toml',
    ].contains(ext);
  }
}
