import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/pi_provider.dart';
import '../../widgets/chat/detail_sheet.dart';

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
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Settings saved')));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Failed to save: $e')));
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
