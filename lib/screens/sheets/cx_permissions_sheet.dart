import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// Shows a permission approval sheet for Codex `item/permissions/requestApproval`.
///
/// Returns the selected scope ('turn', 'session', 'global') on approve, or null on decline.
Future<String?> showCxPermissionsSheet({
  required BuildContext context,
  required Map<String, dynamic> permissions,
  String? reason,
}) async {
  return await showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (ctx) =>
        _CxPermissionsSheetContent(permissions: permissions, reason: reason),
  );
}

class _CxPermissionsSheetContent extends StatefulWidget {
  const _CxPermissionsSheetContent({required this.permissions, this.reason});

  final Map<String, dynamic> permissions;
  final String? reason;

  @override
  State<_CxPermissionsSheetContent> createState() =>
      _CxPermissionsSheetContentState();
}

class _CxPermissionsSheetContentState
    extends State<_CxPermissionsSheetContent> {
  String _selectedScope = 'session';

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final bottomPadding = MediaQuery.of(context).viewInsets.bottom;

    return Container(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.of(context).size.height * 0.7,
      ),
      decoration: BoxDecoration(
        color: theme.bgSheet,
        borderRadius: Radii.sheetTop,
      ),
      padding: EdgeInsets.only(bottom: bottomPadding),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Handle bar
          Center(
            child: Container(
              margin: const EdgeInsets.only(top: 8, bottom: 4),
              width: 36,
              height: 4,
              decoration: BoxDecoration(
                color: theme.textMuted.withValues(alpha: 0.3),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          // Title
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: [
                Icon(AppIcons.security, size: 20, color: theme.warning),
                const SizedBox(width: 8),
                Text(
                  'Permission Request',
                  style: AppTypography.labelLarge(color: theme.text),
                ),
              ],
            ),
          ),
          Divider(height: 1, color: theme.border),
          // Content
          Flexible(
            child: SingleChildScrollView(
              padding: Insets.screenH,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  const SizedBox(height: 12),
                  Text(
                    'Codex is requesting additional permissions:',
                    style: AppTypography.bodySmall(color: theme.textMuted),
                  ),
                  const SizedBox(height: 12),
                  // Permission entries
                  _buildPermissionEntries(theme),
                  // Reason
                  if (widget.reason != null && widget.reason!.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: theme.bgRaised,
                        borderRadius: Radii.brSm,
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Reason',
                            style: AppTypography.label(color: theme.textMuted),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            widget.reason!,
                            style: AppTypography.bodySmall(color: theme.text),
                          ),
                        ],
                      ),
                    ),
                  ],
                  // Scope selector
                  const SizedBox(height: 16),
                  Text(
                    'Grant for:',
                    style: AppTypography.labelLarge(color: theme.text),
                  ),
                  const SizedBox(height: 8),
                  _buildScopeOption(theme, 'turn', 'This turn only'),
                  _buildScopeOption(theme, 'session', 'This session'),
                  _buildScopeOption(theme, 'global', 'Always'),
                  // Buttons
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton(
                          onPressed: () => Navigator.pop(context, null),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: theme.text,
                            side: BorderSide(color: theme.border),
                            padding: const EdgeInsets.symmetric(vertical: 12),
                          ),
                          child: const Text('Decline'),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: FilledButton(
                          onPressed: () =>
                              Navigator.pop(context, _selectedScope),
                          style: FilledButton.styleFrom(
                            backgroundColor: theme.primary,
                            foregroundColor: Colors.white,
                            padding: const EdgeInsets.symmetric(vertical: 12),
                          ),
                          child: const Text('Approve'),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildScopeOption(OpenCodeTheme theme, String value, String label) {
    final selected = _selectedScope == value;
    return GestureDetector(
      onTap: () => setState(() => _selectedScope = value),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          children: [
            Icon(
              selected ? AppIcons.radioChecked : AppIcons.radioUnchecked,
              size: 18,
              color: selected ? theme.primary : theme.textMuted,
            ),
            const SizedBox(width: 8),
            Text(
              label,
              style: AppTypography.bodySmall(
                color: selected ? theme.text : theme.textMuted,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPermissionEntries(OpenCodeTheme theme) {
    final entries = <Widget>[];
    widget.permissions.forEach((key, value) {
      if (value is List) {
        entries.add(
          Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: theme.bgRaised,
              borderRadius: Radii.brSm,
              border: Border.all(color: theme.border),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(
                      _iconForPermissionKey(key),
                      size: 16,
                      color: theme.primary,
                    ),
                    const SizedBox(width: 6),
                    Text(
                      _labelForPermissionKey(key),
                      style: AppTypography.labelLarge(color: theme.text),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                ...value.map(
                  (item) => Padding(
                    padding: const EdgeInsets.only(left: 22, top: 2),
                    child: Text(
                      item.toString(),
                      style: AppTypography.label(color: theme.textMuted),
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      } else {
        entries.add(
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Row(
              children: [
                Icon(
                  _iconForPermissionKey(key),
                  size: 16,
                  color: theme.primary,
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    '$key: $value',
                    style: AppTypography.bodySmall(color: theme.text),
                  ),
                ),
              ],
            ),
          ),
        );
      }
    });

    if (entries.isEmpty) {
      entries.add(
        Text(
          'Additional permissions requested',
          style: AppTypography.bodySmall(color: theme.textMuted),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: entries,
    );
  }

  IconData _iconForPermissionKey(String key) {
    final lower = key.toLowerCase();
    if (lower.contains('network') || lower.contains('host')) {
      return AppIcons.globe;
    }
    if (lower.contains('write') || lower.contains('file')) {
      return AppIcons.folderOpen;
    }
    if (lower.contains('exec') || lower.contains('command')) {
      return AppIcons.terminal;
    }
    return AppIcons.security;
  }

  String _labelForPermissionKey(String key) {
    final lower = key.toLowerCase();
    if (lower.contains('network')) return 'Network Access';
    if (lower.contains('write')) return 'Write Access';
    if (lower.contains('exec')) return 'Execution Access';
    return key;
  }
}
