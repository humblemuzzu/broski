import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../theme/app_typography.dart';
import '../theme/design_tokens.dart';

import '../models/mcp.dart';
import '../providers/selection_provider.dart';
import '../providers/service_providers.dart';
import '../theme/opencode_theme.dart';
import '../utils/responsive.dart';
import '../widgets/adaptive_container.dart';
import 'package:broski/theme/app_icons.dart';
import '../utils/error_utils.dart';
import 'opencode/opencode_session_behavior_card.dart';
import 'opencode/opencode_mcp_server_card.dart';
import 'opencode/opencode_mcp_auth_card.dart';

class OpenCodeMcpConfigScreen extends ConsumerStatefulWidget {
  const OpenCodeMcpConfigScreen({super.key});
  @override
  ConsumerState<OpenCodeMcpConfigScreen> createState() =>
      _OpenCodeMcpConfigScreenState();
}

class _OpenCodeMcpConfigScreenState
    extends ConsumerState<OpenCodeMcpConfigScreen> {
  bool _loading = true;
  bool _loadingStatus = false;
  String? _error;
  Map<String, dynamic> _config = const {};
  Map<String, McpServerStatus> _status = const {};
  bool _savingSessionBehavior = false;
  @override
  void initState() {
    super.initState();
    _load();
  }

  String? get _projectPath => ref.read(selectionProvider).project?.path;
  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final cfg = await bridge.getConfig(projectPath: _projectPath);
      final status = await bridge.getMcpStatus(projectPath: _projectPath);
      if (!mounted) return;
      setState(() {
        _config = cfg;
        _status = status;
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

  Map<String, dynamic> _mcp() {
    final m = _config['mcp'];
    if (m is Map) return m.cast<String, dynamic>();
    return {};
  }

  Map<String, dynamic> _compaction() {
    final c = _config['compaction'];
    if (c is Map) return c.cast<String, dynamic>();
    return {};
  }

  bool get _autoCompactionEnabled => _compaction()['auto'] as bool? ?? true;
  bool get _pruneCompactionEnabled => _compaction()['prune'] as bool? ?? true;

  String get _shareMode {
    final share = _config['share'];
    if (share is String && {'manual', 'auto', 'disabled'}.contains(share)) {
      return share;
    }
    final legacyAutoShare = _config['autoshare'];
    if (legacyAutoShare is bool) {
      return legacyAutoShare ? 'auto' : 'manual';
    }
    return 'manual';
  }

  Future<void> _updateSessionBehavior({
    bool? autoCompaction,
    bool? pruneCompaction,
    String? shareMode,
  }) async {
    if (_savingSessionBehavior) return;
    setState(() => _savingSessionBehavior = true);
    final oc = OpenCodeTheme.of(context);

    final nextCompaction = <String, dynamic>{
      ..._compaction(),
      if (autoCompaction != null) 'auto': autoCompaction,
      if (pruneCompaction != null) 'prune': pruneCompaction,
    };

    final patch = <String, dynamic>{
      'compaction': nextCompaction,
      if (shareMode != null) 'share': shareMode,
    };

    try {
      final bridge = ref.read(bridgeServiceProvider);
      final updated = await bridge.setConfig(patch, projectPath: _projectPath);
      if (!mounted) return;
      setState(() {
        _config = updated.isNotEmpty
            ? updated
            : <String, dynamic>{..._config, ...patch};
      });
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Failed to update settings: ${humanizeError(e)}'),
          backgroundColor: oc.error,
        ),
      );
    } finally {
      if (mounted) {
        setState(() => _savingSessionBehavior = false);
      }
    }
  }

  Future<void> _restart() async {
    final oc = OpenCodeTheme.of(context);
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final ok = await bridge.restartOpenCode();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(ok ? 'OpenCode restarted' : 'Restart failed'),
          backgroundColor: ok ? oc.backgroundPanel : oc.error,
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Restart failed: ${humanizeError(e)}'),
          backgroundColor: oc.error,
        ),
      );
    }
  }

  Future<void> _refreshStatus() async {
    setState(() => _loadingStatus = true);
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final status = await bridge.getMcpStatus(projectPath: _projectPath);
      if (!mounted) return;
      setState(() {
        _status = status;
        _loadingStatus = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loadingStatus = false);
    }
  }

  Future<void> _startMcpAuth(String name) async {
    final bridge = ref.read(bridgeServiceProvider);
    final ok = await startMcpAuth(
      context: context,
      bridge: bridge,
      name: name,
      projectPath: _projectPath,
    );
    if (ok && mounted) await _refreshStatus();
  }

  Future<void> _toggleConnection(String name, bool connect) async {
    final oc = OpenCodeTheme.of(context);
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final ok = connect
          ? await bridge.connectMcp(name, projectPath: _projectPath)
          : await bridge.disconnectMcp(name, projectPath: _projectPath);
      if (!mounted) return;
      if (!ok) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              connect
                  ? 'Failed to connect "$name"'
                  : 'Failed to disconnect "$name"',
            ),
            backgroundColor: oc.error,
          ),
        );
      }
      await _refreshStatus();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            connect
                ? 'Connect failed: ${humanizeError(e)}'
                : 'Disconnect failed: ${humanizeError(e)}',
          ),
          backgroundColor: oc.error,
        ),
      );
    }
  }

  Future<void> _addServer() async {
    final nameController = TextEditingController();
    final name = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Add MCP server'),
        content: TextField(
          controller: nameController,
          decoration: const InputDecoration(hintText: 'server name'),
          autofocus: true,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, nameController.text.trim()),
            child: const Text('Next'),
          ),
        ],
      ),
    );
    if (name == null || name.isEmpty) return;
    if (!mounted) return;
    final json = const JsonEncoder.withIndent('  ').convert({
      'type': 'local',
      'command': ['echo', 'TODO'],
      'enabled': false,
    });
    final cfg = await Navigator.push<Map<String, dynamic>>(
      context,
      MaterialPageRoute(
        builder: (_) => JsonObjectEditorScreen(title: name, initialJson: json),
      ),
    );
    if (cfg == null) return;
    if (!mounted) return;
    final oc = OpenCodeTheme.of(context);
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final updated = await bridge.addMcpServer(
        name: name,
        config: cfg,
        projectPath: _projectPath,
      );
      if (!mounted) return;
      setState(() {
        _status = updated;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Added MCP server "$name"'),
          backgroundColor: oc.backgroundPanel,
        ),
      );
      await _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Failed to add server: ${humanizeError(e)}'),
          backgroundColor: oc.error,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final oc = OpenCodeTheme.of(context);
    final mcp = _mcp();
    final names = mcp.keys.toList()..sort();
    return Scaffold(
      backgroundColor: oc.background,
      appBar: AppBar(
        backgroundColor: oc.background,
        elevation: 0,
        title: Text('MCP Config', style: TextStyle(color: oc.text)),
        iconTheme: IconThemeData(color: oc.text),
        actions: [
          IconButton(
            icon: const Icon(AppIcons.add),
            tooltip: 'Add MCP server',
            onPressed: _addServer,
          ),
          IconButton(
            icon: _loadingStatus
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(AppIcons.refresh),
            onPressed: _loadingStatus ? null : _load,
          ),
        ],
      ),
      body: AdaptiveContainer(
        width: ContentWidth.standard,
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
            ? Center(
                child: Padding(
                  padding: Insets.cardLg,
                  child: Text(_error!, style: TextStyle(color: oc.textMuted)),
                ),
              )
            : Column(
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            'View and control MCP servers. Add new servers from mobile and manage connection status.',
                            style: AppTypography.label(color: oc.textMuted),
                          ),
                        ),
                        TextButton.icon(
                          onPressed: _restart,
                          icon: const Icon(AppIcons.restart, size: 18),
                          label: const Text('Restart'),
                        ),
                      ],
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
                    child: OpenCodeSessionBehaviorCard(
                      autoCompaction: _autoCompactionEnabled,
                      pruneCompaction: _pruneCompactionEnabled,
                      shareMode: _shareMode,
                      saving: _savingSessionBehavior,
                      onAutoCompactionChanged: (value) =>
                          _updateSessionBehavior(autoCompaction: value),
                      onPruneCompactionChanged: (value) =>
                          _updateSessionBehavior(pruneCompaction: value),
                      onShareModeChanged: (value) =>
                          _updateSessionBehavior(shareMode: value),
                    ),
                  ),
                  Expanded(
                    child: OpenCodeMcpServerList(
                      names: names,
                      status: _status,
                      onToggleConnection: _toggleConnection,
                      onStartAuth: _startMcpAuth,
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}
