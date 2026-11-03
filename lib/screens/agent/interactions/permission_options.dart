import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/interactions/answer_button.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:flutter/material.dart';

/// The prompt's own buttons: a one-off allow outlined in the accent colour,
/// an allow for the session outlined in the info colour, an allow that holds
/// until the person says otherwise filled in the accent colour, and a deny
/// outlined in the error colour.
AnswerTone permissionTone(PermissionOption option) =>
    switch ((option.effect, option.scope)) {
      (PermissionEffect.deny, _) => AnswerTone.deny,
      (PermissionEffect.allow, PermissionScope.once) ||
      (PermissionEffect.allow, PermissionScope.turn) => AnswerTone.once,
      (PermissionEffect.allow, PermissionScope.session) => AnswerTone.session,
      (PermissionEffect.allow, PermissionScope.always) => AnswerTone.always,
    };

/// How long the option holds, the rule it writes and whether it ends the run,
/// in the order the prompt listed them.
String permissionDetail(PermissionOption option) => [
  permissionScope(option.scope),
  ?option.rule,
  if (option.stopsRun) 'ends the run',
].join(' · ');

/// The original prompt marked a session and a run with a timer and a deny
/// with a stop; the others say what they do in the label alone.
IconData? permissionIcon(PermissionOption option) =>
    switch ((option.effect, option.scope)) {
      (PermissionEffect.allow, PermissionScope.session) ||
      (PermissionEffect.allow, PermissionScope.turn) => AppIcons.timer,
      (PermissionEffect.deny, _) => AppIcons.block,
      _ => null,
    };

String permissionScope(PermissionScope scope) => switch (scope) {
  PermissionScope.once => 'this time',
  PermissionScope.turn => 'for this run',
  PermissionScope.session => 'for this session',
  PermissionScope.always => 'always',
};
