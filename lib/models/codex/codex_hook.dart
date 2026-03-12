// Codex hook run summary model.
//
// Matches the SDK `HookRunSummary` notification payload from
// `hook/started` and `hook/completed` notifications.

enum CodexHookRunStatus {
  running,
  completed,
  failed,
  blocked,
  stopped;

  static CodexHookRunStatus fromString(String value) {
    switch (value) {
      case 'completed':
        return CodexHookRunStatus.completed;
      case 'failed':
        return CodexHookRunStatus.failed;
      case 'blocked':
        return CodexHookRunStatus.blocked;
      case 'stopped':
        return CodexHookRunStatus.stopped;
      default:
        return CodexHookRunStatus.running;
    }
  }

  String get icon {
    switch (this) {
      case CodexHookRunStatus.running:
        return '⏳';
      case CodexHookRunStatus.completed:
        return '✅';
      case CodexHookRunStatus.failed:
        return '❌';
      case CodexHookRunStatus.blocked:
        return '🚫';
      case CodexHookRunStatus.stopped:
        return '⏹️';
    }
  }
}

class CodexHookRun {
  final String id;
  final String eventName;
  final String handlerType;
  final String executionMode;
  final String scope;
  final String sourcePath;
  final int displayOrder;
  final CodexHookRunStatus status;
  final String? statusMessage;
  final int startedAt;
  final int? completedAt;
  final int? durationMs;

  const CodexHookRun({
    required this.id,
    required this.eventName,
    required this.handlerType,
    this.executionMode = 'sequential',
    this.scope = 'project',
    this.sourcePath = '',
    this.displayOrder = 0,
    required this.status,
    this.statusMessage,
    required this.startedAt,
    this.completedAt,
    this.durationMs,
  });

  factory CodexHookRun.fromJson(Map<String, dynamic> json) {
    return CodexHookRun(
      id: json['id'] as String? ?? '',
      eventName: json['eventName'] as String? ?? '',
      handlerType: json['handlerType'] as String? ?? '',
      executionMode: json['executionMode'] as String? ?? 'sequential',
      scope: json['scope'] as String? ?? 'project',
      sourcePath: json['sourcePath'] as String? ?? '',
      displayOrder: json['displayOrder'] as int? ?? 0,
      status: CodexHookRunStatus.fromString(
        json['status'] as String? ?? 'running',
      ),
      statusMessage: json['statusMessage'] as String?,
      startedAt: json['startedAt'] as int? ?? 0,
      completedAt: json['completedAt'] as int?,
      durationMs: json['durationMs'] as int?,
    );
  }

  /// Duration as a human-readable string.
  String get durationDisplay {
    if (durationMs == null) return '';
    return '${(durationMs! / 1000).toStringAsFixed(1)}s';
  }
}
