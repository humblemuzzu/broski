String buildCodexApprovalTitle({
  required String method,
  Object? reason,
  Object? grantRoot,
  Object? networkApprovalContext,
  Object? writableRoots,
  Object? scope,
  Object? networkAccess,
}) {
  if (method == 'item/commandExecution/requestApproval') {
    final host =
        (networkApprovalContext is Map ? networkApprovalContext['host'] : null)
            ?.toString()
            .trim();
    if (host != null && host.isNotEmpty) {
      return 'Allow network access to $host?';
    }
    if (reason != null && reason.toString().toLowerCase().contains('network')) {
      return 'Allow network access?';
    }
    return 'Allow command execution?';
  }

  // V2: Network access approval
  if (networkAccess != null && networkAccess is Map) {
    final host = networkAccess['host']?.toString().trim() ?? '';
    if (host.isNotEmpty) return 'Allow network access to $host?';
    return 'Allow network access?';
  }

  // V2: Writable roots — show the specific directory
  if (writableRoots != null &&
      writableRoots is List &&
      writableRoots.isNotEmpty) {
    final roots = writableRoots;
    if (roots.length == 1) {
      final dir = roots.first.toString().split('/').last;
      return 'Allow write access to $dir?';
    }
    return 'Allow write access to ${roots.length} directories?';
  }

  // V2: Scope-based permissions
  if (scope != null) {
    final scopeStr = scope.toString();
    if (scopeStr.contains('filesystem')) return 'Allow filesystem access?';
    if (scopeStr.contains('network')) return 'Allow network access?';
  }

  if (grantRoot != null) {
    return 'Allow write access to ${grantRoot.toString().split('/').last}?';
  }
  return 'Allow file changes?';
}
