import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../models/permission_rule.dart';
import '../theme/opencode_theme.dart';

/// Bottom sheet for configuring custom permission rules
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

    return Container(
      height: MediaQuery.of(context).size.height * 0.85,
      decoration: BoxDecoration(
        color: theme.backgroundPanel,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
      ),
      child: Column(
        children: [
          // Handle bar
          Padding(
            padding: const EdgeInsets.all(12),
            child: Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: theme.borderSubtle,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),

          // Header
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20),
            child: Row(
              children: [
                Icon(Icons.security_rounded, color: theme.accent, size: 20),
                const SizedBox(width: 10),
                Text(
                  'Permission Rules',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w600,
                    color: theme.text,
                  ),
                ),
                const Spacer(),
                IconButton(
                  icon: Icon(Icons.close_rounded, color: theme.textMuted),
                  onPressed: () => Navigator.pop(context),
                ),
              ],
            ),
          ),

          const Divider(),

          // Quick presets
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Quick Presets',
                  style: TextStyle(
                    color: theme.textMuted,
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: PermissionPreset.values
                      .where((p) => p != PermissionPreset.custom)
                      .map(
                        (preset) => _PresetChip(
                          preset: preset,
                          theme: theme,
                          onTap: () => _applyPreset(preset),
                        ),
                      )
                      .toList(),
                ),
              ],
            ),
          ),

          // Rules list
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              itemCount: _rules.length + 1,
              itemBuilder: (context, index) {
                if (index == _rules.length) {
                  return Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: OutlinedButton.icon(
                      onPressed: _addRule,
                      icon: const Icon(Icons.add_rounded, size: 18),
                      label: const Text('Add Rule'),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: theme.accent,
                        side: BorderSide(
                          color: theme.accent.withValues(alpha: 0.5),
                        ),
                      ),
                    ),
                  );
                }
                return _RuleCard(
                  rule: _rules[index],
                  theme: theme,
                  onUpdate: (rule) => _updateRule(index, rule),
                  onDelete: () => _removeRule(index),
                );
              },
            ),
          ),

          // Apply button
          Padding(
            padding: const EdgeInsets.all(20),
            child: SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () {
                  widget.onApply(_rules);
                  Navigator.pop(context);
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: theme.accent,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
                child: const Text('Apply Rules'),
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
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(20),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: theme.backgroundElement,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: theme.borderSubtle),
        ),
        child: Text(
          preset.displayName,
          style: TextStyle(
            color: theme.text,
            fontSize: 12,
            fontWeight: FontWeight.w500,
          ),
        ),
      ),
    );
  }
}

class _RuleCard extends StatelessWidget {
  const _RuleCard({
    required this.rule,
    required this.theme,
    required this.onUpdate,
    required this.onDelete,
  });

  final PermissionRule rule;
  final OpenCodeTheme theme;
  final void Function(PermissionRule) onUpdate;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.backgroundElement,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: theme.borderSubtle),
      ),
      child: Row(
        children: [
          // Permission type dropdown
          Expanded(
            flex: 2,
            child: _DropdownField(
              value: rule.permission,
              items: const ['edit', 'bash', 'read', 'write'],
              theme: theme,
              onChanged: (value) => onUpdate(rule.copyWith(permission: value)),
            ),
          ),
          const SizedBox(width: 8),

          // Pattern field
          Expanded(
            flex: 3,
            child: TextField(
              controller: TextEditingController(text: rule.pattern),
              style: GoogleFonts.jetBrainsMono(fontSize: 12, color: theme.text),
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
              ),
              onChanged: (value) => onUpdate(rule.copyWith(pattern: value)),
            ),
          ),
          const SizedBox(width: 8),

          // Action dropdown
          Expanded(
            flex: 2,
            child: _DropdownField(
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

          // Delete button
          IconButton(
            icon: Icon(
              Icons.delete_outline_rounded,
              color: theme.error,
              size: 20,
            ),
            onPressed: onDelete,
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
          ),
        ],
      ),
    );
  }
}

class _DropdownField extends StatelessWidget {
  const _DropdownField({
    required this.value,
    required this.items,
    required this.theme,
    required this.onChanged,
  });

  final String value;
  final List<String> items;
  final OpenCodeTheme theme;
  final void Function(String) onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
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
        style: TextStyle(color: theme.text, fontSize: 12),
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
    );
  }
}
