import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';

/// Network connectivity states for the app
enum NetworkState {
  /// Connected via WiFi
  wifi,

  /// Connected via mobile data
  mobile,

  /// Connected via ethernet
  ethernet,

  /// Connected through a VPN
  vpn,

  /// No network connection
  none,

  /// Unknown connectivity state
  unknown,
}

/// Service to monitor network connectivity changes.
/// Useful for triggering reconnection when network comes back online.
class NetworkMonitorService {
  final Connectivity _connectivity = Connectivity();

  StreamSubscription<List<ConnectivityResult>>? _subscription;
  final _stateController = StreamController<NetworkState>.broadcast();

  NetworkState _currentState = NetworkState.unknown;

  /// Stream of network state changes
  Stream<NetworkState> get stateStream => _stateController.stream;

  /// Current network state
  NetworkState get currentState => _currentState;

  /// Whether we have any network connectivity
  bool get isConnected =>
      _currentState != NetworkState.none &&
      _currentState != NetworkState.unknown;

  /// Whether we're likely on a local network (WiFi or Ethernet)
  bool get isLocalNetwork =>
      _currentState == NetworkState.wifi ||
      _currentState == NetworkState.ethernet;

  /// Whether we're on mobile data (higher latency expected)
  bool get isMobileNetwork => _currentState == NetworkState.mobile;

  /// Start monitoring network changes
  Future<void> startMonitoring() async {
    // Get initial state
    final results = await _connectivity.checkConnectivity();
    _updateState(results);

    // Listen for changes
    _subscription = _connectivity.onConnectivityChanged.listen(_updateState);
  }

  /// Stop monitoring network changes
  void stopMonitoring() {
    _subscription?.cancel();
    _subscription = null;
  }

  /// Check current connectivity (one-shot)
  Future<NetworkState> checkConnectivity() async {
    final results = await _connectivity.checkConnectivity();
    return _resultsToState(results);
  }

  void _updateState(List<ConnectivityResult> results) {
    final newState = _resultsToState(results);
    if (newState != _currentState) {
      _currentState = newState;
      _stateController.add(newState);
    }
  }

  NetworkState _resultsToState(List<ConnectivityResult> results) {
    if (results.isEmpty || results.contains(ConnectivityResult.none)) {
      return NetworkState.none;
    }

    // VPN takes priority as it affects routing
    if (results.contains(ConnectivityResult.vpn)) {
      return NetworkState.vpn;
    }

    // WiFi is preferred for local connections
    if (results.contains(ConnectivityResult.wifi)) {
      return NetworkState.wifi;
    }

    // Ethernet is also local
    if (results.contains(ConnectivityResult.ethernet)) {
      return NetworkState.ethernet;
    }

    // Mobile data
    if (results.contains(ConnectivityResult.mobile)) {
      return NetworkState.mobile;
    }

    return NetworkState.unknown;
  }

  void dispose() {
    stopMonitoring();
    _stateController.close();
  }
}
