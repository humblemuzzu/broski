part of '../bridge_service.dart';

/// Claude Code custom tools operations.
/// Extracted from bridge_service.dart — Phase 4B modularization.
extension BridgeServiceCcCustomTools on BridgeService {
  /// List all custom tools
  Future<List<ClaudeCodeCustomTool>> ccListCustomTools() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'cc_list_custom_tools', 'requestId': requestId});
    final response = await _waitFor('cc_custom_tools', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .map(
          (item) => ClaudeCodeCustomTool.fromJson(item as Map<String, dynamic>),
        )
        .toList();
  }

  /// Get a single custom tool by ID
  Future<ClaudeCodeCustomTool?> ccGetCustomTool(String id) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_get_custom_tool',
      'id': id,
      'requestId': requestId,
    });
    final response = await _waitFor('cc_custom_tool', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>?;
    if (data == null) return null;
    return ClaudeCodeCustomTool.fromJson(data);
  }

  /// Save (create or update) a custom tool
  Future<ClaudeCodeCustomTool?> ccSaveCustomTool(
    ClaudeCodeCustomTool tool,
  ) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_save_custom_tool',
      'tool': tool.toJson(),
      'requestId': requestId,
    });
    final response = await _waitFor(
      'cc_custom_tool_saved',
      requestId: requestId,
    );
    final data = response['data'] as Map<String, dynamic>?;
    if (data == null) return null;
    return ClaudeCodeCustomTool.fromJson(data);
  }

  /// Delete a custom tool by ID
  Future<bool> ccDeleteCustomTool(String id) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_delete_custom_tool',
      'id': id,
      'requestId': requestId,
    });
    final response = await _waitFor(
      'cc_custom_tool_deleted',
      requestId: requestId,
    );
    return response['data'] as bool? ?? false;
  }

  /// Test a custom tool with sample arguments
  Future<CustomToolTestResult> ccTestCustomTool(
    ClaudeCodeCustomTool tool,
    Map<String, dynamic> testArgs,
  ) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_test_custom_tool',
      'tool': tool.toJson(),
      'testArgs': testArgs,
      'requestId': requestId,
    });
    final response = await _waitFor(
      'cc_custom_tool_test_result',
      requestId: requestId,
    );
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return CustomToolTestResult.fromJson(data);
  }
}
