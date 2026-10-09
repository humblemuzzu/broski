import 'package:broski/models/runtime/runtime_model_summary.dart';
import 'package:broski/models/session_context.dart';
import 'package:broski/utils/format_utils.dart';

/// The durable bridge's `backendData.usage`, summed across the models the
/// session has billed, plus the plan flag that decides whether a price is real.
class PiDurableUsage {
  const PiDurableUsage({
    this.input = 0,
    this.output = 0,
    this.cacheRead = 0,
    this.cacheWrite = 0,
    this.totalTokens = 0,
    this.costUsd = 0,
    this.includedInPlan = false,
    this.hasUsage = false,
  });

  final int input;
  final int output;
  final int cacheRead;
  final int cacheWrite;
  final int totalTokens;
  final double costUsd;

  /// True when every billed model is covered by a subscription: the catalog's
  /// list price must not be shown as spend.
  final bool includedInPlan;

  /// False when the bridge has not reported usage yet, so callers can skip the pill.
  final bool hasUsage;

  factory PiDurableUsage.fromUsage(Map<String, dynamic>? usage) {
    if (usage == null) return const PiDurableUsage();
    final models = usage['models'];
    if (models is! Map) return const PiDurableUsage();

    var input = 0;
    var output = 0;
    var cacheRead = 0;
    var cacheWrite = 0;
    var totalTokens = 0;
    var costUsd = 0.0;
    var billed = false;
    var allIncluded = true;

    for (final bucket in models.values) {
      if (bucket is! Map) continue;
      billed = true;
      input += _intOf(bucket['input']);
      output += _intOf(bucket['output']);
      cacheRead += _intOf(bucket['cacheRead']);
      cacheWrite += _intOf(bucket['cacheWrite']);
      totalTokens += _intOf(bucket['totalTokens']);
      if (bucket['includedInPlan'] != true) allIncluded = false;
      final cost = bucket['cost'];
      if (cost is Map) costUsd += _doubleOf(cost['total']);
    }

    return PiDurableUsage(
      input: input,
      output: output,
      cacheRead: cacheRead,
      cacheWrite: cacheWrite,
      totalTokens: totalTokens,
      costUsd: costUsd,
      includedInPlan: billed && allIncluded,
      hasUsage: billed,
    );
  }

  /// What the pill's cost chip reads: the plan when it covers the model, else the spend.
  String get costLabel {
    if (includedInPlan) return 'Included in plan';
    if (costUsd <= 0) return 'Free';
    return '\$${costUsd.toStringAsFixed(4)}';
  }

  SessionContext toSessionContext({
    required int? contextTokens,
    required int contextWindow,
  }) {
    final occupancy = contextTokens ?? totalTokens;
    return SessionContext(
      tokens: TokenUsage(
        input: input,
        output: output,
        total: input + output,
        contextTokens: occupancy > 0 ? occupancy : input,
        contextWindow: contextWindow,
        cacheRead: cacheRead > 0 ? cacheRead : null,
        cacheWrite: cacheWrite > 0 ? cacheWrite : null,
      ),
      cost: costUsd,
      lsp: const [],
      modifiedFiles: const [],
    );
  }
}

/// The context window of the durable session's model, read off the unified model
/// catalog (`unified_list_models`), since the runtime state's model summary has none.
int piDurableContextWindow(
  List<RuntimeModelSummary> models,
  String? modelLabel,
) {
  if (modelLabel == null || modelLabel.isEmpty) return kDefaultContextWindow;
  for (final model in models) {
    if (model.label == modelLabel || model.id == modelLabel) {
      return model.contextWindow ?? kDefaultContextWindow;
    }
  }
  return kDefaultContextWindow;
}

int _intOf(dynamic value) => value is num ? value.toInt() : 0;

double _doubleOf(dynamic value) => value is num ? value.toDouble() : 0;
