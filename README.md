![Project thumbnail](<assets/Thumbnail Rounded.png>)

# Problem statement:

Can a population of LLM agents in Minecraft evolve culture to facilitate cooperation and survival under environmental pressures?

## Problem description:

A population of large language model (LLM) agents is placed in a shared Minecraft world where resources are limited, and environmental hazards create ongoing survival pressure. Each agent can perceive, communicate, build, and act.

The central challenge is to determine whether culture (e.g., shared norms, conventions, roles, and knowledge transmitted through interaction) can emerge and persist in a way that measurably improves collective survival over time.

The problem requires defining environmental pressures (e.g., scarcity, hostile mobs, disasters) and specifying what counts as "culture".

## To run:
Call npm run dev

This will boot up the minecraft server and connect a bot.

The first time, the program is lauched, the server will generate a eula.txt file. This must be set to TRUE, before running the application.

## Automated generation runs:

To run multiple generation lines from `genLoopInfo.json`:

```sh
npm run genloop -- 5
```

This reads each entry in `genLoopInfo.json`, uses its models and scenario for one generation line, runs 5 generations for that line, and saves the results under folders such as `RunData/generationLine1` and `RunData/generationLine2`.
