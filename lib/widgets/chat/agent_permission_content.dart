import 'package:broski/models/agent.dart';
import 'package:broski/models/permission_rule.dart';
import 'package:broski/providers/permission_rules_provider.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/agent_card.dart';
import 'package:broski/widgets/chat/permission_preset_card.dart';
import 'package:broski/widgets/permission_rules_sheet.dart';
import 'package:broski/widgets/variant_badge.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Agent and permission content for the chat screen power sheet.
/// Extracted from chat_screen.dart.
class AgentAndPermissionContent extends ConsumerStatefulWidget {
  const AgentAndPermissionContent({
    super.key,
    required this.theme,
    required this.agents,
    this.currentAgent,
    this.onAgentChanged,
  });
  final OpenCodeTheme theme;
  final List<Agent> agents;
  final String? currentAgent;
  final void Function(String?)? onAgentChanged;
  @override
  ConsumerState<AgentAndPermissionContent> createState() =>
      _AgentAndPermissionContentState();
}

class _AgentAndPermissionContentState
    extends ConsumerState<AgentAndPermissionContent> {
  @override
  Widget build(BuildContext context) {
    final rulesState = ref.watch(permissionRulesProvider);
    final selectedPreset = rulesState.preset;
    // Separate primary (Build/Plan) from secondary agents
    final primaryAgents = widget.agents
        .where((a) => a.name == 'build' || a.name == 'plan')
        .toList();
    final secondaryAgents = widget.agents
        .where((a) => a.name != 'build' && a.name != 'plan')
        .toList();
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // Content with proper padding
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Agent section
              if (widget.agents.isNotEmpty) ...[
                // Section header
                Row(
                  children: [
                    Icon(
                      AppIcons.agent,
                      color: widget.theme.textMuted,
                      size: 18,
                    ),
                    const SizedBox(width: Spacing.sm),
                    Text(
                      'Agent',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: widget.theme.textMuted,
                        letterSpacing: 0.5,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: Spacing.lg),
                // Primary agents as prominent cards in a row
                if (primaryAgents.isNotEmpty) ...[
                  Row(
                    children: primaryAgents.map((agent) {
                      final isSelected = agent.name == widget.currentAgent;
                      return Expanded(
                        child: Padding(
                          padding: EdgeInsets.only(
                            right: agent == primaryAgents.last ? 0 : 10,
                          ),
                          child: AgentCard(
                            agent: agent,
                            isSelected: isSelected,
                            theme: widget.theme,
                            onTap: () {
                              widget.onAgentChanged?.call(agent.name);
                              Navigator.pop(context);
                            },
                          ),
                        ),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: Spacing.md),
                ],
                // Secondary agents as smaller list
                if (secondaryAgents.isNotEmpty) ...[
                  Container(
                    decoration: BoxDecoration(
                      color: widget.theme.backgroundPanel,
                      borderRadius: Radii.brMd,
                      border: Border.all(color: widget.theme.borderSubtle),
                    ),
                    child: Column(
                      children: secondaryAgents.asMap().entries.map((entry) {
                        final index = entry.key;
                        final agent = entry.value;
                        final isSelected = agent.name == widget.currentAgent;
                        final isLast = index == secondaryAgents.length - 1;
                        return Column(
                          children: [
                            InkWell(
                              onTap: () {
                                widget.onAgentChanged?.call(agent.name);
                                Navigator.pop(context);
                              },
                              borderRadius: BorderRadius.vertical(
                                top: index == 0
                                    ? const Radius.circular(12)
                                    : Radius.zero,
                                bottom: isLast
                                    ? const Radius.circular(12)
                                    : Radius.zero,
                              ),
                              child: Padding(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 14,
                                  vertical: 12,
                                ),
                                child: Row(
                                  children: [
                                    Container(
                                      width: 8,
                                      height: 8,
                                      decoration: BoxDecoration(
                                        color: agent.resolveColor(widget.theme),
                                        shape: BoxShape.circle,
                                      ),
                                    ),
                                    const SizedBox(width: Spacing.md),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment:
                                            CrossAxisAlignment.start,
                                        children: [
                                          Row(
                                            children: [
                                              Flexible(
                                                child: Text(
                                                  agent.displayName,
                                                  style: TextStyle(
                                                    color: widget.theme.text,
                                                    fontSize: 14,
                                                    fontWeight: isSelected
                                                        ? FontWeight.w600
                                                        : FontWeight.w500,
                                                  ),
                                                ),
                                              ),
                                              if (agent.variant != null &&
                                                  agent
                                                      .variant!
                                                      .isNotEmpty) ...[
                                                const SizedBox(width: 6),
                                                VariantBadge.small(
                                                  variant: agent.variant,
                                                ),
                                              ],
                                            ],
                                          ),
                                          Text(
                                            agent.shortDescription,
                                            style: TextStyle(
                                              color: widget.theme.textMuted,
                                              fontSize: 12,
                                            ),
                                          ),
                                          if (agent.model != null)
                                            Text(
                                              agent.model!.displayName,
                                              style: TextStyle(
                                                color: widget.theme.textMuted
                                                    .withValues(alpha: 0.7),
                                                fontSize: 11,
                                                fontStyle: FontStyle.italic,
                                              ),
                                            ),
                                        ],
                                      ),
                                    ),
                                    if (isSelected)
                                      Icon(
                                        AppIcons.check,
                                        color: widget.theme.primary,
                                        size: 18,
                                      ),
                                  ],
                                ),
                              ),
                            ),
                            if (!isLast)
                              Divider(
                                height: 1,
                                indent: 34,
                                color: widget.theme.borderSubtle,
                              ),
                          ],
                        );
                      }).toList(),
                    ),
                  ),
                ],
                const SizedBox(height: Spacing.xxl),
              ],
              // Permission preset section
              Row(
                children: [
                  Icon(
                    AppIcons.security,
                    color: widget.theme.textMuted,
                    size: 18,
                  ),
                  const SizedBox(width: Spacing.sm),
                  Text(
                    'Permissions',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: widget.theme.textMuted,
                      letterSpacing: 0.5,
                    ),
                  ),
                  const Spacer(),
                  // Custom rules button inline
                  GestureDetector(
                    onTap: () {
                      Navigator.pop(context);
                      showModalBottomSheet(
                        context: context,
                        isScrollControlled: true,
                        backgroundColor: Colors.transparent,
                        builder: (context) => PermissionRulesSheet(
                          initialRules: rulesState.effectiveRuleset,
                          onApply: (rules) {
                            ref
                                .read(permissionRulesProvider.notifier)
                                .setCustomRules(rules);
                          },
                        ),
                      );
                    },
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          AppIcons.tune,
                          size: 14,
                          color: widget.theme.primary,
                        ),
                        const SizedBox(width: Spacing.xs),
                        Text(
                          'Custom',
                          style: TextStyle(
                            color: widget.theme.primary,
                            fontSize: 12,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              // Permission presets as 2x2 grid
              GridView.count(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                crossAxisCount: 2,
                mainAxisSpacing: 10,
                crossAxisSpacing: 10,
                childAspectRatio: 2.4,
                children: PermissionPreset.values
                    .where((p) => p != PermissionPreset.custom)
                    .map(
                      (preset) => PermissionPresetCard(
                        preset: preset,
                        isSelected: preset == selectedPreset,
                        theme: widget.theme,
                        onTap: () {
                          ref
                              .read(permissionRulesProvider.notifier)
                              .setPreset(preset);
                        },
                      ),
                    )
                    .toList(),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
