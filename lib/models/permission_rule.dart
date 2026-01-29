/// Permission rule action types (SDK v1.1.1+)
enum PermissionAction { allow, deny, ask }

/// A single permission rule for session creation.
///
/// ## OpenCode Rule Ordering — "Last Matching Wins"
///
/// OpenCode evaluates rules using `findLast()`:  the **last** rule in the
/// array whose `permission` *and* `pattern` both match the request wins.
///
/// When building rulesets with overlapping patterns for the same permission
/// key, always place the **broad catch-all first** and the **specific
/// override last**.  Example:
///
/// ```dart
/// // CORRECT — specific override wins for src/ files:
/// PermissionRule(permission: 'edit', pattern: '*',     action: ask),   // 1st
/// PermissionRule(permission: 'edit', pattern: 'src/*', action: allow), // 2nd (wins for src/)
///
/// // WRONG — catch-all is last, so it overrides the specific rule:
/// PermissionRule(permission: 'edit', pattern: 'src/*', action: allow), // 1st
/// PermissionRule(permission: 'edit', pattern: '*',     action: ask),   // 2nd (wins for ALL)
/// ```
class PermissionRule {
  const PermissionRule({
    required this.permission,
    required this.pattern,
    required this.action,
  });

  /// Permission key — matches an OpenCode tool category.
  ///
  /// Common keys: `edit` (edit/write/patch/multiedit), `bash`, `read`,
  /// `glob`, `grep`, `list`, `task`, `skill`, `webfetch`, `websearch`,
  /// `codesearch`, `external_directory`, `doom_loop`, `question`,
  /// `plan_enter`, `plan_exit`, `todoread`, `todowrite`.
  /// `*` matches any permission key.
  final String permission;

  /// Wildcard pattern matched against the tool input (file path, command, etc.).
  ///
  /// `*` matches any string.  `?` matches a single character.
  /// Examples: `*`, `src/*`, `*.dart`, `git *`, `npm *`.
  final String pattern;

  /// What to do when this pattern matches.
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

  @override
  String toString() => 'PermissionRule($permission, $pattern, ${action.name})';
}

/// A complete permission ruleset for session creation.
///
/// Rules are evaluated in order; **last matching rule wins** (see
/// [PermissionRule] doc for details).  Tools not covered by any rule fall
/// through to OpenCode's built-in defaults (most things are allowed by
/// default except `external_directory`, `doom_loop`, `.env` reads, and
/// the `question` tool which are set to `ask` or `deny` at the agent level).
typedef PermissionRuleset = List<PermissionRule>;

// ---------------------------------------------------------------------------
// Helpers used by presets
// ---------------------------------------------------------------------------

/// Standard rule: allow all reads (files, glob, grep, dir listing).
const _readAllowAll = [
  PermissionRule(
    permission: 'read',
    pattern: '*',
    action: PermissionAction.allow,
  ),
  PermissionRule(
    permission: 'glob',
    pattern: '*',
    action: PermissionAction.allow,
  ),
  PermissionRule(
    permission: 'grep',
    pattern: '*',
    action: PermissionAction.allow,
  ),
  PermissionRule(
    permission: 'list',
    pattern: '*',
    action: PermissionAction.allow,
  ),
];

/// Standard rule: ask for all reads.
const _readAskAll = [
  PermissionRule(
    permission: 'read',
    pattern: '*',
    action: PermissionAction.ask,
  ),
  PermissionRule(
    permission: 'glob',
    pattern: '*',
    action: PermissionAction.ask,
  ),
  PermissionRule(
    permission: 'grep',
    pattern: '*',
    action: PermissionAction.ask,
  ),
  PermissionRule(
    permission: 'list',
    pattern: '*',
    action: PermissionAction.ask,
  ),
];

/// Built-in permission presets.
///
/// Each preset generates a [PermissionRuleset] that is sent to OpenCode at
/// session creation time.  These rules are merged *after* OpenCode's built-in
/// agent defaults, so they act as session-level overrides.
///
/// **Rule ordering reminder:** OpenCode uses `findLast()`, so when the same
/// permission key appears multiple times, put the catch-all (`*`) **first**
/// and the specific pattern **last** (the last match wins).
enum PermissionPreset {
  askEverything(
    'Ask everything',
    'Ask All',
    'Prompt for edits, commands, and reads',
  ),
  autoAllowEdits(
    'Auto-allow edits',
    'Allow Edits',
    'Allow file edits, ask for commands',
  ),
  autoAllowInSrc(
    'Auto-allow in src/',
    'src/ Only',
    'Allow edits in src/ only, ask for others',
  ),
  planMode(
    'Plan mode (read-only)',
    'Plan',
    'Read files only, deny all writes & commands',
  ),
  custom('Custom rules...', 'Custom', 'Configure your own permission rules');

  const PermissionPreset(this.displayName, this.shortName, this.description);

  /// Full name for dropdowns and settings screens.
  final String displayName;

  /// Short name for compact cards in the Power Menu.
  final String shortName;

  final String description;

  /// Convert this preset to a concrete [PermissionRuleset].
  ///
  /// **Ordering contract:** Within the same permission key, catch-all (`*`)
  /// patterns are placed *before* specific patterns so that the specific
  /// pattern wins (OpenCode `findLast` semantics).
  PermissionRuleset toRuleset() {
    switch (this) {
      // ── Ask Everything ──────────────────────────────────────────────
      // Maximum safety: every action requires explicit approval.
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
          ..._readAskAll,
        ];

      // ── Auto-allow Edits ────────────────────────────────────────────
      // File edits and reads are allowed; bash commands still prompt.
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
          ..._readAllowAll,
        ];

      // ── Auto-allow in src/ ──────────────────────────────────────────
      // Edits inside `src/` are allowed automatically; edits elsewhere
      // and all bash commands still prompt.  Reads are always allowed.
      //
      // IMPORTANT: The `edit: *` catch-all MUST come BEFORE `edit: src/*`
      // because OpenCode uses findLast — the last matching rule wins.
      case PermissionPreset.autoAllowInSrc:
        return const [
          // edit: catch-all first (ask for all edits by default)
          PermissionRule(
            permission: 'edit',
            pattern: '*',
            action: PermissionAction.ask,
          ),
          // edit: specific override last (auto-allow in src/ — wins)
          PermissionRule(
            permission: 'edit',
            pattern: 'src/*',
            action: PermissionAction.allow,
          ),
          PermissionRule(
            permission: 'bash',
            pattern: '*',
            action: PermissionAction.ask,
          ),
          ..._readAllowAll,
        ];

      // ── Plan Mode (read-only) ──────────────────────────────────────
      // Deny all writes and commands; only reads are allowed.
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
          ..._readAllowAll,
        ];

      // ── Custom ─────────────────────────────────────────────────────
      // Empty — the user configures their own rules via the rules editor.
      case PermissionPreset.custom:
        return const [];
    }
  }
}
