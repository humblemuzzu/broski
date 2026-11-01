import 'dart:convert';

import 'package:broski/contract/generated/contract.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/services/storage_service.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The title filters of a contract backend's session list, kept per backend
/// across restarts: a session whose title matches one is not shown. Plain text
/// matches anywhere in the title, whatever the case; `/pattern/` is a regular
/// expression, as on the old Claude Code sessions tab.
final contractTitleFiltersProvider =
    StateNotifierProvider.family<ContractTitleFilters, List<String>, BackendId>(
      (ref, backend) =>
          ContractTitleFilters(ref.watch(storageServiceProvider), backend),
    );

/// The key the filters of [backend] are stored under, apart from the old
/// Claude Code tab's, whose agent shares the new one's name.
String contractTitleFiltersKey(BackendId backend) =>
    'contract_session_title_filters:${backend.wire}';

class ContractTitleFilters extends StateNotifier<List<String>> {
  ContractTitleFilters(this._storage, this._backend) : super(const []) {
    _load();
  }

  final StorageService _storage;
  final BackendId _backend;
  var _changed = false;

  Future<void> _load() async {
    final raw = await _storage.getString(contractTitleFiltersKey(_backend));
    if (raw == null || _changed || !mounted) return;
    state = _decode(raw);
  }

  Future<void> add(String filter) async {
    final text = filter.trim();
    if (text.isEmpty || state.contains(text)) return;
    await _save([...state, text]);
  }

  Future<void> remove(String filter) => _save([
    for (final kept in state)
      if (kept != filter) kept,
  ]);

  Future<void> clear() => _save(const []);

  Future<void> _save(List<String> filters) async {
    _changed = true;
    state = filters;
    await _storage.setString(
      contractTitleFiltersKey(_backend),
      jsonEncode(filters),
    );
  }

  static List<String> _decode(String raw) {
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! List) return const [];
      return [
        for (final item in decoded)
          if (item is String && item.trim().isNotEmpty) item.trim(),
      ];
    } on FormatException {
      return const [];
    }
  }
}
