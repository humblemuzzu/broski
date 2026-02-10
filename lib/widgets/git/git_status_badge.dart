import 'package:flutter/material.dart';

import '../../models/git.dart';

class GitStatusBadge extends StatelessWidget {
  const GitStatusBadge({super.key, required this.status});

  final GitChangeStatus status;

  Color _color(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    switch (status) {
      case GitChangeStatus.added:
        return Colors.green.shade600;
      case GitChangeStatus.deleted:
        return scheme.error;
      case GitChangeStatus.renamed:
      case GitChangeStatus.copied:
        return Colors.blue.shade600;
      case GitChangeStatus.modified:
        return Colors.orange.shade700;
    }
  }

  @override
  Widget build(BuildContext context) {
    final color = _color(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.45)),
      ),
      child: Text(
        status.shortLabel,
        style: TextStyle(
          color: color,
          fontWeight: FontWeight.w700,
          fontSize: 11,
        ),
      ),
    );
  }
}
