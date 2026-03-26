import 'package:flutter/material.dart';

import '../../models/agent.dart';
import '../../models/session.dart';
import '../../models/session_context.dart';
import '../../models/vcs.dart';
import '../../providers/selection_provider.dart';
import '../../theme/app_icons.dart';
import '../../theme/app_typography.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import '../../widgets/variant_badge.dart';
import 'cc_actions_content.dart';
import 'codex_actions_content.dart';
import 'detail_sheet.dart';
import 'glass_pill.dart';
import 'pi_actions_content.dart';
import 'session_actions_content.dart';
import 'status_indicator.dart';

/// Floating header bar for the chat screen. Extracted from chat_screen.dart.
class FloatingHeader extends StatelessWidget {
  const FloatingHeader({
    super.key,
    required this.projectName,
    required this.isConnected,
    required this.currentModel,
    this.rttMs,
    required this.onBack,
    this.onModelTap,
    this.onMenu,
    this.onOpenSidebar,
    this.currentAgent,
    this.agents = const [],
    this.onAgentChanged,
    this.vcsInfo,
    this.isSessionShared = false,
    this.isCompacting = false,
    this.sessionStatus = const SessionStatus.idle(),
    this.isStreaming = false,
    this.isClaudeCode = false,
    this.ccModel,
    this.isCodex = false,
    this.codexModel,
    this.sessionContext,
    this.isPi = false,
    this.piModel,
  });
  final String projectName;
  final bool isConnected;
  final SelectedModel? currentModel;
  final int? rttMs;
  final VoidCallback onBack;
  final VoidCallback? onModelTap;
  final void Function(String)? onMenu;
  final VoidCallback? onOpenSidebar;
  final String? currentAgent;
  final List<Agent> agents;
  final void Function(String?)? onAgentChanged;
  final VcsInfo? vcsInfo;
  final bool isSessionShared;
  final bool isCompacting;
  final SessionStatus sessionStatus;
  final bool isStreaming;
  // Claude Code support
  final bool isClaudeCode;
  final String? ccModel;
  // Codex support
  final bool isCodex;
  final String? codexModel;
  // Context usage for inline indicator
  final SessionContext? sessionContext;
  // Pi support
  final bool isPi;
  final String? piModel;
  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final kMuted = theme.textMuted;
    final kOnBackground = theme.text;
    // Context usage data
    final ctx = sessionContext;
    final hasContext =
        ctx != null && (ctx.tokens.contextTokens > 0 || ctx.tokens.total > 0);
    final usagePercent = ctx?.contextUsagePercent ?? 0;
    final contextColor = usagePercent > 80
        ? theme.error
        : usagePercent > 50
        ? theme.warning
        : theme.info;
    return AnimatedContainer(
      duration: const Duration(milliseconds: 200),
      padding: EdgeInsets.fromLTRB(
        12,
        MediaQuery.of(context).padding.top + 3,
        12,
        isStreaming ? 1 : 5,
      ),
      child: AnimatedOpacity(
        duration: const Duration(milliseconds: 200),
        opacity: isStreaming ? 0.6 : 1.0,
        child: Row(
          children: [
            // Back button
            GlassPill(
              onTap: onBack,
              child: Icon(AppIcons.back, color: kOnBackground, size: 22),
            ),
            SizedBox(width: Spacing.sm),
            // Combined: Project + backend badge
            Expanded(
              child: GlassPill(
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    // Status dot
                    StatusIndicator(
                      isConnected: isConnected,
                      sessionStatus: sessionStatus,
                    ),
                    SizedBox(width: Spacing.sm),
                    // Project name (compact)
                    Flexible(
                      child: Text(
                        projectName,
                        style: TextStyle(
                          fontWeight: FontWeight.w600,
                          fontSize: 13,
                          color: kOnBackground,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    // Claude Code badge
                    if (isClaudeCode) ...[
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 6,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: theme.accent.withValues(alpha: 0.2),
                          borderRadius: Radii.brSm,
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              AppIcons.terminal,
                              size: 10,
                              color: theme.accent,
                            ),
                            const SizedBox(width: 3),
                            Text(
                              'CC',
                              style: TextStyle(
                                color: theme.accent,
                                fontSize: 9,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                    // Codex badge
                    if (isCodex) ...[
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 6,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: theme.primary.withValues(alpha: 0.2),
                          borderRadius: Radii.brSm,
                        ),
                        child: Text(
                          'CX',
                          style: TextStyle(
                            color: theme.primary,
                            fontSize: 9,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                    // Pi badge
                    if (isPi) ...[
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 6,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: theme.primary.withValues(alpha: 0.2),
                          borderRadius: Radii.brSm,
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              AppIcons.autoAwesome,
                              size: 10,
                              color: theme.primary,
                            ),
                            const SizedBox(width: 3),
                            Text(
                              'Pi',
                              style: TextStyle(
                                color: theme.primary,
                                fontSize: 9,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
            SizedBox(width: Spacing.sm),
            // Context usage pill — taps to open sidebar
            if (ctx case final c? when hasContext)
              GlassPill(
                onTap: onOpenSidebar,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    // Tiny circular progress arc
                    SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(
                        value: (usagePercent / 100).clamp(0.0, 1.0),
                        strokeWidth: 2.5,
                        backgroundColor: kMuted.withValues(alpha: 0.15),
                        valueColor: AlwaysStoppedAnimation<Color>(contextColor),
                      ),
                    ),
                    const SizedBox(width: 6),
                    // Compact token count: "45K/200K"
                    Text(
                      '${TokenUsage.formatTokenCount(c.tokens.contextTokens > 0 ? c.tokens.contextTokens : c.tokens.total)}'
                      '/${TokenUsage.formatTokenCount(c.tokens.contextWindow)}',
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w600,
                        color: contextColor,
                      ),
                    ),
                  ],
                ),
              ),
            SizedBox(width: Spacing.sm),
            // Menu button (contains all secondary options)
            // For Claude Code: bottom sheet menu
            if (isClaudeCode && onMenu != null)
              GlassPill(
                compact: true,
                constraints: const BoxConstraints(maxWidth: 32, maxHeight: 32),
                child: GestureDetector(
                  onTap: () => _showClaudeCodeActionsSheet(
                    context,
                    theme: theme,
                    isConnected: isConnected,
                    rttMs: rttMs,
                    ccModel: ccModel,
                    isStreaming: isStreaming,
                    onMenu: onMenu!,
                  ),
                  child: Icon(
                    AppIcons.moreHorizontal,
                    color: kOnBackground,
                    size: 18,
                  ),
                ),
              )
            // For Codex: bottom sheet menu
            else if (isCodex && onMenu != null)
              GlassPill(
                compact: true,
                constraints: const BoxConstraints(maxWidth: 32, maxHeight: 32),
                child: GestureDetector(
                  onTap: () => _showCodexActionsSheet(
                    context,
                    theme: theme,
                    isConnected: isConnected,
                    rttMs: rttMs,
                    codexModel: codexModel,
                    isStreaming: isStreaming,
                    onMenu: onMenu!,
                  ),
                  child: Icon(
                    AppIcons.moreHorizontal,
                    color: kOnBackground,
                    size: 18,
                  ),
                ),
              )
            // For Pi: bottom sheet menu
            else if (isPi && onMenu != null)
              GlassPill(
                compact: true,
                constraints: const BoxConstraints(maxWidth: 32, maxHeight: 32),
                child: GestureDetector(
                  onTap: () => _showPiActionsSheet(
                    context,
                    theme: theme,
                    isConnected: isConnected,
                    rttMs: rttMs,
                    piModel: piModel,
                    isStreaming: isStreaming,
                    onMenu: onMenu!,
                  ),
                  child: Icon(
                    AppIcons.moreHorizontal,
                    color: kOnBackground,
                    size: 18,
                  ),
                ),
              )
            // For OpenCode: bottom sheet menu
            else if (onMenu != null)
              GlassPill(
                compact: true,
                constraints: const BoxConstraints(maxWidth: 32, maxHeight: 32),
                child: GestureDetector(
                  onTap: () => _showSessionActionsSheet(
                    context,
                    theme: theme,
                    vcsInfo: vcsInfo,
                    isConnected: isConnected,
                    rttMs: rttMs,
                    currentModel: currentModel,
                    onModelTap: onModelTap,
                    isSessionShared: isSessionShared,
                    isCompacting: isCompacting,
                    isStreaming: isStreaming,
                    onMenu: onMenu!,
                    onOpenSidebar: onOpenSidebar,
                  ),
                  child: Icon(
                    AppIcons.moreHorizontal,
                    color: kOnBackground,
                    size: 18,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  void _showAgentPicker(BuildContext context) {
    // Show all non-hidden agents, primary first
    final visibleAgents = agents.where((a) => !a.hidden).toList()
      ..sort((a, b) {
        // Primary/all agents first, then subagents
        final aPrimary = a.isPrimary ? 0 : 1;
        final bPrimary = b.isPrimary ? 0 : 1;
        if (aPrimary != bPrimary) return aPrimary - bPrimary;
        return a.name.compareTo(b.name);
      });
    final theme = OpenCodeTheme.of(context);
    DetailSheet.show(
      context: context,
      title: 'Select Agent',
      initialSize: 0.45,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(height: Spacing.sm),
          for (final agent in visibleAgents)
            ListTile(
              contentPadding: Insets.screenH,
              leading: Container(
                width: 10,
                height: 10,
                decoration: BoxDecoration(
                  color: agent.resolveColor(theme),
                  shape: BoxShape.circle,
                ),
              ),
              title: Row(
                children: [
                  Flexible(
                    child: Text(
                      agent.displayName,
                      style: TextStyle(
                        color: theme.text,
                        fontWeight: agent.name == currentAgent
                            ? FontWeight.w600
                            : FontWeight.w400,
                      ),
                    ),
                  ),
                  if (agent.variant != null && agent.variant!.isNotEmpty) ...[
                    const SizedBox(width: 6),
                    VariantBadge.small(variant: agent.variant),
                  ],
                  if (!agent.isPrimary) ...[
                    const SizedBox(width: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 5,
                        vertical: 1,
                      ),
                      decoration: BoxDecoration(
                        color: theme.textMuted.withValues(alpha: 0.12),
                        borderRadius: Radii.brXs,
                      ),
                      child: Text(
                        'sub',
                        style: TextStyle(
                          fontSize: 9,
                          fontWeight: FontWeight.w600,
                          color: theme.textMuted,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
              subtitle: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    agent.shortDescription,
                    style: AppTypography.label(color: theme.textMuted),
                  ),
                  if (agent.model != null) ...[
                    SizedBox(height: Spacing.xxs),
                    Text(
                      agent.model!.displayName,
                      style: TextStyle(
                        color: theme.textMuted.withValues(alpha: 0.7),
                        fontSize: 11,
                        fontStyle: FontStyle.italic,
                      ),
                    ),
                  ],
                ],
              ),
              trailing: agent.name == currentAgent
                  ? Icon(AppIcons.check, color: theme.success, size: 20)
                  : null,
              onTap: () {
                onAgentChanged?.call(agent.name);
                Navigator.pop(context);
              },
            ),
          SizedBox(height: Spacing.sm),
        ],
      ),
    );
  }

  void _showSessionActionsSheet(
    BuildContext context, {
    required OpenCodeTheme theme,
    required VcsInfo? vcsInfo,
    required bool isConnected,
    required int? rttMs,
    required SelectedModel? currentModel,
    required VoidCallback? onModelTap,
    required bool isSessionShared,
    required bool isCompacting,
    required bool isStreaming,
    required void Function(String) onMenu,
    VoidCallback? onOpenSidebar,
  }) {
    DetailSheet.show(
      context: context,
      title: 'Session',
      initialSize: 0.5,
      child: SessionActionsContent(
        theme: theme,
        vcsInfo: vcsInfo,
        isConnected: isConnected,
        rttMs: rttMs,
        currentModel: currentModel,
        onModelTap: onModelTap,
        isSessionShared: isSessionShared,
        isCompacting: isCompacting,
        isStreaming: isStreaming,
        onOpenSidebar: onOpenSidebar,
        onAction: (action) {
          Navigator.pop(context);
          onMenu(action);
        },
      ),
    );
  }

  void _showClaudeCodeActionsSheet(
    BuildContext context, {
    required OpenCodeTheme theme,
    required bool isConnected,
    required int? rttMs,
    required String? ccModel,
    required bool isStreaming,
    required void Function(String) onMenu,
  }) {
    DetailSheet.show(
      context: context,
      title: 'Claude Code',
      initialSize: 0.5,
      child: ClaudeCodeActionsContent(
        theme: theme,
        isConnected: isConnected,
        rttMs: rttMs,
        ccModel: ccModel,
        isStreaming: isStreaming,
        onAction: (action) {
          Navigator.pop(context);
          onMenu(action);
        },
      ),
    );
  }

  void _showCodexActionsSheet(
    BuildContext context, {
    required OpenCodeTheme theme,
    required bool isConnected,
    required int? rttMs,
    required String? codexModel,
    required bool isStreaming,
    required void Function(String) onMenu,
  }) {
    DetailSheet.show(
      context: context,
      title: 'Codex',
      initialSize: 0.5,
      child: CodexActionsContent(
        theme: theme,
        isConnected: isConnected,
        rttMs: rttMs,
        codexModel: codexModel,
        isStreaming: isStreaming,
        onAction: (action) {
          Navigator.pop(context);
          onMenu(action);
        },
      ),
    );
  }

  void _showPiActionsSheet(
    BuildContext context, {
    required OpenCodeTheme theme,
    required bool isConnected,
    required int? rttMs,
    required String? piModel,
    required bool isStreaming,
    required void Function(String) onMenu,
  }) {
    DetailSheet.show(
      context: context,
      title: 'Pi',
      initialSize: 0.5,
      child: PiActionsContent(
        theme: theme,
        isConnected: isConnected,
        rttMs: rttMs,
        piModel: piModel,
        isStreaming: isStreaming,
        onAction: (action) {
          Navigator.pop(context);
          onMenu(action);
        },
      ),
    );
  }
}
