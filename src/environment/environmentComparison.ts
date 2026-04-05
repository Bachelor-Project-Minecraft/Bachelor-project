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

	const previousHostiles = toEntityMap(previous.nearby.hostiles)
	const currentHostiles = toEntityMap(current.nearby.hostiles)
	const removedHostiles = previous.nearby.hostiles.filter(
		(hostile) => !currentHostiles.has(hostile.id),
	)
	const addedHostiles = current.nearby.hostiles.filter(
		(hostile) => !previousHostiles.has(hostile.id),
	)
	const movedCloserHostiles = current.nearby.hostiles.flatMap((hostile) => {
		const previousHostile = previousHostiles.get(hostile.id)
		if (!previousHostile) {
			return []
		}

		const distanceDelta = previousHostile.distance - hostile.distance
		if (distanceDelta < significantDistanceDelta) {
			return []
		}

		return [
			`- ${hostile.name} id ${hostile.id} moved from ${previousHostile.distance.toFixed(1)} to ${hostile.distance.toFixed(1)} blocks away`,
		]
	})

	if (removedHostiles.length > 0) {
		steps.push({
			title: "The following are no longer a threat:",
			details: removedHostiles.map(
				(hostile) => `- ${hostile.name} id ${hostile.id}`,
			),
			shouldTriggerPrompt: false,
		})
	}

	if (addedHostiles.length > 0) {
		steps.push({
			title:
				addedHostiles.length === 1
					? "A new hostile mob is approaching:"
					: "Multiple new hostile mobs are approaching:",
			details: addedHostiles.map(
				(hostile) =>
					`- ${hostile.name} id ${hostile.id} is ${hostile.distance.toFixed(1)} blocks away`,
			),
			shouldTriggerPrompt: true,
		})
	}

	if (movedCloserHostiles.length > 0) {
		steps.push({
			title: "Hostile mobs are getting closer:",
			details: movedCloserHostiles,
			shouldTriggerPrompt: false,
		})
	}

	const closeThreats = current.nearby.hostiles.filter(
		(hostile) => hostile.distance <= closeThreatThreshold,
	)
	const previousCloseThreatIds = new Set(
		previous.nearby.hostiles
			.filter((hostile) => hostile.distance <= closeThreatThreshold)
			.map((hostile) => hostile.id),
	)
	const newCloseThreats = closeThreats.filter(
		(hostile) => !previousCloseThreatIds.has(hostile.id),
	)

	if (newCloseThreats.length > 0) {
		steps.push({
			title: "Hostiles are now in immediate range:",
			details: newCloseThreats.map(
				(hostile) =>
					`- ${hostile.name} id ${hostile.id} is ${hostile.distance.toFixed(1)} blocks away`,
			),
			shouldTriggerPrompt: false,
		})
	}

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
			shouldTriggerPrompt: true,
		})
	}

	const inventoryDiff = diffInventory(
		previous.inventory.items,
		current.inventory.items,
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

	return steps
}

export function toEntityMap(
	entities: SnapshotEntity[],
): Map<number, SnapshotEntity> {
	return new Map(entities.map((entity) => [entity.id, entity]))
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
