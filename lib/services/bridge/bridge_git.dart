part of '../bridge_service.dart';

/// Git and GitHub operations.
/// Extracted from bridge_service.dart to reduce file size.
extension BridgeServiceGit on BridgeService {
  // ============================================================
  // VCS / Git Information
  // ============================================================

  /// Get VCS (git) information for the project
  Future<VcsInfo> getVcsInfo({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'get_vcs',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('vcs', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return VcsInfo.fromJson(data);
  }

  /// Get git status of files in the project
  Future<List<FileStatusInfo>> getFileStatus({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'get_file_status',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('file_status', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .map((f) => FileStatusInfo.fromJson(f as Map<String, dynamic>))
        .toList();
  }

  Future<GitStatusResult> gitStatus({required String projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'git_status',
      'projectPath': projectPath,
      'requestId': requestId,
    });
    final response = await _waitFor('git_status_result', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return GitStatusResult.fromJson(data);
  }

  Future<List<GitLogEntry>> gitLog({
    required String projectPath,
    int limit = 50,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'git_log',
      'projectPath': projectPath,
      'limit': limit,
      'requestId': requestId,
    });
    final response = await _waitFor('git_log_result', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .whereType<Map>()
        .map((item) => GitLogEntry.fromJson(item.cast<String, dynamic>()))
        .toList();
  }

  Future<List<GitBranch>> gitBranches({required String projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'git_branches',
      'projectPath': projectPath,
      'requestId': requestId,
    });
    final response = await _waitFor(
      'git_branches_result',
      requestId: requestId,
    );
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .whereType<Map>()
        .map((item) => GitBranch.fromJson(item.cast<String, dynamic>()))
        .toList();
  }

  Future<void> gitStage({required String projectPath, String? path}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'git_stage',
      'projectPath': projectPath,
      if (path != null) 'path': path,
      'requestId': requestId,
    });
    await _waitFor('git_staged', requestId: requestId);
  }

  Future<void> gitUnstage({required String projectPath, String? path}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'git_unstage',
      'projectPath': projectPath,
      if (path != null) 'path': path,
      'requestId': requestId,
    });
    await _waitFor('git_unstaged', requestId: requestId);
  }

  Future<void> gitRevertFile({
    required String projectPath,
    required String path,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'git_revert_file',
      'projectPath': projectPath,
      'path': path,
      'requestId': requestId,
    });
    await _waitFor('git_reverted', requestId: requestId);
  }

  Future<GitCommitResult> gitCommit({
    required String projectPath,
    required String message,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'git_commit',
      'projectPath': projectPath,
      'message': message,
      'requestId': requestId,
    });
    final response = await _waitFor('git_committed', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return GitCommitResult.fromJson(data);
  }

  Future<void> gitPush({
    required String projectPath,
    bool force = false,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'git_push',
      'projectPath': projectPath,
      'force': force,
      'requestId': requestId,
    });
    await _waitFor('git_pushed', requestId: requestId);
  }

  Future<void> gitPull({
    required String projectPath,
    bool rebase = true,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'git_pull',
      'projectPath': projectPath,
      'rebase': rebase,
      'requestId': requestId,
    });
    await _waitFor('git_pulled', requestId: requestId);
  }

  Future<void> gitFetch({required String projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'git_fetch',
      'projectPath': projectPath,
      'requestId': requestId,
    });
    await _waitFor('git_fetched', requestId: requestId);
  }

  Future<void> gitCheckout({
    required String projectPath,
    required String branch,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'git_checkout',
      'projectPath': projectPath,
      'branch': branch,
      'requestId': requestId,
    });
    await _waitFor('git_checked_out', requestId: requestId);
  }

  Future<void> gitCreateBranch({
    required String projectPath,
    required String name,
    String? startPoint,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'git_create_branch',
      'projectPath': projectPath,
      'name': name,
      if (startPoint != null) 'startPoint': startPoint,
      'requestId': requestId,
    });
    await _waitFor('git_branch_created', requestId: requestId);
  }

  Future<void> gitStash({required String projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'git_stash',
      'projectPath': projectPath,
      'requestId': requestId,
    });
    await _waitFor('git_stashed', requestId: requestId);
  }

  Future<void> gitStashPop({required String projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'git_stash_pop',
      'projectPath': projectPath,
      'requestId': requestId,
    });
    await _waitFor('git_stash_popped', requestId: requestId);
  }

  Future<String> gitDiff({
    required String projectPath,
    String? path,
    bool staged = false,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'git_diff',
      'projectPath': projectPath,
      if (path != null && path.isNotEmpty) 'path': path,
      'staged': staged,
      'requestId': requestId,
    });
    final response = await _waitFor('git_diff', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return data['diff'] as String? ?? '';
  }

  Future<String> gitCommitDiff({
    required String projectPath,
    required String hash,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'git_commit_diff',
      'projectPath': projectPath,
      'hash': hash,
      'requestId': requestId,
    });
    final response = await _waitFor(
      'git_commit_diff_result',
      requestId: requestId,
    );
    return response['data'] as String? ?? '';
  }

  // ============================================================
  // GitHub Integration
  // ============================================================

  Future<GitHubRemote?> githubRemote({required String projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'github_remote',
      'projectPath': projectPath,
      'requestId': requestId,
    });
    final response = await _waitFor(
      'github_remote_result',
      requestId: requestId,
    );
    final data = response['data'];
    if (data is Map<String, dynamic>) {
      return GitHubRemote.fromJson(data);
    }
    return null;
  }

  Future<List<GitHubIssue>> githubIssues({
    required String projectPath,
    GitHubItemState state = GitHubItemState.open,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'github_issues',
      'projectPath': projectPath,
      'state': state.wireValue,
      'requestId': requestId,
    });
    final response = await _waitFor(
      'github_issues_result',
      requestId: requestId,
    );
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .whereType<Map>()
        .map((item) => GitHubIssue.fromJson(item.cast<String, dynamic>()))
        .toList();
  }

  Future<List<GitHubPR>> githubPrs({
    required String projectPath,
    GitHubItemState state = GitHubItemState.open,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'github_prs',
      'projectPath': projectPath,
      'state': state.wireValue,
      'requestId': requestId,
    });
    final response = await _waitFor('github_prs_result', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .whereType<Map>()
        .map((item) => GitHubPR.fromJson(item.cast<String, dynamic>()))
        .toList();
  }

  Future<String> githubPrDiff({
    required String projectPath,
    required int prNumber,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'github_pr_diff',
      'projectPath': projectPath,
      'prNumber': prNumber,
      'requestId': requestId,
    });
    final response = await _waitFor(
      'github_pr_diff_result',
      requestId: requestId,
    );
    return response['data'] as String? ?? '';
  }

  Future<List<GitHubComment>> githubPrComments({
    required String projectPath,
    required int prNumber,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'github_pr_comments',
      'projectPath': projectPath,
      'prNumber': prNumber,
      'requestId': requestId,
    });
    final response = await _waitFor(
      'github_pr_comments_result',
      requestId: requestId,
    );
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .whereType<Map>()
        .map((item) => GitHubComment.fromJson(item.cast<String, dynamic>()))
        .toList();
  }
}
