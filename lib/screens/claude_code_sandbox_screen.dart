
import 'package:flutter/material.dart';
import '../theme/app_typography.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/claude_code.dart';
import '../providers/claude_code_provider.dart';
import '../theme/design_tokens.dart';
import '../theme/opencode_theme.dart';
import '../utils/responsive.dart';
import '../widgets/adaptive_container.dart';
import 'package:broski/theme/app_icons.dart';
/// Dedicated Sandbox configuration screen for Claude Code.
/// Surfaces all fields from SDK SandboxSettings + NetworkSandboxSettings.
class ClaudeCodeSandboxScreen extends ConsumerStatefulWidget {
  const ClaudeCodeSandboxScreen({super.key});
  @override
  ConsumerState<ClaudeCodeSandboxScreen> createState() =>
      _ClaudeCodeSandboxScreenState();
}
class _ClaudeCodeSandboxScreenState
    extends ConsumerState<ClaudeCodeSandboxScreen> {
  bool _saving = false;
  ClaudeCodeSandboxSettings _sandbox = const ClaudeCodeSandboxSettings();
  @override
  void initState() {
    super.initState();
    _loadCurrent();
  }
  void _loadCurrent() {
    final config = ref.read(ccConfigProvider).valueOrNull;
    if (config?.sandbox != null) {
      setState(() => _sandbox = config!.sandbox!);
    }
  }
  Future<void> _save(ClaudeCodeSandboxSettings next) async {
    setState(() {
      _sandbox = next;
      _saving = true;
    });
    try {
      final config = ref.read(ccConfigProvider).valueOrNull;
      if (config != null) {
        await ref
            .read(ccConfigProvider.notifier)
            .updateConfig(config.copyWith(sandbox: next));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }
  /// Helper: create a new sandbox settings preserving all current values.
  ClaudeCodeSandboxSettings _with({
    bool? enabled,
    bool? autoAllowBashIfSandboxed,
    bool? allowUnsandboxedCommands,
    bool? enableWeakerNestedSandbox,
    List<String>? excludedCommands,
    ClaudeCodeSandboxNetworkConfig? network,
  }) {
    return ClaudeCodeSandboxSettings(
      enabled: enabled ?? _sandbox.enabled,
      autoAllowBashIfSandboxed:
          autoAllowBashIfSandboxed ?? _sandbox.autoAllowBashIfSandboxed,
      allowUnsandboxedCommands:
          allowUnsandboxedCommands ?? _sandbox.allowUnsandboxedCommands,
      network: network ?? _sandbox.network,
      ignoreViolations: _sandbox.ignoreViolations,
      enableWeakerNestedSandbox:
          enableWeakerNestedSandbox ?? _sandbox.enableWeakerNestedSandbox,
      excludedCommands: excludedCommands ?? _sandbox.excludedCommands,
    );
  }
  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Scaffold(
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: theme.background,
        foregroundColor: theme.text,
        title: const Text('Sandbox Configuration'),
        actions: [
          if (_saving)
            const Padding(
              padding: Insets.card,
              child: SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            ),
        ],
      ),
      body: AdaptiveContainer(
        width: ContentWidth.standard,
        child: ListView(
        padding: Insets.card,
        children: [
          // Info banner
          Container(
            padding: Insets.cardSm,
            decoration: BoxDecoration(
              color: theme.backgroundPanel,
              borderRadius: Radii.brMd,
              border: Border.all(
                color: theme.borderSubtle.withValues(alpha: 0.3),
              ),
            ),
            child: Row(
              children: [
                Icon(AppIcons.security, color: theme.accent, size: 20),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'Sandbox wraps bash commands in a restricted environment. '
                    'File and network access restrictions are configured via permission rules, not sandbox settings.',
                    style: AppTypography.label(color: theme.textMuted),
                  ),
                ),
              ],
            ),
          ),
          SizedBox(height: Spacing.lg),
          // Enable sandbox
          _buildCard(
            theme: theme,
            title: 'Sandbox Mode',
            child: SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: _sandbox.enabled ?? false,
              title: Text(
                'Enable sandbox',
                style: TextStyle(color: theme.text),
              ),
              subtitle: Text(
                'Run all bash commands in a sandboxed environment.',
                style: AppTypography.label(color: theme.textMuted),
              ),
              onChanged: (v) => _save(_with(enabled: v)),
            ),
          ),
          // Auto-allow bash if sandboxed
          _buildCard(
            theme: theme,
            title: 'Auto-Allow Bash',
            child: SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: _sandbox.autoAllowBashIfSandboxed ?? false,
              title: Text(
                'Auto-allow bash in sandbox',
                style: TextStyle(color: theme.text),
              ),
              subtitle: Text(
                'Skip permission prompts for bash commands when sandbox is active.',
                style: AppTypography.label(color: theme.textMuted),
              ),
              onChanged: (v) => _save(_with(autoAllowBashIfSandboxed: v)),
            ),
          ),
          // Allow unsandboxed commands
          _buildCard(
            theme: theme,
            title: 'Unsandboxed Commands',
            child: SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: _sandbox.allowUnsandboxedCommands ?? false,
              title: Text(
                'Allow unsandboxed commands',
                style: TextStyle(color: theme.text),
              ),
              subtitle: Text(
                'Let Claude request running commands outside the sandbox '
                '(falls back to permission system for approval).',
                style: AppTypography.label(color: theme.textMuted),
              ),
              onChanged: (v) => _save(_with(allowUnsandboxedCommands: v)),
            ),
          ),
          // Weaker nested sandbox
          _buildCard(
            theme: theme,
            title: 'Nested Sandbox',
            child: SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: _sandbox.enableWeakerNestedSandbox ?? false,
              title: Text(
                'Enable weaker nested sandbox',
                style: TextStyle(color: theme.text),
              ),
              subtitle: Text(
                'Use a less restrictive sandbox when already inside a sandboxed environment (e.g. Docker).',
                style: AppTypography.label(color: theme.textMuted),
              ),
              onChanged: (v) => _save(_with(enableWeakerNestedSandbox: v)),
            ),
          ),
          // Excluded commands
          _buildCard(
            theme: theme,
            title: 'Excluded Commands',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Commands that always bypass the sandbox and run directly on the host.',
                  style: AppTypography.label(color: theme.textMuted),
                ),
                SizedBox(height: Spacing.sm),
                _buildChipList(
                  theme: theme,
                  items: _sandbox.excludedCommands ?? [],
                  onAdd: () => _showAddItemDialog(
                    theme,
                    title: 'Add Excluded Command',
                    hint: 'e.g. docker, npm',
                    onSave: (value) {
                      final next = List<String>.from(
                        _sandbox.excludedCommands ?? [],
                      )..add(value);
                      _save(_with(excludedCommands: next));
                    },
                  ),
                  onRemove: (item) {
                    final next = List<String>.from(
                      _sandbox.excludedCommands ?? [],
                    )..remove(item);
                    _save(_with(excludedCommands: next.isEmpty ? null : next));
                  },
                ),
              ],
            ),
          ),
          // Network configuration
          _buildCard(
            theme: theme,
            title: 'Network',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Network controls for sandboxed commands.',
                  style: AppTypography.label(color: theme.textMuted),
                ),
                SizedBox(height: Spacing.sm),
                // Local binding
                SwitchListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  value: _sandbox.network?.allowLocalBinding ?? false,
                  title: Text(
                    'Allow local binding',
                    style: AppTypography.bodySmall(color: theme.text),
                  ),
                  subtitle: Text(
                    'Allow processes to bind to local ports (e.g. dev servers).',
                    style: AppTypography.caption(color: theme.textMuted),
                  ),
                  onChanged: (v) => _save(
                    _with(
                      network: ClaudeCodeSandboxNetworkConfig(
                        allowLocalBinding: v,
                        allowUnixSockets: _sandbox.network?.allowUnixSockets,
                        allowAllUnixSockets:
                            _sandbox.network?.allowAllUnixSockets,
                        httpProxyPort: _sandbox.network?.httpProxyPort,
                        socksProxyPort: _sandbox.network?.socksProxyPort,
                      ),
                    ),
                  ),
                ),
                // All unix sockets
                SwitchListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  value: _sandbox.network?.allowAllUnixSockets ?? false,
                  title: Text(
                    'Allow all unix sockets',
                    style: AppTypography.bodySmall(color: theme.text),
                  ),
                  subtitle: Text(
                    'Allow access to all unix sockets. Use with caution — e.g. Docker socket grants host access.',
                    style: AppTypography.caption(color: theme.textMuted),
                  ),
                  onChanged: (v) => _save(
                    _with(
                      network: ClaudeCodeSandboxNetworkConfig(
                        allowAllUnixSockets: v,
                        allowLocalBinding: _sandbox.network?.allowLocalBinding,
                        allowUnixSockets: _sandbox.network?.allowUnixSockets,
                        httpProxyPort: _sandbox.network?.httpProxyPort,
                        socksProxyPort: _sandbox.network?.socksProxyPort,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 80),
        ],
      ),
      ),
    );
  }
  Widget _buildCard({
    required OpenCodeTheme theme,
    required String title,
    required Widget child,
  }) {
    return Padding(
      padding: Insets.bottomMd,
      child: Card(
        color: theme.backgroundPanel,
        shape: RoundedRectangleBorder(
          borderRadius: Radii.brLg,
          side: BorderSide(color: theme.borderSubtle.withValues(alpha: 0.2)),
        ),
        child: Padding(
          padding: Insets.cardMd,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: TextStyle(
                  color: theme.text,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 10),
              child,
            ],
          ),
        ),
      ),
    );
  }
  Widget _buildChipList({
    required OpenCodeTheme theme,
    required List<String> items,
    required VoidCallback onAdd,
    required void Function(String) onRemove,
  }) {
    return Wrap(
      spacing: 6,
      runSpacing: 6,
      children: [
        ...items.map(
          (item) => Chip(
            label: Text(
              item,
              style: AppTypography.label(color: theme.text),
            ),
            backgroundColor: theme.backgroundPanel,
            side: BorderSide(color: theme.borderSubtle.withValues(alpha: 0.3)),
            deleteIcon: Icon(
              AppIcons.close,
              size: 16,
              color: theme.textMuted,
            ),
            onDeleted: () => onRemove(item),
          ),
        ),
        ActionChip(
          avatar: Icon(AppIcons.add, size: 16, color: theme.accent),
          label: Text(
            'Add',
            style: AppTypography.label(color: theme.accent),
          ),
          backgroundColor: theme.backgroundPanel,
          side: BorderSide(color: theme.accent.withValues(alpha: 0.3)),
          onPressed: onAdd,
        ),
      ],
    );
  }
  void _showAddItemDialog(
    OpenCodeTheme theme, {
    required String title,
    required String hint,
    required void Function(String) onSave,
  }) {
    final controller = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: TextField(
          controller: controller,
          decoration: InputDecoration(hintText: hint),
          autofocus: true,
          onSubmitted: (value) {
            final trimmed = value.trim();
            if (trimmed.isNotEmpty) {
              onSave(trimmed);
              Navigator.pop(ctx);
            }
          },
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () {
              final trimmed = controller.text.trim();
              if (trimmed.isNotEmpty) {
                onSave(trimmed);
                Navigator.pop(ctx);
              }
            },
            child: const Text('Add'),
          ),
        ],
      ),
    ).then((_) => controller.dispose());
  }
}
