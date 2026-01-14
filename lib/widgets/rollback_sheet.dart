import 'package:flutter/material.dart';

import '../theme/opencode_theme.dart';

class RollbackSheet extends StatefulWidget {
  const RollbackSheet({
    super.key,
    required this.maxTurns,
    required this.onRollback,
  });

  final int maxTurns;
  final Future<void> Function(int numTurns) onRollback;

  @override
  State<RollbackSheet> createState() => _RollbackSheetState();
}

class _RollbackSheetState extends State<RollbackSheet> {
  int _turns = 1;
  bool _working = false;

  @override
  void initState() {
    super.initState();
    _turns = widget.maxTurns < 1 ? 1 : 1;
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final max = widget.maxTurns < 1 ? 1 : widget.maxTurns;
    final turns = _turns.clamp(1, max);

    return SafeArea(
      child: Container(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
        decoration: BoxDecoration(
          color: theme.backgroundPanel,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                width: 42,
                height: 4,
                decoration: BoxDecoration(
                  color: theme.textMuted.withValues(alpha: 0.5),
                  borderRadius: BorderRadius.circular(3),
                ),
              ),
            ),
            const SizedBox(height: 14),
            Text(
              'Rollback',
              style: TextStyle(
                color: theme.text,
                fontSize: 16,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              'Drop the last $turns turn${turns == 1 ? '' : 's'} from this thread.',
              style: TextStyle(color: theme.textMuted, fontSize: 13),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                IconButton(
                  onPressed: _working || turns <= 1
                      ? null
                      : () => setState(() => _turns = turns - 1),
                  icon: const Icon(Icons.remove_circle_outline_rounded),
                  color: theme.textMuted,
                ),
                Expanded(
                  child: Slider(
                    value: turns.toDouble(),
                    min: 1,
                    max: max.toDouble(),
                    divisions: max - 1,
                    onChanged: _working
                        ? null
                        : (v) => setState(() => _turns = v.round()),
                    activeColor: theme.primary,
                    inactiveColor: theme.borderSubtle,
                  ),
                ),
                IconButton(
                  onPressed: _working || turns >= max
                      ? null
                      : () => setState(() => _turns = turns + 1),
                  icon: const Icon(Icons.add_circle_outline_rounded),
                  color: theme.textMuted,
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              'Max: $max',
              style: TextStyle(color: theme.textMuted, fontSize: 12),
              textAlign: TextAlign.right,
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: _working ? null : () => Navigator.pop(context),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: theme.textMuted,
                      side: BorderSide(color: theme.borderSubtle),
                    ),
                    child: const Text('Cancel'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: ElevatedButton(
                    onPressed: _working
                        ? null
                        : () async {
                            setState(() => _working = true);
                            try {
                              await widget.onRollback(turns);
                            } finally {
                              if (mounted) setState(() => _working = false);
                            }
                          },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: theme.error,
                      foregroundColor: Colors.white,
                    ),
                    child: _working
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const Text('Rollback'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

