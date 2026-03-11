import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/pi.dart';
import '../../providers/pi_provider.dart';
import '../../services/pi_bridge_service.dart';
import '../../theme/app_typography.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import '../../utils/error_utils.dart';
import '../../widgets/chat/detail_sheet.dart';

/// Shows the Pi tools sheet with active/inactive toggles.
/// Extracted per AGENTS.md — chat_screen only calls this function.
void showPiToolsSheet(BuildContext context, {String? projectPath}) {
  DetailSheet.show(
    context: context,
    title: 'Pi Tools',
    initialSize: 0.55,
    child: _PiToolsSheetContent(projectPath: projectPath),
  );
}

class _PiToolsSheetContent extends ConsumerStatefulWidget {
  const _PiToolsSheetContent({this.projectPath});

  final String? projectPath;

  @override
  ConsumerState<_PiToolsSheetContent> createState() =>
      _PiToolsSheetContentState();
}

class _PiToolsSheetContentState extends ConsumerState<_PiToolsSheetContent> {
  Set<String>? _pendingActiveNames;
  bool _saving = false;

  static const _builtinTools = {
    'read',
    'bash',
    'edit',
    'write',
    'grep',
    'find',
    'ls',
  };

  @override
  Widget build(BuildContext context) {
    final toolsAsync = ref.watch(piToolsProvider(widget.projectPath));
    final theme = OpenCodeTheme.of(context);

    return toolsAsync.when(
      loading: () => const Padding(
        padding: Insets.xxxl,
        child: Center(child: CircularProgressIndicator()),
      ),
      error: (error, _) => Padding(
        padding: Insets.card,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'Failed to load tools',
              style: AppTypography.labelLarge(color: theme.text),
            ),
            SizedBox(height: Spacing.xs),
            Text(
              humanizeError(error),
              style: AppTypography.label(color: theme.textMuted),
              textAlign: TextAlign.center,
            ),
            SizedBox(height: Spacing.md),
            TextButton(
              onPressed: () => ref.invalidate(piToolsProvider),
              child: const Text('Retry'),
            ),
          ],
        ),
      ),
      data: (tools) {
        if (tools.isEmpty) {
          return Padding(
            padding: Insets.card,
            child: Center(
              child: Text(
                'No tools available',
                style: AppTypography.bodySmall(color: theme.textMuted),
              ),
            ),
          );
        }

        final activeNames =
            _pendingActiveNames ??
            tools.where((t) => t.active).map((t) => t.name).toSet();
        final builtinTools = tools
            .where((t) => _builtinTools.contains(t.name))
            .toList();
        final extensionTools = tools
            .where((t) => !_builtinTools.contains(t.name))
            .toList();

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: Insets.screenH,
              child: Text(
                '${activeNames.length} of ${tools.length} tools active',
                style: AppTypography.bodySmall(color: theme.textMuted),
              ),
            ),
            if (builtinTools.isNotEmpty) ...[
              _SectionHeader(title: 'Built-in', theme: theme),
              ...builtinTools.map(
                (tool) => _ToolTile(
                  tool: tool,
                  isActive: activeNames.contains(tool.name),
                  saving: _saving,
                  theme: theme,
                  onToggle: () => _toggleTool(tool.name, activeNames),
                ),
              ),
            ],
            if (extensionTools.isNotEmpty) ...[
              _SectionHeader(title: 'Extensions', theme: theme),
              ...extensionTools.map(
                (tool) => _ToolTile(
                  tool: tool,
                  isActive: activeNames.contains(tool.name),
                  saving: _saving,
                  theme: theme,
                  onToggle: () => _toggleTool(tool.name, activeNames),
                ),
              ),
            ],
            const SizedBox(height: 16),
          ],
        );
      },
    );
  }

  void _toggleTool(String name, Set<String> currentActive) {
    final updated = Set<String>.from(currentActive);
    if (updated.contains(name)) {
      updated.remove(name);
    } else {
      updated.add(name);
    }
    setState(() => _pendingActiveNames = updated);
    _applyActiveTools(updated.toList());
  }

  Future<void> _applyActiveTools(List<String> names) async {
    setState(() => _saving = true);
    try {
      final bridge = ref.read(piBridgeServiceProvider);
      await bridge.setActiveTools(names, projectPath: widget.projectPath);
      ref.invalidate(piToolsProvider);
    } catch (_) {
      // Revert on error
      setState(() => _pendingActiveNames = null);
    } finally {
      if (mounted) {
        setState(() {
          _saving = false;
          _pendingActiveNames = null;
        });
      }
    }
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title, required this.theme});

  final String title;
  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: Text(
        title.toUpperCase(),
        style: AppTypography.label(
          color: theme.textMuted,
        ).copyWith(letterSpacing: 0.8, fontWeight: FontWeight.w600),
      ),
    );
  }
}

class _ToolTile extends StatelessWidget {
  const _ToolTile({
    required this.tool,
    required this.isActive,
    required this.saving,
    required this.theme,
    required this.onToggle,
  });

  final PiTool tool;
  final bool isActive;
  final bool saving;
  final OpenCodeTheme theme;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      dense: true,
      contentPadding: Insets.screenH,
      leading: SizedBox(
        width: 24,
        height: 24,
        child: Checkbox(
          value: isActive,
          onChanged: saving ? null : (_) => onToggle(),
        ),
      ),
      title: Text(
        tool.name,
        style: AppTypography.bodySmall(
          color: theme.text,
        ).copyWith(fontFamily: 'monospace', fontWeight: FontWeight.w600),
      ),
      subtitle: tool.description.isNotEmpty
          ? Text(
              tool.description,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: AppTypography.label(color: theme.textMuted),
            )
          : null,
      onTap: saving ? null : onToggle,
    );
  }
}
