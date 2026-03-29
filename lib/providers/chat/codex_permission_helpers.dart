import 'package:broski/models/message.dart';

PermissionRequest buildCodexSkillPermissionRequest({
  required String requestId,
  required String sessionId,
  required Map<String, dynamic> params,
}) {
  final skillName =
      (params['skillName'] ?? params['skill_name'])?.toString().trim() ??
      'Unknown skill';

  return PermissionRequest(
    id: requestId,
    sessionId: sessionId,
    title: 'Allow skill "$skillName" to run?',
    command: skillName,
    metadata: {
      'threadId': params['threadId'] ?? params['thread_id'],
      'method': 'skill/requestApproval',
      'skillName': skillName,
      'itemId': (params['itemId'] ?? params['item_id'])?.toString(),
    },
  );
}

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
