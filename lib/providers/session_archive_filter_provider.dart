import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Whether to show archived sessions in the sessions list.
/// Default: false (hide archived sessions).
final showArchivedSessionsProvider = StateProvider<bool>((ref) => false);
