import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/terminal_settings_provider.dart';
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
        padding: const EdgeInsets.all(16),
        children: [
          _Section(
            title: 'Appearance',
            children: [
              _SliderTile(
                title: 'Font size',
                value: settings.fontSize,
                min: 10,
                max: 18,
                divisions: 16,
                onChanged: (v) => notifier.setFontSize(v),
                label: settings.fontSize.toStringAsFixed(0),
              ),
              _SliderTile(
                title: 'Scrollback lines',
                value: settings.maxLines.toDouble(),
                min: 1000,
                max: 50000,
                divisions: 49,
                onChanged: (v) => notifier.setMaxLines(v.round()),
                label: settings.maxLines.toString(),
              ),
            ],
          ),
          const SizedBox(height: 12),
          _Section(
            title: 'Controls',
            children: [
              _SwitchTile(
                title: 'Quick toolbar',
                subtitle: 'Shows Esc/Tab/Arrows/Ctrl shortcuts',
                value: settings.showQuickToolbar,
                onChanged: notifier.setShowQuickToolbar,
              ),
              _SwitchTile(
                title: 'Selection toolbar',
                subtitle: 'Shows Copy/Select All when text is selected',
                value: settings.showSelectionToolbar,
                onChanged: notifier.setShowSelectionToolbar,
              ),
              _SwitchTile(
                title: 'Normalize smart quotes',
                subtitle: 'Replaces “ ” ‘ ’ with " and \' for shells',
                value: settings.normalizeSmartQuotes,
                onChanged: notifier.setNormalizeSmartQuotes,
              ),
              _SwitchTile(
                title: 'Hardware keyboard only',
                subtitle: 'Disables the on-screen keyboard',
                value: settings.hardwareKeyboardOnly,
                onChanged: notifier.setHardwareKeyboardOnly,
              ),
              _SwitchTile(
                title: 'Delete detection',
                subtitle: 'Improves backspace handling on mobile keyboards',
                value: settings.deleteDetection,
                onChanged: notifier.setDeleteDetection,
              ),
            ],
          ),
          const SizedBox(height: 12),
          _Section(
            title: 'Performance',
            children: [
              _SliderTile(
                title: 'Input batching (ms)',
                value: settings.inputBatchMs.toDouble(),
                min: 0,
                max: 50,
                divisions: 50,
                onChanged: (v) => notifier.setInputBatchMs(v.round()),
                label: '${settings.inputBatchMs}ms',
              ),
              _SliderTile(
                title: 'Output throttling (ms)',
                value: settings.outputBatchMs.toDouble(),
                min: 0,
                max: 50,
                divisions: 50,
                onChanged: (v) => notifier.setOutputBatchMs(v.round()),
                label: '${settings.outputBatchMs}ms',
              ),
              _SwitchTile(
                title: 'Binary output detection',
                subtitle: 'Shows a warning when output looks non-text',
                value: settings.enableBinaryDetection,
                onChanged: notifier.setEnableBinaryDetection,
              ),
            ],
          ),
        ],
      ),
    );
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
        borderRadius: BorderRadius.circular(14),
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
          : Text(subtitle!, style: TextStyle(color: ocTheme.textMuted)),
      activeThumbColor: ocTheme.primary,
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
              Text(label, style: TextStyle(color: ocTheme.textMuted)),
            ],
          ),
          Slider(
            value: value.clamp(min, max),
            min: min,
            max: max,
            divisions: divisions,
            onChanged: onChanged,
            activeColor: ocTheme.primary,
            inactiveColor: ocTheme.borderSubtle,
          ),
        ],
      ),
    );
  }
}
