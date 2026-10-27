import 'package:broski/models/pi.dart';

/// One entry of the user's own Pi model list (`enabledModels` in `~/.pi/agent/settings.json`), resolved by the
/// bridge the way the `pi` CLI resolves `--models`: `provider/id`, a bare id, a glob, each with an optional
/// `:<thinking level>`.
class PiModelSelection {
  /// The entry as the user saved it, which is all there is to show when nothing matches it.
  final String pattern;

  /// The model's name, or [pattern] when no model the backend can run matches it.
  final String label;

  final String? provider;
  final String? modelId;

  /// The level the entry pinned, or null when it left the choice to the session.
  final PiThinkingLevel? thinkingLevel;

  /// False when no model Pi can run here matches the entry: a missing credential, or a stale entry.
  final bool available;

  const PiModelSelection({
    required this.pattern,
    required this.label,
    this.provider,
    this.modelId,
    this.thinkingLevel,
    this.available = false,
  });

  factory PiModelSelection.fromJson(Map<String, dynamic> json) {
    final level = json['thinkingLevel'] as String?;
    return PiModelSelection(
      pattern: json['pattern'] as String? ?? '',
      label: json['label'] as String? ?? '',
      provider: json['provider'] as String?,
      modelId: json['modelId'] as String?,
      thinkingLevel: level == null
          ? null
          : PiThinkingLevel.fromWireValue(level),
      available: json['available'] as bool? ?? false,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'pattern': pattern,
      'label': label,
      'provider': provider,
      'modelId': modelId,
      'thinkingLevel': thinkingLevel?.wireValue,
      'available': available,
    };
  }

  /// `provider/id`, or the pattern itself when nothing resolved it.
  String get modelRef =>
      provider == null || modelId == null ? pattern : '$provider/$modelId';
}

/// The model a new Pi session starts with, and the thinking level it starts at.
class PiDefaultModel {
  final String provider;
  final String modelId;
  final PiThinkingLevel thinkingLevel;

  const PiDefaultModel({
    required this.provider,
    required this.modelId,
    required this.thinkingLevel,
  });

  factory PiDefaultModel.fromJson(Map<String, dynamic> json) {
    return PiDefaultModel(
      provider: json['provider'] as String? ?? '',
      modelId: json['modelId'] as String? ?? '',
      thinkingLevel: PiThinkingLevel.fromWireValue(
        json['thinkingLevel'] as String? ?? 'medium',
      ),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'provider': provider,
      'modelId': modelId,
      'thinkingLevel': thinkingLevel.wireValue,
    };
  }

  String get modelRef => '$provider/$modelId';
}

/// Everything `pi_models` / `pi_models_refreshed` carry: the models Pi can run here, the user's own list, and
/// their default.
class PiModelCatalogue {
  /// Every model Pi offers here, exactly as `pi --list-models` prints it.
  final List<PiModel> models;

  /// `enabledModels` in the user's order; an entry nothing matches is one muted row carrying its pattern.
  final List<PiModelSelection> selected;

  final PiDefaultModel? defaultModel;

  const PiModelCatalogue({
    this.models = const [],
    this.selected = const [],
    this.defaultModel,
  });

  static const PiModelCatalogue empty = PiModelCatalogue();

  factory PiModelCatalogue.fromJson(Map<String, dynamic> json) {
    final rawModels = json['data'];
    final rawSelected = json['selected'];
    final rawDefault = json['defaultModel'];
    return PiModelCatalogue(
      models: rawModels is List
          ? rawModels
                .whereType<Map<String, dynamic>>()
                .map(PiModel.fromJson)
                .toList()
          : const [],
      selected: rawSelected is List
          ? rawSelected
                .whereType<Map<String, dynamic>>()
                .map(PiModelSelection.fromJson)
                .toList()
          : const [],
      defaultModel: rawDefault is Map<String, dynamic>
          ? PiDefaultModel.fromJson(rawDefault)
          : null,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'data': models.map((model) => model.toJson()).toList(),
      'selected': selected.map((entry) => entry.toJson()).toList(),
      'defaultModel': defaultModel?.toJson(),
    };
  }

  List<PiModel> get availableSelected {
    final byRef = {for (final model in models) model.modelRef: model};
    return selected
        .where((entry) => entry.available)
        .map((entry) => byRef[entry.modelRef])
        .whereType<PiModel>()
        .toList();
  }

  bool isSelected(String provider, String modelId) => selected.any(
    (entry) => entry.provider == provider && entry.modelId == modelId,
  );

  /// The models Pi can run here that the user has not picked, grouped by provider in catalogue order.
  Map<String, List<PiModel>> get unselectedByProvider {
    final grouped = <String, List<PiModel>>{};
    for (final model in models) {
      if (isSelected(model.provider, model.id)) continue;
      grouped.putIfAbsent(model.provider, () => []).add(model);
    }
    return grouped;
  }
}
