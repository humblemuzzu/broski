import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/file_binary_content.dart';
import '../models/file_content.dart';
import '../models/search_result.dart';
import '../models/vcs.dart';
import '../providers/connection_provider.dart';
import '../providers/service_providers.dart';
import '../providers/selection_provider.dart';
import '../theme/opencode_theme.dart';
import '../widgets/connection_indicator.dart';
import '../widgets/file_viewers/file_viewers.dart';

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
  SearchType _searchType = SearchType.files;
  List<String>? _fileResults;
  List<TextSearchResult>? _textResults;
  List<SymbolResult>? _symbolResults;
  bool _isSearching = false;

  // File viewer state
  String? _viewingFilePath;
  FileContent? _viewingFileContent;
  Uint8List? _viewingBinaryData;
  bool _isLoadingFile = false;
  String? _fileTooLargeMessage;

  // Feature 18: File status (git)
  Map<String, FileStatusInfo>? _fileStatusMap;

  @override
  void initState() {
    super.initState();
    _path = widget.initialPath ?? '~';
    _itemsFuture = _loadItems();
    _loadInitialPath();
    _loadFileStatus();

    ref.listen(selectionProvider, (previous, next) {
      final nextProjectPath = next.project?.path;
      if (nextProjectPath == null || nextProjectPath.isEmpty) return;
      if (_lastSeenProjectPath == nextProjectPath) return;
      _lastSeenProjectPath = nextProjectPath;
      if (_userHasNavigated) return;

      // When a project is selected elsewhere (Projects → Chat), keep Browse in sync.
      // This matches the "tap project, later Browse shows that project" expectation.
      _setPath(nextProjectPath, persist: false, userInitiated: false);
    });
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
    _loadFileStatus();
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
    _loadFileStatus();
  }

  // Feature 18: Load git file status
  Future<void> _loadFileStatus() async {
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final selection = ref.read(selectionProvider);
      final projectPath = selection.project?.path;
      if (projectPath == null) return;
      if (!_path.startsWith(projectPath)) return;

      final fileStatus = await bridge.getFileStatus(projectPath: projectPath);
      if (mounted) {
        setState(() {
          _fileStatusMap = {for (final fs in fileStatus) fs.path: fs};
        });
      }
    } catch (_) {
      // File status might not be available
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
            _viewingFileContent = content;
            _isLoadingFile = false;
          });
        }
      }
    } catch (e) {
      if (mounted) {
        final theme = OpenCodeTheme.of(context);
        setState(() {
          _isLoadingFile = false;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to load file: $e'),
            backgroundColor: theme.error,
          ),
        );
      }
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

  // Feature 12: Search
  Future<void> _performSearch() async {
    final query = _searchController.text.trim();
    if (query.isEmpty) return;

    final selection = ref.read(selectionProvider);
    final projectPath = selection.project?.path;
    if (projectPath == null) {
      if (mounted) {
        final theme = OpenCodeTheme.of(context);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Text(
              'Select a project to use OpenCode search. File browsing works without it.',
            ),
            backgroundColor: theme.backgroundPanel,
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
      return;
    }

    setState(() {
      _isSearching = true;
      _fileResults = null;
      _textResults = null;
      _symbolResults = null;
    });

    try {
      final bridge = ref.read(bridgeServiceProvider);

      switch (_searchType) {
        case SearchType.files:
          final results = await bridge.findFiles(
            query,
            projectPath: projectPath,
          );
          if (mounted) {
            setState(() {
              _fileResults = results;
              _isSearching = false;
            });
          }
          break;
        case SearchType.text:
          final results = await bridge.findText(
            query,
            projectPath: projectPath,
          );
          if (mounted) {
            setState(() {
              _textResults = results;
              _isSearching = false;
            });
          }
          break;
        case SearchType.symbols:
          final results = await bridge.findSymbols(
            query,
            projectPath: projectPath,
          );
          if (mounted) {
            setState(() {
              _symbolResults = results;
              _isSearching = false;
            });
          }
          break;
      }
    } catch (e) {
      if (mounted) {
        final theme = OpenCodeTheme.of(context);
        setState(() => _isSearching = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Search failed: $e'),
            backgroundColor: theme.error,
          ),
        );
      }
    }
  }

  void _clearSearch() {
    setState(() {
      _searchController.clear();
      _fileResults = null;
      _textResults = null;
      _symbolResults = null;
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
          icon: Icon(Icons.arrow_back_rounded, color: theme.text),
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
            Text(
              language,
              style: TextStyle(fontSize: 12, color: theme.textMuted),
            ),
          ],
        ),
        actions: [
          if (_viewingFileContent != null &&
              _viewingFileContent!.content.isNotEmpty)
            IconButton(
              icon: Icon(Icons.copy, color: theme.text),
              onPressed: () {
                Clipboard.setData(
                  ClipboardData(text: _viewingFileContent!.content),
                );
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: const Text('Copied to clipboard'),
                    backgroundColor: theme.backgroundPanel,
                  ),
                );
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
            Icon(Icons.error_outline, size: 64, color: theme.warning),
            const SizedBox(height: 16),
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
            icon: Icon(Icons.arrow_back_rounded, color: theme.text),
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
            // Search type selector (when searching)
            if (_showSearch)
              PopupMenuButton<SearchType>(
                icon: Icon(_getSearchTypeIcon(), color: theme.text),
                color: theme.backgroundPanel,
                onSelected: (type) {
                  setState(() => _searchType = type);
                  _performSearch();
                },
                itemBuilder: (context) => [
                  PopupMenuItem(
                    value: SearchType.files,
                    child: _SearchTypeItem(
                      icon: Icons.description_outlined,
                      label: 'Files',
                      isSelected: _searchType == SearchType.files,
                    ),
                  ),
                  PopupMenuItem(
                    value: SearchType.text,
                    child: _SearchTypeItem(
                      icon: Icons.text_fields,
                      label: 'Text',
                      isSelected: _searchType == SearchType.text,
                    ),
                  ),
                  PopupMenuItem(
                    value: SearchType.symbols,
                    child: _SearchTypeItem(
                      icon: Icons.code,
                      label: 'Symbols',
                      isSelected: _searchType == SearchType.symbols,
                    ),
                  ),
                ],
              ),
            // Search button (when not searching)
            if (!_showSearch)
              IconButton(
                icon: Icon(Icons.search, color: theme.text),
                onPressed: () => setState(() => _showSearch = true),
              ),
            if (!_showSearch && selectedProjectPath != null)
              IconButton(
                tooltip: 'Current project',
                icon: Icon(Icons.folder_open_rounded, color: theme.text),
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
              padding: const EdgeInsets.symmetric(horizontal: 8),
              child: ConnectionIndicator(
                status: connection.status,
                opencodeRunning: connection.opencodeRunning,
                isReconnecting: connection.isReconnecting,
                rttMs: connection.rttMs,
                compact: true,
              ),
            ),
          ],
        ),
        body: _showSearch
            ? _buildSearchResults(theme)
            : _buildFileBrowser(theme),
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
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) {
        final parts = _path.split('/').where((p) => p.isNotEmpty).toList();
        return Container(
          padding: const EdgeInsets.all(20),
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
              const SizedBox(height: 16),
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
                    Icon(Icons.chevron_right, color: theme.textMuted, size: 20),
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
              const SizedBox(height: 20),
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
        hintText: _getSearchHint(),
        hintStyle: TextStyle(color: theme.textMuted),
        border: InputBorder.none,
        suffixIcon: _searchController.text.isNotEmpty
            ? IconButton(
                icon: Icon(Icons.clear, color: theme.textMuted),
                onPressed: _clearSearch,
              )
            : null,
      ),
      onSubmitted: (_) => _performSearch(),
    );
  }

  String _getSearchHint() {
    switch (_searchType) {
      case SearchType.files:
        return 'Search files...';
      case SearchType.text:
        return 'Search in files...';
      case SearchType.symbols:
        return 'Search symbols...';
    }
  }

  IconData _getSearchTypeIcon() {
    switch (_searchType) {
      case SearchType.files:
        return Icons.description_outlined;
      case SearchType.text:
        return Icons.text_fields;
      case SearchType.symbols:
        return Icons.code;
    }
  }

  Widget _buildSearchResults(OpenCodeTheme theme) {
    if (_isSearching) {
      return Center(child: CircularProgressIndicator(color: theme.primary));
    }

    if (_fileResults != null) {
      return _buildFileSearchResults(theme);
    }

    if (_textResults != null) {
      return _buildTextSearchResults(theme);
    }

    if (_symbolResults != null) {
      return _buildSymbolSearchResults(theme);
    }

    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(_getSearchTypeIcon(), size: 48, color: theme.textMuted),
          const SizedBox(height: 16),
          Text(
            _getSearchHint(),
            style: TextStyle(color: theme.textMuted, fontSize: 16),
          ),
        ],
      ),
    );
  }

  Widget _buildFileSearchResults(OpenCodeTheme theme) {
    if (_fileResults!.isEmpty) {
      return Center(
        child: Text('No files found', style: TextStyle(color: theme.textMuted)),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: _fileResults!.length,
      itemBuilder: (context, index) {
        final path = _fileResults![index];
        final filename = path.split('/').last;
        return _FileResultTile(
          filename: filename,
          path: path,
          onTap: () => _viewFile(path),
        );
      },
    );
  }

  Widget _buildTextSearchResults(OpenCodeTheme theme) {
    if (_textResults!.isEmpty) {
      return Center(
        child: Text(
          'No matches found',
          style: TextStyle(color: theme.textMuted),
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: _textResults!.length,
      itemBuilder: (context, index) {
        final result = _textResults![index];
        return _TextResultTile(
          result: result,
          onTap: () => _viewFile(result.path),
        );
      },
    );
  }

  Widget _buildSymbolSearchResults(OpenCodeTheme theme) {
    if (_symbolResults!.isEmpty) {
      return Center(
        child: Text(
          'No symbols found',
          style: TextStyle(color: theme.textMuted),
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: _symbolResults!.length,
      itemBuilder: (context, index) {
        final result = _symbolResults![index];
        return _SymbolResultTile(
          result: result,
          onTap: () => _viewFile(result.path),
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
                  Icon(Icons.error_outline, size: 48, color: theme.error),
                  const SizedBox(height: 16),
                  Text(
                    'Failed to browse:\n${snapshot.error}',
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
                  Icon(Icons.folder_open, size: 48, color: theme.textMuted),
                  const SizedBox(height: 16),
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
            padding: const EdgeInsets.all(16),
            itemCount: items.length + (_path != '~' ? 1 : 0),
            itemBuilder: (context, index) {
              // Go up option
              if (_path != '~' && index == 0) {
                return _FileTile(
                  icon: Icons.arrow_upward_rounded,
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

              // Feature 18: Get file status
              final fileStatus = _fileStatusFor(nextPath);

              return _FileTile(
                icon: type == 'directory'
                    ? Icons.folder_rounded
                    : _getFileIcon(name),
                iconColor: type == 'directory'
                    ? theme.warning
                    : theme.textMuted,
                name: name,
                subtitle: type == 'directory' ? 'Folder' : _getFileSize(item),
                fileStatus: type != 'directory' ? fileStatus : null,
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
        return Icons.code;
      case 'ts':
      case 'tsx':
      case 'js':
      case 'jsx':
        return Icons.javascript;
      case 'json':
        return Icons.data_object;
      case 'yaml':
      case 'yml':
        return Icons.settings;
      case 'md':
        return Icons.description;
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif':
      case 'svg':
        return Icons.image;
      case 'pdf':
        return Icons.picture_as_pdf;
      default:
        return Icons.insert_drive_file_outlined;
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

  FileStatusInfo? _fileStatusFor(String absolutePath) {
    final selection = ref.read(selectionProvider);
    final projectPath = selection.project?.path;
    if (projectPath == null || projectPath.isEmpty) return null;
    if (!_path.startsWith(projectPath)) return null;
    if (!absolutePath.startsWith(projectPath)) return null;
    final relative = absolutePath == projectPath
        ? ''
        : absolutePath.substring(projectPath.length).replaceFirst('/', '');
    if (relative.isEmpty) return null;
    return _fileStatusMap?[relative];
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
    this.fileStatus,
  });

  final IconData icon;
  final Color iconColor;
  final String name;
  final String subtitle;
  final VoidCallback onTap;
  // Feature 18: Git file status
  final FileStatusInfo? fileStatus;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final themeData = Theme.of(context);
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: themeData.colorScheme.surface.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: theme.borderSubtle),
      ),
      child: ListTile(
        onTap: onTap,
        leading: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: iconColor.withValues(alpha: 0.15),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Icon(icon, color: iconColor, size: 22),
        ),
        title: Row(
          children: [
            Expanded(
              child: Text(
                name,
                style: TextStyle(
                  color: theme.text,
                  fontSize: 14,
                  fontWeight: FontWeight.w500,
                ),
                overflow: TextOverflow.ellipsis,
              ),
            ),
            // Feature 18: Show git status badge
            if (fileStatus != null) ...[
              const SizedBox(width: 8),
              _FileStatusBadge(status: fileStatus!),
            ],
          ],
        ),
        subtitle: Text(
          subtitle,
          style: TextStyle(color: theme.textMuted, fontSize: 12),
        ),
        trailing: Icon(Icons.chevron_right, color: theme.textMuted, size: 20),
      ),
    );
  }
}

// Feature 18: Git file status badge
class _FileStatusBadge extends StatelessWidget {
  const _FileStatusBadge({required this.status});

  final FileStatusInfo status;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final (label, color) = switch (status.status) {
      FileStatusType.modified => ('M', theme.primary),
      FileStatusType.added => ('A', theme.success),
      FileStatusType.deleted => ('D', theme.error),
      FileStatusType.renamed => ('R', theme.warning),
      FileStatusType.copied => ('C', theme.info),
      FileStatusType.untracked => ('?', theme.textMuted),
      FileStatusType.ignored => ('!', theme.textMuted),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 10,
          fontWeight: FontWeight.w700,
          fontFamily: 'JetBrains Mono',
        ),
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
          borderRadius: BorderRadius.circular(8),
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

// Search type item
class _SearchTypeItem extends StatelessWidget {
  const _SearchTypeItem({
    required this.icon,
    required this.label,
    required this.isSelected,
  });

  final IconData icon;
  final String label;
  final bool isSelected;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Row(
      children: [
        Icon(
          icon,
          color: isSelected ? theme.primary : theme.textMuted,
          size: 20,
        ),
        const SizedBox(width: 12),
        Text(
          label,
          style: TextStyle(
            color: isSelected ? theme.primary : theme.text,
            fontWeight: isSelected ? FontWeight.w600 : FontWeight.w500,
          ),
        ),
        const Spacer(),
        if (isSelected) Icon(Icons.check, color: theme.primary, size: 18),
      ],
    );
  }
}

// File search result tile
class _FileResultTile extends StatelessWidget {
  const _FileResultTile({
    required this.filename,
    required this.path,
    required this.onTap,
  });

  final String filename;
  final String path;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final themeData = Theme.of(context);
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: themeData.colorScheme.surface.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: theme.borderSubtle),
      ),
      child: ListTile(
        onTap: onTap,
        leading: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: theme.primary.withValues(alpha: 0.15),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Icon(Icons.description, color: theme.primary, size: 20),
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
          style: TextStyle(color: theme.textMuted, fontSize: 12),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
      ),
    );
  }
}

// Text search result tile
class _TextResultTile extends StatelessWidget {
  const _TextResultTile({required this.result, required this.onTap});

  final TextSearchResult result;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final themeData = Theme.of(context);
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: themeData.colorScheme.surface.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: theme.borderSubtle),
      ),
      child: ListTile(
        onTap: onTap,
        title: Row(
          children: [
            Text(
              result.filename,
              style: TextStyle(
                color: theme.text,
                fontSize: 14,
                fontWeight: FontWeight.w500,
              ),
            ),
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: theme.textMuted.withValues(alpha: 0.2),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(
                'L${result.lineNumber}',
                style: TextStyle(color: theme.textMuted, fontSize: 11),
              ),
            ),
          ],
        ),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text(
            result.lineText.trim(),
            style: TextStyle(
              color: theme.textMuted,
              fontSize: 12,
              fontFamily: 'JetBrains Mono',
            ),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ),
    );
  }
}

// Symbol search result tile
class _SymbolResultTile extends StatelessWidget {
  const _SymbolResultTile({required this.result, required this.onTap});

  final SymbolResult result;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final themeData = Theme.of(context);
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: themeData.colorScheme.surface.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: theme.borderSubtle),
      ),
      child: ListTile(
        onTap: onTap,
        leading: Container(
          width: 36,
          height: 36,
          decoration: BoxDecoration(
            color: _getSymbolColor(result.kind, theme).withValues(alpha: 0.15),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Center(
            child: Text(
              result.icon,
              style: TextStyle(
                color: _getSymbolColor(result.kind, theme),
                fontSize: 16,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ),
        title: Text(
          result.name,
          style: TextStyle(
            color: theme.text,
            fontSize: 14,
            fontWeight: FontWeight.w500,
          ),
        ),
        subtitle: Text(
          '${result.filename}:${result.line}',
          style: TextStyle(color: theme.textMuted, fontSize: 12),
        ),
        trailing: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(
            color: theme.textMuted.withValues(alpha: 0.2),
            borderRadius: BorderRadius.circular(6),
          ),
          child: Text(
            result.kind,
            style: TextStyle(color: theme.textMuted, fontSize: 11),
          ),
        ),
      ),
    );
  }

  Color _getSymbolColor(String kind, OpenCodeTheme theme) {
    switch (kind.toLowerCase()) {
      case 'class':
      case 'interface':
        return theme.warning;
      case 'function':
      case 'method':
        return theme.info;
      case 'variable':
      case 'field':
      case 'property':
        return theme.primary;
      case 'enum':
      case 'enummember':
        return theme.success;
      default:
        return theme.textMuted;
    }
  }
}
