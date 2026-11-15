//! What an inbox row can offer about the ask a session waits on: for a tool permission, the one
//! option that allows just this call and the one that denies it without stopping the run, exactly as
//! the backend offered them, when a single tap may choose them. Anything else opens the chat.

use broski_contract::{
    Interaction, InteractionId, InteractionKind, InteractionRequest, MessagePolicy,
    PermissionEffect, PermissionOption, PermissionPreview, PermissionScope, ToolPermissionRequest,
};

#[derive(Debug, Clone, PartialEq)]
pub struct PendingAsk {
    pub interaction_id: InteractionId,
    pub kind: InteractionKind,
    /// The backend's option allowing this one call, when a tap may choose it.
    pub allow: Option<PermissionOption>,
    /// The backend's option denying the call and letting the run go on, when a tap may choose it.
    pub deny: Option<PermissionOption>,
}

/// `answerable`: the session takes answers here (`SessionCapabilities.answer`).
pub(crate) fn pending_ask(interaction: &Interaction, answerable: bool) -> PendingAsk {
    let mut pending = PendingAsk {
        interaction_id: interaction.id.clone(),
        kind: kind(&interaction.request),
        allow: None,
        deny: None,
    };
    if let InteractionRequest::ToolPermission(request) = &interaction.request {
        if answerable && !request.deliberate {
            pending.allow = allow_once(request).cloned();
            pending.deny = deny(request).cloned();
        }
    }
    pending
}

/// A tool permission's command, exactly as the agent would run it.
pub(crate) fn ask_command(interaction: &Interaction) -> Option<String> {
    let InteractionRequest::ToolPermission(request) = &interaction.request else {
        return None;
    };
    request.previews.iter().find_map(|preview| match preview {
        PermissionPreview::Command(command) => Some(command.command.clone()),
        _ => None,
    })
}

/// Allowing needs no words and, when the request asks for grants, a choice of them, which a tap
/// cannot make.
fn allow_once(request: &ToolPermissionRequest) -> Option<&PermissionOption> {
    if !request.grants.is_empty() {
        return None;
    }
    request.options.iter().find(|option| {
        option.effect == PermissionEffect::Allow
            && option.scope == PermissionScope::Once
            && option.message != MessagePolicy::Required
    })
}

fn deny(request: &ToolPermissionRequest) -> Option<&PermissionOption> {
    request.options.iter().find(|option| {
        option.effect == PermissionEffect::Deny
            && !option.stops_run
            && option.message != MessagePolicy::Required
    })
}

fn kind(request: &InteractionRequest) -> InteractionKind {
    match request {
        InteractionRequest::ToolPermission(_) => InteractionKind::ToolPermission,
        InteractionRequest::Questions(_) => InteractionKind::Questions,
        InteractionRequest::Form(_) => InteractionKind::Form,
        InteractionRequest::PlanApproval(_) => InteractionKind::PlanApproval,
        InteractionRequest::Choice(_) => InteractionKind::Choice,
        InteractionRequest::Confirm(_) => InteractionKind::Confirm,
        InteractionRequest::Text(_) => InteractionKind::Text,
    }
}

#[cfg(test)]
mod tests {
    use broski_contract::{
        CommandPreview, ConfirmRequest, GrantKind, PermissionGrant, ToolPermissionRequest,
    };

    use super::*;

    fn option(id: &str, effect: PermissionEffect, scope: PermissionScope) -> PermissionOption {
        PermissionOption {
            id: id.to_owned(),
            label: id.to_owned(),
            effect,
            scope,
            stops_run: false,
            message: MessagePolicy::None,
            rule: None,
        }
    }

    /// Claude Code's options for a command: allow, allow for the session, deny with optional words,
    /// deny and stop.
    fn claude_code() -> ToolPermissionRequest {
        let mut deny = option("deny", PermissionEffect::Deny, PermissionScope::Once);
        deny.message = MessagePolicy::Optional;
        let mut stop = option("deny_stop", PermissionEffect::Deny, PermissionScope::Once);
        stop.stops_run = true;
        ToolPermissionRequest {
            input: None,
            input_editable: false,
            reason: None,
            previews: vec![PermissionPreview::Command(CommandPreview {
                command: "npm test".to_owned(),
                cwd: None,
            })],
            options: vec![
                option(
                    "allow_session",
                    PermissionEffect::Allow,
                    PermissionScope::Session,
                ),
                option("allow", PermissionEffect::Allow, PermissionScope::Once),
                stop,
                deny,
            ],
            grants: Vec::new(),
            default_option_id: None,
            deliberate: false,
        }
    }

    fn ask(request: InteractionRequest) -> Interaction {
        Interaction {
            id: "i1".to_owned(),
            run_id: None,
            created_at: 0,
            expires_at: None,
            title: "Run npm test?".to_owned(),
            body: None,
            blocks_run: true,
            origin: None,
            request,
        }
    }

    fn quick(request: ToolPermissionRequest, answerable: bool) -> (Option<String>, Option<String>) {
        let pending = pending_ask(
            &ask(InteractionRequest::ToolPermission(request)),
            answerable,
        );
        (pending.allow.map(|o| o.id), pending.deny.map(|o| o.id))
    }

    #[test]
    fn a_tap_gets_the_plain_allow_once_and_the_deny_that_lets_the_run_go_on() {
        let pending = pending_ask(
            &ask(InteractionRequest::ToolPermission(claude_code())),
            true,
        );
        assert_eq!(pending.kind, InteractionKind::ToolPermission);
        let interaction = ask(InteractionRequest::ToolPermission(claude_code()));
        assert_eq!(ask_command(&interaction).as_deref(), Some("npm test"));
        assert_eq!(
            quick(claude_code(), true),
            (Some("allow".into()), Some("deny".into()))
        );
    }

    #[test]
    fn nothing_is_offered_where_a_tap_cannot_answer() {
        assert_eq!(
            quick(claude_code(), false),
            (None, None),
            "a session that takes no answers"
        );
        let mut deliberate = claude_code();
        deliberate.deliberate = true;
        assert_eq!(
            quick(deliberate, true),
            (None, None),
            "the backend wants no one-tap answer"
        );
        let mut grants = claude_code();
        grants.grants.push(PermissionGrant {
            id: "g".to_owned(),
            kind: GrantKind::Network,
            target: None,
        });
        assert_eq!(
            quick(grants, true),
            (None, Some("deny".into())),
            "allowing needs a grant chosen"
        );
        let mut words = claude_code();
        for option in &mut words.options {
            option.message = MessagePolicy::Required;
        }
        assert_eq!(quick(words, true), (None, None), "every option needs words");
        let confirm = pending_ask(&ask(InteractionRequest::Confirm(ConfirmRequest {})), true);
        assert_eq!(
            (confirm.kind, confirm.allow, confirm.deny),
            (InteractionKind::Confirm, None, None)
        );
    }
}
