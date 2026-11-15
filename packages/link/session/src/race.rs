/// The outcome of a race between the relay socket and the LAN candidates.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Choice {
    Wait,
    Lan(usize),
    Relay,
}

/// Picks between a relay socket and LAN candidates that open concurrently.
///
/// LAN wins whenever it opens while the relay is still inside its grace window, whatever the order
/// they opened in. Time only arrives as `grace_elapsed`, so this is a pure function of the events
/// fed in.
pub(crate) struct RouteRace {
    lan_candidates: usize,
    lan_failures: usize,
    relay_open: bool,
    grace_pending: bool,
    winner: Option<usize>,
    choice: Choice,
}

impl RouteRace {
    pub(crate) fn new(lan_candidates: usize) -> RouteRace {
        RouteRace {
            lan_candidates,
            lan_failures: 0,
            relay_open: false,
            grace_pending: false,
            winner: None,
            choice: Choice::Wait,
        }
    }

    pub(crate) fn choice(&self) -> Choice {
        self.choice
    }

    /// True while a LAN socket may still open and beat the open relay.
    pub(crate) fn awaiting_grace(&self) -> bool {
        self.choice == Choice::Wait && self.grace_pending && self.lan_possible()
    }

    fn lan_possible(&self) -> bool {
        self.winner.is_none() && self.lan_failures < self.lan_candidates
    }

    pub(crate) fn lan_opened(&mut self, index: usize) {
        if self.choice != Choice::Wait || self.winner.is_some() {
            return;
        }
        self.winner = Some(index);
        self.resolve();
    }

    pub(crate) fn lan_failed(&mut self) {
        self.lan_failures += 1;
        self.resolve();
    }

    pub(crate) fn relay_opened(&mut self) {
        if self.relay_open {
            return;
        }
        self.relay_open = true;
        self.grace_pending = true;
        self.resolve();
    }

    pub(crate) fn relay_failed(&mut self) {
        self.relay_open = false;
        self.grace_pending = false;
        self.resolve();
    }

    pub(crate) fn grace_elapsed(&mut self) {
        if !self.grace_pending {
            return;
        }
        self.grace_pending = false;
        self.resolve();
    }

    fn resolve(&mut self) {
        if self.choice != Choice::Wait {
            return;
        }
        if let Some(index) = self.winner {
            self.choice = Choice::Lan(index);
            return;
        }
        if self.relay_open && !(self.lan_possible() && self.grace_pending) {
            self.choice = Choice::Relay;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_relay_with_no_lan_candidate_wins_at_once() {
        let mut race = RouteRace::new(0);
        assert_eq!(race.choice(), Choice::Wait);
        race.relay_opened();
        assert_eq!(race.choice(), Choice::Relay);
        assert!(!race.awaiting_grace());
    }

    #[test]
    fn an_open_relay_waits_for_the_grace_window_before_it_wins() {
        let mut race = RouteRace::new(1);
        race.relay_opened();
        assert_eq!(race.choice(), Choice::Wait);
        assert!(race.awaiting_grace());
        race.grace_elapsed();
        assert_eq!(race.choice(), Choice::Relay);
    }

    #[test]
    fn a_lan_socket_inside_the_window_beats_an_open_relay() {
        let mut race = RouteRace::new(2);
        race.relay_opened();
        race.lan_opened(1);
        assert_eq!(race.choice(), Choice::Lan(1));
        assert!(!race.awaiting_grace());
    }

    #[test]
    fn a_lan_socket_after_the_window_is_ignored() {
        let mut race = RouteRace::new(1);
        race.relay_opened();
        race.grace_elapsed();
        race.lan_opened(0);
        assert_eq!(race.choice(), Choice::Relay);
    }

    #[test]
    fn the_relay_wins_as_soon_as_every_lan_candidate_has_failed() {
        let mut race = RouteRace::new(2);
        race.relay_opened();
        race.lan_failed();
        assert_eq!(race.choice(), Choice::Wait);
        assert!(race.awaiting_grace(), "one candidate is still dialling");
        race.lan_failed();
        assert_eq!(race.choice(), Choice::Relay);
        assert!(!race.awaiting_grace());
    }

    #[test]
    fn a_relay_socket_that_dies_during_the_window_hands_the_race_back() {
        let mut race = RouteRace::new(1);
        race.relay_opened();
        race.relay_failed();
        assert_eq!(race.choice(), Choice::Wait);
        assert!(!race.awaiting_grace());
        race.lan_opened(0);
        assert_eq!(race.choice(), Choice::Lan(0));
    }

    #[test]
    fn a_lan_only_race_stays_unresolved_until_a_socket_opens() {
        let mut race = RouteRace::new(1);
        race.grace_elapsed();
        assert_eq!(race.choice(), Choice::Wait);
        assert!(!race.awaiting_grace());
        race.lan_opened(0);
        assert_eq!(race.choice(), Choice::Lan(0));
    }
}
