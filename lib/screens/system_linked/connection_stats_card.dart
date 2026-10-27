import 'package:broski/services/onboarding/linked_machine_counts.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:flutter/material.dart';

/// The connected screen's stats: what the link is doing, and what the machine
/// answered when it was asked what is on it.
typedef LinkStatsView = ({
  int? latencyMs,
  String route,
  LinkedMachineCounts? counts,
});

/// The rows the screen reads at a glance. Nothing here is inferred: a count
/// appears only when something counted it, and a read that failed says so.
class ConnectionStatsCard extends StatelessWidget {
  const ConnectionStatsCard({
    super.key,
    required this.stats,
    this.status = 'CONNECTED',
  });

  final LinkStatsView stats;
  final String status;

  @override
  Widget build(BuildContext context) {
    final counts = stats.counts;
    final latency = stats.latencyMs;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 24),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.04),
        borderRadius: Radii.brLg,
        border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
      ),
      child: Column(
        children: [
          StatRow(
            label: 'STATUS',
            value: status,
            valueColor: const Color(0xFF2ECB71),
          ),
          const _RowDivider(),
          StatRow(
            label: 'LATENCY',
            value: latency != null ? '${latency}ms' : '—',
          ),
          const _RowDivider(),
          StatRow(label: 'ROUTE', value: stats.route),
          if (counts != null && counts.projects > 0) ...[
            const _RowDivider(),
            StatRow(label: 'PROJECTS', value: '${counts.projects}  Detected'),
          ],
          if (counts != null && counts.sessions > 0) ...[
            const _RowDivider(),
            StatRow(label: 'SESSIONS', value: '${counts.sessions}  Detected'),
          ],
          if (counts != null && counts.agents > 0) ...[
            const _RowDivider(),
            StatRow(label: 'SUBAGENTS', value: '${counts.agents}  Detected'),
          ],
          for (final failure in counts?.failures ?? const <String>[])
            ..._failure(context, failure),
        ],
      ),
    );
  }

  List<Widget> _failure(BuildContext context, String failure) => [
    const _RowDivider(),
    StatRow(
      label: 'COULD NOT READ',
      value: failure,
      valueColor: Theme.of(context).colorScheme.error,
      wrap: true,
    ),
  ];
}

class _RowDivider extends StatelessWidget {
  const _RowDivider();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: Insets.cardV,
      child: Container(height: 1, color: Colors.white.withValues(alpha: 0.06)),
    );
  }
}

class StatRow extends StatelessWidget {
  const StatRow({
    super.key,
    required this.label,
    required this.value,
    this.valueColor,
    this.wrap = false,
  });

  final String label;
  final String value;
  final Color? valueColor;
  final bool wrap;

  @override
  Widget build(BuildContext context) {
    final labelText = Text(
      label,
      style: TextStyle(
        color: Colors.white.withValues(alpha: 0.4),
        fontSize: 13,
        fontWeight: FontWeight.w500,
        letterSpacing: 1.2,
      ),
    );
    final valueText = Text(
      value,
      textAlign: wrap ? TextAlign.end : TextAlign.start,
      style: TextStyle(
        color: valueColor ?? Colors.white,
        fontSize: 14,
        fontWeight: FontWeight.w700,
      ),
    );
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        labelText,
        if (wrap)
          Flexible(child: valueText)
        else ...[
          const SizedBox(width: 16),
          valueText,
        ],
      ],
    );
  }
}
