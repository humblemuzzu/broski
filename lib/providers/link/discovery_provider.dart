import 'package:broski/services/link/discovery/bonsoir_link_service_browser.dart';
import 'package:broski/services/link/discovery/discovered_link.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The LAN browser a link uses when the routes its machine record holds do not
/// answer. Overridable so a test can hand the controller a fake one.
final linkServiceBrowserProvider = Provider<LinkServiceBrowser>(
  (ref) => BonsoirLinkServiceBrowser(),
);
