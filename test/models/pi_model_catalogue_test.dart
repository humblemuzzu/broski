import 'package:broski/models/pi.dart';
import 'package:broski/models/pi_model_catalogue.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> _model(String provider, String id) => <String, dynamic>{
  'id': id,
  'name': '$provider $id',
  'provider': provider,
  'api': 'anthropic-messages',
  'contextWindow': 1000000,
  'maxTokens': 64000,
  'reasoning': true,
  'input': <String>['text', 'image'],
  'cost': <String, dynamic>{
    'input': 3,
    'output': 15,
    'cacheRead': 0.3,
    'cacheWrite': 3.75,
  },
  'authenticated': true,
  'isOAuth': false,
};

Map<String, dynamic> _reply() => <String, dynamic>{
  'type': 'pi_models',
  'data': <Map<String, dynamic>>[
    _model('anthropic', 'claude-opus-5-5'),
    _model('anthropic', 'claude-sonnet-5-5'),
    _model('deepseek', 'deepseek-flash'),
  ],
  'selected': <Map<String, dynamic>>[
    <String, dynamic>{
      'pattern': 'anthropic/claude-opus-5-5',
      'label': 'anthropic claude-opus-5-5',
      'provider': 'anthropic',
      'modelId': 'claude-opus-5-5',
      'thinkingLevel': 'high',
      'available': true,
    },
    <String, dynamic>{
      'pattern': 'deepseek/*',
      'label': 'deepseek deepseek-flash',
      'provider': 'deepseek',
      'modelId': 'deepseek-flash',
      'thinkingLevel': null,
      'available': true,
    },
    <String, dynamic>{
      'pattern': 'river/deepseek-ai/DeepSeek-V4.1-Flash',
      'label': 'DeepSeek V4.1 Flash — River',
      'name': 'DeepSeek V4.1 Flash — River',
      'provider': 'river',
      'modelId': 'deepseek-ai/DeepSeek-V4.1-Flash',
      'thinkingLevel': null,
      'available': false,
      'unavailableReason':
          'No API key — set RIVER_API_KEY, or sign in with `pi`',
    },
    <String, dynamic>{
      'pattern': 'gone/provider/model',
      'label': 'gone/provider/model',
      'name': null,
      'provider': null,
      'modelId': null,
      'thinkingLevel': null,
      'available': false,
      'unavailableReason': "Not in Pi's catalogue",
    },
  ],
  'hidden': <String, dynamic>{
    'count': 3,
    'providers': <String>['deepseek', 'river'],
  },
  'defaultModel': <String, dynamic>{
    'provider': 'anthropic',
    'modelId': 'claude-opus-5-5',
    'thinkingLevel': 'high',
  },
};

void main() {
  group('PiModelCatalogue.fromJson', () {
    test('reads the catalogue, the user list in order and the default', () {
      final catalogue = PiModelCatalogue.fromJson(_reply());

      expect(catalogue.models.map((model) => model.modelRef), [
        'anthropic/claude-opus-5-5',
        'anthropic/claude-sonnet-5-5',
        'deepseek/deepseek-flash',
      ]);
      expect(catalogue.selected.map((entry) => entry.pattern), [
        'anthropic/claude-opus-5-5',
        'deepseek/*',
        'river/deepseek-ai/DeepSeek-V4.1-Flash',
        'gone/provider/model',
      ]);
      expect(catalogue.selected.first.thinkingLevel, PiThinkingLevel.high);
      expect(catalogue.selected[1].thinkingLevel, isNull);
      expect(catalogue.selected.last.available, isFalse);
      expect(catalogue.selected.last.provider, isNull);
      expect(catalogue.selected.last.name, isNull);
      expect(catalogue.selected.last.displayName, 'gone/provider/model');
      expect(
        catalogue.selected.last.unavailableReason,
        "Not in Pi's catalogue",
      );
      expect(catalogue.defaultModel?.modelRef, 'anthropic/claude-opus-5-5');
      expect(catalogue.defaultModel?.thinkingLevel, PiThinkingLevel.high);
    });

    test(
      'splits the catalogue into what the user picked and the rest, by provider',
      () {
        final catalogue = PiModelCatalogue.fromJson(_reply());

        expect(catalogue.isSelected('anthropic', 'claude-opus-5-5'), isTrue);
        expect(catalogue.isSelected('anthropic', 'claude-sonnet-5-5'), isFalse);
        expect(catalogue.unselectedByProvider.keys, ['anthropic']);
        expect(
          catalogue.unselectedByProvider['anthropic']?.map((model) => model.id),
          ['claude-sonnet-5-5'],
        );
      },
    );

    test(
      'a reply from an older bridge is an empty catalogue, not an error',
      () {
        final catalogue = PiModelCatalogue.fromJson(<String, dynamic>{
          'type': 'pi_models',
        });

        expect(catalogue.models, isEmpty);
        expect(catalogue.selected, isEmpty);
        expect(catalogue.defaultModel, isNull);
        expect(catalogue.hidden.isEmpty, isTrue);
      },
    );

    test('reads the models hidden behind providers nobody signed in for', () {
      final catalogue = PiModelCatalogue.fromJson(_reply());

      expect(catalogue.hidden.count, 3);
      expect(catalogue.hidden.providers, ['deepseek', 'river']);
      expect(catalogue.hidden.isEmpty, isFalse);
    });

    test('a muted row keeps its real name and says why it cannot run', () {
      final catalogue = PiModelCatalogue.fromJson(_reply());
      final river = catalogue.selected[2];

      expect(river.displayName, 'DeepSeek V4.1 Flash — River');
      expect(river.modelRef, 'river/deepseek-ai/DeepSeek-V4.1-Flash');
      expect(
        river.unavailableReason,
        'No API key — set RIVER_API_KEY, or sign in with `pi`',
      );
    });

    test('round-trips through toJson', () {
      final catalogue = PiModelCatalogue.fromJson(_reply());
      final again = PiModelCatalogue.fromJson(catalogue.toJson());

      expect(again.models.length, catalogue.models.length);
      expect(again.selected.length, catalogue.selected.length);
      expect(again.selected[2].available, isFalse);
      expect(again.defaultModel?.modelId, 'claude-opus-5-5');
    });
  });
}
