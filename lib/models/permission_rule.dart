/// Permission rule action types (SDK v1.1.1+)
enum PermissionAction { allow, deny, ask }

/// A single permission rule for session creation
class PermissionRule {
  const PermissionRule({
    required this.permission,
    required this.pattern,
    required this.action,
  });

  /// Permission type: "edit", "bash", "read", "write", etc.
  final String permission;

  /// File/command pattern: "*", "*.dart", "/src/*", etc.
  final String pattern;

  /// What to do when this pattern matches
  final PermissionAction action;

  Map<String, dynamic> toJson() => {
    'permission': permission,
    'pattern': pattern,
    'action': action.name,
  };

  factory PermissionRule.fromJson(Map<String, dynamic> json) {
    return PermissionRule(
      permission: json['permission'] as String? ?? '',
      pattern: json['pattern'] as String? ?? '*',
      action: PermissionAction.values.firstWhere(
        (a) => a.name == (json['action'] as String? ?? 'ask'),
        orElse: () => PermissionAction.ask,
      ),
    );
  }

  PermissionRule copyWith({
    String? permission,
    String? pattern,
    PermissionAction? action,
  }) {
    return PermissionRule(
      permission: permission ?? this.permission,
      pattern: pattern ?? this.pattern,
      action: action ?? this.action,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is PermissionRule &&
          runtimeType == other.runtimeType &&
          permission == other.permission &&
          pattern == other.pattern &&
          action == other.action;

  @override
  int get hashCode => Object.hash(permission, pattern, action);
}

/// A complete permission ruleset for session creation
typedef PermissionRuleset = List<PermissionRule>;

/// Built-in permission presets
enum PermissionPreset {
  askEverything('Ask everything', 'Prompt for all actions'),
  autoAllowEdits('Auto-allow edits', 'Allow file edits, ask for commands'),
  autoAllowInSrc('Auto-allow in src/', 'Allow edits in src/ folder only'),
  planMode('Plan mode (read-only)', 'Read files only, deny all writes'),
  custom('Custom rules...', 'Configure your own rules');

  const PermissionPreset(this.displayName, this.description);

  final String displayName;
  final String description;

  /// Convert preset to a ruleset
  PermissionRuleset toRuleset() {
    switch (this) {
      case PermissionPreset.askEverything:
        return const [
          PermissionRule(
            permission: 'edit',
            pattern: '*',
            action: PermissionAction.ask,
          ),
          PermissionRule(
            permission: 'bash',
            pattern: '*',
            action: PermissionAction.ask,
          ),
          PermissionRule(
            permission: 'read',
            pattern: '*',
            action: PermissionAction.ask,
          ),
        ];
      case PermissionPreset.autoAllowEdits:
        return const [
          PermissionRule(
            permission: 'edit',
            pattern: '*',
            action: PermissionAction.allow,
          ),
          PermissionRule(
            permission: 'bash',
            pattern: '*',
            action: PermissionAction.ask,
          ),
          PermissionRule(
            permission: 'read',
            pattern: '*',
            action: PermissionAction.allow,
          ),
        ];
      case PermissionPreset.autoAllowInSrc:
        return const [
          PermissionRule(
            permission: 'edit',
            pattern: 'src/*',
            action: PermissionAction.allow,
          ),
          PermissionRule(
            permission: 'edit',
            pattern: '*',
            action: PermissionAction.ask,
          ),
          PermissionRule(
            permission: 'bash',
            pattern: '*',
            action: PermissionAction.ask,
          ),
          PermissionRule(
            permission: 'read',
            pattern: '*',
            action: PermissionAction.allow,
          ),
        ];
      case PermissionPreset.planMode:
        return const [
          PermissionRule(
            permission: 'edit',
            pattern: '*',
            action: PermissionAction.deny,
          ),
          PermissionRule(
            permission: 'bash',
            pattern: '*',
            action: PermissionAction.deny,
          ),
          PermissionRule(
            permission: 'read',
            pattern: '*',
            action: PermissionAction.allow,
          ),
        ];
      case PermissionPreset.custom:
        // Custom returns empty, user will configure their own
        return const [];
    }
  }
}
