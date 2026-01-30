import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/claude_code.dart';
import '../providers/selection_provider.dart';
import '../providers/service_providers.dart';
import '../theme/opencode_theme.dart';

class ClaudeCodeSettingsScreen extends ConsumerStatefulWidget {
  const ClaudeCodeSettingsScreen({super.key});

  @override
  ConsumerState<ClaudeCodeSettingsScreen> createState() =>
      _ClaudeCodeSettingsScreenState();
}

class _ClaudeCodeSettingsScreenState
    extends ConsumerState<ClaudeCodeSettingsScreen> {
  bool _loading = true;
  String? _error;
  ClaudeCodeConfig? _config;
  // SDK v2.1.6: Search functionality in /config
  final _searchController = TextEditingController();
  String _searchQuery = '';

  static const _languages = <String>[
    'english',
    'japanese',
    'spanish',
    'french',
    'german',
    'chinese',
    'korean',
  ];

  @override
  void initState() {
    super.initState();
    _searchController.addListener(() {
      setState(() => _searchQuery = _searchController.text.toLowerCase());
    });
    _load();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  /// Check if a setting matches the search query
  bool _matches(String label) {
    if (_searchQuery.isEmpty) return true;
    return label.toLowerCase().contains(_searchQuery);
  }

  /// Build a setting card with consistent styling
  Widget _buildSettingCard({
    required OpenCodeTheme oc,
    required String title,
    required Widget child,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Card(
        color: oc.backgroundPanel,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(color: oc.borderSubtle.withValues(alpha: 0.2)),
        ),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: TextStyle(color: oc.text, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 10),
              child,
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    final selection = ref.read(selectionProvider);
    final cwd = selection.project?.path;
    if (cwd == null || cwd.isEmpty) {
      setState(() {
        _config = null;
        _loading = false;
      });
      return;
    }

    try {
      final bridge = ref.read(bridgeServiceProvider);
      final cfg = await bridge.ccGetConfig(cwd: cwd);
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

  Future<void> _update(ClaudeCodeConfig next) async {
    final selection = ref.read(selectionProvider);
    final cwd = selection.project?.path;
    if (cwd == null || cwd.isEmpty) return;

    setState(() {
      _config = next;
      _error = null;
    });

    try {
      final bridge = ref.read(bridgeServiceProvider);
      final updated = await bridge.ccSetConfig(next, cwd: cwd);
      if (!mounted) return;
      setState(() => _config = updated);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    }
  }

  Future<void> _showAddToolDialog(
    ClaudeCodeConfig cfg, {
    required bool isAllowed,
  }) async {
    final controller = TextEditingController();
    final presets = <String>[
      'Read',
      'Write',
      'Edit',
      'MultiEdit',
      'Bash',
      'Bash(npm *)',
      'Bash(git *)',
      'Bash(*)',
      'Glob',
      'Grep',
      'WebFetch',
      'WebSearch',
      'Task',
      'TodoRead',
      'TodoWrite',
      'NotebookEdit',
      'mcp__*',
    ];
    final oc = OpenCodeTheme.of(context);

    final result = await showDialog<String?>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(isAllowed ? 'Add Allowed Tool' : 'Add Disallowed Tool'),
        content: SizedBox(
          width: double.maxFinite,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              TextField(
                controller: controller,
                decoration: const InputDecoration(
                  hintText: 'e.g. Bash(npm *)',
                  labelText: 'Tool name or pattern',
                ),
                autofocus: true,
              ),
              const SizedBox(height: 12),
              Text(
                'Presets:',
                style: TextStyle(color: oc.textMuted, fontSize: 12),
              ),
              const SizedBox(height: 6),
              SizedBox(
                height: 200,
                child: SingleChildScrollView(
                  child: Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: presets.map((p) {
                      return ActionChip(
                        label: Text(p, style: const TextStyle(fontSize: 11)),
                        visualDensity: VisualDensity.compact,
                        onPressed: () => Navigator.pop(ctx, p),
                      );
                    }).toList(),
                  ),
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, null),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, controller.text.trim()),
            child: const Text('Add'),
          ),
        ],
      ),
    );

    controller.dispose();
    if (result == null || result.isEmpty) return;

    if (isAllowed) {
      if (!cfg.allowedTools.contains(result)) {
        final next = [...cfg.allowedTools, result];
        await _update(cfg.copyWith(allowedTools: next));
      }
    } else {
      if (!cfg.disallowedTools.contains(result)) {
        final next = [...cfg.disallowedTools, result];
        await _update(cfg.copyWith(disallowedTools: next));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final oc = OpenCodeTheme.of(context);
    final selection = ref.watch(selectionProvider);
    final cwd = selection.project?.path;
    final hasProject = cwd != null && cwd.isNotEmpty;

    final cfg = _config;
    final languageValue = (cfg?.language ?? '').trim();
    final hasKnownLanguage = _languages.contains(languageValue);
    final dropdownLanguage = languageValue.isEmpty
        ? null
        : (hasKnownLanguage ? languageValue : 'custom');

    final release = (cfg?.releaseChannel ?? '').trim();
    final releaseValue = (release == 'stable' || release == 'latest')
        ? release
        : null;

    return Scaffold(
      backgroundColor: oc.background,
      appBar: AppBar(
        backgroundColor: oc.background,
        foregroundColor: oc.text,
        title: const Text('Claude Code settings'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: _loading ? null : _load,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: SafeArea(
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : !hasProject
            ? Center(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(
                    'Select a project to edit Claude Code settings.',
                    style: TextStyle(color: oc.textMuted),
                    textAlign: TextAlign.center,
                  ),
                ),
              )
            : ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  if (_error != null) ...[
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: oc.error.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: oc.error.withValues(alpha: 0.35),
                        ),
                      ),
                      child: Text(
                        _error!,
                        style: TextStyle(color: oc.text, fontSize: 12),
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],
                  // SDK v2.1.6: Search functionality in /config
                  TextField(
                    controller: _searchController,
                    decoration: InputDecoration(
                      hintText: 'Search settings...',
                      hintStyle: TextStyle(color: oc.textMuted),
                      prefixIcon: Icon(
                        Icons.search_rounded,
                        color: oc.textMuted,
                      ),
                      suffixIcon: _searchQuery.isNotEmpty
                          ? IconButton(
                              icon: Icon(
                                Icons.clear_rounded,
                                color: oc.textMuted,
                              ),
                              onPressed: () => _searchController.clear(),
                            )
                          : null,
                      filled: true,
                      fillColor: oc.backgroundPanel,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                        borderSide: BorderSide.none,
                      ),
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 12,
                      ),
                    ),
                    style: TextStyle(color: oc.text),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    'Applied to this repo via `.claude/settings.json`.',
                    style: TextStyle(color: oc.textMuted, fontSize: 12),
                  ),
                  const SizedBox(height: 14),
                  // Permission Mode (SDK v2.0.43)
                  if (_matches('permission mode security'))
                    _buildSettingCard(
                      oc: oc,
                      title: 'Permission Mode',
                      child: DropdownButtonFormField<ClaudeCodePermissionMode>(
                        value:
                            cfg?.permissionMode ??
                            ClaudeCodePermissionMode.defaultMode,
                        decoration: const InputDecoration(
                          labelText: 'How Claude handles permissions',
                        ),
                        items: ClaudeCodePermissionMode.values.map((m) {
                          return DropdownMenuItem(
                            value: m,
                            child: Text(m.displayName),
                          );
                        }).toList(),
                        onChanged: cfg == null
                            ? null
                            : (value) async {
                                if (value != null) {
                                  await _update(
                                    cfg.copyWith(permissionMode: value),
                                  );
                                }
                              },
                      ),
                    ),
                  // Model override
                  if (_matches('model sonnet opus haiku'))
                    _buildSettingCard(
                      oc: oc,
                      title: 'Model',
                      child: DropdownButtonFormField<String?>(
                        value: cfg?.model,
                        decoration: const InputDecoration(
                          labelText: 'Default model',
                        ),
                        items: const [
                          DropdownMenuItem<String?>(
                            value: null,
                            child: Text('Default'),
                          ),
                          DropdownMenuItem<String?>(
                            value: 'sonnet',
                            child: Text('Sonnet'),
                          ),
                          DropdownMenuItem<String?>(
                            value: 'opus',
                            child: Text('Opus'),
                          ),
                          DropdownMenuItem<String?>(
                            value: 'haiku',
                            child: Text('Haiku'),
                          ),
                        ],
                        onChanged: cfg == null
                            ? null
                            : (value) async {
                                await _update(cfg.copyWith(model: value));
                              },
                      ),
                    ),
                  // Allowed Tools (SDK v2.1.0 wildcards)
                  if (_matches('allowed tools permissions bash wildcard'))
                    _buildSettingCard(
                      oc: oc,
                      title: 'Allowed Tools',
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Tools Claude is allowed to use. Supports wildcards like Bash(npm *)',
                            style: TextStyle(color: oc.textMuted, fontSize: 12),
                          ),
                          const SizedBox(height: 8),
                          if (cfg != null && cfg.allowedTools.isNotEmpty)
                            Wrap(
                              spacing: 6,
                              runSpacing: 6,
                              children: cfg.allowedTools.map((tool) {
                                return Chip(
                                  label: Text(
                                    tool,
                                    style: const TextStyle(fontSize: 12),
                                  ),
                                  deleteIcon: const Icon(Icons.close, size: 16),
                                  onDeleted: () {
                                    final next = List<String>.from(
                                      cfg.allowedTools,
                                    )..remove(tool);
                                    _update(cfg.copyWith(allowedTools: next));
                                  },
                                  materialTapTargetSize:
                                      MaterialTapTargetSize.shrinkWrap,
                                  visualDensity: VisualDensity.compact,
                                );
                              }).toList(),
                            ),
                          const SizedBox(height: 8),
                          OutlinedButton.icon(
                            icon: const Icon(Icons.add, size: 16),
                            label: const Text('Add Tool'),
                            onPressed: cfg == null
                                ? null
                                : () =>
                                      _showAddToolDialog(cfg, isAllowed: true),
                          ),
                        ],
                      ),
                    ),
                  // Disallowed Tools (SDK v2.0.30)
                  if (_matches('disallowed blocked tools'))
                    _buildSettingCard(
                      oc: oc,
                      title: 'Disallowed Tools',
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Tools Claude cannot use. Use Task(AgentName) to disable agents.',
                            style: TextStyle(color: oc.textMuted, fontSize: 12),
                          ),
                          const SizedBox(height: 8),
                          if (cfg != null && cfg.disallowedTools.isNotEmpty)
                            Wrap(
                              spacing: 6,
                              runSpacing: 6,
                              children: cfg.disallowedTools.map((tool) {
                                return Chip(
                                  label: Text(
                                    tool,
                                    style: const TextStyle(fontSize: 12),
                                  ),
                                  deleteIcon: const Icon(Icons.close, size: 16),
                                  onDeleted: () {
                                    final next = List<String>.from(
                                      cfg.disallowedTools,
                                    )..remove(tool);
                                    _update(
                                      cfg.copyWith(disallowedTools: next),
                                    );
                                  },
                                  materialTapTargetSize:
                                      MaterialTapTargetSize.shrinkWrap,
                                  visualDensity: VisualDensity.compact,
                                );
                              }).toList(),
                            ),
                          const SizedBox(height: 8),
                          OutlinedButton.icon(
                            icon: const Icon(Icons.add, size: 16),
                            label: const Text('Add Tool'),
                            onPressed: cfg == null
                                ? null
                                : () =>
                                      _showAddToolDialog(cfg, isAllowed: false),
                          ),
                        ],
                      ),
                    ),
                  // Language setting
                  if (_matches('language response'))
                    _buildSettingCard(
                      oc: oc,
                      title: 'Language',
                      child: DropdownButtonFormField<String?>(
                        value: dropdownLanguage,
                        decoration: const InputDecoration(
                          labelText: 'Response language',
                        ),
                        items: [
                          const DropdownMenuItem<String?>(
                            value: null,
                            child: Text('Auto'),
                          ),
                          const DropdownMenuItem<String?>(
                            value: 'english',
                            child: Text('English'),
                          ),
                          const DropdownMenuItem<String?>(
                            value: 'japanese',
                            child: Text('Japanese'),
                          ),
                          const DropdownMenuItem<String?>(
                            value: 'spanish',
                            child: Text('Spanish'),
                          ),
                          const DropdownMenuItem<String?>(
                            value: 'french',
                            child: Text('French'),
                          ),
                          const DropdownMenuItem<String?>(
                            value: 'german',
                            child: Text('German'),
                          ),
                          const DropdownMenuItem<String?>(
                            value: 'chinese',
                            child: Text('Chinese'),
                          ),
                          const DropdownMenuItem<String?>(
                            value: 'korean',
                            child: Text('Korean'),
                          ),
                          const DropdownMenuItem<String?>(
                            value: 'custom',
                            child: Text('Custom…'),
                          ),
                        ],
                        onChanged: cfg == null
                            ? null
                            : (value) async {
                                if (value == null) {
                                  await _update(cfg.copyWith(language: null));
                                  return;
                                }
                                if (value == 'custom') {
                                  final controller = TextEditingController(
                                    text: languageValue,
                                  );
                                  final res = await showDialog<String?>(
                                    context: context,
                                    builder: (ctx) => AlertDialog(
                                      title: const Text('Custom language'),
                                      content: TextField(
                                        controller: controller,
                                        decoration: const InputDecoration(
                                          hintText: 'e.g. japanese',
                                        ),
                                      ),
                                      actions: [
                                        TextButton(
                                          onPressed: () =>
                                              Navigator.pop(ctx, null),
                                          child: const Text('Cancel'),
                                        ),
                                        TextButton(
                                          onPressed: () => Navigator.pop(
                                            ctx,
                                            controller.text.trim(),
                                          ),
                                          child: const Text('Save'),
                                        ),
                                      ],
                                    ),
                                  );
                                  controller.dispose();
                                  if (res == null) return;
                                  final nextLang = res.trim();
                                  await _update(
                                    cfg.copyWith(
                                      language: nextLang.isEmpty
                                          ? null
                                          : nextLang,
                                    ),
                                  );
                                  return;
                                }
                                await _update(cfg.copyWith(language: value));
                              },
                      ),
                    ),
                  // Release channel setting
                  if (_matches('release channel update stable latest'))
                    _buildSettingCard(
                      oc: oc,
                      title: 'Release channel',
                      child: DropdownButtonFormField<String?>(
                        value: releaseValue,
                        decoration: const InputDecoration(
                          labelText: 'Update track',
                        ),
                        items: const [
                          DropdownMenuItem<String?>(
                            value: null,
                            child: Text('Default'),
                          ),
                          DropdownMenuItem<String?>(
                            value: 'stable',
                            child: Text('Stable'),
                          ),
                          DropdownMenuItem<String?>(
                            value: 'latest',
                            child: Text('Latest'),
                          ),
                        ],
                        onChanged: cfg == null
                            ? null
                            : (value) async {
                                await _update(
                                  cfg.copyWith(releaseChannel: value),
                                );
                              },
                      ),
                    ),
                  // Respect gitignore setting
                  if (_matches('gitignore ignore files respect'))
                    _buildSettingCard(
                      oc: oc,
                      title: 'File filtering',
                      child: SwitchListTile(
                        contentPadding: EdgeInsets.zero,
                        value: cfg?.respectGitignore ?? true,
                        title: const Text('Respect .gitignore'),
                        subtitle: const Text(
                          'Hide ignored files in @-mention file picker',
                        ),
                        onChanged: cfg == null
                            ? null
                            : (value) async {
                                await _update(
                                  cfg.copyWith(respectGitignore: value),
                                );
                              },
                      ),
                    ),
                  // No results message
                  if (_searchQuery.isNotEmpty &&
                      !_matches('permission mode security') &&
                      !_matches('model sonnet opus haiku') &&
                      !_matches('allowed tools permissions bash wildcard') &&
                      !_matches('disallowed blocked tools') &&
                      !_matches('language response') &&
                      !_matches('release channel update stable latest') &&
                      !_matches('gitignore ignore files respect'))
                    Padding(
                      padding: const EdgeInsets.all(24),
                      child: Text(
                        'No settings match "$_searchQuery"',
                        style: TextStyle(color: oc.textMuted),
                        textAlign: TextAlign.center,
                      ),
                    ),
                ],
              ),
      ),
    );
  }
}
