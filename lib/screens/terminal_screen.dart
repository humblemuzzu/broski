import 'package:flutter/material.dart';
import '../theme/app_typography.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/agent_type.dart';
import '../providers/agent_type_provider.dart';
import '../providers/connection_provider.dart';
import '../providers/service_providers.dart';
import '../providers/selection_provider.dart';
import '../services/storage_service.dart';
import '../theme/design_tokens.dart';
import '../theme/opencode_theme.dart';
import '../widgets/chat/detail_sheet.dart';
import '../widgets/connection_indicator.dart';
import 'terminal_view_screen.dart';

/// PTY Terminal Sessions Screen
///
/// Manages PTY terminal sessions - allows creating, viewing, and managing
/// terminal sessions that run on the remote machine.
class TerminalScreen extends ConsumerStatefulWidget {
  const TerminalScreen({super.key});

  @override
  ConsumerState<TerminalScreen> createState() => _TerminalScreenState();
}

class _TerminalScreenState extends ConsumerState<TerminalScreen> {
  List<Map<String, dynamic>> _ptySessions = [];
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadSessions();
  }

  Future<void> _loadSessions() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    final storage = StorageService();
    final connection = ref.read(connectionProvider);

    // If offline, use cached data
    if (connection.isOfflineMode) {
      final cached = await storage.getCachedPtySessions();
      if (mounted) {
        setState(() {
          _ptySessions = cached;
          _isLoading = false;
          if (cached.isEmpty) {
            _error = 'No cached terminal sessions available offline';
          }
        });
      }
      return;
    }

    try {
      final bridge = ref.read(bridgeServiceProvider);
      final selection = ref.read(selectionProvider);
      final sessions = await bridge.listPty(
        projectPath: selection.project?.path,
      );

      // Cache for offline use
      if (sessions.isNotEmpty) {
        await storage.cachePtySessions(sessions);
      }

      if (mounted) {
        setState(() {
          _ptySessions = sessions;
          _isLoading = false;
        });
      }
    } catch (e) {
      // On error, try to use cached data
      final cached = await storage.getCachedPtySessions();
      if (mounted) {
        if (cached.isNotEmpty) {
          setState(() {
            _ptySessions = cached;
            _isLoading = false;
          });
        } else {
          setState(() {
            _error = e.toString();
            _isLoading = false;
          });
        }
      }
    }
  }

  Future<void> _createSession() async {
    final result = await showDialog<Map<String, String?>>(
      context: context,
      builder: (context) => const _CreatePtyDialog(),
    );

    if (result == null) return;

    try {
      final bridge = ref.read(bridgeServiceProvider);
      final selection = ref.read(selectionProvider);
      final pty = await bridge.createPty(
        command: result['command'],
        title: result['title'],
        cwd: result['cwd'],
        projectPath: selection.project?.path,
      );

      if (pty != null && mounted) {
        final ocTheme = OpenCodeTheme.of(context);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Created terminal: ${pty['title'] ?? 'Terminal'}'),
            backgroundColor: ocTheme.backgroundPanel,
          ),
        );
        _loadSessions();
      }
    } catch (e) {
      if (mounted) {
        final ocTheme = OpenCodeTheme.of(context);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to create terminal: $e'),
            backgroundColor: ocTheme.error,
          ),
        );
      }
    }
  }

  Future<void> _deleteSession(String ptyId, String title) async {
    final ocTheme = OpenCodeTheme.of(context);
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) {
        final dialogTheme = OpenCodeTheme.of(context);
        return AlertDialog(
          backgroundColor: dialogTheme.backgroundPanel,
          title: Text(
            'Delete Terminal?',
            style: TextStyle(color: dialogTheme.text),
          ),
          content: Text(
            'Delete "$title"? This will terminate any running processes.',
            style: TextStyle(color: dialogTheme.textMuted),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel'),
            ),
            TextButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text('Delete', style: TextStyle(color: dialogTheme.error)),
            ),
          ],
        );
      },
    );

    if (confirm != true) return;

    try {
      final bridge = ref.read(bridgeServiceProvider);
      final selection = ref.read(selectionProvider);
      final success = await bridge.deletePty(
        ptyId,
        projectPath: selection.project?.path,
      );

      if (mounted) {
        if (success) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: const Text('Terminal deleted'),
              backgroundColor: ocTheme.backgroundPanel,
            ),
          );
          await _loadSessions();
        } else {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: const Text('Failed to delete terminal'),
              backgroundColor: ocTheme.error,
            ),
          );
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to delete terminal: $e'),
            backgroundColor: ocTheme.error,
          ),
        );
      }
    }
  }

  Future<void> _renameSession(String ptyId, String currentTitle) async {
    final controller = TextEditingController(text: currentTitle);
    final newTitle = await showDialog<String>(
      context: context,
      builder: (context) {
        final dialogTheme = OpenCodeTheme.of(context);
        return AlertDialog(
          backgroundColor: dialogTheme.backgroundPanel,
          title: Text(
            'Rename Terminal',
            style: TextStyle(color: dialogTheme.text),
          ),
          content: TextField(
            controller: controller,
            autofocus: true,
            style: TextStyle(color: dialogTheme.text),
            decoration: InputDecoration(
              hintText: 'Terminal name',
              hintStyle: TextStyle(color: dialogTheme.textMuted),
              filled: true,
              fillColor: dialogTheme.background,
              border: OutlineInputBorder(
                borderRadius: Radii.brMd,
                borderSide: BorderSide(color: dialogTheme.borderSubtle),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: Radii.brMd,
                borderSide: BorderSide(color: dialogTheme.borderSubtle),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: Radii.brMd,
                borderSide: BorderSide(color: dialogTheme.primary),
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel'),
            ),
            TextButton(
              onPressed: () => Navigator.pop(context, controller.text.trim()),
              child: const Text('Save'),
            ),
          ],
        );
      },
    );
    controller.dispose();

    if (newTitle == null || newTitle.isEmpty || newTitle == currentTitle) {
      return;
    }

    try {
      final bridge = ref.read(bridgeServiceProvider);
      final selection = ref.read(selectionProvider);
      await bridge.updatePty(
        ptyId,
        title: newTitle,
        projectPath: selection.project?.path,
      );
      await _loadSessions();
    } catch (e) {
      if (mounted) {
        final ocTheme = OpenCodeTheme.of(context);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to rename terminal: $e'),
            backgroundColor: ocTheme.error,
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final connection = ref.watch(connectionProvider);
    final agentType = ref.watch(agentTypeProvider);
    final ocTheme = OpenCodeTheme.of(context);

    final agentAvailable =
        connection.backends?.forType(agentType).available ??
        (agentType == AgentType.opencode ? connection.opencodeRunning : true);

    return Scaffold(
      backgroundColor: ocTheme.background,
      appBar: AppBar(
        backgroundColor: ocTheme.background,
        elevation: 0,
        title: Text(
          'Terminals',
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w600,
            color: ocTheme.text,
          ),
        ),
        actions: [
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
      body: _buildBody(ocTheme),
      floatingActionButton: FloatingActionButton(
        onPressed: _createSession,
        backgroundColor: ocTheme.primary,
        child: Icon(Icons.add, color: ocTheme.selectedListItemText),
      ),
    );
  }

  Widget _buildBody(OpenCodeTheme ocTheme) {
    if (_isLoading) {
      return Center(child: CircularProgressIndicator(color: ocTheme.primary));
    }

    if (_error != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.error_outline, size: 48, color: ocTheme.error),
            SizedBox(height: Spacing.lg),
            Text(
              'Failed to load terminals',
              style: TextStyle(color: ocTheme.text, fontSize: 16),
            ),
            SizedBox(height: Spacing.sm),
            Text(
              _error!,
              style: TextStyle(color: ocTheme.textMuted, fontSize: 14),
              textAlign: TextAlign.center,
            ),
            SizedBox(height: Spacing.xl),
            ElevatedButton(
              onPressed: _loadSessions,
              style: ElevatedButton.styleFrom(
                backgroundColor: ocTheme.primary,
                foregroundColor: ocTheme.selectedListItemText,
              ),
              child: const Text('Retry'),
            ),
          ],
        ),
      );
    }

    if (_ptySessions.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.terminal, size: 64, color: ocTheme.textMuted),
            SizedBox(height: Spacing.xl),
            Text(
              'No Terminals',
              style: TextStyle(
                color: ocTheme.text,
                fontSize: 18,
                fontWeight: FontWeight.w600,
              ),
            ),
            SizedBox(height: Spacing.sm),
            Text(
              'Create a terminal to run commands\non your remote machine',
              style: TextStyle(color: ocTheme.textMuted, fontSize: 14),
              textAlign: TextAlign.center,
            ),
            SizedBox(height: Spacing.xxl),
            ElevatedButton.icon(
              onPressed: _createSession,
              icon: const Icon(Icons.add, size: 20),
              label: const Text('New Terminal'),
              style: ElevatedButton.styleFrom(
                backgroundColor: ocTheme.primary,
                foregroundColor: ocTheme.selectedListItemText,
                padding: const EdgeInsets.symmetric(
                  horizontal: 24,
                  vertical: 12,
                ),
              ),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _loadSessions,
      color: ocTheme.primary,
      child: ListView.builder(
        padding: Insets.card,
        itemCount: _ptySessions.length,
        itemBuilder: (context, index) {
          final pty = _ptySessions[index];
          return _PtySessionTile(
            pty: pty,
            onTap: () => _openTerminal(pty),
            onLongPress: () => _showSessionDetails(pty),
            onRename: () => _renameSession(
              pty['id'] as String? ?? '',
              pty['title'] as String? ?? 'Terminal',
            ),
            onDelete: () => _deleteSession(
              pty['id'] as String? ?? '',
              pty['title'] as String? ?? 'Terminal',
            ),
          );
        },
      ),
    );
  }

  void _openTerminal(Map<String, dynamic> pty) {
    final id = pty['id'] as String? ?? '';
    final title = pty['title'] as String? ?? 'Terminal';
    final status = pty['status'] as String? ?? 'unknown';

    if (status != 'running') {
      final ocTheme = OpenCodeTheme.of(context);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Terminal has exited'),
          backgroundColor: ocTheme.warning,
        ),
      );
      return;
    }

    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) => TerminalViewScreen(ptyId: id, title: title),
      ),
    );
  }

  void _showSessionDetails(Map<String, dynamic> pty) {
    final id = pty['id'] as String? ?? '';
    final title = pty['title'] as String? ?? 'Terminal';
    final command = pty['command'] as String? ?? '';
    final cwd = pty['cwd'] as String? ?? '';
    final status = pty['status'] as String? ?? 'unknown';
    final pid = pty['pid'] as int? ?? 0;

    final ocTheme = OpenCodeTheme.of(context);

    DetailSheet.show(
      context: context,
      title: title,
      initialSize: 0.4,
      child: Padding(
        padding: Insets.screenAll,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: Insets.cardSm,
                  decoration: BoxDecoration(
                    color: ocTheme.primary.withValues(alpha: 0.15),
                    borderRadius: Radii.brMd,
                  ),
                  child: Icon(Icons.terminal, color: ocTheme.primary, size: 24),
                ),
                SizedBox(width: Spacing.lg),
                Row(
                  children: [
                    Container(
                      width: 8,
                      height: 8,
                      decoration: BoxDecoration(
                        color: status == 'running'
                            ? ocTheme.success
                            : ocTheme.textMuted,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Text(
                      status == 'running' ? 'Running' : 'Exited',
                      style: TextStyle(color: ocTheme.textMuted, fontSize: 14),
                    ),
                  ],
                ),
              ],
            ),
            SizedBox(height: Spacing.xxl),
            _DetailRow(label: 'ID', value: id),
            _DetailRow(
              label: 'Command',
              value: command.isEmpty ? '-' : command,
            ),
            _DetailRow(
              label: 'Working Directory',
              value: cwd.isEmpty ? '-' : cwd,
            ),
            _DetailRow(label: 'PID', value: pid > 0 ? pid.toString() : '-'),
            SizedBox(height: Spacing.xxl),
            if (status == 'running')
              Padding(
                padding: Insets.bottomMd,
                child: SizedBox(
                  width: double.infinity,
                  child: ElevatedButton.icon(
                    onPressed: () {
                      Navigator.pop(context);
                      _openTerminal(pty);
                    },
                    icon: const Icon(Icons.open_in_new, size: 18),
                    label: const Text('Open Terminal'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: ocTheme.primary,
                      foregroundColor: ocTheme.selectedListItemText,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                  ),
                ),
              ),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () {
                      Navigator.pop(context);
                      _renameSession(id, title);
                    },
                    icon: const Icon(Icons.edit, size: 18),
                    label: const Text('Rename'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: ocTheme.text,
                      side: BorderSide(color: ocTheme.borderSubtle),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                  ),
                ),
                SizedBox(width: Spacing.md),
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: () {
                      Navigator.pop(context);
                      _deleteSession(id, title);
                    },
                    icon: const Icon(Icons.delete_outline, size: 18),
                    label: const Text('Delete'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: ocTheme.error,
                      foregroundColor: ocTheme.selectedListItemText,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _PtySessionTile extends StatelessWidget {
  const _PtySessionTile({
    required this.pty,
    required this.onTap,
    required this.onRename,
    required this.onDelete,
    this.onLongPress,
  });

  final Map<String, dynamic> pty;
  final VoidCallback onTap;
  final VoidCallback? onLongPress;
  final VoidCallback onRename;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final title = pty['title'] as String? ?? 'Terminal';
    final status = pty['status'] as String? ?? 'unknown';
    final command = pty['command'] as String? ?? '';
    final cwd = pty['cwd'] as String? ?? '';

    final isRunning = status == 'running';
    final statusColor = isRunning ? ocTheme.success : ocTheme.textMuted;

    return Container(
      margin: Insets.bottomMd,
      decoration: BoxDecoration(
        color: ocTheme.backgroundPanel,
        borderRadius: Radii.brLg,
        border: Border.all(color: ocTheme.borderSubtle),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          onLongPress: onLongPress,
          borderRadius: Radii.brLg,
          child: Padding(
            padding: Insets.card,
            child: Row(
              children: [
                // Terminal icon with status
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: statusColor.withValues(alpha: 0.15),
                    borderRadius: Radii.brMd,
                  ),
                  child: Stack(
                    children: [
                      Center(
                        child: Icon(
                          Icons.terminal,
                          color: statusColor,
                          size: 24,
                        ),
                      ),
                      Positioned(
                        right: 4,
                        bottom: 4,
                        child: Container(
                          width: 10,
                          height: 10,
                          decoration: BoxDecoration(
                            color: statusColor,
                            shape: BoxShape.circle,
                            border: Border.all(
                              color: ocTheme.backgroundPanel,
                              width: 2,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                SizedBox(width: Spacing.lg),
                // Title and info
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                          color: ocTheme.text,
                        ),
                      ),
                      SizedBox(height: Spacing.xs),
                      Text(
                        command.isNotEmpty
                            ? command
                            : (cwd.isNotEmpty ? cwd : 'Shell'),
                        style: TextStyle(
                          fontSize: 13,
                          color: ocTheme.textMuted,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
                // Actions
                PopupMenuButton<String>(
                  icon: Icon(Icons.more_vert, color: ocTheme.textMuted),
                  color: ocTheme.backgroundPanel,
                  shape: RoundedRectangleBorder(
                    borderRadius: Radii.brMd,
                  ),
                  onSelected: (value) {
                    switch (value) {
                      case 'rename':
                        onRename();
                        break;
                      case 'delete':
                        onDelete();
                        break;
                    }
                  },
                  itemBuilder: (context) {
                    final menuTheme = OpenCodeTheme.of(context);
                    return [
                      PopupMenuItem(
                        value: 'rename',
                        child: Row(
                          children: [
                            Icon(Icons.edit, size: 20, color: menuTheme.text),
                            SizedBox(width: Spacing.md),
                            const Text('Rename'),
                          ],
                        ),
                      ),
                      PopupMenuItem(
                        value: 'delete',
                        child: Row(
                          children: [
                            Icon(
                              Icons.delete_outline,
                              size: 20,
                              color: menuTheme.error,
                            ),
                            SizedBox(width: Spacing.md),
                            Text(
                              'Delete',
                              style: TextStyle(color: menuTheme.error),
                            ),
                          ],
                        ),
                      ),
                    ];
                  },
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return Padding(
      padding: Insets.bottomMd,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 140,
            child: Text(
              label,
              style: TextStyle(color: ocTheme.textMuted, fontSize: 14),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: TextStyle(
                color: ocTheme.text,
                fontSize: 14,
                fontFamily: AppTypography.codeFontFamily,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _CreatePtyDialog extends StatefulWidget {
  const _CreatePtyDialog();

  @override
  State<_CreatePtyDialog> createState() => _CreatePtyDialogState();
}

class _CreatePtyDialogState extends State<_CreatePtyDialog> {
  final _titleController = TextEditingController(text: 'Terminal');
  final _commandController = TextEditingController();
  final _cwdController = TextEditingController();

  @override
  void dispose() {
    _titleController.dispose();
    _commandController.dispose();
    _cwdController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return AlertDialog(
      backgroundColor: ocTheme.backgroundPanel,
      title: Text('New Terminal', style: TextStyle(color: ocTheme.text)),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            _buildTextField(
              controller: _titleController,
              label: 'Title',
              hint: 'e.g., Dev Server',
              ocTheme: ocTheme,
            ),
            SizedBox(height: Spacing.lg),
            _buildTextField(
              controller: _commandController,
              label: 'Command (optional)',
              hint: 'e.g., npm run dev',
              ocTheme: ocTheme,
            ),
            SizedBox(height: Spacing.lg),
            _buildTextField(
              controller: _cwdController,
              label: 'Working Directory (optional)',
              hint: 'e.g., /path/to/project',
              ocTheme: ocTheme,
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        ElevatedButton(
          onPressed: () {
            final result = <String, String?>{
              'title': _titleController.text.trim().isEmpty
                  ? 'Terminal'
                  : _titleController.text.trim(),
              'command': _commandController.text.trim().isEmpty
                  ? null
                  : _commandController.text.trim(),
              'cwd': _cwdController.text.trim().isEmpty
                  ? null
                  : _cwdController.text.trim(),
            };
            Navigator.pop(context, result);
          },
          style: ElevatedButton.styleFrom(
            backgroundColor: ocTheme.primary,
            foregroundColor: ocTheme.selectedListItemText,
          ),
          child: const Text('Create'),
        ),
      ],
    );
  }

  Widget _buildTextField({
    required TextEditingController controller,
    required String label,
    required String hint,
    required OpenCodeTheme ocTheme,
  }) {
    return TextField(
      controller: controller,
      style: TextStyle(color: ocTheme.text),
      decoration: InputDecoration(
        labelText: label,
        labelStyle: TextStyle(color: ocTheme.textMuted),
        hintText: hint,
        hintStyle: TextStyle(color: ocTheme.textMuted),
        filled: true,
        fillColor: ocTheme.background,
        border: OutlineInputBorder(
          borderRadius: Radii.brMd,
          borderSide: BorderSide(color: ocTheme.borderSubtle),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: Radii.brMd,
          borderSide: BorderSide(color: ocTheme.borderSubtle),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: Radii.brMd,
          borderSide: BorderSide(color: ocTheme.primary),
        ),
      ),
    );
  }
}
