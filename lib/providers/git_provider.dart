import 'dart:async';

import 'package:broski/models/agent_type.dart';
import 'package:broski/models/git.dart';
import 'package:broski/providers/agent_type_provider.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class GitHubListRequest {
  const GitHubListRequest({required this.projectPath, required this.state});

  final String projectPath;
  final GitHubItemState state;

  @override
  bool operator ==(Object other) {
    return other is GitHubListRequest &&
        other.projectPath == projectPath &&
        other.state == state;
  }

  @override
  int get hashCode => Object.hash(projectPath, state);
}

final gitStatusProvider = StateNotifierProvider.autoDispose
    .family<GitStatusNotifier, AsyncValue<GitStatusResult>, String>((
      ref,
      projectPath,
    ) {
      return GitStatusNotifier(ref, projectPath);
    });

class GitStatusNotifier extends StateNotifier<AsyncValue<GitStatusResult>> {
  GitStatusNotifier(this._ref, this.projectPath)
    : super(const AsyncValue.loading()) {
    load();
    _startPolling(_backgroundInterval);
  }

  final Ref _ref;
  final String projectPath;
  Timer? _pollTimer;
  bool _boosted = false;

  /// Default poll interval when git UI is not actively open.
  static const _backgroundInterval = Duration(seconds: 30);

  /// Faster poll interval when the git sheet/panel is visible.
  static const _foregroundInterval = Duration(seconds: 5);

  /// Call when the git sheet/panel becomes visible so polling speeds up.
  void boostPolling() {
    if (_boosted) return;
    _boosted = true;
    refresh(silent: true); // Immediate refresh on open
    _startPolling(_foregroundInterval);
  }

  /// Call when the git sheet/panel is closed to restore battery-friendly rate.
  void unboostPolling() {
    if (!_boosted) return;
    _boosted = false;
    _startPolling(_backgroundInterval);
  }

  void _startPolling(Duration interval) {
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(interval, (_) {
      refresh(silent: true);
    });
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
  }

  Future<void> load() async {
    final connection = _ref.read(connectionProvider);
    if (connection.isOfflineMode) {
      state = AsyncValue.error(
        StateError('Git is unavailable in offline mode'),
        StackTrace.current,
      );
      return;
    }

    state = const AsyncValue.loading();
    try {
      final bridge = _ref.read(bridgeServiceProvider);
      final status = await bridge.gitStatus(projectPath: projectPath);
      state = AsyncValue.data(status);
    } catch (e, st) {
      state = AsyncValue.error(e, st);
    }
  }

  Future<void> refresh({bool silent = false}) async {
    final connection = _ref.read(connectionProvider);
    if (connection.isOfflineMode) return;

    if (!silent) {
      state = const AsyncValue.loading();
    }

    try {
      final bridge = _ref.read(bridgeServiceProvider);
      final status = await bridge.gitStatus(projectPath: projectPath);
      state = AsyncValue.data(status);
    } catch (e, st) {
      if (!silent || !state.hasValue) {
        state = AsyncValue.error(e, st);
      }
    }
  }

  Future<void> stage({String? path}) async {
    final bridge = _ref.read(bridgeServiceProvider);
    await bridge.gitStage(projectPath: projectPath, path: path);
    await refresh();
  }

  Future<void> unstage({String? path}) async {
    final bridge = _ref.read(bridgeServiceProvider);
    await bridge.gitUnstage(projectPath: projectPath, path: path);
    await refresh();
  }

  Future<void> revertFile(String path) async {
    final bridge = _ref.read(bridgeServiceProvider);
    await bridge.gitRevertFile(projectPath: projectPath, path: path);
    await refresh();
  }

  Future<void> commit(String message) async {
    final bridge = _ref.read(bridgeServiceProvider);
    await bridge.gitCommit(projectPath: projectPath, message: message);
    await refresh();
  }

  Future<void> push({bool force = false}) async {
    final bridge = _ref.read(bridgeServiceProvider);
    await bridge.gitPush(projectPath: projectPath, force: force);
    await refresh();
  }

  Future<void> pull({bool rebase = true}) async {
    final bridge = _ref.read(bridgeServiceProvider);
    await bridge.gitPull(projectPath: projectPath, rebase: rebase);
    await refresh();
  }

  Future<void> fetch() async {
    final bridge = _ref.read(bridgeServiceProvider);
    await bridge.gitFetch(projectPath: projectPath);
    await refresh();
  }

  Future<void> checkout(String branch) async {
    final bridge = _ref.read(bridgeServiceProvider);
    await bridge.gitCheckout(projectPath: projectPath, branch: branch);
    await refresh();

    // Update Codex thread metadata with new git info (fire-and-forget)
    try {
      final agentType = _ref.read(agentTypeProvider);
      if (agentType == AgentType.codex) {
        final chatState = _ref.read(chatSessionProvider);
        final threadId = chatState.cxThreadId ?? '';
        if (threadId.isNotEmpty) {
          unawaited(
            bridge
                .cxUpdateThreadMetadata(
                  threadId: threadId,
                  gitInfo: {'branch': branch},
                )
                .timeout(const Duration(seconds: 5))
                .catchError((_) => false),
          );
        }
      }
    } catch (_) {
      // Best-effort metadata update
    }
  }

  Future<void> createBranch(String name, {String? startPoint}) async {
    final bridge = _ref.read(bridgeServiceProvider);
    await bridge.gitCreateBranch(
      projectPath: projectPath,
      name: name,
      startPoint: startPoint,
    );
    await refresh();
  }

  Future<void> stash() async {
    final bridge = _ref.read(bridgeServiceProvider);
    await bridge.gitStash(projectPath: projectPath);
    await refresh();
  }

  Future<void> stashPop() async {
    final bridge = _ref.read(bridgeServiceProvider);
    await bridge.gitStashPop(projectPath: projectPath);
    await refresh();
  }
}

final gitLogProvider = FutureProvider.autoDispose
    .family<List<GitLogEntry>, String>((ref, projectPath) async {
      final bridge = ref.watch(bridgeServiceProvider);
      return bridge.gitLog(projectPath: projectPath);
    });

final gitBranchesProvider = FutureProvider.autoDispose
    .family<List<GitBranch>, String>((ref, projectPath) async {
      final bridge = ref.watch(bridgeServiceProvider);
      return bridge.gitBranches(projectPath: projectPath);
    });

final githubRemoteProvider = FutureProvider.autoDispose
    .family<GitHubRemote?, String>((ref, projectPath) async {
      final bridge = ref.watch(bridgeServiceProvider);
      return bridge.githubRemote(projectPath: projectPath);
    });

final githubIssuesProvider = FutureProvider.autoDispose
    .family<List<GitHubIssue>, GitHubListRequest>((ref, request) async {
      final bridge = ref.watch(bridgeServiceProvider);
      return bridge.githubIssues(
        projectPath: request.projectPath,
        state: request.state,
      );
    });

final githubPrsProvider = FutureProvider.autoDispose
    .family<List<GitHubPR>, GitHubListRequest>((ref, request) async {
      final bridge = ref.watch(bridgeServiceProvider);
      return bridge.githubPrs(
        projectPath: request.projectPath,
        state: request.state,
      );
    });
