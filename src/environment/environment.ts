import { Bot } from "mineflayer"
import type { Block } from "prismarine-block"
import { Vec3 } from "vec3"
import { config } from "../config"
import { roundNum } from "../utils/util"
import {
	compareEnvironmentSnapshots,
	diffInventory,
	toEntityMap,
} from "./environmentComparison"
import {
	type EnvironmentChangeStep,
	type SnapshotEntity,
	type SnapshotPosition,
	type EnvironmentSnapshot,
	type SnapshotDirectionalBlocks,
	type SnapshotBlock,
	type SnapshotFluidBlock,
	type SnapshotInventoryItem,
	type SnapshotSurroundingBlock,
} from "./types"

const hiddenPlayersFromBots = new Set(
	config.admins.map((username) => username.toLowerCase()),
)

export class Environment {
	private readonly nearbyRadius = 16
	private readonly nearbyFluidRadius = 8
	private readonly maxNearbyFluids = 6

	constructor(private readonly bot: Bot) {}

	public compareEnvironmentSnapshots(
		previous: EnvironmentSnapshot,
		current: EnvironmentSnapshot,
	): EnvironmentChangeStep[] {
		return compareEnvironmentSnapshots(previous, current)
	}

	public toEntityMap(entities: SnapshotEntity[]): Map<number, SnapshotEntity> {
		return toEntityMap(entities)
	}

	public diffInventory(previous: SnapshotInventoryItem[], current: SnapshotInventoryItem[]) {
		return diffInventory(previous, current)
	}

	public getEnvironmentSnapshot(): EnvironmentSnapshot {
		const botEntity = this.bot.entity
		const inventoryItems =
			this.bot.inventory.items().map((item) => ({
				name: item.name,
				displayName: item.displayName,
				count: item.count,
				slot: item.slot,
			})) ?? []
		const emptySlots = this.bot.inventory.emptySlotCount() ?? 0

		if (!botEntity) {
			throw new Error("Bot not found. Cannot capture environment snapshot.")
		}

		const botPosition = botEntity.position
		const botBlockPosition = this.getBlockPosition(botPosition)
		const nearbyEntities = Object.values(this.bot.entities).filter((entity) => {
			if (entity.id === botEntity.id) return false
			return entity.position.distanceTo(botPosition) <= this.nearbyRadius
		})
		const directionalBlocks = this.getDirectionalBlocks(
			botBlockPosition,
			botEntity.yaw,
		)
		const nearbyFluids = this.getNearbyFluids(botPosition, botBlockPosition)
		const surroundingBlocks = this.getSurroundingBlocks(botBlockPosition)

		const hostiles = nearbyEntities
			.filter((entity) => entity.type === "hostile")
			.map((entity) =>
				this.toSnapshotEntity(
					entity.id,
					entity.name ?? entity.displayName ?? "unknown",
					entity.health,
					entity.position,
					botPosition,
				),
			)

		const players = nearbyEntities
			.filter(
				(entity) =>
					entity.type === "player" &&
					!hiddenPlayersFromBots.has((entity.username ?? "").toLowerCase()),
			)
			.map((entity) =>
				this.toSnapshotEntity(
					entity.id,
					entity.username ?? entity.displayName ?? "unknown",
					entity.health,
					entity.position,
					botPosition,
				),
			)

		const allPlayers = Object.values(this.bot.players)
			.filter(
				(player) =>
					player.username !== this.bot.username &&
					!hiddenPlayersFromBots.has(player.username.toLowerCase()),
			)
			.sort((left, right) => left.username.localeCompare(right.username))
			.flatMap((player) => {
				const entity = player.entity as typeof player.entity | null

				if (!entity) {
					return []
				}

				return [
					this.toSnapshotEntity(
						entity.id,
						player.username,
						entity.health,
						entity.position,
						botPosition,
					),
				]
			})

		const droppedItems = nearbyEntities
			.filter(
				(entity) =>
					entity.type === "object" &&
					(entity.objectType === "Item" || entity.objectType === "item"),
			)
			.map((entity) => {
				const droppedItem = entity.getDroppedItem()

				return {
					id: entity.id,
					name: droppedItem?.name ?? entity.name ?? "unknown_item",
					count: droppedItem?.count ?? 1,
					distance: roundNum(entity.position.distanceTo(botPosition)),
					position: this.getPosition(
						entity.position.x,
						entity.position.y,
						entity.position.z,
					),
				}
			})

		const totalItems = inventoryItems.reduce((acc, item) => acc + item.count, 0)

		return {
			health: this.bot.health,
			food: this.bot.food,
			position: this.getPosition(botPosition.x, botPosition.y, botPosition.z),
			nearby: {
				hostiles,
				players,
				droppedItems,
				world: {
					directionalBlocks,
					fluids: nearbyFluids,
					surroundingBlocks,
				},
			},
			inventory: {
				totalItems,
				emptySlots,
				items: inventoryItems,
			},
			allPlayers,
		}
	}

	private getBlockPosition(position: Vec3): Vec3 {
		return new Vec3(
			Math.floor(position.x),
			Math.floor(position.y),
			Math.floor(position.z),
		)
	}

	private getPosition(x: number, y: number, z: number): SnapshotPosition {
		return {
			x: roundNum(x),
			y: roundNum(y),
			z: roundNum(z),
		}
	}

	private getDirectionalBlocks(
		botBlockPosition: Vec3,
		yaw: number,
	): SnapshotDirectionalBlocks {
		const { forward, right, back, left } = this.getRelativeDirections(yaw)

		return {
			below: this.getBlockSnapshot(botBlockPosition, new Vec3(0, -1, 0)),
			feet: this.getBlockSnapshot(botBlockPosition, new Vec3(0, 0, 0)),
			head: this.getBlockSnapshot(botBlockPosition, new Vec3(0, 1, 0)),
			above: this.getBlockSnapshot(botBlockPosition, new Vec3(0, 2, 0)),
			front: this.getBlockSnapshot(botBlockPosition, forward),
			frontRight: this.getBlockSnapshot(
				botBlockPosition,
				new Vec3(forward.x + right.x, 0, forward.z + right.z),
			),
			right: this.getBlockSnapshot(botBlockPosition, right),
			backRight: this.getBlockSnapshot(
				botBlockPosition,
				new Vec3(back.x + right.x, 0, back.z + right.z),
			),
			back: this.getBlockSnapshot(botBlockPosition, back),
			backLeft: this.getBlockSnapshot(
				botBlockPosition,
				new Vec3(back.x + left.x, 0, back.z + left.z),
			),
			left: this.getBlockSnapshot(botBlockPosition, left),
			frontLeft: this.getBlockSnapshot(
				botBlockPosition,
				new Vec3(forward.x + left.x, 0, forward.z + left.z),
			),
		}
	}

	private getRelativeDirections(yaw: number) {
		const facingIndex = ((Math.round((yaw + Math.PI) / (Math.PI / 2)) % 4) + 4) % 4
		const forwardByFacing = [
			new Vec3(0, 0, 1),
			new Vec3(-1, 0, 0),
			new Vec3(0, 0, -1),
			new Vec3(1, 0, 0),
		]
		const forward = forwardByFacing[facingIndex]
		const right = new Vec3(-forward.z, 0, forward.x)
		const back = new Vec3(-forward.x, 0, -forward.z)
		const left = new Vec3(forward.z, 0, -forward.x)

		return { forward, right, back, left }
	}

	private getBlockSnapshot(
		botBlockPosition: Vec3,
		relativeOffset: Vec3,
	): SnapshotBlock {
		const blockPosition = botBlockPosition.offset(
			relativeOffset.x,
			relativeOffset.y,
			relativeOffset.z,
		)
		const block = this.bot.blockAt(blockPosition)

		return {
			name: block?.name ?? "air",
			position: this.getPosition(
				blockPosition.x,
				blockPosition.y,
				blockPosition.z,
			),
			relativeOffset: this.getPosition(
				relativeOffset.x,
				relativeOffset.y,
				relativeOffset.z,
			),
		}
	}

	private getNearbyFluids(
		botPosition: Vec3,
		botBlockPosition: Vec3,
	): SnapshotFluidBlock[] {
		const maxBlockSearchCount = Math.pow(this.nearbyFluidRadius * 2 + 1, 3)
		const fluidPositions = this.bot.findBlocks({
			matching: (block) => block.name === "water" || block.name === "lava",
			maxDistance: this.nearbyFluidRadius,
			count: maxBlockSearchCount,
		})

		return fluidPositions
			.map((position) => this.bot.blockAt(position))
			.filter(
				(block): block is Block =>
					block !== null &&
					(block.name === "water" || block.name === "lava"),
			)
			.sort(
				(left, right) =>
					left.position.distanceTo(botPosition) -
					right.position.distanceTo(botPosition),
			)
			.slice(0, this.maxNearbyFluids)
			.map((block) => this.toSnapshotFluidBlock(block, botPosition, botBlockPosition))
	}

	private toSnapshotFluidBlock(
		block: Block,
		botPosition: Vec3,
		botBlockPosition: Vec3,
	): SnapshotFluidBlock {
		return {
			name: block.name,
			distance: roundNum(block.position.distanceTo(botPosition)),
			position: this.getPosition(
				block.position.x,
				block.position.y,
				block.position.z,
			),
			relativeOffset: this.getPosition(
				block.position.x - botBlockPosition.x,
				block.position.y - botBlockPosition.y,
				block.position.z - botBlockPosition.z,
			),
		}
	}

	private getSurroundingBlocks(
		botBlockPosition: Vec3,
	): SnapshotSurroundingBlock[] {
		const layerOffsets = [
			new Vec3(0, -1, 0),
			new Vec3(1, -1, 0),
			new Vec3(1, -1, 1),
			new Vec3(0, -1, 1),
			new Vec3(-1, -1, 1),
			new Vec3(-1, -1, 0),
			new Vec3(-1, -1, -1),
			new Vec3(0, -1, -1),
			new Vec3(1, -1, -1),
			new Vec3(1, 0, 0),
			new Vec3(1, 0, 1),
			new Vec3(0, 0, 1),
			new Vec3(-1, 0, 1),
			new Vec3(-1, 0, 0),
			new Vec3(-1, 0, -1),
			new Vec3(0, 0, -1),
			new Vec3(1, 0, -1),
			new Vec3(1, 1, 0),
			new Vec3(1, 1, 1),
			new Vec3(0, 1, 1),
			new Vec3(-1, 1, 1),
			new Vec3(-1, 1, 0),
			new Vec3(-1, 1, -1),
			new Vec3(0, 1, -1),
			new Vec3(1, 1, -1),
			new Vec3(1, 2, 0),
			new Vec3(1, 2, 1),
			new Vec3(0, 2, 1),
			new Vec3(-1, 2, 1),
			new Vec3(-1, 2, 0),
			new Vec3(-1, 2, -1),
			new Vec3(0, 2, -1),
			new Vec3(1, 2, -1),
			new Vec3(0, 2, 0)
		]

		return layerOffsets.flatMap((relativeOffset) => {
			const blockPosition = botBlockPosition.offset(
				relativeOffset.x,
				relativeOffset.y,
				relativeOffset.z,
			)
			const block = this.bot.blockAt(blockPosition)

			if (!block || block.name === "air") {
				return []
			}

			return [
				{
					name: block.name,
					position: this.getPosition(
						blockPosition.x,
						blockPosition.y,
						blockPosition.z,
					),
				},
			]
		})
	}

	private toSnapshotEntity(
		id: number,
		name: string,
		health: number | undefined,
		position: Vec3,
		botPosition: Vec3,
	): SnapshotEntity {
		return {
			id,
			name,
			health,
			distance: roundNum(position.distanceTo(botPosition)),
			position: this.getPosition(position.x, position.y, position.z),
		}
	}
}
