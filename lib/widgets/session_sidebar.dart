import 'package:flutter/material.dart';

import '../models/message.dart';
import '../models/session_context.dart';
import '../models/todo.dart';
import '../models/vcs.dart';

// Color constants matching chat screen design
const _kBackground = Color(0xFF16161E);
const _kCard = Color(0xFF1F2128);
const _kBorder = Color(0xFF2A2D36);
const _kOnBackground = Color(0xFFE4E4E7);
const _kMuted = Color(0xFF71717A);
const _kSuccess = Color(0xFF10B981);
const _kError = Color(0xFFEF4444);
const _kInfo = Color(0xFF60A5FA);
const _kWarning = Color(0xFFF59E0B);

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
    return Container(
      width: MediaQuery.of(context).size.width * 0.78,
      decoration: const BoxDecoration(
        color: _kBackground,
        border: Border(left: BorderSide(color: _kBorder, width: 1)),
      ),
      child: SafeArea(
        left: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildHeader(),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                children: [
                  const SizedBox(height: 8),
                  _buildContextSection(),
                  const SizedBox(height: 20),
                  _buildPlanSection(),
                  const SizedBox(height: 20),
                  _buildLspSection(),
                  const SizedBox(height: 20),
                  _buildChangesSection(),
                  const SizedBox(height: 20),
                  _buildModifiedFilesSection(),
                  const SizedBox(height: 24),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 12, 8, 12),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: _kBorder, width: 1)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  sessionTitle.isNotEmpty ? sessionTitle : 'Session Details',
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                    color: _kOnBackground,
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
                        const Icon(
                          Icons.call_split_rounded,
                          size: 14,
                          color: _kSuccess,
                        ),
                        const SizedBox(width: 6),
                        Text(
                          vcsInfo!.branch ?? '',
                          style: const TextStyle(
                            fontSize: 13,
                            color: _kMuted,
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
              icon: const Icon(Icons.close, color: _kMuted, size: 20),
              splashRadius: 20,
              tooltip: 'Close',
            ),
        ],
      ),
    );
  }

  Widget _buildContextSection() {
    final ctx = sessionContext;
    final usagePercent = ctx.contextUsagePercent;

    return _SidebarSection(
      title: 'Context',
      trailing: Text(
        '${ctx.tokens.formatCount(ctx.tokens.total)} tokens',
        style: const TextStyle(
          fontSize: 12,
          color: _kMuted,
          fontWeight: FontWeight.w500,
        ),
      ),
      children: [
        // Token usage progress bar
        Container(
          height: 6,
          decoration: BoxDecoration(
            color: _kCard,
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
                          ? _kError
                          : usagePercent > 50
                          ? const Color(0xFFF59E0B)
                          : _kInfo,
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
              label: '${usagePercent.toStringAsFixed(0)}% used',
              icon: Icons.memory_outlined,
            ),
            const SizedBox(width: 16),
            _StatItem(
              label: ctx.formattedCost,
              sublabel: 'spent',
              icon: Icons.attach_money,
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildPlanSection() {
    if (todos.isEmpty) {
      return _SidebarSection(
        title: 'Plan',
        icon: Icons.checklist_rounded,
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: _kCard,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: _kBorder, width: 1),
            ),
            child: const Row(
              children: [
                Icon(Icons.info_outline, color: _kMuted, size: 16),
                SizedBox(width: 8),
                Text(
                  'No active plan',
                  style: TextStyle(color: _kMuted, fontSize: 13),
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
      title: 'Plan',
      icon: Icons.checklist_rounded,
      trailing: Text(
        '$completed/$total done',
        style: const TextStyle(
          fontSize: 12,
          color: _kMuted,
          fontWeight: FontWeight.w500,
        ),
      ),
      children: [
        Container(
          decoration: BoxDecoration(
            color: _kCard,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: _kBorder, width: 1),
          ),
          child: Column(
            children: [
              for (int i = 0; i < todos.length; i++) ...[
                _TodoItem(todo: todos[i]),
                if (i < todos.length - 1)
                  const Divider(color: _kBorder, height: 1),
              ],
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildLspSection() {
    final lspServers = sessionContext.lsp;

    if (lspServers.isEmpty) {
      return _SidebarSection(
        title: 'LSP',
        icon: Icons.code,
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: _kCard,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: _kBorder, width: 1),
            ),
            child: const Row(
              children: [
                Icon(Icons.info_outline, color: _kMuted, size: 16),
                SizedBox(width: 8),
                Text(
                  'No LSP servers active',
                  style: TextStyle(color: _kMuted, fontSize: 13),
                ),
              ],
            ),
          ),
        ],
      );
    }

    return _SidebarSection(
      title: 'LSP',
      icon: Icons.code,
      children: [
        for (final server in lspServers) ...[
          _LspServerItem(server: server),
          if (server != lspServers.last) const SizedBox(height: 8),
        ],
      ],
    );
  }

  Widget _buildChangesSection() {
    if (sessionDiffs.isEmpty) {
      return _SidebarSection(
        title: 'Changes',
        icon: Icons.difference_rounded,
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: _kCard,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: _kBorder, width: 1),
            ),
            child: const Row(
              children: [
                Icon(Icons.info_outline, color: _kMuted, size: 16),
                SizedBox(width: 8),
                Text(
                  'No diffs yet',
                  style: TextStyle(color: _kMuted, fontSize: 13),
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
      title: 'Changes',
      icon: Icons.difference_rounded,
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            '+$totalAdditions',
            style: const TextStyle(
              fontSize: 12,
              color: _kSuccess,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(width: 6),
          Text(
            '-$totalDeletions',
            style: const TextStyle(
              fontSize: 12,
              color: _kError,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
      children: [
        Container(
          decoration: BoxDecoration(
            color: _kCard,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: _kBorder, width: 1),
          ),
          child: Column(
            children: [
              for (int i = 0; i < sessionDiffs.length; i++) ...[
                _DiffFileItem(diff: sessionDiffs[i], onOpen: onOpenDiff),
                if (i < sessionDiffs.length - 1)
                  const Divider(color: _kBorder, height: 1),
              ],
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildModifiedFilesSection() {
    final files = sessionContext.modifiedFiles;

    if (files.isEmpty) {
      return _SidebarSection(
        title: 'Modified Files',
        icon: Icons.edit_document,
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: _kCard,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: _kBorder, width: 1),
            ),
            child: const Row(
              children: [
                Icon(Icons.check_circle_outline, color: _kSuccess, size: 16),
                SizedBox(width: 8),
                Text(
                  'No files modified yet',
                  style: TextStyle(color: _kMuted, fontSize: 13),
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
      title: 'Modified Files',
      icon: Icons.edit_document,
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            '+$totalAdditions',
            style: const TextStyle(
              fontSize: 12,
              color: _kSuccess,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(width: 6),
          Text(
            '-$totalDeletions',
            style: const TextStyle(
              fontSize: 12,
              color: _kError,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
      children: [
        Container(
          decoration: BoxDecoration(
            color: _kCard,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: _kBorder, width: 1),
          ),
          child: Column(
            children: [
              for (int i = 0; i < files.length; i++) ...[
                _ModifiedFileItem(file: files[i]),
                if (i < files.length - 1)
                  const Divider(color: _kBorder, height: 1),
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
    required this.title,
    this.icon,
    this.trailing,
    required this.children,
  });

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
              Icon(icon, size: 14, color: _kMuted),
              const SizedBox(width: 6),
            ],
            Text(
              title,
              style: const TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: _kMuted,
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
  const _StatItem({required this.label, this.sublabel, required this.icon});

  final String label;
  final String? sublabel;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: _kCard,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: _kBorder, width: 1),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: _kMuted),
          const SizedBox(width: 6),
          Text(
            label,
            style: const TextStyle(
              fontSize: 12,
              color: _kOnBackground,
              fontWeight: FontWeight.w500,
            ),
          ),
          if (sublabel != null) ...[
            const SizedBox(width: 4),
            Text(
              sublabel!,
              style: const TextStyle(fontSize: 12, color: _kMuted),
            ),
          ],
        ],
      ),
    );
  }
}

/// LSP server item showing status and name
class _LspServerItem extends StatelessWidget {
  const _LspServerItem({required this.server});

  final LspServer server;

  @override
  Widget build(BuildContext context) {
    final statusColor = switch (server.status) {
      LspStatus.running => _kSuccess,
      LspStatus.error => _kError,
      LspStatus.stopped => _kMuted,
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: _kCard,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: _kBorder, width: 1),
      ),
      child: Row(
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              color: statusColor,
              shape: BoxShape.circle,
              boxShadow: server.status == LspStatus.running
                  ? [
                      BoxShadow(
                        color: statusColor.withValues(alpha: 0.4),
                        blurRadius: 4,
                        spreadRadius: 1,
                      ),
                    ]
                  : null,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  server.displayName,
                  style: const TextStyle(
                    fontSize: 13,
                    color: _kOnBackground,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                if (server.shortRoot != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    server.shortRoot!,
                    style: const TextStyle(fontSize: 11, color: _kMuted),
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
  const _ModifiedFileItem({required this.file});

  final ModifiedFile file;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      child: Row(
        children: [
          const Icon(Icons.description_outlined, size: 16, color: _kMuted),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              file.shortPath,
              style: const TextStyle(fontSize: 13, color: _kOnBackground),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(width: 8),
          Text(
            file.formattedAdditions,
            style: const TextStyle(
              fontSize: 12,
              color: _kSuccess,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(width: 6),
          Text(
            file.formattedDeletions,
            style: const TextStyle(
              fontSize: 12,
              color: _kError,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _DiffFileItem extends StatelessWidget {
  const _DiffFileItem({required this.diff, this.onOpen});

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
            const Icon(Icons.code_rounded, size: 16, color: _kMuted),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                _shortPath(diff.file),
                style: const TextStyle(fontSize: 13, color: _kOnBackground),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const SizedBox(width: 8),
            Text(
              '+${diff.additions}',
              style: const TextStyle(
                fontSize: 12,
                color: _kSuccess,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(width: 6),
            Text(
              '-${diff.deletions}',
              style: const TextStyle(
                fontSize: 12,
                color: _kError,
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
  const _TodoItem({required this.todo});

  final Todo todo;

  @override
  Widget build(BuildContext context) {
    // Get status icon and color
    final (icon, color) = switch (todo.status) {
      TodoStatus.pending => (Icons.radio_button_unchecked, _kMuted),
      TodoStatus.inProgress => (Icons.play_circle_outline, _kInfo),
      TodoStatus.completed => (Icons.check_circle, _kSuccess),
      TodoStatus.cancelled => (Icons.cancel_outlined, _kError),
    };

    // Get priority indicator
    final priorityColor = switch (todo.priority) {
      TodoPriority.high => _kError,
      TodoPriority.medium => _kWarning,
      TodoPriority.low => _kMuted,
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
                        ? _kMuted
                        : _kOnBackground,
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
                      style: const TextStyle(fontSize: 11, color: _kMuted),
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
}
