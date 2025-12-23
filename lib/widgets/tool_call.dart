import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../models/message.dart';
import '../theme/colors.dart';

class ToolCallCard extends StatelessWidget {
  const ToolCallCard({super.key, required this.tool});

  final ToolCall tool;

  @override
  Widget build(BuildContext context) {
    final statusColor = switch (tool.status) {
      'completed' => BroskiColors.mint,
      'error' => BroskiColors.ember,
      'running' => BroskiColors.gold,
      _ => BroskiColors.fog,
    };

    return Container(
      margin: const EdgeInsets.only(top: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: BroskiColors.abyss,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: BroskiColors.slate),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(color: statusColor, shape: BoxShape.circle),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  tool.title ?? tool.name,
                  style: Theme.of(context).textTheme.labelLarge,
                ),
              ),
              Text(tool.status, style: Theme.of(context).textTheme.labelSmall),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            tool.input.isEmpty ? '{}' : tool.input.toString(),
            style: GoogleFonts.jetBrainsMono(fontSize: 12, color: BroskiColors.fog),
          ),
          if (tool.output != null) ...[
            const SizedBox(height: 8),
            Text(
              tool.output!,
              style: GoogleFonts.jetBrainsMono(fontSize: 12, color: BroskiColors.fog),
            ),
          ],
        ],
      ),
    );
  }
}
