use broski_contract::{
    ParentKind, SessionOrigin, SessionParent, SessionStatus, SessionTitle, TitleSource,
};

use super::*;

fn row(id: &str, updated_at: i64, cwd: &str) -> SessionSummary {
    SessionSummary {
        session: SessionRef {
            backend: "pi".to_owned(),
            session_id: id.to_owned(),
        },
        title: None,
        cwd: Some(cwd.to_owned()),
        created_at: None,
        updated_at,
        run_started_at: None,
        parent: None,
        model_id: None,
        status: SessionStatus::Idle,
        origin: SessionOrigin::Broski,
        source: None,
    }
}

fn titled(id: &str, updated_at: i64, title: &str) -> SessionSummary {
    SessionSummary {
        title: Some(SessionTitle {
            text: title.to_owned(),
            source: TitleSource::FirstPrompt,
        }),
        ..row(id, updated_at, "/w")
    }
}

fn ids(list: &ListState) -> Vec<&str> {
    list.rows()
        .iter()
        .map(|row| row.session.session_id.as_str())
        .collect()
}

fn query(cwd: Option<&str>, search: Option<&str>) -> SessionQuery {
    SessionQuery {
        cwd: cwd.map(str::to_owned),
        parent: None,
        search: search.map(str::to_owned),
    }
}

fn list_in(lists: &mut Lists, cwd: Option<&str>) -> u64 {
    lists.create("pi".to_owned(), query(cwd, None), 50)
}

fn spec(capacity: usize, keeps_older: bool) -> ListSpec {
    ListSpec {
        backend: "pi".to_owned(),
        query: query(None, None),
        limit: 2,
        capacity,
        keeps_older,
    }
}

fn page(items: Vec<SessionSummary>, next: Option<&str>) -> SessionPage {
    SessionPage {
        items,
        next_cursor: next.map(str::to_owned),
    }
}

#[test]
fn pages_merge_newest_first_with_one_row_per_session_and_a_reload_replaces_them() {
    let mut lists = Lists::default();
    let id = list_in(&mut lists, None);
    let list = lists.get_mut(id).expect("list");
    let first = list.next_page().expect("a first page");
    assert!(list.next_page().is_none(), "one page at a time");
    list.page(
        &first,
        page(vec![row("c", 30, "/w"), row("b", 20, "/w")], Some("p2")),
    );
    let second = list.next_page().expect("a second page");
    assert_eq!(second.cursor.as_deref(), Some("p2"));
    list.page(
        &second,
        page(vec![row("b", 20, "/w"), row("a", 10, "/w")], None),
    );
    assert_eq!(ids(list), ["c", "b", "a"]);
    assert!(!list.has_more());
    assert!(list.next_page().is_none());

    let reload = list.reload();
    let stale = PageAsk {
        cursor: None,
        generation: reload.generation - 1,
    };
    list.page(&stale, page(vec![row("x", 99, "/w")], None));
    assert_eq!(
        ids(list),
        ["c", "b", "a"],
        "a page from before the reload is dropped"
    );
    list.page(&reload, page(vec![row("d", 40, "/w")], None));
    assert_eq!(ids(list), ["d"]);
}

#[test]
fn a_reload_of_a_list_that_keeps_older_rows_replaces_only_the_rows_its_first_page_covers() {
    let mut lists = Lists::default();
    let id = lists.create_with(spec(100, true));
    let list = lists.get_mut(id).expect("list");
    let first = list.next_page().expect("first");
    list.page(
        &first,
        page(vec![row("e", 50, "/w"), row("d", 40, "/w")], Some("p2")),
    );
    let second = list.next_page().expect("second");
    list.page(
        &second,
        page(vec![row("c", 30, "/w"), row("b", 20, "/w")], Some("p3")),
    );

    let reload = list.reload();
    list.page(
        &reload,
        page(vec![row("f", 60, "/w"), row("d", 40, "/w")], Some("r2")),
    );
    assert_eq!(
        ids(list),
        ["f", "d", "c", "b"],
        "e left the window the page covers; c and b stay"
    );
    let next = list.next_page().expect("the older rows read on");
    assert_eq!(
        next.cursor.as_deref(),
        Some("p3"),
        "past the older rows, not the reload's own cursor"
    );

    let again = list.reload();
    list.page(&again, page(vec![row("g", 70, "/w")], None));
    assert_eq!(
        ids(list),
        ["g"],
        "a first page that is the whole list replaces it"
    );
}

#[test]
fn a_list_at_its_capacity_asks_for_no_more_pages() {
    let mut lists = Lists::default();
    let id = lists.create_with(spec(3, true));
    let list = lists.get_mut(id).expect("list");
    let first = list.next_page().expect("first");
    list.page(
        &first,
        page(vec![row("e", 50, "/w"), row("d", 40, "/w")], Some("p2")),
    );
    let second = list.next_page().expect("second");
    list.page(
        &second,
        page(vec![row("c", 30, "/w"), row("b", 20, "/w")], Some("p3")),
    );
    assert_eq!(ids(list), ["e", "d", "c"]);
    assert!(
        !list.has_more(),
        "a next page would land behind b, which it dropped"
    );
    assert!(list.next_page().is_none());
}

#[test]
fn a_new_row_past_the_capacity_ends_the_paging_rather_than_leave_a_gap() {
    let mut lists = Lists::default();
    let id = lists.create_with(spec(2, true));
    let list = lists.get_mut(id).expect("list");
    let first = list.next_page().expect("first");
    list.page(
        &first,
        page(vec![row("b", 20, "/w"), row("a", 10, "/w")], Some("p2")),
    );
    assert!(list.has_more());
    lists.updated(&row("c", 30, "/w"));
    let list = lists.get(id).expect("list");
    assert_eq!(ids(list), ["c", "b"]);
    assert!(!list.has_more());
}

#[test]
fn a_row_that_moved_between_pages_is_listed_once_where_it_now_ranks() {
    let mut lists = Lists::default();
    let id = lists.create_with(spec(100, false));
    let list = lists.get_mut(id).expect("list");
    let first = list.next_page().expect("first");
    list.page(
        &first,
        page(vec![row("c", 30, "/w"), row("b", 20, "/w")], Some("p2")),
    );
    let second = list.next_page().expect("second");
    list.page(
        &second,
        page(vec![row("b", 5, "/w"), row("a", 10, "/w")], None),
    );
    assert_eq!(ids(list), ["c", "a", "b"]);
}

#[test]
fn catalog_rows_go_into_the_lists_they_match_and_out_of_the_others() {
    let mut lists = Lists::default();
    let all = list_in(&mut lists, None);
    let here = list_in(&mut lists, Some("/here"));
    lists.updated(&row("s", 10, "/here"));
    lists.updated(&row("t", 20, "/there"));
    assert_eq!(ids(lists.get(all).expect("all")), ["t", "s"]);
    assert_eq!(ids(lists.get(here).expect("here")), ["s"]);

    lists.updated(&row("s", 30, "/there"));
    assert_eq!(
        ids(lists.get(all).expect("all")),
        ["s", "t"],
        "moved to the top"
    );
    assert!(
        ids(lists.get(here).expect("here")).is_empty(),
        "moved out of /here"
    );

    let mut child = row("child", 40, "/there");
    child.parent = Some(SessionParent {
        kind: ParentKind::Subagent,
        session: row("s", 0, "").session,
    });
    lists.updated(&child);
    assert_eq!(
        ids(lists.get(all).expect("all")),
        ["s", "t"],
        "a child is not a top-level row"
    );

    lists.removed(&row("t", 0, "").session);
    assert_eq!(ids(lists.get(all).expect("all")), ["s"]);
    assert!(lists.get_mut(all).expect("all").take_change());
}

#[test]
fn a_search_list_keeps_the_catalog_rows_that_match_it_and_lets_go_of_one_that_stops() {
    let mut lists = Lists::default();
    let found = lists.create("pi".to_owned(), query(None, Some("INBOX paging")), 50);
    let version = lists.get(found).expect("search").version();
    lists.updated(&titled("a", 10, "Fix the inbox paging"));
    lists.updated(&titled("b", 20, "Fix the inbox"));
    assert_eq!(ids(lists.get(found).expect("search")), ["a"]);
    assert!(lists.get(found).expect("search").version() > version);

    lists.updated(&titled("a", 30, "Renamed"));
    assert!(
        ids(lists.get(found).expect("search")).is_empty(),
        "renamed out of the search"
    );
}

#[test]
fn a_failed_page_holds_the_list_back_until_a_page_or_a_reload_goes_through() {
    let mut lists = Lists::default();
    let id = lists.create_with(spec(10, true));
    let list = lists.get_mut(id).expect("list");
    let version = list.version();
    let first = list.next_page().expect("a first page");
    list.page_failed(first.generation);
    assert!(
        list.failed() && list.version() > version,
        "the inbox hears of it"
    );

    let again = list.next_page().expect("a retry");
    list.page(&again, page(vec![row("a", 10, "/w")], Some("c1")));
    assert!(!list.failed());

    let next = list.next_page().expect("the next page");
    list.page_failed(next.generation);
    assert!(list.failed());
    list.ask(true);
    assert!(!list.failed(), "a reload asks again");
}

#[test]
fn a_bounded_list_keeps_its_newest_rows() {
    let mut lists = Lists::default();
    let id = lists.create_with(spec(2, false));
    for (index, updated_at) in [10, 30, 20].into_iter().enumerate() {
        lists.updated(&row(&index.to_string(), updated_at, "/w"));
    }
    assert_eq!(ids(lists.get(id).expect("list")), ["1", "2"]);
}
