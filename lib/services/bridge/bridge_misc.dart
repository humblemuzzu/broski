part of '../bridge_service.dart';

/// Devices, agent status and subscription usage.
extension BridgeServiceMisc on BridgeService {
  void registerDevice({
    required String deviceId,
    required String deviceName,
    required String platform,
  }) {
    _socket.send({
      'type': 'register_device',
      'deviceId': deviceId,
      'deviceName': deviceName,
      'platform': platform,
      'protocolVersion': BridgeService.protocolVersion,
    });
  }

  Future<List<DeviceInfo>> listDevices() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'list_devices', 'requestId': requestId});
    final response = await _waitFor('devices', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .map((item) => DeviceInfo.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  void disconnectDevice(String deviceId) {
    _socket.send({'type': 'disconnect_device', 'deviceId': deviceId});
  }

  Future<AgentsStatus> getAgentsStatus() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'get_agents_status', 'requestId': requestId});
    final response = await _waitFor('agents_status', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return AgentsStatus.fromJson(data);
  }

  void setAgent(AgentType agentType) {
    _socket.send({'type': 'set_agent', 'agent': agentType.wireValue});
  }

  Future<SubscriptionUsage> getSubscriptionUsage() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'get_subscription_usage', 'requestId': requestId});
    final response = await _waitFor('subscription_usage', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return SubscriptionUsage.fromJson(data);
  }

  Future<ProviderUsage> getProviderUsage(String providerId) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'get_provider_usage',
      'providerId': providerId,
      'requestId': requestId,
    });
    final response = await _waitFor('provider_usage', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return ProviderUsage.fromJson(data);
  }
}
