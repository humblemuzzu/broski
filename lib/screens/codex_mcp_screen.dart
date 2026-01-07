import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/service_providers.dart';
import '../theme/opencode_theme.dart';

class CodexMcpScreen extends ConsumerStatefulWidget {
  const CodexMcpScreen({super.key});

  @override
  ConsumerState<CodexMcpScreen> createState() => _CodexMcpScreenState();
}

class _CodexMcpScreenState extends ConsumerState<CodexMcpScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs;
  bool _loading = true;
  bool _dirty = false;
  String? _error;
  Map<String, dynamic> _config = const {};
  List<Map<String, dynamic>> _status = const [];

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 2, vsync: this);
    _load();
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
      _dirty = false;
    });
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final cfg = await bridge.cxReadConfig();
      final status = await bridge.cxListMcpServerStatus();
      if (!mounted) return;
      setState(() {
        _config = cfg;
        _status = status;
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

  Map<String, dynamic> _mcpServers() {
    final cfg = _config['config'];
    if (cfg is Map) {
      // Codex SDK uses snake_case: mcp_servers (not camelCase mcpServers)
      final m = cfg['mcp_servers'];
      if (m is Map) return m.cast<String, dynamic>();
    }
    return {};
  }

  Future<void> _save() async {
    final oc = OpenCodeTheme.of(context);
    final servers = _mcpServers();
    try {
      final bridge = ref.read(bridgeServiceProvider);
      await bridge.cxWriteConfigValue(
        keyPath: 'mcp_servers',
        value: servers,
        mergeStrategy: 'Replace',
      );
      if (!mounted) return;
      setState(() => _dirty = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Saved Codex MCP config'),
          backgroundColor: oc.backgroundPanel,
        ),
      );
      await _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Failed to save: $e'),
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

    final json = const JsonEncoder.withIndent('  ').convert({
      'transport': {
        'type': 'stdio',
        'command': 'echo',
        'args': ['TODO'],
      },
    });
    final cfg = await Navigator.push<Map<String, dynamic>>(
      context,
      MaterialPageRoute(
        builder: (_) =>
            _CodexMcpServerEditorScreen(title: name, initialJson: json),
      ),
    );
    if (cfg == null) return;

    final servers = _mcpServers();
    servers[name] = cfg;
    setState(() {
      _config = {
        ..._config,
        'config': {
          ...(_config['config'] as Map? ?? const <String, dynamic>{}),
          'mcp_servers': servers, // Use snake_case to match SDK
        },
      };
      _dirty = true;
    });
  }

  Future<void> _editServer(String name, Map<String, dynamic> cfg) async {
    final json = const JsonEncoder.withIndent('  ').convert(cfg);
    final updated = await Navigator.push<Map<String, dynamic>>(
      context,
      MaterialPageRoute(
        builder: (_) =>
            _CodexMcpServerEditorScreen(title: name, initialJson: json),
      ),
    );
    if (updated == null) return;
    final servers = _mcpServers();
    servers[name] = updated;
    setState(() {
      _config = {
        ..._config,
        'config': {
          ...(_config['config'] as Map? ?? const <String, dynamic>{}),
          'mcp_servers': servers, // Use snake_case to match SDK
        },
      };
      _dirty = true;
    });
  }

  Future<void> _deleteServer(String name) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Remove MCP server'),
        content: Text('Remove "$name" from Codex config?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    final servers = _mcpServers();
    servers.remove(name);
    setState(() {
      _config = {
        ..._config,
        'config': {
          ...(_config['config'] as Map? ?? const <String, dynamic>{}),
          'mcp_servers': servers, // Use snake_case to match SDK
        },
      };
      _dirty = true;
    });
  }

  @override
  Widget build(BuildContext context) {
    final oc = OpenCodeTheme.of(context);
    final servers = _mcpServers();
    final names = servers.keys.toList()..sort();

    return Scaffold(
      backgroundColor: oc.background,
      appBar: AppBar(
        backgroundColor: oc.background,
        elevation: 0,
        title: Text('MCP', style: TextStyle(color: oc.text)),
        iconTheme: IconThemeData(color: oc.text),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            onPressed: _dirty ? null : _load,
            tooltip: 'Reload',
          ),
          IconButton(
            icon: const Icon(Icons.add_rounded),
            onPressed: _tabs.index == 1 ? _addServer : null,
            tooltip: 'Add server',
          ),
          TextButton(
            onPressed: _dirty ? _save : null,
            child: Text(
              'Save',
              style: TextStyle(
                color: _dirty ? oc.primary : oc.textMuted,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
        bottom: TabBar(
          controller: _tabs,
          labelColor: oc.primary,
          unselectedLabelColor: oc.textMuted,
          indicatorColor: oc.primary,
          tabs: const [
            Tab(text: 'Status'),
            Tab(text: 'Config'),
          ],
        ),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text(_error!, style: TextStyle(color: oc.textMuted)),
              ),
            )
          : TabBarView(
              controller: _tabs,
              children: [
                _CodexMcpStatusList(status: _status),
                names.isEmpty
                    ? Center(
                        child: Padding(
                          padding: const EdgeInsets.all(24),
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(
                                Icons.dns_rounded,
                                color: oc.textMuted,
                                size: 56,
                              ),
                              const SizedBox(height: 12),
                              Text(
                                'No MCP servers',
                                style: TextStyle(color: oc.text),
                              ),
                              const SizedBox(height: 8),
                              Text(
                                'Add servers to `mcp_servers` in Codex config.',
                                textAlign: TextAlign.center,
                                style: TextStyle(color: oc.textMuted),
                              ),
                              const SizedBox(height: 16),
                              ElevatedButton.icon(
                                onPressed: _addServer,
                                icon: const Icon(Icons.add_rounded),
                                label: const Text('Add server'),
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
                          final cfg = servers[name];
                          return Card(
                            color: oc.backgroundElement,
                            margin: const EdgeInsets.only(bottom: 10),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12),
                              side: BorderSide(color: oc.border),
                            ),
                            child: ListTile(
                              onTap: () => _editServer(
                                name,
                                (cfg as Map).cast<String, dynamic>(),
                              ),
                              title: Text(
                                name,
                                style: TextStyle(
                                  color: oc.text,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                              subtitle: Text(
                                'Tap to edit config',
                                style: TextStyle(color: oc.textMuted),
                              ),
                              trailing: PopupMenuButton<String>(
                                onSelected: (v) {
                                  if (v == 'edit') {
                                    _editServer(
                                      name,
                                      (cfg as Map).cast<String, dynamic>(),
                                    );
                                  }
                                  if (v == 'delete') _deleteServer(name);
                                },
                                itemBuilder: (_) => const [
                                  PopupMenuItem(
                                    value: 'edit',
                                    child: Text('Edit'),
                                  ),
                                  PopupMenuItem(
                                    value: 'delete',
                                    child: Text('Remove'),
                                  ),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
              ],
            ),
    );
  }
}

class _CodexMcpStatusList extends StatelessWidget {
  const _CodexMcpStatusList({required this.status});

  final List<Map<String, dynamic>> status;

  @override
  Widget build(BuildContext context) {
    final oc = OpenCodeTheme.of(context);
    if (status.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            'No MCP status data',
            style: TextStyle(color: oc.textMuted),
          ),
        ),
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
      itemCount: status.length,
      itemBuilder: (context, idx) {
        final s = status[idx];
        final name = s['name']?.toString() ?? '';
        final st = s['status']?.toString() ?? '';
        final err = s['error']?.toString();
        return Card(
          color: oc.backgroundElement,
          margin: const EdgeInsets.only(bottom: 10),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
            side: BorderSide(color: oc.border),
          ),
          child: ListTile(
            title: Text(
              name,
              style: TextStyle(color: oc.text, fontWeight: FontWeight.w700),
            ),
            subtitle: Text(
              err != null && err.isNotEmpty ? '$st • $err' : st,
              style: TextStyle(color: oc.textMuted),
            ),
          ),
        );
      },
    );
  }
}

class _CodexMcpServerEditorScreen extends StatefulWidget {
  const _CodexMcpServerEditorScreen({
    required this.title,
    required this.initialJson,
  });

  final String title;
  final String initialJson;

  @override
  State<_CodexMcpServerEditorScreen> createState() =>
      _CodexMcpServerEditorScreenState();
}

class _CodexMcpServerEditorScreenState
    extends State<_CodexMcpServerEditorScreen> {
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
      if (decoded is! Map)
        throw const FormatException('Config must be a JSON object');
      Navigator.pop(context, decoded.cast<String, dynamic>());
    } catch (e) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('Invalid JSON: $e')));
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
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: TextField(
          controller: _json,
          maxLines: null,
          expands: true,
          style: const TextStyle(fontFamily: 'monospace', fontSize: 13),
          decoration: InputDecoration(
            filled: true,
            fillColor: oc.backgroundElement,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide(color: oc.border),
            ),
          ),
        ),
      ),
    );
  }
}
