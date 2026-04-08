export type Position = {
    x: number;
    y: number;
    z: number;
};

export type EntitySpawn = {
    type: string;
    position: Position;
    nbt?: string;
};
