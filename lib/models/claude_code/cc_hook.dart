/// Hook event types supported by the Claude Code SDK.
/// SDK 0.2.87: 26 events.
enum ClaudeCodeHookEvent {
  preToolUse,
  postToolUse,
  postToolUseFailure,
  notification,
  sessionStart,
  sessionEnd,
  stop,
  stopFailure,
  permissionRequest,
  userPromptSubmit,
  subagentStart,
  subagentStop,
  teammateIdle,
  taskCreated,
  taskCompleted,
  preCompact,
  postCompact,
  setup,
  elicitation,
  elicitationResult,
  configChange,
  worktreeCreate,
  worktreeRemove,
  instructionsLoaded,
  cwdChanged,
  fileChanged;

  String get wireValue {
    switch (this) {
      case ClaudeCodeHookEvent.preToolUse:
        return 'PreToolUse';
      case ClaudeCodeHookEvent.postToolUse:
        return 'PostToolUse';
      case ClaudeCodeHookEvent.postToolUseFailure:
        return 'PostToolUseFailure';
      case ClaudeCodeHookEvent.notification:
        return 'Notification';
      case ClaudeCodeHookEvent.sessionStart:
        return 'SessionStart';
      case ClaudeCodeHookEvent.sessionEnd:
        return 'SessionEnd';
      case ClaudeCodeHookEvent.stop:
        return 'Stop';
      case ClaudeCodeHookEvent.stopFailure:
        return 'StopFailure';
      case ClaudeCodeHookEvent.permissionRequest:
        return 'PermissionRequest';
      case ClaudeCodeHookEvent.userPromptSubmit:
        return 'UserPromptSubmit';
      case ClaudeCodeHookEvent.subagentStart:
        return 'SubagentStart';
      case ClaudeCodeHookEvent.subagentStop:
        return 'SubagentStop';
      case ClaudeCodeHookEvent.teammateIdle:
        return 'TeammateIdle';
      case ClaudeCodeHookEvent.taskCreated:
        return 'TaskCreated';
      case ClaudeCodeHookEvent.taskCompleted:
        return 'TaskCompleted';
      case ClaudeCodeHookEvent.preCompact:
        return 'PreCompact';
      case ClaudeCodeHookEvent.postCompact:
        return 'PostCompact';
      case ClaudeCodeHookEvent.setup:
        return 'Setup';
      case ClaudeCodeHookEvent.elicitation:
        return 'Elicitation';
      case ClaudeCodeHookEvent.elicitationResult:
        return 'ElicitationResult';
      case ClaudeCodeHookEvent.configChange:
        return 'ConfigChange';
      case ClaudeCodeHookEvent.worktreeCreate:
        return 'WorktreeCreate';
      case ClaudeCodeHookEvent.worktreeRemove:
        return 'WorktreeRemove';
      case ClaudeCodeHookEvent.instructionsLoaded:
        return 'InstructionsLoaded';
      case ClaudeCodeHookEvent.cwdChanged:
        return 'CwdChanged';
      case ClaudeCodeHookEvent.fileChanged:
        return 'FileChanged';
    }
  }

  static ClaudeCodeHookEvent fromWireValue(String value) {
    switch (value) {
      case 'PreToolUse':
        return ClaudeCodeHookEvent.preToolUse;
      case 'PostToolUse':
        return ClaudeCodeHookEvent.postToolUse;
      case 'PostToolUseFailure':
        return ClaudeCodeHookEvent.postToolUseFailure;
      case 'Notification':
        return ClaudeCodeHookEvent.notification;
      case 'SessionStart':
        return ClaudeCodeHookEvent.sessionStart;
      case 'SessionEnd':
        return ClaudeCodeHookEvent.sessionEnd;
      case 'Stop':
        return ClaudeCodeHookEvent.stop;
      case 'StopFailure':
        return ClaudeCodeHookEvent.stopFailure;
      case 'PermissionRequest':
        return ClaudeCodeHookEvent.permissionRequest;
      case 'UserPromptSubmit':
        return ClaudeCodeHookEvent.userPromptSubmit;
      case 'SubagentStart':
        return ClaudeCodeHookEvent.subagentStart;
      case 'SubagentStop':
        return ClaudeCodeHookEvent.subagentStop;
      case 'TeammateIdle':
        return ClaudeCodeHookEvent.teammateIdle;
      case 'TaskCreated':
        return ClaudeCodeHookEvent.taskCreated;
      case 'TaskCompleted':
        return ClaudeCodeHookEvent.taskCompleted;
      case 'PreCompact':
        return ClaudeCodeHookEvent.preCompact;
      case 'PostCompact':
        return ClaudeCodeHookEvent.postCompact;
      case 'Setup':
        return ClaudeCodeHookEvent.setup;
      case 'Elicitation':
        return ClaudeCodeHookEvent.elicitation;
      case 'ElicitationResult':
        return ClaudeCodeHookEvent.elicitationResult;
      case 'ConfigChange':
        return ClaudeCodeHookEvent.configChange;
      case 'WorktreeCreate':
        return ClaudeCodeHookEvent.worktreeCreate;
      case 'WorktreeRemove':
        return ClaudeCodeHookEvent.worktreeRemove;
      case 'InstructionsLoaded':
        return ClaudeCodeHookEvent.instructionsLoaded;
      case 'CwdChanged':
        return ClaudeCodeHookEvent.cwdChanged;
      case 'FileChanged':
        return ClaudeCodeHookEvent.fileChanged;
      default:
        return ClaudeCodeHookEvent.preToolUse;
    }
  }

  String get displayName {
    switch (this) {
      case ClaudeCodeHookEvent.preToolUse:
        return 'Pre Tool Use';
      case ClaudeCodeHookEvent.postToolUse:
        return 'Post Tool Use';
      case ClaudeCodeHookEvent.postToolUseFailure:
        return 'Post Tool Use Failure';
      case ClaudeCodeHookEvent.notification:
        return 'Notification';
      case ClaudeCodeHookEvent.sessionStart:
        return 'Session Start';
      case ClaudeCodeHookEvent.sessionEnd:
        return 'Session End';
      case ClaudeCodeHookEvent.stop:
        return 'Stop';
      case ClaudeCodeHookEvent.stopFailure:
        return 'Stop Failure';
      case ClaudeCodeHookEvent.permissionRequest:
        return 'Permission Request';
      case ClaudeCodeHookEvent.userPromptSubmit:
        return 'User Prompt Submit';
      case ClaudeCodeHookEvent.subagentStart:
        return 'Subagent Start';
      case ClaudeCodeHookEvent.subagentStop:
        return 'Subagent Stop';
      case ClaudeCodeHookEvent.teammateIdle:
        return 'Teammate Idle';
      case ClaudeCodeHookEvent.taskCreated:
        return 'Task Created';
      case ClaudeCodeHookEvent.taskCompleted:
        return 'Task Completed';
      case ClaudeCodeHookEvent.preCompact:
        return 'Pre Compact';
      case ClaudeCodeHookEvent.postCompact:
        return 'Post Compact';
      case ClaudeCodeHookEvent.setup:
        return 'Setup';
      case ClaudeCodeHookEvent.elicitation:
        return 'Elicitation';
      case ClaudeCodeHookEvent.elicitationResult:
        return 'Elicitation Result';
      case ClaudeCodeHookEvent.configChange:
        return 'Config Change';
      case ClaudeCodeHookEvent.worktreeCreate:
        return 'Worktree Create';
      case ClaudeCodeHookEvent.worktreeRemove:
        return 'Worktree Remove';
      case ClaudeCodeHookEvent.instructionsLoaded:
        return 'Instructions Loaded';
      case ClaudeCodeHookEvent.cwdChanged:
        return 'CWD Changed';
      case ClaudeCodeHookEvent.fileChanged:
        return 'File Changed';
    }
  }
}

class ClaudeCodeHook {
  final String id;
  final String event;
  final String? matcher;
  final bool enabled;
  final String? description;
  final List<dynamic>? hooks;
  final String? source;
  final String? path;

  const ClaudeCodeHook({
    required this.id,
    required this.event,
    this.matcher,
    required this.enabled,
    this.description,
    this.hooks,
    this.source,
    this.path,
  });

  factory ClaudeCodeHook.fromJson(Map<String, dynamic> json) {
    return ClaudeCodeHook(
      id: json['id'] as String? ?? '',
      event: json['event'] as String? ?? '',
      matcher: json['matcher'] as String?,
      enabled: json['enabled'] as bool? ?? true,
      description: json['description'] as String?,
      hooks: json['hooks'] as List<dynamic>?,
      source: json['source'] as String?,
      path: json['path'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'event': event,
      if (matcher != null) 'matcher': matcher,
      'enabled': enabled,
      if (description != null) 'description': description,
      if (hooks != null) 'hooks': hooks,
      if (source != null) 'source': source,
      if (path != null) 'path': path,
    };
  }

  /// Parsed hook event enum value.
  ClaudeCodeHookEvent get hookEvent => ClaudeCodeHookEvent.fromWireValue(event);
}
