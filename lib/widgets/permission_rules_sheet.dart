import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../models/permission_rule.dart';
import '../theme/opencode_theme.dart';
import 'chat/detail_sheet.dart';

/// Shows a permission rules sheet using DetailSheet.
Future<void> showPermissionRulesSheet({
  required BuildContext context,
  required PermissionRuleset initialRules,
  required void Function(PermissionRuleset rules) onApply,
}) {
  return DetailSheet.show(
    context: context,
    title: 'Permission Rules',
    initialSize: 0.75,
    maxSize: 0.9,
    minSize: 0.5,
    child: _PermissionRulesSheetContent(
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
        child: _PermissionRulesSheetContent(
          initialRules: widget.initialRules,
          onApply: widget.onApply,
        ),
      ),
    );
  }
}

/// The actual content of the permission rules sheet.
class _PermissionRulesSheetContent extends StatefulWidget {
  const _PermissionRulesSheetContent({
    required this.initialRules,
    required this.onApply,
  });

  final PermissionRuleset initialRules;
  final void Function(PermissionRuleset rules) onApply;

  @override
  State<_PermissionRulesSheetContent> createState() =>
      _PermissionRulesSheetContentState();
}

class _PermissionRulesSheetContentState
    extends State<_PermissionRulesSheetContent> {
  late List<PermissionRule> _rules;

  @override
  void initState() {
    super.initState();
    _rules = List.from(widget.initialRules);
    if (_rules.isEmpty) {
      // Start with default rules
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
          // Quick presets section
          Text(
            'QUICK PRESETS',
            style: TextStyle(
              color: theme.textMuted,
              fontSize: 11,
              fontWeight: FontWeight.w600,
              letterSpacing: 0.5,
            ),
          ),
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

          const SizedBox(height: 20),

          // Rules section header
          Row(
            children: [
              Text(
                'RULES',
                style: TextStyle(
                  color: theme.textMuted,
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 0.5,
                ),
              ),
              const Spacer(),
              Text(
                '${_rules.length} rule${_rules.length == 1 ? '' : 's'}',
                style: TextStyle(color: theme.textMuted, fontSize: 11),
              ),
            ],
          ),

          const SizedBox(height: 10),

          // Wildcard pattern examples
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: theme.info.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: theme.info.withValues(alpha: 0.2)),
            ),
            child: Row(
              children: [
                Icon(
                  Icons.lightbulb_outline_rounded,
                  size: 14,
                  color: theme.info,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Pattern examples: *, src/*, Bash(npm *), Bash(git commit *)',
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

          const SizedBox(height: 12),

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
            padding: const EdgeInsets.only(top: 8),
            child: GestureDetector(
              onTap: _addRule,
              child: Container(
                padding: const EdgeInsets.symmetric(vertical: 14),
                decoration: BoxDecoration(
                  color: theme.backgroundPanel,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: theme.borderSubtle,
                    style: BorderStyle.solid,
                  ),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.add_rounded, size: 18, color: theme.primary),
                    const SizedBox(width: 8),
                    Text(
                      'Add Rule',
                      style: TextStyle(
                        color: theme.primary,
                        fontSize: 14,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),

          const SizedBox(height: 16),

          // Apply button
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: () {
                widget.onApply(_rules);
                Navigator.pop(context);
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: theme.primary,
                foregroundColor: theme.background,
                padding: const EdgeInsets.symmetric(vertical: 14),
                elevation: 0,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
              child: Text(
                'Apply Rules',
                style: TextStyle(
                  fontWeight: FontWeight.w600,
                  fontSize: 15,
                  color: theme.background,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

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
          borderRadius: BorderRadius.circular(10),
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
        borderRadius: BorderRadius.circular(14),
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
                  padding: const EdgeInsets.all(6),
                  decoration: BoxDecoration(
                    color: permColor.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(8),
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
                    items: const ['edit', 'bash', 'read', 'write'],
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
        const SizedBox(height: 4),
        Container(
          height: 40,
          padding: const EdgeInsets.symmetric(horizontal: 10),
          decoration: BoxDecoration(
            color: theme.background,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: theme.borderSubtle),
          ),
          child: DropdownButton<String>(
            value: items.contains(value) ? value : items.first,
            isExpanded: true,
            underline: const SizedBox.shrink(),
            dropdownColor: theme.backgroundPanel,
            style: TextStyle(color: theme.text, fontSize: 13),
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
        const SizedBox(height: 4),
        SizedBox(
          height: 40,
          child: TextField(
            controller: TextEditingController(text: value),
            style: GoogleFonts.jetBrainsMono(fontSize: 13, color: theme.text),
            decoration: InputDecoration(
              isDense: true,
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 10,
                vertical: 10,
              ),
              filled: true,
              fillColor: theme.background,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: BorderSide(color: theme.borderSubtle),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: BorderSide(color: theme.borderSubtle),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
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
