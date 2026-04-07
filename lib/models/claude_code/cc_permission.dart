/// Permission mode for Claude Code sessions.
enum ClaudeCodePermissionMode {
  defaultMode,
  acceptEdits,
  plan,
  bypassPermissions,
  dontAsk,
  auto;

  String get wireValue {
    switch (this) {
      case ClaudeCodePermissionMode.defaultMode:
        return 'default';
      case ClaudeCodePermissionMode.acceptEdits:
        return 'acceptEdits';
      case ClaudeCodePermissionMode.plan:
        return 'plan';
      case ClaudeCodePermissionMode.bypassPermissions:
        return 'bypassPermissions';
      case ClaudeCodePermissionMode.dontAsk:
        return 'dontAsk';
      case ClaudeCodePermissionMode.auto:
        return 'auto';
    }
  }

  static ClaudeCodePermissionMode fromWireValue(String value) {
    switch (value) {
      case 'acceptEdits':
        return ClaudeCodePermissionMode.acceptEdits;
      case 'plan':
        return ClaudeCodePermissionMode.plan;
      case 'bypassPermissions':
        return ClaudeCodePermissionMode.bypassPermissions;
      case 'dontAsk':
        return ClaudeCodePermissionMode.dontAsk;
      case 'auto':
        return ClaudeCodePermissionMode.auto;
      default:
        return ClaudeCodePermissionMode.defaultMode;
    }
  }

  String get displayName {
    switch (this) {
      case ClaudeCodePermissionMode.defaultMode:
        return 'Default';
      case ClaudeCodePermissionMode.acceptEdits:
        return 'Accept Edits';
      case ClaudeCodePermissionMode.plan:
        return 'Plan Only';
      case ClaudeCodePermissionMode.bypassPermissions:
        return 'Bypass Permissions';
      case ClaudeCodePermissionMode.dontAsk:
        return "Don't Ask";
      case ClaudeCodePermissionMode.auto:
        return 'Auto';
    }
  }
}
