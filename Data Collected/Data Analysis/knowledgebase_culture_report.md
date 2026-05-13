# Knowledgebase Culture Analysis

Analyzed 167 `knowledgebase.txt` files.
Extracted 1415 total rules.
Found 1162 explicitly classifiable behavioral rules and 253 unclassified rules under the strict gates.
Rules may appear in multiple categories; total category mentions: 2085.

## Category Counts

- Communication: 504 (24.2%)
- Altruism: 25 (1.2%)
- Mutualism: 145 (7.0%)
- Spatial Coordination & Architecture: 306 (14.7%)
- Cultural Scientific Method - Testing & Meta-Gaming: 200 (9.6%)
- Self Preservation: 905 (43.4%)

## Transition Counts

- became less specific: 32
- became more specific: 63
- disappeared: 266
- mutated: 440
- new: 427
- persisted: 200

## Category Examples

### Communication
- 2 generationLine2 / direct / gen 2: After clearing threats, message teammate: confirm clear, report arrows remaining, signal ready for next wave.
- 2 generationLine2 / direct / gen 3: After clearing all threats (none approaching): message living teammate "Clear, X arrows left, ready for next."
- 2 generationLine2 / direct / gen 3: Always multi-action in crises; never message during fights or to dead/empty teammates.
- 2 generationLine2 / direct / gen 4: Immediately upon pickup: multi-action equip Leather Tunic to torso then Bow in hand. Do not message.
- 2 generationLine2 / direct / gen 4: Always multi-action in crises/fights; never message/do_nothing during threats or to dead teammates.

### Altruism
- 3 generationLine1 / direct / gen 3: Coordinate: one melee close threats, other bow range; cover retreating partner.
- 3 generationLine1 / direct / gen 4: Coordinate: one melee close, one bow ranged; if partner retreats follow immediately and cover from afar; never solo advance/patrol.
- 3 generationLine1 / direct / gen 5: Coordinate: one melee close threats, one bows ranged/backup; if partner attacked/retreats, cover immediately or follow; NEVER solo patrol/advance/engage.
- 7 generationLine5 / direct / gen 3: On teammate death or low health message, drop 2 bread at your feet and send: "<BotX low/down>. Dropping bread. Status: health/food, threats."
- 7 generationLine5 / direct / gen 4: On teammate low/down message: drop 2 bread at feet, message "<BotX low/down>. Bread here. Regroup at 0,0. My hp/food."

### Mutualism
- 3 generationLine1 / direct / gen 2: Communicate all attacks, plans, and status updates to partner: "Attacking [ID], cover me" or "Health low, eating."
- 3 generationLine1 / direct / gen 2: Alert partner to incoming hostiles and coordinate coverage: melee close, bow range.
- 3 generationLine1 / direct / gen 3: Attack closest hostile: melee if <5 blocks, bow if farther; communicate "Attacking [ID] [melee/bow], cover me".
- 3 generationLine1 / direct / gen 3: Coordinate: one melee close threats, other bow range; cover retreating partner.
- 3 generationLine1 / direct / gen 3: Prioritize self-heal, retreat, and partner coverage over kills; both use same safe spot.

### Spatial Coordination & Architecture
- 2 generationLine2 / direct / gen 2: When health low: eat bread until full, bow attack all approaching zombies, move to (5, 5).
- 2 generationLine2 / direct / gen 3: When health low: multi-action eat bread until full + attack all approaching zombies + move to (5, 5).
- 2 generationLine2 / direct / gen 4: When take damage or health low: multi-action eat_bread_until_full + bow attack closest zombies + move to (5, 5).
- 2 generationLine2 / direct / gen 5: When take damage or health low: multi-action eat_bread_until_full + bow_attack closest zombies if any + move to (5, 5).
- 3 generationLine1 / direct / gen 2: Move away from spawn (0,0) to x=-20 z=20 or similar safe spot when health <5 or alone.

### Cultural Scientific Method - Testing & Meta-Gaming
- 7 generationLine5 / direct / gen 2: Test when health/food full and <2 threats: Assign roles via message ("I tank, you bow") and kite one zombie while teammate attacks from range.
- 7 generationLine5 / direct / gen 3: When no threats and full health/food, test kiting: move in circle around one zombie while bow-attacking, call "Kite test: follow/melee it."
- 7 generationLine5 / direct / gen 3: Test when 2+ teammates up and <2 threats: propose "I bow range, you melee close" via message, swap roles next safe fight.
- 7 generationLine5 / direct / gen 4: When safe + full hp/food + 2+ teammates: move to (0,0), message "Regroup test at 0,0. Status clear."
- 7 generationLine5 / direct / gen 4: With teammates + <3 threats: message "Test roles: I bow range, you melee close." Swap roles next fight.

### Self Preservation
- 2 generationLine2 / direct / gen 2: Equip Leather Tunic to torso immediately upon pickup.
- 2 generationLine2 / direct / gen 2: When health low: eat bread until full, bow attack all approaching zombies, move to (5, 5).
- 2 generationLine2 / direct / gen 2: Always multi-action in crises: attack + eat + move.
- 2 generationLine2 / direct / gen 3: Immediately upon pickup: equip Leather Tunic to torso and Bow in hand.
- 2 generationLine2 / direct / gen 3: When health low: multi-action eat bread until full + attack all approaching zombies + move to (5, 5).

## Cultural Evolution Notes

- Across all runs, the dominant explicit buckets are Self Preservation (905), Communication (504), Spatial Coordination & Architecture (306).
- Self-preservation is especially visible in: 2 generationLine2; 4 generationLine2; 5 generationLine3; 6 generationLine4; 7 generationLine5; 10 generationLine1; 11 Real Run 1; 12 Real Run 1.
- Communication efficiency or restriction is especially visible in: 2 generationLine2; 3 generationLine1; 5 generationLine3; 8 generationLine6; 9 generationLine7; 12 Real Run 1; 14 Real Run 3 - 20 generations; 15 Real Run 4 - new knowlegebase prompt.
- Explicit testing/meta-gaming is concentrated in: 10 generationLine1; 13 Real Run 2 removed skills; 21 Real Run 10 - only send message and do nothing tools.
- Adjacent-generation tracking found 440 mutations, 63 rules becoming more specific, and 266 disappearances.
- Examples of increasing specificity:
  - 3 generationLine1 / gen 4: `Prioritize self-heal, retreat, and partner coverage over kills; both use same safe spot.` -> `Prioritize self-heal/eat > retreat > partner cover > kills; same safe spot x=-20 z=20.`
  - 3 generationLine1 / gen 5: `Equip leather tunic to chest and stone sword to hand immediately upon pickup, communicate "Equipped tunic/sword, [other items]" to partner.` -> `Equip leather tunic to chest and stone sword to hand immediately upon pickup, communicate "Equipped tunic/sword, [other items incl. bow/arrows]" to partner. Assign roles: "I [melee/bow], you [bow/melee]".`
  - 3 generationLine1 / gen 5: `Eat bread until full immediately upon any damage taken or health <15; combine with move/communicate.` -> `Eat bread until full if health <20, damage taken, or after kills; always combine with communicate; eat proactively when safe.`
- Strict categorization leaves purely generic combat or inventory instructions out unless the wording explicitly includes communication, aid to others, role coordination, spatial behavior, testing/meta-gaming, or individual survival.

## Output Files

- `knowledgebase_all_rules.csv`: one row per extracted rule, with blank category fields when no strict category matched.
- `knowledgebase_behavioral_rules.csv`: one row per rule-category assignment.
- `knowledgebase_rule_transitions.csv`: adjacent-generation persistence, mutation, specificity, and disappearance tracking.
- `knowledgebase_culture_summary.json`: counts by category, run, and generation.
