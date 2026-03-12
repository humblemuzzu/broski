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
  final theme = OpenCodeTheme.of(context);
  final nameController = TextEditingController(text: currentName);

  return showDialog<bool>(
    context: context,
    builder: (ctx) {
      var selectedIcon = currentIcon;
      var saving = false;

      return StatefulBuilder(
        builder: (ctx, setState) {
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
                  // Name field
                  Text(
                    'Name',
                    style: TextStyle(color: theme.textMuted, fontSize: 13),
                  ),
                  const SizedBox(height: 6),
                  TextField(
                    controller: nameController,
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
                  // Icon picker label
                  Text(
                    'Icon',
                    style: TextStyle(color: theme.textMuted, fontSize: 13),
                  ),
                  const SizedBox(height: 6),
                  // Emoji grid
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: _projectEmojis.map((emoji) {
                      final isSelected = emoji == selectedIcon;
                      return GestureDetector(
                        onTap: () => setState(() => selectedIcon = emoji),
                        child: Container(
                          width: 42,
                          height: 42,
                          decoration: BoxDecoration(
                            color: isSelected
                                ? theme.primary.withValues(alpha: 0.15)
                                : theme.backgroundElement,
                            borderRadius: Radii.brSm,
                            border: Border.all(
                              color: isSelected
                                  ? theme.primary
                                  : theme.borderSubtle,
                              width: isSelected ? 2 : 1,
                            ),
                          ),
                          alignment: Alignment.center,
                          child: Text(
                            emoji,
                            style: const TextStyle(fontSize: 20),
                          ),
                        ),
                      );
                    }).toList(),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: saving ? null : () => Navigator.pop(ctx),
                child: Text('Cancel', style: TextStyle(color: theme.textMuted)),
              ),
              TextButton(
                onPressed: saving
                    ? null
                    : () async {
                        final name = nameController.text.trim();
                        if (name.isEmpty) return;
                        setState(() => saving = true);
                        try {
                          await onSave(
                            projectId: projectId,
                            name: name,
                            icon: selectedIcon != null
                                ? {'override': selectedIcon}
                                : null,
                          );
                          if (ctx.mounted) Navigator.pop(ctx, true);
                        } catch (_) {
                          if (ctx.mounted) setState(() => saving = false);
                        }
                      },
                child: saving
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
        },
      );
    },
  );
}
