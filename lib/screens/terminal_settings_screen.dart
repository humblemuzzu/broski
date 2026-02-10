import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/terminal_settings_provider.dart';
import '../theme/design_tokens.dart';
import '../theme/opencode_theme.dart';

class TerminalSettingsScreen extends ConsumerWidget {
  const TerminalSettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ocTheme = OpenCodeTheme.of(context);
    final settings = ref.watch(terminalSettingsProvider);
    final notifier = ref.read(terminalSettingsProvider.notifier);

    return Scaffold(
      backgroundColor: ocTheme.background,
      appBar: AppBar(
        backgroundColor: ocTheme.background,
        elevation: 0,
        title: Text('Terminal Settings', style: TextStyle(color: ocTheme.text)),
        iconTheme: IconThemeData(color: ocTheme.text),
      ),
      body: ListView(
        padding: Insets.card,
        children: [
          // Performance info box
          Container(
            padding: Insets.cardMd,
            decoration: BoxDecoration(
              color: ocTheme.success.withValues(alpha: 0.1),
              borderRadius: Radii.brMd,
              border: Border.all(color: ocTheme.success.withValues(alpha: 0.3)),
            ),
            child: Row(
              children: [
                Icon(Icons.bolt, color: ocTheme.success, size: 20),
                SizedBox(width: Spacing.md),
                Expanded(
                  child: Text(
                    'Smart mode active - instant response for typing, auto-throttle for high output',
                    style: TextStyle(
                      color: ocTheme.success,
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
              ],
            ),
          ),
          SizedBox(height: Spacing.lg),
          _Section(
            title: 'Appearance',
            children: [
              _SliderTile(
                title: 'Font size',
                value: settings.fontSize,
                min: 10,
                max: 24,
                divisions: 14,
                onChanged: (v) => notifier.setFontSize(v),
                label: settings.fontSize.toStringAsFixed(0),
              ),
              _SliderTile(
                title: 'Scrollback lines',
                value: settings.maxLines.toDouble(),
                min: 1000,
                max: 100000,
                divisions: 99,
                onChanged: (v) => notifier.setMaxLines(v.round()),
                label: _formatNumber(settings.maxLines),
              ),
            ],
          ),
          SizedBox(height: Spacing.md),
          _Section(
            title: 'Toolbars',
            children: [
              _SwitchTile(
                title: 'Quick toolbar',
                subtitle: 'Esc, Tab, Arrows, Ctrl+C/D shortcuts',
                value: settings.showQuickToolbar,
                onChanged: notifier.setShowQuickToolbar,
              ),
              _SwitchTile(
                title: 'Selection toolbar',
                subtitle: 'Copy/Select All when text selected',
                value: settings.showSelectionToolbar,
                onChanged: notifier.setShowSelectionToolbar,
              ),
            ],
          ),
          SizedBox(height: Spacing.md),
          _Section(
            title: 'Input',
            children: [
              _SwitchTile(
                title: 'Fix smart quotes',
                subtitle: 'Convert iOS curly quotes to straight quotes',
                value: settings.normalizeSmartQuotes,
                onChanged: notifier.setNormalizeSmartQuotes,
              ),
              _SwitchTile(
                title: 'Delete detection',
                subtitle: 'Better backspace on mobile keyboards',
                value: settings.deleteDetection,
                onChanged: notifier.setDeleteDetection,
              ),
              _SwitchTile(
                title: 'Hardware keyboard only',
                subtitle: 'Disable on-screen keyboard',
                value: settings.hardwareKeyboardOnly,
                onChanged: notifier.setHardwareKeyboardOnly,
              ),
            ],
          ),
        ],
      ),
    );
  }

  String _formatNumber(int n) {
    if (n >= 1000) {
      return '${(n / 1000).toStringAsFixed(n % 1000 == 0 ? 0 : 1)}k';
    }
    return n.toString();
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.children});

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return Container(
      decoration: BoxDecoration(
        color: ocTheme.backgroundPanel,
        borderRadius: Radii.brLg,
        border: Border.all(color: ocTheme.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
            child: Text(
              title,
              style: TextStyle(
                color: ocTheme.text,
                fontSize: 14,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          ...children,
        ],
      ),
    );
  }
}

class _SwitchTile extends StatelessWidget {
  const _SwitchTile({
    required this.title,
    required this.value,
    required this.onChanged,
    this.subtitle,
  });

  final String title;
  final String? subtitle;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return SwitchListTile(
      value: value,
      onChanged: onChanged,
      title: Text(title, style: TextStyle(color: ocTheme.text)),
      subtitle: subtitle == null
          ? null
          : Text(
              subtitle!,
              style: TextStyle(color: ocTheme.textMuted, fontSize: 12),
            ),
      activeTrackColor: ocTheme.primary.withValues(alpha: 0.4),
      activeColor: ocTheme.primary,
      inactiveTrackColor: ocTheme.borderSubtle,
    );
  }
}

class _SliderTile extends StatelessWidget {
  const _SliderTile({
    required this.title,
    required this.value,
    required this.min,
    required this.max,
    required this.divisions,
    required this.onChanged,
    required this.label,
  });

  final String title;
  final double value;
  final double min;
  final double max;
  final int divisions;
  final ValueChanged<double> onChanged;
  final String label;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 6, 16, 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(title, style: TextStyle(color: ocTheme.text)),
              ),
              Container(
                padding: Insets.chip,
                decoration: BoxDecoration(
                  color: ocTheme.primary.withValues(alpha: 0.15),
                  borderRadius: Radii.brSm,
                ),
                child: Text(
                  label,
                  style: TextStyle(
                    color: ocTheme.primary,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
          SizedBox(height: Spacing.xs),
          SliderTheme(
            data: SliderTheme.of(context).copyWith(
              trackHeight: 4,
              thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 8),
            ),
            child: Slider(
              value: value.clamp(min, max),
              min: min,
              max: max,
              divisions: divisions,
              onChanged: onChanged,
            ),
          ),
        ],
      ),
    );
  }
}
