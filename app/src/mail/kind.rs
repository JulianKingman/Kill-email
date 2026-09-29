//! What sort of mail a message is, from its headers alone: the signals the unsubscribe
//! suggestions lean on. Rules only; the on-device model will refine the unclear ones.

/// Kinds, from "keep" to "fair game"
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Kind {
    /// From a person, not a mailing system
    Personal,
    /// Triggered by something you did: receipts, code reviews, sign-in codes, bookings
    Notification,
    /// Editorial mail you signed up for
    Newsletter,
    /// Likes, follows, "people you may know"
    Social,
    /// Sales and promotions
    Marketing,
    /// Sent in bulk, nothing more specific known
    #[default]
    Bulk,
}

impl Kind {
    pub fn label(self) -> &'static str {
        match self {
            Kind::Personal => "personal",
            Kind::Notification => "notifications",
            Kind::Newsletter => "newsletter",
            Kind::Social => "social",
            Kind::Marketing => "marketing",
            Kind::Bulk => "bulk mail",
        }
    }
}

/// Headers the classifier looks at, all optional
#[derive(Default)]
pub struct Signals<'a> {
    pub from: &'a str,
    pub subject: &'a str,
    pub bulk: bool,
    pub list_unsubscribe: Option<&'a str>,
    pub auto_submitted: Option<&'a str>,
    pub feedback_id: Option<&'a str>,
    pub x_mailer: Option<&'a str>,
    /// Headers only one kind of sender sets, by name, e.g. `X-GitHub-Reason`
    pub present: &'a [&'a str],
}

/// Bulk-mail services, and whether what they send is mostly marketing or newsletters.
/// Matched against the unsubscribe link, Feedback-ID and X-Mailer.
const PLATFORMS: &[(&str, &str, Kind)] = &[
    ("list-manage.com", "Mailchimp", Kind::Marketing),
    ("mailchimp", "Mailchimp", Kind::Marketing),
    ("mcsv.net", "Mailchimp", Kind::Marketing),
    ("klaviyo", "Klaviyo", Kind::Marketing),
    ("klclick", "Klaviyo", Kind::Marketing),
    ("braze", "Braze", Kind::Marketing),
    ("iterable", "Iterable", Kind::Marketing),
    ("hubspot", "HubSpot", Kind::Marketing),
    ("hs-analytics", "HubSpot", Kind::Marketing),
    ("exacttarget", "Salesforce Marketing Cloud", Kind::Marketing),
    (
        "marketingcloud",
        "Salesforce Marketing Cloud",
        Kind::Marketing,
    ),
    ("constantcontact", "Constant Contact", Kind::Marketing),
    ("omnisend", "Omnisend", Kind::Marketing),
    ("attentive", "Attentive", Kind::Marketing),
    ("sailthru", "Sailthru", Kind::Marketing),
    ("cordial", "Cordial", Kind::Marketing),
    ("substack", "Substack", Kind::Newsletter),
    ("beehiiv", "beehiiv", Kind::Newsletter),
    ("buttondown", "Buttondown", Kind::Newsletter),
    ("convertkit", "Kit", Kind::Newsletter),
    ("ghost.io", "Ghost", Kind::Newsletter),
];

const SOCIAL_DOMAINS: &[&str] = &[
    "facebook.com",
    "facebookmail.com",
    "linkedin.com",
    "twitter.com",
    "x.com",
    "instagram.com",
    "pinterest.com",
    "reddit.com",
    "redditmail.com",
    "tiktok.com",
    "nextdoor.com",
    "quora.com",
    "tumblr.com",
    "snapchat.com",
];

/// Services whose mail is almost always about something you did
const NOTIFICATION_DOMAINS: &[&str] = &[
    "github.com",
    "gitlab.com",
    "bitbucket.org",
    "atlassian.net",
    "linear.app",
    "vercel.com",
    "circleci.com",
    "sentry.io",
    "calendar.google.com",
];

/// Headers set only on notifications
pub const NOTIFICATION_HEADERS: &[&str] =
    &["X-GitHub-Reason", "X-GitLab-Project", "X-JIRA-FingerPrint"];

const NOTIFICATION_WORDS: &[&str] = &[
    "receipt",
    "your order",
    "order #",
    "order confirmation",
    "invoice",
    "has shipped",
    "shipped",
    "delivered",
    "your code",
    "verification",
    "verify your",
    "sign-in",
    "sign in",
    "password",
    "security alert",
    "statement",
    "payment",
    "booking",
    "reservation",
    "your trip",
    "itinerary",
    "review requested",
    "pull request",
    "build failed",
    "invitation:",
];

const SOCIAL_WORDS: &[&str] = &[
    "liked your",
    "commented on",
    "mentioned you",
    "tagged you",
    "new follower",
    "followed you",
    "people you may know",
    "friend request",
    "wants to connect",
    "viewed your profile",
    "reacted to",
    "new likes",
];

const MARKETING_WORDS: &[&str] = &[
    "% off",
    "sale",
    "deal",
    "save ",
    "savings",
    "limited time",
    "last chance",
    "free shipping",
    "coupon",
    "promo",
    "discount",
    "exclusive offer",
    "new arrivals",
    "black friday",
    "cyber monday",
    "ends tonight",
    "flash",
    "don't miss",
    "shop now",
];

const NEWSLETTER_WORDS: &[&str] = &["newsletter", "digest", "weekly", "this week in", "issue #"];

/// The kind of mail, and the bulk-mail service that sent it if one is recognised
pub fn classify(s: &Signals) -> (Kind, Option<&'static str>) {
    let subject = s.subject.to_lowercase();
    let domain = s.from.rsplit('@').next().unwrap_or_default();
    let platform = [s.list_unsubscribe, s.feedback_id, s.x_mailer]
        .into_iter()
        .flatten()
        .map(str::to_lowercase)
        .find_map(|v| PLATFORMS.iter().find(|(needle, ..)| v.contains(needle)))
        .map(|&(_, name, kind)| (name, kind));

    let automated = s
        .auto_submitted
        .is_some_and(|v| !v.trim().eq_ignore_ascii_case("no"));
    let notifier = s.present.iter().any(|h| {
        NOTIFICATION_HEADERS
            .iter()
            .any(|n| n.eq_ignore_ascii_case(h))
    }) || domain_in(domain, NOTIFICATION_DOMAINS);

    let kind = if notifier {
        Kind::Notification
    } else if let Some((_, k)) = platform {
        // A marketing platform can still carry a receipt
        if k == Kind::Marketing && has_any(&subject, NOTIFICATION_WORDS) {
            Kind::Notification
        } else {
            k
        }
    } else if domain_in(domain, SOCIAL_DOMAINS) || has_any(&subject, SOCIAL_WORDS) {
        Kind::Social
    } else if has_any(&subject, NOTIFICATION_WORDS) {
        Kind::Notification
    } else if !s.bulk && !automated {
        Kind::Personal
    } else if has_any(&subject, MARKETING_WORDS) {
        Kind::Marketing
    } else if has_any(&subject, NEWSLETTER_WORDS) {
        Kind::Newsletter
    } else if automated {
        Kind::Notification
    } else {
        Kind::Bulk
    };
    (kind, platform.map(|(name, _)| name))
}

/// Any of the words, starting at a word boundary ("sale" but not "wholesale")
fn has_any(text: &str, words: &[&str]) -> bool {
    words.iter().any(|w| {
        let wordlike = w.starts_with(char::is_alphanumeric);
        text.match_indices(w).any(|(i, _)| {
            !wordlike
                || !text[..i]
                    .chars()
                    .next_back()
                    .is_some_and(char::is_alphanumeric)
        })
    })
}

/// `mail.github.com` counts as `github.com`
fn domain_in(domain: &str, list: &[&str]) -> bool {
    list.iter()
        .any(|d| domain == *d || domain.ends_with(&format!(".{d}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kind(s: Signals) -> Kind {
        classify(&s).0
    }

    #[test]
    fn github_is_a_notification_even_when_bulk() {
        let s = Signals {
            from: "notifications@github.com",
            subject: "Re: [acme/api] Fix login (PR #12)",
            bulk: true,
            list_unsubscribe: Some("<https://github.com/notifications/unsubscribe/x>"),
            present: &["X-GitHub-Reason"],
            ..Default::default()
        };
        assert_eq!(kind(s), Kind::Notification);
    }

    #[test]
    fn marketing_platforms_are_recognised() {
        let s = Signals {
            from: "hello@shop.example",
            subject: "New for fall",
            bulk: true,
            list_unsubscribe: Some("<https://manage.kmail-lists.com/klaviyo/u?x=1>"),
            ..Default::default()
        };
        assert_eq!(classify(&s), (Kind::Marketing, Some("Klaviyo")));
    }

    #[test]
    fn a_receipt_from_a_marketing_platform_is_still_a_receipt() {
        let s = Signals {
            from: "orders@shop.example",
            subject: "Your order #1234 has shipped",
            bulk: true,
            feedback_id: Some("123:mailchimp:transactional"),
            ..Default::default()
        };
        assert_eq!(kind(s), Kind::Notification);
    }

    #[test]
    fn subjects_decide_when_headers_do_not() {
        let bulk = |subject| Signals {
            from: "news@brand.example",
            subject,
            bulk: true,
            ..Default::default()
        };
        assert_eq!(
            kind(bulk("40% off everything this weekend")),
            Kind::Marketing
        );
        assert_eq!(kind(bulk("The Weekly Digest: issue #40")), Kind::Newsletter);
        assert_eq!(kind(bulk("Sam liked your photo")), Kind::Social);
        assert_eq!(kind(bulk("Hello from Brand")), Kind::Bulk);
        assert_eq!(
            kind(bulk("Our wholesale catalogue")),
            Kind::Bulk,
            "not a sale"
        );
    }

    #[test]
    fn people_are_personal() {
        let s = Signals {
            from: "mom@family.example",
            subject: "dinner sunday?",
            ..Default::default()
        };
        assert_eq!(kind(s), Kind::Personal);
    }

    #[test]
    fn social_networks_by_domain() {
        let s = Signals {
            from: "notification@facebookmail.com",
            subject: "You have new notifications",
            bulk: true,
            ..Default::default()
        };
        assert_eq!(kind(s), Kind::Social);
    }
}
