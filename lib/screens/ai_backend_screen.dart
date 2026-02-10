import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/agent_type.dart';
import '../providers/agent_type_provider.dart';
import '../providers/service_providers.dart';
import '../theme/design_tokens.dart';
import '../theme/opencode_theme.dart';

/// Screen for selecting the AI backend (OpenCode vs Claude Code vs Codex)
class AIBackendScreen extends ConsumerWidget {
  const AIBackendScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final ocTheme = OpenCodeTheme.of(context);
    final currentAgent = ref.watch(agentTypeProvider);

    return Scaffold(
      backgroundColor: theme.scaffoldBackgroundColor,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: Text(
          'AI Backend',
          style: TextStyle(
            color: theme.colorScheme.onSurface,
            fontSize: 18,
            fontWeight: FontWeight.w600,
          ),
        ),
        leading: IconButton(
          icon: Icon(
            Icons.arrow_back_rounded,
            color: theme.colorScheme.onSurface,
          ),
          onPressed: () => Navigator.pop(context),
        ),
      ),
      body: ListView(
        padding: Insets.screenAll,
        children: [
          // Info text
          Container(
            padding: Insets.card,
            decoration: BoxDecoration(
              color: ocTheme.backgroundPanel,
              borderRadius: Radii.brMd,
              border: Border.all(color: ocTheme.borderSubtle),
            ),
            child: Row(
              children: [
                Icon(
                  Icons.info_outline_rounded,
                  color: theme.colorScheme.primary,
                  size: 20,
                ),
                SizedBox(width: Spacing.md),
                Expanded(
                  child: Text(
                    'Select which AI agent to use for coding tasks. Each backend has different capabilities and requirements.',
                    style: TextStyle(
                      color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
                      fontSize: 13,
                      height: 1.4,
                    ),
                  ),
                ),
              ],
            ),
          ),

          SizedBox(height: Spacing.xxl),

          // OpenCode Option
          _AgentCard(
            agentType: AgentType.opencode,
            isSelected: currentAgent == AgentType.opencode,
            icon: Icons.code_rounded,
            title: 'OpenCode',
            subtitle: 'Open source AI coding agent',
            features: const [
              'Free and open source',
              'Multiple model providers',
              'Full SDK integration',
              'Local-first design',
            ],
            onTap: () => _selectAgent(ref, AgentType.opencode),
          ),

          SizedBox(height: Spacing.lg),

          // Claude Code Option
          _AgentCard(
            agentType: AgentType.claudeCode,
            isSelected: currentAgent == AgentType.claudeCode,
            icon: Icons.auto_awesome_rounded,
            title: 'Claude Code',
            subtitle: 'Anthropic Claude Code SDK',
            features: const [
              'Official Anthropic SDK',
              'Claude 3.5/4 models',
              'Requires API key',
              'Advanced reasoning',
            ],
            onTap: () => _selectAgent(ref, AgentType.claudeCode),
          ),

          SizedBox(height: Spacing.lg),

          // Codex Option
          _AgentCard(
            agentType: AgentType.codex,
            isSelected: currentAgent == AgentType.codex,
            icon: Icons.terminal_rounded,
            title: 'Codex',
            subtitle: 'OpenAI Codex app-server',
            features: const [
              'Codex CLI + app-server',
              'Plans, diffs, approvals',
              'MCP + web search (opt-in)',
              'Runs locally on this machine',
            ],
            onTap: () => _selectAgent(ref, AgentType.codex),
          ),

          SizedBox(height: Spacing.xxxl),

          // Current selection indicator
          Container(
            padding: Insets.card,
            decoration: BoxDecoration(
              color: theme.colorScheme.primary.withValues(alpha: 0.1),
              borderRadius: Radii.brMd,
              border: Border.all(
                color: theme.colorScheme.primary.withValues(alpha: 0.3),
              ),
            ),
            child: Row(
              children: [
                Icon(
                  Icons.check_circle_rounded,
                  color: theme.colorScheme.primary,
                  size: 20,
                ),
                SizedBox(width: Spacing.md),
                Text(
                  'Currently using: ',
                  style: TextStyle(
                    color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
                    fontSize: 14,
                  ),
                ),
                Text(
                  currentAgent.displayName,
                  style: TextStyle(
                    color: theme.colorScheme.primary,
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 100),
        ],
      ),
    );
  }

  void _selectAgent(WidgetRef ref, AgentType type) {
    ref.read(agentTypeProvider.notifier).setAgentType(type);
    final bridge = ref.read(bridgeServiceProvider);
    bridge.setAgent(type);
  }
}

class _AgentCard extends StatelessWidget {
  const _AgentCard({
    required this.agentType,
    required this.isSelected,
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.features,
    required this.onTap,
  });

  final AgentType agentType;
  final bool isSelected;
  final IconData icon;
  final String title;
  final String subtitle;
  final List<String> features;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final ocTheme = OpenCodeTheme.of(context);

    return InkWell(
      onTap: onTap,
      borderRadius: Radii.brLg,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: Insets.screenAll,
        decoration: BoxDecoration(
          color: ocTheme.backgroundPanel,
          borderRadius: Radii.brLg,
          border: Border.all(
            color: isSelected
                ? theme.colorScheme.primary
                : ocTheme.borderSubtle,
            width: isSelected ? 2 : 1,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header row
            Row(
              children: [
                // Icon
                Container(
                  padding: Insets.cardSm,
                  decoration: BoxDecoration(
                    color: isSelected
                        ? theme.colorScheme.primary.withValues(alpha: 0.15)
                        : ocTheme.bgRaised,
                    borderRadius: Radii.brMd,
                  ),
                  child: Icon(
                    icon,
                    color: isSelected
                        ? theme.colorScheme.primary
                        : theme.colorScheme.onSurface.withValues(alpha: 0.7),
                    size: 24,
                  ),
                ),
                SizedBox(width: Spacing.lg),
                // Title and subtitle
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: TextStyle(
                          color: theme.colorScheme.onSurface,
                          fontSize: 17,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      SizedBox(height: Spacing.xs),
                      Text(
                        subtitle,
                        style: TextStyle(
                          color: theme.colorScheme.onSurface.withValues(
                            alpha: 0.6,
                          ),
                          fontSize: 13,
                        ),
                      ),
                    ],
                  ),
                ),
                // Selection indicator
                Container(
                  width: 24,
                  height: 24,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: isSelected
                          ? theme.colorScheme.primary
                          : theme.colorScheme.onSurface.withValues(alpha: 0.3),
                      width: 2,
                    ),
                    color: isSelected
                        ? theme.colorScheme.primary
                        : Colors.transparent,
                  ),
                  child: isSelected
                      ? Icon(
                          Icons.check,
                          size: 16,
                          color: theme.colorScheme.onPrimary,
                        )
                      : null,
                ),
              ],
            ),

            SizedBox(height: Spacing.lg),

            // Features list
            ...features.map(
              (feature) => Padding(
                padding: Insets.bottomSm,
                child: Row(
                  children: [
                    Icon(
                      Icons.check_circle_outline_rounded,
                      size: 16,
                      color: isSelected
                          ? theme.colorScheme.primary
                          : theme.colorScheme.onSurface.withValues(alpha: 0.4),
                    ),
                    const SizedBox(width: 10),
                    Text(
                      feature,
                      style: TextStyle(
                        color: theme.colorScheme.onSurface.withValues(
                          alpha: 0.7,
                        ),
                        fontSize: 13,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
