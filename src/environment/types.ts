export interface SnapshotPosition {
	x: number
	y: number
	z: number
}

export interface SnapshotNearbyEntity {
	id: number
	name: string
	distance: number
	position: SnapshotPosition
}

export interface SnapshotDroppedItem {
	id: number
	name: string
	count: number
	distance: number
	position: SnapshotPosition
}

export interface SnapshotInventoryItem {
	name: string
	displayName: string
	count: number
	slot: number
}

export interface EnvironmentSnapshot {
	health: number
	food: number
	position: SnapshotPosition
	nearby: {
		hostiles: SnapshotNearbyEntity[]
		players: SnapshotNearbyEntity[]
		droppedItems: SnapshotDroppedItem[]
	}
	inventory: {
		totalItems: number
		emptySlots: number
		items: SnapshotInventoryItem[]
	}
}
