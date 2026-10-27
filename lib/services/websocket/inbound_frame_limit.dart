/// The largest inbound bridge frame the phone accepts.
///
/// The daemon drops anything over 8 MiB (`LINK_MAX_MESSAGE_BYTES`) before it
/// reaches the phone, and the phone's own outbound queue is bounded by the same
/// number, so a bigger frame did not come from a bridge this app can talk to.
const int linkMaxInboundFrameBytes = 8 * 1024 * 1024;

/// What an over-limit frame is reported as: the app lost a frame, and saying so
/// is better than a screen that quietly stops updating.
String oversizedInboundFrameMessage(int bytes) =>
    'Dropped an inbound frame of $bytes bytes · the limit is $linkMaxInboundFrameBytes';
