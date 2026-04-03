import objMgr, { me } from "@/Core/ObjectManager";

const ARENA_PERIODIC_AURA = 74410;
const ARENA_PREPARATION = [32727, 32728];
const CHALLENGERS_BURDEN = 206151;

Object.defineProperties(wow.CGActivePlayer.prototype, {

  /**
   * Returns true if the player is in an arena, false otherwise.
   * @returns {boolean}
   */
  inArena: {
    value: function () {
      return this.hasAura(ARENA_PERIODIC_AURA);
    }
  },

  /**
   * Returns true if the player is in an arena and in the preparation phase.
   * @returns {boolean}
   */
  hasArenaPreparation: {
    value: function () {
      if (this.inArena()) {
        for (const auraId of ARENA_PREPARATION) {
          if (this.hasAura(auraId)) {
            return true;
          }
        }
      }
      return false;
    }
  },

  /**
   * Returns true if the player is in a Mythic+ instance, false otherwise.
   * @returns {boolean}
   */
  inMythicPlus: {
    value: function () {
      const mythicPlusAura = this.getAura(CHALLENGERS_BURDEN);
      return mythicPlusAura !== undefined;
    }
  },


  currentParty: {
    /**
     * Get the current active party if it exists.
     * @returns {wow.Party | undefined} - Returns the current party instance or undefined.
     */
    get: function () {
      return wow.Party.currentParty;
    }
  },

  getFriends: {
    /**
     * Get an array of friends within a specified distance of this unit.
     * @param {number} distance - The maximum distance to check for nearby units (default 40).
     * @returns {Array<wow.CGUnit>} - An array of CGUnit objects within the specified distance.
     */
    value: function (distance = 40) {
      const nearbyFriends = [];

      if (this.currentParty) {
        const partyMembers = this.currentParty.members;

        // Loop through the party members
        for (const member of partyMembers) {
          // Check if the member's GUID exists in the Object Manager as a CGUnit
          const friendUnit = member.guid.toUnit();

          // Ensure the friend is a CGUnit and within the specified distance
          if (friendUnit instanceof wow.CGUnit && this.distanceTo(friendUnit) <= distance) {
            nearbyFriends.push(friendUnit);
          }
        }
      }

      // Add more logic here if you want to include nearby friendly units who are not in the party.

      return nearbyFriends;
    }
  },

  getEnemies: {
    /**
     * Get an array of enemies within a specified distance of this unit.
     * @param {number} distance - The maximum distance to check for nearby units (default 40).
     * @returns {Array<wow.CGUnit>} - An array of CGUnit objects that are attackable enemies within the specified distance.
     */
    value: function (distance = 40) {
      const nearbyEnemies = [];

      // Get all units around the player within the specified distance
      const unitsAround = this.getUnitsAround(distance);

      for (const unit of unitsAround) {
        // Ensure the unit is a CGUnit and that the player can attack it
        if (unit instanceof wow.CGUnit && this.canAttack(unit)) {
          // Add valid enemies to the list
          nearbyEnemies.push(unit);
        }
      }

      return nearbyEnemies;
    }
  },

  getPlayerEnemies: {
    /**
     * Get an array of player enemies within a specified distance of this unit.
     * Only player-controlled units that are attackable will be included.
     *
     * @param {number} [distance=20] - The maximum distance to check for nearby player enemies (default is 20).
     * @returns {Array<wow.CGUnit>} - An array of CGUnit objects representing attackable player enemies within the specified distance.
     */
    value: function (distance = 20) {
      const nearbyEnemies = [];

      // Get all units around the player within the specified distance
      const unitsAround = this.getUnitsAround(distance);

      for (const unit of unitsAround) {
        // Ensure the unit is a CGUnit, is attackable, and is a player
        if (unit instanceof wow.CGUnit && this.canAttack(unit) && unit.isPlayer()) {
          // Add valid player enemies to the list
          nearbyEnemies.push(unit);
        }
      }

      return nearbyEnemies;
    }
  },

  getPlayerFriends: {
    /**
     * Get an array of player friends within a specified distance of this unit.
     * Only party members that are players will be included.
     *
     * @param {number} [distance=20] - The maximum distance to check for nearby player friends (default is 20).
     * @returns {Array<wow.CGUnit>} - An array of CGUnit objects representing friendly players within the specified distance.
     */
    value: function (distance = 20) {
      const nearbyFriends = [];

      if (this.currentParty) {
        const partyMembers = this.currentParty.members;

        // Loop through the party members
        for (const member of partyMembers) {
          // Check if the member's GUID exists in the Object Manager as a CGUnit
          const friendUnit = member.guid.toUnit();

          // Ensure the friend is a CGUnit, within the specified distance, and is a player
          if (friendUnit instanceof wow.CGUnit && this.distanceTo(friendUnit) <= distance && friendUnit.isPlayer()) {
            nearbyFriends.push(friendUnit);
          }
        }
      }

      return nearbyFriends;
    }
  },

  getReadyRunes: {
    /**
     * Get the number of runes that are currently ready (i.e., start === 0).
     * @returns {number} - The count of runes that are ready.
     */
    value: function () {
      let readyRuneCount = 0;

      // Iterate through each rune's info
      this.runeInfo.forEach(rune => {
        // Check if the rune's start is 0, meaning it's ready
        if (rune.start === 0) {
          readyRuneCount++;
        }
      });

      return readyRuneCount;
    }
  },

  pet: {
    /**
     * Get the first pet from the player's pet info.
     * @returns {wow.CGUnit | undefined} - Returns the first pet or undefined if no pets.
     */
    get: function () {
      return wow.PetInfo.pets[0]?.toUnit() ?? undefined;
    }
  },
});

export default true;
