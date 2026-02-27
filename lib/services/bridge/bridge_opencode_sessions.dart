part of '../bridge_service.dart';

Future<List<SessionSummary>> _bridgeListSessions(
  BridgeService service, {
  String? projectPath,
  bool? roots,
  int? start,
  int? cursor,
  String? search,
  int? limit,
  bool? archived,
}) async {
  final dedupeKey =
      'list_sessions:${projectPath ?? 'all'}:${roots ?? 'null'}:${start ?? 'null'}:${cursor ?? 'null'}:${search ?? ''}:${limit ?? 'null'}:${archived ?? 'null'}';

  if (service._inFlightRequests.containsKey(dedupeKey)) {
    return await service._inFlightRequests[dedupeKey] as List<SessionSummary>;
  }

  final future = service._listSessionsInternal(
    projectPath: projectPath,
    roots: roots,
    start: start,
    cursor: cursor,
    search: search,
    limit: limit,
    archived: archived,
  );
  service._inFlightRequests[dedupeKey] = future;

  try {
    return await future;
  } finally {
    service._inFlightRequests.remove(dedupeKey);
  }
}

Future<List<SessionSummary>> _bridgeListSessionsInternal(
  BridgeService service, {
  String? projectPath,
  bool? roots,
  int? start,
  int? cursor,
  String? search,
  int? limit,
  bool? archived,
}) async {
  return service._timedRequest('list_sessions', () async {
    final requestId = service._generateRequestId();
    service._socket.send({
      'type': 'list_sessions',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
      if (roots != null) 'roots': roots,
      if (start != null) 'start': start,
      if (cursor != null) 'cursor': cursor,
      if (search != null && search.isNotEmpty) 'search': search,
      if (limit != null) 'limit': limit,
      if (archived != null) 'archived': archived,
    });
    final response = await service._waitFor('sessions', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .map((item) => SessionSummary.fromJson(item as Map<String, dynamic>))
        .toList();
  });
}
