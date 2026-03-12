part of '../bridge_service.dart';

/// Claude Code plugin management operations.
/// Extracted from bridge_service.dart — Phase 4B modularization.
extension BridgeServiceCcPlugins on BridgeService {
  /// List all discovered plugins
  Future<List<ClaudeCodePlugin>> ccListPlugins({String? cwd}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_list_plugins',
      if (cwd != null) 'cwd': cwd,
      'requestId': requestId,
    });
    final response = await _waitFor('cc_plugins', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .map((item) => ClaudeCodePlugin.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  /// Get a specific plugin by name
  Future<ClaudeCodePlugin?> ccGetPlugin(String name) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_get_plugin',
      'name': name,
      'requestId': requestId,
    });
    final response = await _waitFor('cc_plugin', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>?;
    if (data == null) return null;
    return ClaudeCodePlugin.fromJson(data);
  }

  /// Toggle a plugin's enabled/disabled state
  Future<bool> ccTogglePlugin(String name, {required bool enabled}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_toggle_plugin',
      'name': name,
      'enabled': enabled,
      'requestId': requestId,
    });
    final response = await _waitFor('cc_plugin_toggled', requestId: requestId);
    return response['data'] as bool? ?? false;
  }

  /// Add a custom plugin path
  Future<bool> ccAddPluginPath(String path) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_add_plugin_path',
      'path': path,
      'requestId': requestId,
    });
    final response = await _waitFor(
      'cc_plugin_path_added',
      requestId: requestId,
    );
    return response['data'] as bool? ?? false;
  }

  /// Remove a custom plugin path
  Future<bool> ccRemovePluginPath(String path) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_remove_plugin_path',
      'path': path,
      'requestId': requestId,
    });
    final response = await _waitFor(
      'cc_plugin_path_removed',
      requestId: requestId,
    );
    return response['data'] as bool? ?? false;
  }

  /// Get plugin configuration (enabled/disabled lists, custom paths)
  Future<ClaudeCodePluginConfig> ccGetPluginConfig() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'cc_get_plugin_config', 'requestId': requestId});
    final response = await _waitFor('cc_plugin_config', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return ClaudeCodePluginConfig.fromJson(data);
  }

  /// Force reload plugins (clear cache and re-discover)
  Future<List<ClaudeCodePlugin>> ccReloadPlugins({String? cwd}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_reload_plugins',
      if (cwd != null) 'cwd': cwd,
      'requestId': requestId,
    });
    final response = await _waitFor(
      'cc_plugins_reloaded',
      requestId: requestId,
    );
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .map((item) => ClaudeCodePlugin.fromJson(item as Map<String, dynamic>))
        .toList();
  }
}
