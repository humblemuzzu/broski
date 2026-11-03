import 'package:flutter/widgets.dart';

/// Keys a screen gives the input bar's controls, so its tests can find them.
class InputBarKeys {
  const InputBarKeys({
    this.text,
    this.send,
    this.model,
    this.attach,
    this.menu,
  });

  final Key? text;
  final Key? send;
  final Key? model;
  final Key? attach;
  final Key? menu;
}
