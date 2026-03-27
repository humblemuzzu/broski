part of '../bridge_service.dart';

/// Git worktree operations.
/// Extracted from bridge_service.dart to reduce file size.
extension BridgeServiceWorktrees on BridgeService {
  /// List all worktrees for a project
  Future<List<Worktree>> listWorktrees({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'list_worktrees',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('worktrees', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .map((item) => Worktree.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  /// Create a new worktree
  Future<Worktree?> createWorktree({
    String? name,
    String? startCommand,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'create_worktree',
      'requestId': requestId,
      if (name != null) 'name': name,
      if (startCommand != null) 'startCommand': startCommand,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('worktree_created', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>?;
    if (data == null) return null;
    return Worktree.fromJson(data);
  }

  Future<bool> resetWorktree(
    String worktreeDirectory, {
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'reset_worktree',
      'worktreeDirectory': worktreeDirectory,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('worktree_reset', requestId: requestId);
    return response['data'] as bool? ?? false;
  }

  /// Delete a worktree
  Future<bool> deleteWorktree(String name, {String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'delete_worktree',
      'name': name,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('worktree_deleted', requestId: requestId);
    return response['data'] as bool? ?? false;
  }
}
