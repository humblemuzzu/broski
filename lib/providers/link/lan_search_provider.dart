import 'package:broski/services/link/discovery/lan_search.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The clock a browse runs on, overridable so a test can run one without waiting.
final lanSearchTimingProvider = Provider<LanSearchTiming>((ref) => LanClock());

/// What the LAN browse knows, for the status copy the app shows while the link
/// is down.
final lanSearchProvider =
    StateNotifierProvider<LanSearchReporter, LanSearchState>(
      (ref) => LanSearchReporter(),
    );

class LanSearchReporter extends StateNotifier<LanSearchState> {
  LanSearchReporter() : super(LanSearchState.quiet);

  void publish(LanSearchState state) => this.state = state;
}
