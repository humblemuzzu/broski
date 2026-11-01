import 'dart:convert';

import 'package:broski/models/file_binary_content.dart';
import 'package:broski/models/file_content.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/selected_agent_available.dart';
import 'package:broski/providers/selection_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/error_utils.dart';
import 'package:broski/utils/responsive.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:broski/widgets/adaptive_container.dart';
import 'package:broski/widgets/connection_indicator.dart';
import 'package:broski/widgets/file_viewers/file_viewers.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class BrowseScreen extends ConsumerStatefulWidget {
  const BrowseScreen({super.key, this.initialPath});
  final String? initialPath;
  @override
  ConsumerState<BrowseScreen> createState() => _BrowseScreenState();
}

class _BrowseScreenState extends ConsumerState<BrowseScreen>
    with SingleTickerProviderStateMixin {
  late String _path;
  late Future<List<dynamic>> _itemsFuture;
  bool _userHasNavigated = false;
  String? _lastSeenProjectPath;
  // Search state
  final TextEditingController _searchController = TextEditingController();
  bool _showSearch = false;
  List<String>? _fileResults;
  String? _searchRoot;
  bool _isSearching = false;
  // File viewer state
  String? _viewingFilePath;
  FileContent? _viewingFileContent;
  Uint8List? _viewingBinaryData;
  bool _isLoadingFile = false;
  String? _fileTooLargeMessage;
  @override
  void initState() {
    super.initState();
    _path = widget.initialPath ?? '~';
    _itemsFuture = _loadItems();
    _loadInitialPath();
  }

  void _handleSelectionChange(SelectionState? previous, SelectionState next) {
    final nextProjectPath = next.project?.path;
    if (nextProjectPath == null || nextProjectPath.isEmpty) return;
    if (_lastSeenProjectPath == nextProjectPath) return;
    _lastSeenProjectPath = nextProjectPath;
    if (_userHasNavigated) return;
    // When a project is selected elsewhere (Projects → Chat), keep Browse in sync.
    // This matches the "tap project, later Browse shows that project" expectation.
    _setPath(nextProjectPath, persist: false, userInitiated: false);
  }

  Future<void> _loadInitialPath() async {
    if (widget.initialPath != null) return;
    // If a project is already selected, prefer showing it in Browse (unless user navigated).
    final selection = ref.read(selectionProvider);
    final selectedProjectPath = selection.project?.path;
    if (selectedProjectPath != null &&
        selectedProjectPath.isNotEmpty &&
        !_userHasNavigated) {
      _lastSeenProjectPath = selectedProjectPath;
      _setPath(selectedProjectPath, persist: false, userInitiated: false);
      return;
    }
    final storage = ref.read(storageServiceProvider);
    final saved = await storage.loadLastBrowsePath();
    if (!mounted) return;
    if (saved == null || saved.isEmpty) return;
    if (_userHasNavigated) return;
    setState(() {
      _path = saved;
      _itemsFuture = _loadItems();
    });
  }

  Future<void> _persistPath(String path) async {
    final storage = ref.read(storageServiceProvider);
    await storage.saveLastBrowsePath(path);
  }

  void _setPath(
    String path, {
    required bool persist,
    required bool userInitiated,
  }) {
    if (!mounted) return;
    setState(() {
      _path = path;
      _itemsFuture = _loadItems();
      _userHasNavigated = userInitiated;
    });
    if (persist) {
      _persistPath(path);
    }
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<List<dynamic>> _loadItems() {
    final bridge = ref.read(bridgeServiceProvider);
    return bridge.browse(_path);
  }

  Future<void> _refresh() async {
    setState(() {
      _itemsFuture = _loadItems();
    });
    await _itemsFuture;
  }

  Future<void> _viewFile(String filePath) async {
    setState(() {
      _viewingFilePath = filePath;
      _viewingFileContent = null;
      _viewingBinaryData = null;
      _fileTooLargeMessage = null;
      _isLoadingFile = true;
    });
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final isBinary = FileContent.isBinaryPath(filePath);
      if (isBinary) {
        final result = await bridge.readFileBinary(filePath);
        if (!mounted) return;
        switch (result) {
          case FileBinarySuccess(:final content):
            setState(() {
              _viewingBinaryData = content.bytes;
              _isLoadingFile = false;
            });
          case FileBinaryTooLarge(:final error):
            setState(() {
              _fileTooLargeMessage =
                  'File too large (${error.sizeFormatted}). Maximum: ${error.maxSizeFormatted}';
              _isLoadingFile = false;
            });
        }
      } else {
        final selection = ref.read(selectionProvider);
        final projectPath = selection.project?.path;
        final withinProject =
            projectPath != null &&
            projectPath.isNotEmpty &&
            filePath.startsWith(projectPath);
        final requestPath = withinProject
            ? filePath.substring(projectPath.length).replaceFirst('/', '')
            : filePath;
        final content = await bridge.readFile(
          requestPath,
          projectPath: withinProject ? projectPath : null,
        );
        if (mounted) {
          setState(() {
            if (content.isBinary && content.encoding == 'base64') {
              final decoded = _tryDecodeBase64(content.content);
              if (decoded != null) {
                _viewingBinaryData = decoded;
                _viewingFileContent = null;
              } else {
                _viewingFileContent = content;
                _viewingBinaryData = null;
              }
            } else {
              _viewingFileContent = content;
              _viewingBinaryData = null;
            }
            _isLoadingFile = false;
          });
        }
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isLoadingFile = false;
        });
        showError(context, 'Failed to load file: ${humanizeError(e)}');
      }
    }
  }

  Uint8List? _tryDecodeBase64(String content) {
    try {
      return base64Decode(content);
    } catch (_) {
      return null;
    }
  }

  void _closeFileViewer() {
    setState(() {
      _viewingFilePath = null;
      _viewingFileContent = null;
      _viewingBinaryData = null;
      _fileTooLargeMessage = null;
    });
  }

  Future<void> _performSearch() async {
    final query = _searchController.text.trim();
    if (query.isEmpty) return;
    final selection = ref.read(selectionProvider);
    final projectPath = selection.project?.path;
    if (projectPath == null) {
      if (mounted) {
        showInfo(
          context,
          'Select a project to search it. File browsing works without it.',
        );
      }
      return;
    }
    setState(() {
      _isSearching = true;
      _fileResults = null;
    });
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final results = await bridge.searchFilesAndDirs(
        query,
        projectPath: projectPath,
      );
      if (mounted) {
        setState(() {
          _searchRoot = projectPath;
          _fileResults = results;
          _isSearching = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isSearching = false);
        showError(context, 'Search failed: ${humanizeError(e)}');
      }
    }
  }

  void _clearSearch() {
    setState(() {
      _searchController.clear();
      _fileResults = null;
    });
  }

  bool _handleBackNavigation() {
    if (_viewingFilePath != null) {
      _closeFileViewer();
      return true;
    }
    if (_showSearch) {
      setState(() => _showSearch = false);
      _clearSearch();
      return true;
    }
    if (_path != '~') {
      _goUp();
      return true;
    }
    return false;
  }

  Widget _buildFileViewerScreen(OpenCodeTheme theme) {
    final filename = _viewingFilePath!.split('/').last;
    final language = FileContent.languageFromPath(_viewingFilePath!);
    return Scaffold(
      backgroundColor: Colors.transparent,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        leading: IconButton(
          icon: Icon(AppIcons.back, color: theme.text),
          onPressed: _closeFileViewer,
        ),
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              filename,
              style: TextStyle(
                fontSize: 16,
                color: theme.text,
                fontWeight: FontWeight.w600,
              ),
            ),
            Text(language, style: AppTypography.label(color: theme.textMuted)),
          ],
        ),
        actions: [
          if (_viewingFileContent != null &&
              _viewingFileContent!.content.isNotEmpty)
            IconButton(
              icon: Icon(AppIcons.copy, color: theme.text),
              onPressed: () {
                Clipboard.setData(
                  ClipboardData(text: _viewingFileContent!.content),
                );
                showSuccess(context, 'Copied to clipboard');
              },
            ),
        ],
      ),
      body: _buildFileViewerBody(theme),
    );
  }

  Widget _buildFileViewerBody(OpenCodeTheme theme) {
    if (_isLoadingFile) {
      return Center(child: CircularProgressIndicator(color: theme.primary));
    }
    if (_fileTooLargeMessage != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(AppIcons.error, size: 64, color: theme.warning),
            const SizedBox(height: Spacing.lg),
            Text(
              _fileTooLargeMessage!,
              style: TextStyle(color: theme.textMuted),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      );
    }
    if (_viewingFilePath == null) {
      return Center(
        child: Text(
          'No file selected',
          style: TextStyle(color: theme.textMuted),
        ),
      );
    }
    return UnifiedFileViewer(
      filePath: _viewingFilePath!,
      textContent: _viewingFileContent?.content,
      binaryData: _viewingBinaryData,
      mimeType: _viewingFileContent?.mime,
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final connection = ref.watch(connectionProvider);
    final selection = ref.watch(selectionProvider);
    final selectedProjectPath = selection.project?.path;
    final agentAvailable = ref.watch(selectedAgentAvailableProvider);
    // Listen for selection changes to sync Browse path with selected project
    ref.listen(selectionProvider, _handleSelectionChange);
    // Show file viewer if viewing a file
    if (_viewingFilePath != null) {
      return PopScope(
        canPop: false,
        onPopInvokedWithResult: (didPop, _) {
          if (!didPop) {
            _handleBackNavigation();
          }
        },
        child: _buildFileViewerScreen(theme),
      );
    }
    return PopScope(
      canPop: _path == '~' && !_showSearch,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) {
          _handleBackNavigation();
        }
      },
      child: Scaffold(
        backgroundColor: Colors.transparent,
        appBar: AppBar(
          backgroundColor: Colors.transparent,
          elevation: 0,
          leading: IconButton(
            icon: Icon(AppIcons.back, color: theme.text),
            onPressed: () {
              final handled = _handleBackNavigation();
              if (!handled) {
                Navigator.of(context).pop();
              }
            },
          ),
          title: _showSearch
              ? _buildSearchBar(theme)
              : GestureDetector(
                  onTap: _showPathBreadcrumb,
                  child: Text(
                    _getDisplayPath(),
                    style: TextStyle(
                      fontSize: 16,
                      color: theme.text,
                      fontWeight: FontWeight.w600,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
          actions: [
            // Search button (when not searching)
            if (!_showSearch)
              IconButton(
                icon: Icon(AppIcons.search, color: theme.text),
                onPressed: () => setState(() => _showSearch = true),
              ),
            if (!_showSearch && selectedProjectPath != null)
              IconButton(
                tooltip: 'Current project',
                icon: Icon(AppIcons.folderOpen, color: theme.text),
                onPressed: () {
                  _lastSeenProjectPath = selectedProjectPath;
                  _setPath(
                    selectedProjectPath,
                    persist: false,
                    userInitiated: false,
                  );
                },
              ),
            // Connection indicator
            Padding(
              padding: Insets.chipH,
              child: ConnectionIndicator(
                status: connection.status,
                agentAvailable: agentAvailable,
                isReconnecting: connection.isReconnecting,
                rttMs: connection.rttMs,
                compact: true,
              ),
            ),
          ],
        ),
        body: AdaptiveContainer(
          width: ContentWidth.wide,
          child: _showSearch
              ? _buildSearchResults(theme)
              : _buildFileBrowser(theme),
        ),
      ),
    );
  }

  String _getDisplayPath() {
    final parts = _path.split('/');
    if (parts.length > 2) {
      return '.../${parts.last}';
    }
    return _path;
  }

  void _showPathBreadcrumb() {
    final theme = OpenCodeTheme.of(context);
    showModalBottomSheet(
      context: context,
      backgroundColor: theme.backgroundPanel,
      shape: const RoundedRectangleBorder(borderRadius: Radii.sheetTop),
      builder: (context) {
        final parts = _path.split('/').where((p) => p.isNotEmpty).toList();
        return Container(
          padding: Insets.screenAll,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Current Path',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w600,
                  color: theme.text,
                ),
              ),
              const SizedBox(height: Spacing.lg),
              Wrap(
                children: [
                  _PathChip(
                    label: '~',
                    onTap: () {
                      Navigator.pop(context);
                      _navigate('~');
                    },
                  ),
                  for (var i = 0; i < parts.length; i++) ...[
                    Icon(
                      AppIcons.chevronRight,
                      color: theme.textMuted,
                      size: 20,
                    ),
                    _PathChip(
                      label: parts[i],
                      onTap: () {
                        Navigator.pop(context);
                        final newPath = '/${parts.sublist(0, i + 1).join('/')}';
                        _navigate(newPath);
                      },
                    ),
                  ],
                ],
              ),
              const SizedBox(height: Spacing.xl),
            ],
          ),
        );
      },
    );
  }

  Widget _buildSearchBar(OpenCodeTheme theme) {
    return TextField(
      controller: _searchController,
      autofocus: true,
      style: TextStyle(color: theme.text, fontSize: 16),
      decoration: InputDecoration(
        hintText: _searchHint,
        hintStyle: TextStyle(color: theme.textMuted),
        border: InputBorder.none,
        suffixIcon: _searchController.text.isNotEmpty
            ? IconButton(
                icon: Icon(AppIcons.close, color: theme.textMuted),
                onPressed: _clearSearch,
              )
            : null,
      ),
      onSubmitted: (_) => _performSearch(),
    );
  }

  static const _searchHint = 'Search files and folders...';

  Widget _buildSearchResults(OpenCodeTheme theme) {
    if (_isSearching) {
      return Center(child: CircularProgressIndicator(color: theme.primary));
    }
    if (_fileResults != null) {
      return _buildFileSearchResults(theme);
    }
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(AppIcons.search, size: 48, color: theme.textMuted),
          const SizedBox(height: Spacing.lg),
          Text(
            _searchHint,
            style: TextStyle(color: theme.textMuted, fontSize: 16),
          ),
        ],
      ),
    );
  }

  Widget _buildFileSearchResults(OpenCodeTheme theme) {
    if (_fileResults!.isEmpty) {
      return Center(
        child: Text('Nothing found', style: TextStyle(color: theme.textMuted)),
      );
    }
    return ListView.builder(
      padding: Insets.card,
      itemCount: _fileResults!.length,
      itemBuilder: (context, index) {
        final relative = _fileResults![index];
        final isDir = relative.endsWith('/');
        final trimmed = isDir
            ? relative.substring(0, relative.length - 1)
            : relative;
        final absolute = _joinPath(_searchRoot ?? _path, trimmed);
        return _FileResultTile(
          filename: trimmed.split('/').last,
          path: relative,
          isDirectory: isDir,
          onTap: () {
            if (!isDir) {
              _viewFile(absolute);
              return;
            }
            setState(() => _showSearch = false);
            _clearSearch();
            _navigate(absolute);
          },
        );
      },
    );
  }

  Widget _buildFileBrowser(OpenCodeTheme theme) {
    return RefreshIndicator(
      onRefresh: _refresh,
      color: theme.primary,
      child: FutureBuilder<List<dynamic>>(
        future: _itemsFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return Center(
              child: CircularProgressIndicator(color: theme.primary),
            );
          }
          if (snapshot.hasError) {
            return Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(AppIcons.error, size: 48, color: theme.error),
                  const SizedBox(height: Spacing.lg),
                  Text(
                    'Failed to browse:\n${humanizeError(snapshot.error ?? "Unknown error")}',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: theme.textMuted),
                  ),
                ],
              ),
            );
          }
          final items = snapshot.data ?? [];
          if (items.isEmpty) {
            return Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(AppIcons.folderOpen, size: 48, color: theme.textMuted),
                  const SizedBox(height: Spacing.lg),
                  Text(
                    'Empty folder',
                    style: TextStyle(color: theme.textMuted),
                  ),
                ],
              ),
            );
          }
          // Sort: directories first, then files, alphabetically
          items.sort((a, b) {
            final aType = a['type'] as String? ?? 'file';
            final bType = b['type'] as String? ?? 'file';
            if (aType != bType) {
              return aType == 'directory' ? -1 : 1;
            }
            final aName = (a['name'] as String? ?? '').toLowerCase();
            final bName = (b['name'] as String? ?? '').toLowerCase();
            return aName.compareTo(bName);
          });
          return ListView.builder(
            padding: Insets.card,
            itemCount: items.length + (_path != '~' ? 1 : 0),
            itemBuilder: (context, index) {
              // Go up option
              if (_path != '~' && index == 0) {
                return _FileTile(
                  icon: AppIcons.arrowUp,
                  iconColor: theme.primary,
                  name: '..',
                  subtitle: 'Go up',
                  onTap: _goUp,
                );
              }
              final itemIndex = _path != '~' ? index - 1 : index;
              final item = items[itemIndex] as Map<String, dynamic>;
              final type = item['type'] as String? ?? 'file';
              final name = item['name'] as String? ?? '';
              final resolvedNextPath =
                  item['absolute'] as String? ?? item['path'] as String? ?? '';
              final nextPath = resolvedNextPath.isNotEmpty
                  ? resolvedNextPath
                  : _joinPath(_path, name);
              return _FileTile(
                icon: type == 'directory'
                    ? AppIcons.folder
                    : _getFileIcon(name),
                iconColor: type == 'directory'
                    ? theme.warning
                    : theme.textMuted,
                name: name,
                subtitle: type == 'directory' ? 'Folder' : _getFileSize(item),
                onTap: () {
                  if (type == 'directory') {
                    _navigate(nextPath);
                  } else {
                    _viewFile(nextPath);
                  }
                },
              );
            },
          );
        },
      ),
    );
  }

  IconData _getFileIcon(String name) {
    final ext = name.split('.').last.toLowerCase();
    switch (ext) {
      case 'dart':
        return AppIcons.code;
      case 'ts':
      case 'tsx':
      case 'js':
      case 'jsx':
        return AppIcons.javascript;
      case 'json':
        return AppIcons.dataObject;
      case 'yaml':
      case 'yml':
        return AppIcons.settings;
      case 'md':
        return AppIcons.description;
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif':
      case 'svg':
        return AppIcons.image;
      case 'pdf':
        return AppIcons.pdf;
      default:
        return AppIcons.file;
    }
  }

  String _getFileSize(Map<String, dynamic> item) {
    final size = item['size'] as int?;
    if (size == null) return 'File';
    if (size < 1024) return '$size B';
    if (size < 1024 * 1024) return '${(size / 1024).toStringAsFixed(1)} KB';
    return '${(size / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  void _navigate(String nextPath) {
    if (nextPath.isEmpty) return;
    _setPath(nextPath, persist: true, userInitiated: true);
  }

  void _goUp() {
    if (_path == '~') return;
    if (_path.startsWith('~/')) {
      final parts = _path.split('/').where((p) => p.isNotEmpty).toList();
      if (parts.length <= 1) {
        _navigate('~');
        return;
      }
      if (parts.length == 2) {
        _navigate('~');
        return;
      }
      _navigate('~/${parts.sublist(1, parts.length - 1).join('/')}');
      return;
    }
    final parts = _path.split('/').where((p) => p.isNotEmpty).toList();
    if (parts.length <= 1) {
      _navigate('~');
      return;
    }
    _navigate('/${parts.sublist(0, parts.length - 1).join('/')}');
  }

  String _joinPath(String base, String name) {
    if (base.isEmpty || base == '~') return '~/$name';
    if (base == '/') return '/$name';
    if (base.endsWith('/')) return '$base$name';
    return '$base/$name';
  }
}

// File tile widget
class _FileTile extends StatelessWidget {
  const _FileTile({
    required this.icon,
    required this.iconColor,
    required this.name,
    required this.subtitle,
    required this.onTap,
  });
  final IconData icon;
  final Color iconColor;
  final String name;
  final String subtitle;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final themeData = Theme.of(context);
    return Container(
      margin: Insets.bottomSm,
      decoration: BoxDecoration(
        color: themeData.colorScheme.surface.withValues(alpha: 0.5),
        borderRadius: Radii.brMd,
        border: Border.all(color: theme.borderSubtle),
      ),
      child: ListTile(
        onTap: onTap,
        leading: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: iconColor.withValues(alpha: 0.15),
            borderRadius: Radii.brMd,
          ),
          child: Icon(icon, color: iconColor, size: 22),
        ),
        title: Text(
          name,
          style: TextStyle(
            color: theme.text,
            fontSize: 14,
            fontWeight: FontWeight.w500,
          ),
          overflow: TextOverflow.ellipsis,
        ),
        subtitle: Text(
          subtitle,
          style: AppTypography.label(color: theme.textMuted),
        ),
        trailing: Icon(AppIcons.chevronRight, color: theme.textMuted, size: 20),
      ),
    );
  }
}

// Path chip for breadcrumb
class _PathChip extends StatelessWidget {
  const _PathChip({required this.label, required this.onTap});
  final String label;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        margin: const EdgeInsets.only(right: 4, bottom: 4),
        decoration: BoxDecoration(
          color: theme.primary.withValues(alpha: 0.15),
          borderRadius: Radii.brSm,
        ),
        child: Text(
          label,
          style: TextStyle(
            color: theme.primary,
            fontSize: 13,
            fontWeight: FontWeight.w500,
          ),
        ),
      ),
    );
  }
}

// File search result tile
class _FileResultTile extends StatelessWidget {
  const _FileResultTile({
    required this.filename,
    required this.path,
    required this.isDirectory,
    required this.onTap,
  });
  final String filename;
  final String path;
  final bool isDirectory;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final themeData = Theme.of(context);
    return Container(
      margin: Insets.bottomSm,
      decoration: BoxDecoration(
        color: themeData.colorScheme.surface.withValues(alpha: 0.5),
        borderRadius: Radii.brMd,
        border: Border.all(color: theme.borderSubtle),
      ),
      child: ListTile(
        onTap: onTap,
        leading: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: theme.primary.withValues(alpha: 0.15),
            borderRadius: Radii.brMd,
          ),
          child: Icon(
            isDirectory ? AppIcons.folder : AppIcons.description,
            color: theme.primary,
            size: 20,
          ),
        ),
        title: Text(
          filename,
          style: TextStyle(
            color: theme.text,
            fontSize: 14,
            fontWeight: FontWeight.w500,
          ),
        ),
        subtitle: Text(
          path,
          style: AppTypography.label(color: theme.textMuted),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
      ),
    );
  }
}
