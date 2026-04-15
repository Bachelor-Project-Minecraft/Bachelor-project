import { Bot, type Player } from "mineflayer"
import type { Entity } from "prismarine-entity"
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
	type SnapshotInventoryItem,
	type SnapshotSurroundingBlock,
} from "./types"

const hiddenPlayersFromBots = new Set(
	config.admins.map((username) => username.toLowerCase()),
)

export class Environment {
	private readonly nearbyRadius = 16
	private readonly maxNearbyTntBlocks = 6

	constructor(private readonly bot: Bot) {}

	public compareEnvironmentSnapshots(
		previous: EnvironmentSnapshot,
		current: EnvironmentSnapshot,
	): EnvironmentChangeStep[] {
		return compareEnvironmentSnapshots(previous, current)
	}

	public toEntityMap(entities: SnapshotEntity[]): Map<string | number, SnapshotEntity> {
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
		const surroundingBlocks = this.getSurroundingBlocks(botBlockPosition)
		const allPlayersByName = new Map<string, SnapshotEntity>()

		const hostiles = nearbyEntities
			.filter((entity) => entity.kind === "Hostile mobs")
			.map((entity) =>
				this.toSnapshotEntity(
					entity.id,
					entity.name ?? entity.displayName ?? "unknown",
					this.getEntityHealth(entity),
					entity.position,
					botPosition,
				),
			)

		const tnt = [
			...nearbyEntities
				.filter((entity) => entity.name === "tnt")
				.map((entity) =>
					this.toSnapshotEntity(
						entity.id,
						entity.name ?? entity.displayName ?? "unknown",
						undefined,
						entity.position,
						botPosition,
					),
				),
			...this.getNearbyTntBlocks(botPosition),
		]

		const players = nearbyEntities
			.filter(
				(entity) =>
					entity.type === "player" &&
					entity.username !== this.bot.username &&
					!hiddenPlayersFromBots.has((entity.username ?? "").toLowerCase()),
			)
			.map((entity) =>
				this.toSnapshotEntity(
					entity.id,
					entity.username ?? entity.displayName ?? "unknown",
					this.getEntityHealth(entity),
					entity.position,
					botPosition,
				),
			)

		for (const player of players) {
			allPlayersByName.set(player.name, player)
		}

		for (const player of Object.values(this.bot.players)) {
			if (
				player.username === this.bot.username ||
				hiddenPlayersFromBots.has(player.username.toLowerCase())
			) {
				continue
			}

			const entity = this.resolvePlayerEntity(player)

			if (!entity) {
				continue
			}

			allPlayersByName.set(
				player.username,
				this.toSnapshotEntity(
					entity.id,
					player.username,
					this.getEntityHealth(entity),
					entity.position,
					botPosition,
				),
			)
		}

		const allPlayers = [...allPlayersByName.values()].sort((left, right) =>
			left.name.localeCompare(right.name),
		)

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
				dangers: tnt,
				players,
				droppedItems,
				world: {
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

	private getNearbyTntBlocks(botPosition: Vec3): SnapshotEntity[] {
		const maxBlockSearchCount = Math.pow(this.nearbyRadius * 2 + 1, 3)
		const tntPositions = this.bot.findBlocks({
			matching: (block) => block.name === "tnt",
			maxDistance: this.nearbyRadius,
			count: maxBlockSearchCount,
		})

		return tntPositions
			.map((position) => this.bot.blockAt(position))
			.filter((block): block is Block => block !== null && block.name === "tnt")
			.sort(
				(left, right) =>
					left.position.distanceTo(botPosition) -
					right.position.distanceTo(botPosition),
			)
			.slice(0, this.maxNearbyTntBlocks)
			.map((block) =>
				this.toSnapshotEntity(
					`tnt:${block.position.x},${block.position.y},${block.position.z}`,
					block.name,
					undefined,
					block.position,
					botPosition,
				),
			)
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

	private resolvePlayerEntity(player: Player): Entity | null {
		return (
			player.entity ??
			Object.values(this.bot.entities).find(
				(entity) =>
					entity.type === "player" &&
					(entity.uuid === player.uuid || entity.username === player.username),
			) ??
			null
		)
	}

	private getEntityHealth(entity: Entity): number | undefined {
		if (typeof entity.health === "number") {
			return entity.health
		}

		const metadataHealth = entity.metadata[9]

		return typeof metadataHealth === "number" ? metadataHealth : undefined
	}

	private toSnapshotEntity(
		id: string | number,
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
