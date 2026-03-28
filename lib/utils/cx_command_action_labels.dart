import 'package:broski/theme/app_icons.dart';
import 'package:flutter/widgets.dart';

/// Maps Codex SDK `commandActions[0].type` to a human-readable label and icon.
///
/// SDK sends semantic labels on `commandExecution` items:
/// - `read` → "Read File"
/// - `listFiles` → "List Files"
/// - `search` → "Search Files"
/// - `unknown` → "Bash" (default)
class CxCommandActionLabel {
  const CxCommandActionLabel({required this.label, required this.icon});

  final String label;
  final IconData icon;

  static CxCommandActionLabel fromActions(List<dynamic>? actions) {
    if (actions == null || actions.isEmpty) return _default;
    final first = actions.first;
    if (first is! Map) return _default;
    final type = first['type']?.toString() ?? '';
    return _map[type] ?? _default;
  }

  static CxCommandActionLabel fromType(String? type) {
    if (type == null || type.isEmpty) return _default;
    return _map[type] ?? _default;
  }

  static const _default = CxCommandActionLabel(
    label: 'Bash',
    icon: AppIcons.terminal,
  );

  static final Map<String, CxCommandActionLabel> _map = {
    'read': const CxCommandActionLabel(
      label: 'Read File',
      icon: AppIcons.fileText,
    ),
    'listFiles': const CxCommandActionLabel(
      label: 'List Files',
      icon: AppIcons.folder,
    ),
    'search': const CxCommandActionLabel(
      label: 'Search Files',
      icon: AppIcons.search,
    ),
    'unknown': _default,
  };
}
