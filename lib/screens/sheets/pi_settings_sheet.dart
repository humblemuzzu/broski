import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/pi_provider.dart';
import '../../widgets/chat/detail_sheet.dart';
import 'package:broski/utils/snackbar_helpers.dart';

/// Shows the Pi settings sheet with typed controls.
/// Extracted per AGENTS.md — chat_screen only calls this function.
void showPiSettingsSheet(BuildContext context, {String? projectPath}) {
  DetailSheet.show(
    context: context,
    title: 'Pi Settings',
    initialSize: 0.7,
    child: _PiSettingsSheetContent(projectPath: projectPath),
  );
}

class _PiSettingsSheetContent extends ConsumerStatefulWidget {
  const _PiSettingsSheetContent({this.projectPath});

  final String? projectPath;

  @override
  ConsumerState<_PiSettingsSheetContent> createState() =>
      _PiSettingsSheetContentState();
}

class _PiSettingsSheetContentState
    extends ConsumerState<_PiSettingsSheetContent> {
  Map<String, dynamic>? _settings;
  bool _loading = true;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadSettings();
  }

  Future<void> _loadSettings() async {
    try {
      final bridge = ref.read(piBridgeServiceProvider);
      final result = await bridge.getSettings(projectPath: widget.projectPath);
      if (mounted) {
        setState(() {
          // Merge global and project settings for display
          final global = result['global'] as Map<String, dynamic>? ?? const {};
          final project =
              result['project'] as Map<String, dynamic>? ?? const {};
          _settings = {...global, ...project};
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _loading = false;
        });
      }
    }
  }

  Future<void> _saveSettings() async {
    if (_settings == null) return;
    setState(() => _saving = true);
    try {
      final bridge = ref.read(piBridgeServiceProvider);
      await bridge.setSettings(
        settings: _settings!,
        projectPath: widget.projectPath,
      );
      if (mounted) {
        showInfo(context, 'Settings saved');
      }
    } catch (e) {
      if (mounted) {
        showInfo(context, 'Failed to save: $e');
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _updateSetting(String key, dynamic value) {
    setState(() {
      _settings = {...?_settings, key: value};
    });
  }

  void _updateNestedSetting(String parent, String key, dynamic value) {
    setState(() {
      final nested = Map<String, dynamic>.from(
        _settings?[parent] as Map<String, dynamic>? ?? {},
      );
      nested[key] = value;
      _settings = {...?_settings, parent: nested};
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    if (_loading) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(32),
          child: CircularProgressIndicator(),
        ),
      );
    }

    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Text(
            'Failed to load settings: $_error',
            style: TextStyle(color: colorScheme.error),
          ),
        ),
      );
    }

    final settings = _settings ?? {};

    // DetailSheet.show already wraps child in SingleChildScrollView,
    // so we use a plain Column here to avoid nested scroll conflicts.
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          // ── Generation ────────────────────────────────────────
          const _SectionTitle(title: 'Generation'),
          _ToggleRow(
            label: 'Auto-Retry',
            value: settings['autoRetry'] as bool? ?? true,
            onChanged: (v) => _updateSetting('autoRetry', v),
          ),
          _NumberRow(
            label: 'Max Retries',
            value: _nestedInt(settings, 'retry', 'maxRetries', 3),
            min: 1,
            max: 10,
            onChanged: (v) => _updateNestedSetting('retry', 'maxRetries', v),
          ),
          _NumberRow(
            label: 'Retry Base Delay (ms)',
            value: _nestedInt(settings, 'retry', 'baseDelayMs', 2000),
            min: 500,
            max: 30000,
            step: 500,
            onChanged: (v) => _updateNestedSetting('retry', 'baseDelayMs', v),
          ),

          const SizedBox(height: 16),
          // ── Compaction ────────────────────────────────────────
          const _SectionTitle(title: 'Compaction'),
          _ToggleRow(
            label: 'Auto-Compact',
            value: settings['autoCompaction'] as bool? ?? true,
            onChanged: (v) => _updateSetting('autoCompaction', v),
          ),
          _NumberRow(
            label: 'Reserve Tokens',
            value: _nestedInt(settings, 'compaction', 'reserveTokens', 16384),
            min: 1024,
            max: 65536,
            step: 1024,
            onChanged: (v) =>
                _updateNestedSetting('compaction', 'reserveTokens', v),
          ),
          _NumberRow(
            label: 'Keep Recent Tokens',
            value: _nestedInt(
              settings,
              'compaction',
              'keepRecentTokens',
              20000,
            ),
            min: 1024,
            max: 65536,
            step: 1024,
            onChanged: (v) =>
                _updateNestedSetting('compaction', 'keepRecentTokens', v),
          ),

          const SizedBox(height: 16),
          // ── Branch Summaries ──────────────────────────────────
          const _SectionTitle(title: 'Branch Summaries'),
          _ToggleRow(
            label: 'Skip Summary Prompt',
            value: _nestedBool(settings, 'branchSummary', 'skipPrompt', false),
            onChanged: (v) =>
                _updateNestedSetting('branchSummary', 'skipPrompt', v),
          ),
          _NumberRow(
            label: 'Reserve Tokens',
            value: _nestedInt(settings, 'branchSummary', 'reserveTokens', 8192),
            min: 1024,
            max: 32768,
            step: 1024,
            onChanged: (v) =>
                _updateNestedSetting('branchSummary', 'reserveTokens', v),
          ),

          const SizedBox(height: 16),
          // ── Display ───────────────────────────────────────────
          const _SectionTitle(title: 'Display'),
          _ToggleRow(
            label: 'Hide Thinking Block',
            value: settings['hideThinkingBlock'] as bool? ?? false,
            onChanged: (v) => _updateSetting('hideThinkingBlock', v),
          ),
          _ToggleRow(
            label: 'Block Images',
            value: _nestedBool(settings, 'images', 'blockImages', false),
            onChanged: (v) => _updateNestedSetting('images', 'blockImages', v),
          ),
          _ToggleRow(
            label: 'Auto-Resize Images',
            value: _nestedBool(settings, 'images', 'autoResize', true),
            onChanged: (v) => _updateNestedSetting('images', 'autoResize', v),
          ),

          const SizedBox(height: 16),
          // ── Model & Transport ─────────────────────────────────
          const _SectionTitle(title: 'Model & Transport'),
          _DropdownRow(
            label: 'API Transport',
            value: settings['transport'] as String? ?? 'auto',
            options: const ['auto', 'sse', 'websocket'],
            onChanged: (v) => _updateSetting('transport', v),
          ),
          _TextRow(
            label: 'Enabled Models',
            hint: 'e.g. anthropic/*,openai/gpt-5*',
            value: _joinedList(settings, 'enabledModels'),
            onChanged: (v) => _updateSetting(
              'enabledModels',
              v.isEmpty
                  ? null
                  : v
                        .split(',')
                        .map((s) => s.trim())
                        .where((s) => s.isNotEmpty)
                        .toList(),
            ),
          ),

          const SizedBox(height: 16),
          // ── Thinking Budgets ──────────────────────────────────
          const _SectionTitle(title: 'Thinking Budgets'),
          _NumberRow(
            label: 'Minimal',
            value: _nestedInt(settings, 'thinkingBudgets', 'minimal', 1024),
            min: 128,
            max: 65536,
            step: 256,
            onChanged: (v) =>
                _updateNestedSetting('thinkingBudgets', 'minimal', v),
          ),
          _NumberRow(
            label: 'Low',
            value: _nestedInt(settings, 'thinkingBudgets', 'low', 4096),
            min: 128,
            max: 65536,
            step: 512,
            onChanged: (v) => _updateNestedSetting('thinkingBudgets', 'low', v),
          ),
          _NumberRow(
            label: 'Medium',
            value: _nestedInt(settings, 'thinkingBudgets', 'medium', 10240),
            min: 128,
            max: 131072,
            step: 1024,
            onChanged: (v) =>
                _updateNestedSetting('thinkingBudgets', 'medium', v),
          ),
          _NumberRow(
            label: 'High',
            value: _nestedInt(settings, 'thinkingBudgets', 'high', 32768),
            min: 128,
            max: 131072,
            step: 1024,
            onChanged: (v) =>
                _updateNestedSetting('thinkingBudgets', 'high', v),
          ),
          _NumberRow(
            label: 'Xhigh',
            value: _nestedInt(settings, 'thinkingBudgets', 'xhigh', 65536),
            min: 1024,
            max: 131072,
            step: 2048,
            onChanged: (v) =>
                _updateNestedSetting('thinkingBudgets', 'xhigh', v),
          ),

          const SizedBox(height: 24),
          // ── Save Button ───────────────────────────────────────
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: _saving ? null : _saveSettings,
              child: _saving
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Save Settings'),
            ),
          ),
          const SizedBox(height: 24),
        ],
      ),
    );
  }

  int _nestedInt(
    Map<String, dynamic> settings,
    String parent,
    String key,
    int fallback,
  ) {
    final nested = settings[parent] as Map<String, dynamic>?;
    return nested?[key] as int? ?? fallback;
  }

  bool _nestedBool(
    Map<String, dynamic> settings,
    String parent,
    String key,
    bool fallback,
  ) {
    final nested = settings[parent] as Map<String, dynamic>?;
    return nested?[key] as bool? ?? fallback;
  }

  String _joinedList(Map<String, dynamic> settings, String key) {
    final value = settings[key];
    if (value is List) {
      return value.whereType<String>().join(', ');
    }
    return '';
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 8, bottom: 4),
      child: Text(
        title.toUpperCase(),
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
          color: Theme.of(context).colorScheme.onSurfaceVariant,
          letterSpacing: 0.8,
        ),
      ),
    );
  }
}

class _ToggleRow extends StatelessWidget {
  const _ToggleRow({
    required this.label,
    required this.value,
    required this.onChanged,
  });

  final String label;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return SwitchListTile(
      dense: true,
      contentPadding: EdgeInsets.zero,
      title: Text(label, style: Theme.of(context).textTheme.bodyMedium),
      value: value,
      onChanged: onChanged,
    );
  }
}

class _NumberRow extends StatelessWidget {
  const _NumberRow({
    required this.label,
    required this.value,
    required this.onChanged,
    this.min = 0,
    this.max = 100000,
    this.step = 1,
  });

  final String label;
  final int value;
  final ValueChanged<int> onChanged;
  final int min;
  final int max;
  final int step;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Expanded(
            child: Text(label, style: Theme.of(context).textTheme.bodyMedium),
          ),
          IconButton(
            icon: const Icon(Icons.remove, size: 18),
            visualDensity: VisualDensity.compact,
            onPressed: value > min
                ? () => onChanged((value - step).clamp(min, max))
                : null,
          ),
          SizedBox(
            width: 60,
            child: Text(
              _formatNumber(value),
              textAlign: TextAlign.center,
              style: Theme.of(
                context,
              ).textTheme.bodyMedium?.copyWith(fontFamily: 'monospace'),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.add, size: 18),
            visualDensity: VisualDensity.compact,
            onPressed: value < max
                ? () => onChanged((value + step).clamp(min, max))
                : null,
          ),
        ],
      ),
    );
  }

  String _formatNumber(int n) {
    if (n >= 1000) {
      return '${(n / 1000).toStringAsFixed(n % 1000 == 0 ? 0 : 1)}K';
    }
    return n.toString();
  }
}

class _DropdownRow extends StatelessWidget {
  const _DropdownRow({
    required this.label,
    required this.value,
    required this.options,
    required this.onChanged,
  });

  final String label;
  final String value;
  final List<String> options;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Expanded(
            child: Text(label, style: Theme.of(context).textTheme.bodyMedium),
          ),
          DropdownButton<String>(
            value: options.contains(value) ? value : options.first,
            isDense: true,
            underline: const SizedBox.shrink(),
            items: options
                .map((o) => DropdownMenuItem(value: o, child: Text(o)))
                .toList(),
            onChanged: (v) {
              if (v != null) onChanged(v);
            },
          ),
        ],
      ),
    );
  }
}

class _TextRow extends StatefulWidget {
  const _TextRow({
    required this.label,
    required this.value,
    required this.onChanged,
    this.hint,
  });

  final String label;
  final String value;
  final ValueChanged<String> onChanged;
  final String? hint;

  @override
  State<_TextRow> createState() => _TextRowState();
}

class _TextRowState extends State<_TextRow> {
  late final TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.value);
  }

  @override
  void didUpdateWidget(_TextRow old) {
    super.didUpdateWidget(old);
    if (old.value != widget.value && _controller.text != widget.value) {
      _controller.text = widget.value;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(widget.label, style: Theme.of(context).textTheme.bodyMedium),
          const SizedBox(height: 4),
          TextField(
            controller: _controller,
            decoration: InputDecoration(
              hintText: widget.hint,
              isDense: true,
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 8,
                vertical: 8,
              ),
              border: const OutlineInputBorder(),
            ),
            style: Theme.of(
              context,
            ).textTheme.bodySmall?.copyWith(fontFamily: 'monospace'),
            onChanged: widget.onChanged,
          ),
        ],
      ),
    );
  }
}
