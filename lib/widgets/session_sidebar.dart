import 'package:broski/models/claude_code.dart';
import 'package:broski/models/codex.dart';
import 'package:broski/models/message.dart';
import 'package:broski/models/session_context.dart';
import 'package:broski/models/todo.dart';
import 'package:broski/models/vcs.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/section_header.dart';
import 'package:broski/widgets/connection_quality_indicator.dart';
import 'package:broski/widgets/sidebar/cc_context_details.dart';
import 'package:broski/widgets/status_indicator.dart';
import 'package:flutter/material.dart';

/// Codex session info passed to the sidebar for display.
class CodexSessionInfo {
  const CodexSessionInfo({
    this.threadId,
    this.model,
    this.cwd,
    required this.settings,
  });

  final String? threadId;
  final String? model;
  final String? cwd;
  final CodexSettings settings;
}

/// Session sidebar showing plan/todos, context usage, LSP servers, and modified files
/// Designed to match the OpenCode desktop sidebar shown in the screenshot
class SessionSidebar extends StatelessWidget {
  const SessionSidebar({
    super.key,
    required this.sessionTitle,
    required this.sessionContext,
    this.todos = const [],
    this.onClose,
    this.vcsInfo,
    this.sessionDiffs = const [],
    this.onOpenDiff,
    this.isClaudeCode = false,
    this.isCodex = false,
    this.ccInit,
    this.cxInfo,
  });
  final String sessionTitle;
  final SessionContext sessionContext;
  final List<Todo> todos;
  final VoidCallback? onClose;
  // Feature 10: VCS/Git info
  final VcsInfo? vcsInfo;
  final List<DiffEntry> sessionDiffs;
  final void Function(DiffEntry diff)? onOpenDiff;
  // Claude Code mode
  final bool isClaudeCode;
  // Codex mode
  final bool isCodex;
  final CCSessionInit? ccInit;
  final CodexSessionInfo? cxInfo;
  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      width: MediaQuery.of(context).size.width * 0.78,
      decoration: BoxDecoration(
        color: theme.background,
        border: Border(left: BorderSide(color: theme.borderSubtle, width: 1)),
      ),
      child: SafeArea(
        left: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildHeader(context, theme),
            Expanded(
              child: ListView(
                padding: Insets.screenH,
                children: [
                  const SizedBox(height: Spacing.sm),
                  _buildContextSection(context, theme),
                  if (isClaudeCode)
                    CCContextDetails(sessionId: ccInit?.sessionId),
                  const SizedBox(height: Spacing.xl),
                  // Claude Code: Show session info + plan (CC has TodoWrite tool)
                  if (isClaudeCode) ...[
                    _buildClaudeCodeInfoSection(context, theme),
                    const SizedBox(height: Spacing.xl),
                    if ((ccInit?.mcpServers ?? const []).isNotEmpty) ...[
                      _buildClaudeCodeMcpSection(context, theme),
                      const SizedBox(height: Spacing.xl),
                    ],
                    if ((ccInit?.skills ?? const []).isNotEmpty) ...[
                      _buildClaudeCodeSkillsSection(context, theme),
                      const SizedBox(height: Spacing.xl),
                    ],
                    _buildPlanSection(context, theme),
                    const SizedBox(height: Spacing.xl),
                  ] else if (isCodex) ...[
                    // Codex: Session info + Plan + changes, no LSP
                    _buildCodexInfoSection(context, theme),
                    const SizedBox(height: Spacing.xl),
                    _buildPlanSection(context, theme),
                    const SizedBox(height: Spacing.xl),
                  ] else ...[
                    // OpenCode: Plan + LSP
                    _buildPlanSection(context, theme),
                    const SizedBox(height: Spacing.xl),
                    _buildLspSection(context, theme),
                    const SizedBox(height: Spacing.xl),
                  ],
                  _buildChangesSection(context, theme),
                  const SizedBox(height: Spacing.xl),
                  _buildModifiedFilesSection(context, theme),
                  const SizedBox(height: Spacing.xxl),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader(BuildContext context, OpenCodeTheme theme) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 12, 8, 12),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: theme.borderSubtle, width: 1)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      sessionTitle.isNotEmpty
                          ? sessionTitle
                          : 'Session Details',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                        color: theme.text,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    // Feature 10: VCS branch display
                    if (vcsInfo != null && vcsInfo!.isAvailable)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Row(
                          children: [
                            Icon(
                              AppIcons.callSplit,
                              size: 14,
                              color: theme.success,
                            ),
                            const SizedBox(width: 6),
                            Text(
                              vcsInfo!.branch ?? '',
                              style: TextStyle(
                                fontSize: 13,
                                color: theme.textMuted,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                            if (vcsInfo!.isOnFeatureBranch) ...[
                              const SizedBox(width: 6),
                              Text(
                                '← ${vcsInfo!.defaultBranch}',
                                style: TextStyle(
                                  fontSize: 12,
                                  color: theme.textMuted.withValues(alpha: 0.6),
                                  fontWeight: FontWeight.w400,
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                  ],
                ),
              ),
              if (onClose != null)
                IconButton(
                  onPressed: onClose,
                  icon: Icon(AppIcons.close, color: theme.textMuted, size: 20),
                  splashRadius: 20,
                  tooltip: 'Close',
                ),
            ],
          ),
          // Connection quality indicator
          const Padding(
            padding: EdgeInsets.only(top: 12),
            child: ConnectionQualityIndicator(),
          ),
        ],
      ),
    );
  }

  Widget _buildContextSection(BuildContext context, OpenCodeTheme theme) {
    final ctx = sessionContext;
    final usagePercent = ctx.contextUsagePercent;
    final remainingTokens = ctx.tokens.contextWindow - ctx.tokens.contextTokens;
    // Codex SDK doesn't provide cost data — only show cost for Claude Code and OpenCode
    final showCost = !isCodex;
    return _SidebarSection(
      theme: theme,
      title: 'Context',
      trailing: Text(
        ctx.tokens.contextTokens > 0
            ? '${ctx.tokens.formatCount(ctx.tokens.contextTokens)} / ${ctx.tokens.formatCount(ctx.tokens.contextWindow)}'
            : '${ctx.tokens.formatCount(ctx.tokens.total)} tokens',
        style: TextStyle(
          fontSize: 12,
          color: theme.textMuted,
          fontWeight: FontWeight.w500,
        ),
      ),
      children: [
        // Token usage progress bar
        Container(
          height: 6,
          decoration: BoxDecoration(
            color: theme.backgroundPanel,
            borderRadius: Radii.brXs,
          ),
          child: LayoutBuilder(
            builder: (context, constraints) {
              return Stack(
                children: [
                  AnimatedContainer(
                    duration: const Duration(milliseconds: 300),
                    width:
                        constraints.maxWidth *
                        (usagePercent / 100).clamp(0.0, 1.0),
                    decoration: BoxDecoration(
                      color: usagePercent > 80
                          ? theme.error
                          : usagePercent > 50
                          ? theme.warning
                          : theme.info,
                      borderRadius: Radii.brXs,
                    ),
                  ),
                ],
              );
            },
          ),
        ),
        const SizedBox(height: Spacing.md),
        // Stats row - adapt to available data per backend
        Wrap(
          spacing: 10,
          runSpacing: 8,
          children: [
            _StatItem(
              theme: theme,
              label: '${usagePercent.toStringAsFixed(0)}% used',
              icon: AppIcons.memory,
            ),
            if (remainingTokens > 0)
              _StatItem(
                theme: theme,
                label: ctx.tokens.formatCount(
                  remainingTokens.clamp(0, ctx.tokens.contextWindow),
                ),
                sublabel: 'remaining',
                icon: AppIcons.dataUsage,
              ),
            // Cost: only show for backends that report it (Claude Code, OpenCode)
            if (showCost)
              _StatItem(
                theme: theme,
                label: ctx.formattedCost,
                sublabel: 'spent',
                icon: AppIcons.wallet,
              ),
            // Budget remaining: only for Claude Code (maxBudgetUsd)
            if (ctx.budgetRemainingUsd != null)
              _StatItem(
                theme: theme,
                label: ctx.formattedBudgetRemaining,
                sublabel: 'budget left',
                icon: AppIcons.wallet,
              ),
          ],
        ),
        // Token breakdown
        if (ctx.tokens.input > 0 || ctx.tokens.output > 0) ...[
          const SizedBox(height: 10),
          Container(
            padding: Insets.cardXs,
            decoration: BoxDecoration(
              color: theme.background,
              borderRadius: Radii.brSm,
              border: Border.all(
                color: theme.borderSubtle.withValues(alpha: 0.2),
              ),
            ),
            child: Column(
              children: [
                _TokenRow(
                  theme: theme,
                  label: 'Input',
                  value: ctx.tokens.formatCount(ctx.tokens.input),
                  color: theme.info,
                ),
                _TokenRow(
                  theme: theme,
                  label: 'Output',
                  value: ctx.tokens.formatCount(ctx.tokens.output),
                  color: theme.accent,
                ),
                if (ctx.tokens.cacheRead != null && ctx.tokens.cacheRead! > 0)
                  _TokenRow(
                    theme: theme,
                    label: 'Cache Read',
                    value: ctx.tokens.formatCount(ctx.tokens.cacheRead!),
                    color: theme.success,
                  ),
                if (ctx.tokens.cacheWrite != null && ctx.tokens.cacheWrite! > 0)
                  _TokenRow(
                    theme: theme,
                    label: 'Cache Write',
                    value: ctx.tokens.formatCount(ctx.tokens.cacheWrite!),
                    color: theme.warning,
                  ),
                if (ctx.tokens.reasoning != null && ctx.tokens.reasoning! > 0)
                  _TokenRow(
                    theme: theme,
                    label: 'Reasoning',
                    value: ctx.tokens.formatCount(ctx.tokens.reasoning!),
                    color: theme.textMuted,
                  ),
              ],
            ),
          ),
        ],
      ],
    );
  }

  /// Claude Code specific info section showing model, permission mode, tools
  Widget _buildClaudeCodeInfoSection(
    BuildContext context,
    OpenCodeTheme theme,
  ) {
    final init = ccInit;
    if (init == null) {
      return _SidebarSection(
        theme: theme,
        title: 'Session Info',
        icon: AppIcons.info,
        children: [
          Container(
            padding: Insets.cardSm,
            decoration: BoxDecoration(
              color: theme.backgroundPanel,
              borderRadius: Radii.brSm,
              border: Border.all(color: theme.borderSubtle, width: 1),
            ),
            child: Row(
              children: [
                Icon(AppIcons.hourglass, color: theme.textMuted, size: 16),
                const SizedBox(width: Spacing.sm),
                Text(
                  'Waiting for session...',
                  style: AppTypography.bodySmall(color: theme.textMuted),
                ),
              ],
            ),
          ),
        ],
      );
    }
    return _SidebarSection(
      theme: theme,
      title: 'Claude Code',
      icon: AppIcons.agent,
      children: [
        Container(
          decoration: BoxDecoration(
            color: theme.backgroundPanel,
            borderRadius: Radii.brMd,
            border: Border.all(color: theme.borderSubtle, width: 1),
          ),
          child: Column(
            children: [
              // Model info
              _InfoRow(
                theme: theme,
                icon: AppIcons.memory,
                label: 'Model',
                value: init.model.isNotEmpty ? init.model : 'sonnet',
              ),
              Divider(height: 1, color: theme.borderSubtle),
              // Permission mode
              _InfoRow(
                theme: theme,
                icon: AppIcons.security,
                label: 'Mode',
                value: init.permissionMode.displayName,
              ),
              Divider(height: 1, color: theme.borderSubtle),
              // Tools count
              _InfoRow(
                theme: theme,
                icon: AppIcons.build,
                label: 'Tools',
                value: '${init.tools.length} enabled',
              ),
              if (init.mcpServers.isNotEmpty) ...[
                Divider(height: 1, color: theme.borderSubtle),
                _InfoRow(
                  theme: theme,
                  icon: AppIcons.dns,
                  label: 'MCP Servers',
                  value: '${init.mcpServers.length} connected',
                ),
              ],
              if (init.claudeCodeVersion != null) ...[
                Divider(height: 1, color: theme.borderSubtle),
                _InfoRow(
                  theme: theme,
                  icon: AppIcons.info,
                  label: 'Version',
                  value: init.claudeCodeVersion!,
                ),
              ],
              if (init.accountInfo != null &&
                  ((init.accountInfo!.subscriptionType ?? '').isNotEmpty ||
                      (init.accountInfo!.apiKeySource ?? '').isNotEmpty)) ...[
                Divider(height: 1, color: theme.borderSubtle),
                _InfoRow(
                  theme: theme,
                  icon: AppIcons.person,
                  label: 'Account',
                  value: [
                    if ((init.accountInfo!.subscriptionType ?? '').isNotEmpty)
                      init.accountInfo!.subscriptionType!,
                    if ((init.accountInfo!.apiKeySource ?? '').isNotEmpty)
                      init.accountInfo!.apiKeySource!,
                  ].join(' • '),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }

  /// Codex session info section showing model, approvals, sandbox, effort.
  Widget _buildCodexInfoSection(BuildContext context, OpenCodeTheme theme) {
    final info = cxInfo;
    if (info == null) {
      return _SidebarSection(
        theme: theme,
        title: 'Session Info',
        icon: AppIcons.info,
        children: [
          Container(
            padding: Insets.cardSm,
            decoration: BoxDecoration(
              color: theme.backgroundPanel,
              borderRadius: Radii.brSm,
              border: Border.all(color: theme.borderSubtle, width: 1),
            ),
            child: Row(
              children: [
                Icon(AppIcons.hourglass, color: theme.textMuted, size: 16),
                const SizedBox(width: Spacing.sm),
                Text(
                  'Waiting for thread...',
                  style: AppTypography.bodySmall(color: theme.textMuted),
                ),
              ],
            ),
          ),
        ],
      );
    }
    final s = info.settings;
    return _SidebarSection(
      theme: theme,
      title: 'Codex',
      icon: AppIcons.agent,
      children: [
        Container(
          decoration: BoxDecoration(
            color: theme.backgroundPanel,
            borderRadius: Radii.brMd,
            border: Border.all(color: theme.borderSubtle, width: 1),
          ),
          child: Column(
            children: [
              // Model
              _InfoRow(
                theme: theme,
                icon: AppIcons.memory,
                label: 'Model',
                value: info.model?.isNotEmpty == true ? info.model! : 'default',
              ),
              Divider(height: 1, color: theme.borderSubtle),
              // Approval policy
              _InfoRow(
                theme: theme,
                icon: AppIcons.security,
                label: 'Approvals',
                value: s.approvalPolicy.wireValue,
              ),
              Divider(height: 1, color: theme.borderSubtle),
              // Sandbox mode
              _InfoRow(
                theme: theme,
                icon: AppIcons.vpn,
                label: 'Sandbox',
                value: s.sandboxMode == CodexSandboxMode.workspaceWrite
                    ? '${s.sandboxMode.threadWireValue} (net=${s.networkAccessEnabled})'
                    : s.sandboxMode.threadWireValue,
              ),
              Divider(height: 1, color: theme.borderSubtle),
              // Reasoning effort
              _InfoRow(
                theme: theme,
                icon: AppIcons.psychology,
                label: 'Effort',
                value: s.reasoningEffort.wireValue,
              ),
              Divider(height: 1, color: theme.borderSubtle),
              // Web search
              _InfoRow(
                theme: theme,
                icon: AppIcons.search,
                label: 'Web Search',
                value: s.webSearchMode.wireValue,
              ),
              if (s.skillsEnabled) ...[
                Divider(height: 1, color: theme.borderSubtle),
                _InfoRow(
                  theme: theme,
                  icon: AppIcons.autoAwesome,
                  label: 'Skills',
                  value: 'enabled',
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildClaudeCodeMcpSection(BuildContext context, OpenCodeTheme theme) {
    final init = ccInit;
    final servers = init?.mcpServers ?? const <Map<String, dynamic>>[];
    return _SidebarSection(
      theme: theme,
      title: 'MCP Servers',
      icon: AppIcons.dns,
      children: [
        for (final s in servers.take(12))
          _McpServerRow(
            name: (s['name'] ?? '').toString(),
            status: (s['status'] ?? '').toString(),
          ),
        if (servers.length > 12)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              '+${servers.length - 12} more',
              style: AppTypography.label(color: theme.textMuted),
            ),
          ),
      ],
    );
  }

  Widget _buildClaudeCodeSkillsSection(
    BuildContext context,
    OpenCodeTheme theme,
  ) {
    final init = ccInit;
    final skills = init?.skills ?? const <String>[];
    return _SidebarSection(
      theme: theme,
      title: 'Skills',
      icon: AppIcons.autoAwesome,
      children: [
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            for (final s in skills.take(16))
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 6,
                ),
                decoration: BoxDecoration(
                  color: theme.backgroundElement,
                  borderRadius: Radii.brFull,
                  border: Border.all(color: theme.borderSubtle),
                ),
                child: Text(s, style: AppTypography.label(color: theme.text)),
              ),
          ],
        ),
        if (skills.length > 16)
          Padding(
            padding: Insets.topSm,
            child: Text(
              '+${skills.length - 16} more',
              style: AppTypography.label(color: theme.textMuted),
            ),
          ),
      ],
    );
  }

  Widget _buildPlanSection(BuildContext context, OpenCodeTheme theme) {
    if (todos.isEmpty) {
      return _SidebarSection(
        theme: theme,
        title: 'Plan',
        icon: AppIcons.checklist,
        children: [
          Container(
            padding: Insets.cardSm,
            decoration: BoxDecoration(
              color: theme.backgroundPanel,
              borderRadius: Radii.brSm,
              border: Border.all(color: theme.borderSubtle, width: 1),
            ),
            child: Row(
              children: [
                Icon(AppIcons.info, color: theme.textMuted, size: 16),
                const SizedBox(width: Spacing.sm),
                Text(
                  'No active plan',
                  style: AppTypography.bodySmall(color: theme.textMuted),
                ),
              ],
            ),
          ),
        ],
      );
    }
    // Count by status
    final completed = todos
        .where((t) => t.status == TodoStatus.completed)
        .length;
    final total = todos.length;
    return _SidebarSection(
      theme: theme,
      title: 'Plan',
      icon: AppIcons.checklist,
      trailing: Text(
        '$completed/$total done',
        style: TextStyle(
          fontSize: 12,
          color: theme.textMuted,
          fontWeight: FontWeight.w500,
        ),
      ),
      children: [
        Container(
          decoration: BoxDecoration(
            color: theme.backgroundPanel,
            borderRadius: Radii.brMd,
            border: Border.all(color: theme.borderSubtle, width: 1),
          ),
          child: Column(
            children: [
              for (int i = 0; i < todos.length; i++) ...[
                _TodoItem(theme: theme, todo: todos[i]),
                if (i < todos.length - 1)
                  Divider(color: theme.borderSubtle, height: 1),
              ],
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildLspSection(BuildContext context, OpenCodeTheme theme) {
    final lspServers = sessionContext.lsp;
    if (lspServers.isEmpty) {
      return _SidebarSection(
        theme: theme,
        title: 'LSP',
        icon: AppIcons.code,
        children: [
          Container(
            padding: Insets.cardSm,
            decoration: BoxDecoration(
              color: theme.backgroundPanel,
              borderRadius: Radii.brSm,
              border: Border.all(color: theme.borderSubtle, width: 1),
            ),
            child: Row(
              children: [
                Icon(AppIcons.info, color: theme.textMuted, size: 16),
                const SizedBox(width: Spacing.sm),
                Text(
                  'No LSP servers active',
                  style: AppTypography.bodySmall(color: theme.textMuted),
                ),
              ],
            ),
          ),
        ],
      );
    }
    return _SidebarSection(
      theme: theme,
      title: 'LSP',
      icon: AppIcons.code,
      children: [
        for (final server in lspServers) ...[
          _LspServerItem(theme: theme, server: server),
          if (server != lspServers.last) const SizedBox(height: Spacing.sm),
        ],
      ],
    );
  }

  Widget _buildChangesSection(BuildContext context, OpenCodeTheme theme) {
    if (sessionDiffs.isEmpty) {
      return _SidebarSection(
        theme: theme,
        title: 'Changes',
        icon: AppIcons.diff,
        children: [
          Container(
            padding: Insets.cardSm,
            decoration: BoxDecoration(
              color: theme.backgroundPanel,
              borderRadius: Radii.brSm,
              border: Border.all(color: theme.borderSubtle, width: 1),
            ),
            child: Row(
              children: [
                Icon(AppIcons.info, color: theme.textMuted, size: 16),
                const SizedBox(width: Spacing.sm),
                Text(
                  'No diffs yet',
                  style: AppTypography.bodySmall(color: theme.textMuted),
                ),
              ],
            ),
          ),
        ],
      );
    }
    // Calculate totals
    var totalAdditions = 0;
    var totalDeletions = 0;
    for (final diff in sessionDiffs) {
      totalAdditions += diff.additions;
      totalDeletions += diff.deletions;
    }
    return _SidebarSection(
      theme: theme,
      title: 'Changes',
      icon: AppIcons.diff,
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            '+$totalAdditions',
            style: TextStyle(
              fontSize: 12,
              color: theme.success,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(width: 6),
          Text(
            '-$totalDeletions',
            style: TextStyle(
              fontSize: 12,
              color: theme.error,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
      children: [
        Container(
          decoration: BoxDecoration(
            color: theme.backgroundPanel,
            borderRadius: Radii.brMd,
            border: Border.all(color: theme.borderSubtle, width: 1),
          ),
          child: Column(
            children: [
              for (int i = 0; i < sessionDiffs.length; i++) ...[
                _DiffFileItem(
                  theme: theme,
                  diff: sessionDiffs[i],
                  onOpen: onOpenDiff,
                ),
                if (i < sessionDiffs.length - 1)
                  Divider(color: theme.borderSubtle, height: 1),
              ],
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildModifiedFilesSection(BuildContext context, OpenCodeTheme theme) {
    final files = sessionContext.modifiedFiles;
    if (files.isEmpty) {
      return _SidebarSection(
        theme: theme,
        title: 'Modified Files',
        icon: AppIcons.edit,
        children: [
          Container(
            padding: Insets.cardSm,
            decoration: BoxDecoration(
              color: theme.backgroundPanel,
              borderRadius: Radii.brSm,
              border: Border.all(color: theme.borderSubtle, width: 1),
            ),
            child: Row(
              children: [
                Icon(AppIcons.checkCircle, color: theme.success, size: 16),
                const SizedBox(width: Spacing.sm),
                Text(
                  'No files modified yet',
                  style: AppTypography.bodySmall(color: theme.textMuted),
                ),
              ],
            ),
          ),
        ],
      );
    }
    // Calculate totals
    int totalAdditions = 0;
    int totalDeletions = 0;
    for (final file in files) {
      totalAdditions += file.additions;
      totalDeletions += file.deletions;
    }
    return _SidebarSection(
      theme: theme,
      title: 'Modified Files',
      icon: AppIcons.edit,
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            '+$totalAdditions',
            style: TextStyle(
              fontSize: 12,
              color: theme.success,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(width: 6),
          Text(
            '-$totalDeletions',
            style: TextStyle(
              fontSize: 12,
              color: theme.error,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
      children: [
        Container(
          decoration: BoxDecoration(
            color: theme.backgroundPanel,
            borderRadius: Radii.brMd,
            border: Border.all(color: theme.borderSubtle, width: 1),
          ),
          child: Column(
            children: [
              for (int i = 0; i < files.length; i++) ...[
                _ModifiedFileItem(theme: theme, file: files[i]),
                if (i < files.length - 1)
                  Divider(color: theme.borderSubtle, height: 1),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

/// Section container with title and optional icon
class _SidebarSection extends StatelessWidget {
  const _SidebarSection({
    required this.theme,
    required this.title,
    this.icon,
    this.trailing,
    required this.children,
  });
  final OpenCodeTheme theme;
  final String title;
  final IconData? icon;
  final Widget? trailing;
  final List<Widget> children;
  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            if (icon != null) ...[
              Icon(icon, size: 14, color: theme.textMuted),
              const SizedBox(width: 6),
            ],
            SectionHeader(title: title, theme: theme),
            if (trailing != null) ...[const Spacer(), trailing!],
          ],
        ),
        const SizedBox(height: 10),
        ...children,
      ],
    );
  }
}

/// Stat item with icon and label
class _StatItem extends StatelessWidget {
  const _StatItem({
    required this.theme,
    required this.label,
    this.sublabel,
    required this.icon,
  });
  final OpenCodeTheme theme;
  final String label;
  final String? sublabel;
  final IconData icon;
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: theme.backgroundPanel,
        borderRadius: Radii.brSm,
        border: Border.all(color: theme.borderSubtle, width: 1),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: theme.textMuted),
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              color: theme.text,
              fontWeight: FontWeight.w500,
            ),
          ),
          if (sublabel != null) ...[
            const SizedBox(width: Spacing.xs),
            Text(sublabel!, style: AppTypography.label(color: theme.textMuted)),
          ],
        ],
      ),
    );
  }
}

/// Info row for Claude Code sidebar (icon, label, value)
class _InfoRow extends StatelessWidget {
  const _InfoRow({
    required this.theme,
    required this.icon,
    required this.label,
    required this.value,
  });
  final OpenCodeTheme theme;
  final IconData icon;
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      child: Row(
        children: [
          Icon(icon, size: 16, color: theme.textMuted),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              label,
              style: AppTypography.bodySmall(color: theme.textMuted),
            ),
          ),
          Text(
            value,
            style: TextStyle(
              fontSize: 13,
              color: theme.text,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}

class _McpServerRow extends StatelessWidget {
  const _McpServerRow({required this.name, required this.status});
  final String name;
  final String status;
  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final st = status.toLowerCase();
    final color = st.contains('connected') || st == 'ok'
        ? theme.success
        : st.contains('needs_auth') || st.contains('auth')
        ? theme.warning
        : st.contains('registration') || st.contains('failed')
        ? theme.error
        : theme.textMuted;
    return Padding(
      padding: Insets.bottomSm,
      child: Row(
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              name.isEmpty ? 'server' : name,
              style: AppTypography.bodySmall(color: theme.text),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(width: 10),
          Text(
            status.isEmpty ? 'unknown' : status,
            style: AppTypography.label(color: theme.textMuted),
          ),
        ],
      ),
    );
  }
}

/// LSP server item showing status and name
class _LspServerItem extends StatelessWidget {
  const _LspServerItem({required this.theme, required this.server});
  final OpenCodeTheme theme;
  final LspServer server;
  @override
  Widget build(BuildContext context) {
    final statusType = switch (server.status) {
      LspStatus.running => StatusType.success,
      LspStatus.error => StatusType.error,
      LspStatus.stopped => StatusType.pending,
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: theme.backgroundPanel,
        borderRadius: Radii.brSm,
        border: Border.all(color: theme.borderSubtle, width: 1),
      ),
      child: Row(
        children: [
          StatusIndicator(
            status: statusType,
            size: 8,
            showGlow: server.status == LspStatus.running,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  server.displayName,
                  style: TextStyle(
                    fontSize: 13,
                    color: theme.text,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                if (server.shortRoot != null) ...[
                  const SizedBox(height: Spacing.xxs),
                  Text(
                    server.shortRoot!,
                    style: AppTypography.caption(color: theme.textMuted),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Modified file item showing path and diff stats
class _ModifiedFileItem extends StatelessWidget {
  const _ModifiedFileItem({required this.theme, required this.file});
  final OpenCodeTheme theme;
  final ModifiedFile file;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      child: Row(
        children: [
          Icon(AppIcons.description, size: 16, color: theme.textMuted),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              file.shortPath,
              style: AppTypography.bodySmall(color: theme.text),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(width: Spacing.sm),
          Text(
            file.formattedAdditions,
            style: TextStyle(
              fontSize: 12,
              color: theme.success,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(width: 6),
          Text(
            file.formattedDeletions,
            style: TextStyle(
              fontSize: 12,
              color: theme.error,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _DiffFileItem extends StatelessWidget {
  const _DiffFileItem({required this.theme, required this.diff, this.onOpen});
  final OpenCodeTheme theme;
  final DiffEntry diff;
  final void Function(DiffEntry diff)? onOpen;
  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onOpen != null ? () => onOpen!(diff) : null,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Row(
          children: [
            Icon(AppIcons.code, size: 16, color: theme.textMuted),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                _shortPath(diff.file),
                style: AppTypography.bodySmall(color: theme.text),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const SizedBox(width: Spacing.sm),
            Text(
              '+${diff.additions}',
              style: TextStyle(
                fontSize: 12,
                color: theme.success,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(width: 6),
            Text(
              '-${diff.deletions}',
              style: TextStyle(
                fontSize: 12,
                color: theme.error,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _shortPath(String path) {
    if (path.isEmpty) return 'file';
    final parts = path.split('/');
    if (parts.length <= 2) return path;
    final start = parts.length > 3 ? parts.length - 3 : 0;
    return parts.sublist(start).join('/');
  }
}

/// Todo item showing status icon and content
class _TodoItem extends StatelessWidget {
  const _TodoItem({required this.theme, required this.todo});
  final OpenCodeTheme theme;
  final Todo todo;
  @override
  Widget build(BuildContext context) {
    // Get status icon and color
    final (icon, statusType) = switch (todo.status) {
      TodoStatus.pending => (AppIcons.radioUnchecked, StatusType.pending),
      TodoStatus.inProgress => (AppIcons.play, StatusType.info),
      TodoStatus.completed => (AppIcons.checkCircle, StatusType.success),
      TodoStatus.cancelled => (AppIcons.cancel, StatusType.error),
    };
    final color = _getStatusColor(statusType);
    // Get priority indicator
    final priorityColor = switch (todo.priority) {
      TodoPriority.high => theme.error,
      TodoPriority.medium => theme.warning,
      TodoPriority.low => theme.textMuted,
    };
    final isCompleted = todo.status == TodoStatus.completed;
    final isCancelled = todo.status == TodoStatus.cancelled;
    final isActive = todo.status == TodoStatus.inProgress;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Status icon
          Icon(icon, size: 18, color: color),
          const SizedBox(width: 10),
          // Content
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  todo.content,
                  style: TextStyle(
                    fontSize: 13,
                    color: (isCompleted || isCancelled)
                        ? theme.textMuted
                        : theme.text,
                    fontWeight: isActive ? FontWeight.w600 : FontWeight.w400,
                    decoration: isCancelled ? TextDecoration.lineThrough : null,
                  ),
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: Spacing.xs),
                Row(
                  children: [
                    // Priority indicator
                    if (todo.priority == TodoPriority.high) ...[
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 6,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: priorityColor.withValues(alpha: 0.15),
                          borderRadius: Radii.brXs,
                        ),
                        child: Text(
                          'HIGH',
                          style: TextStyle(
                            fontSize: 9,
                            fontWeight: FontWeight.w600,
                            color: priorityColor,
                            letterSpacing: 0.5,
                          ),
                        ),
                      ),
                      const SizedBox(width: 6),
                    ],
                    // Status text
                    Text(
                      todo.status.displayName,
                      style: AppTypography.caption(color: theme.textMuted),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Color _getStatusColor(StatusType status) {
    switch (status) {
      case StatusType.success:
        return theme.success;
      case StatusType.error:
        return theme.error;
      case StatusType.info:
        return theme.info;
      case StatusType.pending:
        return theme.textMuted;
      default:
        return theme.textMuted;
    }
  }
}

/// Compact token breakdown row for the context section.
class _TokenRow extends StatelessWidget {
  const _TokenRow({
    required this.theme,
    required this.label,
    required this.value,
    required this.color,
  });
  final OpenCodeTheme theme;
  final String label;
  final String value;
  final Color color;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.7),
              borderRadius: Radii.brXs,
            ),
          ),
          const SizedBox(width: Spacing.sm),
          Expanded(
            child: Text(
              label,
              style: AppTypography.caption(color: theme.textMuted),
            ),
          ),
          Text(
            value,
            style: TextStyle(
              color: theme.text,
              fontSize: 11,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}
