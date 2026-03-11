import { Bot } from "mineflayer"
import { Vec3 } from "vec3"
import { roundNum } from "../util/util"
import {
	type SnapshotEntity,
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
				this.toSnapshotEntity(
					entity.id,
					entity.name ?? entity.displayName ?? "unknown",
					entity.health,
					entity.position,
					botPosition,
				),
			)

		const players = nearbyEntities
			.filter((entity) => entity.type === "player")
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
			.filter((player) => player.username !== this.bot.username)
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
			},
			inventory: {
				totalItems,
				emptySlots,
				items: inventoryItems,
			},
			allPlayers,
		}
	}

	private getPosition(x: number, y: number, z: number): SnapshotPosition {
		return {
			x: roundNum(x),
			y: roundNum(y),
			z: roundNum(z),
		}
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
