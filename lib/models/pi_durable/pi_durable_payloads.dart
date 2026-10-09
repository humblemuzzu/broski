import 'package:broski/models/file_attachment.dart';

/// Wire payload builders for the bridge's `pi-durable` backend.
///
/// Kept pure so the request shapes can be asserted without a socket: the
/// bridge contract for `pd_*` messages is the single source of truth here.
const piDurableBackendWire = 'pi-durable';

/// `pd_create_session` — `{cwd, model?, thinkingLevel?, title?, requestId}`.
Map<String, dynamic> buildPiDurableCreateSession({
  required String cwd,
  required String requestId,
  String? provider,
  String? modelId,
  String? thinkingLevel,
  String? title,
}) {
  final hasModel = provider != null && modelId != null;
  return {
    'type': 'pd_create_session',
    'cwd': cwd,
    'requestId': requestId,
    if (hasModel) 'model': {'provider': provider, 'modelId': modelId},
    if (thinkingLevel != null) 'thinkingLevel': thinkingLevel,
    if (title != null && title.isNotEmpty) 'title': title,
  };
}

String piDurableClientMessageId([int? nowMicros]) =>
    'pd-${nowMicros ?? DateTime.now().microsecondsSinceEpoch}';

/// `pd_chat` — `requestId` doubles as the bridge's exactly-once submission key,
/// so callers pass the optimistic message's client id and a resend after a
/// reconnect resolves to the same submission instead of a duplicate.
///
/// [images] are `{data, mimeType}` maps; the bridge accepts png/jpeg/gif/webp.
Map<String, dynamic> buildPiDurableChat({
  required String sessionId,
  required String content,
  required String requestId,
  bool steer = false,
  List<Map<String, dynamic>>? images,
}) {
  return {
    'type': 'pd_chat',
    'sessionId': sessionId,
    'content': content,
    'requestId': requestId,
    if (steer) 'whenBusy': 'steer',
    if (images != null && images.isNotEmpty) 'images': images,
  };
}

/// The image attachments a `pd_chat` can carry, in the bridge's shape. File
/// attachments without bytes stay path references inside the prompt text.
List<Map<String, dynamic>> piDurableImagesFromAttachments(
  List<FileAttachment> attachedFiles,
) {
  final images = <Map<String, dynamic>>[];
  for (final file in attachedFiles) {
    final data = file.base64Data;
    final mimeType = file.mimeType;
    if (data == null || mimeType == null || !file.isImage) continue;
    images.add({'data': data, 'mimeType': mimeType});
  }
  return images;
}

/// The path references a `pd_chat` prompt appends for non-image attachments, and
/// the label that keeps an image-only prompt from sending empty text.
String composePiDurablePrompt(String text, List<FileAttachment> attachedFiles) {
  final paths = <String>[];
  var imageCount = 0;
  for (final file in attachedFiles) {
    if (file.isImage) {
      imageCount++;
    } else {
      paths.add('@${file.path}');
    }
  }
  final label = imageCount == 0
      ? ''
      : '\n[${imageCount == 1 ? 'Image' : '$imageCount images'} attached]';
  final reference = paths.isEmpty
      ? ''
      : '\nReferenced project paths:\n${paths.join('\n')}';
  return '$text$label$reference';
}

/// `pd_compact` — admits a manual compaction of the durable session.
Map<String, dynamic> buildPiDurableCompact({
  required String sessionId,
  required String requestId,
  String? instructions,
}) {
  return {
    'type': 'pd_compact',
    'sessionId': sessionId,
    'requestId': requestId,
    if (instructions != null && instructions.isNotEmpty)
      'instructions': instructions,
  };
}

/// `pd_get_transcript` — newest `limit` entries oldest-first plus a backwards
/// cursor. The bridge resumes interrupted work on the Mac when this arrives,
/// so it is an on-open call, not a poll.
Map<String, dynamic> buildPiDurableGetTranscript({
  required String sessionId,
  required String requestId,
  int? limit,
  Object? cursor,
}) {
  return {
    'type': 'pd_get_transcript',
    'sessionId': sessionId,
    'requestId': requestId,
    if (limit != null) 'limit': limit,
    if (cursor != null) 'cursor': cursor,
  };
}

/// The permission UI answers with `once` / `always` / `reject`; the durable
/// backend understands only `allow` / `deny`.
String? piDurableDecisionForPermissionResponse(String response) {
  return switch (response) {
    'once' || 'always' || 'allow' => 'allow',
    'reject' || 'deny' => 'deny',
    _ => null,
  };
}

/// `pd_permission_response`. Returns null when the response has no decision, so
/// the caller sends nothing rather than an invalid payload. `requestId` is the
/// permission request id (`<sessionId>:<toolCallId>`), which the bridge also
/// echoes on the `pd_permission_resolved` reply.
Map<String, dynamic>? buildPiDurablePermissionResponse({
  required String sessionId,
  required String requestId,
  required String response,
  String? reason,
}) {
  final decision = piDurableDecisionForPermissionResponse(response);
  if (decision == null) return null;
  return {
    'type': 'pd_permission_response',
    'sessionId': sessionId,
    'requestId': requestId,
    'decision': decision,
    if (reason != null && reason.isNotEmpty) 'reason': reason,
  };
}
