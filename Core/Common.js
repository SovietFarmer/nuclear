import * as bt from './BehaviorTree'
import objMgr, { me } from './ObjectManager'
import CGUnit from "../Extensions/CGUnit";
import Spell from './Spell';
import spell from "@/Core/Spell";

class Common {
  static waitForCastOrChannel() {
    return new bt.Action(() => {
      if (me.isCastingOrChanneling) {
        return bt.Status.Success;
      }
      return bt.Status.Failure;
    }, "Wait for cast or channel");
  }

  /**
   * Blocks lower-priority siblings in a {@link bt.Selector} while the player cannot cast
   * (stun, silence, pacify, fear, confuse, NO_ACTIONS — see CGUnit `isUnableToCast()`).
   *
   * **Disclaimer:** Some spells are intentionally castable while CC'd (e.g. Priest Pain Suppression
   * while stunned). This node does **not** know per-spell rules. Place those casts **above** this
   * node in the tree, or gate them with rotation-specific conditions — do not rely on this alone.
   *
   * Semantics match {@link Common.waitForCastOrChannel}: returns Success while the "wait"
   * condition holds (here: unable to cast), Failure when the player may attempt casts.
   */
  static waitForAbleToCast() {
    return new bt.Action(() => {
      if (!me) {
        return bt.Status.Success;
      }
      if (me.isUnableToCast()) {
        return bt.Status.Success;
      }
      return bt.Status.Failure;
    }, "Wait while unable to cast (CC/lockout)");
  }

  static waitForTarget() {
    return new bt.Action(() => {
      if (!me.targetUnit || !Common.validTarget(me.targetUnit)) {
        return bt.Status.Success;
      }
      return bt.Status.Failure;
    }, "Wait for target");
  }

  static waitForNotSitting() {
    return new bt.Action(() => {
      if (me.isSitting()) {
        return bt.Status.Success;
      }
      return bt.Status.Failure;
    }, "Wait for not sitting");
  }

  static waitForFacing() {
    return new bt.Action(() => {
      if (!me.targetUnit || !me.isFacing(me.targetUnit)) {
        return bt.Status.Success;
      }
      return bt.Status.Failure;
    }, "Wait for facing");
  }

  static validTarget(u) {
    if (!u || u.deadOrGhost || !me.canAttack(u)) {
      return false;
    }

    return true;
  }

  static waitForNotMounted() {
    return new bt.Action(() => {
      if (me.isMounted) {
        return bt.Status.Success;
      }
      return bt.Status.Failure;
    }, "Wait for not mounted");
  }

  static ensureAutoAttack() {
    return new bt.Action(() => {
      const autoAttack = Spell.getSpell("Auto Attack")

      if (!autoAttack.isActive) {
        me.toggleAttack();
        return bt.Status.Success;
      }

      return bt.Status.Failure;
    }, "Ensure Auto Attacking");
  }

  /**
   * Finds and returns an item by its name.
   *
   * @param {string} name - The name of the item to find.
   * @returns {wow.CGItem|null} The item if found, otherwise null.
   */
  static getItemByName(name) {
    let foundItem = null;

    // Iterate over all objects in ObjectManager
    objMgr.objects.forEach((obj) => {
      if (obj instanceof wow.CGItem && obj.name === name) {
        foundItem = obj; // Set the found item
      }
    });

    // Return the found item or null if not found
    return foundItem;
  }

  /**
   * Uses an item by its name.
   *
   * @param {string} name - The name of the item to use.
   * @param {wow.CGObject|wow.Guid|undefined} [target] - Optional target for the item use.
   * @returns {boolean} True if the item was used successfully, false otherwise.
   */
  static useItemByName(name, target = undefined) {
    const item = this.getItemByName(name);

    if (!item) {
      return false;
    }

    if (!item.cooldown.ready) {
      return false;
    }

    if (!item.useSpell) {
      return false;
    }

    // Check if the item has charges (if applicable)
    if (item.enchantment && item.enchantment.charges === 0) {
      return false;
    }

    // Check if the item has expired (if applicable)
    if (item.expiration !== 0 && item.expiration <= wow.frameTime) {
      return false;
    }

    // Attempt to use the item
    const success = item.use(target);
    if (success) {
      console.debug(`Successfully used item "${name}".`);
    } else {
      console.debug(`Failed to use item "${name}".`);
    }

    return success;
  }

  /**
   * Finds and returns an equipped item by its name.
   *
   * @param {string} name - The name of the item to find.
   * @returns {wow.CGItem|null} The equipped item if found, otherwise null.
   */
  static getEquippedItemByName(name) {
    let foundItem = null;

    // Iterate over all objects in ObjectManager
    objMgr.objects.forEach((obj) => {
      if (obj instanceof wow.CGItem &&
        obj.name === name &&
        obj.owner && obj.containedIn &&
        obj.owner.equals(obj.containedIn) &&
        obj.owner.equals(me.guid)) {
        foundItem = obj; // Set the found item
      }
    });

    // Return the found item or null if not found
    return foundItem;
  }

  /**
   * Uses an equipped item by its name.
   *
   * @param {string} name - The name of the equipped item to use.
   * @param {wow.CGObject|wow.Guid|undefined} [target] - Optional target for the item use.
   * @returns {boolean} True if the item was used successfully, false otherwise.
   */
  static useEquippedItemByName(name, targetSelector = () => undefined) {
    return new bt.Action(() => {
      const item = this.getEquippedItemByName(name);

      if (!item || item === null) {
        //console.debug(`Equipped item "${name}" not found.`);
        return bt.Status.Failure;
      }

      if (!item.useSpell) {
        // console.debug(`Equipped item "${name}" is not usable.`);
        return bt.Status.Failure;
      }

      // Check the cooldown of the item's use spell
      if (!item.cooldown.ready) {
        //console.debug(`Equipped item "${name}" is on cooldown.`);
        return bt.Status.Failure;
      }

      // Check if the item has charges (if applicable)
      if (item.enchantment && item.enchantment.charges === 0) {
        //console.debug(`Equipped item "${name}" has no charges left.`);
        return bt.Status.Failure;
      }

      // Check if the item has expired (if applicable)
      if (item.expiration !== 0 && item.expiration <= wow.frameTime) {
        //console.debug(`Equipped item "${name}" has expired.`);
        return bt.Status.Failure;
      }

      const target = targetSelector();

      // Attempt to use the item
      const success = item.use(target);
      if (success) {
        console.info(`Used equipped item "${name}".`);
        return bt.Status.Success;
      } else {
        return bt.Status.Failure;
      }
    }, `Use equipped item ${name}`);
  }

  /**
   * Gets the equipped trinket from the specified slot (12 or 13).
   *
   * @param {number} slot - The trinket slot (12 for trinket1, 13 for trinket2).
   * @returns {wow.CGItem|null} The trinket item if found, otherwise null.
   */
  static getEquippedTrinket(slot) {
    if (slot !== 12 && slot !== 13) {
      console.warn(`Invalid trinket slot: ${slot}. Use 12 or 13.`);
      return null;
    }
    
    try {
      // Get equipment array from CGActivePlayer
      if (!me.equipment || !me.equipment[slot]) {
        return null;
      }
      
      // Get the trinket GUID from the equipment slot
      const trinketGuid = me.equipment[slot];
      if (!trinketGuid) {
        return null;
      }
      
      // Find the actual item object using objMgr
      const trinketItem = objMgr.findObject(trinketGuid);
      
      // Check if it's a CGItem
      if (trinketItem instanceof wow.CGItem) {
        return trinketItem;
      }
      
      return null;
      
    } catch (error) {
      console.warn(`Error getting trinket from slot ${slot}: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Gets trinket 1 (slot 12).
   *
   * @returns {wow.CGItem|null} The trinket item if found, otherwise null.
   */
  static getTrinket1() {
    return this.getEquippedTrinket(12);
  }
  
  /**
   * Gets trinket 2 (slot 13).
   *
   * @returns {wow.CGItem|null} The trinket item if found, otherwise null.
   */
  static getTrinket2() {
    return this.getEquippedTrinket(13);
  }
  
  /**
   * Uses an equipped trinket from the specified slot, or tries both slots if no slot specified.
   *
   * @param {number} [slot] - The trinket slot (12 for trinket1, 13 for trinket2). If not specified, tries both.
   * @param {Function} [targetSelector] - Function that returns the target for the trinket use.
   * @param {Function} [conditions] - Function that returns true if trinket should be used.
   * @returns {bt.Action} Behavior tree action for using the trinket.
   */
  static useEquippedTrinket(slot = null, targetSelector = () => undefined, conditions = () => true) {
    return new bt.Action(() => {
      // Check conditions first
      if (!conditions()) {
        return bt.Status.Failure;
      }
      
      // If no slot specified, try both trinkets (trinket 1 first, then trinket 2)
      const slotsToTry = slot !== null ? [slot] : [12, 13];
      
      for (const currentSlot of slotsToTry) {
        const trinket = this.getEquippedTrinket(currentSlot);
        
        if (!trinket || !trinket.useSpell) {
          continue; // Try next slot
        }
        
        // Check the cooldown of the trinket's use spell
        if (!trinket.cooldown.ready) {
          continue; // Try next slot
        }
        
        // Check if the trinket has charges (if applicable)
        if (trinket.enchantment && trinket.enchantment.charges === 0) {
          continue; // Try next slot
        }
        
        // Check if the trinket has expired (if applicable)
        if (trinket.expiration !== 0 && trinket.expiration <= wow.frameTime) {
          continue; // Try next slot
        }
        
        const target = targetSelector();
        
        // Attempt to use the trinket
        const success = trinket.use(target);
        if (success) {
          console.info(`Used trinket from slot ${currentSlot}: "${trinket.name}".`);
          return bt.Status.Success;
        }
      }
      
      // No trinkets were usable
      return bt.Status.Failure;
    });
  }
  
  /**
   * Uses trinket 1 (slot 12).
   *
   * @param {Function} [targetSelector] - Function that returns the target for the trinket use.
   * @param {Function} [conditions] - Function that returns true if trinket should be used.
   * @returns {bt.Action} Behavior tree action for using trinket 1.
   */
  static useTrinket1(targetSelector = () => undefined, conditions = () => true) {
    return this.useEquippedTrinket(12, targetSelector, conditions);
  }
  
  /**
   * Uses trinket 2 (slot 13).
   *
   * @param {Function} [targetSelector] - Function that returns the target for the trinket use.
   * @param {Function} [conditions] - Function that returns true if trinket should be used.
   * @returns {bt.Action} Behavior tree action for using trinket 2.
   */
  static useTrinket2(targetSelector = () => undefined, conditions = () => true) {
    return this.useEquippedTrinket(13, targetSelector, conditions);
  }
  
  /**
   * Gets the cooldown information for a trinket in the specified slot.
   *
   * @param {number} slot - The trinket slot (12 for trinket1, 13 for trinket2).
   * @returns {Object|null} Cooldown object with ready/timeleft properties, or null if trinket not found.
   */
  static getTrinketCooldown(slot) {
    const trinket = this.getEquippedTrinket(slot);
    if (!trinket || !trinket.useSpell) {
      return null;
    }
    
    return trinket.cooldown || null;
  }
  
  /**
   * Gets trinket 1 cooldown information.
   *
   * @returns {Object|null} Cooldown object or null if trinket not found.
   */
  static getTrinket1Cooldown() {
    return this.getTrinketCooldown(12);
  }
  
  /**
   * Gets trinket 2 cooldown information.
   *
   * @returns {Object|null} Cooldown object or null if trinket not found.
   */
  static getTrinket2Cooldown() {
    return this.getTrinketCooldown(13);
  }
  
  /**
   * Checks if a trinket is ready to use.
   *
   * @param {number} slot - The trinket slot (12 for trinket1, 13 for trinket2).
   * @returns {boolean} True if trinket is ready, false otherwise.
   */
  static isTrinketReady(slot) {
    const cooldown = this.getTrinketCooldown(slot);
    return cooldown ? cooldown.ready : false;
  }
  
  /**
   * Gets the remaining cooldown time for a trinket in milliseconds.
   *
   * @param {number} slot - The trinket slot (12 for trinket1, 13 for trinket2).
   * @returns {number} Remaining cooldown time in milliseconds, or 0 if ready/not found.
   */
  static getTrinketCooldownRemaining(slot) {
    const cooldown = this.getTrinketCooldown(slot);
    return cooldown ? cooldown.timeleft : 0;
  }
  
  /**
   * Uses any available trinket (tries trinket 1 first, then trinket 2).
   * Convenience method that's equivalent to useEquippedTrinket() with no slot specified.
   *
   * @param {Function} [targetSelector] - Function that returns the target for the trinket use.
   * @param {Function} [conditions] - Function that returns true if trinket should be used.
   * @returns {bt.Action} Behavior tree action for using any available trinket.
   */
  static useTrinkets(targetSelector = () => undefined, conditions = () => true) {
    return this.useEquippedTrinket(null, targetSelector, conditions);
  }

  static waitForCombat() {
    return new bt.Action(() => {
      if (!me.inCombat()) {
        return bt.Status.Success;
      }
      return bt.Status.Failure;
    }, "Wait for combat");
  }

  static waitForNotWaitingForArenaToStart() {
    return new bt.Action(() => {
      if (me.hasArenaPreparation()) {
        return bt.Status.Success;
      }
      return bt.Status.Failure;
    }, "Wait for not waiting for arena to start");
  }
}

export default Common;
