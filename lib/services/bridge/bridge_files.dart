part of '../bridge_service.dart';

/// File read/write and search operations.
/// Extracted from bridge_service.dart to reduce file size.
extension BridgeServiceFiles on BridgeService {
  // ============================================================
  // File Content Read
  // ============================================================

  Future<FileContent> readFile(String path, {String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'read_file',
      'path': path,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('file_content', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return FileContent.fromJson(data);
  }

  Future<FileBinaryResult> readFileBinary(
    String path, {
    int maxSizeMb = 10,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'read_file_binary',
      'path': path,
      'requestId': requestId,
      'maxSizeMb': maxSizeMb,
    });

    final response = await _socket.messages
        .firstWhere((message) {
          if (message['requestId'] != requestId) return false;
          final type = message['type'];
          return type == 'file_binary' ||
              type == 'file_too_large' ||
              type == 'error';
        })
        .timeout(
          const Duration(seconds: 30),
          onTimeout: () => throw TimeoutException('Binary file read timeout'),
        );

    final type = response['type'];
    if (type == 'file_too_large') {
      final payload = response['data'];
      if (payload is Map<String, dynamic>) {
        return FileBinaryResult.tooLarge(FileTooLargeError.fromJson(payload));
      }
      // Backward compatibility (older bridge used top-level fields)
      return FileBinaryResult.tooLarge(FileTooLargeError.fromJson(response));
    }
    if (type == 'error') {
      throw Exception(response['message'] ?? 'Failed to read file');
    }

    final data = response['data'] as Map<String, dynamic>? ?? {};
    return FileBinaryResult.success(FileBinaryContent.fromJson(data));
  }

  // ============================================================
  // File Search
  // ============================================================

  Future<List<String>> findFiles(String query, {String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'find_files',
      'query': query,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('files_found', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data.map((item) => item.toString()).toList();
  }

  Future<List<String>> searchFilesAndDirs(
    String query, {
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'search_files_and_dirs',
      'query': query,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor(
      'files_and_dirs_found',
      requestId: requestId,
    );
    final data = response['data'] as List<dynamic>? ?? [];
    return data.map((item) => item.toString()).toList();
  }

  Future<List<TextSearchResult>> findText(
    String pattern, {
    String? include,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'find_text',
      'pattern': pattern,
      'requestId': requestId,
      if (include != null) 'include': include,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('text_found', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .map((item) => TextSearchResult.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  /// Find symbols in codebase (LSP search)
  Future<List<SymbolResult>> findSymbols(
    String query, {
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'find_symbols',
      'query': query,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('symbols_found', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .map((item) => SymbolResult.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  // ============================================================
  // File Browsing
  // ============================================================

  Future<List<dynamic>> browse(String path, {String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'browse',
      'path': path,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor(
      'browse_result',
      requestId: requestId,
      timeoutSeconds: 20,
    );
    final data = response['data'] as Map<String, dynamic>? ?? const {};
    return data['items'] as List<dynamic>? ?? [];
  }
}
