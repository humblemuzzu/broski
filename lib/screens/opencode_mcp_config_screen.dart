
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
            connect ? 'Connect failed: ${humanizeError(e)}' : 'Disconnect failed: ${humanizeError(e)}',
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
        builder: (_) => _JsonObjectEditorScreen(title: name, initialJson: json),
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
  IconData _statusIcon(McpServerStatus? status) {
    if (status == null) return AppIcons.cloud;
    if (status.isConnected) return AppIcons.checkCircle;
    if (status.isConnecting) return AppIcons.sync;
    if (status.hasError) return AppIcons.error;
    return AppIcons.pause;
  }
  Color _statusColor(OpenCodeTheme oc, McpServerStatus? status) {
    if (status == null) return oc.textMuted;
    if (status.isConnected) return oc.success;
    if (status.isConnecting) return oc.info;
    if (status.hasError) return oc.error;
    return oc.warning;
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
                Expanded(
                  child: names.isEmpty
                      ? Center(
                          child: Padding(
                            padding: Insets.cardLg,
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(
                                  AppIcons.dns,
                                  color: oc.textMuted,
                                  size: 56,
                                ),
                                SizedBox(height: Spacing.md),
                                Text(
                                  'No MCP servers configured',
                                  style: TextStyle(color: oc.text),
                                ),
                                SizedBox(height: Spacing.sm),
                                Text(
                                  'Tap + to add your first MCP server.',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(color: oc.textMuted),
                                ),
                              ],
                            ),
                          ),
                        )
                      : ListView.builder(
                          padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
                          itemCount: names.length,
                          itemBuilder: (context, idx) {
                            final name = names[idx];
                            final status = _status[name];
                            final isConnected = status?.isConnected ?? false;
                            return Card(
                              color: oc.backgroundElement,
                              margin: const EdgeInsets.only(bottom: 10),
                              shape: RoundedRectangleBorder(
                                borderRadius: Radii.brMd,
                                side: BorderSide(color: oc.border),
                              ),
                              child: ListTile(
                                leading: Icon(
                                  _statusIcon(status),
                                  color: _statusColor(oc, status),
                                ),
                                title: Text(
                                  name,
                                  style: TextStyle(
                                    color: oc.text,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                                subtitle: Text(
                                  status?.statusDisplay ??
                                      'Configured in OpenCode config',
                                  style: TextStyle(color: oc.textMuted),
                                ),
                                trailing: TextButton(
                                  onPressed: status?.isConnecting == true
                                      ? null
                                      : () => _toggleConnection(
                                          name,
                                          !isConnected,
                                        ),
                                  child: Text(
                                    isConnected ? 'Disconnect' : 'Connect',
                                  ),
                                ),
                              ),
                            );
                          },
                        ),
                ),
              ],
            ),
      ),
    );
  }
}
class _JsonObjectEditorScreen extends StatefulWidget {
  const _JsonObjectEditorScreen({
    required this.title,
    required this.initialJson,
  });
  final String title;
  final String initialJson;
  @override
  State<_JsonObjectEditorScreen> createState() =>
      _JsonObjectEditorScreenState();
}
class _JsonObjectEditorScreenState extends State<_JsonObjectEditorScreen> {
  late final TextEditingController _json;
  @override
  void initState() {
    super.initState();
    _json = TextEditingController(text: widget.initialJson);
  }
  @override
  void dispose() {
    _json.dispose();
    super.dispose();
  }
  void _done() {
    try {
      final decoded = jsonDecode(_json.text);
      if (decoded is! Map) {
        throw const FormatException('Config must be a JSON object');
      }
      Navigator.pop(context, decoded.cast<String, dynamic>());
    } catch (e) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('Invalid JSON: ${humanizeError(e)}')));
    }
  }
  @override
  Widget build(BuildContext context) {
    final oc = OpenCodeTheme.of(context);
    return Scaffold(
      backgroundColor: oc.background,
      appBar: AppBar(
        backgroundColor: oc.background,
        elevation: 0,
        title: Text(widget.title, style: TextStyle(color: oc.text)),
        iconTheme: IconThemeData(color: oc.text),
        actions: [
          TextButton(
            onPressed: _done,
            child: Text(
              'Done',
              style: TextStyle(color: oc.primary, fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
      body: AdaptiveContainer(
        width: ContentWidth.standard,
        child: Padding(
        padding: Insets.card,
        child: TextField(
          controller: _json,
          maxLines: null,
          expands: true,
          style: AppTypography.code(),
          decoration: InputDecoration(
            filled: true,
            fillColor: oc.backgroundElement,
            border: OutlineInputBorder(
              borderRadius: Radii.brMd,
              borderSide: BorderSide(color: oc.border),
            ),
          ),
        ),
      ),
      ),
    );
  }
}
