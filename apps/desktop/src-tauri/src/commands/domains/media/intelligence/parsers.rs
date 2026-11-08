fn range(mut start: f64, mut end: f64, duration: f64) -> Option<AnalysisRange> {
    if !start.is_finite() || !end.is_finite() {
        return None;
    }
    start = start.max(0.0).min(duration);
    end = end.max(0.0).min(duration);
    if end - start < 0.02 {
        return None;
    }
    Some(AnalysisRange {
        start_seconds: start,
        end_seconds: end,
    })
}

pub(crate) fn parse_silences(stderr: &str, duration: f64) -> Vec<AnalysisRange> {
    let mut ranges = Vec::new();
    let mut open: Option<f64> = None;
    for line in stderr.lines() {
        if let Some(rest) = line.split("silence_start:").nth(1) {
            if let Some(token) = rest.split_whitespace().next() {
                if let Ok(value) = token.parse::<f64>() {
                    open = Some(value);
                }
            }
        }
        if let Some(rest) = line.split("silence_end:").nth(1) {
            if let Some(token) = rest.split_whitespace().next() {
                if let Ok(value) = token.parse::<f64>() {
                    let start = open.take().unwrap_or(0.0);
                    if let Some(found) = range(start, value, duration) {
                        ranges.push(found);
                    }
                }
            }
        }
    }
    if let Some(start) = open {
        if let Some(found) = range(start, duration, duration) {
            ranges.push(found);
        }
    }
    ranges.sort_by(|a, b| a.start_seconds.total_cmp(&b.start_seconds));
    ranges.truncate(MAX_RANGES);
    ranges
}

pub(crate) fn parse_black_ranges(stderr: &str, duration: f64) -> Vec<AnalysisRange> {
    let mut ranges = Vec::new();
    for line in stderr.lines() {
        if !line.contains("black_start:") {
            continue;
        }
        let mut start = None;
        let mut end = None;
        for token in line.split_whitespace() {
            if let Some(value) = token.strip_prefix("black_start:") {
                start = value.parse::<f64>().ok();
            }
            if let Some(value) = token.strip_prefix("black_end:") {
                end = value.parse::<f64>().ok();
            }
        }
        if let (Some(start), Some(end)) = (start, end) {
            if let Some(found) = range(start, end, duration) {
                ranges.push(found);
            }
        }
    }
    ranges.truncate(MAX_RANGES);
    ranges
}

pub(crate) fn parse_freeze_ranges(stderr: &str, duration: f64) -> Vec<AnalysisRange> {
    let mut ranges = Vec::new();
    let mut open: Option<f64> = None;
    for line in stderr.lines() {
        if let Some(rest) = line.split("freeze_start:").nth(1) {
            if let Some(token) = rest.split_whitespace().next() {
                open = token.parse::<f64>().ok();
            }
        }
        if let Some(rest) = line.split("freeze_end:").nth(1) {
            if let Some(token) = rest.split_whitespace().next() {
                if let Ok(end) = token.parse::<f64>() {
                    let start = open.take().unwrap_or(0.0);
                    if let Some(found) = range(start, end, duration) {
                        ranges.push(found);
                    }
                }
            }
        }
    }
    ranges.truncate(MAX_RANGES);
    ranges
}

pub(crate) fn parse_loudness(stderr: &str) -> Option<LoudnessSummary> {
    let mut integrated = None;
    let mut peak = None;
    let mut lra = None;
    for line in stderr.lines() {
        if line.contains("I:") && line.contains("LUFS") && line.contains("Summary") {
            continue;
        }
        if line.contains("I:") && line.contains("LUFS") {
            for token in line.split_whitespace() {
                if let Ok(value) = token.parse::<f64>() {
                    integrated = Some(value);
                }
            }
        }
        if line.contains("LRA:") && line.contains("LU") {
            for token in line.split_whitespace() {
                if let Ok(value) = token.parse::<f64>() {
                    lra = Some(value);
                }
            }
        }
        if line.contains("Peak:") && line.contains("dBFS") {
            for token in line.split_whitespace() {
                if let Ok(value) = token.parse::<f64>() {
                    peak = Some(value);
                }
            }
        }
    }
    if integrated.is_none() && peak.is_none() && lra.is_none() {
        return None;
    }
    Some(LoudnessSummary {
        integrated_lufs: integrated,
        true_peak_db: peak,
        lra_db: lra,
        noise_floor_db: None,
    })
}

pub(crate) fn parse_noise_floor(stderr: &str) -> Option<f64> {
    let mut value = None;
    for line in stderr.lines() {
        if let Some(rest) = line.split("Noise floor dB:").nth(1) {
            if let Some(token) = rest.split_whitespace().next() {
                if token.eq_ignore_ascii_case("-inf") {
                    return None;
                }
                if let Ok(parsed) = token.parse::<f64>() {
                    value = Some(parsed);
                }
            }
        }
    }
    value
}

pub(crate) fn parse_signalstats(stdout: &str) -> (Option<f64>, Option<f64>) {
    let mut luma_sum = 0.0;
    let mut luma_count = 0.0;
    let mut sat_sum = 0.0;
    let mut sat_count = 0.0;
    for line in stdout.lines() {
        if let Some(value) = line.strip_prefix("lavfi.signalstats.YAVG=") {
            if let Ok(parsed) = value.trim().parse::<f64>() {
                luma_sum += parsed;
                luma_count += 1.0;
            }
        }
        if let Some(value) = line.strip_prefix("lavfi.signalstats.SATAVG=") {
            if let Ok(parsed) = value.trim().parse::<f64>() {
                sat_sum += parsed;
                sat_count += 1.0;
            }
        }
    }
    (
        (luma_count > 0.0).then_some(luma_sum / luma_count),
        (sat_count > 0.0).then_some(sat_sum / sat_count),
    )
}
