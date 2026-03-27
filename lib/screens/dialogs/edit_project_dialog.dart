import 'package:flutter/material.dart';

import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';

/// Common project emoji icons for the picker grid.
const _projectEmojis = [
  '📁',
  '📱',
  '🚀',
  '⚡',
  '🔧',
  '💻',
  '🎮',
  '🌐',
  '🤖',
  '📦',
  '🔒',
  '🎨',
  '📊',
  '🏗️',
  '⭐',
  '🧪',
  '🔬',
  '📝',
  '🎯',
  '💡',
];

/// Shows a dialog to edit a project's name and icon.
///
/// Returns `true` if saved successfully, `null` if cancelled.
/// Extracted as a standalone dialog per modular architecture guidelines.
Future<bool?> showEditProjectDialog({
  required BuildContext context,
  required String projectId,
  required String currentName,
  required String? currentIcon,
  required Future<Map<String, dynamic>> Function({
    required String projectId,
    String? name,
    Map<String, dynamic>? icon,
  })
  onSave,
}) {
  return showDialog<bool>(
    context: context,
    builder: (ctx) => _EditProjectDialog(
      projectId: projectId,
      currentName: currentName,
      currentIcon: currentIcon,
      onSave: onSave,
    ),
  );
}

class _EditProjectDialog extends StatefulWidget {
  const _EditProjectDialog({
    required this.projectId,
    required this.currentName,
    required this.currentIcon,
    required this.onSave,
  });

  final String projectId;
  final String currentName;
  final String? currentIcon;
  final Future<Map<String, dynamic>> Function({
    required String projectId,
    String? name,
    Map<String, dynamic>? icon,
  })
  onSave;

  @override
  State<_EditProjectDialog> createState() => _EditProjectDialogState();
}

class _EditProjectDialogState extends State<_EditProjectDialog> {
  late final TextEditingController _nameController = TextEditingController(
    text: widget.currentName,
  );
  String? _selectedIcon;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _selectedIcon = widget.currentIcon;
  }

  @override
  void dispose() {
    _nameController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final name = _nameController.text.trim();
    if (name.isEmpty) return;
    setState(() => _saving = true);
    try {
      await widget.onSave(
        projectId: widget.projectId,
        name: name,
        icon: _selectedIcon != null ? {'override': _selectedIcon} : null,
      );
      if (mounted) Navigator.pop(context, true);
    } catch (_) {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return AlertDialog(
      backgroundColor: theme.backgroundPanel,
      title: Text(
        'Edit Project',
        style: TextStyle(color: theme.text, fontSize: 18),
      ),
      content: SizedBox(
        width: double.maxFinite,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Name',
              style: TextStyle(color: theme.textMuted, fontSize: 13),
            ),
            const SizedBox(height: 6),
            TextField(
              controller: _nameController,
              style: TextStyle(color: theme.text, fontSize: 15),
              decoration: InputDecoration(
                hintText: 'Project name',
                hintStyle: TextStyle(color: theme.textMuted),
                filled: true,
                fillColor: theme.background,
                contentPadding: Insets.input,
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
            ),
            const SizedBox(height: 16),
            Text(
              'Icon',
              style: TextStyle(color: theme.textMuted, fontSize: 13),
            ),
            const SizedBox(height: 6),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: _projectEmojis.map((emoji) {
                final isSelected = emoji == _selectedIcon;
                return GestureDetector(
                  onTap: () => setState(() => _selectedIcon = emoji),
                  child: Container(
                    width: 42,
                    height: 42,
                    decoration: BoxDecoration(
                      color: isSelected
                          ? theme.primary.withValues(alpha: 0.15)
                          : theme.backgroundElement,
                      borderRadius: Radii.brSm,
                      border: Border.all(
                        color: isSelected ? theme.primary : theme.borderSubtle,
                        width: isSelected ? 2 : 1,
                      ),
                    ),
                    alignment: Alignment.center,
                    child: Text(emoji, style: const TextStyle(fontSize: 20)),
                  ),
                );
              }).toList(),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.pop(context),
          child: Text('Cancel', style: TextStyle(color: theme.textMuted)),
        ),
        TextButton(
          onPressed: _saving ? null : _save,
          child: _saving
              ? SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: theme.primary,
                  ),
                )
              : Text('Save', style: TextStyle(color: theme.primary)),
        ),
      ],
    );
  }
}
