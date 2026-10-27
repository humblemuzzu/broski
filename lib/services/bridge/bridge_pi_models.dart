import 'dart:async';

import 'package:broski/models/pi_model_catalogue.dart';
import 'package:broski/services/pi_bridge_service.dart';

/// The Pi model catalogue: what `pi` can run here, the user's own list, and their default model.
extension PiBridgeModels on PiBridgeService {
  /// Every model Pi can run here, plus the user's `enabledModels`. The bridge re-reads Pi's model files first, so a
  /// returned catalogue is never the one the bridge started with.
  Future<PiModelCatalogue> listModelCatalogue({String? projectPath}) async {
    final requestId = generateRequestId();
    sendMessage({
      'type': 'pi_list_models',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await waitForResponse('pi_models', requestId: requestId);
    return PiModelCatalogue.fromJson(response);
  }

  /// Fetches newer model catalogs over the network the way the `pi` CLI's own refresh does, then returns the result.
  Future<PiModelCatalogue> refreshModelCatalogue({String? projectPath}) async {
    final requestId = generateRequestId();
    sendMessage({
      'type': 'pi_refresh_models',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await waitForResponse(
      'pi_models_refreshed',
      requestId: requestId,
    );
    return PiModelCatalogue.fromJson(response);
  }
}
