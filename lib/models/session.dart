class SessionSummaryStats {
  const SessionSummaryStats({
    required this.additions,
    required this.deletions,
    required this.files,
  });

  final int additions;
  final int deletions;
  final int files;

  factory SessionSummaryStats.fromJson(Map<String, dynamic> json) {
    return SessionSummaryStats(
      additions: json['additions'] as int? ?? 0,
      deletions: json['deletions'] as int? ?? 0,
      files: json['files'] as int? ?? 0,
    );
  }
}

// Feature 13: Session Status
enum SessionStatusType { idle, busy, retry }

class SessionStatus {
  const SessionStatus._({
    required this.type,
    this.attempt,
    this.message,
    this.next,
  });

  final SessionStatusType type;
  final int? attempt; // For retry status
  final String? message; // For retry status
  final int? next; // Timestamp for next retry

  /// Create an idle status
  const SessionStatus.idle() : this._(type: SessionStatusType.idle);

  /// Create a busy status
  const SessionStatus.busy() : this._(type: SessionStatusType.busy);

  /// Create a retry status
  const SessionStatus.retry({
    required int attempt,
    required String message,
    required int next,
  }) : this._(
         type: SessionStatusType.retry,
         attempt: attempt,
         message: message,
         next: next,
       );

  factory SessionStatus.fromJson(Map<String, dynamic> json) {
    final type = json['type'] as String? ?? 'idle';
    switch (type) {
      case 'busy':
        return const SessionStatus.busy();
      case 'retry':
        return SessionStatus.retry(
          attempt: json['attempt'] as int? ?? 0,
          message: json['message'] as String? ?? '',
          next: json['next'] as int? ?? 0,
        );
      default:
        return const SessionStatus.idle();
    }
  }

  bool get isIdle => type == SessionStatusType.idle;
  bool get isBusy => type == SessionStatusType.busy;
  bool get isRetry => type == SessionStatusType.retry;

  /// Get a display string for the status
  String get displayString {
    switch (type) {
      case SessionStatusType.idle:
        return 'Idle';
      case SessionStatusType.busy:
        return 'Working...';
      case SessionStatusType.retry:
        return 'Retry ${attempt ?? 0}...';
    }
  }
}
