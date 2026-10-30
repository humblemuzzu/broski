import 'dart_tokens.dart';

/// Layers `lib/agent/**` may import whole: the platform, the packages it
/// uses, the generated contract, itself and the theme.
const _openLayers = [
  'dart:',
  'package:flutter/',
  'package:flutter_riverpod/',
  'package:uuid/',
  'package:image_picker/',
  'package:mime/',
  'package:url_launcher/',
  'package:broski/agent/',
  'package:broski/theme/',
];

const _contract = 'package:broski/contract/generated/contract.dart';

/// App files outside those layers the core reuses, each imported with a
/// `show` naming only what is listed: a file of the old app may re-export the
/// old services (`service_providers.dart` exports `BridgeService`), and
/// `show` keeps them out.
const namedImports = <String, Set<String>>{
  'package:broski_link/broski_link.dart': {'LinkSendFailure'},
  'package:broski/widgets/chat/detail_sheet.dart': {'DetailSheet'},
  'package:broski/widgets/chat/adaptive_markdown_body.dart': {
    'AdaptiveMarkdownBody',
  },
  'package:broski/widgets/diff_viewer.dart': {'DiffViewer'},
  'package:broski/models/message.dart': {'DiffEntry'},
  'package:broski/services/websocket_service.dart': {
    'WebSocketService',
    'ConnectionStatus',
  },
  'package:broski/providers/service_providers.dart': {
    'webSocketServiceProvider',
  },
  'package:broski/services/storage/broski_secure_storage.dart': {
    'broskiSecureStorage',
  },
  'package:broski/providers/app_info_provider.dart': {'appVersionProvider'},
  'package:broski/providers/connection/link_connection_controller.dart': {
    'linkConnectionControllerProvider',
  },
};

/// What is wrong with the directive (`import`, `export`, `part`) whose
/// keyword is at [start]: each URI it names, conditional ones included, and
/// the names it shows. Empty when nothing is.
List<String> directiveProblems(List<DartToken> tokens, int start) {
  final directive = <DartToken>[];
  for (var index = start + 1; index < tokens.length; index++) {
    final token = tokens[index];
    if (token is PunctToken && token.char == ';') break;
    directive.add(token);
  }
  final shown = _shownNames(directive);
  return [
    for (final uri in _directiveUris(tokens, start)) ?_uriProblem(uri, shown),
  ];
}

/// The app files the core imports whole (`package:broski/theme/`) must not
/// open a way around the rules: everything they export is in an open layer
/// too, or beside them. Each problem reads `path:line: what`.
List<String> openLayerExportProblems(String path, String source) {
  final tokens = dartTokens(source);
  return [
    for (final (index, token) in tokens.indexed)
      if (token is WordToken && token.word == 'export')
        for (final uri in _directiveUris(tokens, index))
          if (!_exportsWithinLayers(uri)) '$path:${token.line}: exports $uri',
  ];
}

Iterable<String?> _directiveUris(List<DartToken> tokens, int start) sync* {
  for (final token in tokens.skip(start + 1)) {
    if (token is PunctToken && token.char == ';') return;
    if (token is StringToken) yield token.value;
  }
}

bool _exportsWithinLayers(String? uri) =>
    uri != null &&
    _isPlain(uri) &&
    (!uri.contains(':') || uri == _contract || _openLayers.any(uri.startsWith));

String? _uriProblem(String? uri, Set<String>? shown) {
  if (uri == null) return 'imports a computed path';
  if (!_isPlain(uri)) return 'imports $uri, which is not a plain path';
  if (uri == _contract || _openLayers.any(uri.startsWith)) return null;
  final allowed = namedImports[uri];
  if (allowed == null) return 'imports $uri';
  if (shown == null) return 'imports $uri without `show`';
  final extra = shown.difference(allowed);
  return extra.isEmpty ? null : 'imports ${extra.join(', ')} from $uri';
}

/// No `.` or `..` segment, no escape: the path is the file it names.
bool _isPlain(String uri) =>
    !uri.contains('%') &&
    !uri.contains(r'\') &&
    !uri.split('/').any((segment) => segment == '.' || segment == '..');

/// The names after `show`, or null when the directive shows nothing; a
/// `hide` shows everything else, so it counts as no `show`.
Set<String>? _shownNames(List<DartToken> directive) {
  Set<String>? shown;
  var collecting = false;
  for (final token in directive) {
    switch (token) {
      case WordToken(word: 'show'):
        shown ??= {};
        collecting = true;
      case WordToken(word: 'hide'):
        return null;
      case WordToken(word: 'as' || 'if' || 'deferred'):
        collecting = false;
      case WordToken(:final word) when collecting:
        shown?.add(word);
      default:
        break;
    }
  }
  return shown;
}
