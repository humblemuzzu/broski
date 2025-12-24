import 'package:flutter/material.dart';

import '../models/message.dart';
import '../theme/colors.dart';

class PermissionPrompt extends StatelessWidget {
  const PermissionPrompt({
    super.key,
    required this.request,
    required this.onApprove,
    required this.onDeny,
  });

  final PermissionRequest request;
  final VoidCallback onApprove;
  final VoidCallback onDeny;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: const BoxDecoration(
        color: BroskiColors.abyss,
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Permission required',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          Text(request.title, style: Theme.of(context).textTheme.bodyMedium),
          if (request.command != null) ...[
            const SizedBox(height: 12),
            Text(
              request.command!,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: onDeny,
                  style: OutlinedButton.styleFrom(
                    foregroundColor: BroskiColors.ember,
                  ),
                  child: const Text('Deny'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: ElevatedButton(
                  onPressed: onApprove,
                  child: const Text('Approve'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
