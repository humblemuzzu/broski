
import 'package:flutter/material.dart';
import '../theme/app_typography.dart';

import '../theme/design_tokens.dart';
import '../theme/opencode_theme.dart';
import 'chat/detail_sheet.dart';
import 'package:broski/theme/app_icons.dart';
/// Shows a rollback sheet using DetailSheet.
/// Returns Future that completes when the sheet is dismissed.
Future<void> showRollbackSheet({
  required BuildContext context,
  required int maxTurns,
  required Future<void> Function(int numTurns) onRollback,
}) {
  return DetailSheet.show(
    context: context,
    title: 'Rollback',
    initialSize: 0.4,
    maxSize: 0.5,
    minSize: 0.3,
    child: _RollbackSheetContent(maxTurns: maxTurns, onRollback: onRollback),
  );
}
/// Legacy widget for backwards compatibility.
/// Prefer using [showRollbackSheet] instead.
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
  @override
  Widget build(BuildContext context) {
    // Wrap legacy usage in DetailSheet pattern
    return DetailSheet(
      title: 'Rollback',
      child: SingleChildScrollView(
        child: _RollbackSheetContent(
          maxTurns: widget.maxTurns,
          onRollback: widget.onRollback,
        ),
      ),
    );
  }
}
/// The actual content of the rollback sheet.
class _RollbackSheetContent extends StatefulWidget {
  const _RollbackSheetContent({
    required this.maxTurns,
    required this.onRollback,
  });
  final int maxTurns;
  final Future<void> Function(int numTurns) onRollback;
  @override
  State<_RollbackSheetContent> createState() => _RollbackSheetContentState();
}
class _RollbackSheetContentState extends State<_RollbackSheetContent> {
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
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Drop the last $turns turn${turns == 1 ? '' : 's'} from this thread.',
            style: AppTypography.bodySmall(color: theme.textMuted),
          ),
          SizedBox(height: Spacing.lg),
          Row(
            children: [
              IconButton(
                onPressed: _working || turns <= 1
                    ? null
                    : () => setState(() => _turns = turns - 1),
                icon: const Icon(AppIcons.remove),
                color: theme.textMuted,
              ),
              Expanded(
                child: Slider(
                  value: turns.toDouble(),
                  min: 1,
                  max: max.toDouble(),
                  divisions: max > 1 ? max - 1 : 1,
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
                icon: const Icon(AppIcons.add),
                color: theme.textMuted,
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            'Max: $max',
            style: AppTypography.label(color: theme.textMuted),
            textAlign: TextAlign.right,
          ),
          SizedBox(height: Spacing.lg),
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
              SizedBox(width: Spacing.md),
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
                    foregroundColor: theme.selectedListItemText,
                  ),
                  child: _working
                      ? SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: theme.selectedListItemText,
                          ),
                        )
                      : const Text('Rollback'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
