import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/service_providers.dart';
import '../theme/app_typography.dart';
import '../theme/design_tokens.dart';
import '../theme/opencode_theme.dart';
import '../utils/error_utils.dart';
import '../utils/responsive.dart';
import '../widgets/adaptive_container.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/utils/snackbar_helpers.dart';

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
