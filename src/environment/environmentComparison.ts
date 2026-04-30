import type {
	EnvironmentChangeStep,
	EnvironmentSnapshot,
	SnapshotEntity,
	SnapshotInventoryItem,
} from "./types"

export function compareEnvironmentSnapshots(
	previous: EnvironmentSnapshot,
	current: EnvironmentSnapshot,
): EnvironmentChangeStep[] {
	const steps: EnvironmentChangeStep[] = []
	const criticalHealthThreshold = 8
	const closeThreatThreshold = 3
	const significantDistanceDelta = 1

	addThreatSteps(
		steps,
		previous.nearby.hostiles,
		current.nearby.hostiles,
		{
			removedTitle: "The following hostile mobs are no longer a threat:",
			detectedTitleSingle: "A new hostile mob is approaching:",
			detectedTitleMultiple: "Multiple new hostile mobs are approaching:",
			formatThreatName: (threat) => `${threat.name} id ${threat.id}`,
		},
		closeThreatThreshold,
		significantDistanceDelta,
	)

	addThreatSteps(
		steps,
		previous.nearby.dangers,
		current.nearby.dangers,
		{
			removedTitle: "Nearby TNT is no longer a threat:",
			detectedTitleSingle: "New TNT is nearby:",
			detectedTitleMultiple: "Multiple TNT blocks are nearby:",
			formatThreatName: (threat) =>
				`TNT at ${threat.position.x}, ${threat.position.y}, ${threat.position.z}`,
		},
		closeThreatThreshold,
		significantDistanceDelta,
	)

	if (current.health < previous.health - 4) {
		const healthLoss = previous.health - current.health
		steps.push({
			title:
				current.health <= criticalHealthThreshold
					? "My health is low!"
					: "I just took damage.",
			details: [
				`- Health changed from ${previous.health.toFixed(1)} to ${current.health.toFixed(1)} (${healthLoss.toFixed(1)} lost)`,
			],
			shouldTriggerPrompt:
				current.health <= criticalHealthThreshold
					? true
					: false,
		})
	}

	const inventoryDiff = diffInventory(
		[...previous.inventory.items, ...previous.inventory.equipped],
		[...current.inventory.items, ...current.inventory.equipped],
	)
	if (inventoryDiff.pickedUp.length > 0) {
		steps.push({
			title: "I have picked up:",
			details: inventoryDiff.pickedUp.map((item) => `- ${item.delta} ${item.name}`),
			shouldTriggerPrompt: true,
		})
	}

	if (inventoryDiff.usedOrLost.length > 0) {
		steps.push({
			title: "I used or lost:",
			details: inventoryDiff.usedOrLost.map(
				(item) => `- ${item.delta} ${item.name}`,
			),
			shouldTriggerPrompt: false,
		})
	}

	const currentPlayerNames = new Set(current.allPlayers.map((player) => player.name))
	const deadPlayers = previous.allPlayers.filter(
		(player) => !currentPlayerNames.has(player.name),
	)

	if (deadPlayers.length > 0) {
		steps.push({
			title:
				deadPlayers.length === 1
					? "Another player has died:"
					: "Other players have died:",
			details: deadPlayers.map((player) => `- ${player.name}`),
			shouldTriggerPrompt: false,
		})
	}

	return steps
}

export function toEntityMap(
	entities: SnapshotEntity[],
): Map<string | number, SnapshotEntity> {
	return new Map(entities.map((entity) => [entity.id, entity]))
}

function addThreatSteps(
	steps: EnvironmentChangeStep[],
	previousThreats: SnapshotEntity[],
	currentThreats: SnapshotEntity[],
	labels: {
		removedTitle: string
		detectedTitleSingle: string
		detectedTitleMultiple: string
		formatThreatName: (threat: SnapshotEntity) => string
	},
	closeThreatThreshold: number,
	significantDistanceDelta: number,
) {
	const previousThreatMap = toEntityMap(previousThreats)
	const currentThreatMap = toEntityMap(currentThreats)
	
	const removedThreats = previousThreats.filter(
		(threat) => !currentThreatMap.has(threat.id),
	)

	const addedThreats = currentThreats.filter(
		(threat) => !previousThreatMap.has(threat.id),
	)

	const movedCloserThreats = currentThreats.flatMap((threat) => {
		const previousThreat = previousThreatMap.get(threat.id)
		if (!previousThreat) {
			return []
		}

		const distanceDelta = previousThreat.distance - threat.distance
		if (distanceDelta < significantDistanceDelta) {
			return []
		}

		return [
			`- ${labels.formatThreatName(threat)} moved from ${previousThreat.distance.toFixed(1)} to ${threat.distance.toFixed(1)} blocks away`,
		]
	})

	if (removedThreats.length > 0) {
		steps.push({
			title: labels.removedTitle,
			details: removedThreats.map(
				(threat) => `- ${labels.formatThreatName(threat)}`,
			),
			shouldTriggerPrompt: true,
		})
	}

	if (addedThreats.length > 0) {
		steps.push({
			title:
				addedThreats.length === 1
					? labels.detectedTitleSingle
					: labels.detectedTitleMultiple,
			details: addedThreats.map(
				(threat) =>
					`- ${labels.formatThreatName(threat)} is ${threat.distance.toFixed(1)} blocks away`,
			),
			shouldTriggerPrompt: true,
		})
	}
}

export function diffInventory(
	previous: SnapshotInventoryItem[],
	current: SnapshotInventoryItem[],
) {
	const toTotals = (items: SnapshotInventoryItem[]) => {
		const totals = new Map<string, number>()
		for (const item of items) {
			const key = item.displayName || item.name
			const existing = totals.get(key) ?? 0
			totals.set(key, existing + item.count)
		}
		return totals
	}

	const previousTotals = toTotals(previous)
	const currentTotals = toTotals(current)
	const allNames = new Set([...previousTotals.keys(), ...currentTotals.keys()])

	const pickedUp: Array<{ name: string; delta: number }> = []
	const usedOrLost: Array<{ name: string; delta: number }> = []

	for (const name of allNames) {
		const previousCount = previousTotals.get(name) ?? 0
		const currentCount = currentTotals.get(name) ?? 0
		const delta = currentCount - previousCount

		if (delta > 0) {
			pickedUp.push({ name, delta })
		}

		if (delta < 0) {
			usedOrLost.push({ name, delta: Math.abs(delta) })
		}
	}

	return { pickedUp, usedOrLost }
}
