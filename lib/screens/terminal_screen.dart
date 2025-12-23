import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

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

    try {
      final bridge = ref.read(bridgeServiceProvider);
      final selection = ref.read(selectionProvider);
      final sessions = await bridge.listPty(
        projectPath: selection.project?.path,
      );
      if (mounted) {
        setState(() {
          _ptySessions = sessions;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _isLoading = false;
        });
      }
    }
  }

  Future<void> _createSession() async {
    final result = await showDialog<Map<String, String>>(
      context: context,
      builder: (context) => _CreatePtyDialog(),
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
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Created terminal: ${pty['title'] ?? 'Terminal'}'),
            backgroundColor: _kCard,
          ),
        );
        _loadSessions();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to create terminal: $e'),
            backgroundColor: _kError,
          ),
        );
      }
    }
  }

  Future<void> _deleteSession(String ptyId, String title) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: _kCard,
        title: const Text(
          'Delete Terminal?',
          style: TextStyle(color: _kOnBackground),
        ),
        content: Text(
          'Delete "$title"? This will terminate any running processes.',
          style: const TextStyle(color: _kMuted),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete', style: TextStyle(color: _kError)),
          ),
        ],
      ),
    );

    if (confirm != true) return;

    try {
      final bridge = ref.read(bridgeServiceProvider);
      final selection = ref.read(selectionProvider);
      final success = await bridge.deletePty(
        ptyId,
        projectPath: selection.project?.path,
      );

      if (success && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Terminal deleted'),
            backgroundColor: _kCard,
          ),
        );
        _loadSessions();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to delete terminal: $e'),
            backgroundColor: _kError,
          ),
        );
      }
    }
  }

  Future<void> _renameSession(String ptyId, String currentTitle) async {
    final controller = TextEditingController(text: currentTitle);
    final newTitle = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: _kCard,
        title: const Text(
          'Rename Terminal',
          style: TextStyle(color: _kOnBackground),
        ),
        content: TextField(
          controller: controller,
          autofocus: true,
          style: const TextStyle(color: _kOnBackground),
          decoration: InputDecoration(
            hintText: 'Terminal name',
            hintStyle: const TextStyle(color: _kMuted),
            filled: true,
            fillColor: _kBackground,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: const BorderSide(color: _kBorder),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: const BorderSide(color: _kBorder),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: const BorderSide(color: _kAccent),
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
      ),
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
      _loadSessions();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to rename terminal: $e'),
            backgroundColor: _kError,
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final connection = ref.watch(connectionProvider);

    return Scaffold(
      backgroundColor: _kBackground,
      appBar: AppBar(
        backgroundColor: _kBackground,
        elevation: 0,
        title: const Text(
          'Terminals',
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w600,
            color: _kOnBackground,
          ),
        ),
        actions: [
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
      body: _buildBody(),
      floatingActionButton: FloatingActionButton(
        onPressed: _createSession,
        backgroundColor: _kAccent,
        child: const Icon(Icons.add, color: Colors.white),
      ),
    );
  }

  Widget _buildBody() {
    if (_isLoading) {
      return const Center(child: CircularProgressIndicator(color: _kAccent));
    }

    if (_error != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, size: 48, color: _kError),
            const SizedBox(height: 16),
            Text(
              'Failed to load terminals',
              style: const TextStyle(color: _kOnBackground, fontSize: 16),
            ),
            const SizedBox(height: 8),
            Text(
              _error!,
              style: const TextStyle(color: _kMuted, fontSize: 14),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 20),
            ElevatedButton(
              onPressed: _loadSessions,
              style: ElevatedButton.styleFrom(
                backgroundColor: _kAccent,
                foregroundColor: Colors.white,
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
            const Icon(Icons.terminal, size: 64, color: _kMuted),
            const SizedBox(height: 20),
            const Text(
              'No Terminals',
              style: TextStyle(
                color: _kOnBackground,
                fontSize: 18,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'Create a terminal to run commands\non your remote machine',
              style: TextStyle(color: _kMuted, fontSize: 14),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            ElevatedButton.icon(
              onPressed: _createSession,
              icon: const Icon(Icons.add, size: 20),
              label: const Text('New Terminal'),
              style: ElevatedButton.styleFrom(
                backgroundColor: _kAccent,
                foregroundColor: Colors.white,
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
      color: _kAccent,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: _ptySessions.length,
        itemBuilder: (context, index) {
          final pty = _ptySessions[index];
          return _PtySessionTile(
            pty: pty,
            onTap: () => _showSessionDetails(pty),
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

  void _showSessionDetails(Map<String, dynamic> pty) {
    final id = pty['id'] as String? ?? '';
    final title = pty['title'] as String? ?? 'Terminal';
    final command = pty['command'] as String? ?? '';
    final cwd = pty['cwd'] as String? ?? '';
    final status = pty['status'] as String? ?? 'unknown';
    final pid = pty['pid'] as int? ?? 0;

    showModalBottomSheet(
      context: context,
      backgroundColor: _kCard,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) => Container(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: _kAccent.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(Icons.terminal, color: _kAccent, size: 24),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w600,
                          color: _kOnBackground,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          Container(
                            width: 8,
                            height: 8,
                            decoration: BoxDecoration(
                              color: status == 'running' ? _kSuccess : _kMuted,
                              shape: BoxShape.circle,
                            ),
                          ),
                          const SizedBox(width: 6),
                          Text(
                            status == 'running' ? 'Running' : 'Exited',
                            style: const TextStyle(
                              color: _kMuted,
                              fontSize: 14,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 24),
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
            const SizedBox(height: 24),
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
                      foregroundColor: _kOnBackground,
                      side: const BorderSide(color: _kBorder),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: () {
                      Navigator.pop(context);
                      _deleteSession(id, title);
                    },
                    icon: const Icon(Icons.delete_outline, size: 18),
                    label: const Text('Delete'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: _kError,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
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
  });

  final Map<String, dynamic> pty;
  final VoidCallback onTap;
  final VoidCallback onRename;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final title = pty['title'] as String? ?? 'Terminal';
    final status = pty['status'] as String? ?? 'unknown';
    final command = pty['command'] as String? ?? '';
    final cwd = pty['cwd'] as String? ?? '';

    final isRunning = status == 'running';

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: _kCard,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _kBorder),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(16),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                // Terminal icon with status
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: (isRunning ? _kSuccess : _kMuted).withValues(
                      alpha: 0.15,
                    ),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Stack(
                    children: [
                      Center(
                        child: Icon(
                          Icons.terminal,
                          color: isRunning ? _kSuccess : _kMuted,
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
                            color: isRunning ? _kSuccess : _kMuted,
                            shape: BoxShape.circle,
                            border: Border.all(color: _kCard, width: 2),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 16),
                // Title and info
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                          color: _kOnBackground,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        command.isNotEmpty
                            ? command
                            : (cwd.isNotEmpty ? cwd : 'Shell'),
                        style: const TextStyle(fontSize: 13, color: _kMuted),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
                // Actions
                PopupMenuButton<String>(
                  icon: const Icon(Icons.more_vert, color: _kMuted),
                  color: _kCard,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
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
                  itemBuilder: (context) => [
                    const PopupMenuItem(
                      value: 'rename',
                      child: Row(
                        children: [
                          Icon(Icons.edit, size: 20, color: _kOnBackground),
                          SizedBox(width: 12),
                          Text('Rename'),
                        ],
                      ),
                    ),
                    const PopupMenuItem(
                      value: 'delete',
                      child: Row(
                        children: [
                          Icon(Icons.delete_outline, size: 20, color: _kError),
                          SizedBox(width: 12),
                          Text('Delete', style: TextStyle(color: _kError)),
                        ],
                      ),
                    ),
                  ],
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
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 140,
            child: Text(
              label,
              style: const TextStyle(color: _kMuted, fontSize: 14),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(
                color: _kOnBackground,
                fontSize: 14,
                fontFamily: 'JetBrains Mono',
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _CreatePtyDialog extends StatefulWidget {
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
    return AlertDialog(
      backgroundColor: _kCard,
      title: const Text(
        'New Terminal',
        style: TextStyle(color: _kOnBackground),
      ),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            _buildTextField(
              controller: _titleController,
              label: 'Title',
              hint: 'e.g., Dev Server',
            ),
            const SizedBox(height: 16),
            _buildTextField(
              controller: _commandController,
              label: 'Command (optional)',
              hint: 'e.g., npm run dev',
            ),
            const SizedBox(height: 16),
            _buildTextField(
              controller: _cwdController,
              label: 'Working Directory (optional)',
              hint: 'e.g., /path/to/project',
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
            Navigator.pop(context, {
              'title': _titleController.text.trim().isEmpty
                  ? 'Terminal'
                  : _titleController.text.trim(),
              'command': _commandController.text.trim().isEmpty
                  ? null
                  : _commandController.text.trim(),
              'cwd': _cwdController.text.trim().isEmpty
                  ? null
                  : _cwdController.text.trim(),
            });
          },
          style: ElevatedButton.styleFrom(
            backgroundColor: _kAccent,
            foregroundColor: Colors.white,
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
  }) {
    return TextField(
      controller: controller,
      style: const TextStyle(color: _kOnBackground),
      decoration: InputDecoration(
        labelText: label,
        labelStyle: const TextStyle(color: _kMuted),
        hintText: hint,
        hintStyle: const TextStyle(color: _kMuted),
        filled: true,
        fillColor: _kBackground,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: _kBorder),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: _kBorder),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: _kAccent),
        ),
      ),
    );
  }
}
