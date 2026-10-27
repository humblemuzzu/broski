import 'package:broski/app/app_messenger.dart';

/// What a phone that may not browse the local network is told: without it the
/// app can only try the addresses it already remembers.
const lanBrowsePermissionHint =
    'Allow Local Network for Broski in Settings to find your Mac';

void showLanBrowseFailure() => showAppNotice(lanBrowsePermissionHint);
