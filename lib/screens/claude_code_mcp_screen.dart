import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/selection_provider.dart';
import '../providers/service_providers.dart';
import '../theme/opencode_theme.dart';

class ClaudeCodeMcpScreen extends ConsumerStatefulWidget {
  const ClaudeCodeMcpScreen({super.key});

  @override
  ConsumerState<ClaudeCodeMcpScreen> createState() => _ClaudeCodeMcpScreenState();
}

class _ClaudeCodeMcpScreenState extends ConsumerState<ClaudeCodeMcpScreen> {
  bool _loading = true;
  bool _dirty = false;
  String? _error;
  Map<String, dynamic> _root = const {};

  String? get _cwd => ref.read(selectionProvider).project?.path;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final cwd = _cwd;
    if (cwd == null) {
      setState(() {
        _loading = false;
        _error = 'Select a project to edit .mcp.json.';
        _root = const {};
        _dirty = false;
      });
      return;
    }

    setState(() {
      _loading = true;
      _error = null;
      _dirty = false;
    });

    try {
      final bridge = ref.read(bridgeServiceProvider);
      final content = await bridge.ccReadMcpFile(cwd: cwd);
      final decoded = jsonDecode(content);
      final root = decoded is Map ? decoded.cast<String, dynamic>() : <String, dynamic>{};
      if (!mounted) return;
      setState(() {
        _root = root;
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

  Map<String, dynamic> _servers() {
    final v = _root['mcpServers'];
    if (v is Map) return v.cast<String, dynamic>();
    return {};
  }

  Future<void> _save() async {
    final cwd = _cwd;
    if (cwd == null) return;
    final oc = OpenCodeTheme.of(context);
    final content =
        const JsonEncoder.withIndent('  ').convert(_root.isEmpty ? {'mcpServers': {}} : _root);
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final ok = await bridge.ccWriteMcpFile(cwd: cwd, content: content);
      if (!mounted) return;
      if (ok) {
        setState(() => _dirty = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: const Text('Saved .mcp.json'), backgroundColor: oc.backgroundPanel),
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: const Text('Failed to save'), backgroundColor: oc.error),
        );
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to save: $e'), backgroundColor: oc.error),
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
          decoration: const InputDecoration(hintText: 'server name (e.g. filesystem)'),
          autofocus: true,
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, nameController.text.trim()),
            child: const Text('Next'),
          ),
        ],
      ),
    );
    if (name == null || name.isEmpty) return;

    final config = await Navigator.push<Map<String, dynamic>>(
      context,
      MaterialPageRoute(
        builder: (_) => _McpServerEditorScreen(
          title: name,
          initialJson: const JsonEncoder.withIndent('  ').convert(
            {'command': '', 'args': [], 'env': {}},
          ),
        ),
      ),
    );
    if (config == null) return;

    final servers = _servers();
    servers[name] = config;
    setState(() {
      _root = {..._root, 'mcpServers': servers};
      _dirty = true;
    });
  }

  Future<void> _editServer(String name, Map<String, dynamic> cfg) async {
    final config = await Navigator.push<Map<String, dynamic>>(
      context,
      MaterialPageRoute(
        builder: (_) => _McpServerEditorScreen(
          title: name,
          initialJson: const JsonEncoder.withIndent('  ').convert(cfg),
        ),
      ),
    );
    if (config == null) return;
    final servers = _servers();
    servers[name] = config;
    setState(() {
      _root = {..._root, 'mcpServers': servers};
      _dirty = true;
    });
  }

  Future<void> _deleteServer(String name) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Remove MCP server'),
        content: Text('Remove "$name" from .mcp.json?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    final servers = _servers();
    servers.remove(name);
    setState(() {
      _root = {..._root, 'mcpServers': servers};
      _dirty = true;
    });
  }

  @override
  Widget build(BuildContext context) {
    final oc = OpenCodeTheme.of(context);
    final servers = _servers();
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
            onPressed: _addServer,
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
          : names.isEmpty
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.dns_rounded, color: oc.textMuted, size: 56),
                    const SizedBox(height: 12),
                    Text('No MCP servers', style: TextStyle(color: oc.text)),
                    const SizedBox(height: 8),
                    Text(
                      'Add servers to .mcp.json to enable MCP tools for Claude Code.',
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
                final cmd = (cfg is Map) ? (cfg['command']?.toString() ?? '') : '';
                final args = (cfg is Map && cfg['args'] is List) ? (cfg['args'] as List).length : 0;
                return Card(
                  color: oc.backgroundElement,
                  margin: const EdgeInsets.only(bottom: 10),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                    side: BorderSide(color: oc.border),
                  ),
                  child: ListTile(
                    onTap: () => _editServer(name, (cfg as Map).cast<String, dynamic>()),
                    title: Text(name, style: TextStyle(color: oc.text, fontWeight: FontWeight.w700)),
                    subtitle: Text(
                      cmd.isNotEmpty ? '$cmd • args: $args' : 'Tap to configure',
                      style: TextStyle(color: oc.textMuted),
                    ),
                    trailing: PopupMenuButton<String>(
                      onSelected: (v) {
                        if (v == 'edit') _editServer(name, (cfg as Map).cast<String, dynamic>());
                        if (v == 'delete') _deleteServer(name);
                      },
                      itemBuilder: (_) => const [
                        PopupMenuItem(value: 'edit', child: Text('Edit')),
                        PopupMenuItem(value: 'delete', child: Text('Remove')),
                      ],
                    ),
                  ),
                );
              },
            ),
    );
  }
}

class _McpServerEditorScreen extends StatefulWidget {
  const _McpServerEditorScreen({required this.title, required this.initialJson});

  final String title;
  final String initialJson;

  @override
  State<_McpServerEditorScreen> createState() => _McpServerEditorScreenState();
}

class _McpServerEditorScreenState extends State<_McpServerEditorScreen> {
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
      if (decoded is! Map) throw const FormatException('Config must be a JSON object');
      Navigator.pop(context, decoded.cast<String, dynamic>());
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Invalid JSON: $e')),
      );
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

