import 'package:broski/models/project.dart';
import 'package:broski/providers/selected_backend_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Shows a folder-browser sheet that lets the user navigate their filesystem
/// on the dev machine (via the bridge `browse` endpoint) and pick a project
/// folder. Returns the selected [ProjectSummary] or null if dismissed.
Future<ProjectSummary?> showAddProjectSheet(BuildContext context) {
  return DetailSheet.show<ProjectSummary>(
    context: context,
    title: 'Add Project',
    initialSize: 0.7,
    maxSize: 0.9,
    child: const _AddProjectContent(),
  );
}

class _AddProjectContent extends ConsumerStatefulWidget {
  const _AddProjectContent();

  @override
  ConsumerState<_AddProjectContent> createState() => _AddProjectContentState();
}

class _AddProjectContentState extends ConsumerState<_AddProjectContent> {
  String _currentPath = '';
  List<_BrowseItem> _items = [];
  bool _loading = true;
  String? _error;

  // Navigation history for back button
  final List<String> _history = [];

  @override
  void initState() {
    super.initState();
    // Start from home directory
    _browse(_homePath());
  }

  String _homePath() {
    // The bridge resolves ~ or empty to home, but let's be explicit
    return '/Users';
  }

  Future<void> _browse(String path) async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final bridge = ref.read(bridgeServiceProvider);
      final results = await bridge.browse(path);
      if (!mounted) return;

      final items = <_BrowseItem>[];
      for (final item in results) {
        if (item is Map<String, dynamic>) {
          final name = item['name'] as String? ?? '';
          final type = item['type'] as String? ?? 'file';
          final absolute =
              item['absolute'] as String? ?? item['path'] as String? ?? '';
          if (type == 'directory') {
            items.add(
              _BrowseItem(name: name, path: absolute, isDirectory: true),
            );
          }
        }
      }

      setState(() {
        _items = items;
        _currentPath = path;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  void _navigateTo(String path) {
    _history.add(_currentPath);
    _browse(path);
  }

  void _navigateBack() {
    if (_history.isNotEmpty) {
      final previous = _history.removeLast();
      _browse(previous);
    } else {
      // Go to parent directory
      final parent = _currentPath.substring(0, _currentPath.lastIndexOf('/'));
      if (parent.isNotEmpty) {
        _browse(parent);
      }
    }
  }

  void _selectCurrentFolder() {
    if (_currentPath.isEmpty) return;
    final parts = _currentPath.split('/').where((p) => p.isNotEmpty).toList();
    final name = parts.isEmpty ? 'Project' : parts.last;
    final project = ProjectSummary(
      id: _currentPath,
      name: name,
      path: _currentPath,
    );
    Navigator.pop(context, project);
  }

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final agentLabel = ref.watch(selectedBackendProvider).displayName;

    return Column(
      children: [
        // Current path + back button
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
          child: Row(
            children: [
              // Back button
              IconButton(
                onPressed: _currentPath.length > 1 ? _navigateBack : null,
                icon: Icon(
                  AppIcons.back,
                  color: _currentPath.length > 1
                      ? ocTheme.text
                      : ocTheme.textMuted.withValues(alpha: 0.3),
                  size: 20,
                ),
                tooltip: 'Back',
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
              ),
              const SizedBox(width: 8),
              // Current path
              Expanded(
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 8,
                  ),
                  decoration: BoxDecoration(
                    color: ocTheme.backgroundElement,
                    borderRadius: Radii.brSm,
                  ),
                  child: Text(
                    _currentPath.isEmpty ? '/' : _currentPath,
                    style: TextStyle(
                      color: ocTheme.textMuted,
                      fontSize: 13,
                      fontFamily: 'monospace',
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 8),

        // "Select this folder" button
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: _currentPath.length > 1 ? _selectCurrentFolder : null,
              icon: const Icon(AppIcons.folderOpen, size: 18),
              label: Text('Open in $agentLabel'),
              style: ElevatedButton.styleFrom(
                backgroundColor: ocTheme.primary,
                foregroundColor: ocTheme.background,
                disabledBackgroundColor: ocTheme.primary.withValues(alpha: 0.3),
                disabledForegroundColor: ocTheme.background.withValues(
                  alpha: 0.5,
                ),
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(borderRadius: Radii.brMd),
              ),
            ),
          ),
        ),
        const SizedBox(height: 12),

        // Directory listing
        Expanded(
          child: _loading
              ? Center(child: CircularProgressIndicator(color: ocTheme.primary))
              : _error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(AppIcons.error, color: ocTheme.error, size: 32),
                        const SizedBox(height: 12),
                        Text(
                          'Cannot browse this directory',
                          style: TextStyle(color: ocTheme.text, fontSize: 14),
                        ),
                      ],
                    ),
                  ),
                )
              : _items.isEmpty
              ? Center(
                  child: Text(
                    'No subdirectories',
                    style: TextStyle(color: ocTheme.textMuted, fontSize: 14),
                  ),
                )
              : ListView.builder(
                  padding: const EdgeInsets.fromLTRB(8, 0, 8, 24),
                  itemCount: _items.length,
                  itemBuilder: (context, index) {
                    final item = _items[index];
                    return _FolderTile(
                      item: item,
                      onTap: () => _navigateTo(item.path),
                    );
                  },
                ),
        ),
      ],
    );
  }
}

class _BrowseItem {
  final String name;
  final String path;
  final bool isDirectory;
  const _BrowseItem({
    required this.name,
    required this.path,
    required this.isDirectory,
  });
}

class _FolderTile extends StatelessWidget {
  const _FolderTile({required this.item, required this.onTap});
  final _BrowseItem item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: Radii.brSm,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Row(
          children: [
            Icon(
              AppIcons.folder,
              color: ocTheme.primary.withValues(alpha: 0.7),
              size: 20,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                item.name,
                style: TextStyle(color: ocTheme.text, fontSize: 15),
                overflow: TextOverflow.ellipsis,
              ),
            ),
            Icon(
              AppIcons.chevronRight,
              color: ocTheme.textMuted.withValues(alpha: 0.5),
              size: 18,
            ),
          ],
        ),
      ),
    );
  }
}
