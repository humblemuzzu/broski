import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Optional JSON schema to constrain Codex output format.
/// Set via settings, passed to turn/start.
final cxOutputSchemaProvider = StateProvider<String?>((ref) => null);
