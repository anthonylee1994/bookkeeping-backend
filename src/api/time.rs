use chrono::{Datelike, Duration, FixedOffset, NaiveDate, NaiveDateTime, NaiveTime, Timelike, Utc};

/// Hong Kong has no daylight saving: a fixed +08:00 offset is exact.
pub fn hk_offset() -> FixedOffset {
    FixedOffset::east_opt(8 * 3600).expect("valid offset")
}

pub fn now_local() -> NaiveDateTime {
    Utc::now().with_timezone(&hk_offset()).naive_local()
}

pub fn today() -> NaiveDate {
    now_local().date()
}

pub fn format_datetime(dt: &NaiveDateTime) -> String {
    format!("{}", dt.format("%Y-%m-%dT%H:%M:%S%.3f+08:00"))
}

pub fn format_datetime_opt(dt: &Option<NaiveDateTime>) -> Option<String> {
    dt.as_ref().map(format_datetime)
}

pub fn format_datetime_seconds(dt: &NaiveDateTime) -> String {
    format!("{}", dt.format("%Y-%m-%dT%H:%M:%S+08:00"))
}

pub fn format_date(date: &NaiveDate) -> String {
    date.format("%Y-%m-%d").to_string()
}

pub fn format_date_opt(date: &Option<NaiveDate>) -> Option<String> {
    date.as_ref().map(format_date)
}

/// Parse a date-time the way `Time.zone.parse` would: an explicit offset is
/// converted to Hong Kong time, a naive value is treated as Hong Kong local.
pub fn parse_datetime(value: &str) -> Option<NaiveDateTime> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(value) {
        return Some(dt.with_timezone(&hk_offset()).naive_local());
    }
    for fmt in [
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%d %H:%M:%S%.f",
        "%Y-%m-%dT%H:%M:%S",
    ] {
        if let Ok(naive) = NaiveDateTime::parse_from_str(value, fmt) {
            return Some(naive);
        }
    }
    parse_date(value).map(|date| date.and_hms_opt(0, 0, 0).expect("valid midnight"))
}

pub fn parse_date(value: &str) -> Option<NaiveDate> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()
}

pub fn beginning_of_day(date: NaiveDate) -> NaiveDateTime {
    date.and_hms_opt(0, 0, 0).expect("valid midnight")
}

pub fn end_of_day(date: NaiveDate) -> NaiveDateTime {
    date.and_hms_opt(23, 59, 59)
        .expect("valid end of day")
        .with_nanosecond(999_999_999)
        .expect("valid nanos")
}

pub fn beginning_of_week_monday(date: NaiveDate) -> NaiveDate {
    let days_from_monday = date.weekday().num_days_from_monday();
    date - Duration::days(i64::from(days_from_monday))
}

pub fn end_of_week_monday(date: NaiveDate) -> NaiveDate {
    beginning_of_week_monday(date) + Duration::days(6)
}

pub fn beginning_of_month(date: NaiveDate) -> NaiveDate {
    date.with_day(1).expect("valid first day")
}

pub fn end_of_month(date: NaiveDate) -> NaiveDate {
    let (year, month) = (date.year(), date.month());
    let (next_year, next_month) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    NaiveDate::from_ymd_opt(next_year, next_month, 1).expect("valid month") - Duration::days(1)
}

pub fn date_from_parts(year: i32, month: u32, day: u32) -> Option<NaiveDate> {
    NaiveDate::from_ymd_opt(year, month, day)
}

pub fn datetime_from_parts(date: NaiveDate, time: NaiveTime) -> NaiveDateTime {
    NaiveDateTime::new(date, time)
}
