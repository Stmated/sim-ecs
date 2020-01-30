import {Entity} from "./entity";
import {EntityBuilder} from "./entity_builder";
import {ISystemWorld, IWorld, TRunConfiguration, TSystemNode} from "./world.spec";
import IEntity from "./entity.spec";
import IEntityBuilder from "./entity_builder.spec";
import ISystem, {EComponentRequirement, TComponentQuery, TSystemProto} from "./system.spec";
import {IState, State} from "./state";
import {TTypeProto} from "./_.spec";

export * from './world.spec';

export class World implements IWorld {
    protected defaultState = new State();
    protected entities: IEntity[] = [];
    protected lastDispatch = 0;
    protected resources = new Map<{ new(): Object }, Object>();
    protected runPromise?: Promise<void> = undefined;
    protected runState?: IState = undefined;
    protected runSystems: { system: ISystem, hasDependencies: boolean }[] = [];
    protected shouldRunSystems = false;
    protected sortedSystems: TSystemNode[] = [];
    protected systemWorld: ISystemWorld;

    constructor() {
        this.systemWorld = {
            changeRunningState: this.changeRunningState.bind(this),
            getEntities: this.getEntities.bind(this),
            getResource: this.getResource.bind(this),
        };
    }

    get systems(): ISystem[] {
        return this.defaultState.systems;
    }

    addEntity(entity: IEntity): IWorld {
        if (!this.entities.includes(entity)) {
            entity.setWorld(this);
            this.entities.push(entity);
        }

        return this;
    }

    addResource<T extends Object>(obj: T | TTypeProto<T>, ...args: any[]): IWorld {
        let type: TTypeProto<T>;
        let instance: T;

        if (typeof obj === 'object') {
            type = obj.constructor as TTypeProto<T>;
            instance = obj;
        }
        else {
            type = obj;
            // @ts-ignore
            instance = new (obj.bind.apply(obj, [obj].concat(Array.from(arguments).slice(1))))();
        }

        if (this.resources.has(type)) {
            throw new Error(`Resource with name "${type.name}" already exists!`);
        }

        this.resources.set(type, instance);
        return this;
    }

    buildEntity(): IEntityBuilder {
        return new EntityBuilder(this);
    }

    async changeRunningState(newState: IState): Promise<void> {
        const dependencySystems: string[] = [];
        let stateSystem;

        this.runState && await this.runState.deactivate(this);
        this.runState = newState;
        this.runSystems.length = 0;
        for (let system of this.sortedSystems.reverse()) {
            stateSystem = dependencySystems.includes(system.system.constructor.name)
                ? system.system
                : newState.systems.find(stateSys =>
                    stateSys.constructor.name === system.system.constructor.name);


            if (stateSystem) {
                this.runSystems.push({
                    system: stateSystem,
                    hasDependencies: system.dependencies.length > 0,
                });

                for (const dependency of system.dependencies) {
                    if (!dependencySystems.includes(dependency.name)) {
                        dependencySystems.push(dependency.name);
                    }
                }
            }
        }

        this.runSystems = this.runSystems.reverse();
        await this.runState.activate(this);
    }

    createEntity(): Entity {
        const entity = new Entity();
        this.entities.push(entity);
        return entity;
    }

    async dispatch(state?: IState): Promise<void> {
        const currentTime = Date.now();

        if (!state) {
            state = this.defaultState;
        }

        await this.changeRunningState(state);

        if (this.lastDispatch === 0) {
            this.lastDispatch = currentTime;
        }

        {
            const scheduledSystems = this.getScheduledRunSystems();
            let deltaTime = currentTime - this.lastDispatch;
            let parallelRunningSystems = [];
            let parallelSystem;
            let systems;

            for (systems of scheduledSystems) {
                for (parallelSystem of systems) {
                    parallelRunningSystems.push(parallelSystem.update(this.systemWorld, parallelSystem.entities, deltaTime));
                }

                await Promise.all(parallelRunningSystems);
                parallelRunningSystems = [];
            }
        }

        this.lastDispatch = currentTime;
    }

    getEntities(withComponents?: TComponentQuery): IEntity[] {
        if (!withComponents) {
            return this.entities;
        }

        const resultEntities = [];

        entityLoop: for (const entity of this.entities) {
            for (let componentRequirement of withComponents) {
                if (
                    (entity.hasComponent(componentRequirement[0]) && componentRequirement[1] === EComponentRequirement.UNSET) ||
                    (!entity.hasComponent(componentRequirement[0]) && componentRequirement[1] !== EComponentRequirement.UNSET)
                ) continue entityLoop;
            }

            resultEntities.push(entity);
        }

        return resultEntities;
    }

    getResource<T extends Object>(type: TTypeProto<T>): T {
        if (!this.resources.has(type)) {
            throw new Error(`Resource of type "${type.name}" does not exist!`);
        }

        return this.resources.get(type) as T;
    }

    maintain(): void {
        this.sortedSystems = this.sortSystems(this.sortedSystems);
        for (let entity of this.entities) {
            entity._updateSystems(this);
        }
    }

    registerSystem(system: ISystem, dependencies?: TSystemProto[]): IWorld {
        this.registerSystemQuick(system, dependencies);
        for (let entity of this.entities) {
            entity._updateSystem(this, system);
        }

        this.sortedSystems = this.sortSystems(this.sortedSystems);
        return this;
    }

    registerSystemQuick(system: ISystem, dependencies?: TSystemProto[]): IWorld {
        if (this.sortedSystems.find(node => node.system.constructor === system.constructor)) {
            throw new Error(`The system "${system.constructor.name}" was already added to the world!`);
        }

        this.defaultState.systems.push(system);
        this.sortedSystems.push({ system, dependencies: dependencies || [] });
        return this;
    }

    replaceResource<T extends Object>(obj: T | TTypeProto<T>, ...args: any[]): IWorld {
        let type: TTypeProto<T>;

        if (typeof obj === 'object') {
            type = obj.constructor as TTypeProto<T>;
        }
        else {
            type = obj;
        }

        if (!this.resources.has(type)) {
            throw new Error(`Resource with name "${type.name}" does not exists!`);
        }

        this.resources.delete(type);
        // @ts-ignore
        return this.addResource.apply(this, [obj].concat(args));
    }

    protected sortSystems(unsorted: TSystemNode[]): TSystemNode[] {
        const graph = new Map(unsorted.map(node => [node.system.constructor as TSystemProto, Array.from(node.dependencies)]));
        let edges: TSystemProto[];

        /// toposort with Kahn
        /// https://en.wikipedia.org/wiki/Topological_sorting#Kahn's_algorithm
        const L: TSystemProto[] = []; // Empty list that will contain the sorted elements
        const S = Array.from(graph.entries()).filter(pair => pair[1].length === 0).map(pair => pair[0]); // Set of all nodes with no incoming edge
        let n: TSystemProto;

        // while S is non-empty do
        while (S.length > 0) {
            // remove a node n from S
            n = S.shift() as TSystemProto;
            // add n to tail of L
            L.push(n);

            // for each node m with an edge e from n to m do
            for (let m of Array.from(graph.entries()).filter(pair => pair[1].includes(n)).map(pair => pair[0])) {
                // remove edge e from the graph
                edges = graph.get(m) as TSystemProto[];
                edges.splice(edges.indexOf(n), 1);

                // if m has no other incoming edges then
                if (edges.length <= 0) {
                    // insert m into S
                    S.push(m);
                }
            }
        }

        if (Array.from(graph.values()).find(n => n.length > 0)) {
            throw new Error('The system dependency graph is cyclic!');
        }

        let obj;
        return L.map(t => {
            obj = unsorted.find(n => n.system.constructor == t);

            if (!obj) {
                throw new Error(`The system ${t.name} was not registered!`);
            }

            return obj;
        });
    }

    async stopRun(): Promise<void> {
        this.shouldRunSystems = false;
        await this.runPromise;
    }

    async run(configuration?: TRunConfiguration): Promise<void> {
        // todo: this could be further optimized by allowing systems with dependencies to run in parallel
        //    if all of their dependencies already ran

        // todo: also, if two systems depend on the same components, they may run in parallel
        //    if they only require READ access

        let resolver = () => {};

        if (this.runPromise) {
            throw new Error('The dispatch loop is already running!');
        }

        if (!configuration) {
            configuration = {};
        }

        if (!configuration.initialState) {
            configuration.initialState = this.defaultState;
        }

        await this.changeRunningState(configuration.initialState);
        this.runPromise = new Promise<void>(res => { resolver = res });
        this.shouldRunSystems = true;

        if (this.lastDispatch <= 0) {
            this.lastDispatch = Date.now();
        }

        {
            const execAsync = typeof requestAnimationFrame == 'function'
                ? requestAnimationFrame
                : setTimeout;
            const scheduledSystems = this.getScheduledRunSystems();
            let currentTime;
            let deltaTime;
            let parallelRunningSystems: Promise<void>[] = [];
            let parallelSystem;
            let systems;
            const mainLoop = async () => {
                currentTime = Date.now();
                deltaTime = currentTime - this.lastDispatch;

                if (!this.shouldRunSystems) {
                    this.runPromise = undefined;
                    resolver();
                    return;
                }

                // @ts-ignore guaranteed to be set at the beginning of method
                if (configuration.preFrameHandler) {
                    // @ts-ignore guaranteed to be set at the beginning of method
                    await configuration.preFrameHandler();
                }

                for (systems of scheduledSystems) {
                    for (parallelSystem of systems) {
                        parallelRunningSystems.push(parallelSystem.update(this.systemWorld, parallelSystem.entities, deltaTime));
                    }

                    await Promise.all(parallelRunningSystems);
                    parallelRunningSystems = [];
                }

                await Promise.all(parallelRunningSystems);
                parallelRunningSystems = [];
                this.lastDispatch = currentTime;
                execAsync(mainLoop);
            };

            execAsync(mainLoop);
        }

        return this.runPromise;
    }

    protected getScheduledRunSystems(): ISystem[][] {
        const compScheduler: ISystem[][] = [];
        const depScheduler: ISystem[][] = [[]];

        {
            let step = 0;
            let system;

            for (system of this.runSystems) {
                if (system.hasDependencies) {
                    if (depScheduler[step].length > 0) {
                        depScheduler[++step] = [];
                    }

                    depScheduler[step].push(system.system);
                    depScheduler[++step] = [];
                } else {
                    // only systems which read the same components may be put together
                    depScheduler[step].push(system.system);
                }
            }
        }

        {
            let group;

            for (group of depScheduler) {
                // check query of each system and sort early-push all concurrent WRITEs
                // 1. create Map<Component, [[System, Access]]>
                // 2. put systems with write access into separate arrays.
                //    try to put systems together, if they write to different components
                //    also keep a second array, which stores the WRITE-components
            }
        }

        return compScheduler;
    }
}
