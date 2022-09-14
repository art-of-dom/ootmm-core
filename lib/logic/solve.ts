import { GAMES } from '../config';
import { Random } from '../random';
import { gameId } from '../util';
import { pathfind, Reachable } from './pathfind';
import { Items } from './state';
import { World } from './world';

const ITEMS_DUNGEON = /^(OOT|MM)_(MAP|COMPASS|SMALL_KEY|BOSS_KEY|STRAY_FAIRY)_[A-Z_]+$/;
const ITEMS_DUNGEON_REWARDS = new Set([
  'OOT_STONE_EMERALD',
  'OOT_STONE_RUBY',
  'OOT_STONE_SAPPHIRE',
  'OOT_MEDALLION_LIGHT',
  'OOT_MEDALLION_FOREST',
  'OOT_MEDALLION_FIRE',
  'OOT_MEDALLION_WATER',
  'OOT_MEDALLION_SPIRIT',
  'OOT_MEDALLION_SHADOW',
]);

const ITEMS_REQUIRED = new Set<string>([
  'OOT_SWORD',
  'OOT_CHICKEN',
  'OOT_OCARINA',
  'OOT_SLINGSHOT',
  'OOT_BOOMERANG',
  'OOT_BOW',
  'OOT_SONG_ZELDA',
  'OOT_SONG_SUN',
  'OOT_SONG_EPONA',
  'OOT_SONG_TIME',
  'OOT_SONG_STORMS',
  'OOT_SONG_SARIA',
  'OOT_ZELDA_LETTER',
  'OOT_RUTO_LETTER',
  'OOT_STRENGTH',
  'OOT_BOMB_BAG',
  'OOT_SCALE',
  'OOT_EMPTY_BOTTLE',
  'OOT_HOOKSHOT',
  'OOT_TUNIC_GORON',
  'OOT_TUNIC_ZORA',
  'OOT_HAMMER',
]);
const ITEMS_NICE = new Set<string>([]);

const DUNGEON_ENTRANCES = {
  "DekuTree": "Deku tree Main",
};

const sample = <T>(random: Random, arr: T[]): T => {
  if (arr.length === 0) {
    throw new Error('Empty Array');
  }

  /* Biased towards low values, but that's fine */
  const index = random.next() % arr.length;
  return arr[index];
};

const shuffle = <T>(random: Random, arr: T[]): T[] => {
  const copy = [...arr];
  for (let i = 0; i < copy.length; i++) {
    const j = random.next() % copy.length;
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

type ItemPlacement = {[k: string]: string};

type ItemPools = {
  dungeon: Items,
  required: Items,
  nice: Items,
  junk: Items,
};

const itemsArray = (items: Items) => {
  const arr: string[] = [];
  for (const item in items) {
    for (let i = 0; i < items[item]; i++) {
      arr.push(item);
    }
  }
  return arr;
};

const poolsArray = (pools: ItemPools) => {
  return [
    ...itemsArray(pools.required),
    ...itemsArray(pools.nice),
    ...itemsArray(pools.junk),
  ];
};

const addItem = (items: Items, item: string) => {
  items[item] = (items[item] || 0) + 1;
};

const removeItem = (items: Items, item: string) => {
  items[item] -= 1;
  if (items[item] === 0) {
    delete items[item];
  }
};

const maxRequired = (pools: ItemPools, item: string, count: number) => {
  if ((pools.required[item] || 0) <= count) {
    return;
  }
  const extra = pools.required[item] - count;
  pools.required[item] = count;
  pools.nice[item] = extra;
};

const makeItemPools = (world: World) => {
  const pools: ItemPools = { dungeon: {}, required: {}, nice: {}, junk: {} };

  for (const item of world.pool) {
    if (ITEMS_DUNGEON.test(item) || ITEMS_DUNGEON_REWARDS.has(item)) {
      addItem(pools.dungeon, item);
    } else if (ITEMS_REQUIRED.has(item)) {
      addItem(pools.required, item);
    } else if (ITEMS_NICE.has(item)) {
      addItem(pools.nice, item);
    } else {
      addItem(pools.junk, item);
    }
  }

  maxRequired(pools, 'OOT_SWORD', 2);
  maxRequired(pools, 'OOT_BOMB_BAG', 1);
  maxRequired(pools, 'OOT_BOW', 1);
  maxRequired(pools, 'OOT_SLINGSHOT', 1);
  maxRequired(pools, 'OOT_MAGIC_UPGRADE', 1);
  maxRequired(pools, 'OOT_OCARINA', 1);

  return pools;
};

const combinedItems = (items: Items, other: Items) => {
  const combined: Items = {};
  for (const item in items) {
    combined[item] = items[item];
  }
  for (const item in other) {
    combined[item] = (combined[item] || 0) + other[item];
  }
  return combined;
};

class Solver {
  private placement: ItemPlacement = {};
  private items: Items = {};
  private reachable?: Reachable;
  private pools: ItemPools;
  private reachedLocations = new Set<string>();

  constructor(
    private world: World,
    private random: Random,
  ) {
    this.pools = makeItemPools(world);
  }

  solve() {
    const checksCount = Object.keys(this.world.checks).length;

    /* Start by placing the required reward items */
    this.fixRewards();

    /* Handle dungeon items */
    for (const dungeon in this.world.dungeons) {
      this.fixDungeon(dungeon);
    }

    for (;;) {
      for (;;) {
        this.reachable = pathfind(this.world, this.items, this.reachable);
        const changed = this.markAccessible();
        if (!changed) {
          break;
        }
      }

      if (this.reachable.locations.size === checksCount) {
        break;
      }

      /* We need to place a required item */
      this.randomAssumed(this.pools.required);
    }

    /* At this point we have a beatable game */
    this.fill();

    return this.placement;
  }

  private fixRewards() {
    let rewards: string[] = [];
    const locations: string[] = [];

    for (const location in this.world.checks) {
      const item = this.world.checks[location].item;
      if (ITEMS_DUNGEON_REWARDS.has(item)) {
        rewards.push(item);
        locations.push(location);
      }
    }

    rewards = shuffle(this.random, rewards);
    for (let i = 0; i < rewards.length; i++) {
      this.placement[locations[i]] = rewards[i];
      removeItem(this.pools.dungeon, rewards[i]);
    }
  }

  private fixDungeon(dungeon: string) {
    let reachable: Reachable | undefined = undefined;
    const assumed: Items = {};

    for (const game of GAMES) {
      for (const baseItem of ['SMALL_KEY', 'BOSS_KEY', 'MAP', 'COMPASS']) {
        const item = gameId(game, baseItem + '_' + dungeon.toUpperCase(), '_');
        const locations = this.world.dungeons[dungeon];
        while (this.pools.dungeon[item]) {
          reachable = this.randomRestricted(this.pools.dungeon, assumed, item, locations, reachable);
        }
      }
    }
  }

  private randomRestricted(pool: Items, assume: Items, item: string, locations: Set<string>, reachable?: Reachable) {
    const assumedItems = combinedItems(this.pools.required, assume);
    const assumedReachable = pathfind(this.world, assumedItems, reachable);
    const location = sample(this.random, Array.from(locations).filter(x => assumedReachable.locations.has(x)).filter(x => !this.placement[x]));

    this.placement[location] = item;

    removeItem(pool, item);
    addItem(assume, item);

    return assumedReachable;
  }

  private randomAssumed(pool: Items) {
    /* Select a random item from the required pool */
    const requiredItem = sample(this.random, itemsArray(pool));

    /* Remove the selected item from the required pool */
    removeItem(pool, requiredItem);

    /* Get all assumed accessible items */
    const assumedAccessibleItems = combinedItems(this.items, pool);

    /* Get all assumed reachable locations */
    const assumedReachable = pathfind(this.world, assumedAccessibleItems, this.reachable).locations;

    /* Get all assumed reachable locations that have not been placed */
    const unplacedLocs = Array.from(assumedReachable).filter(location => !this.placement[location]);

    /* Select a random location from the assumed reachable locations */
    const location = sample(this.random, unplacedLocs);

    /* Place the selected item at the selected location */
    this.placement[location] = requiredItem;
  }

  private fill() {
    const pool = poolsArray(this.pools);
    const shuffledPool = shuffle(this.random, pool);
    let i = 0;

    for (const location in this.world.checks) {
      if (this.placement[location]) {
        continue;
      }
      const item = shuffledPool[i++];
      this.placement[location] = item;
    }
    if (i !== shuffledPool.length) {
      throw new Error('Item Count Error');
    }
  }

  private markAccessible() {
    let changed = false;
    this.reachable!.locations.forEach(loc => {
      if (this.placement[loc] && !this.reachedLocations.has(loc)) {
        this.reachedLocations.add(loc);
        const item = this.placement[loc];
        addItem(this.items, item);
        changed = true;
      }
    });
    return changed;
  }
}

export const solve = (world: World, random: Random) => {
  const solver = new Solver(world, random);
  return solver.solve();
}
