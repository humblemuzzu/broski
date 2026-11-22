use broski_contract::StatsSummary;

#[uniffi::export]
pub fn merge_stats_summaries(summaries: Vec<StatsSummary>) -> Option<StatsSummary> {
    broski_client::merge_stats_summaries(summaries)
}
