import '../../models/message.dart';

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

  if (grantRoot != null) {
    return 'Allow write access to ${grantRoot.toString().split('/').last}?';
  }
  return 'Allow file changes?';
}
