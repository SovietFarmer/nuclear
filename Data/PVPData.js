// High priority buffs to purge/dispel
export const pvpPurgeHigh = {
  1022: "Blessing of Protection",
  79206: "Spiritwalker's Grace", 
  190319: "Combustion",
  10060: "Power Infusion",
  12042: "Arcane Power",
  12472: "Icy Veins",
  213610: "Holy Ward",
  198111: "Temporal Shield",
  210294: "Divine Favor",
  212295: "Nether Ward",
  271466: "Luminous Barrier",
  311203: "Moment of Glory"
};

// Low priority buffs to purge/dispel
export const pvpPurgeLow = {
  1044: "Blessing of Freedom"
};

// Major damage cooldowns with minimum durations to consider for CC
export const damageBuffs = {
  51690: { minDuration: 2, name: "Killing Spree" },
  121471: { minDuration: 2, name: "Shadow of Blades" },
  185313: { minDuration: 1, name: "Shadow Dance" },
  185422: { minDuration: 1, name: "Shadow Dance" },
  13750: { minDuration: 2, name: "Adrenaline Rush" },
  191427: { minDuration: 2, name: "Metamorphosis" },
  162264: { minDuration: 2, name: "Metamorphosis" },
  19574: { minDuration: 2, name: "Bestial Wrath" },
  193530: { minDuration: 2, name: "Aspect of the Wild" },
  266779: { minDuration: 2, name: "Coordinated Assault" },
  288613: { minDuration: 2, name: "Trueshot" },
  106951: { minDuration: 2, name: "Berserk" },
  102560: { minDuration: 2, name: "Incarnation: Chosen of Elune" },
  102543: { minDuration: 2, name: "Incarnation: King of the Jungle" },
  190319: { minDuration: 1, name: "Combustion" },
  12042: { minDuration: 2, name: "Arcane Power" },
  12472: { minDuration: 2, name: "Icy Veins" },
  51271: { minDuration: 2, name: "Pillar of Frost" },
  207289: { minDuration: 2, name: "Unholy Frenzy" },
  454351: { minDuration: 2, name: "Avenging Wrath" },
  231895: { minDuration: 2, name: "Crusade" },
  107574: { minDuration: 2, name: "Avatar" },
  114050: { minDuration: 2, name: "Ascendance" },
  113858: { minDuration: 2, name: "Dark Soul: Instability" },
  267217: { minDuration: 2, name: "Nether Portal" },
  113860: { minDuration: 2, name: "Dark Soul: Misery" },
  137639: { minDuration: 2, name: "Storm, Earth, and Fire" },
  152173: { minDuration: 2, name: "Serenity" },
  1719: { minDuration: 2, name: "Recklessness" }
};

// Buffs that indicate when to use disarm (general PvP)
export const disarmPvP = {
  51271: { minDuration: 5, name: "Pillar of Frost" },
  315443: { minDuration: 5, name: "Abomination Limb" },
  207289: { minDuration: 5, name: "Unholy Frenzy" },
  308491: { minDuration: 5, name: "Resonating Arrow" },
  19574: { minDuration: 5, name: "Bestial Wrath" },
  193530: { minDuration: 5, name: "Aspect of the Wild" },
  288613: { minDuration: 5, name: "Trueshot" },
  311123: { minDuration: 5, name: "Weapons of Order" },
  137639: { minDuration: 5, name: "Storm, earth and fire" },
  152173: { minDuration: 5, name: "Serenity" },
  152262: { minDuration: 5, name: "Seraphim" },
  343527: { minDuration: 5, name: "Execution Sentence" },
  31884: { minDuration: 5, name: "Avenging Wrath" },
  216331: { minDuration: 5, name: "Avenging Crusader" },
  323547: { minDuration: 5, name: "Echoing Reprimand" },
  185313: { minDuration: 1, name: "Shadow Dance" },
  185422: { minDuration: 1, name: "Shadow Dance" },
  13750: { minDuration: 5, name: "Adrenaline Rush" },
  191427: { minDuration: 5, name: "Metamorphosis" },
  162264: { minDuration: 5, name: "Metamorphosis" },
  266779: { minDuration: 5, name: "Coordinated Assault" },
  1719: { minDuration: 5, name: "Recklessness" },
  107574: { minDuration: 5, name: "Avatar" }
};

// Buffs that indicate when to use disarm (arena specific)
export const disarmArenaPvP = {
  51271: { minDuration: 5, name: "Pillar of Frost" },
  315443: { minDuration: 5, name: "Abomination Limb" },
  207289: { minDuration: 5, name: "Unholy Frenzy" },
  308491: { minDuration: 5, name: "Resonating Arrow" },
  288613: { minDuration: 5, name: "Trueshot" },
  185313: { minDuration: 1, name: "Shadow Dance" },
  185422: { minDuration: 1, name: "Shadow Dance" },
  13750: { minDuration: 5, name: "Adrenaline Rush" },
  1719: { minDuration: 5, name: "Recklessness" },
  107574: { minDuration: 5, name: "Avatar" }
};

// Spells to reflect, categorized by type
export const pvpReflect = {
  203286: { type: "Damage", name: "Greater Pyroblast" },
  116858: { type: "Damage", name: "Chaos Bolt" },
  323673: { type: "Damage", name: "Mindgames" },
  323764: { type: "Damage", name: "Convoke" },
  118: { type: "Incapacitate", name: "Polymorph" },
  28271: { type: "Incapacitate", name: "Polymorph (Turtle)" },
  28272: { type: "Incapacitate", name: "Polymorph (Pig)" },
  61305: { type: "Incapacitate", name: "Polymorph (Black Cat)" },
  61721: { type: "Incapacitate", name: "Polymorph (Rabbit)" },
  61025: { type: "Incapacitate", name: "Polymorph (Serpent)" },
  61780: { type: "Incapacitate", name: "Polymorph (Turkey)" },
  161372: { type: "Incapacitate", name: "Polymorph (Peacock)" },
  161355: { type: "Incapacitate", name: "Polymorph (Penguin)" },
  161353: { type: "Incapacitate", name: "Polymorph (Polar Bear Cub)" },
  161354: { type: "Incapacitate", name: "Polymorph (Monkey)" },
  126819: { type: "Incapacitate", name: "Polymorph (Porcupine)" },
  277787: { type: "Incapacitate", name: "Polymorph (Direhorn)" },
  277792: { type: "Incapacitate", name: "Polymorph (Bumblebee)" },
  391622: { type: "Incapacitate", name: "Polymorph (Duck)" },
  321395: { type: "Incapacitate", name: "Polymorph (Mawrat)" },
  460392: { type: "Incapacitate", name: "Polymorph (Mosswool)" },
  51514: { type: "Incapacitate", name: "Hex" },
  210873: { type: "Incapacitate", name: "Hex (Compy)" },
  211004: { type: "Incapacitate", name: "Hex (Spider)" },
  211015: { type: "Incapacitate", name: "Hex (Cockroach)" },
  211010: { type: "Incapacitate", name: "Hex (Snake)" },
  269352: { type: "Incapacitate", name: "Hex (Skeletal Hatchling)" },
  277778: { type: "Incapacitate", name: "Hex (Zandalari Tendonripper)" },
  277784: { type: "Incapacitate", name: "Hex (Wicker Mongrel)" },
  309328: { type: "Incapacitate", name: "Hex (Living Honey)" },
  20066: { type: "Incapacitate", name: "Repentance" },
  5782: { type: "Disorient", name: "Fear" },
  118699: { type: "Disorient", name: "Fear" },
  33786: { type: "Disorient", name: "Cyclone" },
  360806: { type: "Disorient", name: "Sleep Walk" }
};

// Spells to interrupt, with context and priority
export const pvpInterrupts = {
  // Damage spells
  203286: { useKick: true, useCC: true, zone: "Damage", name: "Greater Pyroblast" },
  116858: { useKick: true, useCC: false, zone: "Damage", name: "Chaos Bolt" },
  203155: { useKick: true, useCC: false, zone: "Damage", name: "Sniper Shot" },
  323764: { useKick: true, useCC: true, zone: "Damage", name: "Convoke" },
  323673: { useKick: true, useCC: true, zone: "Damage", name: "MindGames" },
  
  // Healing spells
  47540: { useKick: true, useCC: false, zone: "Heal", name: "Penance" },
  596: { useKick: true, useCC: false, zone: "Heal", name: "Prayer of Healing" },
  2060: { useKick: true, useCC: false, zone: "Heal", name: "Heal" },
  2061: { useKick: true, useCC: false, zone: "Heal", name: "Flash Heal" },
  290112: { useKick: true, useCC: false, zone: "Heal", name: "Binding Heal" },
  33076: { useKick: true, useCC: false, zone: "Heal", name: "Prayer of Mending" },
  64843: { useKick: true, useCC: false, zone: "Heal", name: "Divine Hymn" },
  120517: { useKick: true, useCC: false, zone: "Heal", name: "Halo" },
  194509: { useKick: true, useCC: false, zone: "Heal", name: "Power Word: Radiance" },
  265202: { useKick: true, useCC: false, zone: "Heal", name: "Holy Word: Salvation" },
  289666: { useKick: true, useCC: false, zone: "Heal", name: "Greater Heal" },
  740: { useKick: true, useCC: false, zone: "Heal", name: "Tranquility" },
  8936: { useKick: true, useCC: false, zone: "Heal", name: "Regrowth" },
  48438: { useKick: true, useCC: false, zone: "Heal", name: "Wild Growth" },
  289022: { useKick: true, useCC: false, zone: "Heal", name: "Nourish" },
  1064: { useKick: true, useCC: false, zone: "Heal", name: "Chain Heal" },
  8004: { useKick: true, useCC: false, zone: "Heal", name: "Healing Surge" },
  73920: { useKick: true, useCC: false, zone: "Heal", name: "Healing Rain" },
  77472: { useKick: true, useCC: false, zone: "Heal", name: "Healing Wave" },
  197995: { useKick: true, useCC: false, zone: "Heal", name: "Wellspring" },
  207778: { useKick: true, useCC: false, zone: "Heal", name: "Downpour" },
  19750: { useKick: true, useCC: false, zone: "Heal", name: "Flash of Light" },
  82326: { useKick: true, useCC: false, zone: "Heal", name: "Holy Light" },
  116670: { useKick: true, useCC: false, zone: "Heal", name: "Vivify" },
  124682: { useKick: true, useCC: false, zone: "Heal", name: "Enveloping Mist" },
  191837: { useKick: true, useCC: false, zone: "Heal", name: "Essence Font" },
  209525: { useKick: true, useCC: false, zone: "Heal", name: "Soothing Mist" },
  227344: { useKick: true, useCC: false, zone: "Heal", name: "Surging Mist" },
  
  // CC spells
  118: { useKick: true, useCC: false, zone: "CC", name: "Polymorph" },
  28271: { useKick: true, useCC: false, zone: "CC", name: "Polymorph (Turtle)" },
  28272: { useKick: true, useCC: false, zone: "CC", name: "Polymorph (Pig)" },
  61305: { useKick: true, useCC: false, zone: "CC", name: "Polymorph (Black Cat)" },
  61721: { useKick: true, useCC: false, zone: "CC", name: "Polymorph (Rabbit)" },
  61025: { useKick: true, useCC: false, zone: "CC", name: "Polymorph (Serpent)" },
  61780: { useKick: true, useCC: false, zone: "CC", name: "Polymorph (Turkey)" },
  161372: { useKick: true, useCC: false, zone: "CC", name: "Polymorph (Peacock)" },
  161355: { useKick: true, useCC: false, zone: "CC", name: "Polymorph (Penguin)" },
  161353: { useKick: true, useCC: false, zone: "CC", name: "Polymorph (Polar Bear Cub)" },
  161354: { useKick: true, useCC: false, zone: "CC", name: "Polymorph (Monkey)" },
  126819: { useKick: true, useCC: false, zone: "CC", name: "Polymorph (Porcupine)" },
  277787: { useKick: true, useCC: false, zone: "CC", name: "Polymorph (Direhorn)" },
  277792: { useKick: true, useCC: false, zone: "CC", name: "Polymorph (Bumblebee)" },
  391622: { useKick: true, useCC: false, zone: "CC", name: "Polymorph (Duck)" },
  321395: { useKick: true, useCC: false, zone: "CC", name: "Polymorph (Mawrat)" },
  460392: { useKick: true, useCC: false, zone: "CC", name: "Polymorph (Mosswool)" },
  20066: { useKick: true, useCC: false, zone: "CC", name: "Repentance" },
  51514: { useKick: true, useCC: false, zone: "CC", name: "Hex" },
  210873: { useKick: true, useCC: false, zone: "CC", name: "Hex (Compy)" },
  211004: { useKick: true, useCC: false, zone: "CC", name: "Hex (Spider)" },
  211015: { useKick: true, useCC: false, zone: "CC", name: "Hex (Cockroach)" },
  211010: { useKick: true, useCC: false, zone: "CC", name: "Hex (Snake)" },
  269352: { useKick: true, useCC: false, zone: "CC", name: "Hex (Skeletal Hatchling)" },
  277778: { useKick: true, useCC: false, zone: "CC", name: "Hex (Zandalari Tendonripper)" },
  277784: { useKick: true, useCC: false, zone: "CC", name: "Hex (Wicker Mongrel)" },
  309328: { useKick: true, useCC: false, zone: "CC", name: "Hex (Living Honey)" },
  19386: { useKick: true, useCC: false, zone: "CC", name: "Wyvern Sting" },
  5782: { useKick: true, useCC: false, zone: "CC", name: "Fear" },
  118699: { useKick: true, useCC: false, zone: "CC", name: "Fear" },
  33786: { useKick: true, useCC: false, zone: "CC", name: "Cyclone" },
  605: { useKick: true, useCC: false, zone: "CC", name: "Mind Control" },
  982: { useKick: true, useCC: false, zone: "CC", name: "Revive Pet" },
  32375: { useKick: true, useCC: false, zone: "CC", name: "Mass Dispel" },
  20484: { useKick: true, useCC: true, zone: "CC", name: "Rebirth" },
  360806: { useKick: true, useCC: false, zone: "CC", name: "Sleep Walk" }
};

// Magic CC debuffs on allies — Reverse Magic (DH PvP) / similar tools (spell IDs; match PVPDRList)
export const pvpReverseMagicAllyAuras = {
  853: "Hammer of Justice",
  3355: "Freezing Trap",
  203337: "Freezing Trap (Honor talent)",
};

export const pvpReverseMagicAllyAuraIds = Object.keys(pvpReverseMagicAllyAuras).map(Number);

// Immunity buffs that prevent damage/CC
export const pvpImmunityBuffs = {
  373549: "Testing Immunity",
  33786: "Cyclone",
  45438: "Ice Block",
  186265: "Aspect of the Turtle", 
  642: "Divine Shield"
};

// Original spell blacklist
export const spellBlacklist = {
  61305: "Polymorph (Cat)",
  161354: "Polymorph (Monkey)",
  161355: "Polymorph (Penguin)",
  28272: "Polymorph (Pig)",
  161353: "Polymorph (Polar Bear)",
  126819: "Polymorph (Porcupine)",
  61721: "Polymorph (Rabbit)",
  118: "Polymorph (Sheep)",
  61780: "Polymorph (Turkey)",
  28271: "Polymorph (Turtle)",
  277792: "Polymorph (Bumblebee)",
  277787: "Polymorph (Direhorn)",
  391622: "Polymorph (Duck)",
  460392: "Polymorph (Mosswool)",
  211015: "Hex (Cockroach)",
  210873: "Hex (Compy)",
  269352: "Hex (Skeletal Hatchling)",
  309328: "Hex (Living Honey)",
  277784: "Hex (Wicker Mongrel)",
  277778: "Hex (Zandalari Tendonripper)",
  51514: "Hex (Frog)",
  211010: "Hex (Snake)",
  211004: "Hex (Spider)",
  360806: "Sleep walk",
  5782: "Fear",
  20066: "Repentance",
};

export const spellReflectBlacklist = {
  61305: "Polymorph (Cat)",
  161354: "Polymorph (Monkey)",
  161355: "Polymorph (Penguin)",
  28272: "Polymorph (Pig)",
  161353: "Polymorph (Polar Bear)",
  126819: "Polymorph (Porcupine)",
  61721: "Polymorph (Rabbit)",
  118: "Polymorph (Sheep)",
  61780: "Polymorph (Turkey)",
  28271: "Polymorph (Turtle)",
  277792: "Polymorph (Bumblebee)",
  277787: "Polymorph (Direhorn)",
  391622: "Polymorph (Duck)",
  460392: "Polymorph (Mosswool)",
  211015: "Hex (Cockroach)",
  210873: "Hex (Compy)",
  269352: "Hex (Skeletal Hatchling)",
  309328: "Hex (Living Honey)",
  277784: "Hex (Wicker Mongrel)",
  277778: "Hex (Zandalari Tendonripper)",
  51514: "Hex (Frog)",
  211010: "Hex (Snake)",
  211004: "Hex (Spider)",
  360806: "Sleep walk",
  5782: "Fear",
  20066: "Repentance",
  34914: "Vampiric Touch",
  403629: "Chaos Bolt",
  11366: "Pyroblast",
  33786: "Cyclone",
  323673: "Mindgames",
  375901: "Mindgames",
  323707: "Mindgames",
  323701: "Mindgames",
  375905: "Mindgames",
  375903: "Mindgames",
  375902: "Mindgames",
  323706: "Mindgames",
};

// Helper functions for PVP decision making
export const pvpHelpers = {
  /**
   * Check if unit has major damage cooldowns with sufficient duration
   * @param {Object} unit - The unit to check
   * @param {number} minDuration - Minimum duration in seconds (default: 2)
   * @returns {Object|null} - Damage buff info or null
   */
  hasMajorDamageCooldown(unit, minDuration = 2) {
    if (!unit || !unit.auras) return null;
    
    for (const aura of unit.auras) {
      if (aura && aura.spellId && damageBuffs[aura.spellId]) {
        const buffInfo = damageBuffs[aura.spellId];
        const remainingTime = aura.remaining / 1000; // Convert to seconds
        
        if (remainingTime >= Math.max(minDuration, buffInfo.minDuration)) {
          return { spellId: aura.spellId, ...buffInfo, remainingTime };
        }
      }
    }
    return null;
  },

  /**
   * Check if unit has disarmable buffs with sufficient duration
   * @param {Object} unit - The unit to check
   * @param {boolean} isArena - Whether this is arena (different disarm list)
   * @param {number} minDuration - Minimum duration in seconds (default: 3)
   * @returns {Object|null} - Disarm buff info or null
   */
  hasDisarmableBuff(unit, isArena = false, minDuration = 3) {
    if (!unit || !unit.auras) return null;
    
    const disarmList = isArena ? disarmArenaPvP : disarmPvP;
    
    for (const aura of unit.auras) {
      if (aura && aura.spellId && disarmList[aura.spellId]) {
        const buffInfo = disarmList[aura.spellId];
        const remainingTime = aura.remaining / 1000;
        
        if (remainingTime >= Math.max(minDuration, buffInfo.minDuration)) {
          return { spellId: aura.spellId, ...buffInfo, remainingTime };
        }
      }
    }
    return null;
  },

  /**
   * Check if unit is immune to damage/CC
   * @param {Object} unit - The unit to check
   * @returns {boolean} - True if unit has immunity
   */
  hasImmunity(unit) {
    if (!unit || !unit.auras) return false;
    
    return unit.auras.some(aura => 
      aura && aura.spellId && pvpImmunityBuffs[aura.spellId]
    );
  },

  /**
   * Get interrupt priority for a spell being cast
   * @param {number} spellId - The spell ID being cast
   * @returns {Object|null} - Interrupt info or null
   */
  getInterruptInfo(spellId) {
    return pvpInterrupts[spellId] || null;
  },

  /**
   * Check if spell should be reflected
   * @param {number} spellId - The spell ID being cast
   * @param {string} type - Optional type filter (Damage, Incapacitate, Disorient)
   * @returns {boolean} - True if spell should be reflected
   */
  shouldReflectSpell(spellId, type = null) {
    const reflectInfo = pvpReflect[spellId];
    if (!reflectInfo) return false;
    
    return type ? reflectInfo.type === type : true;
  },

  /**
   * Get high priority purge targets on unit
   * @param {Object} unit - The unit to check
   * @returns {Array} - Array of purgeable buff info
   */
  getHighPriorityPurgeTargets(unit) {
    if (!unit || !unit.auras) return [];
    
    return unit.auras
      .filter(aura => aura && aura.spellId && pvpPurgeHigh[aura.spellId])
      .map(aura => ({ spellId: aura.spellId, name: pvpPurgeHigh[aura.spellId], aura }));
  },

  /**
   * Check if unit should be prioritized for CC based on cooldowns
   * @param {Object} unit - The unit to check
   * @param {number} minDuration - Minimum cooldown duration to consider (default: 3)
   * @returns {boolean} - True if unit is a priority CC target
   */
  isPriorityCCTarget(unit, minDuration = 3) {
    return this.hasMajorDamageCooldown(unit, minDuration) !== null ||
           this.hasDisarmableBuff(unit, false, minDuration) !== null;
  }
};

export default {
  spellBlacklist, // Legacy compatibility
  spellReflectBlacklist,
  pvpPurgeHigh,
  pvpPurgeLow,
  damageBuffs,
  disarmPvP,
  disarmArenaPvP,
  pvpReflect,
  pvpInterrupts,
  pvpImmunityBuffs,
  pvpReverseMagicAllyAuras,
  pvpReverseMagicAllyAuraIds,
  helpers: pvpHelpers
};
