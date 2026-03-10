import { Bot } from "mineflayer"
import { Vec3 } from "vec3"
import {
	type SnapshotNearbyEntity,
	type SnapshotPosition,
	type EnvironmentSnapshot,
} from "./types"

export class Environment {
	private readonly nearbyRadius = 16

	constructor(private readonly bot: Bot) {}

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
		const nearbyEntities = Object.values(this.bot.entities).filter((entity) => {
			if (entity.id === botEntity.id) return false
			return entity.position.distanceTo(botPosition) <= this.nearbyRadius
		})

		const hostiles = nearbyEntities
			.filter((entity) => entity.type === "hostile")
			.map((entity) =>
				this.toNearbyEntity(
					entity.id,
					entity.name ?? entity.displayName ?? "unknown",
					entity.health,
					entity.position,
				),
			)

		const players = nearbyEntities
			.filter((entity) => entity.type === "player")
			.map((entity) =>
				this.toNearbyEntity(
					entity.id,
					entity.username ?? entity.displayName ?? "unknown",
					entity.health,
					entity.position,
				),
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
					distance: entity.position.distanceTo(botPosition),
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
			},
			inventory: {
				totalItems,
				emptySlots,
				items: inventoryItems,
			},
		}
	}

	private getPosition(x: number, y: number, z: number): SnapshotPosition {
		return { x, y, z }
	}

	private toNearbyEntity(
		id: number,
		name: string,
		health: number | undefined,
		position: Vec3,
	): SnapshotNearbyEntity {
		const botPosition = this.bot.entity.position
		return {
			id,
			name,
			health,
			distance: position.distanceTo(botPosition),
			position: this.getPosition(position.x, position.y, position.z),
		}
	}
}
