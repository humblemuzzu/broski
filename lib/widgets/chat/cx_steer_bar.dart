
import 'package:flutter/material.dart';
import '../../theme/design_tokens.dart';
import 'package:broski/theme/app_icons.dart';
/// A secondary input bar shown above the main prompt when the Codex agent is
/// actively working. Lets the user "steer" (nudge) the agent mid-turn without
/// aborting.
class CxSteerBar extends StatefulWidget {
  const CxSteerBar({
    super.key,
    required this.onSteer,
    required this.primaryColor,
    required this.textColor,
    required this.mutedColor,
    required this.surfaceColor,
  });
  /// Called with the steer prompt text when the user taps Send.
  final ValueChanged<String> onSteer;
  final Color primaryColor;
  final Color textColor;
  final Color mutedColor;
  final Color surfaceColor;
  @override
  State<CxSteerBar> createState() => _CxSteerBarState();
}
class _CxSteerBarState extends State<CxSteerBar> {
  final _controller = TextEditingController();
  final _focusNode = FocusNode();
  void _submit() {
    final text = _controller.text.trim();
    if (text.isEmpty) return;
    widget.onSteer(text);
    _controller.clear();
    _focusNode.requestFocus();
  }
  @override
  void dispose() {
    _controller.dispose();
    _focusNode.dispose();
    super.dispose();
  }
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: widget.surfaceColor,
        border: Border(
          top: BorderSide(
            color: widget.primaryColor.withValues(alpha: 0.3),
            width: 1,
          ),
        ),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Status label
          Row(
            children: [
              Icon(AppIcons.bolt, size: 14, color: widget.primaryColor),
              SizedBox(width: Spacing.xs),
              Text(
                'Agent is working — steer or abort',
                style: TextStyle(
                  color: widget.mutedColor,
                  fontSize: 11,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          // Input row
          Row(
            children: [
              Expanded(
                child: SizedBox(
                  height: 36,
                  child: TextField(
                    controller: _controller,
                    focusNode: _focusNode,
                    style: TextStyle(color: widget.textColor, fontSize: 13),
                    decoration: InputDecoration(
                      hintText: 'Steer agent...',
                      hintStyle: TextStyle(
                        color: widget.mutedColor,
                        fontSize: 13,
                      ),
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 8,
                      ),
                      filled: true,
                      fillColor: widget.surfaceColor,
                      border: OutlineInputBorder(
                        borderRadius: Radii.brSm,
                        borderSide: BorderSide(
                          color: widget.primaryColor.withValues(alpha: 0.3),
                        ),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: Radii.brSm,
                        borderSide: BorderSide(
                          color: widget.primaryColor.withValues(alpha: 0.3),
                        ),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: Radii.brSm,
                        borderSide: BorderSide(
                          color: widget.primaryColor,
                        ),
                      ),
                      isDense: true,
                    ),
                    onSubmitted: (_) => _submit(),
                  ),
                ),
              ),
              SizedBox(width: Spacing.sm),
              SizedBox(
                height: 36,
                width: 36,
                child: IconButton(
                  onPressed: _submit,
                  icon: Icon(
                    AppIcons.send,
                    size: 18,
                    color: widget.primaryColor,
                  ),
                  padding: EdgeInsets.zero,
                  tooltip: 'Send steer',
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
