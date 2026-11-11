// Does:  Declares the fixture of diverse routes and schemas that the bundle and no-codegen proofs use.
// Holds: It holds declarations only; it starts nothing and proves nothing on its own.

import type { Schema } from '@darkstart/core/schema';
import * as t from '@darkstart/core/schema';

export interface Field {
  readonly name: string;
  readonly shape: Shape;
  readonly optional: boolean;
}

export type Shape =
  | { readonly kind: 'string' }
  | { readonly kind: 'number' }
  | { readonly kind: 'boolean' }
  | { readonly kind: 'literal'; readonly value: string }
  | { readonly kind: 'array'; readonly items: Shape; readonly maxItems: number }
  | { readonly kind: 'union'; readonly members: readonly Shape[] }
  | { readonly kind: 'object'; readonly fields: readonly Field[] };

export type Json = null | boolean | number | string | Json[] | { readonly [key: string]: Json };

const routes = 200;
const stringBound = 64;
const numberMaximum = 1_000_000;
const arrayBound = 100;
const wordList = [
  'aardvark ablest abstains accrues acrylic adds adoptions aerialist',
  'agent airings alibi allude amazement amount anchorage anklets',
  'anthology apices apprize archness around artworks assaulted astride',
  'attitudes autocrat awaits babysit badness balloted banker barged',
  'basement battens bearskin bedtimes beguiled bellying beside beverage',
  'bigot bipartite biweekly blazing blip blotted blusher boggling',
  'bonging booties boudoir braced bravest breweries bristled brouhaha',
  'buckling bulging bundling burnished butch cabbing cajolery calved',
  'caned caper care carpets cassia category caved censuses',
  'chaise charged checkbook chewing chins chopstick ciabatta civilian',
  'classier cleverest clockwise clucked coaxing cods colander colossal',
  'commits composing condoles conic constrict converses copier corniest',
  'cosmonaut course coyest crap creating cricks crooners crudity',
  'cubic cupolas curtest cyclones dallies darken dazes debaters',
  'deciding deep deflation delight demoted depleted descanted desultory',
  'devilment diapering diffuse dinged disables disgorge dispirit distract',
  'divisive doggerel donates doting downsized draping drily drowsier',
  'dueled duped dyslexia eastern editing eject elitism embolism',
  'empires encompass engage enrich entrant epitomize errands ester',
  'eventide excelling exerting expenses extirpate facelift faithfuls fanny',
  'fathoming fecundity fending fezes figurines finders firms fizzling',
  'flashest fleets flogged fluffed foam fondle forces forgave',
  'forward fragments freewill frisks fruits fungi fussy gaits',
  'gangling garrotes gawky genesis getaways gimlet glamorize glitziest',
  'glycogen goings gorged gradually grassland grenade gritted grouted',
  'guards gunfights gypped hale handed harass harridan haunches',
  'headlong heavy helmet herewith highball hiring hoeing homered',
  'hoofed horsed housed humankind hurdler hydrofoil ideally illusions',
  'impaired importune incenses indenting inferior inhalants innovated install',
  'interim invaded iridium iterator jasmine jetsam jobless joust',
  'jumping kayaked kickback kinfolk kneel kowtowed ladybirds landfill',
  'larvae laughed lazybones lechery legrooms levee license likening',
  'linesmen listeners loadstone lodestar longhairs loser loyalties lupins',
  'mace magnets malaise mange manuals markup masochist maturely',
  'meaner meetings menorah messier midges militated minibike miscalls',
  'misshapen moats moistly monies mooted mosaics mourned muffin',
  'municipal mustangs nabs nasalizes necktie nestles nibbler ninth',
  'nonempty notables nudged nuzzles obscurest octet oilcloth onward',
  'optimize organizer outbreaks outrank overbook overpower ovulates padres',
  'pallid panoply paramecia parquetry passive patrician paywalls pediatric',
  'pendant percolate persimmon petrify phonetics picnicked pilferer pinnate',
  'pitiably planet playlists plotting pneumonia poles pommeled populists',
  'possesses potties pray prejudges prestos primarily probed projects',
  'prorating prowls puffed punctures purpler putty quartered quickness',
  'rabbit rafters ramified raping raucous reagent rebounds reclaims',
  'redden reeled refresher rehabbed relaxes remembers reoccur reposed',
  'rescinded respect retardant retypes revisions rhythmic rightist risible',
  'robe romping rotor royalist rumba rusting sagebrush saltiness',
  'sandstorm satirist saws scanting schlocky scorecard screwball scullion',
  'searing sedative selectors sepals servility shackle shank sheerer',
  'shined shod shoveled shrives sicking signed simulates sitcoms',
  'skills skywriter slayings slights slotting smacking smokeless snapper',
  'snitch snubbing sodium solitude soprano sours sparingly specks',
  'spikier splayed spooring spritzing squatter stack stance state',
  'steeped stiffener stockpile storks streaks strollers stumping subjugate',
  'succeed suitable sunbeams supply surveyed swarthy swigs syllabify',
  'tableland takeaways tangling tarred taxes teed temporize terabits',
  'textually thiamin thralled thrusts tiffs tingles titles toking',
  'toothy tosses townhouse trammed trawl trialed trip troughs',
  'trustful tuned tussling twinned ukelele unbosomed underfoot unfeigned',
  'uniquely unnatural unsettles unwelcome uprights usefully vagrants vapidity',
  'vehement verdict vial villainy visible voids vying wakeful',
  'wantoned wash waviest webinar weld wheals whiplash whom',
  'wild windward wishfully womanish wooly worsts wringer yacking',
]
  .join(' ')
  .split(' ');

const leafKinds: readonly Shape[] = [
  { kind: 'string' },
  { kind: 'string' },
  { kind: 'number' },
  { kind: 'boolean' },
  { kind: 'string' },
  { kind: 'number' },
];
const optionalSlots = [1, 4, 7, 10, 13, 16, 19];

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function draw(count: number, seed: number): readonly string[] {
  const random = seeded(seed);
  const pool = [...wordList];
  for (let index = 0; index < count; index++) {
    const swap = index + Math.floor(random() * (pool.length - index));
    const held = pool[index];
    const other = pool[swap];
    if (held === undefined || other === undefined) {
      throw new RangeError('word pool exhausted');
    }
    pool[index] = other;
    pool[swap] = held;
  }
  return pool.slice(0, count);
}

function leafFor(index: number): Shape {
  const shape = leafKinds[index % leafKinds.length];
  if (shape === undefined) {
    throw new RangeError('leaf table is empty');
  }
  return shape;
}

function word(words: readonly string[], index: number): string {
  const found = words[index];
  if (found === undefined) {
    throw new RangeError(`word ${index} missing`);
  }
  return found;
}

function makeShapes(): readonly Shape[] {
  const out: Shape[] = [];
  const seen = new Set<string>();
  let counter = 0;
  for (let index = 0; index < routes * 2; index++) {
    const count = 2 + (index % 11);
    let attempt = 0;
    let words = draw(count + 5, index * 1000 + attempt++);
    while (seen.has([...words.slice(0, count)].sort().join(','))) {
      words = draw(count + 5, index * 1000 + attempt++);
    }
    const names = words.slice(0, count);
    seen.add([...names].sort().join(','));
    const optional = new Set<string>();
    const shapes = new Map<string, Shape>();
    names.forEach((name, position) => {
      shapes.set(name, leafFor(index + position));
      if (position > 0) {
        if (optionalSlots.includes(counter % 20)) {
          optional.add(name);
        }
        counter++;
      }
    });
    if (index % 5 === 4) {
      shapes.set(word(names, count - 1), {
        kind: 'array',
        maxItems: arrayBound,
        items: {
          kind: 'object',
          fields: [
            { name: word(words, count), shape: { kind: 'string' }, optional: false },
            { name: word(words, count + 1), shape: { kind: 'number' }, optional: false },
            { name: word(words, count + 2), shape: { kind: 'boolean' }, optional: false },
          ],
        },
      });
    }
    if (index % 10 === 7) {
      shapes.set(word(names, 0), {
        kind: 'union',
        members: [
          { kind: 'literal', value: word(words, count + 3) },
          { kind: 'literal', value: word(words, count + 4) },
        ],
      });
    }
    out.push({
      kind: 'object',
      fields: names.map((name) => ({
        name,
        shape: shapes.get(name) ?? { kind: 'boolean' },
        optional: optional.has(name),
      })),
    });
  }
  return out;
}

function build(shape: Shape): Schema {
  switch (shape.kind) {
    case 'string':
      return t.string({ maxLength: stringBound });
    case 'number':
      return t.number({ minimum: 0, maximum: numberMaximum });
    case 'boolean':
      return t.boolean();
    case 'literal':
      return t.literal(shape.value);
    case 'array':
      return t.array(build(shape.items), { maxItems: shape.maxItems });
    case 'union':
      return t.union(shape.members.map(build));
    case 'object':
      return t.object(
        Object.fromEntries(
          shape.fields.map((field) => [
            field.name,
            field.optional ? t.optional(build(field.shape)) : build(field.shape),
          ]),
        ),
      );
    default:
      return shape satisfies never;
  }
}

export function validValue(shape: Shape): Json {
  switch (shape.kind) {
    case 'string':
      return 's';
    case 'number':
      return 1;
    case 'boolean':
      return true;
    case 'literal':
      return shape.value;
    case 'array':
      return [validValue(shape.items), validValue(shape.items)];
    case 'union':
      return validValue(shape.members[0] ?? { kind: 'boolean' });
    case 'object':
      return Object.fromEntries(shape.fields.map((field) => [field.name, validValue(field.shape)]));
    default:
      return shape satisfies never;
  }
}

const tooLong = 'x'.repeat(stringBound + 1);

export function invalidValue(valid: Json, shape: Shape, variant: number): Json {
  if (shape.kind !== 'object' || typeof valid !== 'object' || valid === null || Array.isArray(valid)) {
    throw new TypeError('the invalid variants are defined for an object body');
  }
  const entries = Object.entries(valid);
  const first = entries[0];
  const last = entries[entries.length - 1];
  if (first === undefined || last === undefined) {
    throw new RangeError('an empty object has no invalid variant');
  }
  const replaced = (key: string, value: Json): Json =>
    Object.fromEntries(entries.map(([name, held]) => [name, name === key ? value : held]));
  switch (variant) {
    case 0:
      return { ...valid, zz: 1 };
    case 1:
      return replaced(first[0], null);
    case 2:
      return replaced(first[0], tooLong);
    case 3: {
      const required = shape.fields.filter((field) => !field.optional).map((field) => field.name);
      const dropped = required[required.length - 1];
      return Object.fromEntries(entries.filter(([name]) => name !== dropped));
    }
    default: {
      const held = last[1];
      return replaced(
        last[0],
        typeof held === 'string' ? tooLong : typeof held === 'number' ? numberMaximum + 1 : 'true',
      );
    }
  }
}

export const shapes: readonly Shape[] = makeShapes();

export const schemas: readonly Schema[] = shapes.map(build);

export function sample(index: number): Json {
  const shape = shapes[index];
  if (shape === undefined) {
    throw new RangeError(`no schema at index ${index}`);
  }
  return validValue(shape);
}
