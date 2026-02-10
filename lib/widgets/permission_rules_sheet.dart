import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/agent_type.dart';
import '../models/claude_code.dart';
import '../models/codex.dart';
import '../models/permission_rule.dart';
import '../providers/claude_code_provider.dart';
import '../providers/codex_settings_provider.dart';
import '../providers/permission_rules_provider.dart';
import '../theme/app_typography.dart';
import '../theme/design_tokens.dart';
import '../theme/opencode_theme.dart';
import 'chat/detail_sheet.dart';

// =============================================================================
// PUBLIC API
// =============================================================================

/// Shows the unified permission rules sheet for any backend.
///
/// For OpenCode: shows permission rule editor (presets + custom rules).
/// For Claude Code: shows permission mode selector + allowed/disallowed tools.
/// For Codex: shows approval policy + sandbox mode + network access.
Future<void> showPermissionRulesSheet({
  required BuildContext context,
  required AgentType backend,
  // OpenCode-specific (legacy compat)
  PermissionRuleset? initialRules,
  void Function(PermissionRuleset rules)? onApply,
}) {
  return DetailSheet.show(
    context: context,
    title: 'Custom Permissions',
    initialSize: 0.75,
    maxSize: 0.9,
    minSize: 0.4,
    child: _UnifiedPermissionContent(
      backend: backend,
      initialRules: initialRules,
      onApply: onApply,
    ),
  );
}

/// Legacy widget for backwards compatibility.
/// Prefer using [showPermissionRulesSheet] instead.
class PermissionRulesSheet extends StatefulWidget {
  const PermissionRulesSheet({
    super.key,
    required this.initialRules,
    required this.onApply,
  });

  final PermissionRuleset initialRules;
  final void Function(PermissionRuleset rules) onApply;

  @override
  State<PermissionRulesSheet> createState() => _PermissionRulesSheetState();
}

class _PermissionRulesSheetState extends State<PermissionRulesSheet> {
  @override
  Widget build(BuildContext context) {
    return DetailSheet(
      title: 'Permission Rules',
      child: SingleChildScrollView(
        child: _OpenCodeRulesContent(
          initialRules: widget.initialRules,
          onApply: widget.onApply,
        ),
      ),
    );
  }
}

// =============================================================================
// UNIFIED CONTENT - Routes to correct backend UI
// =============================================================================

class _UnifiedPermissionContent extends ConsumerWidget {
  const _UnifiedPermissionContent({
    required this.backend,
    this.initialRules,
    this.onApply,
  });

  final AgentType backend;
  final PermissionRuleset? initialRules;
  final void Function(PermissionRuleset rules)? onApply;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    switch (backend) {
      case AgentType.opencode:
        final rulesState = ref.watch(permissionRulesProvider);
        return _OpenCodeRulesContent(
          initialRules: initialRules ?? rulesState.effectiveRuleset,
          onApply:
              onApply ??
              (rules) {
                ref
                    .read(permissionRulesProvider.notifier)
                    .setCustomRules(rules);
              },
        );
      case AgentType.claudeCode:
        return const _ClaudeCodePermissionContent();
      case AgentType.codex:
        return const _CodexPermissionContent();
    }
  }
}

// =============================================================================
// CLAUDE CODE PERMISSION CONTENT
// =============================================================================

class _ClaudeCodePermissionContent extends ConsumerStatefulWidget {
  const _ClaudeCodePermissionContent();

  @override
  ConsumerState<_ClaudeCodePermissionContent> createState() =>
      _ClaudeCodePermissionContentState();
}

class _ClaudeCodePermissionContentState
    extends ConsumerState<_ClaudeCodePermissionContent> {
  late List<String> _allowedTools;
  late List<String> _disallowedTools;
  bool _dirty = false;

  /// Well-known Claude Code tools
  static const _knownTools = [
    'Read',
    'Write',
    'Edit',
    'MultiEdit',
    'Bash',
    'Glob',
    'Grep',
    'LS',
    'WebFetch',
    'TodoRead',
    'TodoWrite',
    'Task',
    'WebSearch',
    'NotebookRead',
    'NotebookEdit',
  ];

  @override
  void initState() {
    super.initState();
    final config = ref.read(ccConfigProvider).valueOrNull;
    _allowedTools = List.from(config?.allowedTools ?? []);
    _disallowedTools = List.from(config?.disallowedTools ?? []);
  }

  void _save() {
    final notifier = ref.read(ccConfigProvider.notifier);
    final existing = ref.read(ccConfigProvider).valueOrNull;
    if (existing == null) return;
    notifier.updateConfig(
      existing.copyWith(
        allowedTools: _allowedTools,
        disallowedTools: _disallowedTools,
      ),
    );
    setState(() => _dirty = false);
  }

  void _addToolToList(List<String> list, String tool) {
    if (tool.isNotEmpty && !list.contains(tool)) {
      setState(() {
        list.add(tool);
        _dirty = true;
      });
    }
  }

  void _removeToolFromList(List<String> list, String tool) {
    setState(() {
      list.remove(tool);
      _dirty = true;
    });
  }

  void _showAddToolDialog({required bool isAllowed}) {
    final theme = OpenCodeTheme.of(context);
    // Filter out tools already in the target list
    final targetList = isAllowed ? _allowedTools : _disallowedTools;
    final available = _knownTools
        .where((t) => !targetList.contains(t))
        .toList();

    showModalBottomSheet(
      context: context,
      backgroundColor: theme.backgroundPanel,
      shape: const RoundedRectangleBorder(
        borderRadius: Radii.sheetTop,
      ),
      builder: (ctx) => _ToolPickerSheet(
        title: isAllowed ? 'Allow Tool' : 'Disallow Tool',
        availableTools: available,
        theme: theme,
        onSelect: (tool) {
          Navigator.pop(ctx);
          _addToolToList(isAllowed ? _allowedTools : _disallowedTools, tool);
        },
        onCustom: (tool) {
          Navigator.pop(ctx);
          _addToolToList(isAllowed ? _allowedTools : _disallowedTools, tool);
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final configAsync = ref.watch(ccConfigProvider);
    final config = configAsync.valueOrNull;
    final permissionMode =
        config?.permissionMode ?? ClaudeCodePermissionMode.defaultMode;

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Backend indicator
          _BackendBadge(label: 'Claude Code', theme: theme),
          SizedBox(height: Spacing.lg),

          // ── PERMISSION MODE ──
          _SectionLabel(text: 'PERMISSION MODE', theme: theme),
          const SizedBox(height: 10),
          ...ClaudeCodePermissionMode.values.map(
            (mode) => _PermissionModeOption(
              mode: mode,
              isSelected: permissionMode == mode,
              theme: theme,
              onTap: () {
                final notifier = ref.read(ccConfigProvider.notifier);
                notifier.setPermissionMode(mode);
              },
            ),
          ),
          SizedBox(height: Spacing.xl),

          // ── ALLOWED TOOLS ──
          _SectionLabel(text: 'ALLOWED TOOLS', theme: theme),
          SizedBox(height: Spacing.xs),
          Text(
            'Tools the agent can use without asking',
            style: AppTypography.caption(color: theme.textMuted),
          ),
          const SizedBox(height: 10),
          _ToolChipList(
            tools: _allowedTools,
            emptyText: 'No tool overrides',
            color: theme.success,
            theme: theme,
            onRemove: (tool) => _removeToolFromList(_allowedTools, tool),
          ),
          SizedBox(height: Spacing.sm),
          _AddButton(
            label: 'Add Allowed Tool',
            theme: theme,
            onTap: () => _showAddToolDialog(isAllowed: true),
          ),
          SizedBox(height: Spacing.xl),

          // ── DISALLOWED TOOLS ──
          _SectionLabel(text: 'DISALLOWED TOOLS', theme: theme),
          SizedBox(height: Spacing.xs),
          Text(
            'Tools the agent cannot use at all',
            style: AppTypography.caption(color: theme.textMuted),
          ),
          const SizedBox(height: 10),
          _ToolChipList(
            tools: _disallowedTools,
            emptyText: 'No tools blocked',
            color: theme.error,
            theme: theme,
            onRemove: (tool) => _removeToolFromList(_disallowedTools, tool),
          ),
          SizedBox(height: Spacing.sm),
          _AddButton(
            label: 'Add Disallowed Tool',
            theme: theme,
            onTap: () => _showAddToolDialog(isAllowed: false),
          ),

          // ── SAVE ──
          if (_dirty) ...[
            SizedBox(height: Spacing.xl),
            _ApplyButton(label: 'Save Tool Lists', theme: theme, onTap: _save),
          ],
        ],
      ),
    );
  }
}

// =============================================================================
// CODEX PERMISSION CONTENT
// =============================================================================

class _CodexPermissionContent extends ConsumerWidget {
  const _CodexPermissionContent();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = OpenCodeTheme.of(context);
    final settings = ref.watch(codexSettingsProvider);
    final notifier = ref.read(codexSettingsProvider.notifier);

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _BackendBadge(label: 'Codex', theme: theme),
          SizedBox(height: Spacing.lg),

          // ── APPROVAL POLICY ──
          _SectionLabel(text: 'APPROVAL POLICY', theme: theme),
          SizedBox(height: Spacing.xs),
          Text(
            'Controls when Codex asks for your approval',
            style: AppTypography.caption(color: theme.textMuted),
          ),
          const SizedBox(height: 10),
          ...CodexApprovalPolicy.values.map(
            (policy) => _CodexPolicyOption(
              policy: policy,
              isSelected: settings.approvalPolicy == policy,
              theme: theme,
              onTap: () => notifier.setApprovalPolicy(policy),
            ),
          ),
          SizedBox(height: Spacing.xl),

          // ── SANDBOX MODE ──
          _SectionLabel(text: 'SANDBOX MODE', theme: theme),
          SizedBox(height: Spacing.xs),
          Text(
            'Controls filesystem access for the agent',
            style: AppTypography.caption(color: theme.textMuted),
          ),
          const SizedBox(height: 10),
          ...CodexSandboxMode.values.map(
            (mode) => _CodexSandboxOption(
              mode: mode,
              isSelected: settings.sandboxMode == mode,
              theme: theme,
              onTap: () => notifier.setSandboxMode(mode),
            ),
          ),
          SizedBox(height: Spacing.xl),

          // ── NETWORK ACCESS ──
          _SectionLabel(text: 'NETWORK ACCESS', theme: theme),
          const SizedBox(height: 10),
          _ToggleRow(
            label: 'Allow network access',
            description: 'Let the agent make HTTP requests',
            value: settings.networkAccessEnabled,
            theme: theme,
            onChanged: (v) => notifier.setNetworkAccessEnabled(v),
          ),
          SizedBox(height: Spacing.xl),

          // ── INFO BOX ──
          Container(
            padding: Insets.cardSm,
            decoration: BoxDecoration(
              color: theme.info.withValues(alpha: 0.08),
              borderRadius: Radii.brSm,
              border: Border.all(color: theme.info.withValues(alpha: 0.2)),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.info_outline_rounded, size: 16, color: theme.info),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'Sandbox and approval policy are set when creating new threads. '
                    'Existing threads keep their original settings.',
                    style: TextStyle(
                      color: theme.info,
                      fontSize: 11,
                      height: 1.3,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// =============================================================================
// OPENCODE RULES CONTENT (preserved from original)
// =============================================================================

class _OpenCodeRulesContent extends StatefulWidget {
  const _OpenCodeRulesContent({
    required this.initialRules,
    required this.onApply,
  });

  final PermissionRuleset initialRules;
  final void Function(PermissionRuleset rules) onApply;

  @override
  State<_OpenCodeRulesContent> createState() => _OpenCodeRulesContentState();
}

class _OpenCodeRulesContentState extends State<_OpenCodeRulesContent> {
  late List<PermissionRule> _rules;

  @override
  void initState() {
    super.initState();
    _rules = List.from(widget.initialRules);
    if (_rules.isEmpty) {
      _rules = [
        const PermissionRule(
          permission: 'edit',
          pattern: '*',
          action: PermissionAction.ask,
        ),
        const PermissionRule(
          permission: 'bash',
          pattern: '*',
          action: PermissionAction.ask,
        ),
      ];
    }
  }

  void _addRule() {
    setState(() {
      _rules.add(
        const PermissionRule(
          permission: 'edit',
          pattern: '*',
          action: PermissionAction.ask,
        ),
      );
    });
  }

  void _removeRule(int index) {
    setState(() {
      _rules.removeAt(index);
    });
  }

  void _updateRule(int index, PermissionRule rule) {
    setState(() {
      _rules[index] = rule;
    });
  }

  void _applyPreset(PermissionPreset preset) {
    if (preset == PermissionPreset.custom) return;
    setState(() {
      _rules = List.from(preset.toRuleset());
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _BackendBadge(label: 'OpenCode', theme: theme),
          SizedBox(height: Spacing.lg),

          // Quick presets section
          _SectionLabel(text: 'QUICK PRESETS', theme: theme),
          const SizedBox(height: 10),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: PermissionPreset.values
                  .where((p) => p != PermissionPreset.custom)
                  .map(
                    (preset) => Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: _PresetChip(
                        preset: preset,
                        theme: theme,
                        onTap: () => _applyPreset(preset),
                      ),
                    ),
                  )
                  .toList(),
            ),
          ),

          SizedBox(height: Spacing.xl),

          // Rules section header
          Row(
            children: [
              _SectionLabel(text: 'RULES', theme: theme),
              const Spacer(),
              Text(
                '${_rules.length} rule${_rules.length == 1 ? '' : 's'}',
                style: AppTypography.caption(color: theme.textMuted),
              ),
            ],
          ),

          const SizedBox(height: 10),

          // Pattern hint
          Container(
            padding: Insets.cardXs,
            decoration: BoxDecoration(
              color: theme.info.withValues(alpha: 0.08),
              borderRadius: Radii.brSm,
              border: Border.all(color: theme.info.withValues(alpha: 0.2)),
            ),
            child: Row(
              children: [
                Icon(
                  Icons.lightbulb_outline_rounded,
                  size: 14,
                  color: theme.info,
                ),
                SizedBox(width: Spacing.sm),
                Expanded(
                  child: Text(
                    'Patterns: *, src/*, *.dart, git *, npm *\n'
                    'Order matters: last matching rule wins',
                    style: TextStyle(
                      color: theme.info,
                      fontSize: 11,
                      height: 1.3,
                    ),
                  ),
                ),
              ],
            ),
          ),

          SizedBox(height: Spacing.md),

          // Rules list
          ...List.generate(_rules.length, (index) {
            return _RuleCard(
              index: index + 1,
              rule: _rules[index],
              theme: theme,
              onUpdate: (rule) => _updateRule(index, rule),
              onDelete: () => _removeRule(index),
            );
          }),

          // Add rule button
          Padding(
            padding: Insets.topSm,
            child: _AddButton(label: 'Add Rule', theme: theme, onTap: _addRule),
          ),

          SizedBox(height: Spacing.lg),

          // Apply button
          _ApplyButton(
            label: 'Apply Rules',
            theme: theme,
            onTap: () {
              widget.onApply(_rules);
              Navigator.pop(context);
            },
          ),
        ],
      ),
    );
  }
}

// =============================================================================
// SHARED HELPER WIDGETS
// =============================================================================

/// Small badge showing which backend the permissions are for.
class _BackendBadge extends StatelessWidget {
  const _BackendBadge({required this.label, required this.theme});

  final String label;
  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: theme.primary.withValues(alpha: 0.1),
        borderRadius: Radii.brSm,
        border: Border.all(color: theme.primary.withValues(alpha: 0.25)),
      ),
      child: Text(
        label,
        style: AppTypography.codeSmall(color: theme.primary).copyWith(
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

/// Uppercase section label.
class _SectionLabel extends StatelessWidget {
  const _SectionLabel({required this.text, required this.theme});

  final String text;
  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: TextStyle(
        color: theme.textMuted,
        fontSize: 11,
        fontWeight: FontWeight.w600,
        letterSpacing: 0.5,
      ),
    );
  }
}

/// Full-width primary action button.
class _ApplyButton extends StatelessWidget {
  const _ApplyButton({
    required this.label,
    required this.theme,
    required this.onTap,
  });

  final String label;
  final OpenCodeTheme theme;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      child: ElevatedButton(
        onPressed: onTap,
        style: ElevatedButton.styleFrom(
          backgroundColor: theme.primary,
          foregroundColor: theme.background,
          padding: const EdgeInsets.symmetric(vertical: 14),
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: Radii.brMd,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontWeight: FontWeight.w600,
            fontSize: 15,
            color: theme.background,
          ),
        ),
      ),
    );
  }
}

/// Dashed-border add button.
class _AddButton extends StatelessWidget {
  const _AddButton({
    required this.label,
    required this.theme,
    required this.onTap,
  });

  final String label;
  final OpenCodeTheme theme;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 14),
        decoration: BoxDecoration(
          color: theme.backgroundPanel,
          borderRadius: Radii.brMd,
          border: Border.all(color: theme.borderSubtle),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.add_rounded, size: 18, color: theme.primary),
            SizedBox(width: Spacing.sm),
            Text(
              label,
              style: TextStyle(
                color: theme.primary,
                fontSize: 14,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A row of removable tool chips.
class _ToolChipList extends StatelessWidget {
  const _ToolChipList({
    required this.tools,
    required this.emptyText,
    required this.color,
    required this.theme,
    required this.onRemove,
  });

  final List<String> tools;
  final String emptyText;
  final Color color;
  final OpenCodeTheme theme;
  final void Function(String) onRemove;

  @override
  Widget build(BuildContext context) {
    if (tools.isEmpty) {
      return Text(
        emptyText,
        style: TextStyle(
          color: theme.textMuted.withValues(alpha: 0.5),
          fontSize: 12,
          fontStyle: FontStyle.italic,
        ),
      );
    }
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: tools.map((tool) {
        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.1),
            borderRadius: Radii.brSm,
            border: Border.all(color: color.withValues(alpha: 0.3)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                tool,
                style: AppTypography.codeSmall(color: color).copyWith(
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(width: 6),
              GestureDetector(
                onTap: () => onRemove(tool),
                child: Icon(
                  Icons.close_rounded,
                  size: 14,
                  color: color.withValues(alpha: 0.7),
                ),
              ),
            ],
          ),
        );
      }).toList(),
    );
  }
}

/// Toggle row with label, description, and switch.
class _ToggleRow extends StatelessWidget {
  const _ToggleRow({
    required this.label,
    required this.description,
    required this.value,
    required this.theme,
    required this.onChanged,
  });

  final String label;
  final String description;
  final bool value;
  final OpenCodeTheme theme;
  final void Function(bool) onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: Insets.cardMd,
      decoration: BoxDecoration(
        color: theme.backgroundPanel,
        borderRadius: Radii.brMd,
        border: Border.all(color: theme.borderSubtle),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: theme.text,
                  ),
                ),
                SizedBox(height: Spacing.xxs),
                Text(
                  description,
                  style: AppTypography.label(color: theme.textMuted),
                ),
              ],
            ),
          ),
          Switch.adaptive(
            value: value,
            onChanged: onChanged,
            activeTrackColor: theme.primary,
          ),
        ],
      ),
    );
  }
}

// =============================================================================
// CLAUDE CODE SPECIFIC WIDGETS
// =============================================================================

class _PermissionModeOption extends StatelessWidget {
  const _PermissionModeOption({
    required this.mode,
    required this.isSelected,
    required this.theme,
    required this.onTap,
  });

  final ClaudeCodePermissionMode mode;
  final bool isSelected;
  final OpenCodeTheme theme;
  final VoidCallback onTap;

  String get _description {
    switch (mode) {
      case ClaudeCodePermissionMode.defaultMode:
        return 'Ask before making any changes';
      case ClaudeCodePermissionMode.acceptEdits:
        return 'Auto-accept file edits, ask for bash';
      case ClaudeCodePermissionMode.plan:
        return 'Read-only research and planning';
      case ClaudeCodePermissionMode.bypassPermissions:
        return 'Skip all permission prompts';
      case ClaudeCodePermissionMode.delegate:
        return 'Delegate mode for teammate/task workflows';
      case ClaudeCodePermissionMode.dontAsk:
        return 'Never prompt; deny unapproved actions';
    }
  }

  IconData get _icon {
    switch (mode) {
      case ClaudeCodePermissionMode.defaultMode:
        return Icons.shield_outlined;
      case ClaudeCodePermissionMode.acceptEdits:
        return Icons.edit_note_rounded;
      case ClaudeCodePermissionMode.plan:
        return Icons.description_outlined;
      case ClaudeCodePermissionMode.bypassPermissions:
        return Icons.speed_rounded;
      case ClaudeCodePermissionMode.delegate:
        return Icons.groups_rounded;
      case ClaudeCodePermissionMode.dontAsk:
        return Icons.block_rounded;
    }
  }

  Color get _iconColor {
    if (!isSelected) return theme.textMuted;
    switch (mode) {
      case ClaudeCodePermissionMode.defaultMode:
        return theme.info;
      case ClaudeCodePermissionMode.acceptEdits:
        return theme.success;
      case ClaudeCodePermissionMode.plan:
        return theme.warning;
      case ClaudeCodePermissionMode.bypassPermissions:
        return theme.error;
      case ClaudeCodePermissionMode.delegate:
        return theme.info;
      case ClaudeCodePermissionMode.dontAsk:
        return theme.warning;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: Insets.bottomSm,
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          padding: Insets.cardMd,
          decoration: BoxDecoration(
            color: isSelected
                ? theme.primary.withValues(alpha: 0.08)
                : theme.backgroundPanel,
            borderRadius: Radii.brMd,
            border: Border.all(
              color: isSelected ? theme.primary : theme.borderSubtle,
            ),
          ),
          child: Row(
            children: [
              Container(
                padding: Insets.cardXs,
                decoration: BoxDecoration(
                  color: _iconColor.withValues(alpha: 0.15),
                  borderRadius: Radii.brSm,
                ),
                child: Icon(_icon, color: _iconColor, size: 18),
              ),
              SizedBox(width: Spacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      mode.displayName,
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: isSelected ? theme.primary : theme.text,
                      ),
                    ),
                    SizedBox(height: Spacing.xxs),
                    Text(
                      _description,
                      style: AppTypography.label(color: theme.textMuted),
                    ),
                  ],
                ),
              ),
              if (isSelected)
                Icon(Icons.check_rounded, size: 18, color: theme.primary),
            ],
          ),
        ),
      ),
    );
  }
}

/// Bottom sheet for selecting a tool from known tools or entering a custom one.
class _ToolPickerSheet extends StatefulWidget {
  const _ToolPickerSheet({
    required this.title,
    required this.availableTools,
    required this.theme,
    required this.onSelect,
    required this.onCustom,
  });

  final String title;
  final List<String> availableTools;
  final OpenCodeTheme theme;
  final void Function(String) onSelect;
  final void Function(String) onCustom;

  @override
  State<_ToolPickerSheet> createState() => _ToolPickerSheetState();
}

class _ToolPickerSheetState extends State<_ToolPickerSheet> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
        20,
        16,
        20,
        16 + MediaQuery.of(context).viewInsets.bottom,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            widget.title,
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w600,
              color: widget.theme.text,
            ),
          ),
          SizedBox(height: Spacing.md),
          if (widget.availableTools.isNotEmpty) ...[
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: widget.availableTools.map((tool) {
                return GestureDetector(
                  onTap: () => widget.onSelect(tool),
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 8,
                    ),
                    decoration: BoxDecoration(
                      color: widget.theme.backgroundPanel,
                      borderRadius: Radii.brSm,
                      border: Border.all(color: widget.theme.borderSubtle),
                    ),
                    child: Text(
                      tool,
                      style: AppTypography.code(color: widget.theme.text),
                    ),
                  ),
                );
              }).toList(),
            ),
            SizedBox(height: Spacing.lg),
            Text(
              'Or enter a custom tool name:',
              style: TextStyle(fontSize: 12, color: widget.theme.textMuted),
            ),
          ] else
            Text(
              'Enter a custom tool name:',
              style: TextStyle(fontSize: 12, color: widget.theme.textMuted),
            ),
          SizedBox(height: Spacing.sm),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _controller,
                  autofocus: widget.availableTools.isEmpty,
                  style: AppTypography.code(color: widget.theme.text),
                  decoration: InputDecoration(
                    isDense: true,
                    hintText: 'e.g. MyCustomTool',
                    hintStyle: TextStyle(
                      color: widget.theme.textMuted.withValues(alpha: 0.5),
                    ),
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 10,
                    ),
                    filled: true,
                    fillColor: widget.theme.background,
                    border: OutlineInputBorder(
                      borderRadius: Radii.brSm,
                      borderSide: BorderSide(color: widget.theme.borderSubtle),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: Radii.brSm,
                      borderSide: BorderSide(color: widget.theme.borderSubtle),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: Radii.brSm,
                      borderSide: BorderSide(color: widget.theme.primary),
                    ),
                  ),
                  onSubmitted: (val) {
                    if (val.trim().isNotEmpty) widget.onCustom(val.trim());
                  },
                ),
              ),
              SizedBox(width: Spacing.sm),
              IconButton(
                onPressed: () {
                  final val = _controller.text.trim();
                  if (val.isNotEmpty) widget.onCustom(val);
                },
                icon: Icon(Icons.check_rounded, color: widget.theme.primary),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

// =============================================================================
// CODEX SPECIFIC WIDGETS
// =============================================================================

class _CodexPolicyOption extends StatelessWidget {
  const _CodexPolicyOption({
    required this.policy,
    required this.isSelected,
    required this.theme,
    required this.onTap,
  });

  final CodexApprovalPolicy policy;
  final bool isSelected;
  final OpenCodeTheme theme;
  final VoidCallback onTap;

  String get _displayName {
    switch (policy) {
      case CodexApprovalPolicy.unlessTrusted:
        return 'Unless Trusted';
      case CodexApprovalPolicy.onFailure:
        return 'On Failure';
      case CodexApprovalPolicy.onRequest:
        return 'On Request';
      case CodexApprovalPolicy.never:
        return 'Never';
    }
  }

  String get _description {
    switch (policy) {
      case CodexApprovalPolicy.unlessTrusted:
        return 'Approve untrusted commands only';
      case CodexApprovalPolicy.onFailure:
        return 'Approve only when commands fail';
      case CodexApprovalPolicy.onRequest:
        return 'Approve every tool call (safest)';
      case CodexApprovalPolicy.never:
        return 'Never ask — full autonomy';
    }
  }

  IconData get _icon {
    switch (policy) {
      case CodexApprovalPolicy.unlessTrusted:
        return Icons.verified_user_outlined;
      case CodexApprovalPolicy.onFailure:
        return Icons.warning_amber_rounded;
      case CodexApprovalPolicy.onRequest:
        return Icons.shield_outlined;
      case CodexApprovalPolicy.never:
        return Icons.speed_rounded;
    }
  }

  Color get _iconColor {
    if (!isSelected) return theme.textMuted;
    switch (policy) {
      case CodexApprovalPolicy.unlessTrusted:
        return theme.success;
      case CodexApprovalPolicy.onFailure:
        return theme.warning;
      case CodexApprovalPolicy.onRequest:
        return theme.info;
      case CodexApprovalPolicy.never:
        return theme.error;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: Insets.bottomSm,
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          padding: Insets.cardMd,
          decoration: BoxDecoration(
            color: isSelected
                ? theme.primary.withValues(alpha: 0.08)
                : theme.backgroundPanel,
            borderRadius: Radii.brMd,
            border: Border.all(
              color: isSelected ? theme.primary : theme.borderSubtle,
            ),
          ),
          child: Row(
            children: [
              Container(
                padding: Insets.cardXs,
                decoration: BoxDecoration(
                  color: _iconColor.withValues(alpha: 0.15),
                  borderRadius: Radii.brSm,
                ),
                child: Icon(_icon, color: _iconColor, size: 18),
              ),
              SizedBox(width: Spacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _displayName,
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: isSelected ? theme.primary : theme.text,
                      ),
                    ),
                    SizedBox(height: Spacing.xxs),
                    Text(
                      _description,
                      style: AppTypography.label(color: theme.textMuted),
                    ),
                  ],
                ),
              ),
              if (isSelected)
                Icon(Icons.check_rounded, size: 18, color: theme.primary),
            ],
          ),
        ),
      ),
    );
  }
}

class _CodexSandboxOption extends StatelessWidget {
  const _CodexSandboxOption({
    required this.mode,
    required this.isSelected,
    required this.theme,
    required this.onTap,
  });

  final CodexSandboxMode mode;
  final bool isSelected;
  final OpenCodeTheme theme;
  final VoidCallback onTap;

  String get _displayName {
    switch (mode) {
      case CodexSandboxMode.readOnly:
        return 'Read Only';
      case CodexSandboxMode.workspaceWrite:
        return 'Workspace Write';
      case CodexSandboxMode.dangerFullAccess:
        return 'Full Access';
    }
  }

  String get _description {
    switch (mode) {
      case CodexSandboxMode.readOnly:
        return 'Agent can only read files';
      case CodexSandboxMode.workspaceWrite:
        return 'Write within project directory only';
      case CodexSandboxMode.dangerFullAccess:
        return 'Unrestricted filesystem access';
    }
  }

  IconData get _icon {
    switch (mode) {
      case CodexSandboxMode.readOnly:
        return Icons.lock_outline_rounded;
      case CodexSandboxMode.workspaceWrite:
        return Icons.folder_outlined;
      case CodexSandboxMode.dangerFullAccess:
        return Icons.lock_open_rounded;
    }
  }

  Color get _iconColor {
    if (!isSelected) return theme.textMuted;
    switch (mode) {
      case CodexSandboxMode.readOnly:
        return theme.info;
      case CodexSandboxMode.workspaceWrite:
        return theme.success;
      case CodexSandboxMode.dangerFullAccess:
        return theme.error;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: Insets.bottomSm,
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          padding: Insets.cardMd,
          decoration: BoxDecoration(
            color: isSelected
                ? theme.primary.withValues(alpha: 0.08)
                : theme.backgroundPanel,
            borderRadius: Radii.brMd,
            border: Border.all(
              color: isSelected ? theme.primary : theme.borderSubtle,
            ),
          ),
          child: Row(
            children: [
              Container(
                padding: Insets.cardXs,
                decoration: BoxDecoration(
                  color: _iconColor.withValues(alpha: 0.15),
                  borderRadius: Radii.brSm,
                ),
                child: Icon(_icon, color: _iconColor, size: 18),
              ),
              SizedBox(width: Spacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _displayName,
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: isSelected ? theme.primary : theme.text,
                      ),
                    ),
                    SizedBox(height: Spacing.xxs),
                    Text(
                      _description,
                      style: AppTypography.label(color: theme.textMuted),
                    ),
                  ],
                ),
              ),
              if (isSelected)
                Icon(Icons.check_rounded, size: 18, color: theme.primary),
            ],
          ),
        ),
      ),
    );
  }
}

// =============================================================================
// OPENCODE RULE CARD (preserved from original)
// =============================================================================

class _PresetChip extends StatelessWidget {
  const _PresetChip({
    required this.preset,
    required this.theme,
    required this.onTap,
  });

  final PermissionPreset preset;
  final OpenCodeTheme theme;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: theme.backgroundPanel,
          borderRadius: Radii.brSm,
          border: Border.all(color: theme.borderSubtle),
        ),
        child: Text(
          preset.displayName,
          style: TextStyle(
            color: theme.text,
            fontSize: 13,
            fontWeight: FontWeight.w500,
          ),
        ),
      ),
    );
  }
}

class _RuleCard extends StatelessWidget {
  const _RuleCard({
    required this.index,
    required this.rule,
    required this.theme,
    required this.onUpdate,
    required this.onDelete,
  });

  final int index;
  final PermissionRule rule;
  final OpenCodeTheme theme;
  final void Function(PermissionRule) onUpdate;
  final VoidCallback onDelete;

  Color _getPermissionColor() {
    switch (rule.permission) {
      case 'edit':
        return theme.toolEdit;
      case 'bash':
        return theme.toolBash;
      case 'read':
      case 'glob':
      case 'grep':
      case 'list':
        return theme.toolRead;
      case 'write':
        return theme.toolWrite;
      default:
        return theme.textMuted;
    }
  }

  IconData _getPermissionIcon() {
    switch (rule.permission) {
      case 'edit':
        return Icons.edit_outlined;
      case 'bash':
        return Icons.terminal_rounded;
      case 'read':
        return Icons.visibility_outlined;
      case 'glob':
        return Icons.search_rounded;
      case 'grep':
        return Icons.find_in_page_outlined;
      case 'list':
        return Icons.folder_open_outlined;
      case 'write':
        return Icons.save_outlined;
      default:
        return Icons.settings_outlined;
    }
  }

  @override
  Widget build(BuildContext context) {
    final permColor = _getPermissionColor();

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: theme.backgroundPanel,
        borderRadius: Radii.brMd,
        border: Border.all(color: theme.borderSubtle),
      ),
      child: Column(
        children: [
          // Rule header with permission type and delete
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 8, 8),
            child: Row(
              children: [
                Container(
                  padding: Insets.cardXs,
                  decoration: BoxDecoration(
                    color: permColor.withValues(alpha: 0.15),
                    borderRadius: Radii.brSm,
                  ),
                  child: Icon(_getPermissionIcon(), color: permColor, size: 16),
                ),
                const SizedBox(width: 10),
                Text(
                  'Rule $index',
                  style: TextStyle(
                    color: theme.textMuted,
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                const Spacer(),
                IconButton(
                  icon: Icon(
                    Icons.delete_outline_rounded,
                    color: theme.error.withValues(alpha: 0.7),
                    size: 20,
                  ),
                  onPressed: onDelete,
                  visualDensity: VisualDensity.compact,
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(
                    minWidth: 36,
                    minHeight: 36,
                  ),
                ),
              ],
            ),
          ),

          // Rule fields
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
            child: Row(
              children: [
                // Permission type dropdown
                Expanded(
                  flex: 3,
                  child: _StyledDropdown(
                    label: 'Type',
                    value: rule.permission,
                    items: const [
                      'edit',
                      'bash',
                      'read',
                      'write',
                      'glob',
                      'grep',
                      'list',
                      'task',
                      'webfetch',
                      'external_directory',
                    ],
                    theme: theme,
                    onChanged: (value) =>
                        onUpdate(rule.copyWith(permission: value)),
                  ),
                ),
                const SizedBox(width: 10),

                // Pattern field
                Expanded(
                  flex: 4,
                  child: _StyledTextField(
                    label: 'Pattern',
                    value: rule.pattern,
                    theme: theme,
                    onChanged: (value) =>
                        onUpdate(rule.copyWith(pattern: value)),
                  ),
                ),
                const SizedBox(width: 10),

                // Action dropdown
                Expanded(
                  flex: 3,
                  child: _StyledDropdown(
                    label: 'Action',
                    value: rule.action.name,
                    items: PermissionAction.values.map((a) => a.name).toList(),
                    theme: theme,
                    onChanged: (value) => onUpdate(
                      rule.copyWith(
                        action: PermissionAction.values.firstWhere(
                          (a) => a.name == value,
                          orElse: () => PermissionAction.ask,
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _StyledDropdown extends StatelessWidget {
  const _StyledDropdown({
    required this.label,
    required this.value,
    required this.items,
    required this.theme,
    required this.onChanged,
  });

  final String label;
  final String value;
  final List<String> items;
  final OpenCodeTheme theme;
  final void Function(String) onChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(
            color: theme.textMuted,
            fontSize: 10,
            fontWeight: FontWeight.w500,
          ),
        ),
        SizedBox(height: Spacing.xs),
        Container(
          height: 40,
          padding: const EdgeInsets.symmetric(horizontal: 10),
          decoration: BoxDecoration(
            color: theme.background,
            borderRadius: Radii.brSm,
            border: Border.all(color: theme.borderSubtle),
          ),
          child: DropdownButton<String>(
            value: items.contains(value) ? value : items.first,
            isExpanded: true,
            underline: const SizedBox.shrink(),
            dropdownColor: theme.backgroundPanel,
            style: AppTypography.bodySmall(color: theme.text),
            icon: Icon(
              Icons.keyboard_arrow_down_rounded,
              color: theme.textMuted,
              size: 18,
            ),
            items: items
                .map((item) => DropdownMenuItem(value: item, child: Text(item)))
                .toList(),
            onChanged: (value) {
              if (value != null) onChanged(value);
            },
          ),
        ),
      ],
    );
  }
}

class _StyledTextField extends StatelessWidget {
  const _StyledTextField({
    required this.label,
    required this.value,
    required this.theme,
    required this.onChanged,
  });

  final String label;
  final String value;
  final OpenCodeTheme theme;
  final void Function(String) onChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(
            color: theme.textMuted,
            fontSize: 10,
            fontWeight: FontWeight.w500,
          ),
        ),
        SizedBox(height: Spacing.xs),
        SizedBox(
          height: 40,
          child: TextField(
            controller: TextEditingController(text: value),
            style: AppTypography.code(color: theme.text),
            decoration: InputDecoration(
              isDense: true,
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 10,
                vertical: 10,
              ),
              filled: true,
              fillColor: theme.background,
              border: OutlineInputBorder(
                borderRadius: Radii.brSm,
                borderSide: BorderSide(color: theme.borderSubtle),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: Radii.brSm,
                borderSide: BorderSide(color: theme.borderSubtle),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: Radii.brSm,
                borderSide: BorderSide(color: theme.primary),
              ),
            ),
            onChanged: onChanged,
          ),
        ),
      ],
    );
  }
}
