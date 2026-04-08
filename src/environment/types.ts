export interface SnapshotPosition {
	x: number
	y: number
	z: number
}

export interface SnapshotEntity {
	id: string | number
	name: string
	health?: number
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

export interface SnapshotBlock {
	name: string
	position: SnapshotPosition
	relativeOffset: SnapshotPosition
}

export interface SnapshotDirectionalBlocks {
	below: SnapshotBlock
	feet: SnapshotBlock
	head: SnapshotBlock
	above: SnapshotBlock
	front: SnapshotBlock
	frontRight: SnapshotBlock
	right: SnapshotBlock
	backRight: SnapshotBlock
	back: SnapshotBlock
	backLeft: SnapshotBlock
	left: SnapshotBlock
	frontLeft: SnapshotBlock
}

export interface SnapshotFluidBlock extends SnapshotBlock {
	distance: number
}

export interface SnapshotSurroundingBlock {
	name: string
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
		hostiles: SnapshotEntity[]
		dangers: SnapshotEntity[]
		players: SnapshotEntity[]
		droppedItems: SnapshotDroppedItem[]
		world: {
			directionalBlocks: SnapshotDirectionalBlocks
			fluids: SnapshotFluidBlock[]
			surroundingBlocks: SnapshotSurroundingBlock[]
		}
	}
	inventory: {
		totalItems: number
		emptySlots: number
		items: SnapshotInventoryItem[]
	}
	allPlayers: SnapshotEntity[]
}

export interface EnvironmentChangeStep {
    title: string;
    details: string[];
    shouldTriggerPrompt: boolean;
}