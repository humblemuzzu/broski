part of '../bridge_service.dart';

/// Codex plugin marketplace operations.
extension BridgeServiceCodexPlugins on BridgeService {
  // Plugin Marketplace

  /// List plugins from marketplace (plugin/list).
  Future<List<CodexPluginMarketplace>> cxListPlugins({String? cwd}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_plugin_list',
      'requestId': requestId,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor(
      'cx_plugins',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .whereType<Map<String, dynamic>>()
        .map((e) => CodexPluginMarketplace.fromJson(e))
        .toList();
  }

  /// Install a plugin from marketplace (plugin/install).
  Future<bool> cxInstallPlugin({
    required String marketplacePath,
    required String pluginName,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_plugin_install',
      'requestId': requestId,
      'marketplacePath': marketplacePath,
      'pluginName': pluginName,
    });
    await _waitFor(
      'cx_plugin_installed',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    return true;
  }

  /// Uninstall a plugin (plugin/uninstall).
  Future<bool> cxUninstallPlugin({required String pluginId}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_plugin_uninstall',
      'requestId': requestId,
      'pluginId': pluginId,
    });
    await _waitFor(
      'cx_plugin_uninstalled',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    return true;
  }

  /// Read detailed info about a specific plugin (plugin/read).
  Future<Map<String, dynamic>> cxPluginRead({
    required String marketplacePath,
    required String pluginName,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_plugin_read',
      'requestId': requestId,
      'marketplacePath': marketplacePath,
      'pluginName': pluginName,
    });
    final response = await _waitFor(
      'cx_plugin_detail',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    return response['data'] as Map<String, dynamic>? ?? {};
  }
}
