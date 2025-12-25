import 'package:flutter/material.dart';

import '../models/message.dart';
import '../models/session_context.dart';
import '../models/todo.dart';
import '../models/vcs.dart';
import '../theme/opencode_theme.dart';
import 'status_indicator.dart';

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
  });

  final String sessionTitle;
  final SessionContext sessionContext;
  final List<Todo> todos;
  final VoidCallback? onClose;
  // Feature 10: VCS/Git info
  final VcsInfo? vcsInfo;
  final List<DiffEntry> sessionDiffs;
  final void Function(DiffEntry diff)? onOpenDiff;

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
                padding: const EdgeInsets.symmetric(horizontal: 16),
                children: [
                  const SizedBox(height: 8),
                  _buildContextSection(context, theme),
                  const SizedBox(height: 20),
                  _buildPlanSection(context, theme),
                  const SizedBox(height: 20),
                  _buildLspSection(context, theme),
                  const SizedBox(height: 20),
                  _buildChangesSection(context, theme),
                  const SizedBox(height: 20),
                  _buildModifiedFilesSection(context, theme),
                  const SizedBox(height: 24),
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
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  sessionTitle.isNotEmpty ? sessionTitle : 'Session Details',
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
                          Icons.call_split_rounded,
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
                      ],
                    ),
                  ),
              ],
            ),
          ),
          if (onClose != null)
            IconButton(
              onPressed: onClose,
              icon: Icon(Icons.close, color: theme.textMuted, size: 20),
              splashRadius: 20,
              tooltip: 'Close',
            ),
        ],
      ),
    );
  }

  Widget _buildContextSection(BuildContext context, OpenCodeTheme theme) {
    final ctx = sessionContext;
    final usagePercent = ctx.contextUsagePercent;

    return _SidebarSection(
      theme: theme,
      title: 'Context',
      trailing: Text(
        '${ctx.tokens.formatCount(ctx.tokens.total)} tokens',
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
            borderRadius: BorderRadius.circular(3),
          ),
          child: LayoutBuilder(
            builder: (context, constraints) {
              return Stack(
                children: [
                  AnimatedContainer(
                    duration: const Duration(milliseconds: 300),
                    width: constraints.maxWidth * (usagePercent / 100),
                    decoration: BoxDecoration(
                      color: usagePercent > 80
                          ? theme.error
                          : usagePercent > 50
                          ? theme.warning
                          : theme.info,
                      borderRadius: BorderRadius.circular(3),
                    ),
                  ),
                ],
              );
            },
          ),
        ),
        const SizedBox(height: 12),

        // Stats row
        Row(
          children: [
            _StatItem(
              theme: theme,
              label: '${usagePercent.toStringAsFixed(0)}% used',
              icon: Icons.memory_outlined,
            ),
            const SizedBox(width: 16),
            _StatItem(
              theme: theme,
              label: ctx.formattedCost,
              sublabel: 'spent',
              icon: Icons.attach_money,
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildPlanSection(BuildContext context, OpenCodeTheme theme) {
    if (todos.isEmpty) {
      return _SidebarSection(
        theme: theme,
        title: 'Plan',
        icon: Icons.checklist_rounded,
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: theme.backgroundPanel,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: theme.borderSubtle, width: 1),
            ),
            child: Row(
              children: [
                Icon(Icons.info_outline, color: theme.textMuted, size: 16),
                const SizedBox(width: 8),
                Text(
                  'No active plan',
                  style: TextStyle(color: theme.textMuted, fontSize: 13),
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
      icon: Icons.checklist_rounded,
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
            borderRadius: BorderRadius.circular(10),
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
        icon: Icons.code,
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: theme.backgroundPanel,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: theme.borderSubtle, width: 1),
            ),
            child: Row(
              children: [
                Icon(Icons.info_outline, color: theme.textMuted, size: 16),
                const SizedBox(width: 8),
                Text(
                  'No LSP servers active',
                  style: TextStyle(color: theme.textMuted, fontSize: 13),
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
      icon: Icons.code,
      children: [
        for (final server in lspServers) ...[
          _LspServerItem(theme: theme, server: server),
          if (server != lspServers.last) const SizedBox(height: 8),
        ],
      ],
    );
  }

  Widget _buildChangesSection(BuildContext context, OpenCodeTheme theme) {
    if (sessionDiffs.isEmpty) {
      return _SidebarSection(
        theme: theme,
        title: 'Changes',
        icon: Icons.difference_rounded,
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: theme.backgroundPanel,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: theme.borderSubtle, width: 1),
            ),
            child: Row(
              children: [
                Icon(Icons.info_outline, color: theme.textMuted, size: 16),
                const SizedBox(width: 8),
                Text(
                  'No diffs yet',
                  style: TextStyle(color: theme.textMuted, fontSize: 13),
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
      icon: Icons.difference_rounded,
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
            borderRadius: BorderRadius.circular(10),
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
        icon: Icons.edit_document,
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: theme.backgroundPanel,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: theme.borderSubtle, width: 1),
            ),
            child: Row(
              children: [
                Icon(
                  Icons.check_circle_outline,
                  color: theme.success,
                  size: 16,
                ),
                const SizedBox(width: 8),
                Text(
                  'No files modified yet',
                  style: TextStyle(color: theme.textMuted, fontSize: 13),
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
      icon: Icons.edit_document,
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
            borderRadius: BorderRadius.circular(10),
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
            Text(
              title,
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: theme.textMuted,
                letterSpacing: 0.5,
              ),
            ),
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
        borderRadius: BorderRadius.circular(6),
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
            const SizedBox(width: 4),
            Text(
              sublabel!,
              style: TextStyle(fontSize: 12, color: theme.textMuted),
            ),
          ],
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
        borderRadius: BorderRadius.circular(8),
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
                  const SizedBox(height: 2),
                  Text(
                    server.shortRoot!,
                    style: TextStyle(fontSize: 11, color: theme.textMuted),
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
          Icon(Icons.description_outlined, size: 16, color: theme.textMuted),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              file.shortPath,
              style: TextStyle(fontSize: 13, color: theme.text),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(width: 8),
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
            Icon(Icons.code_rounded, size: 16, color: theme.textMuted),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                _shortPath(diff.file),
                style: TextStyle(fontSize: 13, color: theme.text),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const SizedBox(width: 8),
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
      TodoStatus.pending => (Icons.radio_button_unchecked, StatusType.pending),
      TodoStatus.inProgress => (Icons.play_circle_outline, StatusType.info),
      TodoStatus.completed => (Icons.check_circle, StatusType.success),
      TodoStatus.cancelled => (Icons.cancel_outlined, StatusType.error),
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
                const SizedBox(height: 4),
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
                          borderRadius: BorderRadius.circular(4),
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
                      style: TextStyle(fontSize: 11, color: theme.textMuted),
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
