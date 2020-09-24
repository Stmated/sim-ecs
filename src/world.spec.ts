import {IEntity} from "./entity.spec";
import IEntityBuilder from "./entity-builder.spec";
import ISystem, {TSystemData, TSystemProto} from "./system.spec";
import IState from "./state.spec";
import {TTypeProto} from "./_.spec";
import {TSerializer} from "./save-format.spec";
import {TComponentAccess} from "./queue.spec";

export type TEntityInfo = {
    entity: IEntity
    usage: Map<TSystemInfo<TSystemData>, TSystemData>
};
export type TRunConfiguration = {
    initialState?: IState,
    // called in-between world dispatches during a run
    transitionHandler?: (actions: ITransitionActions) => Promise<void>
};
export type TStaticRunConfiguration = {
    initialState: IState,
    transitionHandler: (actions: ITransitionActions) => Promise<void>
};
export type TSystemInfo<D extends TSystemData> = {
    dataPrototype: TTypeProto<D>
    dataSet: Set<D>
    dependencies: Set<TSystemProto<TSystemData>>
    system: ISystem<D>
};
export type TSystemNode = { system: ISystem<TSystemData>, dependencies: TSystemProto<TSystemData>[]};

export interface IPartialWorld {
    /**
     * Get a resource which was previously stored
     * @param type
     */
    getResource<T extends Object>(type: TTypeProto<T>): T

    /**
     * Add an entity to this world
     * @param entity
     */
    addEntity(entity: IEntity): void

    /**
     * Add a resource to this world
     * @param type
     * @param args constructor parameters
     */
    addResource<T extends Object>(type: T | TTypeProto<T>, ...args: unknown[]): void

    /**
     * Build an entity and add it to this world using an entity builder
     */
    buildEntity(): IEntityBuilder

    /**
     * Create a new entity and add it to this world
     */
    createEntity(): IEntity

    /**
     * Query entities and find the ones with a certain combination of component
     * @param query
     */
    getEntities<C extends Object, T extends TComponentAccess<C>>(query?: T[]): IterableIterator<IEntity>

    /**
     * Get a resource which was previously stored
     * @param type
     */
    getResource<T extends Object>(type: TTypeProto<T>): T

    /**
     * Re-calculate all entity, component and system dependencies and connections
     */
    maintain(): void

    /**
     * Merge entities from another world into this one
     * @param world
     */
    merge(world: IWorld): void

    /**
     * Remove an entity from the world, deleting all of its components
     * @param entity
     */
    removeEntity(entity: IEntity): void

    /**
     * Remove a resource from the world
     * @param type
     */
    removeResource<T extends Object>(type: TTypeProto<T>): void

    /**
     * Replace a resource from this world
     * @param type
     * @param args constructor parameters
     */
    replaceResource<T extends Object>(type: T | TTypeProto<T>, ...args: unknown[]): void

    /**
     * Signal the world to stop its dispatch-loop
     */
    stopRun(): void

    /**
     * Save this world to a JSON string (entities and their components)
     */
    toJSON(serializer?: TSerializer): string
}

/**
 * Actions which can be called from a system run
 */
export interface ISystemActions {
    readonly currentState: IState | undefined

    /**
     * Query entities and find the ones with a certain combination of component
     * @param query
     */
    getEntities<C extends Object, T extends TComponentAccess<C>>(query?: T[]): IterableIterator<IEntity>

    /**
     * Get a resource which was previously stored
     * @param type
     */
    getResource<T extends Object>(type: TTypeProto<T>): T
}

/**
 * Actions which can be called during an iteration-transition
 */
export interface ITransitionActions extends IPartialWorld {
    readonly currentState: IState | undefined

    /**
     * Revert the running world to a previous state
     */
    popState(): Promise<void>

    /**
     * Change the running world to a new state
     * @param newState
     */
    pushState(newState: IState): Promise<void>
}

export interface IWorld extends IPartialWorld {
    /**
     * Systems which are registered with this world
     */
    readonly systems: ISystem<TSystemData>[]

    /**
     * Execute all systems
     * @param state
     */
    dispatch(state?: IState): Promise<void>

    /**
     * Execute all systems continuously in a dispatch-loop
     * Contains performance benefits by pre-calculating and pre-scheduling the execution
     * @param configuration
     */
    run(configuration?: TRunConfiguration): Promise<void>
}

export interface IEntityWorld extends IPartialWorld {
    readonly isDirty: boolean
    readonly isRunning: boolean
    assignEntityToSystems(entity: IEntity): void
    removeEntityFromSystems(entity: IEntity): void
}

export type TWorldProto = { new(): IWorld };
export default IWorld;
