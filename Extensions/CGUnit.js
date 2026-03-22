import objMgr, { me } from "@/Core/ObjectManager";
import Common from "@/Core/Common";
import { MovementFlags, TraceLineHitFlags, UnitFlags, UnitFlags2, UnitStandStateType } from "@/Enums/Flags";
import { HealImmune, PVPImmuneToCC } from "@/Enums/Auras";
import Settings from "@/Core/Settings";
import { rootExclusions } from "@/Data/Exclusions";
import Specialization from "@/Enums/Specialization";
import { GenderType, RaceType, KlassType } from "@/Enums/UnitEnums";

const originalTargetGetter = Object.getOwnPropertyDescriptor(wow.CGUnit.prototype, 'target').get;
const originalAurasGetter = Object.getOwnPropertyDescriptor(wow.CGUnit.prototype, 'auras').get;
const originalVisibleAurasGetter = Object.getOwnPropertyDescriptor(wow.CGUnit.prototype, 'visibleAuras').get;

Object.defineProperties(wow.CGUnit.prototype, {
  target: {
    get: function () {
      const targetGuid = originalTargetGetter.call(this);
      return objMgr.findObject(targetGuid);
    }
  },

  focusTarget: {
    get: function () {
      return objMgr.findObject(wow.GameUI.focusTargetGuid);
    }
  },

  forceUpdateAuras: {
    value: function () {
      this._cacheAuras = originalAurasGetter.call(this);
      this._cacheAurasRefreshTime = wow.frameTime + Settings.AuraCacheTimeMs;
    }
  },

  auras: {
    get: function () {
      if (this._cacheAuras === undefined || this._cacheAurasRefreshTime < wow.frameTime) {
        this._cacheAuras = originalAurasGetter.call(this);
        this._cacheAurasRefreshTime = wow.frameTime + Settings.AuraCacheTimeMs;
      }
      return this._cacheAuras;
    }
  },

  visibleAuras: {
    get: function () {
      if (this._cacheVisibleAuras === undefined || this._cacheVisibleAurasRefreshTime < wow.frameTime) {
        this._cacheVisibleAuras = originalVisibleAurasGetter.call(this);
        this._cacheVisibleAurasRefreshTime = wow.frameTime + Settings.AuraCacheTimeMs;
      }
      return this._cacheVisibleAuras;
    }
  },

  targetUnit: {
    /**
     * Get the resolved target as a CGUnit object, converting from Guid if necessary.
     * @returns {wow.CGUnit | undefined} - The corresponding CGUnit object or undefined if not found.
     */
    get: function () {
      // If the target is already a CGUnit, return it directly
      if (this.target instanceof wow.CGUnit) {
        return this.target;
      }

      // If the target is a Guid, attempt to resolve it to a CGUnit
      if (this.target instanceof wow.Guid) {
        return objMgr.findObject(this.target);
      }

      // If neither, return undefined
      return undefined;
    }
  },

  predictedHealthPercent: {
    /** @this {wow.CGUnit} */
    get: function () {
      if (this.health <= 1) {
        return this.health;
      }
      let predictedHealth = this.health;
      this.healPredictions.forEach(prediction => {
        predictedHealth += prediction.amount;
      });
      return (predictedHealth * 100.0) / this.maxHealth;
    }
  },

  effectiveHealthPercent: {
    /** @this {wow.CGUnit} */
    get: function () {
      if (this.health <= 1) {
        return this.health;
      }
      let effectiveHealth = this.health;
      this.healPredictions.forEach(prediction => {
        effectiveHealth += prediction.amount;
      });
      //effectiveHealth += this.totalAbsorb;
      effectiveHealth -= this.totalHealAbsorb;
      return (effectiveHealth * 100.0) / this.maxHealth;
    }
  },

  /**
   * Estimate the time to death for this unit based on its current health percentage and the elapsed time.
   *
   * @returns {number | undefined} The estimated time to death in seconds, or undefined if the time cannot be determined.
   */
  timeToDeath: {
    value: function () {
      const t = wow.frameTime;
      const curhp = this.pctHealth;

      // Initialize an array to store the last 10 frames if not already initialized
      if (!this._ttdHistory) {
        this._ttdHistory = new Array();
      }

      // Add the current frame's data to the history
      this._ttdHistory.push({ time: t, health: curhp });

      // Keep only the last 300 ticks
      if (this._ttdHistory.length > 300) {
        this._ttdHistory.shift();
      }

      // Ensure we have enough data points to calculate TTD
      if (this._ttdHistory.length < 300) {
        return undefined;
      }

      // Calculate the average health per second (HPS) over the stored frames
      let totalHealthDiff = 0;
      let totalTimeDiff = 0;

      for (let i = 1; i < this._ttdHistory.length; i++) {
        const prevFrame = this._ttdHistory[i - 1];
        const currFrame = this._ttdHistory[i];
        totalHealthDiff += prevFrame.health - currFrame.health;
        totalTimeDiff += currFrame.time - prevFrame.time;
      }

      // Calculate HPS
      const hps = totalHealthDiff / (totalTimeDiff / 1000); // Convert ms to seconds

      if (hps > 0) {
        // Calculate and return the TTD based on the average HPS
        return curhp / hps;
      }

      return undefined; // Return undefined if TTD cannot be calculated
    }
  },

  isPlayer: {
    /**
     * Check if the unit is player or active player
     * @returns {boolean} - Returns true if the unit is a player or active player.
     */
    value: function () {
      // Check if `this.type` is either 6 (player) or 7 (active player)
      return this && (this.type && (this.type === 6 || this.type === 7));
    }
  },

  hasAuraByMe: {
    /**
     * Check if the unit has an aura by name or spell ID, cast by the player.
     * @param {string|number} nameOrId - The name of the aura or the spell ID.
     * @returns {boolean} - Returns true if the aura is found and cast by the player.
     */
    value: function (nameOrId) {
      /** @type {Array<wow.AuraData>} */
      const auras = this.auras;
      return auras.some((aura) => {
        const isMatch =
          (typeof nameOrId === 'number' && aura.spellId === nameOrId) ||
          (typeof nameOrId === 'string' && aura.name === nameOrId);

        return isMatch && aura.casterGuid && me.guid && me.guid.equals(aura.casterGuid);
      });
    }
  },

  hasAura: {
    /**
     * Check if the unit has an aura by name or spell ID.
     * @param {string|number} nameOrId - The name of the aura or the spell ID.
     * @returns {boolean} - Returns true if the aura is found by name or spell ID.
     */
    value: function (nameOrId) {
      if (typeof nameOrId === 'number') {
        return this.auras.some(aura => aura.spellId === nameOrId);
      } else if (typeof nameOrId === 'string') {
        return this.auras.some(aura => aura.name === nameOrId);
      }
      return false;
    }
  },

  hasVisibleAura: {
    /**
     * Check if the unit has a visible aura by name or spell ID.
     * @param {string|number} nameOrId - The name of the visible aura or the spell ID.
     * @returns {boolean} - Returns true if the visible aura is found by name or spell ID.
     */
    value: function (nameOrId) {
      if (typeof nameOrId === 'number') {
        return this.visibleAuras.some(visibleAura => visibleAura.spellId === nameOrId);
      } else if (typeof nameOrId === 'string') {
        return this.visibleAuras.some(visibleAura => visibleAura.name === nameOrId);
      }
      return false;
    }
  },

  getVisibleAura: {
    /**
     * Get the aura by name or spell ID.
     * @param {string|number} nameOrId - The name of the aura or the spell ID.
     * @returns {wow.AuraData|null} - Returns the aura if found, or null if not found.
     */
    value: function (nameOrId) {
      if (typeof nameOrId === 'number') {
        // Get by spell ID
        return this.visibleAuras.find(aura => aura.spellId === nameOrId) || undefined;
      } else if (typeof nameOrId === 'string') {
        // Get by aura name
        return this.visibleAuras.find(aura => aura.name === nameOrId) || undefined;
      }
      return undefined;
    }
  },

  hasVisibleAuraByMe: {
    /**
     * Check if the unit has a visible aura by name or spell ID, cast by the player.
     * @param {string|number} nameOrId - The name of the visible aura or the spell ID.
     * @returns {boolean} - Returns true if the visible aura is found and cast by the player.
     */
    value: function (nameOrId) {
      /** @type {Array<wow.AuraData>} */
      const visibleAuras = this.visibleAuras;
      return visibleAuras.some((visibleAura) => {
        const isMatch =
          (typeof nameOrId === 'number' && visibleAura.spellId === nameOrId) ||
          (typeof nameOrId === 'string' && visibleAura.name === nameOrId);

        return isMatch && visibleAura.casterGuid && me.guid && me.guid.equals(visibleAura.casterGuid);
      });
    }
  },

  getVisibleAuraByMe: {
    /**
     * Get the aura by name or spell ID, cast by the player.
     * @param {string|number} nameOrId - The name of the aura or the spell ID.
     * @returns {wow.AuraData|undefined} - Returns the aura if found and cast by the player, or undefined if not found.
     */
    value: function (nameOrId) {
      // Retrieve the aura using the getAura method
      const aura = this.visibleAuras.find((aura) => {
        const isMatch =
          (typeof nameOrId === 'number' && aura.spellId === nameOrId) ||
          (typeof nameOrId === 'string' && aura.name === nameOrId);

        // Check if the aura was cast by the player
        return isMatch && aura.casterGuid && me.guid && me.guid.equals(aura.casterGuid);
      });

      // Return the aura if found, otherwise return undefined
      return aura || undefined;
    }
  },

  getAura: {
    /**
     * Get the aura by name or spell ID.
     * @param {string|number} nameOrId - The name of the aura or the spell ID.
     * @returns {wow.AuraData|null} - Returns the aura if found, or null if not found.
     */
    value: function (nameOrId) {
      if (typeof nameOrId === 'number') {
        // Get by spell ID
        return this.auras.find(aura => aura.spellId === nameOrId) || undefined;
      } else if (typeof nameOrId === 'string') {
        // Get by aura name
        return this.auras.find(aura => aura.name === nameOrId) || undefined;
      }
      return undefined;
    }
  },

  getAuraByMe: {
    /**
     * Get the aura by name or spell ID, cast by the player.
     * @param {string|number} nameOrId - The name of the aura or the spell ID.
     * @returns {wow.AuraData|undefined} - Returns the aura if found and cast by the player, or undefined if not found.
     */
    value: function (nameOrId) {
      // Retrieve the aura using the getAura method
      const aura = this.auras.find((aura) => {
        const isMatch =
          (typeof nameOrId === 'number' && aura.spellId === nameOrId) ||
          (typeof nameOrId === 'string' && aura.name === nameOrId);

        // Check if the aura was cast by the player
        return isMatch && aura.casterGuid && me.guid && me.guid.equals(aura.casterGuid);
      });

      // Return the aura if found, otherwise return undefined
      return aura || undefined;
    }
  },

  getAuraStacks: {
    /**
     * Get the number of stacks for the specified aura by name or spell ID.
     * @param {string|number} nameOrId - The name of the aura or the spell ID.
     * @returns {number} - Returns the stack count if the aura is found, otherwise returns 0.
     */
    value: function (nameOrId) {
      // Get the aura using the existing getAura method
      const aura = this.getAuraByMe(nameOrId);

      // If the aura is found, return the stack count, otherwise return 0
      return aura ? aura.stacks || 0 : 0;
    }
  },

  getUnitsAround: {
    /**
     * Get an array of units within a specified distance of this unit.
     * @param {number} distance - The maximum distance to check for nearby units.
     * @returns {Array<wow.CGUnit>} - An array of CGUnit objects within the specified distance.
     */
    value: function (distance) {
      const nearbyUnits = [];

      objMgr.objects.forEach((obj) => {
        if (obj instanceof wow.CGUnit && obj !== this && Common.validTarget(obj)) {
          const distanceToUnit = this.distanceTo(obj);
          if (distanceToUnit <= distance) {
            nearbyUnits.push(obj);
          }
        }
      });

      return nearbyUnits;
    }
  },

  getUnitsAroundCount: {
    /**
     * Get the count of units within a specified distance of this unit.
     * @param {number} [distance=5] - The maximum distance to check for nearby units. Defaults to 5 if not specified.
     * @returns {number} - The count of units within the specified distance.
     */
    value: function (distance = 5) {
      return this.getUnitsAround(distance).length;
    }
  },

  isMoving: {
    /**
     * Check if the unit is moving based on movement flags.
     * @returns {boolean} - Returns true if the unit is moving in any direction.
     */
    value: function () {
      const movingMask =
        MovementFlags.FORWARD |
        MovementFlags.BACKWARD |
        MovementFlags.STRAFE_LEFT |
        MovementFlags.STRAFE_RIGHT |
        MovementFlags.FALLING |
        MovementFlags.PITCH_UP | // Ascending equivalent
        MovementFlags.PITCH_DOWN; // Descending equivalent

      return (this.movementInfo.flags & movingMask) !== 0;
    }
  },

  inCombat: {
    /**
     * Check if the unit is in combat.
     * @returns {boolean} - Returns true if the unit is in combat.
     */
    value: function () {
      return (this.unitFlags & UnitFlags.IN_COMBAT) !== 0;
    }
  },

  inCombatWith: {
    value: function (unit) {
      return this.threats.find(guid => guid.equals(unit)) !== undefined;
    }
  },

  /** @this {wow.CGUnit} */
  inCombatWithMe: {
    get: function () {
      return me.inCombatWith(this);
    }
  },

  isSitting: {
    /**
     * Check if the unit is sitting based on animTier.
     * @returns {boolean} - Returns true if the unit is sitting.
     */
    value: function () {
      return (this.animTier === UnitStandStateType.UNIT_STAND_STATE_SIT);
    }
  },

  isSwimming: {
    /**
     * Check if the unit is swimming based on movement flags.
     * @returns {boolean} - Returns true if the unit is swimming.
     */
    value: function () {
      return (this.movementInfo.flags & MovementFlags.SWIMMING) !== 0;
    }
  },

  isStunned: {
    /**
     * Check if the unit is stunned based on unit flags.
     * @returns {boolean} - Returns true if the unit is stunned.
     */
    value: function () {
      return (this.unitFlags & UnitFlags.STUNNED) !== 0;
    }
  },

  isSlowed: {
    /**
     * Check if the unit is slowed based on its ground speed.
     * @returns {boolean} - Returns true if the unit's ground speed is less than 7.
     */
    value: function () {
      return this.movementInfo.groundSpeed < 7;
    }
  },

  isRooted: {
    /**
     * Check if the unit is rooted based on movement flags, excluding certain spells.
     * @returns {boolean} - Returns true if the unit is rooted and not casting excluded spells.
     */
    value: function () {
      // If casting an excluded spell, not considered rooted
      if (this.currentCastOrChannel?.spellId && rootExclusions[this.currentCastOrChannel.spellId]) {
        return false;
      }
      return (this.movementInfo.flags & MovementFlags.ROOT) !== 0;
    }
  },

  isSilenced: {
    /**
     * Check if the unit is silenced based on unit flags.
     * @returns {boolean} - Returns true if the unit is silenced.
     */
    value: function () {
      return (this.unitFlags & UnitFlags.PACIFIED) !== 0;
    }
  },

  isFeared: {
    /**
     * Check if the unit is feared based on unit flags.
     * @returns {boolean} - Returns true if the unit is feared.
     */
    value: function () {
      return (this.unitFlags & UnitFlags.FLEEING) !== 0;
    }
  },

  /**
   * True if the unit cannot cast spells: stunned, silenced, pacified, feared, confused,
   * or under NO_ACTIONS (unitFlags / unitFlags2). Use on `me` to avoid spamming casts while CC'd.
   * @returns {boolean}
   */
  isUnableToCast: {
    value: function () {
      const f = this.unitFlags;
      const f2 = this.unitFlags2;
      if ((f & UnitFlags.STUNNED) !== 0) return true;
      if ((f & UnitFlags.SILENCED) !== 0) return true;
      if ((f & UnitFlags.PACIFIED) !== 0) return true;
      if ((f & UnitFlags.FLEEING) !== 0) return true;
      if ((f & UnitFlags.CONFUSED) !== 0) return true;
      if ((f2 & UnitFlags2.NO_ACTIONS) !== 0) return true;
      return false;
    }
  },

  angleToXY: {
    /**
     * Calculate the angle from one set of coordinates to another, taking into account the unit's facing direction.
     * @param {number} x1 - The X coordinate of the starting point.
     * @param {number} y1 - The Y coordinate of the starting point.
     * @param {number} x2 - The X coordinate of the target point.
     * @param {number} y2 - The Y coordinate of the target point.
     * @returns {number} - The angle in degrees between the unit's facing direction and the target.
     */
    value: function (x1, y1, x2, y2) {
      // Calculate the angle to the target
      let angle = Math.atan2(y2 - y1, x2 - x1);

      // Adjust for the unit's facing direction
      let diff = angle - this.facing;

      // Normalize the difference to be within 0 to 2 * PI
      if (diff < 0) {
        diff += Math.PI * 2;
      }

      // Adjust the difference to be between -PI and PI
      if (diff > Math.PI) {
        diff -= Math.PI * 2;
      }

      // Return the difference in degrees
      return this.radToDeg(diff);
    }
  },

  angleToPos: {
    /**
     * Calculate the angle between two positions, considering the unit's facing direction.
     * @param {Vector3} from - The starting position {x, y, z}.
     * @param {Vector3} to - The target position {x, y, z}.
     * @returns {number} - The angle in degrees between the unit's facing direction and the target position.
     */
    value: function (from, to) {
      return this.angleToXY(from.x, from.y, to.x, to.y);
    }
  },

  angleTo: {
    /**
     * Calculate the angle between the unit's current position and another unit's position.
     * @param {wow.CGUnit} target - The target unit.
     * @returns {number} - The angle in degrees between the unit's facing direction and the target unit.
     */
    value: function (target) {
      return this.angleToPos(this.position, target.position);
    }
  },

  isFacing: {
    /**
     * Check if the unit is facing towards the target within a certain angle.
     * @param {wow.CGUnit | wow.Guid | null} target - The target unit.
     * @param {number} [ang=90] - The acceptable angle in degrees for the facing check. Defaults to 90 degrees.
     * @returns {boolean} - Returns true if the unit is facing the target within the specified angle.
     */
    value: function (target, ang = 90) {
      if (!target) {
        return false;
      }

      // Special case: if both units are the player, always return true
      if (target === me && this === me) {
        return true;
      }

      if (!(target instanceof wow.CGUnit) && target instanceof wow.Guid) {
        target = objMgr.findObject(target);
      }

      const angle = this.angleTo(target);

      // Check if the absolute angle is within the specified range
      return Math.abs(angle) < ang;
    }
  },

  radToDeg: {
    /**
     * Convert radians to degrees.
     * @param {number} radians - The angle in radians.
     * @returns {number} - The angle in degrees.
     */
    value: function (radians) {
      return radians * (180 / Math.PI);
    }
  },

  inMyGroup: {
    /**
     * Check if the unit is in the player's current group.
     * @returns {boolean} - Returns true if the unit is in the player's group, false otherwise.
     */
    value: function () {
      const group = wow.Party.currentParty; // Get the current party

      // If the player is not in a group, return false
      if (!group || group.numMembers === 0) {
        return false;
      }

      // Iterate through the group members
      for (const member of group.members) {
        if (member.guid.equals(this.guid)) {
          return true; // The unit is in the group
        }
      }

      return false; // The unit is not in the group
    }
  },

  withinLineOfSight: {
    /**
     * Check if the target unit is within line of sight.
     * @param {wow.CGUnit | wow.Guid} target - The target unit to check line of sight against.
     * @returns {boolean} - Returns true if the target is within line of sight, false otherwise.
     */
    value: function (target) {
      if (target === me) {
        return true;
      }
      target = target instanceof wow.CGUnit ? target : target.toUnit();
      if (!target || !target.position || !this.position) {
        return false;
      }
      // Adjust positions to account for the display height of both units
      const from = { ...this.position, z: this.position.z + this.displayHeight * 0.9 };
      const to = { ...target.position, z: target.position.z + target.displayHeight * 0.9 };

      // Define the flags for line of sight checking
      const flags = TraceLineHitFlags.SPELL_LINE_OF_SIGHT;

      // Perform the trace line check
      const traceResult = wow.World.traceLine(from, to, flags);
      return !traceResult.hit; // If traceResult.hit is false, we have line of sight
    }
  },

  isTanking: {
    /**
     * Check if the player is the current tank for the unit.
     * @returns {boolean} - Returns true if the player is the current tank, false otherwise.
     */
    value: function () {
      // Check if the unit's GUID matches the player's GUID
      return this.tankingGUID.low === me.guid.low;
    }
  },

  currentCastOrChannel: {
    /**
     * Get the current cast or channel information for the unit.
     * @returns {any} - Returns the spell info if the unit is casting or channeling, otherwise undefined.
     */
    get: function () {
      if (this.spellInfo) {
        if (this.spellInfo.cast !== 0 || this.spellInfo.spellChannelId !== 0) {
          return this.spellInfo;
        }
      }
      return undefined;
    }
  },

  isInterruptible: {
    /**
     * Check if the unit's current cast or channel is interruptible.
     * @returns {boolean} - Returns true if the current cast or channel is interruptible, false otherwise.
     */
    get: function () {
      return (this.spellInfo.interruptFlags & 0x8) === 0;
    }
  },

  isCastingOrChanneling: {
    /**
     * Check if the unit is currently casting or channeling
     * @returns {boolean} - Returns true if the unit is currently casting or channeling
     */
    get: function () {
      return (this.currentCast && this.currentCast !== 0) || (this.isChanneling)
    }
  },

  isImmune: {
    /**
     * Check if the unit is immune
     * @returns {boolean} - Returns true if the unit is immune, false otherwise
     */
    value: function () {
      return (this.unitFlags & UnitFlags.UNK31) !== 0 || (this.unitFlags & UnitFlags.IMMUNE_TO_PC) !== 0;
    }
  },

  isHealImmune: {
    /**
     * Check if the unit is immune to healing.
     * @returns {boolean} - Returns true if the unit has any aura that indicates healing immunity, otherwise false.
     */
    value: function () {
      return Object.values(HealImmune).some(immune => this.hasAura(immune));
    }
  },

  canCC: {
    /**
     * Check if the unit can be crowd controlled (CC'd).
     * Only players can be CC'd, and only if they don't have PVP immunity auras.
     * @returns {boolean} - Returns true if the unit can be CC'd, false otherwise.
     */
    value: function () {
      // Only players can be CC'd
      if (!this.isPlayer()) {
        return false;
      }

      // Get the set of immunity spell IDs for efficient lookup
      const immunitySpellIds = new Set(Object.values(PVPImmuneToCC));

      // Check if the player has any PVP immunity auras - if they do, they can't be CC'd
      const immunityAura = this.auras.find(aura => immunitySpellIds.has(aura.spellId));
      if (immunityAura) {
        // console.log(`[canCC] ${this.name} has CC immunity aura: ${immunityAura.name} (${immunityAura.spellId})`);
        return false;
      }

      return true;
    }
  },
    /**
  // isWithinMeleeRange: {

  //    * Check if the target is within melee range of this unit.
  //    * @this {wow.CGUnit}
  //    * @param {wow.CGUnit} target - The target unit to check range against.
  //    * @returns {boolean} - Returns true if the target is within melee range, false otherwise.
  //    */
  //   value: function (target) {
  //     const meleeSpell = new wow.Spell(184367);
  //     return meleeSpell.inRange(target);
  //   }
  // },

  /**
   * Get DR stacks for a specific spell on this unit
   * @param {number} spellId - The spell ID to check DR for
   * @returns {number} - Number of DR stacks (0-2, where 2 = immune)
   */
  getDRStacks: {
    value: function(spellId) {
      // Access drTracker from global scope (imported in nuclear.js)
      if (typeof drTracker !== 'undefined') {
        return drTracker.getDRStacksBySpell(this.guid, spellId);
      }
      return 0;
    }
  },

  /**
   * Check if this unit would be diminished by a spell
   * @param {number} spellId - The spell ID to check
   * @returns {boolean} - True if the spell would be diminished
   */
  wouldBeDiminished: {
    value: function(spellId) {
      if (typeof drTracker !== 'undefined') {
        return drTracker.wouldBeDiminished(this.guid, spellId);
      }
      return false;
    }
  },

  /**
   * Check if this unit is immune to a spell
   * @param {number} spellId - The spell ID to check
   * @returns {boolean} - True if the unit is immune to this spell
   */
  isImmuneToSpell: {
    value: function(spellId) {
      if (typeof drTracker !== 'undefined') {
        return drTracker.isImmune(this.guid, spellId);
      }
      return false;
    }
  },

  /**
   * Get the diminished duration multiplier for a spell on this unit
   * @param {number} spellId - The spell ID to check
   * @returns {number} - Duration multiplier (1.0 = full, 0.5 = half, 0 = immune)
   */
  getDiminishedMultiplier: {
    value: function(spellId) {
      if (typeof drTracker !== 'undefined') {
        return drTracker.getDiminishedMultiplier(this.guid, spellId);
      }
      return 1.0;
    }
  },

  /**
   * Check if this unit is currently CCd (crowd controlled)
   * @returns {boolean} - True if the unit is currently under any CC effect
   */
  isCCd: {
    value: function() {
      if (typeof drTracker !== 'undefined') {
        return drTracker.isCCd(this.guid);
      }
      return false;
    }
  },

  /**
   * Check if this unit is CCd by a specific category
   * @param {string} category - The DR category to check
   * @returns {boolean} - True if the unit is CCd by this category
   */
  isCCdByCategory: {
    value: function(category) {
      if (typeof drTracker !== 'undefined') {
        return drTracker.isCCdByCategory(this.guid, category);
      }
      return false;
    }
  },

  /**
   * Get DR stacks for a specific category on this unit
   * @param {string} category - The DR category to check
   * @returns {number} - Number of DR stacks (0-2, where 2 = immune)
   */
  getDR: {
    value: function(category) {
      if (typeof drTracker !== 'undefined') {
        return drTracker.getDRStacks(this.guid, category);
      }
      return 0;
    }
  },

  /**
   * Get all active CCs on this unit
   * @returns {Object} - Object containing active CCs { spellId: { category, appliedTime } }
   */
  getActiveCCs: {
    value: function() {
      if (typeof drTracker !== 'undefined') {
        return drTracker.getActiveCCs(this.guid);
      }
      return {};
    }
  },

  isHealer: {
    /**
     * Check if the unit is a healer based on their specialization.
     * Uses specializationId for players.
     * @returns {boolean} - Returns true if the unit has any healing specialization.
     */
    value: function() {
      if (this instanceof wow.CGPlayer && this.specializationId) {
        const healerSpecIds = [
          Specialization.Evoker.Preservation,
          Specialization.Druid.Restoration,
          Specialization.Priest.Discipline,
          Specialization.Priest.Holy,
          Specialization.Monk.Mistweaver,
          Specialization.Paladin.Holy,
          Specialization.Shaman.Restoration
        ];

        return healerSpecIds.includes(this.specializationId);
      }

      return false;
    }
  },

  isDisarmableMelee: {
    /**
     * Check if the unit is a melee class/spec that can be disarmed.
     * Excludes Feral Druids since they fight in cat form without weapons.
     * Uses specializationId for players.
     * @returns {boolean} - Returns true if the unit has a disarmable melee specialization.
     */
    value: function() {
      if (this instanceof wow.CGPlayer && this.specializationId) {
        const disarmableMeleeSpecIds = [
          // Death Knight - all specs use weapons
          Specialization.DeathKnight.Blood,
          Specialization.DeathKnight.Frost,
          Specialization.DeathKnight.Unholy,
          // Demon Hunter - both specs use weapons
          Specialization.DemonHunter.Havoc,
          Specialization.DemonHunter.Vengeance,
          // Monk - Windwalker can use weapons
          Specialization.Monk.Windwalker,
          // Paladin - Protection and Retribution use weapons
          Specialization.Paladin.Protection,
          Specialization.Paladin.Retribution,
          // Rogue - all specs use weapons
          Specialization.Rogue.Assassination,
          Specialization.Rogue.Combat, // Outlaw
          Specialization.Rogue.Sublety,
          // Shaman - Enhancement uses weapons
          Specialization.Shaman.Enhancement,
          // Warrior - all specs use weapons
          Specialization.Warrior.Arms,
          Specialization.Warrior.Fury,
          Specialization.Warrior.Protection,
          // Hunter - Survival uses melee weapons
          Specialization.Hunter.Survival,
          Specialization.Hunter.Marksmanship
          // Note: Feral Druid is intentionally excluded as they fight in cat form
        ];

        return disarmableMeleeSpecIds.includes(this.specializationId);
      }

      return false;
    }
  },

  currentChannel: {
    /**
     * Get the current channel spell ID, but only if channelEnd >= current time
     * @returns {number} - Returns the channel spell ID if still active, otherwise 0
     */
    get: function () {
      if (this.spellInfo && this.spellInfo.spellChannelId !== 0) {
        // Check if channelEnd < curTime - if so, channel has expired
        if (this.spellInfo.channelEnd < wow.frameTime) {
          return 0;
        }
        return this.spellInfo.spellChannelId;
      }
      return 0;
    }
  },

  isChanneling: {
    /**
     * Check if the unit is currently channeling (using the time-validated currentChannel)
     * @returns {boolean} - Returns true if the unit is actively channeling
     */
    get: function () {
      return this.currentChannel !== 0;
    }
  },

  gender: {
    /**
     * Get the gender enum value of the unit
     * @returns {number} - The gender enum value from GenderType
     */
    get: function () {
      return (this.sex >> 24) & 0xFF;
    }
  },

  race: {
    /**
     * Get the race enum value of the unit
     * @returns {number} - The race enum value from RaceType
     */
    get: function () {
      return this.sex & 0xFF;
    }
  },

  klass: {
    /**
     * Get the class enum value of the unit
     * @returns {number} - The class enum value from KlassType
     */
    get: function () {
      return (this.sex >> 8) & 0xFF;
    }
  }

});

export default true;
