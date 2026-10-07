# TABLETOP FOOTBALL
## Comprehensive Game, Simulation, Intelligence & Presentation Specification

**Working title:** Tabletop Football  
**Primary platform:** Modern desktop/mobile web browser  
**Primary build requirement:** One self-contained HTML file capable of running offline  
**Genre:** Autonomous football simulation / tactical spectator game  
**Visual style:** 2.5D isometric, stylized tabletop presentation with procedural animation  
**Core design principle:** Football should emerge from intelligent individual players interacting under shared tactical principles, rather than from canned football sequences.

---

# 1. PRODUCT VISION

Tabletop Football should initially appear simple.

Twenty-two stylized footballers move around a small isometric pitch. There is a ball, a referee, formations and recognizable football.

Underneath that presentation should be a surprisingly sophisticated simulation.

Each footballer should:

- perceive only what they plausibly know;
- continually scan their environment;
- remember recently observed information;
- anticipate where players and the ball are going;
- understand space;
- understand pressure;
- recognize passing lanes;
- understand their own role;
- understand the team's shape;
- identify opportunities;
- judge risk;
- recognize transitions;
- make independent decisions;
- coordinate naturally with teammates;
- adapt to what opponents are doing;
- execute decisions according to their technical and physical ability.

The engine should not contain logic resembling:

> After three passes, the winger runs forward.

Instead:

1. the winger recognizes space behind the opposing fullback;
2. he notices that the ball carrier has time to look forward;
3. he estimates that the passing lane may open;
4. his role encourages attacking depth;
5. his pace makes the opportunity attractive;
6. he checks the offside line;
7. he initiates his run;
8. the passer perceives the run;
9. the passer evaluates the through ball;
10. the through ball becomes the best available action.

The run and pass emerge naturally.

That distinction is fundamental to the entire project.

---

# 2. CORE DESIGN PILLARS

## 2.1 Player intelligence

Footballers are autonomous agents.

Every meaningful action should originate from a player's own decision system.

Players should differ meaningfully in:

- what they notice;
- how quickly they notice it;
- how far ahead they predict;
- how many alternatives they consider;
- how accurately they estimate risk;
- how aggressively they exploit space;
- how willing they are to improvise;
- how faithfully they follow tactical instructions;
- how accurately they execute their chosen action.

A brilliant midfielder and an average midfielder should not merely have different pass accuracy.

They should **think differently**.

---

## 2.2 Team intelligence without puppeteering

The team has a tactical identity but does not directly move pieces like a chess engine.

A tactical layer supplies:

- formation;
- team width;
- defensive line;
- compactness;
- pressing philosophy;
- buildup style;
- transition priorities;
- risk level;
- tempo;
- preferred areas;
- role responsibilities.

Individual players decide how to fulfill those instructions.

Therefore:

**Team tactics provide objectives and constraints.  
Players provide solutions.**

---

## 2.3 Emergent football

The simulation should naturally produce:

- third-man combinations;
- one-twos;
- overlaps;
- underlaps;
- switches;
- cutbacks;
- recycled possession;
- counterattacks;
- counterpressing;
- diagonal runs;
- decoy runs;
- pressing traps;
- defensive rotations;
- midfield dropping;
- centre-backs stepping into midfield;
- strikers checking toward the ball;
- wingers pinning defenders;
- delayed penalty-area arrivals;
- overloads;
- isolated wide attackers;
- back-post runs;
- defensive cover;
- sweeper-keeper interventions.

These should ordinarily **not exist as named scripted sequences**.

The simulation creates the circumstances and intelligent footballers discover appropriate behavior.

Set pieces are the main exception because real teams deliberately rehearse them.

---

# 3. NON-NEGOTIABLE SIMULATION PRINCIPLES

The following should be treated as invariants.

### No omniscience

An AI player may not directly access arbitrary perfect world information when making decisions.

Ground-truth state exists for simulation and debugging.

Decision-making uses the player's **belief state**.

### No predetermined goals

Goals are never selected by a score generator.

Every goal must result from:

movement → decision → execution → physics → defensive response → goalkeeper response.

### No predetermined possession sequences

Do not explicitly manufacture ten-pass possessions.

Make ten-pass possessions possible because players provide good options.

### Formation positions are elastic

A 4-3-3 is not eleven coordinates.

Formation represents responsibilities and spatial relationships.

### Movement has physical cost

Players cannot instantly change velocity, direction or orientation.

### Defenders defend danger, not dots

A defender's responsibility must incorporate:

- ball;
- goal;
- opponents;
- teammates;
- passing lanes;
- zone;
- tactical structure.

### Difficulty must not create cheating

Higher quality AI should improve:

- perception;
- prediction;
- decisions;
- execution;
- coordination.

It must not grant knowledge the player could not possess.

---

# 4. OVERALL SIMULATION ARCHITECTURE

Use six interacting layers.

## Layer 1: Physical World

Maintains objective state:

- pitch;
- players;
- ball;
- referee;
- goals;
- boundaries;
- velocities;
- collisions;
- match clock.

## Layer 2: Perception

Each player constructs observations from the world.

## Layer 3: Belief and Prediction

Observed information becomes a probabilistic mental representation.

## Layer 4: Tactical Context

Player interprets observations relative to:

- role;
- formation;
- match phase;
- team strategy.

## Layer 5: Decision System

Candidate actions are generated, evaluated and selected.

## Layer 6: Motor Execution

The chosen decision becomes physical movement, passing, shooting, tackling or another football action.

This separation is extremely important.

Bad decisions and bad execution should be independently possible.

An intelligent player might identify the perfect pass and mishit it.

A technically gifted but tactically poor player may execute a bad choice beautifully.

---

# 5. SIMULATION TIMING

Use a deterministic fixed timestep.

Recommended:

**Physics:** 60 Hz  
**Movement controllers:** 30–60 Hz  
**Local spatial analysis:** 10–20 Hz  
**Player decision evaluation:** approximately 5–10 Hz  
**High-level tactical evaluation:** approximately 2–4 Hz  
**Long-term opponent adaptation:** approximately 0.5–1 Hz

Rendering remains independent and may operate at the monitor refresh rate.

This allows intelligent behavior without recalculating expensive tactical analyses sixty times per second.

Use interpolation for rendering.

---

# 6. DETERMINISM

Every match should accept a random seed.

Given:

- identical seed;
- identical teams;
- identical tactics;
- identical engine version;

the result should reproduce identically.

This enables:

- regression testing;
- bug reproduction;
- replays;
- statistical calibration;
- AI comparisons.

Randomness should use one controlled seeded PRNG.

Never use scattered `Math.random()` calls inside simulation logic.

---

# 7. PITCH MODEL

Simulate football in actual metric coordinates.

Default:

**105 m × 68 m**

Simulation coordinates remain conventional Cartesian coordinates.

The isometric view is purely a rendering transformation.

This is important because football concepts are easier to reason about in true pitch coordinates.

The pitch can additionally contain semantic regions.

Examples:

- defensive third;
- middle third;
- attacking third;
- penalty areas;
- half-spaces;
- wide channels;
- central corridor;
- zone 14;
- six-yard box;
- touchline channels;
- half-way line;
- final third.

These are analytical concepts, not movement grids.

Movement remains continuous.

---

# 8. PLAYER DATA MODEL

Each player should have four major attribute groups.

## 8.1 Physical

Examples:

- acceleration
- sprint speed
- agility
- turning
- balance
- strength
- stamina
- jumping
- reach
- recovery speed

## 8.2 Technical

Examples:

- first touch
- short passing
- long passing
- through balls
- crossing
- shooting
- finishing
- heading
- dribbling
- ball carrying
- tackling
- interception
- weak foot

Goalkeepers additionally receive:

- handling
- reflexes
- catching
- parrying
- diving
- one-on-one ability
- aerial command
- sweeping
- throwing
- kicking

## 8.3 Mental

This category is central to Tabletop Football.

Attributes should include:

**Awareness**  
Ability to maintain an accurate understanding of surroundings.

**Vision**  
Ability to discover valuable passing opportunities.

**Anticipation**  
Ability to project future movement.

**Decision Making**  
Ability to rank alternatives appropriately.

**Composure**  
Resistance to pressure-induced decision and execution errors.

**Positioning**  
Ability to occupy useful spaces within tactical context.

**Teamwork**  
Degree to which decisions account for collective structure.

**Creativity**  
Willingness and ability to identify unconventional solutions.

**Concentration**  
Reliability of awareness over long periods.

**Discipline**  
Likelihood of respecting tactical/rule constraints.

**Aggression**  
Willingness to engage physically and press.

**Work Rate**  
Willingness to continuously perform useful movement.

**Off-Ball Intelligence**  
Ability to create space without possessing the ball.

## 8.4 Personality and tendencies

These should modify preferences rather than force behavior.

Examples:

- risk appetite;
- directness;
- patience;
- selfishness;
- roaming tendency;
- pressing enthusiasm;
- preference to receive to feet;
- preference to attack space;
- early crossing tendency;
- dribble tendency;
- long-shot tendency;
- conservative passing tendency;
- willingness to switch play;
- willingness to use weak foot.

---

# 9. RANDOM PLAYER GENERATION

The game should automatically generate believable players.

Each generated player receives:

- name;
- age;
- height;
- weight;
- preferred foot;
- secondary foot ability;
- positional family;
- preferred role;
- attributes;
- traits;
- visual characteristics.

Attributes must be correlated.

Do not generate totally independent random numbers.

For example:

A quick winger may probabilistically have:

- high acceleration;
- high agility;
- reasonable dribbling;
- strong off-ball movement.

A traditional centre-back may probabilistically receive:

- strength;
- heading;
- defensive anticipation;
- tackling;
- lower agility.

But unusual players must remain possible.

A slow but brilliant winger or technically outstanding centre-back creates variety.

Use archetype distributions followed by controlled random variation.

---

# 10. PRIMARY POSITION FAMILIES

The simulation must explicitly separate:

# GK
Goalkeepers.

# DEF
Primarily defensive outfield players.

# MID
Midfield players.

# FWD
Primarily attacking players.

These categories affect fundamental decision envelopes.

They should then contain more specific roles.

Examples:

### GK

- goalkeeper;
- sweeper keeper;
- distributor keeper.

### DEF

- centre-back;
- stopper;
- covering centre-back;
- fullback;
- attacking fullback;
- inverted fullback;
- wing-back.

### MID

- defensive midfielder;
- holding midfielder;
- deep playmaker;
- box-to-box midfielder;
- central midfielder;
- attacking midfielder;
- wide midfielder.

### FWD

- winger;
- inside forward;
- wide forward;
- second striker;
- target striker;
- poacher;
- complete forward;
- false nine.

Roles do not unlock special scripted moves.

They modify:

- preferred spatial regions;
- risk profile;
- movement utility;
- passing preferences;
- pressing responsibility;
- defensive recovery priority.

---

# 11. PLAYER PERCEPTION

This should be one of the game's signature systems.

Each player maintains a local perceptual model.

A footballer's knowledge should derive from:

### Direct vision

Objects inside the player's visual awareness.

### Peripheral awareness

Less accurate detection outside the main gaze direction.

### Scanning

Players periodically look around.

### Memory

Recently observed opponents remain in memory but their estimated position becomes less accurate over time.

### Communication

Nearby teammates can communicate broad warnings and intentions.

### Tactical expectation

Players know where teammates are normally expected to be.

They should not magically know whether they are actually there.

---

# 12. PLAYER SCANNING

Players should visibly and internally scan.

A player expecting the ball may:

- look toward ball;
- glance over shoulder;
- identify nearby pressure;
- find teammate;
- orient body before receiving.

Scanning frequency depends partly on:

- awareness;
- role;
- pressure;
- game phase;
- anticipation;
- concentration.

High-awareness midfielders should constantly update their mental picture.

Low-awareness players may receive the ball and only then discover pressure.

This creates meaningful football intelligence without artificial stat bonuses.

---

# 13. BELIEF STATE

Every player maintains estimated information such as:

```
believedBallPosition
believedOpponentPositions[]
believedTeammatePositions[]
estimatedPressure
estimatedPassingLanes[]
estimatedOffsideLine
knownOpenSpaces[]
```

Each piece of information contains:

- estimated position;
- estimated velocity;
- confidence;
- timestamp.

Confidence decays.

Prediction moves unseen entities according to last-known movement.

Therefore a player may occasionally:

- pass toward a teammate who stopped running;
- fail to notice an arriving defender;
- misjudge an offside line;
- miss a wide-open switch.

These errors should feel human rather than random.

---

# 14. ATTENTION BUDGET

Players should not evaluate every possible action perfectly.

Each possesses an attention/computation budget.

A mediocre midfielder might seriously evaluate:

- nearest safe pass;
- forward pass;
- dribble.

An elite playmaker might additionally notice:

- far-side winger;
- third-man runner;
- defender being pulled out;
- chipped pass behind the line.

This is a very powerful way to differentiate football intelligence.

---

# 15. PREDICTION

Players should predict approximately 0.5–3 seconds ahead.

Prediction can estimate:

- where a teammate will arrive;
- whether a defender can intercept;
- whether a pass lane will remain open;
- whether a player will be offside;
- whether pressure will arrive before first touch;
- whether space is opening.

Prediction horizon and accuracy depend on anticipation and intelligence.

Do not require expensive full simulation trees.

Basic kinematic projections are sufficient.

---

# 16. SPATIAL UNDERSTANDING

The engine should continuously derive useful football-space information.

Important concepts include:

## Pressure field

How quickly an opponent can challenge a point.

## Control field

Which team would probably reach a location first.

## Passing lanes

Whether a ball path can safely reach another player.

## Cover shadow

Area hidden from a passer by a pressing defender.

## Occupancy

How crowded a region is.

## Width

Horizontal distribution of players.

## Depth

Vertical distribution.

## Numerical superiority

Expected team numbers near a location.

## Defensive line

Approximate deepest coordinated line of defenders.

## Space behind

Distance available beyond the defensive line.

## Receiving space

Area in which a player can receive and act before pressure arrives.

These values should be continuously accessible to intelligence systems.

---

# 17. FORMATIONS

Initial formation library:

- 4-3-3
- 4-2-3-1
- 4-4-2
- 3-4-2-1
- 3-5-2

Formation coordinates represent **home regions**, not fixed destinations.

A player's desired position is calculated from:

```
base tactical anchor
+ ball-relative adjustment
+ phase adjustment
+ role adjustment
+ teammate spacing
+ opponent influence
+ available space
+ defensive responsibility
```

This produces flexible formations.

---

# 18. FORMATION MORPHING

The team's visible shape should naturally change.

Example 4-3-3:

### Defending

4-1-4-1-ish structure.

### Initial buildup

Goalkeeper + centre-backs spread.

Pivot becomes available.

### Established possession

Possible 2-3-5 or 3-2-5 occupation.

### Final third

Five attacking lanes.

### Defensive transition

Nearest players counterpress while others form recovery structure.

These transformations should be consequences of role positioning rather than instantaneous formation switching.

---

# 19. TEAM TACTICAL MODEL

Every team has parameters such as:

- width;
- attacking width;
- defensive width;
- defensive line height;
- pressing intensity;
- engagement line;
- compactness;
- tempo;
- buildup risk;
- passing directness;
- counterattack tendency;
- counterpress tendency;
- crossing frequency;
- overlap preference;
- central-overload preference;
- goalkeeper distribution profile;
- defensive marking bias;
- time-management tendency.

---

# 20. MATCH PHASE MODEL

The tactical context system classifies play into broad phases.

Suggested phases:

1. dead ball;
2. goalkeeper possession;
3. initial buildup;
4. established buildup;
5. midfield possession;
6. attacking progression;
7. final-third possession;
8. attacking transition;
9. defensive transition;
10. organized defensive block;
11. active press;
12. emergency defending;
13. set piece.

Phase is fuzzy rather than absolute.

Different players may interpret the same transition slightly differently.

---

# 21. TEAM INTENT

A lightweight tactical director determines collective priorities.

Examples:

**RETAIN**

Maintain possession and reorganize.

**BUILD**

Find structured progression.

**ADVANCE**

Break into a higher zone.

**ATTACK**

Exploit final-third opportunity.

**COUNTER**

Exploit temporary defensive imbalance.

**COUNTERPRESS**

Immediately attack the new ball carrier.

**RECOVER**

Prioritize defensive shape.

**PROTECT**

Reduce risk while leading late.

Team intent alters player utility values.

It does not command actions directly.

---

# 22. PLAYER ACTION SYSTEM

Potential actions include:

### Without ball

- hold position;
- reposition;
- support;
- offer passing angle;
- move away to create space;
- check toward ball;
- run behind;
- overlap;
- underlap;
- attack box;
- cover teammate;
- recover;
- press;
- screen passing lane;
- mark opponent;
- step forward;
- drop deeper;
- track runner.

### With ball

- hold;
- shield;
- turn;
- carry;
- dribble;
- short pass;
- progressive pass;
- through ball;
- switch;
- chipped pass;
- cross;
- cutback;
- shoot;
- clear;
- recycle;
- play goalkeeper.

Each player generates only contextually plausible candidates.

---

# 23. UTILITY-BASED DECISION MAKING

Each candidate receives utility.

A conceptual formulation:

```
UTILITY =
    progressionValue
  + threatCreated
  + possessionValue
  + roleFit
  + tacticalFit
  + spaceValue
  + futureOptions
  + teammateBenefit
  - turnoverRisk
  - interceptionRisk
  - pressureCost
  - offsideRisk
  - shapeDamage
  - staminaCost
  - executionDifficulty
```

Weights depend upon:

- player personality;
- role;
- tactics;
- score;
- match time;
- fatigue;
- confidence;
- game phase.

Small controlled preference variation prevents robotic optimization.

---

# 24. DECISION HYSTERESIS

Players must not constantly oscillate between decisions.

Once a decision begins, retain it unless:

- opportunity disappears;
- danger changes sharply;
- another option becomes substantially better;
- player loses control;
- tactical state changes.

This prevents:

- twitching;
- spinning;
- indecisive direction changes;
- unnatural press switching.

---

# 25. PASSING INTELLIGENCE

Passing must evaluate the complete trajectory, not merely receiver distance.

A pass candidate considers:

- receiver location;
- predicted receiver location;
- interception probability;
- defender arrival time;
- receiving pressure;
- receiver body orientation;
- ball speed;
- passing foot;
- current ball position;
- passing lane width;
- receiver's next options;
- territorial gain;
- defensive lines broken;
- threat gain.

Candidate types include:

- safe feet pass;
- leading pass;
- through pass;
- wall pass;
- switch;
- diagonal;
- clipped pass;
- cross;
- cutback;
- clearance;
- goalkeeper reset.

---

# 26. THROUGH BALLS

Through balls should be a marquee behavior.

A through-ball opportunity requires interaction among:

- runner trajectory;
- passer awareness;
- defensive line;
- passing window;
- offside timing;
- player pace;
- goalkeeper position;
- defender recovery speed.

The passer predicts an interception point rather than aiming directly at the runner.

Better passers optimize:

- weight;
- angle;
- timing;
- leading distance.

Better runners modify their trajectory to remain onside.

---

# 27. OFF-BALL RUNNING

Runs should have purposes.

Potential purposes:

### Penetration

Attack space behind defense.

### Support

Create a safe passing angle.

### Width

Stretch the defense.

### Overload

Create local numerical superiority.

### Decoy

Pull a defender away.

### Rotation

Exchange spaces with teammate.

### Box attack

Attack dangerous scoring location.

### Escape pressure

Move away from a marker.

A run receives utility based on how much useful space or opportunity it creates.

---

# 28. RUN–PASS SYNCHRONIZATION

Runs should not be independent animations.

The runner evaluates:

- passer orientation;
- passer's time on ball;
- likely passing lane;
- defensive attention;
- offside line.

The passer evaluates the runner.

This mutual evaluation naturally creates synchronized football.

---

# 29. POSSESSION CHAINS

The system should regularly be capable of:

- 5-pass sequences;
- 8-pass sequences;
- 10+ pass sequences;
- occasional very long possessions.

But raw pass count must never be the intelligence objective.

A side-to-side sequence accomplishing nothing should not receive positive intelligence evaluation merely because it contains many passes.

---

# 30. PROGRESSIVE POSSESSION MODEL

Every possession maintains metrics.

Examples:

```
startTerritory
currentTerritory
maxTerritory
expectedThreatGain
linesBroken
pressureEscapes
finalThirdEntries
boxEntries
progressivePasses
progressiveCarries
repeatedZones
```

A useful possession can advance through:

- forward territory;
- increased expected threat;
- escaping pressure;
- breaking defensive lines;
- attracting pressure before switching;
- entering valuable space.

Therefore a backward pass may still be intelligent.

Example:

CB → goalkeeper → opposite CB

can be valuable when it moves the opponent and creates a new progression route.

---

# 31. STERILE POSSESSION DETECTION

Detect repeated circulation patterns.

If the ball repeatedly travels:

A → B → A → B

with:

- negligible territorial change;
- negligible threat change;
- no defensive displacement;
- no pressure escape;
- no new passing options;

then the sequence receives near-zero progression value.

This metric should primarily be used for evaluation and tuning rather than as an artificial in-match reward.

We do **not** want players thinking:

> I have already made five sideways passes, therefore I must go forward.

Instead their normal utility system should eventually identify something more valuable.

---

# 32. BALL RETENTION

Possession play requires supporting behavior.

After every pass:

- passer should frequently reposition;
- nearby teammate should offer another angle;
- distant players should maintain width/depth;
- players behind the ball should create security;
- forward players should manipulate defenders.

Good possession therefore becomes a property of **eleven coordinated agents**, not just passing accuracy.

---

# 33. THIRD-MAN FOOTBALL

The engine should naturally discover:

A passes to B.

B is under pressure.

C moves behind/around that pressure.

B returns/releases toward C.

This does not require a `thirdManRun()` script.

It emerges because:

- A recognizes B;
- C recognizes the resulting space;
- B predicts pressure;
- C becomes B's highest-value continuation.

---

# 34. DRIBBLING

Dribbling is another decision, not an animation state.

The player evaluates:

- available space;
- defender distance;
- defender angle;
- support;
- speed advantage;
- dribbling skill;
- tactical risk;
- potential downstream threat.

Dribble movement combines:

- ball touch;
- acceleration;
- body orientation;
- control radius.

Poor dribblers require more frequent/heavier touches.

Good dribblers keep the ball closer and change direction more effectively.

---

# 35. DEFENSIVE INTELLIGENCE

Defending must be as sophisticated as attacking.

Each defender continuously balances:

1. pressure;
2. cover;
3. marking;
4. zone protection;
5. passing-lane control;
6. maintaining team shape.

The nearest defender should **not automatically press**.

---

# 36. PRESS DECISION

Approximate press utility should incorporate:

- distance to ball;
- time to challenge;
- ball carrier control quality;
- carrier body direction;
- sideline proximity;
- available cover;
- defensive numbers;
- teammates already pressing;
- dangerous passing lanes;
- team pressing instruction;
- fatigue;
- game state.

High utility:

player engages.

Low utility:

player delays or maintains shape.

---

# 37. PRESSING ANGLES

Players should not simply sprint toward the ball.

A defender can approach in a way that:

- prevents inward turn;
- blocks pass to midfielder;
- forces play wide;
- directs attacker onto weak foot;
- protects goal.

The optimal approach target may therefore lie beside the ball carrier rather than directly on them.

---

# 38. COVER SHADOWS

A pressing player can simultaneously:

- pressure the ball;
- block a passing lane.

This should emerge from approach-angle selection.

This is important for believable pressing.

---

# 39. DEFENSIVE COVER

When one player presses:

another should recognize the space opened behind him.

That player may:

- narrow;
- drop;
- mark a receiver;
- protect through-ball space.

A third player may then compensate for him.

This creates true collective defense.

---

# 40. ZONAL DEFENDING

Zones should be responsibilities rather than rectangles.

A player's defensive target depends upon:

- formation anchor;
- ball position;
- goal position;
- nearest threats;
- teammate locations;
- passing lanes;
- defensive compactness.

Players should constantly trade off opponent proximity and structural integrity.

---

# 41. MAN MARKING

Man marking should exist as a tactical bias.

It raises the utility of staying connected to a designated threat.

It must not force a defender to mindlessly chase an opponent across the entire pitch.

Dangerous structural violations override marking.

---

# 42. MARK TRANSFER

When opponents rotate:

defenders may exchange responsibility.

Use hysteresis to prevent rapid switching.

Players with:

- awareness;
- teamwork;
- positioning;
- communication;

execute these transfers more cleanly.

Poor defensive teams should occasionally:

- both follow one player;
- both leave him;
- open a temporary lane.

---

# 43. DEFENSIVE LINE

Defenders collectively estimate an appropriate line.

Influences:

- ball pressure;
- opposing runner speed;
- goalkeeper sweeping ability;
- team instruction;
- teammate line;
- match state.

When the passer is heavily pressured:

defense can step higher.

When the passer has time and attackers threaten behind:

defense should become more cautious.

---

# 44. OFFSIDE TRAP

No explicit magical "offside trap button" is necessary initially.

Coordinated defenders with:

- strong positioning;
- awareness;
- tactical cohesion;

naturally maintain a high line and step together.

Poor cohesion creates gaps.

---

# 45. TRANSITION TO DEFENSE

Immediately after losing possession, each player chooses among:

- immediate challenge;
- counterpress;
- block passing lane;
- track runner;
- recover centrally;
- protect defensive line.

The team assesses whether the ball is recoverable.

If yes:

counterpress.

If no:

recover.

---

# 46. COUNTERPRESSING

Counterpress probability increases when:

- many teammates are near turnover;
- opponent has poor control;
- defensive cover exists;
- team philosophy favors it;
- turnover occurred high upfield.

Counterpress probability decreases when:

- team is stretched;
- opponents have numerical superiority;
- large space exists behind;
- players are exhausted.

---

# 47. TRANSITION ATTACK

After winning possession, ball carrier should evaluate whether opponent is disorganized.

Possible behaviors:

- immediate vertical pass;
- carry into space;
- switch;
- release runner;
- slow play and retain.

Direct teams attack quickly.

Possession-oriented teams may still counter when opportunity is overwhelming.

---

# 48. REST DEFENSE

Attacking teams must keep enough defensive security behind the ball.

Players consider:

- opponent forwards;
- ball-loss risk;
- teammate positions;
- tactical risk.

This prevents every player mindlessly flooding forward.

Good teams naturally maintain a defensive platform.

---

# 49. SHOOTING DECISIONS

Shot utility incorporates:

- distance;
- angle;
- defender pressure;
- blocking bodies;
- goalkeeper position;
- player's balance;
- preferred foot;
- shooting ability;
- ball state;
- available passing alternatives.

A player with terrible decision-making may shoot from a poor position.

A great decision-maker may wait or pass.

---

# 50. SHOT EXECUTION

Once selected, shooting physics depend upon:

- contact position;
- body alignment;
- power;
- technique;
- foot;
- pressure;
- balance;
- fatigue;
- execution error.

Shots should physically travel through the simulation.

A goal is not determined beforehand.

---

# 51. GOALKEEPER INTELLIGENCE

Goalkeeper AI deserves its own architecture.

The goalkeeper continually evaluates:

- ball position;
- shooting angle;
- opponent control;
- potential through balls;
- cross probability;
- defensive line;
- attackers;
- pass-back options.

---

# 52. GOALKEEPER POSITIONING

For normal attacks, the keeper approximately positions relative to:

- goal centre;
- ball angle;
- ball distance;
- threat of shot;
- threat of through ball.

Keepers should narrow angles rather than stand statically in the centre.

---

# 53. SWEEPER BEHAVIOR

When the defensive line is high:

the goalkeeper maintains a higher starting position.

If a through ball appears:

```
keeperArrivalTime
vs
attackerArrivalTime
vs
defenderArrivalTime
```

determines whether the keeper comes out.

Sweeper-keepers accept greater risk.

Traditional keepers remain deeper.

---

# 54. SHOT STOPPING

Goalkeeper reaction consists of:

1. perception;
2. reaction delay;
3. trajectory prediction;
4. movement;
5. save choice;
6. physical execution.

Possible choices:

- catch;
- standing save;
- dive;
- parry;
- smother;
- block;
- rush;
- retreat.

Shots screened by defenders should be harder to react to.

---

# 55. CROSSES

Keeper evaluates:

- ball trajectory;
- arrival time;
- traffic;
- jump reach;
- opponent positions;
- collision risk.

Possible choices:

- claim;
- punch;
- stay.

Bad decisions should occasionally create realistic mistakes.

---

# 56. DISTRIBUTION

Goalkeeper scans:

- centre-backs;
- fullbacks;
- midfielder;
- wide players;
- long target.

Distribution choices:

- roll;
- short pass;
- throw;
- medium kick;
- long kick.

Pressing opponents influence the decision.

---

# 57. PLAYER MOVEMENT PHYSICS

Players should have:

- position;
- velocity;
- acceleration;
- facing direction;
- angular velocity;
- maximum speed;
- current balance.

Target movement does not teleport velocity.

Controller computes desired velocity and steering.

Acceleration and turning are constrained.

---

# 58. BODY ORIENTATION

Orientation has gameplay significance.

Receiving while facing forward is better than receiving with back to play.

Turning takes time.

Passing across the body is harder.

Defenders jockey differently from sprinting.

This gives football additional spatial meaning.

---

# 59. PLAYER COLLISIONS

Use simple body capsules/circles with soft separation.

Avoid arcade pinball.

When players collide:

- momentum matters;
- balance matters;
- strength matters;
- contact angle matters.

Small overlap correction is acceptable but should remain visually smooth.

---

# 60. BALL PHYSICS

Ball state:

```
position = x,y,z
velocity = vx,vy,vz
spin
```

Physics includes:

- gravity;
- air resistance;
- rolling resistance;
- bounce;
- ground friction;
- post/crossbar collision;
- player collision.

Optional later:

- Magnus effect;
- wet-pitch modifiers.

---

# 61. BALL CONTROL

The ball should not be glued to players.

During possession:

players generate controlled touches.

A touch establishes:

- desired ball position;
- desired speed;
- touch strength;
- execution error.

This creates:

- heavy touches;
- excellent touches;
- interception opportunities.

---

# 62. PASS PHYSICS

Pass quality determines initial ball impulse.

Ground passes lose velocity through rolling resistance.

Lofted passes use ballistic trajectories.

Execution error affects:

- direction;
- power;
- vertical angle.

Players under pressure receive greater execution variance.

---

# 63. HEADERS

Header outcomes depend upon:

- ball trajectory;
- jump timing;
- height;
- jumping ability;
- body position;
- opponent challenge;
- heading technique.

Header types:

- attacking;
- defensive clearance;
- pass;
- flick.

---

# 64. TACKLES

Tackling should emerge from reach and timing.

Possible defensive actions:

- jockey;
- poke;
- standing tackle;
- shoulder challenge;
- sliding tackle.

Tackle success depends upon:

- timing;
- angle;
- ball exposure;
- defender skill;
- attacker movement.

Poor timing creates foul probability.

---

# 65. FOUL SYSTEM

Contact event evaluates:

- point of contact;
- force;
- ball contact;
- timing;
- challenge direction;
- recklessness;
- tactical context.

Referee then determines:

- no foul;
- foul;
- advantage;
- caution;
- sending-off.

Cards should not simply arise from random chance.

---

# 66. RULES ENGINE

The engine should support the complete normal structure of association football.

The rules module should be versioned independently from simulation AI.

Current default should be modeled on the official IFAB Laws of the Game.

Implement:

- field boundaries;
- match duration;
- player counts;
- equipment abstractions;
- referee authority;
- match start/restart;
- ball in/out of play;
- goals;
- offside;
- fouls;
- misconduct;
- free kicks;
- penalties;
- throw-ins;
- goal kicks;
- corner kicks.

Competition-specific settings should be configurable.

---

# 67. MATCH CLOCK

Match structure:

- first half;
- half-time;
- second half;
- added time;
- full-time.

Simulation time and presentation time are separate.

Possible viewing speeds:

- 1×
- 2×
- 4×
- 8×

The simulation behaves identically regardless of rendering speed.

---

# 68. OFFSIDE

Offside requires a proper event model.

Record player positions at the instant a teammate plays/touches the ball.

Being in an offside position alone does not immediately trigger an infringement.

Evaluate subsequent involvement.

For gameplay purposes detect:

- playing/touching ball;
- challenging opponent;
- interfering with opponent;
- gaining relevant advantage where applicable.

This should be tested heavily.

---

# 69. ADVANTAGE

After a foul:

referee estimates whether fouled team retains a clearly superior opportunity.

If yes:

allow play to continue temporarily.

If advantage fails quickly:

return to original infringement where appropriate.

Cards may still be administered at subsequent stoppage.

---

# 70. RESTARTS

Support:

- kickoff;
- throw-in;
- goal kick;
- corner;
- direct free kick;
- indirect free kick;
- penalty;
- dropped ball.

Each restart invokes temporary tactical positioning rules followed by normal autonomous play.

---

# 71. SET PIECES

Unlike open play, set pieces may use planned templates.

Examples:

### Corners

- near-post run;
- central attack;
- back-post run;
- edge-of-box player;
- defensive blockers;
- short option.

### Free kicks

- direct shot;
- cross;
- short routine.

### Goal kicks

- short buildup;
- split centre-backs;
- long target.

### Throw-ins

- feet option;
- line run;
- return option.

Still permit autonomous deviation if circumstances change.

---

# 72. REFEREE

A visible referee is required.

The referee should:

- follow play;
- maintain useful viewing angle;
- avoid occupying passing routes where practical;
- sprint during transitions;
- whistle;
- signal fouls;
- signal advantage;
- issue cards;
- manage restarts.

Movement can follow a simplified diagonal patrol model influenced by ball location.

---

# 73. REFEREE CONTACT

Eventually support the ball striking the referee.

If it produces circumstances requiring a stoppage under the active rules profile, invoke appropriate restart logic.

Initial versions may prioritize referee avoidance before implementing full referee-ball physics.

---

# 74. ASSISTANT REFEREES

Optional but recommended for presentation.

Two touchline officials:

- track the relevant offside line;
- move along touchline;
- flag offsides;
- signal throw/corner/goal kick.

Actual offside detection remains deterministic in the rules engine.

Officials provide presentation.

---

# 75. ADAPTIVE TEAM BEHAVIOR

Teams should learn basic opponent tendencies during the match.

Track rolling observations such as:

- preferred buildup side;
- frequency of long passes;
- fullback height;
- striker dropping;
- vulnerability behind defensive line;
- common progression route;
- goalkeeper distribution pattern;
- pressing intensity.

Use exponentially decaying observations so recent behavior matters more.

---

# 76. TACTICAL ADAPTATION

Examples:

Opponent consistently builds down left.

Team may:

- shift pressing orientation;
- tighten passing lane into left midfielder;
- encourage opponent toward opposite side.

Opponent holds extremely high defensive line.

Attackers become more willing to threaten behind.

Opponent presses aggressively.

Goalkeeper and defenders become more willing to bypass press.

These adaptations should be gradual.

---

# 77. PLAYER-LEVEL ADAPTATION

Individuals may independently recognize patterns.

Example:

A winger repeatedly beats a slow fullback.

His confidence in direct attacks increases.

A midfielder has twice had a passing lane intercepted.

His estimated safety of that option falls.

The adaptation should decay and never provide perfect knowledge.

---

# 78. SCORE AND MATCH CONTEXT

Decision-making changes based on:

- current score;
- match minute;
- knockout context;
- fatigue.

Examples:

Losing 0–1 in minute 87:

- higher attacking risk;
- more bodies forward;
- quicker restarts;
- more aggressive pressing.

Leading 2–0 in minute 88:

- reduced risk;
- more possession retention;
- less aggressive fullback positioning;
- greater defensive security.

Do not simply apply universal "attack mode."

Individual personalities still matter.

---

# 79. FATIGUE

Fatigue affects:

- acceleration;
- sprint recovery;
- execution precision;
- reaction;
- concentration;
- willingness to press.

Repeated sprints carry significant fatigue cost.

Teams pressing constantly should eventually suffer consequences.

---

# 80. SUBSTITUTIONS

Initial AI can automatically substitute based upon:

- fatigue;
- injury;
- yellow card risk;
- performance;
- role needs;
- tactical situation.

Competition rules determine permitted substitutes and substitution windows.

The rules profile should keep this configurable because substitution regulations differ by competition and can change over time.

---

# 81. INJURIES

Optional initially.

If implemented:

probability depends upon:

- fatigue;
- collision intensity;
- tackle;
- sprint strain;
- player durability.

Keep injury rates low enough not to dominate ordinary matches.

---

# 82. EXPECTED THREAT / POSITION VALUE

The AI needs a lightweight value model.

It does not require machine learning.

Position value can consider:

- distance to goal;
- shooting angle;
- centrality;
- nearby defenders;
- passing options;
- numerical superiority;
- ball carrier orientation;
- space behind defense.

This produces an approximate Expected Possession Value.

Actions can evaluate change:

```
deltaValue =
expectedValueAfterAction
-
expectedValueBeforeAction
```

This helps distinguish productive football from sterile movement.

---

# 83. LINE-BREAK DETECTION

Detect whether a pass/carry crosses meaningful opposition layers.

Examples:

- forward line;
- midfield line;
- defensive line.

Breaking a midfield line is more strategically important than moving the ball five metres sideways.

This becomes a useful telemetry metric.

---

# 84. PASS-CHAIN INTELLIGENCE METRIC

For QA, compute a possession intelligence score approximately from:

- net territorial advancement;
- expected-threat improvement;
- lines broken;
- pressure escaped;
- high-value space entered;
- chance created;
- possession retained under pressure.

Apply penalties for:

- repetitive identical circulation;
- needless retreat;
- avoidable turnovers;
- endless safe passes without tactical effect.

Do not expose this metric directly to player AI.

It exists to judge engine quality.

---

# 85. DESIRED LONG-POSSESSION BEHAVIOR

Across sufficient matches the engine should produce sequences such as:

CB → FB → CM → CB → GK → opposite CB → DM → CM → winger → FB → winger → striker.

This is an 11-pass possession.

It remains meaningful because the circulation:

1. absorbs pressure;
2. changes attacking side;
3. progresses through midfield;
4. enters final third.

The engine should also recognize when three direct passes are more intelligent than eleven.

---

# 86. CHANCE CREATION

Desired chance types include:

- through ball;
- cutback;
- cross;
- transition;
- second ball;
- overlap;
- central combination;
- long shot;
- set piece;
- defensive mistake.

Chance distribution should emerge from tactics and players.

A crossing team creates more crossing chances.

A narrow technical team creates more combinations.

---

# 87. SHOT QUALITY

Track a lightweight internal xG estimate for testing.

Inputs:

- shot distance;
- angle;
- body pressure;
- goalkeeper positioning;
- blocking defenders;
- shot type;
- ball height;
- player balance.

This allows calibration of whether teams are creating realistic opportunities.

It does not dictate whether a shot becomes a goal.

---

# 88. STATISTICAL REALISM

Statistical calibration should occur across thousands of simulated games.

Do not tune one match.

For roughly equal professional teams, use broad initial targets rather than rigid quotas.

Suggested generic calibration envelope:

- approximately 2.4–3.0 total goals per match;
- approximately 20–30 total shots;
- approximately 7–12 shots on target;
- plausible distribution of 0–0, 1–0, 1–1, 2–1, 2–2, etc.;
- possession naturally ranging widely by matchup;
- pass completion responding strongly to team quality/style;
- realistic fouls, cards, corners and offsides.

These are initial simulation targets, not immutable laws.

Before final balancing, select one real competition and season as the statistical reference dataset.

---

# 89. SCORELINE CALIBRATION

Never artificially suppress or create goals to hit the average.

Instead tune upstream systems:

If too many goals:

- examine defensive organization;
- shot quality;
- goalkeeper reaction;
- finishing error;
- transition defense;
- marking;
- tackle frequency.

If too few goals:

- examine movement;
- creative passing;
- final-third occupation;
- shooting willingness;
- goalkeeper strength;
- defensive compactness.

The resulting score distribution must emerge from football.

---

# 90. MATCH TELEMETRY

Every significant event should be recorded.

Examples:

```
PASS_ATTEMPT
PASS_COMPLETE
PROGRESSIVE_PASS
LINE_BREAK
THROUGH_BALL
CARRY
DRIBBLE
RUN_STARTED
RUN_RECEIVED
PRESS_STARTED
PRESS_SUCCESS
PRESS_BYPASSED
INTERCEPTION
TACKLE
SHOT
SAVE
GOAL
FOUL
OFFSIDE
TURNOVER
FINAL_THIRD_ENTRY
BOX_ENTRY
```

---

# 91. DECISION TELEMETRY

For debugging, store:

- chosen action;
- considered alternatives;
- utility scores;
- utility components;
- perception confidence;
- current role;
- team intent;
- player intent.

Example:

```
Player 8 decision:

PASS_TO_11 = 0.74
PASS_TO_6  = 0.51
CARRY      = 0.46
SHOOT      = 0.08

Reason:
+0.28 progression
+0.23 receiver space
+0.19 line break
+0.11 tactical fit
-0.07 interception risk
```

This will be extraordinarily valuable during development.

---

# 92. DEBUG OVERLAY

Toggleable overlays should show:

- player IDs;
- role;
- current intention;
- target point;
- perception cone;
- pressure map;
- passing lanes;
- defensive responsibility;
- formation anchors;
- offside line;
- control regions;
- support targets;
- movement paths;
- current utility decision.

The production game hides these.

The development suite relies heavily upon them.

---

# 93. AI SCENARIO LAB

Create a separate development page.

Suggested:

`ai_lab.html`

It should load small controlled scenarios.

Examples:

### 2v1

Does attacker recognize spare teammate?

### 3v2 transition

Do runners create useful separation?

### 4v4+3 possession

Can agents continually create support angles?

### 6v4 buildup

Can possession team escape press?

### Through-ball test

Does striker time run against high line?

### Low block

Can attack circulate and eventually change point of attack?

### High press

Do defenders press coherently?

### Defensive transition

Do appropriate players counterpress while others recover?

Every scenario can run hundreds of times automatically.

---

# 94. FORMATION LAB

Create:

`formation_lab.html`

Allow:

- drag ball around pitch;
- select phase;
- switch formations;
- toggle opposition;
- visualize desired player positions.

This can reveal structural problems instantly.

Examples:

- excessive midfield spacing;
- fullbacks too narrow;
- defensive line disconnected;
- striker dropping too deep.

---

# 95. PHYSICS LAB

Create:

`physics_lab.html`

Test:

- pass speeds;
- ball roll;
- lob trajectories;
- shots;
- bounce;
- post collision;
- first touch;
- heading;
- tackling;
- goalkeeper dives.

Every test should allow slow motion.

---

# 96. RULES LAB

Create:

`rules_lab.html`

Scenarios:

- borderline offside;
- passive offside;
- foul inside/outside penalty area;
- advantage;
- ball crossing line;
- corner vs goal kick;
- handball if modeled;
- direct/indirect free kicks;
- goalkeeper handling restrictions.

Run deterministic assertions.

---

# 97. BATCH MATCH SIMULATOR

Create:

`batch_sim.html`

Run:

- 100;
- 1,000;
- 10,000+

matches without rendering.

Aggregate:

- goals;
- scorelines;
- shots;
- xG;
- possession;
- passes;
- progressive passes;
- pass-chain distribution;
- fouls;
- cards;
- offsides;
- corners;
- turnovers;
- goalkeeper saves.

Allow team-vs-team and identical-team testing.

---

# 98. BEHAVIOR AUDITOR

Create automatic detectors for known bad football.

Examples:

### Pass-loop detector

Flags repeated A↔B circulation.

### Formation-collapse detector

Flags excessive player clustering.

### Chase-ball detector

Flags too many defenders pursuing ball.

### Static-support detector

Flags possession where teammates fail to create options.

### Press-suicide detector

Flags press that repeatedly exposes enormous central gaps.

### Offside-run detector

Flags attackers repeatedly standing unnecessarily offside.

### GK-freeze detector

Flags goalkeeper failing to react.

### Rotation-chatter detector

Flags players continuously switching targets.

These automated QA tools are essential.

---

# 99. 2.5D RENDERING MODEL

Simulation remains top-down Cartesian.

Rendering applies an isometric projection.

Conceptually:

```
screenX = (worldX - worldY) * horizontalScale
screenY = (worldX + worldY) * verticalScale - height
```

Actual camera rotation and pitch scaling can be configurable.

Use Canvas 2D initially.

22 footballers plus ball and referee are comfortably manageable.

---

# 100. DEPTH SORTING

Render entities according to projected depth.

Suggested order:

1. pitch;
2. pitch markings;
3. shadows;
4. goals;
5. players/referee;
6. elevated ball;
7. foreground goal elements;
8. UI.

Players sort dynamically using projected Y.

---

# 101. PLAYER VISUALS

Create stylized miniature footballers procedurally.

Components:

- head;
- torso;
- shorts;
- legs;
- boots;
- arms;
- shirt number.

Team kits define:

- primary;
- secondary;
- trim.

Players may differ in:

- height;
- build;
- skin tone;
- hair;
- boot appearance.

No external image assets are required.

---

# 102. PROCEDURAL ANIMATION

Each player maintains:

- stride phase;
- body facing;
- movement direction;
- torso angle;
- leg targets;
- arm swing;
- contact state.

Animation states include:

- idle;
- walk;
- jog;
- sprint;
- accelerate;
- decelerate;
- turn;
- receive;
- pass;
- shoot;
- cross;
- tackle;
- slide;
- jump;
- header;
- stumble;
- celebrate.

Blend between states rather than snapping.

---

# 103. FOOT PLACEMENT

Approximate procedural IK.

For each leg:

1. calculate desired foot anchor;
2. determine knee;
3. solve two-segment leg;
4. keep planted foot stationary during relevant gait phase.

Even simplified procedural IK will dramatically improve appearance.

---

# 104. BALL-CONTACT ANIMATION

Passes and shots should synchronize:

- backswing;
- plant foot;
- contact frame;
- follow-through.

Ball impulse occurs exactly at procedural contact.

This tightly connects animation and physics.

---

# 105. GOALKEEPER ANIMATION

Additional goalkeeper procedural states:

- set stance;
- shuffle;
- rush;
- low dive;
- high dive;
- catch;
- parry;
- smother;
- punch;
- throw;
- kick.

Dive endpoint should correspond to actual predicted ball interception.

---

# 106. CAMERA

Default camera:

**wide isometric broadcast view.**

Camera follows the meaningful area around the ball using spring smoothing.

It should anticipate movement slightly rather than lagging behind.

Alternative modes:

- broadcast;
- tactical wide;
- full pitch;
- ball follow.

---

# 107. STUDIO PRESENTATION

Tabletop Football should feel like a complete football broadcast/game rather than a simulation demo.

Match flow:

### Match loading

Fade.

### Stadium/tabletop reveal

Camera settles.

### Team cards

Home vs Away.

### Formation presentation

Brief lineup display.

### Kickoff

Scorebug appears.

### Goal

Score animation → celebration → optional replay → kickoff transition.

### Half-time

Stats card.

### Second half

Presentation transition.

### Full-time

Score → match summary → key statistics.

---

# 108. SCOREBUG

Display:

- team abbreviations;
- score;
- match clock;
- cards if desired.

Keep presentation compact.

---

# 109. EVENT GRAPHICS

Brief overlays:

- GOAL;
- yellow card;
- red card;
- substitution;
- offside;
- added time.

Avoid overwhelming the tabletop presentation.

---

# 110. REPLAYS

Because simulation is deterministic, maintain several seconds of state history.

For important events:

- temporarily switch camera;
- replay state history;
- use slow motion;
- return to live state.

Events worth replaying:

- goals;
- excellent saves;
- major chances.

---

# 111. AUDIO

Everything can remain self-contained using WebAudio.

Procedural sounds:

- kick contact;
- whistle;
- goal impact;
- post;
- crowd ambience;
- crowd reaction.

This avoids external assets.

---

# 112. SINGLE-FILE ARCHITECTURE

Production deliverable:

`tabletop_football.html`

Contains:

```html
<style>
all presentation CSS
</style>

<canvas id="game"></canvas>

<script>
all simulation code
all AI code
all rendering code
all data
all UI code
</script>
```

No required network access.

No external libraries.

No external images.

No external fonts.

Opening the file should immediately work.

---

# 113. DEVELOPMENT ARCHITECTURE

During development, code should remain modular.

Suggested source structure:

```
src/
    core/
        clock.js
        rng.js
        vector.js

    simulation/
        world.js
        ball.js
        player.js
        physics.js

    intelligence/
        perception.js
        beliefs.js
        prediction.js
        spatial.js
        candidateActions.js
        utility.js
        movement.js

    tactics/
        formation.js
        teamIntent.js
        transition.js
        pressing.js
        marking.js

    roles/
        goalkeeper.js
        defender.js
        midfielder.js
        forward.js

    rules/
        referee.js
        offside.js
        fouls.js
        restarts.js

    presentation/
        renderer.js
        camera.js
        animation.js
        ui.js

    telemetry/
        events.js
        metrics.js
        diagnostics.js
```

A build step can combine everything into one HTML.

Runtime remains single-file.

---

# 114. CORE OBJECT MODEL

Primary objects:

```
Game
Match
World
Pitch
Ball
Team
Player
Referee
RulesEngine
TacticalController
PerceptionSystem
SpatialAnalyzer
DecisionSystem
PhysicsSystem
Renderer
Telemetry
ReplayBuffer
```

---

# 115. PLAYER STATE MODEL

Example conceptual state:

```
PlayerState
{
    position
    velocity
    facing

    stamina
    balance

    ballControlState

    role
    tacticalAnchor

    perception
    beliefState

    currentIntent
    currentAction

    actionTarget
    movementTarget

    decisionCooldown

    attributes
    tendencies
}
```

---

# 116. BALL STATE

```
BallState
{
    position
    velocity
    spin

    lastTouchPlayer
    lastTouchTeam

    possessionCandidate
}
```

Avoid assigning absolute ball possession unless appropriate.

Loose balls should genuinely exist.

---

# 117. MATCH STATE

```
MatchState
{
    period
    clock
    addedTime

    score

    possessionTeam

    restartType
    restartTeam

    tacticalPhase

    rulesState
}
```

---

# 118. PERFORMANCE STRATEGY

Twenty-two agents are not computationally expensive if systems are layered appropriately.

Use:

- spatial hashing;
- cached pressure maps;
- staggered AI updates;
- fixed-rate tactical updates;
- reused arrays;
- limited garbage creation;
- object pooling if required.

Never calculate expensive global maps independently for each player.

A shared world analysis can provide objective geometric values.

Players then perceive imperfect subsets of that information.

---

# 119. OPTIONAL WEB WORKER

If batch simulation becomes expensive, create a Worker from an embedded Blob.

This retains the single-file requirement.

Possible uses:

- batch statistical simulation;
- tactical map generation;
- background analytics.

The playable match itself should preferably remain simple enough not to require this.

---

# 120. INTELLIGENCE QUALITY TIERS

Player attributes should produce visible qualitative differences.

### Low intelligence

- late scanning;
- fewer alternatives considered;
- weak prediction;
- poor support position;
- rushed decisions.

### Average

- competent positional play;
- obvious passes;
- reasonable anticipation.

### Elite

- frequent scanning;
- anticipates pressure;
- finds third-man options;
- recognizes switches;
- disguises decisions;
- times runs;
- creates space for others.

This will make generated footballers genuinely interesting.

---

# 121. PLAYER UNIQUENESS

Two players with identical technical passing should still behave differently.

Example:

Player A:

- high vision;
- low risk appetite;
- high teamwork.

Result:

excellent circulation and progression with few reckless balls.

Player B:

- high creativity;
- high risk appetite;
- low patience.

Result:

attempts spectacular through balls more often.

Both can be valuable in different systems.

---

# 122. FORMATION EXAMPLES

## 4-3-3 Possession

GK: Distributor  
RB: Supporting fullback  
RCB: Ball-playing defender  
LCB: Cover defender  
LB: Attacking fullback  
DM: Holding playmaker  
RCM: Box-to-box  
LCM: Creative midfielder  
RW: Wide winger  
LW: Inside forward  
ST: Complete forward

Expected emergent behavior:

- three-player buildup;
- midfield triangles;
- width one side;
- half-space occupation opposite side;
- rotations;
- overlapping fullback;
- high possession.

---

## 4-4-2 Mid Block

Expected behavior:

- compact two banks;
- forwards screen midfield;
- pressing triggers on wide passes;
- fast transitions;
- crossing;
- two-striker combinations.

---

## 4-2-3-1 Balanced

Expected behavior:

- double pivot stability;
- number 10 between lines;
- varied buildup;
- winger/fullback combinations.

---

## 3-4-2-1

Expected behavior:

- wing-backs provide width;
- two attacking midfielders occupy half-spaces;
- three defenders provide rest defense;
- strong central overload.

---

## 3-5-2

Expected behavior:

- central midfield superiority;
- wing-back width;
- paired forward movement;
- vulnerable wide transition spaces.

---

# 123. TEST TEAM GENERATION

Initial game should randomly generate two complete squads.

Recommended:

- 18–20 players per team;
- 11 selected automatically;
- bench;
- varied qualities.

Generate contrasting tactical identities.

Example:

**Redbridge FC**

4-3-3  
technical possession team  
patient buildup  
high line  
aggressive counterpress

**Ashford Athletic**

4-4-2  
direct attacking style  
medium block  
fast forwards  
dangerous transitions

This gives immediate behavioral contrast.

---

# 124. MATCH SELECTION UI

Initial screen:

TABLETOP FOOTBALL

Home Team  
Formation selector

Away Team  
Formation selector

Options:

- Generate Teams
- Match Speed
- Debug Mode
- Start Match

Later:

- tactical sliders;
- player inspection;
- lineup changes.

---

# 125. PLAYER INSPECTION

Clicking a player can display:

- name;
- role;
- attributes;
- traits;
- current stamina;
- match statistics.

In debug mode additionally show:

- current thought/intention;
- perception;
- utility choices.

Example:

> **M. Diallo — CM**  
> Intention: support progression  
> Sees left winger isolated  
> Pressure: moderate  
> Considering: switch / recycle / carry

This could become a distinctive feature of Tabletop Football.

---

# 126. BEHAVIORAL ACCEPTANCE TESTS

The engine should pass football tests, not merely code tests.

## Possession Test

Run 100 possession scenarios.

Pass if agents can periodically sustain 8–12+ meaningful passes while still seeking progression.

Fail if:

- sequences constantly terminate after 2–3 passes;
- players have no support;
- sequences consist primarily of sterile A↔B loops.

---

## Through-Ball Test

Place passer with time and runner near high line.

Expected:

- runner recognizes space;
- runner stays approximately onside;
- passer recognizes run;
- weighted ball targets future interception point.

---

## Press Test

Opponent receives facing own goal.

Expected:

- appropriate defender presses;
- nearby players block options;
- distant players maintain structure.

Failure:

six players chase ball.

---

## Low-Block Test

Attack against compact defense.

Expected:

- circulation;
- width;
- switches;
- supporting triangles;
- patience;
- eventual penetration attempts.

---

## Counterattack Test

Start from defensive turnover.

Expected:

- forward runners attack free space;
- ball carrier recognizes numerical advantage;
- defenders recover centrally.

---

## Goalkeeper Test

Through ball behind high defense.

Expected behavior differs between:

- sweeper keeper;
- conservative keeper.

---

# 127. MASS ACCEPTANCE TESTS

Run at least:

**10,000 simulated matches**

before calling match balance stable.

Monitor distributions, not only averages.

Important distributions:

- scoreline;
- goals;
- shots;
- possession;
- pass chains;
- possession duration;
- goals by attack type;
- turnovers;
- defensive errors;
- fouls;
- cards;
- offsides.

---

# 128. FOOTBALL QUALITY SCORECARD

Each engine build receives scores.

### Possession Intelligence
0–100

### Off-Ball Intelligence
0–100

### Defensive Cohesion
0–100

### Transition Intelligence
0–100

### Goalkeeper Intelligence
0–100

### Physics Realism
0–100

### Statistical Realism
0–100

### Visual Readability
0–100

### Rules Correctness
0–100

Track regressions between builds.

---

# 129. ANTI-REGRESSION LIBRARY

Every discovered ugly behavior becomes a permanent test.

Examples:

- player endlessly rotates;
- defenders run backward while facing wrong direction;
- goalkeeper ignores loose ball;
- striker continuously offside;
- midfield disappears during buildup;
- defender follows winger across entire pitch;
- keeper passes directly to opponent despite safe options;
- players repeatedly pass back and forth;
- four teammates occupy same space;
- runner stops just before through ball;
- player receiving ball refuses to turn despite free space.

Never fix these only visually.

Determine the underlying intelligence error.

---

# 130. EXPLAINABLE AI

One of the project's strongest engineering principles should be:

**Every surprising player decision should be inspectable.**

Developer can pause and click a player.

System shows:

- what player knew;
- what player predicted;
- what alternatives existed;
- what utility each received;
- why the final action won.

This dramatically reduces development difficulty.

---

# 131. AUTOMATED PARAMETER CALIBRATION

Once systems are functioning, a separate optimization harness may tune global parameters.

Potential methods:

- evolutionary search;
- CMA-ES;
- Bayesian optimization;
- simple random search.

Objective could compare simulated distributions against target football distributions.

However:

Do not allow calibration to hide defective football.

A statistically accurate engine that looks absurd is still wrong.

Behavioral acceptance tests take priority.

---

# 132. OPTIONAL LEARNING SYSTEMS

Machine learning is not required for the core intelligence.

The recommended initial architecture is:

- interpretable;
- hierarchical;
- utility-based;
- predictive;
- adaptive.

Later ML/RL may optimize:

- utility weights;
- tactical adaptations;
- parameter calibration.

But learned systems should not replace inspectability until the deterministic architecture is mature.

---

# 133. EMERGENT BEHAVIORS TO TARGET

The mature engine should occasionally generate all of the following without bespoke scripts:

- third-man run;
- give-and-go;
- overlap;
- underlap;
- winger isolation;
- overload-to-isolate;
- midfielder dropping between defenders;
- defender stepping into midfield;
- false-nine movement;
- striker pinning centre-back;
- delayed midfield box run;
- far-post winger run;
- diagonal switch;
- cutback;
- wall pass;
- counterpress;
- pressing trap;
- defensive rotation;
- offside line;
- keeper sweeping;
- goalkeeper used as extra buildup player;
- player intentionally recycling possession to change attack direction.

These become long-term validation milestones.

---

# 134. DEVELOPMENT ROADMAP

## M0 — Deterministic Foundation

Implement:

- pitch;
- clock;
- seeded RNG;
- entity system;
- fixed timestep;
- telemetry;
- replay state.

Exit criteria:

same seed produces identical simulation.

---

## M1 — Physical Football

Implement:

- player movement;
- orientation;
- ball movement;
- ground pass;
- lofted ball;
- shot;
- goal detection;
- basic collision.

Exit criteria:

basic football interactions feel physically coherent.

---

## M2 — Individual Intelligence

Implement:

- perception;
- scanning;
- memory;
- prediction;
- passing candidates;
- movement candidates;
- utility system.

Exit criteria:

small-sided scenarios produce recognizable football choices.

---

## M3 — Team Structure

Implement:

- formations;
- role anchors;
- support positioning;
- attacking width/depth;
- defensive compactness;
- phases.

Exit criteria:

11v11 shape remains coherent.

---

## M4 — Advanced Possession

Implement:

- progression analysis;
- through balls;
- off-ball runs;
- switches;
- third-man support;
- pressure escape.

Exit criteria:

meaningful 8–10+ pass possessions appear naturally.

---

## M5 — Intelligent Defense

Implement:

- pressure decisions;
- coverage;
- zonal responsibility;
- mark transfer;
- defensive line;
- counterpress/recovery.

Exit criteria:

defense behaves collectively rather than chasing ball.

---

## M6 — Goalkeepers

Implement:

- positioning;
- saves;
- sweeping;
- crosses;
- distribution.

Exit criteria:

goalkeeper visibly behaves differently from an outfield player and different GK profiles matter.

---

## M7 — Full Rules

Implement:

- offside;
- fouls;
- advantage;
- cards;
- restarts;
- penalties;
- added time;
- substitutions.

Exit criteria:

normal match can run start-to-finish without manual intervention.

---

## M8 — Statistical Calibration

Run thousands of games.

Tune:

- shot creation;
- finishing;
- defensive success;
- goalkeeper performance;
- passing;
- tempo.

Exit criteria:

scorelines and match statistics fall into believable distributions.

---

## M9 — Procedural Presentation

Implement:

- isometric renderer;
- players;
- procedural locomotion;
- passing/shooting animation;
- goalkeeper animation;
- referee;
- camera.

Exit criteria:

football is clearly readable without debug overlays.

---

## M10 — Studio Layer

Implement:

- match introduction;
- scorebug;
- halftime;
- full-time;
- cards;
- substitutions;
- goal transitions;
- replays;
- audio.

Exit criteria:

match feels like a finished game rather than simulation tooling.

---

## M11 — Single-HTML Release Build

Bundle:

- CSS;
- renderer;
- simulation;
- generated player data;
- UI;
- audio synthesis.

Exit criteria:

`tabletop_football.html`

opens locally in a browser and requires no server or internet connection.

---

# 135. FIRST PLAYABLE VERSION DEFINITION

The first version should not attempt every advanced behavior.

It should qualify as playable when:

- two generated teams exist;
- players have distinct attributes;
- formations matter;
- two 45-minute halves operate;
- teams independently attack and defend;
- possession changes naturally;
- passing chains occur;
- players make forward runs;
- through balls occur;
- defenders maintain recognizable structure;
- goalkeepers behave intelligently;
- shots arise from actual opportunities;
- goals result from physics;
- offside works;
- major restarts work;
- referee exists;
- average scoring is believable;
- match can finish cleanly;
- game works from one HTML file.

---

# 136. SECONDARY POLISH TARGETS

After first playable:

- richer set pieces;
- injuries;
- assistant referees;
- more formation roles;
- tactical editing;
- improved referee decisions;
- celebrations;
- extra procedural animations;
- weather;
- pitch wear;
- crowd;
- stadium/tabletop themes;
- career/tournament modes.

None should precede football intelligence.

---

# 137. PRIORITY ORDER

If forced to choose between:

**better graphics** and **better football**

choose better football.

If forced to choose between:

**more features** and **better player intelligence**

choose intelligence.

If forced to choose between:

**perfect match statistics** and **believable causal football**

choose causal football.

Statistical realism should eventually follow believable systems.

---

# 138. FINAL ENGINE PHILOSOPHY

The key question for every player should continuously be:

> Given what I currently know, what am I responsible for, what is likely to happen next, and what action gives my team the best outcome?

Not:

> Which animation should I play?

Not:

> Which predefined football pattern is currently active?

Not:

> Where is my formation coordinate?

Tabletop Football succeeds when twenty-two independent players collectively produce something that resembles actual football.

The strongest indication that the system works will be moments that were never explicitly programmed:

A midfielder scans before receiving.

He notices the winger staying wide.

The opposing midfielder presses.

The fullback moves underneath him.

The winger recognizes the vacated channel and runs inside.

The midfielder turns away from pressure.

The centre-back steps toward him.

He slips the ball past that defender.

The striker sees the goalkeeper coming.

Instead of shooting, he squares it.

A teammate arrives late.

Goal.

No function called `createGoodFootballSequence()`.

No pre-scripted goal.

No forced pass chain.

Just twenty-two players perceiving, predicting, occupying space, cooperating, making mistakes and making decisions.

**That is the central promise of Tabletop Football.**