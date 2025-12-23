import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/file_content.dart';
import '../models/search_result.dart';
import '../models/vcs.dart';
import '../providers/connection_provider.dart';
import '../providers/service_providers.dart';
import '../providers/selection_provider.dart';
import '../widgets/connection_indicator.dart';

// Color constants matching chat screen design
const _kBackground = Color(0xFF16161E);
const _kCard = Color(0xFF1F2128);
const _kBorder = Color(0xFF2A2D36);
const _kOnBackground = Color(0xFFE4E4E7);
const _kMuted = Color(0xFF71717A);
const _kAccent = Color(0xFF3B82F6);
const _kSuccess = Color(0xFF10B981);
const _kError = Color(0xFFEF4444);

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
  bool _isLoadingFile = false;

  // Feature 18: File status (git)
  Map<String, FileStatusInfo>? _fileStatusMap;

  @override
  void initState() {
    super.initState();
    // Use project path if available, otherwise default to ~
    final selection = ref.read(selectionProvider);
    _path = widget.initialPath ?? selection.project?.path ?? '~';
    _itemsFuture = _loadItems();
    _loadFileStatus();
  }

  // Feature 18: Load git file status
  Future<void> _loadFileStatus() async {
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final selection = ref.read(selectionProvider);
      final fileStatus = await bridge.getFileStatus(
        projectPath: selection.project?.path,
      );
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
    final selection = ref.read(selectionProvider);
    return bridge.browse(_path, projectPath: selection.project?.path);
  }

  Future<void> _refresh() async {
    setState(() {
      _itemsFuture = _loadItems();
    });
    await _itemsFuture;
  }

  // Feature 11: Read file content
  Future<void> _viewFile(String filePath) async {
    setState(() {
      _viewingFilePath = filePath;
      _isLoadingFile = true;
    });

    try {
      final bridge = ref.read(bridgeServiceProvider);
      final selection = ref.read(selectionProvider);
      final content = await bridge.readFile(
        filePath,
        projectPath: selection.project?.path,
      );
      if (mounted) {
        setState(() {
          _viewingFileContent = content;
          _isLoadingFile = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isLoadingFile = false;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to load file: $e'),
            backgroundColor: _kError,
          ),
        );
      }
    }
  }

  void _closeFileViewer() {
    setState(() {
      _viewingFilePath = null;
      _viewingFileContent = null;
    });
  }

  // Feature 12: Search
  Future<void> _performSearch() async {
    final query = _searchController.text.trim();
    if (query.isEmpty) return;

    setState(() {
      _isSearching = true;
      _fileResults = null;
      _textResults = null;
      _symbolResults = null;
    });

    try {
      final bridge = ref.read(bridgeServiceProvider);
      final selection = ref.read(selectionProvider);

      switch (_searchType) {
        case SearchType.files:
          final results = await bridge.findFiles(
            query,
            projectPath: selection.project?.path,
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
            projectPath: selection.project?.path,
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
            projectPath: selection.project?.path,
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
        setState(() => _isSearching = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Search failed: $e'),
            backgroundColor: _kError,
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

  @override
  Widget build(BuildContext context) {
    final connection = ref.watch(connectionProvider);

    // Show file viewer if viewing a file
    if (_viewingFilePath != null) {
      return _FileViewerScreen(
        filePath: _viewingFilePath!,
        content: _viewingFileContent,
        isLoading: _isLoadingFile,
        onClose: _closeFileViewer,
      );
    }

    return Scaffold(
      backgroundColor: _kBackground,
      appBar: AppBar(
        backgroundColor: _kBackground,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded, color: _kOnBackground),
          onPressed: () {
            if (_showSearch) {
              setState(() => _showSearch = false);
              _clearSearch();
            } else {
              Navigator.of(context).pop();
            }
          },
        ),
        title: _showSearch
            ? _buildSearchBar()
            : GestureDetector(
                onTap: _showPathBreadcrumb,
                child: Text(
                  _getDisplayPath(),
                  style: const TextStyle(
                    fontSize: 16,
                    color: _kOnBackground,
                    fontWeight: FontWeight.w600,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
        actions: [
          // Search type selector (when searching)
          if (_showSearch)
            PopupMenuButton<SearchType>(
              icon: Icon(_getSearchTypeIcon(), color: _kOnBackground),
              color: _kCard,
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
              icon: const Icon(Icons.search, color: _kOnBackground),
              onPressed: () => setState(() => _showSearch = true),
            ),
          // Connection indicator
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8),
            child: ConnectionIndicator(
              status: connection.status,
              opencodeRunning: connection.opencodeRunning,
              compact: true,
            ),
          ),
        ],
      ),
      body: _showSearch ? _buildSearchResults() : _buildFileBrowser(),
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
    showModalBottomSheet(
      context: context,
      backgroundColor: _kCard,
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
              const Text(
                'Current Path',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w600,
                  color: _kOnBackground,
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
                    const Icon(Icons.chevron_right, color: _kMuted, size: 20),
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

  Widget _buildSearchBar() {
    return TextField(
      controller: _searchController,
      autofocus: true,
      style: const TextStyle(color: _kOnBackground, fontSize: 16),
      decoration: InputDecoration(
        hintText: _getSearchHint(),
        hintStyle: const TextStyle(color: _kMuted),
        border: InputBorder.none,
        suffixIcon: _searchController.text.isNotEmpty
            ? IconButton(
                icon: const Icon(Icons.clear, color: _kMuted),
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

  Widget _buildSearchResults() {
    if (_isSearching) {
      return const Center(child: CircularProgressIndicator(color: _kAccent));
    }

    if (_fileResults != null) {
      return _buildFileSearchResults();
    }

    if (_textResults != null) {
      return _buildTextSearchResults();
    }

    if (_symbolResults != null) {
      return _buildSymbolSearchResults();
    }

    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(_getSearchTypeIcon(), size: 48, color: _kMuted),
          const SizedBox(height: 16),
          Text(
            _getSearchHint(),
            style: const TextStyle(color: _kMuted, fontSize: 16),
          ),
        ],
      ),
    );
  }

  Widget _buildFileSearchResults() {
    if (_fileResults!.isEmpty) {
      return const Center(
        child: Text('No files found', style: TextStyle(color: _kMuted)),
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

  Widget _buildTextSearchResults() {
    if (_textResults!.isEmpty) {
      return const Center(
        child: Text('No matches found', style: TextStyle(color: _kMuted)),
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

  Widget _buildSymbolSearchResults() {
    if (_symbolResults!.isEmpty) {
      return const Center(
        child: Text('No symbols found', style: TextStyle(color: _kMuted)),
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

  Widget _buildFileBrowser() {
    return RefreshIndicator(
      onRefresh: _refresh,
      color: _kAccent,
      child: FutureBuilder<List<dynamic>>(
        future: _itemsFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(
              child: CircularProgressIndicator(color: _kAccent),
            );
          }
          if (snapshot.hasError) {
            return Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.error_outline, size: 48, color: _kError),
                  const SizedBox(height: 16),
                  Text(
                    'Failed to browse:\n${snapshot.error}',
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: _kMuted),
                  ),
                ],
              ),
            );
          }

          final items = snapshot.data ?? [];
          if (items.isEmpty) {
            return const Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.folder_open, size: 48, color: _kMuted),
                  SizedBox(height: 16),
                  Text('Empty folder', style: TextStyle(color: _kMuted)),
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
                  iconColor: _kAccent,
                  name: '..',
                  subtitle: 'Go up',
                  onTap: _goUp,
                );
              }

              final itemIndex = _path != '~' ? index - 1 : index;
              final item = items[itemIndex] as Map<String, dynamic>;
              final type = item['type'] as String? ?? 'file';
              final name = item['name'] as String? ?? '';
              final nextPath =
                  item['absolute'] as String? ?? item['path'] as String? ?? '';

              // Feature 18: Get file status
              final fileStatus = _fileStatusMap?[nextPath];

              return _FileTile(
                icon: type == 'directory'
                    ? Icons.folder_rounded
                    : _getFileIcon(name),
                iconColor: type == 'directory'
                    ? const Color(0xFFFCD34D)
                    : _kMuted,
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
    setState(() {
      _path = nextPath;
      _itemsFuture = _loadItems();
    });
  }

  void _goUp() {
    final parts = _path.split('/').where((p) => p.isNotEmpty).toList();
    if (parts.length <= 1) {
      _navigate('~');
    } else {
      _navigate('/${parts.sublist(0, parts.length - 1).join('/')}');
    }
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
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: _kCard,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: _kBorder),
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
                style: const TextStyle(
                  color: _kOnBackground,
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
          style: const TextStyle(color: _kMuted, fontSize: 12),
        ),
        trailing: const Icon(Icons.chevron_right, color: _kMuted, size: 20),
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
    final (label, color) = switch (status.status) {
      FileStatusType.modified => ('M', _kAccent),
      FileStatusType.added => ('A', _kSuccess),
      FileStatusType.deleted => ('D', _kError),
      FileStatusType.renamed => ('R', const Color(0xFFF59E0B)),
      FileStatusType.copied => ('C', const Color(0xFF818CF8)),
      FileStatusType.untracked => ('?', _kMuted),
      FileStatusType.ignored => ('!', _kMuted),
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
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        margin: const EdgeInsets.only(right: 4, bottom: 4),
        decoration: BoxDecoration(
          color: _kAccent.withValues(alpha: 0.15),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Text(
          label,
          style: const TextStyle(
            color: _kAccent,
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
    return Row(
      children: [
        Icon(icon, color: isSelected ? _kAccent : _kMuted, size: 20),
        const SizedBox(width: 12),
        Text(
          label,
          style: TextStyle(
            color: isSelected ? _kAccent : _kOnBackground,
            fontWeight: isSelected ? FontWeight.w600 : FontWeight.w500,
          ),
        ),
        const Spacer(),
        if (isSelected) const Icon(Icons.check, color: _kAccent, size: 18),
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
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: _kCard,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: _kBorder),
      ),
      child: ListTile(
        onTap: onTap,
        leading: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: _kAccent.withValues(alpha: 0.15),
            borderRadius: BorderRadius.circular(10),
          ),
          child: const Icon(Icons.description, color: _kAccent, size: 20),
        ),
        title: Text(
          filename,
          style: const TextStyle(
            color: _kOnBackground,
            fontSize: 14,
            fontWeight: FontWeight.w500,
          ),
        ),
        subtitle: Text(
          path,
          style: const TextStyle(color: _kMuted, fontSize: 12),
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
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: _kCard,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: _kBorder),
      ),
      child: ListTile(
        onTap: onTap,
        title: Row(
          children: [
            Text(
              result.filename,
              style: const TextStyle(
                color: _kOnBackground,
                fontSize: 14,
                fontWeight: FontWeight.w500,
              ),
            ),
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: _kMuted.withValues(alpha: 0.2),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(
                'L${result.lineNumber}',
                style: const TextStyle(color: _kMuted, fontSize: 11),
              ),
            ),
          ],
        ),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text(
            result.lineText.trim(),
            style: const TextStyle(
              color: _kMuted,
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
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: _kCard,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: _kBorder),
      ),
      child: ListTile(
        onTap: onTap,
        leading: Container(
          width: 36,
          height: 36,
          decoration: BoxDecoration(
            color: _getSymbolColor(result.kind).withValues(alpha: 0.15),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Center(
            child: Text(
              result.icon,
              style: TextStyle(
                color: _getSymbolColor(result.kind),
                fontSize: 16,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ),
        title: Text(
          result.name,
          style: const TextStyle(
            color: _kOnBackground,
            fontSize: 14,
            fontWeight: FontWeight.w500,
          ),
        ),
        subtitle: Text(
          '${result.filename}:${result.line}',
          style: const TextStyle(color: _kMuted, fontSize: 12),
        ),
        trailing: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(
            color: _kMuted.withValues(alpha: 0.2),
            borderRadius: BorderRadius.circular(6),
          ),
          child: Text(
            result.kind,
            style: const TextStyle(color: _kMuted, fontSize: 11),
          ),
        ),
      ),
    );
  }

  Color _getSymbolColor(String kind) {
    switch (kind.toLowerCase()) {
      case 'class':
      case 'interface':
        return const Color(0xFFFCD34D);
      case 'function':
      case 'method':
        return const Color(0xFF818CF8);
      case 'variable':
      case 'field':
      case 'property':
        return _kAccent;
      case 'enum':
      case 'enummember':
        return _kSuccess;
      default:
        return _kMuted;
    }
  }
}

// File viewer screen
class _FileViewerScreen extends StatelessWidget {
  const _FileViewerScreen({
    required this.filePath,
    required this.content,
    required this.isLoading,
    required this.onClose,
  });

  final String filePath;
  final FileContent? content;
  final bool isLoading;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final filename = filePath.split('/').last;
    final language = FileContent.languageFromPath(filePath);

    return Scaffold(
      backgroundColor: _kBackground,
      appBar: AppBar(
        backgroundColor: _kBackground,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded, color: _kOnBackground),
          onPressed: onClose,
        ),
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              filename,
              style: const TextStyle(
                fontSize: 16,
                color: _kOnBackground,
                fontWeight: FontWeight.w600,
              ),
            ),
            Text(
              language,
              style: const TextStyle(fontSize: 12, color: _kMuted),
            ),
          ],
        ),
        actions: [
          if (content != null)
            IconButton(
              icon: const Icon(Icons.copy, color: _kOnBackground),
              onPressed: () {
                Clipboard.setData(ClipboardData(text: content!.content));
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text('Copied to clipboard'),
                    backgroundColor: _kCard,
                  ),
                );
              },
            ),
        ],
      ),
      body: isLoading
          ? const Center(child: CircularProgressIndicator(color: _kAccent))
          : content == null
          ? const Center(
              child: Text(
                'Failed to load file',
                style: TextStyle(color: _kMuted),
              ),
            )
          : _buildContent(),
    );
  }

  Widget _buildContent() {
    if (content!.isImage) {
      return Center(
        child: Container(
          padding: const EdgeInsets.all(20),
          child: const Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.image, size: 64, color: _kMuted),
              SizedBox(height: 16),
              Text(
                'Image preview not available',
                style: TextStyle(color: _kMuted),
              ),
            ],
          ),
        ),
      );
    }

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: _kCard,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: _kBorder),
        ),
        child: SelectableText(
          content!.content,
          style: const TextStyle(
            fontFamily: 'JetBrains Mono',
            fontSize: 13,
            color: _kOnBackground,
            height: 1.6,
          ),
        ),
      ),
    );
  }
}
