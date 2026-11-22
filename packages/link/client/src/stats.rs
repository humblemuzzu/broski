//! Merges `StatsSummary` snapshots from one or more paired Macs into a single view.
//! Identical `(host_id, volume_id)` fingerprints are claimed once (newest `generated_at` wins)
//! so duplicate links or shared volumes never double-count.

use std::collections::{BTreeMap, HashMap, HashSet};

use broski_contract::{
    StatsCostParts, StatsCostSource, StatsHarness, StatsHarnessEntry, StatsModelEntry,
    StatsPricingInfo, StatsPricingStatus, StatsProjectEntry, StatsScanState, StatsSeriesPoint,
    StatsSeriesSlice, StatsSourceStatus, StatsSpeedCost, StatsSubagentEntry, StatsSummary,
    StatsTokenTotals, StatsTotals, MAX_STATS_MODELS, MAX_STATS_PROJECTS, MAX_STATS_SERIES,
    MAX_STATS_SOURCES, MAX_STATS_SUBAGENTS, MAX_STATS_UNPRICED_MODELS,
};

pub fn merge_stats_summaries(summaries: Vec<StatsSummary>) -> Option<StatsSummary> {
    if summaries.is_empty() {
        return None;
    }

    // Deduplicate identical host/volume fingerprints, keeping the newest snapshot.
    let mut by_fp: HashMap<(String, String), StatsSummary> = HashMap::new();
    let mut order: Vec<(String, String)> = Vec::new();
    for s in summaries {
        let key = (
            s.fingerprint.host_id.clone(),
            s.fingerprint.volume_id.clone(),
        );
        if let Some(existing) = by_fp.get(&key) {
            if s.generated_at > existing.generated_at {
                by_fp.insert(key, s);
            }
        } else {
            order.push(key.clone());
            by_fp.insert(key, s);
        }
    }

    let mut unique: Vec<StatsSummary> =
        order.into_iter().filter_map(|k| by_fp.remove(&k)).collect();
    if unique.len() == 1 {
        return unique.pop();
    }

    let first = &unique[0];
    let range = first.range;
    let resolution = first.resolution;
    let time_zone = first.time_zone.clone();
    let fingerprint = first.fingerprint.clone();

    let mut generated_at = first.generated_at;
    let mut since_day = first.since_day.clone();
    let mut until_day = first.until_day.clone();
    let mut scan_state = StatsScanState::Fresh;
    let mut totals = empty_totals();
    let mut prev_totals: Option<StatsTotals> = None;

    let mut harnesses: HashMap<StatsHarness, StatsHarnessEntry> = HashMap::new();
    let mut models: HashMap<(String, String), StatsModelEntry> = HashMap::new();
    let mut projects: HashMap<String, StatsProjectEntry> = HashMap::new();
    let mut subagents: HashMap<String, StatsSubagentEntry> = HashMap::new();
    let mut series: BTreeMap<String, StatsSeriesPoint> = BTreeMap::new();
    let mut sources: HashMap<StatsHarness, StatsSourceStatus> = HashMap::new();
    let mut unpriced_set: HashSet<String> = HashSet::new();
    let mut pricing_status = StatsPricingStatus::Bundled;
    let mut fetched_at: Option<i64> = None;
    let mut known_models: i64 = 0;

    for s in &unique {
        generated_at = generated_at.max(s.generated_at);
        if s.since_day < since_day {
            since_day = s.since_day.clone();
        }
        if s.until_day > until_day {
            until_day = s.until_day.clone();
        }
        scan_state = worst_scan_state(scan_state, s.scan_state);
        add_totals(&mut totals, &s.totals);
        if let Some(prev) = &s.previous_totals {
            let acc = prev_totals.get_or_insert_with(empty_totals);
            add_totals(acc, prev);
        }
        for h in &s.harnesses {
            merge_harness(&mut harnesses, h);
        }
        for m in &s.models {
            merge_model(&mut models, m);
        }
        for p in &s.projects {
            merge_project(&mut projects, p);
        }
        for sub in &s.subagents {
            merge_subagent(&mut subagents, sub);
        }
        for pt in &s.series {
            merge_series_point(&mut series, pt);
        }
        for src in &s.sources {
            merge_source(&mut sources, src);
        }
        pricing_status = best_pricing_status(pricing_status, s.pricing.status);
        if let Some(f) = s.pricing.fetched_at {
            fetched_at = Some(fetched_at.map_or(f, |cur| cur.max(f)));
        }
        known_models = known_models.max(s.pricing.known_models);
        for u in &s.pricing.unpriced_models {
            unpriced_set.insert(u.clone());
        }
    }

    let mut harness_list: Vec<StatsHarnessEntry> = harnesses.into_values().collect();
    harness_list.sort_by(|a, b| {
        b.cost_usd
            .total_cmp(&a.cost_usd)
            .then_with(|| total_tokens(&b.tokens).cmp(&total_tokens(&a.tokens)))
    });
    harness_list.truncate(MAX_STATS_SOURCES);

    let mut model_list: Vec<StatsModelEntry> = models.into_values().collect();
    model_list.sort_by(|a, b| {
        b.cost
            .total
            .total_cmp(&a.cost.total)
            .then_with(|| total_tokens(&b.tokens).cmp(&total_tokens(&a.tokens)))
    });
    model_list.truncate(MAX_STATS_MODELS);

    let mut project_list: Vec<StatsProjectEntry> = projects.into_values().collect();
    project_list.sort_by(|a, b| {
        b.cost_usd
            .total_cmp(&a.cost_usd)
            .then_with(|| b.total_tokens.cmp(&a.total_tokens))
    });
    project_list.truncate(MAX_STATS_PROJECTS);

    let mut subagent_list: Vec<StatsSubagentEntry> = subagents.into_values().collect();
    subagent_list.sort_by(|a, b| {
        b.cost_usd
            .total_cmp(&a.cost_usd)
            .then_with(|| b.runs.cmp(&a.runs))
    });
    subagent_list.truncate(MAX_STATS_SUBAGENTS);

    let mut series_list: Vec<StatsSeriesPoint> = series.into_values().collect();
    if series_list.len() > MAX_STATS_SERIES {
        let drop_n = series_list.len() - MAX_STATS_SERIES;
        series_list.drain(0..drop_n);
    }

    let mut source_list: Vec<StatsSourceStatus> = sources.into_values().collect();
    source_list.truncate(MAX_STATS_SOURCES);

    let mut unpriced_models: Vec<String> = unpriced_set.into_iter().collect();
    unpriced_models.sort();
    unpriced_models.truncate(MAX_STATS_UNPRICED_MODELS);

    Some(StatsSummary {
        generated_at,
        range,
        resolution,
        time_zone,
        since_day,
        until_day,
        scan_state,
        fingerprint,
        totals,
        previous_totals: prev_totals,
        harnesses: harness_list,
        models: model_list,
        projects: project_list,
        subagents: subagent_list,
        series: series_list,
        sources: source_list,
        pricing: StatsPricingInfo {
            status: pricing_status,
            fetched_at,
            known_models,
            unpriced_models,
        },
    })
}

fn total_tokens(t: &StatsTokenTotals) -> i64 {
    t.uncached_input
        .saturating_add(t.cached_input)
        .saturating_add(t.cache_creation)
        .saturating_add(t.output)
}

fn empty_tokens() -> StatsTokenTotals {
    StatsTokenTotals {
        uncached_input: 0,
        cached_input: 0,
        cache_creation: 0,
        cache_creation1h: 0,
        output: 0,
        reasoning: 0,
    }
}

fn empty_totals() -> StatsTotals {
    StatsTotals {
        tokens: empty_tokens(),
        cost: StatsCostParts {
            input: 0.0,
            output: 0.0,
            cache_read: 0.0,
            cache_write: 0.0,
            total: 0.0,
        },
        speed_cost: StatsSpeedCost {
            standard: 0.0,
            fast: 0.0,
            ultrafast: 0.0,
            premium: 0.0,
        },
        cache_savings_usd: 0.0,
        sessions: 0,
        turns: 0,
        active_days: 0,
        active_ms: 0,
        busts: 0,
        idle_busts: 0,
        bust_cost_usd: 0.0,
        unpriced_turns: 0,
        unpriced_tokens: 0,
        cost_source: StatsCostSource::ApiEstimate,
    }
}

fn add_tokens(dst: &mut StatsTokenTotals, src: &StatsTokenTotals) {
    dst.uncached_input = dst.uncached_input.saturating_add(src.uncached_input);
    dst.cached_input = dst.cached_input.saturating_add(src.cached_input);
    dst.cache_creation = dst.cache_creation.saturating_add(src.cache_creation);
    dst.cache_creation1h = dst.cache_creation1h.saturating_add(src.cache_creation1h);
    dst.output = dst.output.saturating_add(src.output);
    dst.reasoning = dst.reasoning.saturating_add(src.reasoning);
}

fn add_cost(dst: &mut StatsCostParts, src: &StatsCostParts) {
    dst.input += src.input;
    dst.output += src.output;
    dst.cache_read += src.cache_read;
    dst.cache_write += src.cache_write;
    dst.total += src.total;
}

fn add_totals(dst: &mut StatsTotals, src: &StatsTotals) {
    let had_turns = dst.turns > 0;
    add_tokens(&mut dst.tokens, &src.tokens);
    add_cost(&mut dst.cost, &src.cost);
    dst.speed_cost.standard += src.speed_cost.standard;
    dst.speed_cost.fast += src.speed_cost.fast;
    dst.speed_cost.ultrafast += src.speed_cost.ultrafast;
    dst.speed_cost.premium += src.speed_cost.premium;
    dst.cache_savings_usd += src.cache_savings_usd;
    dst.sessions = dst.sessions.saturating_add(src.sessions);
    dst.turns = dst.turns.saturating_add(src.turns);
    dst.active_days = dst.active_days.max(src.active_days);
    dst.active_ms = dst.active_ms.saturating_add(src.active_ms);
    dst.busts = dst.busts.saturating_add(src.busts);
    dst.idle_busts = dst.idle_busts.saturating_add(src.idle_busts);
    dst.bust_cost_usd += src.bust_cost_usd;
    dst.unpriced_turns = dst.unpriced_turns.saturating_add(src.unpriced_turns);
    dst.unpriced_tokens = dst.unpriced_tokens.saturating_add(src.unpriced_tokens);
    dst.cost_source = if !had_turns {
        src.cost_source
    } else if src.turns == 0 || dst.cost_source == src.cost_source {
        dst.cost_source
    } else {
        StatsCostSource::Mixed
    };
}

fn merge_harness(map: &mut HashMap<StatsHarness, StatsHarnessEntry>, item: &StatsHarnessEntry) {
    if let Some(acc) = map.get_mut(&item.harness) {
        acc.sessions = acc.sessions.saturating_add(item.sessions);
        acc.turns = acc.turns.saturating_add(item.turns);
        add_tokens(&mut acc.tokens, &item.tokens);
        acc.cost_usd += item.cost_usd;
        acc.cache_savings_usd += item.cache_savings_usd;
        acc.unpriced_turns = acc.unpriced_turns.saturating_add(item.unpriced_turns);
    } else {
        map.insert(item.harness, item.clone());
    }
}

fn merge_model(map: &mut HashMap<(String, String), StatsModelEntry>, item: &StatsModelEntry) {
    let key = (item.provider.clone(), item.model.clone());
    if let Some(acc) = map.get_mut(&key) {
        extend_harnesses(&mut acc.harnesses, &item.harnesses);
        acc.turns = acc.turns.saturating_add(item.turns);
        add_tokens(&mut acc.tokens, &item.tokens);
        add_cost(&mut acc.cost, &item.cost);
        acc.cache_savings_usd += item.cache_savings_usd;
        acc.duration_ms = acc.duration_ms.saturating_add(item.duration_ms);
        acc.timed_output_tokens = acc
            .timed_output_tokens
            .saturating_add(item.timed_output_tokens);
        acc.errors = acc.errors.saturating_add(item.errors);
        acc.unpriced_turns = acc.unpriced_turns.saturating_add(item.unpriced_turns);
    } else {
        map.insert(key, item.clone());
    }
}

fn merge_project(map: &mut HashMap<String, StatsProjectEntry>, item: &StatsProjectEntry) {
    if let Some(acc) = map.get_mut(&item.id) {
        extend_harnesses(&mut acc.harnesses, &item.harnesses);
        acc.sessions = acc.sessions.saturating_add(item.sessions);
        acc.turns = acc.turns.saturating_add(item.turns);
        acc.total_tokens = acc.total_tokens.saturating_add(item.total_tokens);
        acc.cost_usd += item.cost_usd;
        acc.last_at = acc.last_at.max(item.last_at);
    } else {
        map.insert(item.id.clone(), item.clone());
    }
}

fn merge_subagent(map: &mut HashMap<String, StatsSubagentEntry>, item: &StatsSubagentEntry) {
    if let Some(acc) = map.get_mut(&item.name) {
        extend_harnesses(&mut acc.harnesses, &item.harnesses);
        acc.runs = acc.runs.saturating_add(item.runs);
        acc.turns = acc.turns.saturating_add(item.turns);
        acc.total_tokens = acc.total_tokens.saturating_add(item.total_tokens);
        acc.cost_usd += item.cost_usd;
        acc.failures = acc.failures.saturating_add(item.failures);
    } else {
        map.insert(item.name.clone(), item.clone());
    }
}

fn merge_series_point(map: &mut BTreeMap<String, StatsSeriesPoint>, pt: &StatsSeriesPoint) {
    if let Some(acc) = map.get_mut(&pt.key) {
        acc.cost_usd += pt.cost_usd;
        acc.total_tokens = acc.total_tokens.saturating_add(pt.total_tokens);
        acc.turns = acc.turns.saturating_add(pt.turns);
        acc.cache_read = acc.cache_read.saturating_add(pt.cache_read);
        acc.cache_denom = acc.cache_denom.saturating_add(pt.cache_denom);
        for slice in &pt.by_harness {
            merge_slice(&mut acc.by_harness, slice);
        }
    } else {
        map.insert(pt.key.clone(), pt.clone());
    }
}

fn merge_slice(slices: &mut Vec<StatsSeriesSlice>, slice: &StatsSeriesSlice) {
    if let Some(acc) = slices.iter_mut().find(|s| s.harness == slice.harness) {
        acc.cost_usd += slice.cost_usd;
        acc.total_tokens = acc.total_tokens.saturating_add(slice.total_tokens);
        acc.turns = acc.turns.saturating_add(slice.turns);
    } else if slices.len() < MAX_STATS_SOURCES {
        slices.push(slice.clone());
    }
}

fn merge_source(map: &mut HashMap<StatsHarness, StatsSourceStatus>, src: &StatsSourceStatus) {
    if let Some(acc) = map.get_mut(&src.harness) {
        acc.state = worst_scan_state(acc.state, src.state);
        acc.files = acc.files.saturating_add(src.files);
        acc.parsed_files = acc.parsed_files.saturating_add(src.parsed_files);
        acc.bytes_read = acc.bytes_read.saturating_add(src.bytes_read);
        acc.total_bytes = acc.total_bytes.saturating_add(src.total_bytes);
        if acc.problem.is_none() {
            acc.problem.clone_from(&src.problem);
        }
    } else {
        map.insert(src.harness, src.clone());
    }
}

fn extend_harnesses(dst: &mut Vec<StatsHarness>, src: &[StatsHarness]) {
    for &h in src {
        if !dst.contains(&h) && dst.len() < MAX_STATS_SOURCES {
            dst.push(h);
        }
    }
}

fn worst_scan_state(a: StatsScanState, b: StatsScanState) -> StatsScanState {
    match (a, b) {
        (StatsScanState::Indexing, _) | (_, StatsScanState::Indexing) => StatsScanState::Indexing,
        (StatsScanState::Refreshing, _) | (_, StatsScanState::Refreshing) => {
            StatsScanState::Refreshing
        }
        _ => StatsScanState::Fresh,
    }
}

fn best_pricing_status(a: StatsPricingStatus, b: StatsPricingStatus) -> StatsPricingStatus {
    match (a, b) {
        (StatsPricingStatus::Fresh, _) | (_, StatsPricingStatus::Fresh) => {
            StatsPricingStatus::Fresh
        }
        (StatsPricingStatus::Cached, _) | (_, StatsPricingStatus::Cached) => {
            StatsPricingStatus::Cached
        }
        _ => StatsPricingStatus::Bundled,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use broski_contract::{StatsFingerprint, StatsRange, StatsResolution};

    fn sample(host: &str, vol: &str, at: i64, cost: f64, turns: i64) -> StatsSummary {
        let mut totals = empty_totals();
        totals.turns = turns;
        totals.sessions = 1;
        totals.cost.total = cost;
        totals.tokens.uncached_input = 1000;
        StatsSummary {
            generated_at: at,
            range: StatsRange::Week,
            resolution: StatsResolution::Day,
            time_zone: "UTC".into(),
            since_day: "2026-11-16".into(),
            until_day: "2026-11-22".into(),
            scan_state: StatsScanState::Fresh,
            fingerprint: StatsFingerprint {
                host_id: host.into(),
                volume_id: vol.into(),
            },
            totals,
            previous_totals: None,
            harnesses: vec![StatsHarnessEntry {
                harness: StatsHarness::Claude,
                display_name: "Claude Code".into(),
                sessions: 1,
                turns,
                tokens: StatsTokenTotals {
                    uncached_input: 1000,
                    cached_input: 0,
                    cache_creation: 0,
                    cache_creation1h: 0,
                    output: 0,
                    reasoning: 0,
                },
                cost_usd: cost,
                cache_savings_usd: 0.0,
                unpriced_turns: 0,
            }],
            models: vec![],
            projects: vec![],
            subagents: vec![],
            series: vec![],
            sources: vec![],
            pricing: StatsPricingInfo {
                status: StatsPricingStatus::Bundled,
                fetched_at: None,
                known_models: 40,
                unpriced_models: vec![],
            },
        }
    }

    #[test]
    fn deduplicates_identical_fingerprints_and_sums_distinct_machines() {
        let a_old = sample("mac-1", "vol-1", 100, 1.0, 2);
        let a_new = sample("mac-1", "vol-1", 200, 2.5, 4);
        let b = sample("mac-2", "vol-2", 150, 3.0, 5);
        let merged = merge_stats_summaries(vec![a_old, a_new, b]).expect("merged");
        assert_eq!(merged.generated_at, 200);
        assert_eq!(merged.totals.turns, 9);
        assert!((merged.totals.cost.total - 5.5).abs() < 1e-9);
        assert_eq!(merged.harnesses.len(), 1);
        assert_eq!(merged.harnesses[0].turns, 9);
    }
}
