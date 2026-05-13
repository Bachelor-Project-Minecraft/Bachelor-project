import csv
import json
import re
from collections import Counter, defaultdict
from pathlib import Path


CATEGORIES = [
    "Altruistic_Collaboration",
    "Mutualistic_Collaboration",
    "Self_Preservation",
    "Cultural_Transmission",
    "Shared_Context",
]

ROOT = Path(__file__).resolve().parent
MESSAGE_RE = re.compile(r"^(Bot[12]) <MESSAGE>:\s*(.*)$", re.S)


def clean_text(text):
    return re.sub(r"\s+", " ", text).strip()


def has(pattern, text):
    return re.search(pattern, text, re.I) is not None


def classify_message(text):
    """Classify one received inter-agent message.

    The order is intentional:
    1. explicit teaching / learned mechanics,
    2. explicit sacrifice or resource transfer,
    3. individual survival,
    4. strict role/task coordination,
    5. environmental/status broadcast.
    """
    t = clean_text(text)

    cultural_patterns = [
        r"\bknowledge suggests\b",
        r"\btactics?:\b",
        r"\buse kneel_and_defend\b",
        r"\bdefend_from_multiple_hosts\b",
        r"\bkneel(?:ing)?\b",
        r"\btest(?:ing)? the 6-8 block spacing\b",
        r"\b6-8 block spacing\b",
        r"\bflat world with no natural cover\b",
        r"\bspawn(?:ing)? timers?\b",
        r"\beat bread if health drops below\b",
    ]
    if any(has(p, t) for p in cultural_patterns):
        return (
            "Cultural_Transmission",
            "Contains explicit learned/mechanical guidance intended to change future behavior.",
            "high",
        )

    if has(r"\bcollecting .*dropped bread\b", t) or has(r"\bgot the bread thanks\b", t):
        return (
            "Self_Preservation",
            "Primary intent is recovery by consuming or collecting food while vulnerable.",
            "high",
        )

    altruistic_patterns = [
        r"\bdropp(?:ing|ed)?\s+(?:\d+\s+)?bread\b",
        r"\bbread\s+dropp(?:ing|ed)?\b",
        r"\bbread for you\b",
        r"\bdropping\s+\d+\s+bread for you\b",
        r"\bsending bread\b",
        r"\bi have bread\b.*\bcan i share\b",
        r"\bsend some\b.*\bbread\b",
        r"\bcan send some\b.*\b(?:you|recovery|bread)\b",
        r"\bshare\b.*\bbread\b",
        r"\bfeed you\b",
        r"\bdropping\s+\d+\s+planks\b",
        r"\buse my\s+\d+\s+oak planks\b",
        r"\bprotect you\b",
        r"\bmoving to cover\b",
        r"\bcovering you\b",
        r"\bcover you\b.*\bwhile you\b",
        r"\bdistract melee\b",
        r"\bkiting .* away from you\b",
        r"\bavoid dragging them into your\b",
        r"\byou recover,\s*i (?:take|guard)\b",
        r"\bbread available\b.*\beat to heal\b",
    ]
    if any(has(p, t) for p in altruistic_patterns):
        return (
            "Altruistic_Collaboration",
            "Primary intent gives up resources or accepts extra combat risk for the teammate.",
            "high",
        )

    self_preservation_patterns = [
        r"\bmy health\b.*\b(?:low|critical|dropped|recover|healing|eating|retreat)",
        r"\bown health\b.*\b(?:low|critical)",
        r"\bhealth(?: is)?\s*(?:low|critical)\b",
        r"\bhealth\s+(?:[0-9](?:\.\d+)?|1[01](?:\.\d+)?)(?:/20)?\b.*\b(?:low|critical|eating|retreat|heal|recover)",
        r"\bhealth at\s+(?:[0-9](?:\.\d+)?|1[01](?:\.\d+)?)(?:/20)?\b.*\b(?:low|critical|eating|retreat|heal|recover|kiting)",
        r"\bhealth down to\b.*\b(?:eating|recover|heal)",
        r"\b(?:hp|health)\s*(?:low|critical)\b",
        r"\blow\s*(?:hp|health)\b",
        r"\blow on health\b",
        r"\bcritical(?:ly)? low\b",
        r"\bnearly dead\b",
        r"^(?:i'?m\s+)?eating bread\b",
        r"\b(?:my|i'?m|i am)\b.*\beating\b.*\bbread\b",
        r"^healing with bread\b",
        r"\bhealth\s+\d+(?:\.\d+)?(?:/20)?\b.*\beating\b",
        r"\bbread consumed\b",
        r"\bneed bread\b",
        r"\bhealth dropped to\b",
        r"\bi'?ll eat\b.*\bbread\b",
        r"\bate\s+\d+\s+bread\b",
        r"\btook damage\b.*\bate\b.*\bbread\b",
        r"^eating until full\b",
        r"\beating more bread\b",
        r"\bstill need to eat\b",
        r"\bheal first\b",
        r"\brehealing\b",
        r"\bsafe now\b.*\bbread\b.*\bneed\b",
        r"\bpanic[- ]?eat\b",
        r"\bi (?:took|have taken).*damage\b.*\b(?:eating|recover|heal|retreat|need)",
        r"\bdisengaging\b",
        r"\bretreat(?:ing)?\b",
        r"\bkiting back\b",
        r"\bkite\b.*\b(?:to heal|away|back|space)\b",
        r"\bneed cover\b",
        r"\bhelp me defend\b",
        r"\bstay alive\b",
        r"\bno attacks until safe\b",
        r"\bmove away from spawn zone\b",
        r"\bsafe zone\b",
    ]
    if any(has(p, t) for p in self_preservation_patterns):
        return (
            "Self_Preservation",
            "Primary intent is survival behavior such as healing, retreating, kiting, or requesting cover while vulnerable.",
            "high",
        )

    mutualistic_patterns = [
        r"\byou (?:take|handle|focus|kite|melee|cover|shoot|prepare|watch|hold|build|move|attack)\b.*\b(?:i|i'll|im|i'm|me)\b",
        r"\b(?:i|i'll|im|i'm)\b.*\byou (?:take|handle|focus|kite|melee|cover|shoot|prepare|watch|hold|build|move|attack)\b",
        r"\bcover me\b",
        r"\bcovering as you scout\b",
        r"\bcover fire\b",
        r"\bprovide (?:bow )?cover\b",
        r"\bbackup with bow\b",
        r"\bi melee\b.*\byou\b",
        r"\byou melee\b.*\bi\b",
        r"\bmelee close\b.*\bkite\b",
        r"\bkite from bow range\b.*\bmelee\b",
        r"\bbot1 will melee\b.*\bbot2 will kite\b",
        r"\bwill tank melee\b.*\bkite\b",
        r"\bhandle melee\b",
        r"\bcan tank melee\b.*\bbow support\b",
        r"\bi'?ll tank melee\b.*\byou bow\b",
        r"\bbot[12]\s+attack\b.*\bi'?ll handle\b",
        r"\bbot[12]\s+(?:cover|attack|handle|kite|bow)\b",
        r"\bbot[12]\s+can bow\b",
        r"\bi take\b.*\bbot[12]\b",
        r"^i take\b",
        r"\bbot[12]\b.*\bhandle\b.*\bi'?ll\b",
        r"\brole:\s*(?:melee tank|bow kiter)\b",
        r"\bbow kiter\b",
        r"\bmelee tank\b.*\bbow kiter\b",
        r"\bassign(?:ing)? roles?\b",
        r"\bestablish roles\b",
        r"\battack/defense roles\b",
        r"\bfocus(?:ing)? fire\b",
        r"\bfocus on (?:zombie|id|the closest|remaining)\b",
        r"\bcoordinated attacks\b",
        r"\bcoordinate(?:d| your)? (?:attack|fight|defense|movement|positions|responses|roles)\b",
        r"\bcoordinate our positions\b",
        r"\bcover each other\b",
        r"\bi provide ranged cover\b",
        r"\bbow on\b.*\bbot[12] handle\b",
        r"\bcovering\b.*\bbot[12]\b",
        r"\buse bow\b.*\bi'?ll move closer\b",
        r"\bstand back\b.*\bi'?ll melee\b.*\byou bow\b",
        r"\bi melee close\b.*\bbot[12] bow\b",
        r"\btogether\b.*\b(?:build|wall|shelter|base|barricade|defensive position|engage|attack|retreat)\b",
        r"\bbuild\b.*\btogether\b",
        r"\bwall together\b",
        r"\bmeet\b.*\bbuild shelter\b",
        r"\bhealth full,\s*meet\b",
        r"\bfinish building\b.*\btogether\b",
        r"\badding my blocks\b",
        r"\bjoin me\b.*\breinforce\b",
        r"\breinforce the defensive wall\b",
        r"\bholds? the wall\b",
        r"\bdefensive wall\b.*\bi'll\b",
        r"\bi'll start building\b",
        r"\bi'll help\b.*\bconstruction\b",
        r"\bkiting to let you engage\b",
        r"\byou're free to kite\b.*\bi'll handle\b",
        r"\bstay close\b.*\bi'll handle\b",
        r"\bsplit aggro\b",
        r"\bpair up\b",
        r"\bscout\b.*\bcover\b",
        r"\bcover\b.*\bscout\b",
        r"\bwill help (?:finish|when)\b",
    ]
    if any(has(p, t) for p in mutualistic_patterns):
        return (
            "Mutualistic_Collaboration",
            "Contains task/role coordination where both agents benefit without clear unilateral sacrifice.",
            "high",
        )

    return (
        "Shared_Context",
        "Broadcasts status, inventory, health, positions, clear state, or threat information without task division.",
        "medium",
    )


def iter_received_messages():
    for path in sorted(ROOT.rglob("Bot*.json")):
        if path.parent.name != "logs":
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        receiver = data.get("agentName") or path.stem
        for idx, msg in enumerate(data.get("messages", [])):
            if msg.get("role") != "user":
                continue
            match = MESSAGE_RE.match(msg.get("content", ""))
            if not match:
                continue
            sender, text = match.groups()
            yield {
                "source_file": str(path.relative_to(ROOT)),
                "receiver": receiver,
                "sender": sender,
                "message_index": idx,
                "message": clean_text(text),
            }


def main():
    rows = []
    for row in iter_received_messages():
        category, reason, confidence = classify_message(row["message"])
        row["category"] = category
        row["reason"] = reason
        row["confidence"] = confidence
        rows.append(row)

    csv_path = ROOT / "agent_message_classification.csv"
    with csv_path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(
            fh,
            fieldnames=[
                "source_file",
                "receiver",
                "sender",
                "message_index",
                "category",
                "confidence",
                "reason",
                "message",
            ],
        )
        writer.writeheader()
        writer.writerows(rows)

    by_category = Counter(row["category"] for row in rows)
    by_sender_category = defaultdict(Counter)
    by_run_category = defaultdict(Counter)
    examples = defaultdict(list)

    for row in rows:
        by_sender_category[row["sender"]][row["category"]] += 1
        top_folder = Path(row["source_file"]).parts[0]
        by_run_category[top_folder][row["category"]] += 1
        if len(examples[row["category"]]) < 8:
            examples[row["category"]].append(
                {
                    "sender": row["sender"],
                    "receiver": row["receiver"],
                    "message": row["message"],
                    "source_file": row["source_file"],
                    "message_index": row["message_index"],
                }
            )

    summary = {
        "total_received_messages": len(rows),
        "total_primary_log_files": len(
            [p for p in ROOT.rglob("Bot*.json") if p.parent.name == "logs"]
        ),
        "category_counts": {cat: by_category.get(cat, 0) for cat in CATEGORIES},
        "category_percentages": {
            cat: round((by_category.get(cat, 0) / len(rows)) * 100, 2) if rows else 0
            for cat in CATEGORIES
        },
        "sender_category_counts": {
            sender: {cat: counts.get(cat, 0) for cat in CATEGORIES}
            for sender, counts in sorted(by_sender_category.items())
        },
        "run_category_counts": {
            run: {cat: counts.get(cat, 0) for cat in CATEGORIES}
            for run, counts in sorted(by_run_category.items())
        },
        "examples": {cat: examples.get(cat, []) for cat in CATEGORIES},
    }

    summary_path = ROOT / "agent_message_classification_summary.json"
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(f"Wrote {csv_path.name}")
    print(f"Wrote {summary_path.name}")
    print(json.dumps(summary["category_counts"], indent=2))


if __name__ == "__main__":
    main()
