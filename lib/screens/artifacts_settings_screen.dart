import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/artifacts_settings.dart';
import '../models/agent_type.dart';
import '../providers/artifacts_provider.dart';
import '../providers/artifacts_settings_provider.dart';
import '../providers/agent_type_provider.dart';
import '../theme/opencode_theme.dart';

class ArtifactsSettingsScreen extends ConsumerWidget {
  const ArtifactsSettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ocTheme = OpenCodeTheme.of(context);
    final cfgAsync = ref.watch(artifactsConfigProvider);
    final statsAsync = ref.watch(artifactsStatsProvider);
    final agentType = ref.watch(agentTypeProvider);

    return Scaffold(
      backgroundColor: ocTheme.background,
      appBar: AppBar(
        backgroundColor: ocTheme.background,
        foregroundColor: ocTheme.text,
        elevation: 0,
        title: const Text('Artifacts Settings'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: () {
              ref.read(artifactsConfigProvider.notifier).load();
              ref.invalidate(artifactsStatsProvider);
            },
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: cfgAsync.when(
        data: (cfg) {
          final effectiveProvider = agentType == AgentType.claudeCode
              ? 'claude-code'
              : 'opencode';
          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
            children: [
              _SectionTitle(title: 'Indexing'),
              _Card(
                child: SwitchListTile(
                  value: cfg.indexingEnabled,
                  onChanged: (v) => ref
                      .read(artifactsConfigProvider.notifier)
                      .update(cfg.copyWith(indexingEnabled: v)),
                  title: const Text('Enable indexing'),
                  subtitle: const Text(
                    'When enabled, file writes/edits during chat are captured into the artifact index.',
                  ),
                ),
              ),
              const SizedBox(height: 14),
              _SectionTitle(title: 'AI Enrichment'),
              _Card(
                child: Column(
                  children: [
                    SwitchListTile(
                      value: cfg.enrichment.enabled,
                      onChanged: (v) => ref
                          .read(artifactsConfigProvider.notifier)
                          .update(cfg.copyWithEnrichment(enabled: v)),
                      title: const Text('Enable summaries & smart tags'),
                      subtitle: const Text(
                        'Uses your local providers. Can consume API credits depending on the chosen provider.',
                      ),
                    ),
                    const Divider(height: 1),
                    SwitchListTile(
                      value: cfg.enrichment.followSelectedAgent,
                      onChanged: (v) => ref
                          .read(artifactsConfigProvider.notifier)
                          .update(
                            cfg.copyWithEnrichment(followSelectedAgent: v),
                          ),
                      title: const Text('Follow selected AI backend'),
                      subtitle: Text(
                        cfg.enrichment.followSelectedAgent
                            ? 'Auto: ${_providerLabel(effectiveProvider)}'
                            : 'Manual selection (choose a provider below)',
                      ),
                    ),
                    const Divider(height: 1),
                    ListTile(
                      title: const Text('Provider'),
                      subtitle: Text(
                        cfg.enrichment.followSelectedAgent
                            ? 'Auto: ${_providerLabel(effectiveProvider)}'
                            : _providerLabel(cfg.enrichment.provider),
                      ),
                      trailing: const Icon(Icons.chevron_right_rounded),
                      onTap: cfg.enrichment.followSelectedAgent
                          ? null
                          : () => _pickProvider(context, ref, cfg),
                    ),
                    const Divider(height: 1),
                    ListTile(
                      title: const Text('Batch size'),
                      subtitle: Text(
                        '${cfg.enrichment.batchSize} artifacts per run',
                      ),
                      trailing: const Icon(Icons.chevron_right_rounded),
                      onTap: () => _pickBatchSize(context, ref, cfg),
                    ),
                    const Divider(height: 1),
                    ListTile(
                      title: const Text('Enrich now'),
                      subtitle: const Text(
                        'Process the newest unenriched artifacts in the background.',
                      ),
                      trailing: const Icon(Icons.auto_awesome_rounded),
                      onTap:
                          !cfg.enrichment.enabled ||
                              (!cfg.enrichment.followSelectedAgent &&
                                  cfg.enrichment.provider == 'off')
                          ? null
                          : () async {
                              final ok = await ref
                                  .read(artifactsConfigProvider.notifier)
                                  .enrichNow();
                              if (!context.mounted) return;
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(
                                  content: Text(
                                    ok
                                        ? 'Enrichment started'
                                        : 'Could not start enrichment',
                                  ),
                                  behavior: SnackBarBehavior.floating,
                                  backgroundColor: ocTheme.backgroundPanel,
                                ),
                              );
                              ref.read(artifactsProvider.notifier).refresh();
                            },
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 14),
              _SectionTitle(title: 'Stats'),
              _Card(
                child: statsAsync.when(
                  data: (stats) => Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        _StatRow(
                          label: 'Total',
                          value: '${stats.totalArtifacts}',
                        ),
                        const SizedBox(height: 8),
                        _StatRow(
                          label: 'Starred',
                          value: '${stats.starredArtifacts}',
                        ),
                        const SizedBox(height: 8),
                        _StatRow(
                          label: 'OpenCode',
                          value: '${stats.backends['opencode'] ?? 0}',
                        ),
                        const SizedBox(height: 8),
                        _StatRow(
                          label: 'Claude Code',
                          value: '${stats.backends['claude-code'] ?? 0}',
                        ),
                        const SizedBox(height: 12),
                        _StatRow(
                          label: 'DB size',
                          value: _bytes(stats.dbSizeBytes),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          stats.dbPath,
                          style: TextStyle(
                            color: ocTheme.textMuted,
                            fontSize: 11,
                          ),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                  loading: () => const Padding(
                    padding: EdgeInsets.all(16),
                    child: Center(child: CircularProgressIndicator()),
                  ),
                  error: (e, _) => Padding(
                    padding: const EdgeInsets.all(16),
                    child: Text(
                      'Failed to load stats: $e',
                      style: TextStyle(color: ocTheme.textMuted),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 14),
              _SectionTitle(title: 'Danger Zone'),
              _Card(
                child: ListTile(
                  leading: Icon(
                    Icons.delete_outline_rounded,
                    color: ocTheme.error,
                  ),
                  title: Text(
                    'Clear index',
                    style: TextStyle(color: ocTheme.error),
                  ),
                  subtitle: const Text(
                    'Deletes all artifacts from the local database.',
                  ),
                  onTap: () => _confirmClear(context, ref),
                ),
              ),
            ],
          );
        },
        loading: () =>
            Center(child: CircularProgressIndicator(color: ocTheme.primary)),
        error: (e, _) => Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text(
              'Failed to load config: $e',
              style: TextStyle(color: ocTheme.textMuted),
              textAlign: TextAlign.center,
            ),
          ),
        ),
      ),
    );
  }

  static String _providerLabel(String provider) {
    switch (provider) {
      case 'claude-code':
        return 'Claude Code (uses your subscription)';
      case 'opencode':
        return 'OpenCode (uses your provider subscription)';
      case 'off':
      default:
        return 'Off';
    }
  }

  Future<void> _pickProvider(
    BuildContext context,
    WidgetRef ref,
    ArtifactsConfig cfg,
  ) async {
    final ocTheme = OpenCodeTheme.of(context);
    final selected = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: ocTheme.backgroundPanel,
      showDragHandle: true,
      builder: (context) => ListView(
        shrinkWrap: true,
        children: [
          ListTile(
            title: const Text('Off'),
            trailing: cfg.enrichment.provider == 'off'
                ? const Icon(Icons.check)
                : null,
            onTap: () => Navigator.pop(context, 'off'),
          ),
          ListTile(
            title: const Text('Claude Code'),
            subtitle: const Text('Uses your Claude subscription / login'),
            trailing: cfg.enrichment.provider == 'claude-code'
                ? const Icon(Icons.check)
                : null,
            onTap: () => Navigator.pop(context, 'claude-code'),
          ),
          ListTile(
            title: const Text('OpenCode'),
            subtitle: const Text('Uses your OpenCode provider subscription'),
            trailing: cfg.enrichment.provider == 'opencode'
                ? const Icon(Icons.check)
                : null,
            onTap: () => Navigator.pop(context, 'opencode'),
          ),
        ],
      ),
    );

    if (!context.mounted) return;
    if (selected == null || selected.isEmpty) return;
    await ref
        .read(artifactsConfigProvider.notifier)
        .update(cfg.copyWithEnrichment(provider: selected));
  }

  Future<void> _pickBatchSize(
    BuildContext context,
    WidgetRef ref,
    ArtifactsConfig cfg,
  ) async {
    final ocTheme = OpenCodeTheme.of(context);
    final selected = await showModalBottomSheet<int>(
      context: context,
      backgroundColor: ocTheme.backgroundPanel,
      showDragHandle: true,
      builder: (context) => ListView(
        shrinkWrap: true,
        children: [
          for (final size in const [1, 3, 5, 8, 10, 15, 20])
            ListTile(
              title: Text('$size'),
              trailing: cfg.enrichment.batchSize == size
                  ? const Icon(Icons.check)
                  : null,
              onTap: () => Navigator.pop(context, size),
            ),
        ],
      ),
    );

    if (!context.mounted) return;
    if (selected == null) return;
    await ref
        .read(artifactsConfigProvider.notifier)
        .update(cfg.copyWithEnrichment(batchSize: selected));
  }

  Future<void> _confirmClear(BuildContext context, WidgetRef ref) async {
    final ocTheme = OpenCodeTheme.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: ocTheme.backgroundPanel,
        title: const Text('Clear artifact index?'),
        content: const Text(
          'This deletes all artifacts from the local database. This cannot be undone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, true),
            style: ElevatedButton.styleFrom(backgroundColor: ocTheme.error),
            child: const Text('Clear'),
          ),
        ],
      ),
    );

    if (!context.mounted) return;
    if (ok != true) return;

    final cleared = await ref
        .read(artifactsConfigProvider.notifier)
        .clearIndex();
    if (!context.mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(cleared ? 'Index cleared' : 'Failed to clear index'),
        behavior: SnackBarBehavior.floating,
        backgroundColor: ocTheme.backgroundPanel,
      ),
    );
    ref.read(artifactsProvider.notifier).refresh();
    ref.invalidate(artifactsStatsProvider);
  }
}

extension on ArtifactsConfig {
  ArtifactsConfig copyWith({
    bool? indexingEnabled,
    int? maxContentChars,
    ArtifactsEnrichmentConfig? enrichment,
  }) {
    return ArtifactsConfig(
      indexingEnabled: indexingEnabled ?? this.indexingEnabled,
      maxContentChars: maxContentChars ?? this.maxContentChars,
      enrichment: enrichment ?? this.enrichment,
    );
  }

  ArtifactsConfig copyWithEnrichment({
    String? provider,
    bool? followSelectedAgent,
    bool? enabled,
    int? batchSize,
    int? maxCharsPerArtifact,
    String? hiddenCwd,
  }) {
    return copyWith(
      enrichment: ArtifactsEnrichmentConfig(
        provider: provider ?? enrichment.provider,
        followSelectedAgent:
            followSelectedAgent ?? enrichment.followSelectedAgent,
        enabled: enabled ?? enrichment.enabled,
        batchSize: batchSize ?? enrichment.batchSize,
        maxCharsPerArtifact:
            maxCharsPerArtifact ?? enrichment.maxCharsPerArtifact,
        hiddenCwd: hiddenCwd ?? enrichment.hiddenCwd,
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.title});
  final String title;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        title,
        style: TextStyle(
          color: ocTheme.textMuted,
          fontSize: 12,
          fontWeight: FontWeight.w800,
          letterSpacing: 0.4,
        ),
      ),
    );
  }
}

class _Card extends StatelessWidget {
  const _Card({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return Container(
      decoration: BoxDecoration(
        color: ocTheme.backgroundPanel,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: ocTheme.borderSubtle),
      ),
      clipBehavior: Clip.antiAlias,
      child: child,
    );
  }
}

class _StatRow extends StatelessWidget {
  const _StatRow({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return Row(
      children: [
        Expanded(
          child: Text(label, style: TextStyle(color: ocTheme.textMuted)),
        ),
        Text(
          value,
          style: TextStyle(color: ocTheme.text, fontWeight: FontWeight.w700),
        ),
      ],
    );
  }
}

String _bytes(int n) {
  if (n < 1024) return '$n B';
  final kb = n / 1024;
  if (kb < 1024) return '${kb.toStringAsFixed(1)} KB';
  final mb = kb / 1024;
  if (mb < 1024) return '${mb.toStringAsFixed(1)} MB';
  final gb = mb / 1024;
  return '${gb.toStringAsFixed(2)} GB';
}
