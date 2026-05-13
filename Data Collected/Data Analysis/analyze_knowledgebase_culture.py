from __future__ import annotations

import csv
import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path


ROOT = Path(__file__).resolve().parent

CATEGORIES = [
    "Communication",
    "Altruism",
    "Mutualism",
    "Spatial Coordination & Architecture",
    "Cultural Scientific Method - Testing & Meta-Gaming",
    "Self Preservation",
]


def clean_text(text: str) -> str:
    replacements = {
        "\ufeff": "",
        "\u2013": "-",
        "\u2014": "-",
        "\u2018": "'",
        "\u2019": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u00a0": " ",
        "â€“": "-",
        "â€”": "-",
        "â€™": "'",
        "â€œ": '"',
        "â€": '"',
        "â€": '"',
        "â€˜": "'",
    }
    for src, dst in replacements.items():
        text = text.replace(src, dst)
    return re.sub(r"[ \t]+", " ", text).strip()


def read_text(path: Path) -> str:
    data = path.read_bytes()
    for enc in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def natural_key(value: str) -> list[object]:
    parts = re.split(r"(\d+)", value)
    return [int(part) if part.isdigit() else part.lower() for part in parts]


def extract_metadata(path: Path) -> dict[str, object]:
    rel_parts = path.relative_to(ROOT).parts
    generation = int(path.parent.name) if path.parent.name.isdigit() else None

    line = "direct"
    for part in rel_parts:
        if re.fullmatch(r"generationLine\d+", part, flags=re.IGNORECASE):
            line = part

    if "RunData" in rel_parts:
        run = rel_parts[0]
    elif re.search(r"generationLine\d+", rel_parts[0], flags=re.IGNORECASE):
        run = rel_parts[0]
    else:
        run = rel_parts[0]

    return {
        "run": run,
        "generation_line": line,
        "generation": generation,
        "relative_path": str(path.relative_to(ROOT)),
    }


def extract_rules(text: str) -> list[str]:
    rules: list[str] = []
    for raw_line in text.splitlines():
        line = clean_text(raw_line)
        if not line:
            continue
        line = re.sub(r"^\s*[-*]\s+", "", line)
        line = re.sub(r"^\s*\d+[.)]\s+", "", line)
        line = clean_text(line)
        if line:
            rules.append(line)
    return rules


def has_any(text: str, patterns: list[str]) -> bool:
    return any(re.search(pattern, text, flags=re.IGNORECASE) for pattern in patterns)


def classify_rule(rule: str) -> tuple[list[str], list[str]]:
    text = rule.lower()
    categories: list[str] = []
    reasons: list[str] = []

    communication = has_any(text, [
        r"\bcommunicat(e|ion|ing)?\b",
        r"\bmessage(s)?\b",
        r"\bsend\b",
        r"\balert\b",
        r"\bannounce\b",
        r"\breport\b",
        r"\btell\b",
        r"\bbroadcast\b",
        r"\bchat\b",
        r"\btext logging\b",
        r"\blogging\b",
        r"\breceivers\s*=",
    ])
    if communication:
        categories.append("Communication")
        reasons.append("explicit speaking, messaging, alerting, or communication/logging control")

    vulnerable_other = has_any(text, [
        r"\b(hurt|attacked|retreating|dying|down|trapped|vulnerable)\b.{0,20}\b(teammate|partner|ally|allies|bot\d*)\b",
        r"\bteammate health\s*[<≤]\b",
        r"\bteammate (reports )?(low health|low hp|low/down|damaged|hurt|attacked|down)\b",
        r"\bpartner health\s*[<≤]\b",
        r"\bpartner (low health|low hp|attacked|retreats?|retreating|hurt|down)\b",
        r"\bally health\s*[<≤]\b",
        r"\bally (low health|low hp|attacked|hurt|down)\b",
        r"\bbot\d* (low health|low hp|low/down|damaged|hurt|attacked|down)\b",
        r"\bhurt ally\b",
        r"\bretreating partner\b",
        r"\bpartner attacked\b",
        r"\bteammate reports low\b",
        r"\bteammate death\b",
    ])
    altruism = (
        vulnerable_other
        and has_any(text, [
            r"\b(drop|give|share|protect|save|rescue|tank|cover|shield|body-?block|pull|assist)\b",
            r"\bsend(_|\s+)\d*\+?\s*(bread|arrows|food|resources)\b",
            r"\bsend_bread\b",
            r"\bmove_to_teammate_pos\b",
            r"\bmoving to you\b",
        ])
    ) or has_any(text, [
        r"\bdrop bread\b",
        r"\bshare (food|bread|resources)\b",
        r"\bfor teammates? under\b",
        r"\bfor allies? under\b",
        r"\bprotect (a )?(hurt|low health|low hp|vulnerable) (teammate|partner|ally)\b",
        r"\bpull one hostile off a hurt ally\b",
    ])
    if altruism:
        categories.append("Altruism")
        reasons.append("explicitly protects, covers, acknowledges, or aids a teammate/ally")

    mutualism = has_any(text, [
        r"\bcoordinate\b",
        r"\bcoverage\b",
        r"\bcooperate\b",
        r"\brole(s)?\b",
        r"\bclass(es)?\b",
        r"\btank(s|ing)?\b",
        r"\b(melee close|bow range|range[d]?)\b",
        r"\bclosest .* tank",
        r"\bothers .* bow",
        r"\bsplit (the )?(group|targets|enemies)\b",
        r"\bcover me\b",
        r"\btask split",
    ])
    if mutualism:
        categories.append("Mutualism")
        reasons.append("explicit role, coverage, cooperation, or tactical task-splitting language")

    spatial = has_any(text, [
        r"\bplace (a )?blocks?\b",
        r"\bplace blocks?\b",
        r"\bbuild\b",
        r"\bpillar\b",
        r"\bbox\b",
        r"\bwall\b",
        r"\broof(ed)?\b",
        r"\benclos(ed|ure)\b",
        r"\bspawn\b",
        r"\bmove_to_coordinate\b",
        r"\bmove (away|to|in|toward|towards|back)\b",
        r"\bx\s*=\s*-?\d+",
        r"\bz\s*=\s*-?\d+",
        r"\b(stay|keep|maintain|create|have|gain) .{0,35}\d+\s*-\s*\d+\s*blocks?\b",
        r"\b(retreat|sprint|kite|back up|backing up|disengage|run) .{0,50}\d+\s*blocks?\b",
        r"\bseparation\b",
        r"\bspacing\b",
        r"\bline of sight\b",
        r"\baway from\b",
        r"\bbacking up\b",
        r"\bretreat\b",
        r"\bsprint-kite\b",
        r"\bkite\b",
        r"\bavoid allies'? paths?\b",
    ])
    if spatial:
        categories.append("Spatial Coordination & Architecture")
        reasons.append("explicit positioning, distance, retreat movement, pathing, or environment alteration")

    scientific = has_any(text, [
        r"\btest\b",
        r"\bexperiment",
        r"\badapt",
        r"\bresearch\b",
        r"\bnew_action\b",
        r"\bcustom[- ]?(defined )?action\b",
        r"\bcreate or reuse custom actions\b",
        r"\bequivalent action\b",
        r"\btool call fails\b",
        r"\bmovement .* fails\b",
        r"\bfails?, immediately\b",
        r"\breset enemy pathing\b",
        r"\bpathing\b",
        r"\bexploit\b",
        r"\bmechanic(s)?\b",
        r"\bstart of every run\b",
        r"\bsafer default\b",
    ])
    if scientific:
        categories.append("Cultural Scientific Method - Testing & Meta-Gaming")
        reasons.append("explicit testing, custom action/meta-tooling, failure recovery, or mechanics/pathing exploitation")

    teammate_only = has_any(text, [r"\b(teammate|partner|ally|allies|bot\d*)\b"]) and not has_any(text, [
        r"\bhealth\b",
        r"\bhunger\b",
        r"\beat\b",
        r"\bheal\b",
        r"\bsafe\b",
        r"\bsurvival\b",
        r"\bretreat\b",
        r"\bescape\b",
        r"\bavoid\b",
        r"\bdamage\b",
        r"\bdisengage\b",
        r"\bdanger\b",
    ])
    self_preservation = (not teammate_only) and has_any(text, [
        r"\bhealth\b",
        r"\bhunger\b",
        r"\bhp\b",
        r"\beat\b",
        r"\bheal\b",
        r"\bfood\b",
        r"\bbread\b",
        r"\bretreat\b",
        r"\bescape\b",
        r"\brun from\b",
        r"\bsprint\b",
        r"\bavoid\b",
        r"\bdamage\b",
        r"\bdanger\b",
        r"\bemergency\b",
        r"\bsafe(ly|r|st)?\b",
        r"\bsurviv(al|e)\b",
        r"\bdisengage\b",
        r"\barmor\b",
        r"\bleather tunic\b",
        r"\bleather_chestplate\b",
        r"\bdefensive\b",
        r"\bdo not engage\b",
        r"\bdo not open with melee\b",
        r"\bnever melee\b",
        r"\bmelee only when\b",
        r"\bkeep distance\b",
        r"\bmaintain distance\b",
        r"\bkite\b",
        r"\bcreepers?\b",
        r"\bskeletons?\b",
        r"\bprioritize .* over attacking\b",
        r"\bprioritize .* over chasing\b",
        r"\bfully enclosed\b",
        r"\bfully healed\b",
    ])
    if self_preservation:
        categories.append("Self Preservation")
        reasons.append("explicit individual health, escape, healing, safety, defensive gear, or risk-avoidance language")

    return categories, reasons


def normalize_rule(rule: str) -> str:
    text = clean_text(rule).lower()
    text = re.sub(r"[^a-z0-9<>=]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def specificity_score(rule: str) -> int:
    tokens = re.findall(r"[A-Za-z0-9_<>=]+", rule)
    numbers = re.findall(r"\d+", rule)
    conditions = len(re.findall(r"\b(if|when|only|unless|until|after|before|below|above|within|between)\b", rule, flags=re.IGNORECASE))
    return len(tokens) + 3 * len(numbers) + 5 * conditions


@dataclass
class RuleRecord:
    rule_id: str
    run: str
    generation_line: str
    generation: int | None
    relative_path: str
    rule_index: int
    rule_text: str
    normalized_rule: str
    categories: list[str]
    reasons: list[str]


def build_records() -> list[RuleRecord]:
    records: list[RuleRecord] = []
    paths = sorted(ROOT.rglob("knowledgebase.txt"), key=lambda p: [natural_key(part) for part in p.relative_to(ROOT).parts])
    for path in paths:
        meta = extract_metadata(path)
        rules = extract_rules(read_text(path))
        for idx, rule in enumerate(rules, start=1):
            categories, reasons = classify_rule(rule)
            generation = meta["generation"]
            generation_text = str(generation) if generation is not None else "NA"
            rule_id = f"{len(records) + 1:05d}"
            records.append(RuleRecord(
                rule_id=rule_id,
                run=str(meta["run"]),
                generation_line=str(meta["generation_line"]),
                generation=generation if isinstance(generation, int) else None,
                relative_path=str(meta["relative_path"]),
                rule_index=idx,
                rule_text=rule,
                normalized_rule=normalize_rule(rule),
                categories=categories,
                reasons=reasons,
            ))
    return records


def all_rule_rows(records: list[RuleRecord]) -> list[dict[str, object]]:
    return [
        {
            "rule_id": rec.rule_id,
            "run": rec.run,
            "generation_line": rec.generation_line,
            "generation": rec.generation,
            "relative_path": rec.relative_path,
            "rule_index": rec.rule_index,
            "categories": "|".join(rec.categories),
            "rule_text": rec.rule_text,
            "classification_reason": "; ".join(rec.reasons),
        }
        for rec in records
    ]


def category_rows(records: list[RuleRecord]) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for rec in records:
        for category in rec.categories:
            rows.append({
                "rule_id": rec.rule_id,
                "run": rec.run,
                "generation_line": rec.generation_line,
                "generation": rec.generation,
                "relative_path": rec.relative_path,
                "rule_index": rec.rule_index,
                "category": category,
                "rule_text": rec.rule_text,
                "classification_reason": "; ".join(rec.reasons),
            })
    return rows


def compare_generations(records: list[RuleRecord]) -> list[dict[str, object]]:
    by_track: dict[tuple[str, str], dict[int, list[RuleRecord]]] = defaultdict(lambda: defaultdict(list))
    for rec in records:
        if rec.generation is None:
            continue
        by_track[(rec.run, rec.generation_line)][rec.generation].append(rec)

    transitions: list[dict[str, object]] = []
    for (run, line), by_generation in by_track.items():
        generations = sorted(by_generation)
        previous: list[RuleRecord] = []
        for gen in generations:
            current = by_generation[gen]
            if not previous:
                for rec in current:
                    transitions.append({
                        "run": run,
                        "generation_line": line,
                        "generation": gen,
                        "rule_id": rec.rule_id,
                        "status": "new",
                        "matched_previous_rule_id": "",
                        "similarity": "",
                        "category": "|".join(rec.categories),
                        "rule_text": rec.rule_text,
                        "previous_rule_text": "",
                    })
                previous = current
                continue

            matched_previous: set[str] = set()
            for rec in current:
                best_prev: RuleRecord | None = None
                best_score = 0.0
                for prev in previous:
                    if not set(rec.categories).intersection(prev.categories):
                        continue
                    score = SequenceMatcher(None, rec.normalized_rule, prev.normalized_rule).ratio()
                    if score > best_score:
                        best_score = score
                        best_prev = prev

                if best_prev is not None and rec.normalized_rule == best_prev.normalized_rule:
                    status = "persisted"
                    matched_previous.add(best_prev.rule_id)
                elif best_prev is not None and best_score >= 0.58:
                    if specificity_score(rec.rule_text) > specificity_score(best_prev.rule_text) + 8:
                        status = "became more specific"
                    elif specificity_score(best_prev.rule_text) > specificity_score(rec.rule_text) + 8:
                        status = "became less specific"
                    else:
                        status = "mutated"
                    matched_previous.add(best_prev.rule_id)
                else:
                    status = "new"

                transitions.append({
                    "run": run,
                    "generation_line": line,
                    "generation": gen,
                    "rule_id": rec.rule_id,
                    "status": status,
                    "matched_previous_rule_id": best_prev.rule_id if best_prev and status != "new" else "",
                    "similarity": round(best_score, 3) if best_prev and status != "new" else "",
                    "category": "|".join(rec.categories),
                    "rule_text": rec.rule_text,
                    "previous_rule_text": best_prev.rule_text if best_prev and status != "new" else "",
                })

            for prev in previous:
                if prev.rule_id not in matched_previous:
                    transitions.append({
                        "run": run,
                        "generation_line": line,
                        "generation": gen,
                        "rule_id": "",
                        "status": "disappeared",
                        "matched_previous_rule_id": prev.rule_id,
                        "similarity": "",
                        "category": "|".join(prev.categories),
                        "rule_text": "",
                        "previous_rule_text": prev.rule_text,
                    })
            previous = current
    return transitions


def summarize(records: list[RuleRecord], transitions: list[dict[str, object]]) -> dict[str, object]:
    classified = [rec for rec in records if rec.categories]
    cat_counts = Counter()
    for rec in classified:
        cat_counts.update(rec.categories)

    per_run = defaultdict(Counter)
    per_generation = defaultdict(Counter)
    for rec in classified:
        for category in rec.categories:
            per_run[rec.run][category] += 1
            per_generation[(rec.run, rec.generation_line, rec.generation)][category] += 1

    transition_counts = Counter(row["status"] for row in transitions)

    return {
        "files_analyzed": len(list(ROOT.rglob("knowledgebase.txt"))),
        "total_extracted_rules": len(records),
        "classified_rules": len(classified),
        "unclassified_rules": len(records) - len(classified),
        "category_mentions": sum(cat_counts.values()),
        "category_counts": dict(cat_counts),
        "transition_counts": dict(transition_counts),
        "per_run_counts": {run: dict(counts) for run, counts in sorted(per_run.items(), key=lambda x: natural_key(x[0]))},
        "per_generation_counts": {
            f"{run} | {line} | gen {gen}": dict(counts)
            for (run, line, gen), counts in sorted(
                per_generation.items(),
                key=lambda x: (natural_key(x[0][0]), natural_key(x[0][1]), x[0][2] if x[0][2] is not None else -1),
            )
        },
    }


def write_csv(path: Path, rows: list[dict[str, object]], fieldnames: list[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def sample_rules(records: list[RuleRecord], category: str, limit: int = 5) -> list[RuleRecord]:
    seen: set[str] = set()
    samples: list[RuleRecord] = []
    for rec in records:
        if category in rec.categories and rec.normalized_rule not in seen:
            samples.append(rec)
            seen.add(rec.normalized_rule)
        if len(samples) >= limit:
            break
    return samples


def write_report(records: list[RuleRecord], transitions: list[dict[str, object]], summary: dict[str, object]) -> None:
    lines: list[str] = []
    lines.append("# Knowledgebase Culture Analysis")
    lines.append("")
    lines.append(f"Analyzed {summary['files_analyzed']} `knowledgebase.txt` files.")
    lines.append(f"Extracted {summary['total_extracted_rules']} total rules.")
    lines.append(f"Found {summary['classified_rules']} explicitly classifiable behavioral rules and {summary['unclassified_rules']} unclassified rules under the strict gates.")
    lines.append(f"Rules may appear in multiple categories; total category mentions: {summary['category_mentions']}.")
    lines.append("")
    lines.append("## Category Counts")
    lines.append("")
    category_mentions = max(int(summary["category_mentions"]), 1)
    for category in CATEGORIES:
        count = summary["category_counts"].get(category, 0)
        percentage = count / category_mentions * 100
        lines.append(f"- {category}: {count} ({percentage:.1f}%)")
    lines.append("")
    lines.append("## Transition Counts")
    lines.append("")
    for status, count in sorted(summary["transition_counts"].items()):
        lines.append(f"- {status}: {count}")
    lines.append("")
    lines.append("## Category Examples")
    lines.append("")
    for category in CATEGORIES:
        lines.append(f"### {category}")
        for rec in sample_rules(records, category):
            lines.append(f"- {rec.run} / {rec.generation_line} / gen {rec.generation}: {rec.rule_text}")
        lines.append("")

    lines.append("## Cultural Evolution Notes")
    lines.append("")
    lines.extend(build_evolution_notes(summary, transitions))
    lines.append("")
    lines.append("## Output Files")
    lines.append("")
    lines.append("- `knowledgebase_all_rules.csv`: one row per extracted rule, with blank category fields when no strict category matched.")
    lines.append("- `knowledgebase_behavioral_rules.csv`: one row per rule-category assignment.")
    lines.append("- `knowledgebase_rule_transitions.csv`: adjacent-generation persistence, mutation, specificity, and disappearance tracking.")
    lines.append("- `knowledgebase_culture_summary.json`: counts by category, run, and generation.")
    lines.append("")
    (ROOT / "knowledgebase_culture_report.md").write_text("\n".join(lines), encoding="utf-8")


def build_evolution_notes(summary: dict[str, object], transitions: list[dict[str, object]]) -> list[str]:
    notes: list[str] = []
    counts = summary["category_counts"]
    total_mentions = max(int(summary["category_mentions"]), 1)
    ordered = sorted(CATEGORIES, key=lambda c: counts.get(c, 0), reverse=True)
    top = ordered[:3]
    notes.append(
        "- Across all runs, the dominant explicit buckets are "
        + ", ".join(f"{cat} ({counts.get(cat, 0)})" for cat in top)
        + "."
    )

    run_self = []
    run_comm = []
    run_science = []
    for run, cats in summary["per_run_counts"].items():
        mentions = max(sum(cats.values()), 1)
        if cats.get("Self Preservation", 0) / mentions >= 0.35:
            run_self.append(run)
        if cats.get("Communication", 0) / mentions >= 0.25:
            run_comm.append(run)
        if cats.get("Cultural Scientific Method - Testing & Meta-Gaming", 0) / mentions >= 0.20:
            run_science.append(run)

    if run_self:
        notes.append("- Self-preservation is especially visible in: " + "; ".join(run_self[:8]) + ".")
    if run_comm:
        notes.append("- Communication efficiency or restriction is especially visible in: " + "; ".join(run_comm[:8]) + ".")
    if run_science:
        notes.append("- Explicit testing/meta-gaming is concentrated in: " + "; ".join(run_science[:8]) + ".")

    specific = [row for row in transitions if row["status"] == "became more specific"]
    mutated = [row for row in transitions if row["status"] == "mutated"]
    disappeared = [row for row in transitions if row["status"] == "disappeared"]
    notes.append(
        f"- Adjacent-generation tracking found {len(mutated)} mutations, {len(specific)} rules becoming more specific, and {len(disappeared)} disappearances."
    )

    if specific:
        examples = specific[:3]
        notes.append("- Examples of increasing specificity:")
        for row in examples:
            notes.append(
                f"  - {row['run']} / gen {row['generation']}: `{row['previous_rule_text']}` -> `{row['rule_text']}`"
            )

    notes.append(
        "- Strict categorization leaves purely generic combat or inventory instructions out unless the wording explicitly includes communication, aid to others, role coordination, spatial behavior, testing/meta-gaming, or individual survival."
    )
    return notes


def main() -> None:
    records = build_records()
    classified_records = [rec for rec in records if rec.categories]
    rows = category_rows(classified_records)
    transitions = compare_generations(classified_records)
    summary = summarize(records, transitions)

    write_csv(
        ROOT / "knowledgebase_all_rules.csv",
        all_rule_rows(records),
        [
            "rule_id",
            "run",
            "generation_line",
            "generation",
            "relative_path",
            "rule_index",
            "categories",
            "rule_text",
            "classification_reason",
        ],
    )
    write_csv(
        ROOT / "knowledgebase_behavioral_rules.csv",
        rows,
        [
            "rule_id",
            "run",
            "generation_line",
            "generation",
            "relative_path",
            "rule_index",
            "category",
            "rule_text",
            "classification_reason",
        ],
    )
    write_csv(
        ROOT / "knowledgebase_rule_transitions.csv",
        transitions,
        [
            "run",
            "generation_line",
            "generation",
            "rule_id",
            "status",
            "matched_previous_rule_id",
            "similarity",
            "category",
            "rule_text",
            "previous_rule_text",
        ],
    )
    (ROOT / "knowledgebase_culture_summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    write_report(classified_records, transitions, summary)

    print(f"Analyzed {summary['files_analyzed']} files")
    print(f"Extracted {summary['total_extracted_rules']} total rules")
    print(f"Classified {summary['classified_rules']} rules")
    print(f"Left {summary['unclassified_rules']} unclassified under strict gates")
    for category in CATEGORIES:
        print(f"{category}: {summary['category_counts'].get(category, 0)}")
    print("Wrote knowledgebase_behavioral_rules.csv")
    print("Wrote knowledgebase_rule_transitions.csv")
    print("Wrote knowledgebase_culture_summary.json")
    print("Wrote knowledgebase_culture_report.md")


if __name__ == "__main__":
    main()
    print("Wrote knowledgebase_all_rules.csv")
