
import * as bt from './BehaviorTree';
import { me } from './ObjectManager';
import { losExclude, castWhileMoveAuras, castWhileMove } from "../Data/Exclusions";
import { DispelPriority, dispels } from "../Data/Dispels";
import { interrupts } from '@/Data/Interrupts';
import Settings from './Settings';
import { defaultHealTargeting as heal } from '@/Targeting/HealTargeting';
import { defaultCombatTargeting as combat } from '@/Targeting/CombatTargeting';
import CommandListener from './CommandListener';

class Spell extends wow.EventListener {
  constructor() {
    super();
    this._currentTarget = null;
    this._lastCastTimes = new Map();
    this._lastSuccessfulCastTimes = new Map();
    this._lastSuccessfulSpells = []; // Array to store the last successful spells
  }

  /** @type {{get: function(): (wow.CGUnit|undefined)}} */
  _currentTarget;

  /** @type {Map<number, number>} */
  _lastCastTimes = new Map();

  /** @type {Map<number, number>} */
  _lastSuccessfulCastTimes = new Map();

    /** @type {Array<{spellName: string, targetName: string, timestamp: number}>} */
    _lastSuccessfulSpells = [];

    _lastSpell;

  onEvent(event) {
    if (event.name === "COMBAT_LOG_EVENT_UNFILTERED") {
      const [eventData] = event.args;

      if (eventData.eventType === 6) { // SPELL_CAST_SUCCESS
        if (eventData.source.guid.equals(me.guid)) {
          const spellId = eventData.args[0];
          const castSpell = new wow.Spell(spellId);
          const spellName = castSpell.name.toLowerCase();
          const targetName = eventData.target ? eventData.target.unsafeName : "Unknown";
          this._lastSuccessfulCastTimes.set(spellName, wow.frameTime);
          this._lastCastTimes.set(spellId, wow.frameTime);

          // Add to spell history array for combo strike tracking
          this._lastSuccessfulSpells.push({
            name: castSpell.name, // Use proper case name
            id: spellId,
            spellName: spellName, // Keep lowercase for compatibility
            targetName: targetName,
            timestamp: wow.frameTime
          });
          
          // Keep only the last 10 spells to prevent memory bloat
          if (this._lastSuccessfulSpells.length > 10) {
            this._lastSuccessfulSpells.shift();
          }

          // Check if there's a queued spell before removing it
          const queuedSpell = CommandListener.getNextQueuedSpell();
          if (queuedSpell && queuedSpell.spellName === spellName) {
            CommandListener.removeSpellFromQueue(spellName);
          }
        }
      }
    }
  }

  /**
   * Constructs and returns a sequence of actions for casting a spell.
   *
   * @param {string | number} spell - The spell to cast, specified by name (string) or ID (number).
   * @param {...(function | Object)} args - Additional functions that can determine the target of the spell or
   *                                        conditions to be checked before casting. The last argument can be an
   *                                        options object to specify which checks to skip.
   *
   * @throws {Error} - Throws an error if no arguments are provided to the function.
   *
   * @returns {bt.Sequence} - A behavior tree sequence that handles the spell casting logic.
   */
  cast(...args) {
    if (arguments.length === 0) {
      throw "no arguments given to Spell.cast";
    }

    let spellToCast = arguments[0];
    const rest = Array.prototype.slice.call(arguments, 1);
    const sequence = new bt.Sequence(`Cast: ${spellToCast.toString()}`);

    // Default options
    let options = {
      skipUsableCheck: false,
      skipMovingCheck: false,
      skipRangeCheck: false,
      skipLineOfSightCheck: false
    };

    // Check if the last argument is an options object
    if (typeof rest[rest.length - 1] === 'object') {
      options = { ...options, ...rest.pop() };
    }

    sequence.addChild(new bt.Action(() => {
      // Check if there's a queued spell
      const queuedSpell = CommandListener.getNextQueuedSpell();
      if (queuedSpell) {
        const spell = this.getSpell(queuedSpell.spellName);
        const target = CommandListener.targetFunctions[queuedSpell.target]();

        if (!target) {
          console.info(`Target ${queuedSpell.target} not found. Removing from queue.`);
          CommandListener.removeSpellFromQueue(queuedSpell.spellId);
          return bt.Status.Failure;
        }

        if (me.isCastingOrChanneling) {
          return bt.Status.Failure;
        }

        // Use only canCast check, which includes range check
        if (spell && this.canCast(spell, target, options)) {
          spellToCast = queuedSpell.spellName;
          this._currentTarget = target;
          if (this.castPrimitive(spell, target)) {
            return bt.Status.Success;
          }
        }
        return bt.Status.Failure;
      }

      // If no queued spell, proceed with normal targeting
      this._currentTarget = me.targetUnit;
      return bt.Status.Success;
    }));

    // Only add the rest of the sequence if it wasn't a queued spell
    if (!CommandListener.getNextQueuedSpell()) {
      for (const arg of rest) {
        if (typeof arg === 'function') {
          sequence.addChild(new bt.Action(() => {
            const r = arg();
            if (r === false || r === undefined || r === null) {
              return bt.Status.Failure;
            } else if (r instanceof wow.CGUnit || r instanceof wow.Guid) {
              this._currentTarget = r;
            }
            return bt.Status.Success;
          }));
        } else {
          try {
            throw new Error(`Invalid argument passed to Spell.cast: expected function got ${typeof arg}`);
          } catch (e) {
            console.warn(e.message);
            console.warn(e.stack.split('\n')[1]);
          }
        }
      }

      sequence.addChild(this.castEx(spellToCast, options));
    }

    return sequence;
  }

  /**
   * Unified casting method that handles casting a spell by ID or name.
   * @param {number | string} spellNameOrId - The spell ID or name.
   * @param {Object} options - Options for skipping certain checks.
   * @returns {bt.Sequence} - The behavior tree sequence for casting the spell.
   */
  castEx(spellNameOrId, options) {
    return new bt.Sequence(
      new bt.Action(() => {
        let target = this._currentTarget;
        if (!target) {
          target = me.targetUnit;
        }

        if (!(target instanceof wow.CGUnit)) {
          return bt.Status.Failure;
        }

        const spell = this.getSpell(spellNameOrId);
        if (!spell) {
          return bt.Status.Failure;
        }

        const currentTime = wow.frameTime;
        const lastCastTime = this._lastCastTimes.get(spell.id);
        if (lastCastTime && currentTime - lastCastTime < 200) {
          return bt.Status.Failure;
        }

        if (!this.canCast(spell, target, options)) {
          return bt.Status.Failure;
        }
        if (!this.castPrimitive(spell, target)) {
          return bt.Status.Failure;
        }

        this._lastCastTimes.set(spell.id, currentTime);
        return bt.Status.Success;
      }),

      new bt.Action(() => {
        this._lastSpell = spellNameOrId;
        const defaultSpellId = wow.SpellBook.singleButtonAssistantSpellId;
        let defaultInfo = 'none';
        if (defaultSpellId > 0) {
          const defaultSpell = new wow.Spell(defaultSpellId);
          defaultInfo = `${defaultSpellId} (${defaultSpell.name || 'unknown'})`;
        }
        console.info(`Cast ${spellNameOrId} on ${this._currentTarget?.unsafeName} — default rotation says: ${defaultInfo}`);
        return bt.Status.Success;
      })
    );
  }

  /**
   * Determines whether a spell can be cast on a given target.
   *
   * @param {wow.Spell} spell - The spell to be cast.
   * @param {wow.CGUnit | wow.Guid} target - The target on which the spell is to be cast.
   * @param {Object} options - Options for skipping certain checks.
   * @returns {boolean} - Returns true if the spell can be cast, false otherwise.
   */
  canCast(spell, target, options) {
    if (!spell || spell.name === undefined) {
      return false;
    }

    if (!target) {
      return false;
    }

    if (!spell.isKnown) {
      return false;
    }

    if (!this.canCastAfterDelay(spell)) {
      return false;
    }

    const cooldown = spell.cooldown;
    if (!cooldown.ready || !cooldown.active) {
      return false;
    }

    if (!options.skipUsableCheck && !spell.isUsable) {
      return false;
    }

    if (!options.skipMovingCheck && spell.castTime > 0 && me.isMoving()) {
      const canCastWhileMoving = me.auras.find(aura => castWhileMoveAuras[aura.spellId]) || castWhileMove[spell.id];
      if (!canCastWhileMoving) {
        return false;
      }
    }

    if (!options.skipLineOfSightCheck && (target instanceof wow.CGUnit && !losExclude[target.entryId]) && !me.withinLineOfSight(target)) {
      return false;
    }

    if (!options.skipRangeCheck && (target instanceof wow.CGUnit && !losExclude[target.entryId]) && !this.inRange(spell, target)) {
      return false;
    }

    return true;
  }

  /**
   *
   * @param {wow.Spell} spell
   * @returns {boolean}
   */
  castPrimitive(spell, target) {
    return spell.cast(target);
  }

  /**
   * Helper function to retrieve a spell by ID or name.
   * This function first tries to retrieve the spell directly by ID or name. If not found,
   * it then iterates through the player's spellbook and constructs spells using their
   * override ID to check for matches. If an override ID is provided, it automatically
   * returns the base spell to ensure proper spell recognition.
   *
   * @param {number | string} spellNameOrId - The spell ID or name.
   * @returns {wow.Spell | null} - The spell object, or null if not found.
   */
  getSpell(spellNameOrId) {
    let spell;

    // First, attempt to get the spell directly by ID or name
    if (typeof spellNameOrId === 'number') {
      spell = new wow.Spell(spellNameOrId);
    } else if (typeof spellNameOrId === 'string') {
      spell = wow.SpellBook.getSpellByName(spellNameOrId);
    } else {
      console.error("Invalid argument type for getSpell method");
      throw new Error("Invalid argument type for getSpell method");
    }

    // If the spell was found and is known, return it immediately
    if (spell && spell.isKnown) {
      return spell;
    }

    // If spell wasn't found or isn't known, check if it's an override ID in the spellbook
    const playerSpells = wow.SpellBook.playerSpells;
    const isStringSearch = typeof spellNameOrId === 'string';
    const lowerCaseSearchName = isStringSearch ? spellNameOrId.toLowerCase() : null;

    for (const playerSpell of playerSpells) {
      // Check if the provided ID matches either the base ID or override ID
      if (!isStringSearch) {
        if (playerSpell.id === spellNameOrId || playerSpell.overrideId === spellNameOrId) {
          // Always return the base spell (using playerSpell.id) for proper recognition
          return new wow.Spell(playerSpell.id);
        }
      } else {
        // For string names, check both base and override spell names
        // Only create override spell if IDs are different
        if (playerSpell.id !== playerSpell.overrideId) {
          const baseSpell = new wow.Spell(playerSpell.id);
          const overrideSpell = new wow.Spell(playerSpell.overrideId);

          if (baseSpell.name.toLowerCase() === lowerCaseSearchName ||
              overrideSpell.name.toLowerCase() === lowerCaseSearchName) {
            return baseSpell; // Always return the base spell
          }
        } else {
          // If base and override are the same, only check base spell
          const baseSpell = new wow.Spell(playerSpell.id);
          if (baseSpell.name.toLowerCase() === lowerCaseSearchName) {
            return baseSpell;
          }
        }
      }
    }

    // Return null if no match is found
    return null;
  }


  /**
   * Checks if the global cooldown (GCD) is currently active.
   *
   * The global cooldown is a short, universal cooldown that prevents spells from being cast
   * in quick succession. If the GCD is active, certain abilities may not be cast until it ends.
   *
   * @returns {boolean} - Returns true if the global cooldown is active, false otherwise.
   */
  isGlobalCooldown() {
    const gcd = wow.SpellBook.gcdSpell;
    if (gcd && !gcd.cooldown.ready) {
      return true;
    }
    return false;
  }

  /**
   * Attempts to apply an aura (buff/debuff) to a unit by casting the specified spell.
   *
   * The aura will only be applied if the target unit doesn't already have the aura, or if
   * the remaining duration of the aura is low. Optionally, the `expire` flag forces the
   * aura to be reapplied regardless of its remaining duration.
   *
   * @param {number | string} spellNameOrId - The name or ID of the spell that applies the aura.
   * @param {wow.CGUnit} unit - The target unit on which to apply the aura.
   * @param {boolean} [expire=false] - If true, forces the aura to be reapplied regardless of remaining duration.
   * @returns {bt.Sequence} - A behavior tree sequence that handles the aura application logic.
   */
  applyAura(spellNameOrId, unit, expire = false) {
    return new bt.Sequence(
      new bt.Action(() => {
        if (!unit) {
          console.info("No unit passed to function Apply");
          return bt.Status.Failure;
        }

        const aura = unit.getAuraByMe(spellNameOrId);
        if (aura && ((aura.remaining > 2000 || aura.remaining === 0) || expire)) {
          return bt.Status.Failure;
        }

        this._currentTarget = unit;
        return bt.Status.Success;
      }),
      this.castEx(spellNameOrId)
    );
  }

  /**
   * Attempts to interrupt a casting or channeling spell on nearby enemies or players.
   *
   * This method checks for units around the player within the interrupt spell's range.
   * It attempts to interrupt spells based on the configured interrupt mode and percentage.
   * For cast spells, it uses the configured interrupt percentage.
   * For channeled spells, it checks if the channel time is greater than a randomized value
   * between 300 and 1100 milliseconds (700 ± 400).
   *
   * @param {number | string} spellNameOrId - The ID or name of the interrupt spell to cast.
   * @param {boolean} [interruptPlayersOnly=false] - If set to true, only player units will be interrupted.
   * @param {number} [customRange=null] - Optional custom range override. If provided, uses this instead of spell.baseMaxRange.
   * @returns {bt.Sequence} - A behavior tree sequence that handles the interrupt logic.
   */
  interrupt(spellNameOrId, interruptPlayersOnly = false, customRange = null) {
    return new bt.Sequence(`Interrupt using ${spellNameOrId.toString()}`,
      new bt.Action(() => {
        // Early return if interrupt mode is set to "None"
        if (Settings.InterruptMode === "None") {
          return bt.Status.Failure;
        }

        const spell = this.getSpell(spellNameOrId);
        if (!spell || !spell.isUsable || !spell.cooldown.ready) {
          return bt.Status.Failure;
        }

        const spellRange = customRange !== null ? customRange : spell.baseMaxRange;
        const unitsAround = combat.targets;
        for (const target of unitsAround) {
          if (!(target instanceof wow.CGUnit)) {
            continue;
          }
          if (!target.isCastingOrChanneling) {
            continue;
          }
          if (interruptPlayersOnly && !target.isPlayer()) {
            continue;
          }
          // Use custom range if provided, otherwise use spell's range check
          if (customRange !== null) {
            if (me.distanceTo(target) > customRange) {
              continue;
            }
          } else {
            if (!spell.inRange(target) && !me.isWithinMeleeRange(target)) {
              continue;
            }
          }
          const castInfo = target.spellInfo;
          if (!castInfo) {
            continue;
          }
          if (!target.isInterruptible) {
            continue;
          }
          if (!me.isFacing(target)) {
            continue;
          }
          if (!me.withinLineOfSight(target)) {
            continue;
          }

          const currentTime = wow.frameTime;
          const castRemains = castInfo.castEnd - currentTime;
          const castTime = castInfo.castEnd - castInfo.castStart;
          const castPctRemain = (castRemains / castTime) * 100;
          const channelTime = currentTime - castInfo.channelStart;
          // Generate a random interrupt time between 300 and 1100 ms (700 ± 400)
          const randomInterruptTime = 700 + (Math.random() * 800 - 400);

          // Check if we should interrupt based on the settings
          let shouldInterrupt = false;
          if (Settings.InterruptMode === "Everything") {
            if (target.isChanneling) {
              shouldInterrupt = channelTime > randomInterruptTime;
            } else {
              shouldInterrupt = castPctRemain <= Settings.InterruptPercentage;
            }
          } else if (Settings.InterruptMode === "List") {
            if (target.isChanneling) {
              shouldInterrupt = interrupts[castInfo.spellCastId] && channelTime > randomInterruptTime;
            } else {
              shouldInterrupt = interrupts[castInfo.spellCastId] && castPctRemain <= Settings.InterruptPercentage;
            }
          }

          if (shouldInterrupt && spell.cast(target)) {
            const spellId = target.isChanneling ? target.currentChannel : target.currentCast;
            const interruptTime = target.isChanneling ? `${channelTime.toFixed(2)}ms` : `${castPctRemain.toFixed(2)}%`;
            console.info(`Interrupted ${spellId} using ${spell.name} being ${target.isChanneling ? 'channeled' : 'cast'} by: ${target.unsafeName} after ${interruptTime}`);
            return bt.Status.Success;
          }
        }
        return bt.Status.Failure;
      })
    );
  }

  /**
   * Dispel a debuff or buff from units, depending on if we are dispelling friends or enemies.
   * @param {number | string} spellNameOrId - The spell ID or name.
   * @param {boolean} friends - If true, dispel friendly units. If false, dispel enemies (for purge/soothe).
   * @param {number} priority - The priority level for dispel. Defaults to DispelPriority.Low if not provided.
   * @param {boolean} playersOnly - dispel only players - used for purge.
   * @param {...number} types - The types of dispel we can use, e.g., Magic, Curse, Disease, Poison.
   * @returns {bt.Status} - Whether a dispel was cast.
   */
  dispel(spellNameOrId, friends, priority = DispelPriority.Low, playersOnly = false, ...types) {
    return new bt.Sequence(
      new bt.Action(() => {
        // Early return if dispel mode is set to "None"
        if (Settings.DispelMode === "None") {
          return bt.Status.Failure;
        }

        const spell = this.getSpell(spellNameOrId);
        if (!spell || !spell.isUsable || !spell.cooldown.ready) {
          return bt.Status.Failure;
        }

        // List to target, either friends or enemies
        const list = friends ? heal.priorityList : combat.targets;
        if (!list) {
          console.error("No list was provided for Dispel");
          return bt.Status.Failure;
        }

        // Loop through each unit in the list
        for (const unit of list) {
          if (playersOnly && !unit.isPlayer()) {
            continue;
          }

          const auras = unit.auras;
          for (const aura of auras) {
            const dispelTypeMatch = types.includes(aura.dispelType);
            // Check for debuff/buff status, dispel priority, and aura duration remaining
            const dispelPriority = dispels[aura.spellId] || DispelPriority.Low;
            const isValidDispel = friends
              ? aura.isDebuff() && dispelPriority >= priority
              : aura.isBuff() && dispelPriority >= priority;

            if (isValidDispel && aura.remaining > 2000 && dispelTypeMatch) {
              const durationPassed = aura.duration - aura.remaining;

              // Check if we should dispel based on the settings
              let shouldDispel = false;

              if (Settings.DispelMode === "Everything") {
                shouldDispel = true;
              } else if (Settings.DispelMode === "List") {
                shouldDispel = dispels[aura.spellId] !== undefined
              }

              // Try to cast the dispel if it's been long enough and meets the dispel criteria
              if (shouldDispel && durationPassed > 777 && me.withinLineOfSight(unit) && spell.cast(unit)) {
                console.info(`Cast dispel on ${unit.unsafeName} to remove ${aura.name} with priority ${dispelPriority}`);
                return bt.Status.Success;
              }
            }
          }
        }
        return bt.Status.Failure;
      })
    );
  }

  /**
   * Retrieves the cooldown information of a spell.
   * @param {number | string} spellNameOrId - The name or ID of the spell.
   * @returns {{ duration: number, start: number, timeleft: number, active: number, modRate: number, ready: boolean } | null} - The cooldown information or null if the spell is not found.
   */
  getCooldown(spellNameOrId) {
    const spell = this.getSpell(spellNameOrId);

    if (!spell) {
      console.error(`Spell ${spellNameOrId} not found`);
      return null;
    }

    return spell.cooldown;
  }

  /**
   * Checks if a spell is currently on cooldown.
   * @param {number | string} spellNameOrId - The name or ID of the spell.
   * @returns {boolean} - Returns true if the spell is on cooldown (timeleft > 0), false otherwise.
   */
  isOnCooldown(spellNameOrId) {
    const cooldown = this.getCooldown(spellNameOrId);
    if (!cooldown) {
      // if it's undefined somehow - just let it be on cooldown.
      console.error('Spell getCooldown(' + spellNameOrId + ') is null or undefined');
      return true;
    }
    return cooldown.timeleft > 0;
  }

  /**
   * Retrieves the current charges of a spell.
   * @param {number | string} spellNameOrId - The name or ID of the spell.
   * @returns {number} - The charges
   */
  getCharges(spellNameOrId) {
    const spell = this.getSpell(spellNameOrId);
    if (!spell || !spell.charges) {
      return 0;
    }
    return spell.charges.charges || 0;
  }

  /**
   * Determines if the specified spell is in range of the target.
   *
   * This function checks whether the spell's `baseMaxRange` is 0, which implies the spell has no range limit
   * and can be cast regardless of distance. If `baseMaxRange` is greater than 0, it performs a range check
   * using the `spell.inRange()` method.
   *
   * @param {wow.Spell} spell - The spell to check.
   * @param {wow.CGUnit | wow.Guid} target - The target to check the range against.
   * @returns {boolean} - Returns `true` if the spell can be cast (either because it has no range limit or it is within range of the target), `false` otherwise.
   */
  inRange(spell, target) {
    if (spell.baseMaxRange === 0) {
      return true;
    } else {
      return spell.inRange(target);
    }
  }

  /**
   * Checks if enough time has passed since the last successful cast to cast the spell again.
   * @param {wow.Spell} spell - The spell to check.
   * @returns {boolean} - Whether the spell can be cast after the delay.
   */
  canCastAfterDelay(spell) {
    if (spell.castTime === 0) return true;

    const lastCastTime = this._lastSuccessfulCastTimes.get(spell.name.toLowerCase());
    if (!lastCastTime) return true;

    return (wow.frameTime - lastCastTime) >= Settings.SpellCastDelay;
  }

  /**
   * Gets the time since the last successful cast of a spell in milliseconds.
   * @param {number | string} spellNameOrId - The name or ID of the spell.
   * @returns {number} - The time since the last cast in milliseconds, or 9999999 if the spell hasn't been cast.
   */
  getTimeSinceLastCast(spellNameOrId) {
    const spell = this.getSpell(spellNameOrId);
    if (!spell) {
      console.error(`Spell ${spellNameOrId} not found`);
      return 9999999;
    }

    const lastCastTime = this._lastCastTimes.get(spell.id);
    if (!lastCastTime) {
      return 9999999; // Spell hasn't been cast yet
    }

    return wow.frameTime - lastCastTime;
  }

  /**
   * Checks if the spell with the given ID or name is known.
   * @param {number | string} spellNameOrId - The spell ID or name.
   * @returns {boolean} - Returns true if the spell is known, otherwise false.
   */
  isSpellKnown(spellNameOrId) {
    const spell = this.getSpell(spellNameOrId);
    return (spell && spell.isKnown) ? true : false;
  }

  /**
   * Gets the time since the last successful cast of a spell in milliseconds.
   * @param {number | string} spellNameOrId - The name or ID of the spell.
   * @returns {number} - The time since the last cast in milliseconds, or 9999999 if the spell hasn't been cast.
   */
  getTimeSinceLastCast(spellNameOrId) {
    const spell = this.getSpell(spellNameOrId);
    if (!spell) {
      console.error(`Spell ${spellNameOrId} not found`);
      return 9999999;
    }

    const lastCastTime = this._lastCastTimes.get(spell.id);
    if (!lastCastTime) {
      return 9999999; // Spell hasn't been cast yet
    }

    return wow.frameTime - lastCastTime;
  }

  /**
   * Gets the last 5 successfully cast spells.
   *
   * @param {number} [count=5] - The number of spells to return (default is 5).
   * @param {boolean} [includeTimestamp=false] - Whether to include the timestamp in the returned data.
   * @returns {Array<{spellName: string, targetName: string0}>} - An array of the last successfully cast spells.
   */
  getLastSuccessfulSpells(count = 5, includeTimestamp = false) {
    const result = [...this._lastSuccessfulSpells];

    // Only return the most recent spells up to the count
    const limitedResult = result.slice(-Math.min(count, result.length));

    // Return in reverse order (most recent first)
    const reversedResult = limitedResult.reverse();

    if (includeTimestamp) {
      return reversedResult;
    } else {
      return reversedResult.map(({ name, id, spellName, targetName }) => ({ 
        name, 
        id, 
        spellName, 
        targetName 
      }));
    }
  }

  /**
   * Gets the last successfully cast spell.
   *
   * @param {boolean} [includeTimestamp=false] - Whether to include the timestamp in the returned data.
   * @returns {{spellName: string, targetName: string, timestamp?: number} | null} - The last successfully cast spell or null if none exist.
   */
  getLastSuccessfulSpell() {
    if (this._lastSpell === null) {
      return null;
    }

    return this._lastSpell;
  }

  /**
 * Gets the full recharge time for a spell with charges.
 * This is how long it would take to reach maximum charges from the current state.
 *
 * @param {number | string} spellNameOrId - The name or ID of the spell.
 * @returns {number} - The time in milliseconds until all charges are available, or 0 if the spell doesn't use charges or is already at max charges.
 */
getFullRechargeTime(spellNameOrId) {
  const spell = this.getSpell(spellNameOrId);
  const spellCooldown = this.getCooldown(spellNameOrId);

  if (!spell) {
    console.error(`Spell ${spellNameOrId} not found`);
    return 0;
  }

  // If the spell doesn't have charges system, return 0
  if (!spell.charges) {
    return 0;
  }

  const currentCharges = spell.charges.charges || 0;
  const maxCharges = spell.charges.maxCharges || 0;

  // If already at max charges, return 0
  if (currentCharges >= maxCharges) {
    return 0;
  }

  // Get time until next charge
  const timeToNextCharge = spell.charges.start + spell.charges.duration - wow.frameTime;

  // Calculate full recharge time: time to next charge + time for remaining charges
  const chargeDuration = spell.charges.duration;
  const remainingCharges = maxCharges - currentCharges - 1; // -1 because we're already waiting for one charge

  return timeToNextCharge + (remainingCharges * chargeDuration);
}

  /**
   * Gets the charges of a spell as a fractional value (including partial progress toward next charge).
   *
   * @param {number | string} spellNameOrId - The name or ID of the spell.
   * @returns {number} - The current charges as a decimal number, or 0 if the spell doesn't use charges.
   */
  getChargesFractional(spellNameOrId) {
    const spell = this.getSpell(spellNameOrId);
    const spellCooldown = this.getCooldown(spellNameOrId);

    if (!spell) {
      console.error(`Spell ${spellNameOrId} not found`);
      return 0;
    }

    // If the spell doesn't have charges system, return 0
    if (!spell.charges) {
      return 0;
    }

    if(spell.charges == spell.charges.maxCharges) {
      return spell.charges.maxCharges;
    }

    const currentCharges = spell.charges.charges || 0;
    const maxCharges = spell.charges.maxCharges || 0;

    // If already at max charges, return just the whole charges
    if (currentCharges >= maxCharges) {
      return currentCharges;
    }

    // Calculate the fractional part based on cooldown progress
    const timeToNextCharge = spellCooldown.timeleft;
    const chargeDuration = spell.charges.duration;

    // If charge duration is 0, avoid division by zero
    if (chargeDuration <= 0) {
      return currentCharges;
    }
    // The fractional part is the percentage of the charge cooldown that has completed
    const fractionalPart = 1 - ((spell.charges.start + spell.charges.duration - wow.frameTime) / chargeDuration);

    return currentCharges + fractionalPart;
  }

  /**
   * Casts the single button assistant spell (one-button rotation) with an optional target.
   * If no target is provided, it will use the best combat target or the player's current target.
   *
   * @param {wow.CGUnit} [target] - Optional target for the spell. If not provided, uses best combat target or me.target
   * @returns {bt.Action} - A behavior tree action that handles the one-button rotation casting
   */
  castOneButtonRotation(target) {
    return new bt.Action(() => {
        const spellId = wow.SpellBook.singleButtonAssistantSpellId;
        if (spellId > 0) {
          const finalTarget = target || (combat.bestTarget ? combat.bestTarget : me.target);
          return this.cast(spellId, on => finalTarget).execute({});
        }
        return bt.Status.Failure;
      });
  }
}

export default new Spell();
