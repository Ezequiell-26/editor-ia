fn title_flags(title: &str) -> Vec<String> {
    let lower = title.to_lowercase();
    let normalized = lower.trim_start_matches(|ch: char| !ch.is_alphanumeric());
    let mut flags = Vec::new();
    if title.chars().any(|ch| ch.is_ascii_digit()) {
        flags.push("número".to_owned());
    }
    if title.contains('?') || title.contains('¿') {
        flags.push("pregunta".to_owned());
    }
    if normalized.starts_with("cómo")
        || normalized.starts_with("como ")
        || normalized.starts_with("how to")
        || lower.contains("tutorial")
    {
        flags.push("tutorial".to_owned());
    }
    if title.contains('|') || title.contains(" vs ") || title.contains(" / ") {
        flags.push("comparación/lista".to_owned());
    }
    if [
        "mejor", "peor", "nunca", "secreto", "error", "todo", "nadie", "jamás",
    ]
    .iter()
    .any(|word| lower.contains(word))
    {
        flags.push("curiosidad".to_owned());
    }
    flags
}

fn word_tokens(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|ch: char| !ch.is_alphanumeric() && ch != '\'')
        .map(|word| word.trim_matches('\'').to_owned())
        .filter(|word| word.chars().count() >= 4)
        .collect()
}

fn stopwords() -> HashSet<&'static str> {
    [
        "para", "pero", "porque", "como", "cuando", "donde", "sobre", "entre", "desde", "hasta",
        "también", "tambien", "muy", "más", "mas", "este", "esta", "esto", "estos", "estas", "the",
        "and", "that", "this", "with", "from", "have", "your", "you", "about", "they", "their",
        "what", "when", "where", "will", "would", "there", "here", "http", "https", "www", "com",
        "video", "videos", "youtube",
    ]
    .into_iter()
    .collect()
}

fn keyword_counts(texts: &[String], limit: usize) -> Vec<KeywordCount> {
    let stop = stopwords();
    let mut counts: HashMap<String, u32> = HashMap::new();
    for text in texts {
        for word in word_tokens(text) {
            if stop.contains(word.as_str()) {
                continue;
            }
            *counts.entry(word).or_insert(0) += 1;
        }
    }
    let mut items: Vec<KeywordCount> = counts
        .into_iter()
        .map(|(keyword, count)| KeywordCount { keyword, count })
        .collect();
    items.sort_by(|a, b| b.count.cmp(&a.count).then(a.keyword.cmp(&b.keyword)));
    items.truncate(limit);
    items
}

fn sentiment(comment: &str) -> i32 {
    let words = word_tokens(comment);
    let positive = [
        "buen",
        "buena",
        "excelente",
        "increíble",
        "increible",
        "gracias",
        "genial",
        "perfecto",
        "útil",
        "util",
        "aprendí",
        "aprendi",
        "gran",
        "encanta",
        "encantó",
        "love",
        "great",
        "awesome",
        "thanks",
        "helpful",
        "best",
        "amazing",
        "nice",
        "excellent",
        "cool",
        "brilliant",
    ];
    let negative = [
        "malo",
        "mala",
        "aburrido",
        "error",
        "confuso",
        "pésimo",
        "pesimo",
        "horrible",
        "odio",
        "decepcion",
        "decepción",
        "bad",
        "boring",
        "wrong",
        "confusing",
        "hate",
        "terrible",
        "worst",
        "useless",
        "trash",
        "scam",
    ];
    let mut score = 0;
    for word in words {
        if positive.iter().any(|item| word.starts_with(item)) {
            score += 1;
        }
        if negative.iter().any(|item| word.starts_with(item)) {
            score -= 1;
        }
    }
    score
}

fn analyze_comments(comments: &[RawComment], comment_video_titles: &[String]) -> CommentAnalysis {
    if comments.is_empty() {
        return CommentAnalysis::default();
    }
    let mut positive = 0u32;
    let mut negative = 0u32;
    for comment in comments {
        match sentiment(&comment.text) {
            value if value > 0 => positive += 1,
            value if value < 0 => negative += 1,
            _ => {}
        }
    }
    let total = comments.len() as f64;
    let neutral = comments.len() as u32 - positive - negative;
    let keywords = keyword_counts(
        &comments
            .iter()
            .map(|comment| comment.text.clone())
            .collect::<Vec<_>>(),
        8,
    );
    let mut top: Vec<TopComment> = comments
        .iter()
        .enumerate()
        .filter(|(_, comment)| !comment.text.trim().is_empty())
        .map(|(index, comment)| TopComment {
            author: comment.author.chars().take(60).collect(),
            text: comment.text.chars().take(500).collect(),
            likes: comment.like_count,
            video_title: comment_video_titles.get(index).cloned().unwrap_or_default(),
        })
        .collect();
    top.sort_by(|a, b| b.likes.cmp(&a.likes));
    top.truncate(5);
    CommentAnalysis {
        analyzed: comments.len() as u32,
        positive_percent: (f64::from(positive) / total * 1000.0).round() / 10.0,
        negative_percent: (f64::from(negative) / total * 1000.0).round() / 10.0,
        neutral_percent: (f64::from(neutral) / total * 1000.0).round() / 10.0,
        keywords,
        top_comments: top,
    }
}
