import 'dart:convert';

import 'package:broski/providers/service_providers.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/error_utils.dart';
import 'package:broski/utils/responsive.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:broski/widgets/adaptive_container.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// View and edit OpenCode global configuration.
class OpenCodeGlobalConfigScreen extends ConsumerStatefulWidget {
  const OpenCodeGlobalConfigScreen({super.key});
  @override
  ConsumerState<OpenCodeGlobalConfigScreen> createState() => _State();
}

class _State extends ConsumerState<OpenCodeGlobalConfigScreen> {
  var _loading = true, _saving = false;
  String? _error;
  Map<String, dynamic> _config = const {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final cfg = await ref.read(bridgeServiceProvider).getGlobalConfig();
      if (!mounted) return;
      setState(() {
        _config = cfg;
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

  Map<String, dynamic> _compaction() {
    final c = _config['compaction'];
    return c is Map ? c.cast<String, dynamic>() : {};
  }

  bool get _autoCompact => _compaction()['auto'] as bool? ?? true;
  bool get _prune => _compaction()['prune'] as bool? ?? true;
  String get _model => _config['model'] as String? ?? '';
  String get _provider => _config['provider'] as String? ?? '';
  String get _smallModel => _config['small_model'] as String? ?? '';
  String get _defaultAgent => _config['default_agent'] as String? ?? '';
  bool get _snapshot => _config['snapshot'] as bool? ?? true;
  List<String> get _disabledProviders {
    final v = _config['disabled_providers'];
    return v is List ? v.whereType<String>().toList() : [];
  }

  List<String> get _instructions {
    final v = _config['instructions'];
    return v is List ? v.whereType<String>().toList() : [];
  }

  String get _shareMode {
    final s = _config['share'];
    return s is String && const {'manual', 'auto', 'disabled'}.contains(s)
        ? s
        : 'manual';
  }

  Future<void> _save(Map<String, dynamic> patch) async {
    if (_saving) return;
    setState(() => _saving = true);
    try {
      final merged = <String, dynamic>{..._config, ...patch};
      final res = await ref.read(bridgeServiceProvider).setGlobalConfig(merged);
      if (!mounted) return;
      setState(() => _config = res.isNotEmpty ? res : merged);
    } catch (e) {
      if (!mounted) return;
      showError(context, 'Failed to save: ${humanizeError(e)}');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _setBool(String section, String key, bool v) {
    final cur = _config[section] is Map
        ? (_config[section] as Map).cast<String, dynamic>()
        : <String, dynamic>{};
    _save({
      section: {...cur, key: v},
    });
  }

  void _setTopLevelBool(String key, bool v) => _save({key: v});

  // OpenCode's config.update treats null values as "remove this key".
  void _setTopLevelString(String key, String v) =>
      _save({key: v.isEmpty ? null : v});

  void _showRawJson() {
    final oc = OpenCodeTheme.of(context);
    final text = const JsonEncoder.withIndent('  ').convert(_config);
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: oc.backgroundPanel,
        title: Text('Raw Config', style: TextStyle(color: oc.text)),
        content: SizedBox(
          width: double.maxFinite,
          height: 400,
          child: SingleChildScrollView(
            child: SelectableText(
              text,
              style: TextStyle(
                fontFamily: 'monospace',
                fontSize: 12,
                color: oc.text,
              ),
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () {
              Clipboard.setData(ClipboardData(text: text));
              showInfo(context, 'Copied');
            },
            child: const Text('Copy'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final oc = OpenCodeTheme.of(context);
    final busy = _loading || _saving;
    return Scaffold(
      backgroundColor: oc.background,
      appBar: AppBar(
        backgroundColor: oc.background,
        elevation: 0,
        iconTheme: IconThemeData(color: oc.text),
        title: Text('Global Configuration', style: TextStyle(color: oc.text)),
        actions: [
          IconButton(
            icon: busy
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(AppIcons.refresh),
            tooltip: 'Refresh',
            onPressed: busy ? null : _load,
          ),
        ],
      ),
      body: AdaptiveContainer(
        width: ContentWidth.standard,
        child: SafeArea(child: _body(oc)),
      ),
    );
  }

  Widget _body(OpenCodeTheme oc) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Center(
        child: Padding(
          padding: Insets.cardLg,
          child: Text(_error!, style: TextStyle(color: oc.textMuted)),
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: Insets.screen,
        children: [
          _card(oc, 'Defaults', 'Current default model and provider.', [
            _row(oc, 'Model', _model.isEmpty ? '—' : _model),
            Divider(height: 1, color: oc.borderSubtle),
            _row(oc, 'Provider', _provider.isEmpty ? '—' : _provider),
            Divider(height: 1, color: oc.borderSubtle),
            _editableRow(
              oc,
              'Title Model',
              _smallModel,
              'e.g. openai/gpt-4o-mini',
              (v) => _setTopLevelString('small_model', v),
            ),
            Divider(height: 1, color: oc.borderSubtle),
            _editableRow(
              oc,
              'Default Agent',
              _defaultAgent,
              'e.g. build',
              (v) => _setTopLevelString('default_agent', v),
            ),
          ]),
          const SizedBox(height: Spacing.lg),
          _card(oc, 'Session Behavior', 'Context compaction and pruning.', [
            _sw(
              oc,
              'Auto compact',
              'Compact long sessions automatically.',
              _autoCompact,
              (v) => _setBool('compaction', 'auto', v),
            ),
            _sw(
              oc,
              'Prune old tool output',
              'Drop stale tool output.',
              _prune,
              (v) => _setBool('compaction', 'prune', v),
            ),
          ]),
          const SizedBox(height: Spacing.lg),
          _card(oc, 'Features', 'Enable or disable OpenCode features.', [
            _sw(
              oc,
              'Snapshots',
              'Track filesystem state for undo/revert.',
              _snapshot,
              (v) => _setTopLevelBool('snapshot', v),
            ),
          ]),
          const SizedBox(height: Spacing.lg),
          _card(oc, 'Share Mode', 'Session sharing defaults.', [
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final m in _shareModes)
                  ChoiceChip(
                    selected: _shareMode == m.$1,
                    onSelected: _saving || _shareMode == m.$1
                        ? null
                        : (_) => _save({'share': m.$1}),
                    label: Text(m.$2),
                    tooltip: m.$3,
                    labelStyle: TextStyle(
                      color: _shareMode == m.$1 ? oc.background : oc.text,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                    selectedColor: oc.primary,
                    backgroundColor: oc.background,
                    shape: RoundedRectangleBorder(
                      borderRadius: Radii.brMd,
                      side: BorderSide(color: oc.borderSubtle),
                    ),
                  ),
              ],
            ),
          ]),
          const SizedBox(height: Spacing.lg),
          if (_disabledProviders.isNotEmpty)
            _card(
              oc,
              'Disabled Providers',
              'Providers excluded from auto-loading.',
              [
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: _disabledProviders
                      .map(
                        (p) => Chip(
                          label: Text(
                            p,
                            style: TextStyle(color: oc.text, fontSize: 12),
                          ),
                          deleteIcon: Icon(
                            AppIcons.close,
                            size: 14,
                            color: oc.textMuted,
                          ),
                          onDeleted: _saving
                              ? null
                              : () {
                                  final updated = List<String>.from(
                                    _disabledProviders,
                                  )..remove(p);
                                  _save({'disabled_providers': updated});
                                },
                          backgroundColor: oc.backgroundElement,
                          side: BorderSide(color: oc.borderSubtle),
                        ),
                      )
                      .toList(),
                ),
              ],
            ),
          if (_disabledProviders.isNotEmpty) const SizedBox(height: Spacing.lg),
          if (_instructions.isNotEmpty)
            _card(
              oc,
              'Instructions',
              'Additional instruction files loaded by the agent.',
              [
                ...(_instructions).map(
                  (i) => Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Row(
                      children: [
                        Icon(
                          AppIcons.description,
                          size: 14,
                          color: oc.textMuted,
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            i,
                            style: TextStyle(
                              color: oc.text,
                              fontSize: 12,
                              fontFamily: 'monospace',
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          if (_instructions.isNotEmpty) const SizedBox(height: Spacing.lg),
          _card(oc, 'Advanced', 'View full raw configuration.', [
            ListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              leading: Icon(AppIcons.braces, size: 18, color: oc.textMuted),
              title: Text(
                'Raw JSON',
                style: TextStyle(color: oc.text, fontSize: 13),
              ),
              trailing: Icon(
                AppIcons.chevronRight,
                size: 16,
                color: oc.textMuted,
              ),
              onTap: _showRawJson,
            ),
          ]),
          const SizedBox(height: Spacing.lg),
          Text(
            'These settings apply across all OpenCode projects.',
            style: AppTypography.label(color: oc.textMuted),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: Spacing.lg),
        ],
      ),
    );
  }

  Widget _card(OpenCodeTheme oc, String title, String sub, List<Widget> ch) =>
      Card(
        color: oc.backgroundElement,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: Radii.brMd,
          side: BorderSide(color: oc.border),
        ),
        child: Padding(
          padding: Insets.card,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: TextStyle(
                  color: oc.text,
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: Spacing.xxs),
              Text(sub, style: AppTypography.label(color: oc.textMuted)),
              const SizedBox(height: Spacing.md),
              ...ch,
            ],
          ),
        ),
      );

  Widget _sw(
    OpenCodeTheme oc,
    String t,
    String s,
    bool v,
    ValueChanged<bool> cb,
  ) => SwitchListTile(
    value: v,
    onChanged: _saving ? null : cb,
    dense: true,
    contentPadding: EdgeInsets.zero,
    title: Text(
      t,
      style: TextStyle(
        color: oc.text,
        fontSize: 13,
        fontWeight: FontWeight.w600,
      ),
    ),
    subtitle: Text(s, style: AppTypography.label(color: oc.textMuted)),
    activeThumbColor: oc.primary,
  );

  Widget _editableRow(
    OpenCodeTheme oc,
    String label,
    String currentValue,
    String hint,
    ValueChanged<String> onSave,
  ) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(
        children: [
          Text(
            label,
            style: TextStyle(
              color: oc.textMuted,
              fontSize: 13,
              fontWeight: FontWeight.w600,
            ),
          ),
          const Spacer(),
          GestureDetector(
            onTap: _saving
                ? null
                : () async {
                    final controller = TextEditingController(
                      text: currentValue,
                    );
                    final result = await showDialog<String>(
                      context: context,
                      builder: (ctx) => AlertDialog(
                        backgroundColor: oc.backgroundPanel,
                        title: Text(label, style: TextStyle(color: oc.text)),
                        content: TextField(
                          controller: controller,
                          style: TextStyle(color: oc.text, fontSize: 13),
                          decoration: InputDecoration(
                            hintText: hint,
                            hintStyle: TextStyle(color: oc.textMuted),
                          ),
                          autofocus: true,
                          onSubmitted: (v) => Navigator.pop(ctx, v),
                        ),
                        actions: [
                          TextButton(
                            onPressed: () => Navigator.pop(ctx),
                            child: const Text('Cancel'),
                          ),
                          TextButton(
                            onPressed: () =>
                                Navigator.pop(ctx, controller.text),
                            child: const Text('Save'),
                          ),
                        ],
                      ),
                    );
                    if (result != null) onSave(result);
                  },
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  currentValue.isEmpty ? hint : currentValue,
                  style: TextStyle(
                    color: currentValue.isEmpty ? oc.textMuted : oc.text,
                    fontSize: 13,
                  ),
                ),
                const SizedBox(width: 4),
                Icon(AppIcons.edit, size: 12, color: oc.textMuted),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _row(OpenCodeTheme oc, String label, String value) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 10),
    child: Row(
      children: [
        Text(
          label,
          style: TextStyle(
            color: oc.textMuted,
            fontSize: 13,
            fontWeight: FontWeight.w600,
          ),
        ),
        const Spacer(),
        Flexible(
          child: Text(
            value,
            style: TextStyle(color: oc.text, fontSize: 13),
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    ),
  );
}

const _shareModes = [
  ('manual', 'Manual', 'Share links only when explicitly requested.'),
  ('auto', 'Auto', 'Automatically enable session sharing.'),
  ('disabled', 'Disabled', 'Disable session sharing entirely.'),
];
