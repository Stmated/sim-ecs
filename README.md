# sim-ecs
ECS, which is optimized for simulations

## Considerations

This ECS is built for easy usage (DX) and high iteration speed.
The trade-off is that insertion and deletion are slow.
I recommend doing insertions and deletions at defined points (for example loading screens)
and batching these operations.

Batching can be done by using `-Quick` methods (for example `world.registerSystemQuick()`),
which will not calculate component and system dependencies). In the end, call `world.maintain()`
in order to do the heavy lifting.

Even while dispatching the world, you can use `-Quick` methods, however the inserted objects
will only work after calling `world.maintain()`. This way, changes to a simulation can be prepared
on a running world and then rather quickly added once ready.


## Creating the ECS and a world

In an ECS, a world is like a container for entities.

```typescript
import {Component, ECS, IEntity, IWorld, System} from "sim-ecs";

const ecs = new ECS();
const world = ecs.createWorld();
```


## Setting resources

Resources are objects, which can hold certain data, like the start DateTime.

```typescript
// this call implicitely creates a new object of type Date. You can also pass an instance instead.
// you can pass arguments to the constructor by passing them as additional parameters here
world.addResource(Date);
console.log(world.getResource(Date).getDate());
```


## Defining components

Components are needed to define data on which the whole system can operate.

```typescript
class Position extends Component {
    x = 0;
    y = 0;
}

class Velocity extends Component {
    x = 0;
    y = 0;
}
```

## Defining systems

Systems are the logic, which operates on data sets (components).
They are logic building blocks which separate concerns and make the world move.

```typescript
const Gravity = class extends System {
    protected absTime = 0;

    constructor() {
        super();

        // a component query is the filter which defines the components used by this system
        this.setComponentQuery({
            Position: true,
            Velocity: true,
        });
    }

    // update() is called every time the world needs to be updated. Put your logic in there
    update(world: IWorld, entities: IEntity[], deltaTime: number): void {
        this.absTime += deltaTime;
        for (let entity of entities) {
            const pos = entity.getComponent(Position);
            const vel = entity.getComponent(Velocity);

            if (!pos || !vel) continue;

            vel.y -= Math.pow(0.00981, 2) * this.absTime;
            pos.y += vel.y;

            console.log(`Pos: ${pos.y.toFixed(5)}    Vel: ${vel.y.toFixed(5)}`);
        }
    }
};
```


## Adding entities

Entities are like glue. They define which components belong together and form one data.
Entities are automatically added to the world they are built in.

```typescript
world.buildEntity()
    .with(Position) // this call implicitely creates a new object of type Position. You can also pass an instance instead.
    .with(Velocity) // you can pass arguments to the constructor by passing them as additional parameters here
    .build();
```


## Working with states (optional)

States allow for splitting up a simulation into different logical parts.
In games, that's for example "Menu", "Play" and "Pause".
States can be switched arbitrarily, which allows to build a push-down automata on top, or really do anything else.
States define which systems should run, so that a pause-state can run graphics updates, but not game-logic, for example.
If no state is passed to the dispatcher, all systems are run by default.

```typescript
class InitState extends State { _systems = [initSystem] }
class RunState extends State { _systems = [gravitySystem] }
class PauseState extends State { _systems = [pauseSystem] }
const initState = new InitState();
const runState = new RunState();

world.dispatch(initState);
while (true) world.dispatch(runState);
``` 

## Update loop

The update loop (for example game loop) is what keeps simulations running.
In this loop, the world is dispatched on each step (then it waits for 500ms for slower output).

```typescript
const update = function () {
    world.dispatch();
    setTimeout(update, 500);
};

update();
```
