#!/usr/bin/env python3
"""Reset a test IMAP account and fill it with a known mailbox.

Usage: seed_imap.py HOST PORT USER PASSWORD

Only point this at a throwaway test account: it deletes everything in
INBOX, Sent and Trash first.
"""
import imaplib
import sys
import time
from email.utils import format_datetime
from datetime import datetime, timedelta, timezone

host, port, user, password = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
now = datetime.now(timezone.utc)


def message(frm, subject, days_old, n, *, unsub=None, one_click=False, list_id=None, msg_id=True, to="me@test.example"):
    lines = [
        f"From: {frm}",
        f"To: {to}",
        f"Subject: {subject}",
        f"Date: {format_datetime(now - timedelta(days=days_old))}",
    ]
    if msg_id:
        lines.append(f"Message-ID: <{n}.{abs(hash(frm)) % 10**8}@seed.test>")
    if unsub:
        lines.append(f"List-Unsubscribe: {unsub}")
    if one_click:
        lines.append("List-Unsubscribe-Post: List-Unsubscribe=One-Click")
    if list_id:
        lines.append(f"List-Id: {list_id}")
    lines += ["Content-Type: text/plain; charset=utf-8", "", f"Body of message {n}.", ""]
    return "\r\n".join(lines).encode()


m = imaplib.IMAP4(host, port)
m.login(user, password)

for folder in ("INBOX", "Sent", "Trash"):
    typ, data = m.select(folder)
    if int(data[0]) > 0:
        m.store("1:*", "+FLAGS.SILENT", r"(\Deleted)")
        m.expunge()


def append(folder, raw, flags=""):
    date = imaplib.Time2Internaldate(time.time())
    typ, _ = m.append(folder, flags, date, raw)
    assert typ == "OK", typ


n = 0
# 30 from ShopMart: 1-click unsubscribe; one starred, one recent, one about taxes, one without Message-ID
for i in range(30):
    n += 1
    kwargs = dict(unsub="<https://shopmart.test/u/1>, <mailto:leave@shopmart.test>", one_click=True)
    if i == 0:
        append("INBOX", message('"ShopMart" <deals@shopmart.test>', "Starred deal", 90, n, **kwargs), r"(\Flagged)")
    elif i == 1:
        append("INBOX", message('"ShopMart" <deals@shopmart.test>', "Flash sale today", 2, n, **kwargs))
    elif i == 2:
        append("INBOX", message('"ShopMart" <deals@shopmart.test>', "Your tax-free weekend receipt", 90, n, **kwargs))
    elif i == 3:
        append("INBOX", message('"ShopMart" <deals@shopmart.test>', "No id here", 90, n, msg_id=False, **kwargs))
    else:
        append("INBOX", message('"ShopMart" <deals@shopmart.test>', f"Deal #{i}", 30 + i, n, **kwargs), r"(\Seen)" if i % 10 == 0 else "")

# 20 from SocialNet with a List-Id and a web-only unsubscribe link
for i in range(20):
    n += 1
    append("INBOX", message("SocialNet <notify@socialnet.test>", f"You have {i} new likes", 20 + i, n,
                            unsub="<https://socialnet.test/prefs>", list_id="<notify.socialnet.test>"))

# 10 from a newsletter with mailto unsubscribe; one you replied to
for i in range(10):
    n += 1
    raw = message("The Daily Brief <digest@dailybrief.test>", f"Issue {i}", 40 + i, n, unsub="<mailto:leave@dailybrief.test>")
    append("INBOX", raw, r"(\Seen \Answered)" if i == 0 else r"(\Seen)")

# 5 from Mom, who you write to
for i in range(5):
    n += 1
    append("INBOX", message("Mom <mom@family.test>", f"Dinner {i}?", 50 + i, n), r"(\Seen)")

# Sent mail to Mom teaches the app she is a correspondent
n += 1
append("Sent", message("Me <me@test.example>", "Re: Dinner?", 45, n, to="Mom <mom@family.test>"), r"(\Seen)")

m.logout()
print(f"seeded {n} messages")
