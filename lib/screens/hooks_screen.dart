
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../theme/app_typography.dart';
import '../theme/design_tokens.dart';

import '../models/skill.dart';
import '../providers/selection_provider.dart';
import '../providers/service_providers.dart';
import '../theme/opencode_theme.dart';
import 'package:broski/theme/app_icons.dart';
class HooksScreen extends ConsumerStatefulWidget {
  const HooksScreen({super.key});
  @override
  ConsumerState<HooksScreen> createState() => _HooksScreenState();
}
class _HooksScreenState extends ConsumerState<HooksScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs;
  SkillSource _source = SkillSource.project;
  bool _loading = true;
  String? _error;
  Map<String, dynamic> _root = const {};
  bool _dirty = false;
  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 2, vsync: this);
    _tabs.addListener(_onTabChanged);
    _load();
  }
  @override
  void dispose() {
    _tabs.removeListener(_onTabChanged);
    _tabs.dispose();
    super.dispose();
  }
  void _onTabChanged() {
    final next = _tabs.index == 0 ? SkillSource.project : SkillSource.user;
    if (next == _source) return;
    _source = next;
    _load();
  }
  String? _cwd() => ref.read(selectionProvider).project?.path;
  Future<void> _load() async {
    final cwd = _cwd();
    if (_source == SkillSource.project && cwd == null) {
      setState(() {
        _loading = false;
        _error = 'Select a project to manage project hooks.';
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
      final content = await bridge.ccReadHooksFile(source: _source, cwd: cwd);
      final decoded = jsonDecode(content);
      final root = decoded is Map
          ? decoded.cast<String, dynamic>()
          : <String, dynamic>{};
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
  Map<String, dynamic> _hooksMap() {
    final hooks = _root['hooks'];
    if (hooks is Map) return hooks.cast<String, dynamic>();
    return {};
  }
  List<_HookRow> _rows() {
    final hooks = _hooksMap();
    final rows = <_HookRow>[];
    for (final entry in hooks.entries) {
      final event = entry.key;
      final matchers = entry.value;
      if (matchers is! List) continue;
      for (var i = 0; i < matchers.length; i++) {
        final m = matchers[i];
        if (m is Map) {
          rows.add(
            _HookRow(
              event: event,
              index: i,
              matcher: m['matcher']?.toString(),
              value: m.cast<String, dynamic>(),
            ),
          );
        }
      }
    }
    rows.sort((a, b) {
      final c = a.event.compareTo(b.event);
      if (c != 0) return c;
      return (a.matcher ?? '').compareTo(b.matcher ?? '');
    });
    return rows;
  }
  Future<void> _addHook() async {
    final created = await Navigator.push<_HookEditResult>(
      context,
      MaterialPageRoute(builder: (_) => const HookEditorScreen()),
    );
    if (created == null) return;
    _applyEdit(null, created);
  }
  Future<void> _editHook(_HookRow row) async {
    final edited = await Navigator.push<_HookEditResult>(
      context,
      MaterialPageRoute(
        builder: (_) => HookEditorScreen(
          initialEvent: row.event,
          initialJson: const JsonEncoder.withIndent('  ').convert(row.value),
        ),
      ),
    );
    if (edited == null) return;
    _applyEdit(row, edited);
  }
  void _applyEdit(_HookRow? existing, _HookEditResult next) {
    final hooks = _hooksMap();
    final updated = <String, dynamic>{..._root, 'hooks': hooks};
    if (existing != null) {
      final list = hooks[existing.event];
      if (list is List && existing.index >= 0 && existing.index < list.length) {
        list.removeAt(existing.index);
      }
    }
    hooks.putIfAbsent(next.event, () => <dynamic>[]);
    final list = hooks[next.event];
    if (list is List) list.add(next.value);
    setState(() {
      _root = updated;
      _dirty = true;
    });
  }
  Future<void> _deleteHook(_HookRow row) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Hook'),
        content: Text(
          'Delete this hook?\n\nEvent: ${row.event}\nMatcher: ${row.matcher ?? '(none)'}',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(foregroundColor: Theme.of(ctx).extension<OpenCodeTheme>()!.error),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    final hooks = _hooksMap();
    final updated = <String, dynamic>{..._root, 'hooks': hooks};
    final list = hooks[row.event];
    if (list is List && row.index >= 0 && row.index < list.length) {
      list.removeAt(row.index);
    }
    setState(() {
      _root = updated;
      _dirty = true;
    });
  }
  Future<void> _save() async {
    final cwd = _cwd();
    final oc = OpenCodeTheme.of(context);
    if (_source == SkillSource.project && cwd == null) return;
    final content = const JsonEncoder.withIndent(
      '  ',
    ).convert(_root.isEmpty ? {'hooks': {}} : _root);
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final ok = await bridge.ccWriteHooksFile(
        source: _source,
        content: content,
        cwd: cwd,
      );
      if (!mounted) return;
      if (ok) {
        setState(() => _dirty = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Text('Hooks saved'),
            backgroundColor: oc.backgroundPanel,
          ),
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Text('Failed to save hooks'),
            backgroundColor: oc.error,
          ),
        );
      }
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
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final oc = theme.extension<OpenCodeTheme>()!;
    final rows = _rows();
    return Scaffold(
      backgroundColor: oc.background,
      appBar: AppBar(
        backgroundColor: oc.background,
        elevation: 0,
        title: Text('Hooks', style: TextStyle(color: oc.text)),
        iconTheme: IconThemeData(color: oc.text),
        actions: [
          IconButton(
            icon: const Icon(AppIcons.refresh),
            onPressed: _dirty ? null : _load,
            tooltip: 'Reload',
          ),
          IconButton(
            icon: const Icon(AppIcons.add),
            onPressed: _addHook,
            tooltip: 'Add Hook',
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
            Tab(text: 'Project'),
            Tab(text: 'User'),
          ],
        ),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
          ? Center(
              child: Padding(
                padding: Insets.cardLg,
                child: Text(_error!, style: TextStyle(color: oc.textMuted)),
              ),
            )
          : rows.isEmpty
          ? Center(
              child: Padding(
                padding: Insets.cardLg,
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(AppIcons.bolt, color: oc.textMuted, size: 56),
                    SizedBox(height: Spacing.md),
                    Text(
                      'No hooks configured',
                      style: TextStyle(color: oc.text),
                    ),
                    SizedBox(height: Spacing.sm),
                    Text(
                      'Add hooks to run scripts/commands on events like PreToolUse.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: oc.textMuted),
                    ),
                    SizedBox(height: Spacing.lg),
                    ElevatedButton.icon(
                      onPressed: _addHook,
                      icon: const Icon(AppIcons.add),
                      label: const Text('Add Hook'),
                    ),
                  ],
                ),
              ),
            )
          : ListView.builder(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
              itemCount: rows.length,
              itemBuilder: (context, idx) {
                final row = rows[idx];
                final hooks = row.value['hooks'];
                final hookCount = hooks is List ? hooks.length : 0;
                return Card(
                  color: oc.backgroundElement,
                  margin: const EdgeInsets.only(bottom: 10),
                  shape: RoundedRectangleBorder(
                    borderRadius: Radii.brMd,
                    side: BorderSide(color: oc.border),
                  ),
                  child: ListTile(
                    onTap: () => _editHook(row),
                    title: Text(
                      row.event,
                      style: TextStyle(
                        color: oc.text,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    subtitle: Text(
                      row.matcher?.trim().isNotEmpty == true
                          ? 'Matcher: ${row.matcher} • Hooks: $hookCount'
                          : 'Hooks: $hookCount',
                      style: TextStyle(color: oc.textMuted),
                    ),
                    trailing: PopupMenuButton<String>(
                      onSelected: (v) {
                        if (v == 'edit') _editHook(row);
                        if (v == 'delete') _deleteHook(row);
                      },
                      itemBuilder: (_) => const [
                        PopupMenuItem(value: 'edit', child: Text('Edit')),
                        PopupMenuItem(value: 'delete', child: Text('Delete')),
                      ],
                    ),
                  ),
                );
              },
            ),
    );
  }
}
class _HookRow {
  final String event;
  final int index;
  final String? matcher;
  final Map<String, dynamic> value;
  const _HookRow({
    required this.event,
    required this.index,
    required this.matcher,
    required this.value,
  });
}
class _HookEditResult {
  final String event;
  final Map<String, dynamic> value;
  const _HookEditResult({required this.event, required this.value});
}
class HookEditorScreen extends StatefulWidget {
  const HookEditorScreen({this.initialEvent, this.initialJson, super.key});
  final String? initialEvent;
  final String? initialJson;
  @override
  State<HookEditorScreen> createState() => _HookEditorScreenState();
}
class _HookEditorScreenState extends State<HookEditorScreen> {
  late String _selectedEvent;
  late final TextEditingController _json;
  static const _hookEvents = <String>[
    'PreToolUse',
    'PostToolUse',
    'PostToolUseFailure',
    'Notification',
    'SessionStart',
    'SessionEnd',
    'Stop',
    'PermissionRequest',
    'UserPromptSubmit',
    'SubagentStart',
    'SubagentStop',
    'TeammateIdle',
    'TaskCompleted',
    'PreCompact',
    'Setup',
  ];
  @override
  void initState() {
    super.initState();
    _selectedEvent = widget.initialEvent ?? 'PreToolUse';
    _json = TextEditingController(
      text:
          widget.initialJson ??
          const JsonEncoder.withIndent(
            '  ',
          ).convert({'matcher': '', 'hooks': []}),
    );
  }
  @override
  void dispose() {
    _json.dispose();
    super.dispose();
  }
  void _save() {
    final event = _selectedEvent;
    if (event.isEmpty) return;
    try {
      final decoded = jsonDecode(_json.text);
      if (decoded is! Map)
        throw const FormatException('Hook JSON must be an object');
      Navigator.pop(
        context,
        _HookEditResult(event: event, value: decoded.cast<String, dynamic>()),
      );
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
        title: Text('Hook', style: TextStyle(color: oc.text)),
        iconTheme: IconThemeData(color: oc.text),
        actions: [
          TextButton(
            onPressed: _save,
            child: Text(
              'Done',
              style: TextStyle(color: oc.primary, fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
      body: Padding(
        padding: Insets.card,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Event', style: AppTypography.label(color: oc.textMuted)),
            const SizedBox(height: 6),
            DropdownButtonFormField<String>(
              value: _selectedEvent,
              decoration: InputDecoration(
                filled: true,
                fillColor: oc.backgroundElement,
                border: OutlineInputBorder(
                  borderRadius: Radii.brSm,
                  borderSide: BorderSide(color: oc.border),
                ),
              ),
              dropdownColor: oc.backgroundElement,
              style: TextStyle(color: oc.text),
              items: _hookEvents.map((e) {
                return DropdownMenuItem(value: e, child: Text(e));
              }).toList(),
              onChanged: (value) {
                if (value != null) {
                  setState(() => _selectedEvent = value);
                }
              },
            ),
            SizedBox(height: Spacing.lg),
            Text(
              'Matcher Entry JSON',
              style: AppTypography.label(color: oc.textMuted),
            ),
            const SizedBox(height: 6),
            Expanded(
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
          ],
        ),
      ),
    );
  }
}
