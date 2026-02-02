import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/selection_provider.dart';
import '../providers/service_providers.dart';
import '../theme/opencode_theme.dart';

class OpenCodeMcpConfigScreen extends ConsumerStatefulWidget {
  const OpenCodeMcpConfigScreen({super.key});

  @override
  ConsumerState<OpenCodeMcpConfigScreen> createState() =>
      _OpenCodeMcpConfigScreenState();
}

class _OpenCodeMcpConfigScreenState
    extends ConsumerState<OpenCodeMcpConfigScreen> {
  bool _loading = true;
  // Config edits are disabled; this is kept to avoid larger refactors.
  bool _dirty = false;
  String? _error;
  Map<String, dynamic> _config = const {};

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
      if (!mounted) return;
      setState(() {
        _config = cfg;
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

  Map<String, dynamic> _mcp() {
    final m = _config['mcp'];
    if (m is Map) return m.cast<String, dynamic>();
    return {};
  }

  Future<void> _save() async {
    final oc = OpenCodeTheme.of(context);
    final mcp = _mcp();
    try {
      final bridge = ref.read(bridgeServiceProvider);
      await bridge.setConfig({'mcp': mcp}, projectPath: _projectPath);
      if (!mounted) return;
      setState(() => _dirty = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Saved MCP config'),
          backgroundColor: oc.backgroundPanel,
        ),
      );
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
          content: Text('Restart failed: $e'),
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
    final mcp = _mcp();
    mcp[name] = cfg;
    setState(() {
      _config = {..._config, 'mcp': mcp};
      _dirty = true;
    });
  }

  Future<void> _editServer(String name, Map<String, dynamic> cfg) async {
    final json = const JsonEncoder.withIndent('  ').convert(cfg);
    final updated = await Navigator.push<Map<String, dynamic>>(
      context,
      MaterialPageRoute(
        builder: (_) => _JsonObjectEditorScreen(title: name, initialJson: json),
      ),
    );
    if (updated == null) return;
    final mcp = _mcp();
    mcp[name] = updated;
    setState(() {
      _config = {..._config, 'mcp': mcp};
      _dirty = true;
    });
  }

  Future<void> _deleteServer(String name) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Remove MCP server'),
        content: Text('Remove "$name" from OpenCode config?'),
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
    final mcp = _mcp();
    mcp.remove(name);
    setState(() {
      _config = {..._config, 'mcp': mcp};
      _dirty = true;
    });
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
          IconButton(icon: const Icon(Icons.refresh_rounded), onPressed: _load),
        ],
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
          : Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          'Edit MCP config on your Mac. Broski does not modify config from mobile.',
                          style: TextStyle(color: oc.textMuted, fontSize: 12),
                        ),
                      ),
                      TextButton.icon(
                        onPressed: _restart,
                        icon: const Icon(Icons.restart_alt_rounded, size: 18),
                        label: const Text('Restart'),
                      ),
                    ],
                  ),
                ),
                Expanded(
                  child: names.isEmpty
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
                                  'No MCP servers configured',
                                  style: TextStyle(color: oc.text),
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  'Add servers under the `mcp` key in OpenCode config.',
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
                            final cfg = mcp[name];
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
                                  style: TextStyle(
                                    color: oc.text,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                                subtitle: Text(
                                  'Configured in OpenCode config',
                                  style: TextStyle(color: oc.textMuted),
                                ),
                                trailing: null,
                              ),
                            );
                          },
                        ),
                ),
              ],
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
