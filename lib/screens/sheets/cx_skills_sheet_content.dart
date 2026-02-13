
import 'package:flutter/material.dart';
import '../../theme/app_typography.dart';

import '../../services/bridge_service.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import 'package:broski/theme/app_icons.dart';
import '../../utils/error_utils.dart';
/// Content widget for the Codex Skills sheet.
///
/// Shows per-skill enable/disable toggles and a "Browse Remote" button at top.
class CxSkillsSheetContent extends StatefulWidget {
  const CxSkillsSheetContent({
    super.key,
    required this.bridge,
    required this.cwd,
    required this.theme,
    required this.onBrowseRemote,
  });
  final BridgeService bridge;
  final String? cwd;
  final OpenCodeTheme theme;
  final VoidCallback onBrowseRemote;
  @override
  State<CxSkillsSheetContent> createState() => _CxSkillsSheetContentState();
}
class _CxSkillsSheetContentState extends State<CxSkillsSheetContent> {
  List<Map<String, dynamic>>? _data;
  bool _loading = true;
  String? _error;
  // Track toggling state per skill path
  final Set<String> _toggling = {};
  @override
  void initState() {
    super.initState();
    _load();
  }
  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await widget.bridge.cxListSkills(cwd: widget.cwd);
      if (!mounted) return;
      setState(() {
        _data = data;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = humanizeError(e);
        _loading = false;
      });
    }
  }
  Future<void> _toggleSkill(String path, bool currentEnabled) async {
    setState(() => _toggling.add(path));
    try {
      await widget.bridge.cxSetSkillEnabled(
        path: path,
        enabled: !currentEnabled,
      );
      // Refresh list to get updated state
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Toggle failed: ${humanizeError(e)}')),
        );
      }
    } finally {
      if (mounted) setState(() => _toggling.remove(path));
    }
  }
  @override
  Widget build(BuildContext context) {
    final theme = widget.theme;
    return Padding(
      padding: Insets.screenH,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Browse Remote button
          Padding(
            padding: Insets.bottomMd,
            child: Align(
              alignment: Alignment.centerRight,
              child: TextButton.icon(
                onPressed: widget.onBrowseRemote,
                icon: Icon(AppIcons.explore, size: 16, color: theme.primary),
                label: Text(
                  'Browse Remote',
                  style: AppTypography.bodySmall(color: theme.primary),
                ),
              ),
            ),
          ),
          // Loading / Error / Content
          if (_loading)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (_error != null)
            Padding(
              padding: Insets.screenV,
              child: Text(
                'Failed to load skills: $_error',
                style: AppTypography.label(color: theme.textMuted),
              ),
            )
          else if (_data == null || _data!.isEmpty)
            Padding(
              padding: Insets.screenV,
              child: Text(
                'No skills found for this project.',
                style: AppTypography.bodySmall(color: theme.textMuted),
              ),
            )
          else
            ..._data!.map((entry) {
              final cwdLabel = (entry['cwd'] ?? '').toString();
              final skills = (entry['skills'] as List<dynamic>? ?? const [])
                  .whereType<Map<String, dynamic>>()
                  .toList();
              final errors = (entry['errors'] as List<dynamic>? ?? const [])
                  .whereType<Map<String, dynamic>>()
                  .toList();
              return Padding(
                padding: Insets.bottomMd,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (cwdLabel.isNotEmpty)
                      Text(
                        cwdLabel,
                        style: TextStyle(
                          color: theme.textMuted,
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    SizedBox(height: Spacing.sm),
                    for (final s in skills)
                      _buildSkillTile(s, theme),
                    for (final e in errors)
                      Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: Text(
                          'Error: ${(e['message'] ?? '').toString()}',
                          style: AppTypography.label(color: theme.error),
                        ),
                      ),
                  ],
                ),
              );
            }),
        ],
      ),
    );
  }
  Widget _buildSkillTile(Map<String, dynamic> s, OpenCodeTheme theme) {
    final name = (s['name'] ?? 'skill').toString();
    final description = (s['description'] ?? s['shortDescription'] ?? '').toString();
    final scope = (s['scope'] ?? '').toString();
    final path = (s['path'] ?? '').toString();
    // SDK SkillsListEntry has `enabled` field — default to true if absent
    final enabled = s['enabled'] as bool? ?? true;
    final isToggling = _toggling.contains(path);
    return ListTile(
      dense: true,
      contentPadding: EdgeInsets.zero,
      leading: Icon(
        AppIcons.autoAwesome,
        size: 18,
        color: enabled ? theme.primary : theme.textMuted,
      ),
      title: Text(
        name,
        style: TextStyle(
          color: enabled ? theme.text : theme.textMuted,
          fontSize: 13,
          fontWeight: FontWeight.w600,
        ),
      ),
      subtitle: description.isNotEmpty
          ? Text(
              description,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: AppTypography.label(color: theme.textMuted),
            )
          : null,
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (scope.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Text(
                scope,
                style: AppTypography.caption(color: theme.textMuted),
              ),
            ),
          if (path.isNotEmpty)
            isToggling
                ? const SizedBox(
                    width: 20, height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Switch.adaptive(
                    value: enabled,
                    onChanged: (_) => _toggleSkill(path, enabled),
                    activeColor: theme.primary,
                  ),
        ],
      ),
    );
  }
}
